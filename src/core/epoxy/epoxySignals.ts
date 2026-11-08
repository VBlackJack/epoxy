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
import { LIGHTNING_BOLT_ITEM_ID } from '../coreConstants';
import { fireClonerAt, flipCellAt, flipWiredCellAt } from './epoxyDevices';
import { refreshBeams } from './epoxyLasers';
import { fireLauncherAt } from './epoxyShots';
import { EpoxyContext, EpoxyWorld, entityPressesPlate, mapWidth } from './epoxyWorld';
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

/**
 * Whether a held source's cell is occupied the way a pressure plate asks: the player standing there, or a
 * monster or block that is not sliding and presses plates. A coloured block counts, as on a plate of its colour.
 */
function cellOccupied(w: EpoxyWorld, x: number, y: number): boolean {
  if (w.player.alive && w.player.x === x && w.player.y === y) return true;
  return w.entities.some((e) => {
    if (e.x !== x || e.y !== y || e.isSliding) return false;
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
  return w.player.alive && w.player.x === x && w.player.y === y && w.player.boots.has(LIGHTNING_BOLT_ITEM_ID);
}

/** Samples every source of the network, by cell index. A receiver reads litReceiverCells, so the beams must be fresh. */
function sampleSources(w: EpoxyWorld, runtime: SignalRuntime, prime: boolean): Map<number, boolean> {
  const width = mapWidth(w);
  const lit = new Set(w.litReceiverCells.map((cell) => cell.y * width + cell.x));
  const levels = new Map<number, boolean>();
  for (const index of runtime.network.sourceIndexes) {
    const { cell } = runtime.network.nodes[index];
    const x = cell % width;
    const y = Math.floor(cell / width);
    const def = runtime.defs.get(index) as SignalNodeDef;
    if (def.sample === 'pulse') levels.set(cell, samplePulse(runtime, index, cell, prime));
    else if (def.sample === 'receiver') levels.set(cell, lit.has(cell));
    // A black button is powered unless something presses it.
    else if (def.sample === 'inverted') levels.set(cell, !cellOccupied(w, x, y));
    // A toggle switch is powered while its terrain is the powered form; the arrivals flipped the terrain already.
    else if (def.sample === 'toggle') levels.set(cell, ConfigRegistry.getTile(w.terrain[y][x]).signalToggleOn === true);
    // A wire floor is powered while the player stands on it holding the lightning bolt: the whole wire net it feeds is on.
    else if (def.sample === 'charged') levels.set(cell, chargedCellOccupied(w, x, y));
    else levels.set(cell, cellOccupied(w, x, y));
  }
  return levels;
}

/**
 * Settles the level's signal network from the world as it is now and keeps the new state. Does nothing on a
 * level without signals. The beams are refreshed first (a trace only when something moved), so a receiver
 * source never reads the trace of the pass before. With `prime` (level load) it only records, no edge. Settle before the hold doors are set, so a door follows
 * the signals of the same pass. Returns the edges of the sinks. Clears the pending arrivals of the pulse buttons
 * right after sampling, before the caller fires the sinks.
 */
export function settleWorldSignals(w: EpoxyWorld, prime: boolean = false): SignalEdge[] {
  const runtime = w.signals;
  if (runtime === undefined) return [];
  refreshBeams(w);
  const result = settleSignals(runtime.network, runtime.state, sampleSources(w, runtime, prime), prime);
  runtime.state = result.state;
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

/** A copy of the state of the world's network, for a snapshot or a hash; undefined without signals. */
export function copySignalState(w: EpoxyWorld): SignalState | undefined {
  return w.signals === undefined ? undefined : cloneSignalState(w.signals.state);
}

/**
 * Fires the launchers, clone machines and flip tiles whose sink rose at the last settle, in evaluation order: a
 * launcher shoots and a clone machine spawns once, with the rules of a trigger (the per-tick launcher cap, the tile
 * check, the entity cap); a flip tile swaps to its other form. Call it after the settle and the hold doors. Stops as
 * soon as the player is dead or the level is completed. Only a rising edge fires, except a wired flip tile (a purple wall or a
 * wired flame jet), which flips on a falling edge too.
 */
export function fireSignalSinks(ctx: EpoxyContext, edges: readonly SignalEdge[]): void {
  const w = ctx.world;
  const runtime = w.signals;
  if (runtime === undefined) return;
  const width = mapWidth(w);
  for (const edge of edges) {
    if (!w.player.alive || w.levelCompleted) return;
    const index = runtime.network.indexOfCell.get(edge.cell);
    const fires = index === undefined ? undefined : runtime.defs.get(index)?.fires;
    if (fires === undefined) continue;
    const x = edge.cell % width;
    const y = Math.floor(edge.cell / width);
    // A wired flip tile follows every change of its input; every other sink fires on the rising edge only.
    // UNVERIFIED (low confidence): that a wired flame jet also flips on the falling edge is not confirmed against CC2.
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
