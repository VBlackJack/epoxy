/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS } from '../../config/constants';
import { turnClockwise } from '../lynx/directions';
import { AudioManager } from '../../audio/AudioManager';
import {
  BOMB_ITEM_ID,
  followsCcCadence,
  CC_QUEUED_TANK_TURN_DELAY_PASSES,
  CC_TANK_TURN_DELAY_PASSES,
  CHIP_ITEM_ID,
  ccStepTicks,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  CHANNEL_TOGGLE_PARITY_BITS,
  FIRE_LAUNCHERS_ACTION,
  GRAY_BUTTON_RADIUS,
  FLAME_TOGGLE_PARITY_BIT,
  GREEN_TOGGLE_PARITY_BIT,
  OPPOSITE_DIRECTION,
  PHASE_LINE_PATTERN,
  PULSE_WIRED_ACTION,
  ROLLING_BALL_PATTERN,
  STEER_MONSTERS_ACTION,
  channelOfButtonAction
} from '../coreConstants';
import { isPhasingEntityType } from '../RulesetFeatures';
import { ButtonAction, ChannelColor, Direction, PlayerState, RuntimeEntity, TileDefinition } from '../types';
import { hasEntityFacing } from './epoxyArrowBlocks';
import { initialEmulationState } from './epoxyEmulation';
import { isCanBlockEnter, leaveBlockSplash, moveBlockTo, slidePushesAhead } from './epoxyBlocks';
import { advanceRailSwitch } from './epoxyRailsCc2';
import { holdFrameArrival, tagSlideFrame } from './epoxyFrames';
import { deferHazardToStepEnd, judgesHazardsAtStepEnd, stepStillRuns } from './epoxyPlayer';
import { usesCc2Engine } from './ccRules';
import { canMonsterEnter, cc2EntryStepTicks, cc3dReleaseCooldown, resolveMonsterArrival } from './epoxyMonsters';
import { fireLauncherAt, fireLaunchers } from './epoxyShots';
import { steerMonsters } from './epoxySteering';
import {
  EpoxyContext,
  EpoxyWorld,
  getEntityAt,
  holdColorsOpen,
  isInBounds,
  killPlayer,
  mapWidth,
  monsterSlowdown,
  addClonedEntity,
  removeEntity,
  signalSinkOn,
  killPlayerAt,
  playersOf
} from './epoxyWorld';

/** Hard cap on live entities, so a cloner wired to a held button cannot flood the grid. */
const MAX_ACTIVE_ENTITIES = 512;

/** Sound played when hold doors open or close. */
const HOLD_DOOR_SFX = 'door';

/**
 * Returns false when a clone spawned by the button killed the player. `atStepEnd` marks a press made when the player's
 * step ends (CC2 engine): a blue button then turns the tanks at their next decision instead of a few passes later.
 */
export function triggerButton(ctx: EpoxyContext, bx: number, by: number, action: ButtonAction, atStepEnd = false): boolean {
  const w = ctx.world;
  AudioManager.playSfx('button');

  if (action === 'toggle_walls') {
    swapTerrain(w, (tile) => tile.togglesTo);
    // The green chips and bombs lying anywhere on the level change form with the green walls.
    swapItems(w, (tile) => tile.itemTogglesTo);
    flipToggleParity(w, GREEN_TOGGLE_PARITY_BIT);
  } else if (channelOfButtonAction(action) !== undefined) {
    // A colour button swaps the walls of its own channel only; green walls and the other colours stay.
    const channel = channelOfButtonAction(action);
    swapTerrain(w, (tile) => (tile.toggleChannel === channel ? tile.channelTogglesTo : undefined));
    flipToggleParity(w, CHANNEL_TOGGLE_PARITY_BITS[channel as ChannelColor] ?? 0);
  } else if (action === 'toggle_flames') {
    swapTerrain(w, (tile) => tile.flameTogglesTo);
    flipToggleParity(w, FLAME_TOGGLE_PARITY_BIT);
    burnPlayerIfFlamesLit(ctx);
    burnEntitiesOnFire(ctx);
  } else if (action === 'swap_chips_bombs') {
    swapChipsAndBombs(w, bx, by);
  } else if (action === 'reverse_tanks' && w.ccRules) {
    markTanksToTurn(w, atStepEnd);
  } else if (action === 'reverse_tanks') {
    for (const ent of w.entities) {
      if (ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) {
        ent.dir = OPPOSITE_DIRECTION[ent.dir];
      }
    }
  } else if (action === STEER_MONSTERS_ACTION) {
    // The player's step ends on the pad: the puppets step the way the player moved.
    if (!steerMonsters(ctx, w.player.dir)) return false;
  } else if (action === FIRE_LAUNCHERS_ACTION) {
    if (!fireLaunchers(ctx, bx, by)) return false;
  } else if (action === PULSE_WIRED_ACTION) {
    if (!pulseWiredDevices(ctx, bx, by)) return false;
  } else if (action === 'trigger_cloner') {
    const links = w.cloneLinks.filter((l) => l.buttonX === bx && l.buttonY === by);
    if (links.length > 0) {
      for (const link of links) {
        // CC2 engine: a linked cloner fires from what stands on it now, and spawns nothing when it is empty (Lexy cloner.activate,
        // tiletypes.js:1704-1706). A press is never a wire edge, so it tries one way only.
        if (usesCc2Engine(w.level) && !w.cc3dPace) {
          // A link whose cell is no longer a clone machine (a toggled or replaced tile) fires nothing.
          if (!ConfigRegistry.getTile(w.terrain[link.clonerY]?.[link.clonerX]).isCloneMachine) continue;
          const occupant = w.entities.find((e) => e.x === link.clonerX && e.y === link.clonerY && !isPhasingEntityType(e.type));
          if (occupant !== undefined && !spawnFromCloner(ctx, link.clonerX, link.clonerY, occupant.type, occupant.dir)) return false;
          continue;
        }
        if (!spawnFromCloner(ctx, link.clonerX, link.clonerY, link.templateType, link.templateDir)) {
          return false;
        }
      }
    } else {
      // Fallback: trigger any clone machine that has an entity template sitting on it
      for (const ent of [...w.entities]) {
        if (ConfigRegistry.getTile(w.terrain[ent.y]?.[ent.x]).isCloneMachine && !isPhasingEntityType(ent.type)) {
          if (!spawnFromCloner(ctx, ent.x, ent.y, ent.type, ent.dir)) return false;
        }
      }
    }
  }
  return true;
}

