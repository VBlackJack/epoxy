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
import type { TerrainTileLookup } from '../../config/ConfigValidation';
import type { ChannelColor, SignalLink, SignalNodeDef, SignalPulseState, SignalSpec, TileDefinition } from '../types';
import {
  BUTTON_ORANGE_CC2_TILE_ID,
  DYNAMITE_FIRE_TILE_ID,
  FLAME_JET_CC2_OFF_TILE_ID,
  FLAME_JET_CC2_ON_TILE_ID,
  FLOOR_TILE_ID,
  LIGHTNING_BOLT_ITEM_ID,
  SIGNAL_PLATE_TILE_ID
} from '../coreConstants';
import { usesCc2Engine } from './ccRules';
import { CC2_DEFAULT_FRAME, CC2_LATE_RELEASE_FRAME, PLAIN_CLONE_STEP_END_FRAMES, fireClonerAt, flipCellAt, flipWiredCellAt, type GateRelease } from './epoxyDevices';
import { refreshBeams } from './epoxyLasers';
import { fireLauncherAt } from './epoxyShots';
import { EpoxyContext, EpoxyWorld, closeOpenTrapAt, entityPressesPlate, mapWidth, playerAtCell } from './epoxyWorld';
import {
  DELAYED_GATE_KINDS,
  SettleResult,
  SignalEdge,
  SignalNetwork,
  SignalNodeKind,
  SignalState,
  buildSignalNetwork,
  cloneSignalState,
  createSignalState,
  settleSignals
} from './signalNetwork';

/** A level's signal network with its state and what the engine needs to feed and read it. */
export interface SignalRuntime {
  network: SignalNetwork;
  state: SignalState;
  /** What each node of the network is wired to, by node index; only sources and sinks have an entry. */
  defs: ReadonlyMap<number, SignalNodeDef>;
  /** Edges seen since the level loaded. A diagnostic only: not snapshotted, not hashed. */
  edgeCounts: { rising: number; falling: number };
  /** Cell indexes of the pulse buttons of the network. Static for the level. */
  pulseCells: ReadonlySet<number>;
  /** Pulse buttons that saw an arrival since the last settle. The settle reads it and clears it. */
  pending: Set<number>;
  /** Pulse buttons holding a press for the next settle (the one-bit carry: never a counter). */
  carry: Set<number>;
  /** Cell indexes of the toggle switches of the network. Static for the level. */
  toggleCells: ReadonlySet<number>;
  /** Level sinks a gray area button pulsed since the last settle. The settle moves them to `lit` and clears this. */
  areaPending: Set<number>;
  /** Level sinks a gray area button holds on for the current settle only: the next settle replaces the set. */
  lit: Set<number>;
}

/** The fields of a sink def that name what the sink is. A sink has exactly one of them set. */
const SINK_KIND_FIELDS = ['color', 'fires', 'powers'] as const;

/** Thrown when a source has no sampler or a sink does not have exactly one kind (a colour, a device to fire or a relay pad to power): a level no validator would have let through. */
export class SignalWiringError extends Error {
  constructor(readonly cell: number) {
    super(`signal wiring: node at cell ${cell} lacks its sampler or has not exactly one sink kind`);
    this.name = 'SignalWiringError';
  }
}

/** Looks a tile up in the registry, the way the engine reads the terrain; the registry answers floor for an unknown id. */
export const registryTileLookup: TerrainTileLookup = (id) => ConfigRegistry.getTile(id);

/** Builds the runtime of a level's signal network; everything starts off. */
export function createSignalRuntime(spec: SignalSpec, cc2Engine: boolean = false): SignalRuntime {
  // Only a CC2-engine network delays its gates (and lets an OR or NOT read its own output); a native or .DAT network settles as before.
  const network = buildSignalNetwork(spec.nodes, spec.links, { gateDelay: cc2Engine });
  const defs = new Map<number, SignalNodeDef>();
  for (const def of spec.nodes) {
    const index = network.indexOfCell.get(def.cell) as number;
    if (def.kind === 'source') {
      if (def.sample === undefined) throw new SignalWiringError(def.cell);
      defs.set(index, def);
    } else if (def.kind === 'sink') {
      if (SINK_KIND_FIELDS.filter((field) => def[field] !== undefined).length !== 1) throw new SignalWiringError(def.cell);
      defs.set(index, def);
    }
  }
  const pulseCells = new Set<number>();
  const toggleCells = new Set<number>();
  for (const index of network.sourceIndexes) {
    const sample = defs.get(index)?.sample;
    if (sample === 'pulse') pulseCells.add(network.nodes[index].cell);
    else if (sample === 'toggle') toggleCells.add(network.nodes[index].cell);
  }
  return {
    network,
    state: createSignalState(network),
    defs,
    edgeCounts: { rising: 0, falling: 0 },
    pulseCells,
    pending: new Set<number>(),
    carry: new Set<number>(),
    toggleCells,
    areaPending: new Set<number>(),
    lit: new Set<number>()
  };
}

/** Tile id of the pink button: the only held source CC2 reads from an actor at rest (Lexy button_pink is_emitting). */
const PINK_BUTTON_TILE_ID = SIGNAL_PLATE_TILE_ID;
/** The button action of a brown button (it holds a trap open while pressed). */
const BROWN_BUTTON_ACTION = 'hold_trap';
/** The signal source kind of a button that an actor holds down by standing on it (the orange and pink ones). */
const HELD_SIGNAL_SOURCE = 'held';

/** True for a tile an actor holds down by standing on it: a held signal source (orange, pink) or a brown trap button. */
export function isHeldSignalButton(tile: TileDefinition): boolean {
  return tile.signalSource === HELD_SIGNAL_SOURCE || tile.buttonAction === BROWN_BUTTON_ACTION;
}

/**
 * Whether a non-player actor on a pink or orange button or under a rolling ball counts, CC2 engine: Lexy reads the actor on the
 * cell only while its movement cooldown is 0. A block counts while it is not mid step, a monster or other mover while its cooldown is out.
 */
export function actorAtRest(e: EpoxyWorld['entities'][number]): boolean {
  return e.arrivalTicks === undefined && !e.isSliding && (e.kind === 'block' || e.cooldownTicks === 0);
}

