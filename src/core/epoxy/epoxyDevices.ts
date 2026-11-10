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
import { AudioManager } from '../../audio/AudioManager';
import {
  BOMB_ITEM_ID,
  CC_CADENCE_TYPES,
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
  STEER_MONSTERS_ACTION,
  channelOfButtonAction
} from '../coreConstants';
import { isPhasingEntityType } from '../RulesetFeatures';
import { ButtonAction, ChannelColor, Direction, RuntimeEntity, TileDefinition } from '../types';
import { hasEntityFacing } from './epoxyArrowBlocks';
import { initialEmulationState } from './epoxyEmulation';
import { isCanBlockEnter, moveBlockTo } from './epoxyBlocks';
import { advanceRailSwitch } from './epoxyRailsCc2';
import { canMonsterEnter, resolveMonsterArrival } from './epoxyMonsters';
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
  removeEntity,
  signalSinkOn,
  killPlayerAt,
  playersOf
} from './epoxyWorld';

/** Hard cap on live entities, so a cloner wired to a held button cannot flood the grid. */
const MAX_ACTIVE_ENTITIES = 512;

/** Sound played when hold doors open or close. */
const HOLD_DOOR_SFX = 'door';

/** Returns false when a clone spawned by the button killed the player. */
export function triggerButton(ctx: EpoxyContext, bx: number, by: number, action: ButtonAction): boolean {
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
    markTanksToTurn(w);
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
 * Classic rules, blue button: every tank off a clone machine and off the ice is marked to turn around a few entity
 * passes later (a second press for the same pass takes the mark off again). Epoxy's own levels turn every tank at once.
 */
function markTanksToTurn(w: EpoxyWorld): void {
  // Inside a tick the clock already counts the pass of the tick; outside it the next pass is still to come.
  const due = w.ccMonsterClock + (w.inTick ? CC_TANK_TURN_DELAY_PASSES - 1 : CC_TANK_TURN_DELAY_PASSES);
  for (const ent of w.entities) {
    if (!ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) continue;
    const tile = ConfigRegistry.getTile(w.terrain[ent.y]?.[ent.x]);
    if (tile.isCloneMachine || tile.slideType === 'ice') continue;
    const turns = ent.tankTurns ?? [];
    const next = turns.includes(due) ? turns.filter((d) => d !== due) : [...turns, due];
    if (next.length > 0) ent.tankTurns = next;
    else delete ent.tankTurns;
  }
}

/**
 * Start of an entity pass of a classic-rules level: the tanks whose marked pass has come turn around, and only those
 * at rest; a tank in the middle of a step ignores the press. Every due mark is spent either way.
 */
export function turnMarkedTanks(w: EpoxyWorld): void {
  const pass = w.ccMonsterClock;
  for (const ent of w.entities) {
    if (ent.tankTurns === undefined) continue;
    const due = ent.tankTurns.filter((d) => d <= pass).length;
    if (due === 0) continue;
    const rest = ent.tankTurns.filter((d) => d > pass);
    if (rest.length > 0) ent.tankTurns = rest;
    else delete ent.tankTurns;
    if (ent.cooldownTicks === 0 && due % 2 === 1) ent.dir = OPPOSITE_DIRECTION[ent.dir];
  }
}

/**
 * Flips one cell to the other form of its tile (a green toggle wall or a rail switch), as a wired signal asks on a rising
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
  const next = ConfigRegistry.getTile(w.terrain[y][x]).togglesTo;
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
  const w = ctx.world;
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
        if (!fireClonerAt(ctx, x, y)) return false;
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
        if (!fireClonerAt(ctx, x, y)) return false;
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
      if (def.meltsInFireTo) {
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

/** A flame jet lit under the player (a monster or block pressed the button) burns them. */
function burnPlayerIfFlamesLit(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (!w.player.alive) return;
  if (w.parked.length === 0) {
    const tile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);
    if (tile.hazard === 'fire' && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem))) {
      ctx.emitVisual('explosion', w.player.x, w.player.y);
      killPlayer(ctx, 'hud.messages.death_fire', 'burn');
    }
    return;
  }
  // A parked player that burns takes the controlled slot, so the loop reads a copy.
  for (const p of [...playersOf(w)]) {
    const tile = ConfigRegistry.getTile(w.terrain[p.y][p.x]);
    if (p.alive && tile.hazard === 'fire' && (!tile.protectedByItem || !p.boots.has(tile.protectedByItem))) {
      ctx.emitVisual('explosion', p.x, p.y);
      killPlayerAt(ctx, p, 'hud.messages.death_fire', 'burn');
      return;
    }
  }
}

/**
 * Triggers the clone machine at (cx, cy) once, as a trigger button would: the template of the first clone link
 * that names this machine, else the entity sitting on the machine. Does nothing when the cell holds no clone
 * machine now. Used by a signal sink. Returns false when the clone's arrival killed the player.
 */
export function fireClonerAt(ctx: EpoxyContext, cx: number, cy: number): boolean {
  const w = ctx.world;
  if (!ConfigRegistry.getTile(w.terrain[cy]?.[cx]).isCloneMachine) return true;
  const link = w.cloneLinks.find((l) => l.clonerX === cx && l.clonerY === cy);
  if (link !== undefined) return spawnFromCloner(ctx, cx, cy, link.templateType, link.templateDir);
  const template = w.entities.find((e) => e.x === cx && e.y === cy && !isPhasingEntityType(e.type));
  return template === undefined ? true : spawnFromCloner(ctx, cx, cy, template.type, template.dir);
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
  templateDir: Direction
): boolean {
  const w = ctx.world;
  if (w.entities.length >= MAX_ACTIVE_ENTITIES) return true;

  const vec = DIRECTION_VECTORS[templateDir];
  const spawnX = clonerX + vec.dx;
  const spawnY = clonerY + vec.dy;
  if (!isInBounds(w, spawnX, spawnY)) return true;
  if (playersOf(w).some((p) => p.x === spawnX && p.y === spawnY)) return true;

  const def = ConfigRegistry.getEntityDef(templateType);
  // A phasing monster is never a clone template (the validator refuses it); a stray link spawns nothing.
  if (def?.movementPattern === PHASE_LINE_PATTERN) return true;
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
  const canEnter =
    kind === 'block'
      ? isCanBlockEnter(w, probe, spawnX, spawnY, templateDir)
      : canMonsterEnter(w, probe, templateDir);
  if (!canEnter) return true;

  // A turret or arrow block clone keeps the facing its template has now (turrets turn), else the way it is spawned.
  const template = w.entities.find((e) => e.x === clonerX && e.y === clonerY && e.type === templateType);
  const spawned: RuntimeEntity = {
    uid: w.nextEntityUid++,
    type: templateType,
    kind,
    x: spawnX,
    y: spawnY,
    dir: templateDir,
    // In the original the creature let out of a clone machine takes its step out at once, so a classic-rules monster
    // decides again when that step ends; any other entity waits out its interval.
    cooldownTicks: w.ccRules && CC_CADENCE_TYPES.includes(templateType) ? ccStepTicks(templateType) * monsterSlowdown(w) - 1 : def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
    isSliding: kind === 'block',
    ...(hasEntityFacing(def) ? { facing: template?.facing ?? templateDir } : {}),
    // A cloned rover starts afresh on the first behaviour of its list, whatever the template has reached.
    ...initialEmulationState(def)
  };
  w.entities.push(spawned);
  if (spawned.kind === 'block') {
    moveBlockTo(ctx, spawned, spawnX, spawnY, templateDir);
  } else {
    return resolveMonsterArrival(ctx, spawned, true);
  }
  return true;
}