/**
 * Classic rules, blue button: every tank off a clone machine and off the ice carries one toggled mark, due a few entity
 * passes later; a second press before the tank acts takes the mark off again (one flag, as in the reference engine).
 * Epoxy's own levels turn every tank at once. A press made at the end of the player's step (`atStepEnd`) is due in the
 * pass already counted: the tanks turn at their next decision.
 */
function markTanksToTurn(w: EpoxyWorld, atStepEnd: boolean): void {
  // The clock counts the pass of the current tick as soon as it starts: count from the passes begun before this tick,
  // whatever the source of the press (the player, a slide, a monster stepping on the button).
  const begun = w.ccPassOpen ? w.ccMonsterClock - 1 : w.ccMonsterClock;
  // A press taken from the monster queue turns the tanks one pass after it is applied.
  const delayed = w.ccArrivalsRunning ? w.ccMonsterClock + CC_QUEUED_TANK_TURN_DELAY_PASSES : begun + CC_TANK_TURN_DELAY_PASSES;
  const due = atStepEnd ? w.ccMonsterClock : delayed;
  for (const ent of w.entities) {
    if (!ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) continue;
    const tile = ConfigRegistry.getTile(w.terrain[ent.y]?.[ent.x]);
    if (tile.isCloneMachine || tile.slideType === 'ice') continue;
    if (ent.tankTurn !== undefined) delete ent.tankTurn;
    else ent.tankTurn = due;
  }
}

/**
 * Start of an entity pass of a classic-rules level: a marked tank whose pass has come turns around if it is at rest;
 * a tank in the middle of a step ignores the press (on the CC2 engine it keeps the mark until it decides again). The mark is spent either way. A press made later in the same
 * pass marks the tank again for a later pass, as the reference engine does (its flag is toggled after the tank turned).
 */
export function turnMarkedTanks(w: EpoxyWorld): void {
  const pass = w.ccMonsterClock;
  for (const ent of w.entities) {
    if (ent.tankTurn === undefined || ent.tankTurn > pass) continue;
    // CC2 engine: a tank in the middle of a step keeps the mark until its next decision (Lexy keeps pending_reverse), and turns then.
    if (usesCc2Engine(w.level) && ent.cooldownTicks > 0) continue;
    delete ent.tankTurn;
    // A creature that is no tank any more (transmogrified) keeps no mark.
    if (!ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) continue;
    if (ent.cooldownTicks === 0) ent.dir = OPPOSITE_DIRECTION[ent.dir];
  }
}

/**
 * Flips one cell to the other form of its tile (a green toggle wall, a rail switch, or on a CC2-engine level a force floor or a swivel door), as a wired signal asks on a rising
 * edge. The cell changes whoever stands on it, as it does under the green button. A cell whose tile has no other form
 * (it was replaced since the level loaded) is left as it is. The toggle parity of the green family is not touched: the
 * flip is per cell, and a flip tile hidden under a removable top is never wired. The lasers are retraced.
 */
export function flipCellAt(w: EpoxyWorld, x: number, y: number): void {
  // A Chip's Challenge 2 track cell has no other form: its switch (if it has one) moves to the next track.
  if (ConfigRegistry.getTile(w.terrain[y][x]).railJunction === true) {
    advanceRailSwitch(w, x, y);
    return;
  }
  const here = ConfigRegistry.getTile(w.terrain[y][x]);
  // A CC2 force floor reverses and a CC2 swivel door turns clockwise when a wire powers it (Lexy: on_power activates the tile).
  const poweredFlip = here.flipsOnPower === true && usesCc2Engine(w.level) ? (here.grayFlipsTo ?? here.swivelTurns?.cw) : undefined;
  const next = here.togglesTo ?? poweredFlip;
  if (next === undefined) return;
  w.terrain[y][x] = next;
  w.beamDirty = true;
  AudioManager.playSfx(HOLD_DOOR_SFX);
}

/**
 * Flips one wired cell (a purple wall, a purple floor or a wired flame jet) to the other form of its tile, as a signal asks
 * on every change of its input. The cell changes whoever stands on it. A cell whose tile has no other form is left as it
 * is. A flame jet that lights burns what stands on it, as the orange button does. The toggle parity is not touched, and the
 * lasers are retraced.
 */
export function flipWiredCellAt(ctx: EpoxyContext, x: number, y: number): void {
  const w = ctx.world;
  const next = ConfigRegistry.getTile(w.terrain[y][x]).wireTogglesTo;
  if (next === undefined) return;
  w.terrain[y][x] = next;
  w.beamDirty = true;
  AudioManager.playSfx(HOLD_DOOR_SFX);
  if (ConfigRegistry.getTile(next).hazard === 'fire') {
    burnPlayerIfFlamesLit(ctx);
    burnEntitiesOnFire(ctx);
  }
}

/**
 * A gray area button flips a flame jet for good, lit or dark. A jet that lights burns nothing at the moment of the flip
 * (the Lexy Labyrinth engine kills on its own tick); the usual fire rules judge what stands on it afterwards. The lasers
 * are retraced.
 */
function flipFlameJetAt(w: EpoxyWorld, x: number, y: number): void {
  const next = ConfigRegistry.getTile(w.terrain[y][x]).flameTogglesTo;
  if (next === undefined) return;
  w.terrain[y][x] = next;
  w.beamDirty = true;
  AudioManager.playSfx(HOLD_DOOR_SFX);
}