/**
 * Whether a held source's cell is occupied the way a pressure plate asks: the player standing there, or a
 * monster or block that is not sliding and presses plates. A coloured block counts, as on a plate of its colour.
 * On a CC2 level the pink and the orange button read only an actor at rest: the player once he has settled (the settle right after his own
 * move, the move phase, finds his step only begun), a block or monster once its step is over.
 */
function cellOccupied(w: EpoxyWorld, x: number, y: number, phase: SignalPhase): boolean {
  const occupied = actorsOccupyCell(w, x, y, phase);
  // CC2 engine: a button an actor was removed from in place with no departure (a rolling ball that blew up on it) reads
  // the opposite of what stands on it, for good: an exclusive or with the toggled set (Lexy add_press without remove_press).
  if (!usesCc2Engine(w.level) || w.cc2ToggledButtonCells.length === 0) return occupied;
  return occupied !== w.cc2ToggledButtonCells.includes(y * mapWidth(w) + x);
}

/**
 * What actually stands on the cell, before the toggled set of a CC2 level is applied (see cellOccupied). On a CC2 level (not
 * cc3dPace) the pink and the orange button read an actor at rest only.
 */
function actorsOccupyCell(w: EpoxyWorld, x: number, y: number, phase: SignalPhase): boolean {
  // CC2 engine: the orange button works on arrival and departure (Lexy button_orange on_arrive / on_depart: toggled at the end of
  // the arriving step, and at the start of the leaving one, tiletypes.js:2332-2341, game.js:2350-2357, 2257-2273), so it reads an
  // actor at rest, as the pink button does.
  const anyActor = ConfigRegistry.getTile(w.terrain[y][x]).pressedByAnyActor === true;
  const atRestOnly = usesCc2Engine(w.level) && (w.terrain[y][x] === PINK_BUTTON_TILE_ID || (anyActor && !w.cc3dPace));
  const player = playerAtCell(w, x, y);
  if (player !== undefined && (!atRestOnly || (player.moveCooldown === 0 && phase !== SIGNAL_PHASE_MOVE))) return true;
  return w.entities.some((e) => {
    if (e.x !== x || e.y !== y) return false;
    // CC3D: a mob still taking its step presses nothing (Cc3dDevices isPressed asks for remaining 0).
    if (e.arrivalTicks !== undefined) return false;
    if (atRestOnly && !actorAtRest(e)) return false;
    if (anyActor) return true;
    // CC2 engine: the pink button reads any actor at rest, a fireball or a glider included (Lexy button_pink is_emitting).
    if (atRestOnly) return true;
    if (e.isSliding) return false;
    const ownColor: ChannelColor = ConfigRegistry.getEntityDef(e.type)?.plateColor ?? 'red';
    return entityPressesPlate(e.type, e.kind, ownColor);
  });
}

/**
 * The level of a pulse button at this settle. An arrival (or a carried press) makes it on for exactly this settle.
 * If it was on at the last settle it cannot rise again, so it outputs off now and keeps the press as the carry:
 * on at the next settle. The carry is one bit, so a constant stream of arrivals gives half the rate, never a
 * count. An arrival that lands on a settle already consumed by the carry becomes the new carry.
 */
function samplePulse(runtime: SignalRuntime, index: number, cell: number, prime: boolean): boolean {
  if (prime) return false;
  const arrival = runtime.pending.has(cell);
  const carried = runtime.carry.has(cell);
  if (!arrival && !carried) return false;
  if (runtime.state.lastOutputs[index]) {
    runtime.carry.add(cell);
    return false;
  }
  if (arrival && carried) runtime.carry.add(cell);
  else runtime.carry.delete(cell);
  return true;
}

/**
 * Whether the player stands on the cell holding the lightning bolt. On a CC2-engine level the bolt powers the wire under him
 * only while he stands still: with a move cooldown running, or in the settle right after his own move, he powers nothing
 * (Lexy do_wire_phase: movement_cooldown 0).
 */
function chargedCellOccupied(w: EpoxyWorld, x: number, y: number, phase: SignalPhase): boolean {
  const here = playerAtCell(w, x, y);
  if (here !== undefined && usesCc2Engine(w.level) && (here.moveCooldown !== 0 || phase === SIGNAL_PHASE_MOVE)) return false;
  if (here !== undefined && here.boots.has(LIGHTNING_BOLT_ITEM_ID)) return true;
  // CC2 engine: any actor standing still and holding the lightning bolt powers the wire under it (Lexy do_wire_phase,
  // game.js:2632-2643: every actor with movement_cooldown 0 and the charged trait from its toolbelt), a monster or a
  // rolling ball that picked the bolt up included. The update runs at the end of the tic, so a step that ended in this very pass already
  // counts as at rest (cooldown 0): unlike restsOnButton, whose press convention is read by the actors of the next pass.
  return usesCc2Engine(w.level) && !w.cc3dPace &&
    w.entities.some((e) => e.x === x && e.y === y && e.heldTools?.includes(LIGHTNING_BOLT_ITEM_ID) === true && actorAtRest(e));
}

/**
 * True when a blast turned the source terrain of the cell into plain floor or fire. Only a level that places dynamite
 * can see it, so other levels sample as they always did.
 */
function sourceBlastedAway(w: EpoxyWorld, x: number, y: number): boolean {
  if (!w.hasDynamite) return false;
  const now = w.terrain[y][x];
  const first = w.level.terrain[y][x];
  return (now === FLOOR_TILE_ID || now === DYNAMITE_FIRE_TILE_ID) && first !== FLOOR_TILE_ID && first !== DYNAMITE_FIRE_TILE_ID;
}

