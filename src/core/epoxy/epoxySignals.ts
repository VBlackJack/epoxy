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
import type { ChannelColor, SignalNodeDef, SignalSpec } from '../types';
import { refreshBeams } from './epoxyLasers';
import { EpoxyWorld, entityPressesPlate, mapWidth } from './epoxyWorld';
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
}

/** Thrown when a source has no sampler or a sink no colour: a level no validator would have let through. */
export class SignalWiringError extends Error {
  constructor(readonly cell: number) {
    super(`signal wiring: node at cell ${cell} lacks its sampler or colour`);
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
      if (def.color === undefined) throw new SignalWiringError(def.cell);
      defs.set(index, def);
    }
  }
  return { network, state: createSignalState(network), defs, edgeCounts: { rising: 0, falling: 0 } };
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

/** Samples every source of the network, by cell index. A receiver reads litReceiverCells, so the beams must be fresh. */
function sampleSources(w: EpoxyWorld, runtime: SignalRuntime): Map<number, boolean> {
  const width = mapWidth(w);
  const lit = new Set(w.litReceiverCells.map((cell) => cell.y * width + cell.x));
  const levels = new Map<number, boolean>();
  for (const index of runtime.network.sourceIndexes) {
    const { cell } = runtime.network.nodes[index];
    const x = cell % width;
    const y = Math.floor(cell / width);
    const def = runtime.defs.get(index) as SignalNodeDef;
    levels.set(cell, def.sample === 'receiver' ? lit.has(cell) : cellOccupied(w, x, y));
  }
  return levels;
}

/**
 * Settles the level's signal network from the world as it is now and keeps the new state. Does nothing on a
 * level without signals. The beams are refreshed first (a trace only when something moved), so a receiver
 * source never reads the trace of the pass before. With `prime` (level load) it only records, no edge. Settle before the hold doors are set, so a door follows
 * the signals of the same pass. Returns the edges of the sinks.
 */
export function settleWorldSignals(w: EpoxyWorld, prime: boolean = false): SignalEdge[] {
  const runtime = w.signals;
  if (runtime === undefined) return [];
  refreshBeams(w);
  const result = settleSignals(runtime.network, runtime.state, sampleSources(w, runtime), prime);
  runtime.state = result.state;
  for (const edge of result.edges) {
    if (edge.rising) runtime.edgeCounts.rising++;
    else runtime.edgeCounts.falling++;
  }
  return result.edges;
}

/** A copy of the state of the world's network, for a snapshot or a hash; undefined without signals. */
export function copySignalState(w: EpoxyWorld): SignalState | undefined {
  return w.signals === undefined ? undefined : cloneSignalState(w.signals.state);
}