/** A gray area button turns a swivel door a quarter turn clockwise, whoever stands in it. */
function turnSwivelAt(w: EpoxyWorld, x: number, y: number): void {
  const next = ConfigRegistry.getTile(w.terrain[y][x]).swivelTurns?.cw;
  if (next === undefined) return;
  w.terrain[y][x] = next;
  w.beamDirty = true;
  AudioManager.playSfx(HOLD_DOOR_SFX);
}

/** A gray area button turns a force floor round (a tile that names its reverse in `grayFlipsTo`). */
function flipGrayCellAt(w: EpoxyWorld, x: number, y: number): void {
  const next = ConfigRegistry.getTile(w.terrain[y][x]).grayFlipsTo;
  if (next === undefined) return;
  w.terrain[y][x] = next;
  AudioManager.playSfx(HOLD_DOOR_SFX);
}

/**
 * A gray area button works: every wired device (a sink of the signal network, or an unlinked purple tile, wired jet, wired trap, launcher or clone machine) within GRAY_BUTTON_RADIUS cells of the
 * button, the square 5 by 5 around it, is pulsed once, with no wire from the button. A flip tile flips once, a
 * launcher or a clone machine fires once (under the usual caps), and a level sink (a hold door, a relay pad, a wired
 * trap) is held on for the next settle only. Devices come in the evaluation order of the network. Returns false when
 * a shot or a clone killed the player.
 */
function pulseWiredDevices(ctx: EpoxyContext, bx: number, by: number): boolean {
  // The frame of the clone's release that pressed this button is dropped by the first cloner the area fires (spawnFromCloner): every
  // cloner of the area is released at that frame, so it is put back before each one and gone when the pulse ends.
  const releaseFrame = ctx.world.cc2ReleaseFrame;
  try {
    return pulseAreaDevices(ctx, bx, by, releaseFrame);
  } finally {
    delete ctx.world.cc2ReleaseFrame;
  }
}

/** The pulse of pulseWiredDevices; `releaseFrame` is set again on the world before each clone machine fires. */
function pulseAreaDevices(ctx: EpoxyContext, bx: number, by: number, releaseFrame: EpoxyWorld['cc2ReleaseFrame']): boolean {
  const w = ctx.world;
  const fireCloner = (x: number, y: number): boolean => {
    if (releaseFrame !== undefined) w.cc2ReleaseFrame = releaseFrame;
    return fireClonerAt(ctx, x, y);
  };
  const runtime = w.signals;
  const width = mapWidth(w);
  const handled = new Set<number>();
  if (runtime !== undefined) {
    for (const index of runtime.network.sinkIndexes) {
      const cell = runtime.network.nodes[index].cell;
      const x = cell % width;
      const y = Math.floor(cell / width);
      if (Math.abs(x - bx) > GRAY_BUTTON_RADIUS || Math.abs(y - by) > GRAY_BUTTON_RADIUS) continue;
      handled.add(cell);
      const fires = runtime.defs.get(index)?.fires;
      if (fires === 'flip') flipCellAt(w, x, y);
      else if (fires === 'flip_edges') flipWiredCellAt(ctx, x, y);
      else if (fires === 'launcher') {
        if (!fireLauncherAt(ctx, x, y)) return false;
      } else if (fires === 'cloner') {
        if (!fireCloner(x, y)) return false;
      } else runtime.areaPending.add(cell);
      if (!w.player.alive) return false;
    }
  }
  // A device with no wire is pulsed too: the button needs no wire and neither does what it reaches.
  for (let y = Math.max(0, by - GRAY_BUTTON_RADIUS); y <= Math.min(w.terrain.length - 1, by + GRAY_BUTTON_RADIUS); y++) {
    for (let x = Math.max(0, bx - GRAY_BUTTON_RADIUS); x <= Math.min(width - 1, bx + GRAY_BUTTON_RADIUS); x++) {
      const cell = y * width + x;
      if (handled.has(cell)) continue;
      const tile = ConfigRegistry.getTile(w.terrain[y][x]);
      if (tile.wireTogglesTo !== undefined) flipWiredCellAt(ctx, x, y);
      else if (tile.railJunction === true) advanceRailSwitch(w, x, y);
      else if (tile.togglesTo !== undefined) flipCellAt(w, x, y);
      else if (tile.flameTogglesTo !== undefined) flipFlameJetAt(w, x, y);
      else if (tile.swivelTurns !== undefined) turnSwivelAt(w, x, y);
      else if (tile.grayFlipsTo !== undefined) flipGrayCellAt(w, x, y);
      else if (tile.wiredTrap === true) runtime?.areaPending.add(cell);
      else if (tile.shotLauncher !== undefined) {
        if (!fireLauncherAt(ctx, x, y)) return false;
      } else if (tile.isCloneMachine === true) {
        if (!fireCloner(x, y)) return false;
      }
      if (!w.player.alive) return false;
    }
  }
  return true;
}

/** Records one press of a toggle family, when the level hides a wall of that family under a removable top. */
function flipToggleParity(w: EpoxyWorld, bit: number): void {
  if ((w.coveredToggleBits & bit) !== 0) w.toggleParity ^= bit;
}

/**
 * Sets every relay pad a signal link ends on to the form its input asks for: lit while the input is on, dark while it
 * is off; a CC2 powered device (`poweredTwin`) likewise takes its live form while on and its off form while off. A pad no link ends on is not a node, so it keeps the form it was placed in. Call it after the settle and
 * before the hold doors, at each settle site; it runs at the load settle too, so a pad starts in the form of its
 * input. The pads are laser transparent, so the beams are not retraced. A pad that lights under an actor makes no
 * jump (a jump happens on arrival only), and a pad that darkens under one leaves the actor standing. Returns true
 * when a pad changed. Returns at once on a level without signals.
 */