/** Samples every source of the network, by cell index. A receiver reads litReceiverCells, so the beams must be fresh. */
function sampleSources(w: EpoxyWorld, runtime: SignalRuntime, prime: boolean, phase: SignalPhase, pure = false): Map<number, boolean> {
  const width = mapWidth(w);
  const lit = new Set(w.litReceiverCells.map((cell) => cell.y * width + cell.x));
  const levels = new Map<number, boolean>();
  for (const index of runtime.network.sourceIndexes) {
    const { cell } = runtime.network.nodes[index];
    const x = cell % width;
    const y = Math.floor(cell / width);
    const def = runtime.defs.get(index) as SignalNodeDef;
    // A source terrain that dynamite blasted away feeds nothing any more.
    if (sourceBlastedAway(w, x, y)) levels.set(cell, false);
    // A pure sample (the frame-start one) reads a pulse source at its last level: it must not consume the pending press.
    else if (def.sample === 'pulse') levels.set(cell, pure ? runtime.state.lastOutputs[index] === true : samplePulse(runtime, index, cell, prime));
    else if (def.sample === 'receiver') levels.set(cell, lit.has(cell));
    // A black button is powered unless something presses it.
    else if (def.sample === 'inverted') levels.set(cell, !cellOccupied(w, x, y, phase));
    // A toggle switch is powered while its terrain is the powered form; the arrivals flipped the terrain already.
    else if (def.sample === 'toggle') levels.set(cell, ConfigRegistry.getTile(w.terrain[y][x]).signalToggleOn === true);
    // A wire floor is powered while the player stands on it holding the lightning bolt: the whole wire net it feeds is on.
    // CC2 engine: in the settle right after the player's own move the bolt source keeps its last level, since Lexy's
    // monsters decide before the wire phase and see a power drop (or rise) caused by that move only afterwards.
    else if (def.sample === 'charged' && phase === SIGNAL_PHASE_MOVE && usesCc2Engine(w.level)) levels.set(cell, runtime.state.lastOutputs[index] === true);
    else if (def.sample === 'charged') levels.set(cell, chargedCellOccupied(w, x, y, phase));
    else levels.set(cell, cellOccupied(w, x, y, phase));
  }
  return levels;
}

/** Tile ids of the buttons whose link to a sink is no Lexy circuit: CC2 hands an orange button its flame jet by position, not by wire. */
const BUTTON_LINK_SOURCE_TILE_IDS: ReadonlySet<string> = new Set([BUTTON_ORANGE_CC2_TILE_ID]);
/** Tile ids of the CC2 wired flame jet: a wire lights it on a rising edge only, an orange button toggles it both ways. */
const CC2_WIRED_FLAME_JET_TILE_IDS: ReadonlySet<string> = new Set([FLAME_JET_CC2_OFF_TILE_ID, FLAME_JET_CC2_ON_TILE_ID]);

/**
 * Whether a sink is fed by a button link: a link into its cell whose source is a button CC2 links by position instead of
 * by wire (the orange button and its flame jet). Lexy builds no circuit for such a link, so the sink has no wire edge to
 * start from. The one decision shared by the load prime and the flame jet edge rule.
 */
function isButtonLinkedSink(w: EpoxyWorld, runtime: SignalRuntime, sinkCell: number): boolean {
  const width = mapWidth(w);
  return runtime.network.links.some((link) => {
    if (link.to !== sinkCell) return false;
    const row = w.terrain[Math.floor(link.from / width)];
    return row !== undefined && BUTTON_LINK_SOURCE_TILE_IDS.has(row[link.from % width]);
  });
}

/**
 * Records every wired sink as off, except a sink fed by a button link and a wired trap. Lexy starts every circuit off
 * (recalculate_circuitry), so a sink whose wire is on at load rises on the first settle: a cloner or launcher fires on tick 0,
 * a door or a flame jet follows. A wired trap whose wire is on at load is open from the start (no edge fires for a trap), so
 * it keeps the primed state. Only a settle's own edge check and the display of a powered cell read a sink's stored output (no
 * link leaves a sink, see normalizeSignalLinks), so this changes nothing but the first edge. Gates keep the primed state.
 */
function startWiredSinksOff(w: EpoxyWorld, runtime: SignalRuntime): void {
  for (const index of runtime.network.sinkIndexes) {
    const cell = runtime.network.nodes[index].cell;
    // A wired trap whose wire is on at load is open from the start: its monster may leave in tick 0 (no edge fires for a trap).
    if (ConfigRegistry.getTile(w.terrain[Math.floor(cell / mapWidth(w))][cell % mapWidth(w)]).wiredTrap === true) continue;
    if (!isButtonLinkedSink(w, runtime, cell)) runtime.state.lastOutputs[index] = false;
  }
}

/** The phase a signal settle or sink fire runs in: right after the player's move, or at the end of a tick. */
export type SignalPhase = 'move' | 'tick';
/** Phase of the settle that follows the player's move. */
export const SIGNAL_PHASE_MOVE: SignalPhase = 'move';
/** Phase of the settle at the end of a tick (the default). */
export const SIGNAL_PHASE_TICK: SignalPhase = 'tick';

/**
 * The Lexy wire phases a settle stands for on a gate-delay network, which is how often the delayed gates step in it. 'hold' stands for
 * none: the gates keep their outputs. 'tickEnd' is the three phases from the frame-2 one of this tic to the frame-1 one of the next
 * (game.js:872-889); 'tic0' the early phases (f0, f1) before the first decisions, both gate steps, the first from all-off wires (see
 * TIC0_SUB_SETTLES); 'prePass0' and 'prePass1' the phases a block
 * arrival of frame 0 or frame 1 of the pre-pass reaches before the decisions.
 */
export type GateSettle = 'hold' | 'tickEnd' | 'tic0' | 'prePass0' | 'prePass1' | 'frame2' | 'frame0' | 'frame1';
export const GATE_SETTLE_HOLD: GateSettle = 'hold';
export const GATE_SETTLE_TICK_END: GateSettle = 'tickEnd';
export const GATE_SETTLE_TIC0: GateSettle = 'tic0';
export const GATE_SETTLE_PRE_PASS0: GateSettle = 'prePass0';
export const GATE_SETTLE_PRE_PASS1: GateSettle = 'prePass1';
/**
 * The three Lexy wire phases of a tic, one settle each (game.js:872-889: every frame is decision, action, wire), on a gate-delay network
 * under the frame model: 'frame2' is the tick-end settle (one gate step), 'frame0' and 'frame1' run after the pre-pass frames 0 and 1
 * of the next tic (runFrameWirePhase). While a frame phase is due no other settle lets a source in (see settleWorldSignals).
 */
