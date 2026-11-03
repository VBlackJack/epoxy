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

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { BLOCK_TARGET_TILE_ID, FLOOR_TILE_ID, HINT_TILE_ID, WALL_TILE_ID } from '../core/coreConstants';
import { GameEngine } from '../core/GameEngine';
import { Direction } from '../core/types';

/**
 * The pushes a block makes on its way home: where it starts and the directions of its pushes, in
 * order. The cells it passes are derived, so a plan cannot disagree with the map.
 */
export interface NaturalPlan {
  at: [number, number];
  pushes: string;
}

export interface NaturalPlayReport {
  /** Natural states reached from the start: how far each block is on its plan, and where the player stands. */
  states: number;
  /** Reached states from which no run of natural pushes finishes every plan. */
  deadStates: number;
  /** Fewest moves of a natural finish, walking included, or null when none exists. */
  shortest: string | null;
}

/** Most natural states a run may visit, so a runaway room fails loudly. */
const NATURAL_STATE_CAP = 2000000;

/**
 * Exhaustive analysis of "natural play" in an open block room: every push moves a block along the
 * plan it was given, in any order, the player walking freely between pushes. The room may hold
 * floor, hint tiles, block targets and walls only. A natural state is dead when no run of natural
 * pushes completes the plans, so `deadStates` of zero says no order of natural pushes can strand
 * the player. A push is natural only when its cell ahead is free and the player can walk to the
 * cell behind the block without moving a block.
 */
export function analyseNaturalPlay(engine: GameEngine, plans: readonly NaturalPlan[]): NaturalPlayReport {
  const terrain = engine.getTerrain();
  const height = terrain.length;
  const width = terrain[0].length;
  const wall = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = terrain[y][x];
      if (id === WALL_TILE_ID) wall[y * width + x] = 1;
      else if (id !== FLOOR_TILE_ID && id !== HINT_TILE_ID && id !== BLOCK_TARGET_TILE_ID) {
        throw new Error(`analyseNaturalPlay does not model the terrain ${id} at ${x},${y}`);
      }
    }
  }
  const step = (cell: number, dir: Direction, sign: 1 | -1 = 1): number => {
    const vec = DIRECTION_VECTORS[dir];
    const x = (cell % width) + vec.dx * sign;
    const y = Math.floor(cell / width) + vec.dy * sign;
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  };
  // path[i][k] is the cell of block i after k pushes; dirs[i][k] is its push k.
  const path: number[][] = [];
  const dirs: Direction[][] = [];
  for (const plan of plans) {
    const cells = [plan.at[1] * width + plan.at[0]];
    const pushes = [...plan.pushes] as Direction[];
    for (const dir of pushes) {
      const next = step(cells[cells.length - 1], dir);
      if (next < 0 || wall[next]) throw new Error(`a plan pushes a block into a wall from ${plan.at.join(',')}`);
      cells.push(next);
    }
    path.push(cells);
    dirs.push(pushes);
  }
  const startBlocks = new Set(engine.getEntities().map((e) => e.y * width + e.x));
  if (startBlocks.size !== plans.length || path.some((cells) => !startBlocks.has(cells[0]))) {
    throw new Error('the plans must start exactly where the blocks of the level start');
  }
  const player = engine.getPlayer();
  const finished = plans.map((p) => p.pushes.length);

  interface Edge {
    to: string;
    cost: number;
    text: string;
  }
  interface State {
    stages: number[];
    player: number;
    edges: Edge[];
  }
  const states = new Map<string, State>();
  const keyOf = (stages: number[], at: number) => `${stages.join(',')}@${at}`;
  const startStages = plans.map(() => 0);
  const startKey = keyOf(startStages, player.y * width + player.x);
  states.set(startKey, { stages: startStages, player: player.y * width + player.x, edges: [] });
  const order = [startKey];
  for (let head = 0; head < order.length; head++) {
    const state = states.get(order[head]) as State;
    const occupied = new Set(state.stages.map((stage, i) => path[i][stage]));
    const walk = new Map<number, string>([[state.player, '']]);
    const queue = [state.player];
    for (let at = 0; at < queue.length; at++) {
      for (const dir of ORDERED_DIRECTIONS) {
        const n = step(queue[at], dir);
        if (n < 0 || wall[n] || occupied.has(n) || walk.has(n)) continue;
        walk.set(n, (walk.get(queue[at]) as string) + dir);
        queue.push(n);
      }
    }
    state.stages.forEach((stage, i) => {
      if (stage >= finished[i]) return;
      const dir = dirs[i][stage];
      const from = path[i][stage];
      const to = path[i][stage + 1];
      const behind = step(from, dir, -1);
      if (behind < 0 || !walk.has(behind) || occupied.has(to)) return;
      const nextStages = [...state.stages];
      nextStages[i] = stage + 1;
      const nextKey = keyOf(nextStages, from);
      const text = (walk.get(behind) as string) + dir;
      state.edges.push({ to: nextKey, cost: text.length, text });
      if (!states.has(nextKey)) {
        if (states.size >= NATURAL_STATE_CAP) throw new Error(`natural play exceeded ${NATURAL_STATE_CAP} states`);
        states.set(nextKey, { stages: nextStages, player: from, edges: [] });
        order.push(nextKey);
      }
    });
  }
  const isGoal = (state: State) => state.stages.every((stage, i) => stage === finished[i]);
  // Dead states: reached, but no way on to a goal. Reverse reachability from the goals.
  const reverse = new Map<string, string[]>();
  for (const [key, state] of states) for (const edge of state.edges) reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), key]);
  const alive = new Set<string>();
  const stack: string[] = [];
  for (const [key, state] of states) {
    if (isGoal(state)) {
      alive.add(key);
      stack.push(key);
    }
  }
  while (stack.length > 0) {
    for (const before of reverse.get(stack.pop() as string) ?? []) {
      if (!alive.has(before)) {
        alive.add(before);
        stack.push(before);
      }
    }
  }
  // Shortest finish by Dijkstra over the same graph.
  const bestCost = new Map<string, number>([[startKey, 0]]);
  const via = new Map<string, { from: string; text: string }>();
  const buckets: string[][] = [[startKey]];
  let shortest: string | null = null;
  for (let cost = 0; cost < buckets.length && shortest === null; cost++) {
    for (const key of buckets[cost] ?? []) {
      if (bestCost.get(key) !== cost) continue;
      const state = states.get(key) as State;
      if (isGoal(state)) {
        let text = '';
        for (let k = key; k !== startKey; k = (via.get(k) as { from: string }).from) text = (via.get(k) as { text: string }).text + text;
        shortest = text;
        break;
      }
      for (const edge of state.edges) {
        const next = cost + edge.cost;
        if (bestCost.has(edge.to) && (bestCost.get(edge.to) as number) <= next) continue;
        bestCost.set(edge.to, next);
        via.set(edge.to, { from: key, text: edge.text });
        (buckets[next] ??= []).push(edge.to);
      }
    }
  }
  return { states: states.size, deadStates: states.size - alive.size, shortest };
}