export function setPoweredCells(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined) return false;
  const width = mapWidth(w);
  let changed = false;
  for (const index of runtime.network.sinkIndexes) {
    if (runtime.defs.get(index)?.powers !== true) continue;
    const cell = runtime.network.nodes[index].cell;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const tile = ConfigRegistry.getTile(w.terrain[y][x]);
    if (tile.poweredTwin !== undefined) {
      // A CC2 powered device shows its live form (a teleporter, a transmogrifier) while its input is on, the other while off.
      const isLive = tile.isTeleporter === true || tile.transmogrifies === true;
      if (isLive === signalSinkOn(w, index)) continue;
      w.terrain[y][x] = tile.poweredTwin;
      changed = true;
      continue;
    }
    // The cell may hold another terrain by now (nothing replaces a pad today): leave it alone.
    if (tile.relayPad === undefined || tile.relayTwin === undefined) continue;
    if ((tile.relayPad === 'lit') === signalSinkOn(w, index)) continue;
    w.terrain[y][x] = tile.relayTwin;
    changed = true;
  }
  return changed;
}

/**
 * Sets every hold door from the plates of its colour: open while the colour has at least one plate and
 * every one of them is pressed, closed otherwise (a colour with no plate keeps its doors shut). A door
 * that closes on an occupied cell follows its `holdDoorClosesOnOccupant` rule: shut at once by default,
 * the occupant may leave and nothing may enter, or kept open until the cell is free. Returns true when a
 * door changed, so the caller can retrace the lasers. Returns at once on a level without hold doors.
 * The pass reads the plates as they are when it runs: doors settle at the end of a tick or move, while
 * a brown trap reads its button live.
 */
export function setHoldDoors(ctx: EpoxyContext, playSound: boolean = true): boolean {
  const w = ctx.world;
  if (w.holdDoors.length === 0) return false;

  const platesOpen = holdColorsOpen(w);

  let changed = false;
  for (const { x, y } of w.holdDoors) {
    const tile = ConfigRegistry.getTile(w.terrain[y][x]);
    if (tile.holdDoorColor === undefined || !tile.holdDoorTogglesTo) continue;
    const wantsOpen = platesOpen.get(tile.holdDoorColor) === true;
    if (tile.holdDoorOpen === wantsOpen) continue;
    const occupied = playersOf(w).some((p) => p.x === x && p.y === y) || getEntityAt(w, x, y) !== undefined;
    if (!wantsOpen && occupied && tile.holdDoorClosesOnOccupant === false) continue;
    w.terrain[y][x] = tile.holdDoorTogglesTo;
    changed = true;
  }
  if (changed) {
    if (playSound) AudioManager.playSfx(HOLD_DOOR_SFX);
    w.beamDirty = true;
  }
  return changed;
}

/**
 * Swaps chips and bombs in the square region centered on `(bx, by)`. The chip count
 * the exit asks for stays as it is: a chip turned into a bomb never stands in for one
 * collected, so the button cannot open the exit early.
 */
function swapChipsAndBombs(w: EpoxyWorld, bx: number, by: number): void {
  const minY = Math.max(0, by - GRAY_BUTTON_RADIUS);
  const maxY = Math.min(w.items.length - 1, by + GRAY_BUTTON_RADIUS);
  for (let y = minY; y <= maxY; y++) {
    const minX = Math.max(0, bx - GRAY_BUTTON_RADIUS);
    const maxX = Math.min(w.items[y].length - 1, bx + GRAY_BUTTON_RADIUS);
    for (let x = minX; x <= maxX; x++) {
      const item = w.items[y][x];
      if (item === CHIP_ITEM_ID) {
        w.items[y][x] = BOMB_ITEM_ID;
      } else if (item === BOMB_ITEM_ID) {
        w.items[y][x] = CHIP_ITEM_ID;
      }
    }
  }
}

/** Replaces every item for which `target` names an item by that item. */
function swapItems(w: EpoxyWorld, target: (tile: TileDefinition) => string | undefined): void {
  for (let y = 0; y < w.items.length; y++) {
    for (let x = 0; x < w.items[y].length; x++) {
      const id = w.items[y][x];
      if (id === null) continue;
      const next = target(ConfigRegistry.getTile(id));
      if (next) w.items[y][x] = next;
    }
  }
}

/** Replaces every tile for which `target` names a terrain by that terrain. */
function swapTerrain(w: EpoxyWorld, target: (tile: TileDefinition) => string | undefined): void {
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      const next = target(ConfigRegistry.getTile(w.terrain[y][x]));
      if (next) {
        w.terrain[y][x] = next;
      }
    }
  }
}

/**
 * Applies the fire rule to every entity standing on fire after the jets were
 * swapped, as if it had just stepped there: a block that fire destroys melts
 * (leaving what its definition names), a monster that is not immune dies.
 */
function burnEntitiesOnFire(ctx: EpoxyContext): void {
  const w = ctx.world;
  for (const entity of [...w.entities]) {
    const tile = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]);
    if (tile.hazard !== 'fire') continue;
    const def = ConfigRegistry.getEntityDef(entity.type);
    if (entity.kind === 'block') {
      if (!def?.destroyedByFire) continue;
      // CC2 engine: a lit flame jet kills the block standing on it and leaves the floor as it is (Lexy flame_jet_on on_stand
      // kill_actor, tiletypes.js:2163-2168); only real fire melts an ice block into water (tiletypes.js:941-969).
      const litJetKills = usesCc2Engine(w.level) && !w.cc3dPace && tile.burnsOccupants === true;
      if (def.meltsInFireTo && !litJetKills) {
        w.terrain[entity.y][entity.x] = def.meltsInFireTo;
      }
    } else if (def?.immuneToFire) {
      continue;
    }
    removeEntity(w, entity.uid);
    AudioManager.playSfx('burn');
    ctx.emitVisual('explosion', entity.x, entity.y);
  }
}

/**
 * CC2 engine: whether a jet that lit under `p` does not burn him yet because his step still runs: it is judged when the step ends, if
 * still lit (Lexy flame_jet_off.activate kills nothing, tiletypes.js 2146-2152; flame_jet_on on_stand runs from step_on_cell, tiletypes.js
 * 2163-2168, game.js 2365-2366). Marks the cell as his pending hazard and returns true then.
 */