export const GATE_SETTLE_FRAME2: GateSettle = 'frame2';
export const GATE_SETTLE_FRAME0: GateSettle = 'frame0';
export const GATE_SETTLE_FRAME1: GateSettle = 'frame1';
/** Gate sub-settles of the tick-end settle (see GateSettle). */
const TICK_END_SUB_SETTLES = 3;
/**
 * Gate sub-settles of the tic-0 settle. The oracle runs the emulate_60fps loop (compat.emulate_60fps, game.js:839-843, then
 * _advance_tic_lynx60, game.js:872-889): the first decision of a non-forced move is at frame 2, after the wire phases f0 and f1. The
 * wires start all off (game.js:602, 728) and every gate reads the powered edges of the last wire phase, so f0 is a gate step too: it runs
 * from all-off wires (a NOT emits, a source feeds no delayed gate yet; the first sub-settle reads the off copy, see allOffState), and f1 is the
 * step on the sources. Two gate steps before the first decision: a NOT whose plate is held at load is on in f0, so its clone machine fires
 * before f1 reads the plate and drops it (Lexy lanes notheld / notempty), a counter fed by a plate held at load counts one after tic 0 (cntheld,
 * cntnot): Lexy counts it in f1, Epoxy's undelayed counter counts it in the f0 sub-settle against the all-off copy, the value is the same. A chain of two gates fed by plates held at load has not opened its door at the first decision (Lexy lane, wave 17 review).
 */
const TIC0_SUB_SETTLES = 2;
/** The 1-based tic-0 sub-settle (f0) that reads the all-off wires. */
const TIC0_ALL_OFF_SUB_SETTLE = 1;
/** Lexy frame of the wire phase of each tick-end gate sub-settle: the frame-2 one of this tic, then the frame-0 and frame-1 ones of the next. */
const TICK_END_SUB_FRAMES: readonly (0 | 1 | 2)[] = [2, 0, 1];
/**
 * Frames from frame 0 of this tic to the end of the 12-frame out-of-turn step of a clone released in the first tick-end wire phase (frame 2,
 * then 11 more frames, game.js:2218-2242); each later sub-settle is one frame later.
 */
const TICK_END_FIRST_RELEASE_TOTAL = CC2_LATE_RELEASE_FRAME + PLAIN_CLONE_STEP_END_FRAMES;
/** Gate sub-settles after a frame-0 arrival of the pre-pass: it reaches the f0 and the f1 wire phase. */
const PRE_PASS0_SUB_SETTLES = 2;
/** Gate sub-settles after a frame-1 arrival of the pre-pass: it reaches the f1 wire phase only. */
const PRE_PASS1_SUB_SETTLES = 1;

/**
 * The source levels each gate sub-settle of a settle reads. At the tick end a source an actor vacated in the pass (a departure, a
 * Lexy frame-2 action) reaches the wires in the first sub-settle, any other new level in the last (an arrival is a frame-1 event of
 * the next tic); the other settles read the sampled levels. Undefined for a settle that holds the gates.
 */
function gateSubSettleLevels(
  w: EpoxyWorld,
  runtime: SignalRuntime,
  settle: GateSettle,
  sampled: ReadonlyMap<number, boolean>,
  frameStart: ReadonlyMap<number, boolean> | undefined
): ReadonlyMap<number, boolean>[] | undefined {
  if (settle === GATE_SETTLE_HOLD) return undefined;
  if (settle === GATE_SETTLE_TIC0) return Array.from({ length: TIC0_SUB_SETTLES }, () => sampled);
  if (settle === GATE_SETTLE_PRE_PASS0) return Array.from({ length: PRE_PASS0_SUB_SETTLES }, () => sampled);
  if (settle === GATE_SETTLE_PRE_PASS1) return Array.from({ length: PRE_PASS1_SUB_SETTLES }, () => sampled);
  const network = runtime.network;
  if (settle === GATE_SETTLE_FRAME1) {
    // Every source reaches the wires in the frame-1 phase, except a toggle switch: a Lexy light switch emits its new level from the second
    // wire phase after the step that flipped it (light_switch on_arrive / update_power_emission, is_first_frame), so only a switch the
    // pre-pass frame 0 flipped (`frameStart` is then the sample after frame 0) enters now; a frame-1 flip enters at frame 2 (lanes
    // lswitch_blk, lswitch_ply; wire oracle).
    const f1 = new Map<number, boolean>(sampled);
    for (const i of network.sourceIndexes) {
      if (runtime.defs.get(i)?.sample !== 'toggle') continue;
      const cell = network.nodes[i].cell;
      const was = runtime.state.lastOutputs[i] === true;
      const afterFrame0 = frameStart?.get(cell);
      f1.set(cell, afterFrame0 !== undefined && afterFrame0 !== was ? afterFrame0 : was);
    }
    return [f1];
  }
  if (settle === GATE_SETTLE_FRAME0) {
    // The frame-0 phase reads what the pre-pass frame 0 changed (the level differs from the sample taken before that frame; no sample:
    // nothing moved) and an arrival whose step ends in frame 0 (a clone's cc2Frame); any other new level waits for the frame-1 phase.
    const f0 = new Map<number, boolean>();
    for (const i of network.sourceIndexes) {
      const cell = network.nodes[i].cell;
      const now = sampled.get(cell) === true;
      const before = frameStart === undefined ? now : frameStart.get(cell) === true;
      const was = runtime.state.lastOutputs[i] === true;
      const frameEvent = now !== was && arrivalFrameAt(w, cell) === 0;
      const toggle = runtime.defs.get(i)?.sample === 'toggle';
      f0.set(cell, (now !== before || frameEvent) && !toggle ? now : was);
    }
    return [f0];
  }
  const early = new Map<number, boolean>();
  const width = mapWidth(w);
  for (const i of network.sourceIndexes) {
    const cell = network.nodes[i].cell;
    const was = runtime.state.lastOutputs[i] === true;
    const now = sampled.get(cell) === true;
    const sample = runtime.defs.get(i)?.sample;
    const vacated = was !== now && (sample === 'inverted' ? now : sample === 'held' || sample === 'charged' ? !now : false);
    // The frame-2 phase also lets in an arrival whose step ends in frame 2 (a clone's cc2Frame) and a toggle switch.
    // An orange button acts on its flame jet in the action phase of the step that leaves it (Lexy button_orange on_depart, no circuit):
    // a change of its level with nothing left on it is a departure, a frame-2 event (an arrival keeps the frame-1 timing).
    const bx = cell % width;
    const by = Math.floor(cell / width);
    const departed = was !== now && BUTTON_LINK_SOURCE_TILE_IDS.has(w.terrain[by]?.[bx] ?? '') &&
      playerAtCell(w, bx, by) === undefined && !w.entities.some((e) => e.x === bx && e.y === by);
    const frame2 = settle === GATE_SETTLE_FRAME2 && ((was !== now && arrivalFrameAt(w, cell) === 2) || sample === 'toggle' || departed);
    early.set(cell, vacated || frame2 ? now : was);
  }
  if (settle === GATE_SETTLE_FRAME2) return [early];
  return [...Array.from({ length: TICK_END_SUB_SETTLES - 1 }, () => early), sampled];
}

