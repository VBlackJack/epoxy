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
import type { ChannelColor, SignalLink, SignalNodeDef, SignalPulseState, SignalSpec } from '../types';
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
import { fireClonerAt, flipCellAt, flipWiredCellAt } from './epoxyDevices';
import { refreshBeams } from './epoxyLasers';
import { fireLauncherAt } from './epoxyShots';
import { EpoxyContext, EpoxyWorld, closeOpenTrapAt, entityPressesPlate, mapWidth, playerAtCell } from './epoxyWorld';
import {
  SignalEdge,
  SignalNetwork,
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
export function createSignalRuntime(spec: SignalSpec): SignalRuntime {
  const network = buildSignalNetwork(spec.nodes, spec.links);
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

/**
 * Whether a non-player actor on a pink button counts, CC2 engine: Lexy reads the actor on the cell only while its movement
 * cooldown is 0. A block counts while it is not mid step, a monster or other mover while its cooldown is out.
 */
function actorAtRest(e: EpoxyWorld['entities'][number]): boolean {
  return e.arrivalTicks === undefined && !e.isSliding && (e.kind === 'block' || e.cooldownTicks === 0);
}

/**
 * Whether a held source's cell is occupied the way a pressure plate asks: the player standing there, or a
 * monster or block that is not sliding and presses plates. A coloured block counts, as on a plate of its colour.
 * On a CC2 level the pink button reads only an actor at rest: the player once he has settled (the settle right after his own
 * move, the move phase, finds his step only begun), a block or monster once its step is over.
 */
function cellOccupied(w: EpoxyWorld, x: number, y: number, phase: SignalPhase): boolean {
  const occupied = actorsOccupyCell(w, x, y, phase);
  // CC2 engine: a button an actor was removed from in place with no departure (a rolling ball that blew up on it) reads
  // the opposite of what stands on it, for good: an exclusive or with the toggled set (Lexy add_press without remove_press).
  if (!usesCc2Engine(w.level) || w.cc2ToggledButtonCells.length === 0) return occupied;
  return occupied !== w.cc2ToggledButtonCells.includes(y * mapWidth(w) + x);
}

/** What actually stands on the cell, before the toggled set of a CC2 level is applied (see cellOccupied). */
function actorsOccupyCell(w: EpoxyWorld, x: number, y: number, phase: SignalPhase): boolean {
  const atRestOnly = usesCc2Engine(w.level) && w.terrain[y][x] === PINK_BUTTON_TILE_ID;
  const player = playerAtCell(w, x, y);
  if (player !== undefined && (!atRestOnly || (player.moveCooldown === 0 && phase !== SIGNAL_PHASE_MOVE))) return true;
  const anyActor = ConfigRegistry.getTile(w.terrain[y][x]).pressedByAnyActor === true;
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

/** Whether the player stands on the cell holding the lightning bolt. */
function chargedCellOccupied(w: EpoxyWorld, x: number, y: number): boolean {
  const here = playerAtCell(w, x, y);
  return here !== undefined && here.boots.has(LIGHTNING_BOLT_ITEM_ID);
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
function sampleSources(w: EpoxyWorld, runtime: SignalRuntime, prime: boolean, phase: SignalPhase): Map<number, boolean> {
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
    else if (def.sample === 'pulse') levels.set(cell, samplePulse(runtime, index, cell, prime));
    else if (def.sample === 'receiver') levels.set(cell, lit.has(cell));
    // A black button is powered unless something presses it.
    else if (def.sample === 'inverted') levels.set(cell, !cellOccupied(w, x, y, phase));
    // A toggle switch is powered while its terrain is the powered form; the arrivals flipped the terrain already.
    else if (def.sample === 'toggle') levels.set(cell, ConfigRegistry.getTile(w.terrain[y][x]).signalToggleOn === true);
    // A wire floor is powered while the player stands on it holding the lightning bolt: the whole wire net it feeds is on.
    else if (def.sample === 'charged') levels.set(cell, chargedCellOccupied(w, x, y));
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
 * Records every wired sink as off, except one fed by a button link. Lexy starts every circuit off (recalculate_circuitry),
 * so a sink whose wire is on at load rises on the first settle: a cloner or launcher fires on tick 0, a door or a flame jet
 * follows. Only a settle's own edge check and the display of a powered cell read a sink's stored output (no link leaves a
 * sink, see normalizeSignalLinks), so this changes nothing but the first edge. Gates keep the primed state.
 */
function startWiredSinksOff(w: EpoxyWorld, runtime: SignalRuntime): void {
  for (const index of runtime.network.sinkIndexes) {
    if (!isButtonLinkedSink(w, runtime, runtime.network.nodes[index].cell)) runtime.state.lastOutputs[index] = false;
  }
}

/** The phase a signal settle or sink fire runs in: right after the player's move, or at the end of a tick. */
export type SignalPhase = 'move' | 'tick';
/** Phase of the settle that follows the player's move. */
export const SIGNAL_PHASE_MOVE: SignalPhase = 'move';
/** Phase of the settle at the end of a tick (the default). */
export const SIGNAL_PHASE_TICK: SignalPhase = 'tick';

/**
 * Settles the level's signal network from the world as it is now and keeps the new state. Does nothing on a
 * level without signals. The beams are refreshed first (a trace only when something moved), so a receiver
 * source never reads the trace of the pass before. With `prime` (level load) it only records, no edge. Settle before the hold doors are set, so a door follows
 * the signals of the same pass. Returns the edges of the sinks. Clears the pending arrivals of the pulse buttons
 * right after sampling, before the caller fires the sinks.
 */
export function settleWorldSignals(w: EpoxyWorld, prime: boolean = false, phase: SignalPhase = SIGNAL_PHASE_TICK): SignalEdge[] {
  const runtime = w.signals;
  if (runtime === undefined) return [];
  refreshBeams(w);
  const result = settleSignals(runtime.network, runtime.state, sampleSources(w, runtime, prime, phase), prime);
  runtime.state = result.state;
  // CC2 engine: every wired sink starts off (Lexy recalculate_circuitry), so one whose source is held at load rises on the first
  // settle. A sink fed by a button link keeps the primed state, and gates keep it too.
  if (prime && usesCc2Engine(w.level)) startWiredSinksOff(w, runtime);
  // The arrivals are read: an arrival caused by a sink that fires now lands in the next settle, none lost, none doubled.
  runtime.pending.clear();
  // A gray area button holds its level sinks on for this settle only: the set read now is the next settle's to replace.
  runtime.lit = new Set(runtime.areaPending);
  runtime.areaPending.clear();
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
 * CC2 engine: a clone machine or launcher fired by a wire acts one wire phase later (Lexy runs the wire phase after the action
 * phase, game.js:822-866, and a cloner acts on power at tiletypes.js:1750). Its rising edge waits in
 * `cc2DeferredSinkEdges`: one from the move phase fires at the end of the same tick (the next tick phase), one from the tick
 * phase fires at the end of the tick after, as the prototype measured. The edges that waited fire first, then the rest in order.
 */
export function fireSignalSinks(ctx: EpoxyContext, edgesNow: readonly SignalEdge[], phase: SignalPhase = SIGNAL_PHASE_TICK): void {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined) return;
  const width = mapWidth(w);
  let edges = edgesNow;
  if (usesCc2Engine(w.level)) {
    const waiting = w.cc2DeferredSinkEdges;
    const isActionEdge = (edge: SignalEdge): boolean => {
      const index = runtime.network.indexOfCell.get(edge.cell);
      const fires = index === undefined ? undefined : runtime.defs.get(index)?.fires;
      return edge.rising && (fires === 'cloner' || fires === 'launcher');
    };
    const deferred = edgesNow.filter(isActionEdge);
    const immediate = edgesNow.filter((edge) => !isActionEdge(edge));
    if (phase === SIGNAL_PHASE_TICK) {
      w.cc2DeferredSinkEdges = deferred;
      edges = [...waiting, ...immediate];
    } else {
      w.cc2DeferredSinkEdges = [...waiting, ...deferred];
      edges = immediate;
    }
  }
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
    else if (!(fires === 'launcher' ? fireLauncherAt(ctx, x, y) : fireClonerAt(ctx, x, y))) return;
  }
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
 * CC2 engine: toggles the button on the cell (`x`, `y`) in the world set of buttons held with no actor on them (an exclusive
 * or: a second toggle releases it). Keeps the cell indices ascending. Called when an actor is removed in place on an orange
 * or brown button with no departure (a rolling ball that blew up there, the actor it killed). Does nothing on any other
 * level. Returns true when the cell is held afterwards.
 */
export function toggleHeldButton(w: EpoxyWorld, x: number, y: number): boolean {
  if (!usesCc2Engine(w.level)) return false;
  const cell = y * mapWidth(w) + x;
  const held = w.cc2ToggledButtonCells;
  const at = held.indexOf(cell);
  if (at >= 0) {
    held.splice(at, 1);
    return false;
  }
  held.push(cell);
  held.sort((a, b) => a - b);
  return true;
}