function deferJetBurnToStepEnd(w: EpoxyWorld, p: PlayerState): boolean {
  // A still controlled player whose turn of this tick is still ahead decides first (Lexy flame_jet_on on_stand runs from the idle phase,
  // after the decisions, game.js 1345-1356): the jet is judged at the end of his turn (GameEngine.playActorTurn).
  if (judgesHazardsAtStepEnd(w) && p === w.player && !stepStillRuns(p) && w.cc2TurnAhead === true && ConfigRegistry.getTile(w.terrain[p.y][p.x]).burnsOccupants === true) {
    w.cc2JetAtTurn = { x: p.x, y: p.y };
    return true;
  }
  if (!judgesHazardsAtStepEnd(w) || !stepStillRuns(p)) return false;
  deferHazardToStepEnd(p, p.x, p.y);
  return true;
}

/**
 * CC2 engine: whether `tile` is real fire (no jet of any kind), which never burns a player at a lighting: fire has no on_stand in Lexy
 * (tiletypes.js 941-972) and flame_jet_off.activate kills nothing (2146-2152). A native jet toggles by flameTogglesTo, a wired one by
 * wireTogglesTo, the CC2 one burns its occupants: none of them is spared.
 */
function realFireSpares(w: EpoxyWorld, tile: TileDefinition): boolean {
  return judgesHazardsAtStepEnd(w) && tile.burnsOccupants !== true && tile.flameTogglesTo === undefined && tile.wireTogglesTo === undefined;
}

/** A flame jet lit under the player (a monster or block pressed the button) burns them. */
function burnPlayerIfFlamesLit(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (!w.player.alive) return;
  if (w.parked.length === 0) {
    const tile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);
    if (tile.hazard === 'fire' && !realFireSpares(w, tile) && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem)) && !deferJetBurnToStepEnd(w, w.player)) {
      ctx.emitVisual('explosion', w.player.x, w.player.y);
      killPlayer(ctx, 'hud.messages.death_fire', 'burn');
    }
    return;
  }
  // A parked player that burns takes the controlled slot, so the loop reads a copy.
  for (const p of [...playersOf(w)]) {
    const tile = ConfigRegistry.getTile(w.terrain[p.y][p.x]);
    if (p.alive && tile.hazard === 'fire' && !realFireSpares(w, tile) && (!tile.protectedByItem || !p.boots.has(tile.protectedByItem))) {
      if (deferJetBurnToStepEnd(w, p)) continue;
      ctx.emitVisual('explosion', p.x, p.y);
      killPlayerAt(ctx, p, 'hud.messages.death_fire', 'burn');
      return;
    }
  }
}

/**
 * Triggers the clone machine at (cx, cy) once, as a trigger button would: the template of the first clone link
 * that names this machine, else the entity sitting on the machine. Does nothing when the cell holds no clone
 * machine now. Used by a signal sink. `byWire` marks a wire edge, which searches clockwise for a free way on the CC2 engine
 * (see spawnFromCloner). Returns false when the clone's arrival killed the player.
 */
export function fireClonerAt(ctx: EpoxyContext, cx: number, cy: number, byWire = false, gateRelease?: GateRelease, frameRelease = false): boolean {
  const w = ctx.world;
  if (!ConfigRegistry.getTile(w.terrain[cy]?.[cx]).isCloneMachine) return true;
  const link = w.cloneLinks.find((l) => l.clonerX === cx && l.clonerY === cy);
  // CC2 engine: a linked cloner clones its actual occupant, nothing when empty (Lexy tiletypes.js:1704-1706).
  const fromOccupant = usesCc2Engine(w.level) && !w.cc3dPace;
  if (link !== undefined && !fromOccupant) return spawnFromCloner(ctx, cx, cy, link.templateType, link.templateDir, byWire, gateRelease, frameRelease);
  const template = w.entities.find((e) => e.x === cx && e.y === cy && !isPhasingEntityType(e.type));
  return template === undefined ? true : spawnFromCloner(ctx, cx, cy, template.type, template.dir, byWire, gateRelease, frameRelease);
}

/**
 * CC2 engine: the wire phase a clone machine fed through delayed gates is released in, at a tick end: the Lexy frame `frame` of the
 * wire phase and `total`, the frames from frame 0 of this tic to the end of the clone's out-of-turn 12-frame step (the frame of the
 * phase counted from frame 0 of this tic, 2, 3 or 4, plus PLAIN_CLONE_STEP_END_FRAMES). Only a block clone takes it; a monster clone keeps the untagged path.
 */
export interface GateRelease {
  frame: 0 | 1 | 2;
  total: number;
}

/** CC2 engine: ticks added to the wait of a creature or block cloned before the entity pass of the tick (see spawnFromCloner). */
const CC2_CLONE_BEFORE_PASS_TICKS = 1;

/** CC2 engine: the press frame of a wire edge released at the end of the last tic (after its decisions); its clone ends a tick sooner. */
export const CC2_LATE_RELEASE_FRAME = 2;
/** CC2 engine: the Lexy frame an actor ends its step at when it is the default one (no tag is kept for a clone at it). */
export const CC2_DEFAULT_FRAME = 1;
/** CC2 engine: frames per tic; an out-of-turn step spends one frame at once, so the clone ends at frame p - 1 (game.js:2218-2242). */
const CC2_FRAMES_PER_TIC = 3;
/** CC2 engine: frames from the press to the end of a cloned block's 12-frame plain step (a new actor is not visited again in that frame). */
export const PLAIN_CLONE_STEP_END_FRAMES = 11;
/** CC2 engine: ticks before the first slide step of a block cloned onto a slide. */
const CLONE_SLIDE_TICKS = 2;