/** The earliest end frame (cc2Frame, absent = 1) of the actors at rest on a cell, undefined when none stands there. */
function arrivalFrameAt(w: EpoxyWorld, cell: number): 0 | 1 | 2 | undefined {
  const width = mapWidth(w);
  const x = cell % width;
  const y = Math.floor(cell / width);
  let best: 0 | 1 | 2 | undefined;
  for (const e of w.entities) {
    if (e.x !== x || e.y !== y || !actorAtRest(e)) continue;
    const frame = e.cc2Frame ?? CC2_DEFAULT_FRAME;
    if (best === undefined || PRESS_FRAME_RANK[frame] < PRESS_FRAME_RANK[best]) best = frame;
  }
  return best;
}

/**
 * The source levels as they stand before the pre-pass frame 0 moves anything, for the frame-0 phase (see gateSubSettleLevels). Pure:
 * a pulse source reads its last level and no pending press is consumed. Undefined without signals.
 */
export function sampleFrameStart(w: EpoxyWorld): ReadonlyMap<number, boolean> | undefined {
  const runtime = w.signals;
  if (runtime === undefined) return undefined;
  refreshBeams(w);
  return sampleSources(w, runtime, false, SIGNAL_PHASE_TICK, true);
}

/** The memory gates whose output also reads off in the all-off phase of tic 0. */
const ALL_OFF_STATE_KINDS: ReadonlySet<SignalNodeKind> = new Set<SignalNodeKind>(['latch', 'dlatch', 'counter']);

/**
 * A copy of `state` with every wire as it is at level load in Lexy (game.js:602, 728): the output of every source, delayed gate, latch,
 * data latch and counter reads off. The sinks keep their own level (the edge compares against it) and the counters keep their
 * underflow output (the held output a counter at zero gives is not a wire phase's).
 */
function allOffState(network: SignalNetwork, state: SignalState): SignalState {
  const off = cloneSignalState(state);
  network.nodes.forEach((node, index) => {
    if (node.kind === 'source' || DELAYED_GATE_KINDS.has(node.kind) || ALL_OFF_STATE_KINDS.has(node.kind)) off.lastOutputs[index] = false;
  });
  return off;
}

/**
 * Settles the level's signal network from the world as it is now and keeps the new state. Does nothing on a
 * level without signals. The beams are refreshed first (a trace only when something moved), so a receiver
 * source never reads the trace of the pass before. With `prime` (level load) it only records, no edge. Settle before the hold doors are set, so a door follows
 * the signals of the same pass. Returns the edges of the sinks. Clears the pending arrivals of the pulse buttons
 * right after sampling, before the caller fires the sinks.
 *
 * Gate-delay network (CC2 engine): `gates` says which Lexy wire phases the settle stands for (see GateSettle). The delayed gates step
 * once per phase, each sub-settle reading the levels of its phase; the edges of every sub-settle are returned in order (a sink may
 * rise and fall inside one settle). Any other settle holds the delayed gates. The prime settle (level load) steps no gate phase:
 * the gate outputs are computed once from the gates' own initial (all off) outputs and no edge is reported, as at load every Lexy
 * wire is off (game.js:602, 728); the gate phases before the first decision belong to the tic-0 settle (GATE_SETTLE_TIC0).
 */
export function settleWorldSignals(
  w: EpoxyWorld,
  prime: boolean = false,
  phase: SignalPhase = SIGNAL_PHASE_TICK,
  gates: GateSettle = GATE_SETTLE_HOLD,
  subOf?: Map<SignalEdge, number>,
  frameStart?: ReadonlyMap<number, boolean>
): SignalEdge[] {
  const runtime = w.signals;
  if (runtime === undefined) return [];
  refreshBeams(w);
  // While a frame wire phase is due (cc2WireFrameNext, from the frame-2 settle to the frame-1 one) a settle that is not a frame phase
  // lets no source in: every source keeps its last level, the gates hold. Nothing is sampled, so no pulse press is consumed, and the
  // pending, carried and lit sets are left to the frame phase that reads them.
  if (runtime.network.gateDelay === true && !prime && gates === GATE_SETTLE_HOLD && w.cc2WireFrameNext !== undefined) {
    const kept = new Map<number, boolean>();
    for (const i of runtime.network.sourceIndexes) kept.set(runtime.network.nodes[i].cell, runtime.state.lastOutputs[i] === true);
    const held = settleSignals(runtime.network, runtime.state, kept, false, true);
    runtime.state = held.state;
    for (const edge of held.edges) {
      if (edge.rising) runtime.edgeCounts.rising++;
      else runtime.edgeCounts.falling++;
    }
    return held.edges;
  }
  const sampled = sampleSources(w, runtime, prime, phase);
  // The load prime steps no gate phase (see above); every later settle of a gate-delay network does.
  const stepsGates = runtime.network.gateDelay === true && !prime;
  const subLevels = stepsGates ? gateSubSettleLevels(w, runtime, gates, sampled, frameStart) : undefined;
  let result: SettleResult;
  if (stepsGates) {
    if (subLevels === undefined) result = settleSignals(runtime.network, runtime.state, sampled, false, true);
    else {
      let current = runtime.state;
      const edges: SignalEdge[] = [];
      let last: SettleResult | undefined;
      let sub = 0;
      for (const levels of subLevels) {
        sub++;
        // Tic 0, frame-0 wire phase: it runs from all-off wires, so every source and delayed gate (and latch, data latch, counter) reads off.
        const from = gates === GATE_SETTLE_TIC0 && sub === TIC0_ALL_OFF_SUB_SETTLE ? allOffState(runtime.network, current) : current;
        last = settleSignals(runtime.network, from, levels);
        if (subOf !== undefined) for (const edge of last.edges) subOf.set(edge, sub);
        edges.push(...last.edges);
        current = last.state;
      }
      const done = last as SettleResult;
      result = { state: done.state, sinkOutputs: done.sinkOutputs, edges };
    }
  } else {
    result = settleSignals(runtime.network, runtime.state, sampled, prime);
  }
  runtime.state = result.state;
  // CC2 engine: every wired sink starts off (Lexy recalculate_circuitry), so one whose source is held at load rises on the first
  // settle. A sink fed by a button link keeps the primed state, and gates keep it too.
  if (prime && usesCc2Engine(w.level)) startWiredSinksOff(w, runtime);
  // The arrivals are read: an arrival caused by a sink that fires now lands in the next settle, none lost, none doubled.
  runtime.pending.clear();
  // A gray area button holds its level sinks on for this settle only: the set read now is the next settle's to replace.
  // The frame-0 and frame-1 phases keep the gray-button set of the frame-2 one (one set per tic).
  if (gates !== GATE_SETTLE_FRAME0 && gates !== GATE_SETTLE_FRAME1) {
    runtime.lit = new Set(runtime.areaPending);
    runtime.areaPending.clear();
  }
  for (const edge of result.edges) {
    if (edge.rising) runtime.edgeCounts.rising++;
    else runtime.edgeCounts.falling++;
  }
  return result.edges;
}