/** CC2 engine: gives a clone released at press frame p the frame (p + 2) mod 3 its step ends at, unless that is the default one. */
function tagCloneFrame(clone: RuntimeEntity, releaseFrame: 0 | 1 | 2): void {
  const frame = (releaseFrame + CC2_FRAMES_PER_TIC - 1) % CC2_FRAMES_PER_TIC;
  if (frame === CC2_DEFAULT_FRAME) delete clone.cc2Frame;
  else clone.cc2Frame = frame as 0 | 2;
}

/**
 * Spawns a copy of the template in front of the cloner, using the same
 * entry rules as a regular monster step or block push, so a clone never
 * appears inside a wall or another blocked cell. Returns false when the
 * clone's arrival killed the player, so the caller stops processing.
 */
export function spawnFromCloner(
  ctx: EpoxyContext,
  clonerX: number,
  clonerY: number,
  templateType: string,
  templateDir: Direction,
  byWire = false,
  gateRelease?: GateRelease,
  frameRelease = false
): boolean {
  const w = ctx.world;
  // The press frame of the wire edge that fired this clone is read once and dropped, so a clone made while this one arrives
  // (a nested press) never inherits it.
  const releaseFrame = w.cc2ReleaseFrame;
  delete w.cc2ReleaseFrame;
  if (w.entities.length >= MAX_ACTIVE_ENTITIES) return true;
  // CC2 engine: a clone machine a wire powers tries the template's way, then each next way clockwise (Lexy cloner.activate with
  // aggressive, tiletypes.js:1716-1742); the first way the release takes is the way of the clone and of the new template. A red or
  // gray button tries one way only (tiletypes.js:1745-1748).
  if (byWire && usesCc2Engine(w.level) && !w.cc3dPace) {
    for (let turn = 0; turn < CLONER_WAY_COUNT; turn++) {
      const tryDir = turnClockwise(templateDir, turn);
      if (spawnFromClonerOneWay(ctx, clonerX, clonerY, templateType, tryDir, releaseFrame, true, gateRelease, frameRelease)) return w.player.alive;
      if (!w.player.alive) return false;
    }
    return true;
  }
  return spawnFromClonerOneWay(ctx, clonerX, clonerY, templateType, templateDir, releaseFrame, false, gateRelease, frameRelease);
}

/** CC2 engine: the ways a wire-powered clone machine tries, clockwise from the template's own. */
const CLONER_WAY_COUNT = 4;

/**
 * CC2 engine: a rolling ball template whose release is blocked by an actor, not by terrain, kills that actor and explodes (Lexy
 * rolling_ball.on_blocked, tiletypes.js:3240-3252); the exploded template counts as released (tiletypes.js:1716-1731, "bowling balls that
 * immediately destroy something are also considered to have successfully exited"): a fresh template takes its place on the machine and
 * the release reports success. Blocked by terrain it only stops (a ball being released is spared). Returns whether it did.
 */
function releaseBlownUp(
  ctx: EpoxyContext,
  clonerX: number,
  clonerY: number,
  spawnX: number,
  spawnY: number,
  templateType: string,
  templateDir: Direction,
  probe: RuntimeEntity
): boolean {
  const w = ctx.world;
  const victim = getEntityAt(w, spawnX, spawnY);
  if (victim === undefined || !canMonsterEnter(w, probe, templateDir, true, false, true)) return false;
  const template = w.entities.find((e) => e.x === clonerX && e.y === clonerY && e.type === templateType);
  if (template === undefined) return false;
  removeEntity(w, victim.uid);
  ctx.emitVisual('explosion', victim.x, victim.y);
  leaveBlockSplash(w, victim.x, victim.y, true);
  removeEntity(w, template.uid);
  ctx.emitVisual('explosion', clonerX, clonerY);
  AudioManager.playSfx(BALL_BLAST_SFX);
  const fresh: RuntimeEntity = { uid: w.nextEntityUid++, type: templateType, kind: template.kind, x: clonerX, y: clonerY, dir: templateDir, cooldownTicks: 0, isSliding: false, ...initialEmulationState(ConfigRegistry.getEntityDef(templateType)) };
  w.entities.push(fresh);
  w.beamDirty = true;
  return true;
}

/** Sound of a ball blowing up. */
const BALL_BLAST_SFX = 'bomb';

/** CC2 engine: whether the template of a clone machine is still inside a step (a block waits only while it slides or arrives; a monster, once it has moved). */
function templateIsStepping(template: RuntimeEntity): boolean {
  if (template.arrivalTicks !== undefined) return true;
  if (template.kind === 'monster') {
    // A monster that does not follow the classic cadence starts the level with a wait of one interval (see epoxyLevelStart), which cannot be told
    // from a step run out here: such a template is never refused (gap: Lexy refuses it while its step runs, game.js:2153-2156).
    const def = ConfigRegistry.getEntityDef(template.type);
    const startsReady = def?.movementPattern === ROLLING_BALL_PATTERN || followsCcCadence(template.type, true);
    return startsReady && template.cooldownTicks > 0;
  }
  return template.cooldownTicks > 0 && template.isSliding;
}

/**
 * One release attempt of spawnFromCloner. With `report`, returns whether a clone went out (true) or nothing did (false), so the
 * caller can try the next way; else true unless the player died.
 */