/**
 * The links of the world's network as the engine compiled them (normalized, sorted by source then target), by
 * cell coordinates; undefined without signals. Read only: a drawing aid, never hashed or snapshotted.
 */
export function signalLinksOf(w: EpoxyWorld): readonly SignalLink[] | undefined {
  const runtime = w.signals;
  if (runtime === undefined) return undefined;
  const width = mapWidth(w);
  return runtime.network.links.map((link) => ({
    fromX: link.from % width,
    fromY: Math.floor(link.from / width),
    toX: link.to % width,
    toY: Math.floor(link.to / width)
  }));
}

/**
 * The cells of the nodes whose output is on at the last settle, by cell index; undefined without signals.
 * The state arrays follow the evaluation order, so the cell comes from the node at the same position.
 */
export function poweredSignalCellsOf(w: EpoxyWorld): ReadonlySet<number> | undefined {
  const runtime = w.signals;
  if (runtime === undefined) return undefined;
  const powered = new Set<number>();
  runtime.network.nodes.forEach((node, index) => {
    // A counter shows lit while its held underflow output is on, besides its overflow pulse.
    if (runtime.state.lastOutputs[index] || runtime.state.counterUnderflow?.[index] === true || runtime.lit.has(node.cell)) {
      powered.add(node.cell);
    }
  });
  return powered;
}

/**
 * The count each counter gate holds now, by cell index; undefined when the level has no counter. Read only, a drawing
 * aid: the tile shows the live count, not the number it started with.
 */
export function counterValuesOf(w: EpoxyWorld): ReadonlyMap<number, number> | undefined {
  const runtime = w.signals;
  const values = runtime?.state.counterValues;
  if (runtime === undefined || values === undefined) return undefined;
  const counts = new Map<number, number>();
  runtime.network.nodes.forEach((node, index) => {
    if (node.kind === 'counter') counts.set(node.cell, values[index]);
  });
  return counts;
}

/** A copy of the state of the world's network, for a snapshot or a hash; undefined without signals. */
export function copySignalState(w: EpoxyWorld): SignalState | undefined {
  return w.signals === undefined ? undefined : cloneSignalState(w.signals.state);
}

/**
 * Fires the launchers, clone machines and flip tiles whose sink rose at the last settle, in evaluation order: a
 * launcher shoots and a clone machine spawns once, with the rules of a trigger (the per-tick launcher cap, the tile
 * check, the entity cap); a flip tile swaps to its other form. Call it after the settle and the hold doors. Stops as
 * soon as the player is dead or the level is completed. Only a rising edge fires, except a wired flip tile (a purple wall or a
 * wired flame jet), which flips on a falling edge too; on a CC2 level a wired flame jet flips on the rising edge only, unless an
 * orange button works it.
 *
 * Gate-delay network (CC2 engine, tick phase): the phase a gate adds is already in the levels, so a clone machine or launcher fed
 * only through delayed gates is the exception to the deferral below: it fires in the settle where its edge rises (see gateDelayedSink).
 *
 * CC2 engine: a clone machine or launcher fired by a wire acts one wire phase later (Lexy runs the wire phase after the action
 * phase, game.js:822-866, and a cloner acts on power at tiletypes.js:1750). Its rising edge waits in
 * `cc2DeferredSinkEdges`. A sink wired directly to buttons fires before the next entity pass (fireSinksBeforePass); only the
 * edges fed by a gate keep the old timing: one from the move phase fires at the end of the same tick (the next tick phase), one
 * from the tick phase fires at the end of the tick after, as the prototype measured. The edges that waited fire first, then the rest in order.
 * On an actor-order level the edges of the move phase come only from settleBeforeActorPass: the player's turn settles no wire with his move.
 */
export function fireSignalSinks(
  ctx: EpoxyContext,
  edgesNow: readonly SignalEdge[],
  phase: SignalPhase = SIGNAL_PHASE_TICK,
  subOf?: ReadonlyMap<SignalEdge, number>,
  framePhase?: 0 | 1
): void {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined) return;
  let edges = edgesNow;
  if (usesCc2Engine(w.level)) {
    const waiting = w.cc2DeferredSinkEdges;
    const isActionEdge = (edge: SignalEdge): boolean => {
      const index = runtime.network.indexOfCell.get(edge.cell);
      const fires = index === undefined ? undefined : runtime.defs.get(index)?.fires;
      return edge.rising && (fires === 'cloner' || fires === 'launcher');
    };
    // Gate-delay network: the phase a gate adds is in the levels already, so in the tick phase a clone machine or launcher fed through
    // delayed gates only fires in the settle where its edge rises (Lexy frame-2 wire phase). A directly wired one keeps the before-pass
    // deferral, and one behind a latch, a counter or a loop (which the gate delay does not time) keeps the end-of-next-tick deferral.
    const gateTimed = phase === SIGNAL_PHASE_TICK && runtime.network.gateDelay === true;
    // A frame-0 or frame-1 wire phase: the deferred edges join the waiting ones (the press fire of the phase reads them); the others fire
    // now, a gate-timed clone machine released at the frame of the phase, as a frame release (see spawnFromCloner).
    if (framePhase !== undefined) {
      const deferredF = edgesNow.filter((edge) => isActionEdge(edge) && !(gateTimed && !isDirectSink(runtime, edge.cell) && gateDelayedSink(runtime, edge.cell)));
      w.cc2DeferredSinkEdges = [...waiting, ...deferredF];
      // Each edge is a release of frame `framePhase` (cc2ReleaseFrame): the clone carries that press frame (a monster's step ends in
      // frame f - 1, see tagCloneFrame) and a block clone's 12-frame step ends PLAIN_CLONE_STEP_END_FRAMES after it (spawnFromCloner).
      for (const edge of edgesNow.filter((e) => !deferredF.includes(e))) {
        if (!w.player.alive || w.levelCompleted) return;
        w.cc2ReleaseFrame = framePhase;
        try {
          fireEdges(ctx, [edge], undefined, true);
        } finally {
          delete w.cc2ReleaseFrame;
        }
      }
      return;
    }
    const deferred = edgesNow.filter((edge) => isActionEdge(edge) && !(gateTimed && !isDirectSink(runtime, edge.cell) && gateDelayedSink(runtime, edge.cell)));
    const immediate = edgesNow.filter((edge) => !deferred.includes(edge));
    if (phase === SIGNAL_PHASE_TICK) {
      w.cc2DeferredSinkEdges = deferred;
      edges = [...waiting, ...immediate];
      // A tick-end gate release stamps its clone with the frame of its own sub-settle (see tickEndGateRelease); the edges that waited
      // are not from this settle and keep the plain path.
      if (subOf !== undefined && gateTimed) {
        fireEdges(ctx, edges, (edge) => (waiting.includes(edge) ? undefined : tickEndGateRelease(runtime, edge, subOf)));
        return;
      }
    } else {
      w.cc2DeferredSinkEdges = [...waiting, ...deferred];
      edges = immediate;
    }
  }
  fireEdges(ctx, edges);
}

/**
 * The stamp of a rising edge of a clone machine from a tick-end settle: its release frame follows its gate sub-settle s (the frame-2, then
 * frame-0 and frame-1 wire phase: TICK_END_SUB_FRAMES) and its step ends s - 1 frames after the first one's (Lexy lanes or1, oror, oror3).
 * Undefined for a launcher, a falling edge, or an edge no sub-settle produced.
 */
function tickEndGateRelease(runtime: SignalRuntime, edge: SignalEdge, subOf: ReadonlyMap<SignalEdge, number>): GateRelease | undefined {
  const index = runtime.network.indexOfCell.get(edge.cell);
  if (!edge.rising || index === undefined || runtime.defs.get(index)?.fires !== 'cloner') return undefined;
  const sub = subOf.get(edge);
  if (sub === undefined) return undefined;
  return { frame: TICK_END_SUB_FRAMES[sub - 1], total: TICK_END_FIRST_RELEASE_TOTAL + sub - 1 };
}

/**
 * Fires the sinks of `edges` in order, now (no deferral): the shared firing loop of fireSignalSinks and fireSinksBeforePass. `frameRelease`:
 * the edges come from a frame-0 or frame-1 wire phase (see spawnFromCloner).
 */
function fireEdges(
  ctx: EpoxyContext,
  edges: readonly SignalEdge[],
  releaseOf?: (edge: SignalEdge) => GateRelease | undefined,
  frameRelease = false
): void {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined) return;
  const width = mapWidth(w);
  for (const edge of edges) {
    if (!w.player.alive || w.levelCompleted) return;
    const index = runtime.network.indexOfCell.get(edge.cell);
    const fires = index === undefined ? undefined : runtime.defs.get(index)?.fires;
    const x = edge.cell % width;
    const y = Math.floor(edge.cell / width);
    // The first fall of the input of an open trap closes it (for ever: it is a trap from now on).
    if (!edge.rising) closeOpenTrapAt(w, x, y);
    if (fires === undefined) continue;
    // A wired flip tile follows every change of its input; every other sink fires on the rising edge only.
    // CC2 engine: a wired flame jet flips on the rising edge only (Lexy flame_jet on_power); one an orange button works toggles both ways.
    if (!edge.rising && fires === 'flip_edges' && usesCc2Engine(w.level) && CC2_WIRED_FLAME_JET_TILE_IDS.has(w.terrain[y][x]) && !isButtonLinkedSink(w, runtime, edge.cell)) {
      continue;
    }
    if (fires === 'flip_edges') flipWiredCellAt(ctx, x, y);
    else if (!edge.rising) continue;
    else if (fires === 'flip') flipCellAt(w, x, y);
    else if (!(fires === 'launcher' ? fireLauncherAt(ctx, x, y) : fireClonerAt(ctx, x, y, true, releaseOf?.(edge), frameRelease))) return;
  }
}

/**
 * Whether every node behind a sink is a source or a gate the gate delay times (DELAYED_GATE_KINDS), none in a loop, and no source is
 * wired straight into the sink (a mixed upstream keeps the deferral of its direct source). A latch, a data latch or a counter on the
 * way is not delayed, so the deferral still carries its phase.
 */
function gateDelayedSink(runtime: SignalRuntime, cell: number): boolean {
  const net = runtime.network;
  const start = net.indexOfCell.get(cell);
  if (start === undefined) return false;
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (seen.has(i)) continue;
    seen.add(i);
    const node = net.nodes[i];
    if (node.cyclic) return false;
    if (i === start && node.wires.some((wire) => net.nodes[wire.from].kind === 'source')) return false;
    if (i !== start && node.kind !== 'source' && !DELAYED_GATE_KINDS.has(node.kind)) return false;
    for (const wire of node.wires) if (wire.from !== i) stack.push(wire.from);
  }
  return true;
}

/**
 * Rank of a press frame in time between two passes: frame 2 of the last tic first, then frames 0 and 1 (Lexy game.js:2218-2242).
 * Lower is earlier.
 */
const PRESS_FRAME_RANK: readonly number[] = [1, 2, 0];