function spawnFromClonerOneWay(
  ctx: EpoxyContext,
  clonerX: number,
  clonerY: number,
  templateType: string,
  templateDir: Direction,
  releaseFrame: 0 | 1 | 2 | undefined,
  report: boolean,
  gateRelease?: GateRelease,
  frameRelease = false
): boolean {
  const w = ctx.world;
  const vec = DIRECTION_VECTORS[templateDir];
  const spawnX = clonerX + vec.dx;
  const spawnY = clonerY + vec.dy;
  if (!isInBounds(w, spawnX, spawnY)) return !report;
  if (playersOf(w).some((p) => p.x === spawnX && p.y === spawnY)) return !report;

  const def = ConfigRegistry.getEntityDef(templateType);
  // A phasing monster is never a clone template (the validator refuses it); a stray link spawns nothing.
  if (def?.movementPattern === PHASE_LINE_PATTERN) return !report;
  const kind = def?.kind || 'block';
  const probe: RuntimeEntity = {
    uid: 0,
    type: templateType,
    kind,
    x: clonerX,
    y: clonerY,
    dir: templateDir,
    cooldownTicks: 0,
    isSliding: false
  };
  // CC2 engine: a cloned block pushes the block standing in the exit out of the way first, by its own pushes table (Lexy
  // tiletypes.js:1716-1731, the template's out-of-turn step; ice_block pushes, dirt does not, :1381-1385).
  const cc2Clone = usesCc2Engine(w.level) && !w.cc3dPace;
  if (cc2Clone && kind === 'block' && !isCanBlockEnter(w, probe, spawnX, spawnY, templateDir)) {
    slidePushesAhead(ctx, probe, spawnX, spawnY, templateDir);
  }
  const canEnter =
    kind === 'block'
      ? isCanBlockEnter(w, probe, spawnX, spawnY, templateDir)
      : canMonsterEnter(w, probe, templateDir);
  if (!canEnter && cc2Clone && def?.movementPattern === ROLLING_BALL_PATTERN && releaseBlownUp(ctx, clonerX, clonerY, spawnX, spawnY, templateType, templateDir, probe)) return w.player.alive;
  if (!canEnter) return !report;

  // A turret or arrow block clone keeps the facing its template has now (turrets turn), else the way it is spawned.
  const template = w.entities.find((e) => e.x === clonerX && e.y === clonerY && e.type === templateType);
  // CC2 engine: a template still inside the step that brought it in cannot step out (Lexy attempt_step returns false while
  // movement_cooldown > 0, game.js:2153-2156): nothing is cloned.
  if (cc2Clone && template !== undefined && templateIsStepping(template)) return !report;
  // CC3D lets the template itself out (a pushed step at the normal pace, keeping its place in the list) and puts a new
  // template on the machine, at the end of the list, which does not act in this tick.
  if (w.cc3dPace && kind === 'monster' && template !== undefined) {
    const seen = w.entityPassSeen.has(template.uid);
    const fresh: RuntimeEntity = { uid: w.nextEntityUid++, type: template.type, kind, x: clonerX, y: clonerY, dir: templateDir, cooldownTicks: 0, isSliding: false, ...(template.facing !== undefined ? { facing: template.facing } : {}), ...initialEmulationState(def) };
    template.x = spawnX;
    template.y = spawnY;
    template.dir = templateDir;
    delete template.restTicks;
    // The step starts now, so what it queues is timed from now; a template that has not had its turn yet in this pass
    // then counts that turn down, which the extra tick makes up for.
    template.cooldownTicks = cc3dReleaseCooldown(w, template);
    addClonedEntity(w, fresh);
    w.entityPassSeen.add(fresh.uid);
    const alive = resolveMonsterArrival(ctx, template, true);
    if (alive && !seen && w.entities.includes(template) && template.cooldownTicks > 0) template.cooldownTicks += 1;
    return alive;
  }
  // CC2 engine: a classic monster let out takes its step time from the cell it enters (the out-of-turn step reads the destination, Lexy
  // game.js:2177-2194): a slide step is a share of the plain one. The adjustments below stack on it.
  const classicClone = w.ccRules && followsCcCadence(templateType, usesCc2Engine(w.level));
  const plainStepTicks = ccStepTicks(templateType) * monsterSlowdown(w);
  const entryStepTicks = classicClone && cc2Clone && kind === 'monster' ? cc2EntryStepTicks(w, probe, spawnX, spawnY) : plainStepTicks;
  let spawned: RuntimeEntity = {
    uid: w.nextEntityUid++,
    type: templateType,
    kind,
    x: spawnX,
    y: spawnY,
    dir: templateDir,
    // In the original the creature let out of a clone machine takes its step out at once, so a classic-rules monster
    // decides again when that step ends; any other entity waits out its interval.
    cooldownTicks: classicClone ? entryStepTicks - 1 : def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
    isSliding: kind === 'block',
    ...(hasEntityFacing(def) ? { facing: template?.facing ?? templateDir } : {}),
    // A cloned rover starts afresh on the first behaviour of its list, whatever the template has reached.
    ...initialEmulationState(def)
  };
  if (cc2Clone && template !== undefined && w.entities.includes(template)) {
    // CC2 engine: the template itself goes out, keeping its uid, its place in the actor list and its ordinal, and a fresh
    // template, at the end of the list with no ordinal, takes its place on the machine (Lexy cloner activate, tiletypes.js:1703-1731;
    // add_actor appends, game.js:3100-3123). The creature let out is never rebuilt from the classic slots on this engine.
    const fresh: RuntimeEntity = {
      uid: spawned.uid,
      type: template.type,
      kind,
      x: clonerX,
      y: clonerY,
      // A wire search leaves the new template facing the way taken (Lexy make_actor(type, direction), tiletypes.js:1731-1733).
      dir: report ? templateDir : template.dir,
      cooldownTicks: 0,
      isSliding: false,
      ...(template.facing !== undefined ? { facing: template.facing } : {}),
      ...initialEmulationState(def)
    };
    template.x = spawned.x;
    template.y = spawned.y;
    template.dir = spawned.dir;
    template.cooldownTicks = spawned.cooldownTicks;
    template.isSliding = spawned.isSliding;
    if (spawned.facing !== undefined) template.facing = spawned.facing;
    else delete template.facing;
    delete template.restTicks;
    // A cloned rover starts afresh on the first behaviour of its list, whatever the template has reached.
    Object.assign(template, initialEmulationState(def));
    w.entities.push(fresh);
    // The template that went out has had (or will not have) its turn for this pass: it acts from the next one.
    // CC2 engine, actor order: the player's turn is part of the pass, so a template fired during it has had its turn too.
    // A clone a frame-0 or frame-1 wire phase releases is in the list before the frame-2 actions of its tic, which count its step down
    // (Lexy game.js:872-889; Boiler t4f1 release, step t8f2; lanes arrball, arrfireball): its template has not had its turn yet. The
    // frame phase runs with the pass view closed, so this test already reads false for it.
    if (w.ccPassOpen || (w.inTick && w.cc2TurnSeen !== undefined)) (w.cc2SkipTurn ??= new Set<number>()).add(template.uid);
    spawned = template;
  } else {
    addClonedEntity(w, spawned);
  }
  // CC2 engine: a creature let out before the entity pass of the tick (a clone press the player's step end made) is counted
  // down by that pass at once. The original runs that creature's step out of turn, ahead of the others, which shortens its
  // step relative to the timing Epoxy gives a clone made during the pass; one tick more makes up for it.
  // A monster clone a frame-0 or frame-1 wire phase releases is released before the frame-2 decisions, as a before-pass press is: its
  // 12-frame step from frame f (f + 11 ends in frame 2 of tic t + 3 or frame 0 of t + 4) lets it decide first at frame 2 of t + 4, one
  // pass more than a release in the pass gives (lanes wororball, woror3ball: first step t9 for a t5 release).
  const beforePass = usesCc2Engine(w.level) && (w.cc2BeforePass === true || (frameRelease && kind === 'monster'));
  // A clone whose step is the slide step is not stretched: 6 frames from press frame p end in frame 0 two tics later, before that tic's
  // decisions, so the tick the 12-frame clone needs does not apply (Lexy game.js:2218-2242; MAP099 ftrace t65f1-t67f2).
  const slideStepClone = entryStepTicks < plainStepTicks;
  if (beforePass && spawned.kind === 'monster' && spawned.cooldownTicks > 0 && !slideStepClone) spawned.cooldownTicks += CC2_CLONE_BEFORE_PASS_TICKS;
  if (spawned.kind === 'block') {
    // CC2 engine: a cloned block takes a real step out of the cloner, unless it comes out onto a sliding tile.
    const takesStep = usesCc2Engine(w.level) && ConfigRegistry.getTile(w.terrain[spawnY][spawnX]).slideType === undefined;
    moveBlockTo(ctx, spawned, spawnX, spawnY, templateDir, true, takesStep);
    // The same for a block: its first wait is counted down by the pass that follows.
    if (beforePass && w.entities.includes(spawned)) spawned.cooldownTicks += CC2_CLONE_BEFORE_PASS_TICKS;
    // The wire phase that released the clone is frame p of the tic; the out-of-turn step spends a frame at once, so a frame-2
    // release ends a tick sooner and the clone carries frame p - 1 for its own press (Lexy game.js:2218-2242, 872-888). A frame-0 or
    // frame-1 phase release has no stamp: its press frame (releaseFrame) below carries the frame.
    if (cc2Clone && gateRelease !== undefined && w.entities.includes(spawned)) {
      // A clone a gate-timed tick-end wire phase releases: its out-of-turn step starts in that phase (no late-release shortening) and
      // ends at the frame total, counted from frame 0 of this tic; the pre-pass still to run is not in the wait (the release is after it).
      tagCloneFrame(spawned, gateRelease.frame);
      if (spawned.arrivalTicks !== undefined) holdFrameArrival(w, spawned, gateRelease.total, false);
      else if (spawned.isSliding) tagSlideFrame(w, spawned, gateRelease.frame, CLONE_SLIDE_TICKS);
      return true;
    }
    if (cc2Clone && releaseFrame !== undefined && w.entities.includes(spawned)) {
      if (releaseFrame === CC2_LATE_RELEASE_FRAME) {
        if (spawned.arrivalTicks !== undefined && spawned.arrivalTicks > 1) spawned.arrivalTicks -= 1;
        else if (spawned.cooldownTicks > 0) spawned.cooldownTicks -= 1;
      }
      tagCloneFrame(spawned, releaseFrame);
    }
    // A block cloned onto ice or a force floor by a press of frame p takes its out-of-turn 6-frame step then and slides in frame p
    // two ticks later; onto a plain cell by a press of frame 0 or 1, its 12-frame step ends at p + 11 (p + 10, and a slide frame one sooner, for a template listed before the pressing player: below) (game.js:2218-2242).
    const pressFrame = releaseFrame ?? (w.cc2BeforePass === true ? CC2_DEFAULT_FRAME : CC2_LATE_RELEASE_FRAME);
    // A template listed before the pressing player (later in the reverse loop) also takes its own cooldown in the press frame,
    // one frame more than the out-of-turn step's extra cooldown (Lexy attempt_out_of_turn_step + do_actor_cooldown, steam-strict allows
    // the double cooldown): its next step is one frame sooner.
    const pressOrdinal = w.cc2PressOrdinal;
    const later = pressFrame === CC2_DEFAULT_FRAME && pressOrdinal !== undefined && spawned.listOrdinal !== undefined && spawned.listOrdinal < pressOrdinal ? 1 : 0;
    if (cc2Clone && w.entities.includes(spawned) && spawned.arrivalTicks !== undefined && pressFrame !== CC2_LATE_RELEASE_FRAME) {
      holdFrameArrival(w, spawned, pressFrame + PLAIN_CLONE_STEP_END_FRAMES - later);
    } else if (cc2Clone && w.entities.includes(spawned) && spawned.isSliding) {
      tagSlideFrame(w, spawned, (pressFrame - later) as 0 | 1 | 2, CLONE_SLIDE_TICKS);
    }
  } else {
    // The same out-of-turn rule for a monster clone, before it resolves its arrival.
    if (cc2Clone && releaseFrame !== undefined) {
      if (releaseFrame === CC2_LATE_RELEASE_FRAME && spawned.cooldownTicks > 0) spawned.cooldownTicks -= 1;
      tagCloneFrame(spawned, releaseFrame);
    }
    return resolveMonsterArrival(ctx, spawned, true, true);
  }
  return true;
}