/**
 * Whether a sink is driven only by buttons through plain wire: every node behind it is a 'source' (no gate, latch, counter,
 * 'or' or cycle on the way). Its edge comes from a press at a step end (Lexy frame 0 or 1), not from a clock of gates.
 * Measured: accepting an 'or' node too changed nothing, so it is left out.
 */
function isDirectSink(runtime: SignalRuntime, cell: number): boolean {
  const net = runtime.network;
  const start = net.indexOfCell.get(cell);
  if (start === undefined) return false;
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (seen.has(i)) continue;
    seen.add(i);
    const node = net.nodes[i];
    if (node.cyclic) return false;
    if (i !== start && node.kind !== 'source') return false;
    for (const wire of node.wires) stack.push(wire.from);
  }
  return true;
}

/**
 * The frame of the press that raised a directly wired sink: the earliest frame among the actors at rest on its sources (a clone
 * carries the frame its out-of-turn step ends in, `cc2Frame`; any other actor ends its step in frame 1).
 */
function pressFrameOfSink(w: EpoxyWorld, runtime: SignalRuntime, cell: number): 0 | 1 | 2 {
  const net = runtime.network;
  const width = mapWidth(w);
  const start = net.indexOfCell.get(cell);
  let best: 0 | 1 | 2 = CC2_DEFAULT_FRAME;
  const seen = new Set<number>();
  const stack = start === undefined ? [] : [start];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (seen.has(i)) continue;
    seen.add(i);
    const node = net.nodes[i];
    if (node.kind === 'source') {
      const x = node.cell % width;
      const y = Math.floor(node.cell / width);
      for (const e of w.entities) {
        if (e.x !== x || e.y !== y || !actorAtRest(e)) continue;
        const frame = e.cc2Frame ?? CC2_DEFAULT_FRAME;
        if (PRESS_FRAME_RANK[frame] < PRESS_FRAME_RANK[best]) best = frame;
      }
    }
    for (const wire of node.wires) stack.push(wire.from);
  }
  return best;
}

/**
 * CC2 engine: fires, before the entity pass, the deferred clone machine and launcher edges of the sinks wired directly to buttons
 * (see isDirectSink). A press at a step end lands in frame 0 or 1 of Lexy, whose wire phase powers them before the decisions of the
 * next pass (game.js:872-876). Each edge fires on its own with w.cc2ReleaseFrame = `forcedFrame` or the frame of its press
 * (pressFrameOfSink), and with w.cc2BeforePass set so the pass counts a clone let out down at once; both are cleared in a
 * finally. The edges of sinks fed by a gate keep waiting (put back in front of the edges deferred meanwhile) and fire at the end of
 * the tick as before. `forcedFrame` is 0 at tic 0. `frameRelease`: the call comes from a frame-0 or frame-1 wire phase (runFrameWirePhase),
 * so a clone it releases is a frame release (see spawnFromCloner). Does nothing off the CC2 engine or under cc3dPace.
 */
export function fireSinksBeforePass(ctx: EpoxyContext, forcedFrame?: 0 | 1 | 2, frameRelease = false): void {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined || !usesCc2Engine(w.level) || w.cc3dPace) return;
  const waiting = w.cc2DeferredSinkEdges;
  if (waiting.length === 0) return;
  w.cc2DeferredSinkEdges = [];
  const direct = waiting.filter((edge) => isDirectSink(runtime, edge.cell));
  w.cc2BeforePass = true;
  try {
    for (const edge of direct) {
      w.cc2ReleaseFrame = forcedFrame ?? pressFrameOfSink(w, runtime, edge.cell);
      try {
        fireEdges(ctx, [edge], undefined, frameRelease);
      } finally {
        delete w.cc2ReleaseFrame;
      }
    }
  } finally {
    w.cc2BeforePass = undefined;
    delete w.cc2ReleaseFrame;
  }
  w.cc2DeferredSinkEdges = [...waiting.filter((edge) => !isDirectSink(runtime, edge.cell)), ...w.cc2DeferredSinkEdges];
}

/** A copy of the pulse memory of the world's network, for a snapshot or a hash; undefined when nothing is pending or carried. */
export function copySignalPulses(w: EpoxyWorld): SignalPulseState | undefined {
  const runtime = w.signals;
  if (
    runtime === undefined ||
    (runtime.pending.size === 0 && runtime.carry.size === 0 && runtime.areaPending.size === 0 && runtime.lit.size === 0)
  ) {
    return undefined;
  }
  const ascending = (cells: ReadonlySet<number>): number[] => [...cells].sort((a, b) => a - b);
  return {
    pending: ascending(runtime.pending),
    carry: ascending(runtime.carry),
    ...(runtime.areaPending.size > 0 ? { area: ascending(runtime.areaPending) } : {}),
    ...(runtime.lit.size > 0 ? { lit: ascending(runtime.lit) } : {})
  };
}

/** Puts a pulse memory back (a snapshot restored); undefined means nothing pending, nothing carried. */
export function restoreSignalPulses(w: EpoxyWorld, pulses: SignalPulseState | undefined): void {
  const runtime = w.signals;
  if (runtime === undefined) return;
  runtime.pending = new Set(pulses?.pending ?? []);
  runtime.carry = new Set(pulses?.carry ?? []);
  runtime.areaPending = new Set(pulses?.area ?? []);
  runtime.lit = new Set(pulses?.lit ?? []);
}

/**
 * CC2 engine: marks the button on the cell (`x`, `y`) as held with no actor on it, in the world set of such buttons (cell indices
 * kept ascending). Called when an actor is removed in place on an orange or brown button with no departure (a rolling ball that
 * blew up there, the actor it killed). An orange button toggles (an exclusive or: a second removal releases it); a brown button
 * counts presses (Lexy add_press without remove_press), so a second removal never releases it. Does nothing on any other level.
 * Returns true when the cell is held afterwards.
 */
export function toggleHeldButton(w: EpoxyWorld, x: number, y: number): boolean {
  if (!usesCc2Engine(w.level)) return false;
  const cell = y * mapWidth(w) + x;
  const held = w.cc2ToggledButtonCells;
  const at = held.indexOf(cell);
  if (at >= 0) {
    if (ConfigRegistry.getTile(w.terrain[y]?.[x]).buttonAction === BROWN_BUTTON_ACTION) return true;
    held.splice(at, 1);
    return false;
  }
  held.push(cell);
  held.sort((a, b) => a - b);
  return true;
}
