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

import { ORDERED_DIRECTIONS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GridPoint, UndoSnapshot } from '../core/types';
import { encodeActions, PieceSolver, SolverAction, WAIT_ACTION } from './PieceSolver';

/** Default bound on states explored by one goto search. */
export const DEFAULT_MAX_GOTO_STATES = 50000;

/** A literal segment is made of moves and waits; a goto segment is "@x,y". */
const LITERAL_PATTERN = /^[NESW.]+$/;
const GOTO_PATTERN = /^@(\d+),(\d+)$/;
const WAIT_LETTER = '.';

export type RouteSegment =
  | { kind: 'literal'; actions: SolverAction[] }
  | { kind: 'goto'; target: GridPoint };

export interface RouteOptions {
  /** Bound on the states explored by each goto segment. */
  maxStates?: number;
  /** Accept a route that stops before the exit, to check a level while it is being written. */
  partial?: boolean;
}

export interface RouteResult {
  /** The whole route as one action string (N, E, S, W and '.' for waits). */
  solution: string;
  moves: number;
  /** Total over every goto search. */
  statesExplored: number;
}

/** A route that cannot be expanded; names where it breaks. */
export class CampaignRouteError extends Error {
  public constructor(
    public readonly levelId: string,
    public readonly segmentIndex: number,
    public readonly player: GridPoint,
    public readonly reason: string
  ) {
    super(`Route of ${levelId} breaks at segment ${segmentIndex} (player at ${player.x},${player.y}): ${reason}`);
    this.name = 'CampaignRouteError';
  }
}

/** Reads one segment string; throws on anything that is neither a move list nor "@x,y". */
export function parseSegment(text: string): RouteSegment {
  if (LITERAL_PATTERN.test(text)) {
    return {
      kind: 'literal',
      actions: [...text].map((ch) => (ch === WAIT_LETTER ? WAIT_ACTION : (ch as SolverAction)))
    };
  }
  const goto = GOTO_PATTERN.exec(text);
  if (goto) return { kind: 'goto', target: { x: Number(goto[1]), y: Number(goto[2]) } };
  throw new Error(`Unreadable route segment "${text}": expected moves of N, E, S, W and '.', or "@x,y"`);
}

interface QueueEntry {
  index: number;
  bound: number;
  depth: number;
}

/** Open set ordered by bound, the deepest first among equals, then the earliest generated. */
class SearchQueue {
  private readonly heap: QueueEntry[] = [];

  public push(index: number, bound: number, depth: number): void {
    const heap = this.heap;
    heap.push({ index, bound, depth });
    let at = heap.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(heap[at], heap[parent])) break;
      [heap[at], heap[parent]] = [heap[parent], heap[at]];
      at = parent;
    }
  }

  public pop(): number | null {
    const heap = this.heap;
    if (heap.length === 0) return null;
    const top = heap[0];
    const last = heap.pop() as QueueEntry;
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let best = at;
        if (left < heap.length && this.before(heap[left], heap[best])) best = left;
        if (right < heap.length && this.before(heap[right], heap[best])) best = right;
        if (best === at) break;
        [heap[at], heap[best]] = [heap[best], heap[at]];
        at = best;
      }
    }
    return top.index;
  }

  private before(a: QueueEntry, b: QueueEntry): boolean {
    if (a.bound !== b.bound) return a.bound < b.bound;
    if (a.depth !== b.depth) return a.depth > b.depth;
    return a.index < b.index;
  }
}

interface GotoResult {
  moves: SolverAction[] | null;
  statesExplored: number;
  reason: string;
}

/**
 * Expands a hand-written route into the action string that wins the level.
 * Literal segments are played as written; "@x,y" segments walk to a cell with
 * a best-first search in the real engine over the whole level (trap and clone
 * links kept), so doors, keys, blocks and monsters follow the game's own rules.
 */
export function expandRoute(level: CompiledLevel, segments: readonly string[], options: RouteOptions = {}): RouteResult {
  const maxStates = options.maxStates ?? DEFAULT_MAX_GOTO_STATES;
  const engine = new GameEngine();
  engine.loadLevel(level);
  const played: SolverAction[] = [];
  let statesExplored = 0;

  const fail = (index: number, reason: string): never => {
    const { x, y } = engine.getPlayer();
    throw new CampaignRouteError(level.id, index, { x, y }, reason);
  };

  segments.forEach((text, index) => {
    let segment: RouteSegment;
    try {
      segment = parseSegment(text);
    } catch (error) {
      return fail(index, (error as Error).message);
    }
    if (segment.kind === 'literal') {
      for (const action of segment.actions) {
        if (!PieceSolver.play(engine, action)) return fail(index, `the player died or never settled on "${action}"`);
        played.push(action);
      }
      return;
    }
    const { x, y } = segment.target;
    const width = level.terrain[0].length;
    const height = level.terrain.length;
    if (x >= width || y >= height) return fail(index, `target ${x},${y} is outside the ${width}x${height} map`);
    const found = searchGoto(engine, segment.target, maxStates);
    statesExplored += found.statesExplored;
    if (!found.moves) return fail(index, `${found.reason} (${found.statesExplored} states)`);
    for (const action of found.moves) {
      if (!PieceSolver.play(engine, action)) return fail(index, 'the found path did not replay');
      played.push(action);
    }
  });

  if (!options.partial && !engine.isLevelCompleted()) fail(segments.length, 'the level is not completed after the last segment');
  return { solution: encodeActions(played), moves: played.length, statesExplored };
}

/**
 * Best-first search from the engine's current state to a state with the
 * player on `target`. Completed states are dead ends, except when they are
 * the target itself (the exit). The engine is put back in its starting state.
 */
function searchGoto(engine: GameEngine, target: GridPoint, maxStates: number): GotoResult {
  const at = (): boolean => {
    const p = engine.getPlayer();
    return p.x === target.x && p.y === target.y;
  };
  if (at()) return { moves: [], statesExplored: 1, reason: '' };

  const base = engine.captureState();
  const actions: SolverAction[] = [...ORDERED_DIRECTIONS, WAIT_ACTION];
  // A state's snapshot is dropped once it is expanded; the path lives in parents and via.
  const states: Array<UndoSnapshot | null> = [base];
  const parents: number[] = [-1];
  const via: Array<SolverAction | null> = [null];
  const depth: number[] = [0];
  const seen = new Set<string>([stateKey(engine, base)]);
  const open = new SearchQueue();
  open.push(0, distanceLeft(base, target), 0);

  try {
    for (let head = open.pop(); head !== null; head = open.pop()) {
      const from = states[head] as UndoSnapshot;
      for (const action of actions) {
        engine.restoreState(from);
        if (action === WAIT_ACTION) {
          if (!PieceSolver.play(engine, WAIT_ACTION)) continue;
        } else {
          if (!engine.attemptPlayerMove(action) && !terrainChanged(engine, from)) continue;
          if (!PieceSolver.settle(engine)) continue;
        }
        if (at()) {
          const moves: SolverAction[] = [action];
          for (let i = head; i > 0; i = parents[i]) moves.push(via[i] as SolverAction);
          return { moves: moves.reverse(), statesExplored: states.length, reason: '' };
        }
        if (engine.isLevelCompleted()) continue;
        const key = stateKey(engine, base);
        if (seen.has(key)) continue;
        seen.add(key);
        const state = engine.captureState();
        states.push(state);
        parents.push(head);
        via.push(action);
        depth.push(depth[head] + 1);
        open.push(states.length - 1, depth[head] + 1 + distanceLeft(state, target), depth[head] + 1);
        if (states.length >= maxStates) {
          return { moves: null, statesExplored: states.length, reason: `state budget of ${maxStates} exhausted` };
        }
      }
      states[head] = null;
    }
    return { moves: null, statesExplored: states.length, reason: 'every reachable state was explored without reaching the target' };
  } finally {
    engine.restoreState(base);
  }
}

/** Grid distance to the target: the order the search heads by. */
function distanceLeft(state: UndoSnapshot, target: GridPoint): number {
  return Math.abs(state.player.x - target.x) + Math.abs(state.player.y - target.y);
}

/** A refused move can still reveal a hidden wall. */
function terrainChanged(engine: GameEngine, before: UndoSnapshot): boolean {
  const after = engine.getTerrain();
  return after.some((row, y) => row.some((id, x) => id !== before.terrain[y][x]));
}

/**
 * What can matter to the rest of the walk: player cell, inventory, chips
 * left, every monster and block with facing and move timer, and the cells
 * whose terrain or item differs from the search's starting state.
 */
function stateKey(engine: GameEngine, base: UndoSnapshot): string {
  const player = engine.getPlayer();
  const terrain = engine.getTerrain();
  const items = engine.getItems();
  let changed = '';
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < terrain[y].length; x++) {
      if (terrain[y][x] !== base.terrain[y][x]) changed += `t${x},${y}=${terrain[y][x]};`;
      if (items[y][x] !== base.items[y][x]) changed += `i${x},${y}=${items[y][x] ?? ''};`;
    }
  }
  const held: string[] = [];
  for (const id in player.keys) {
    if (player.keys[id] > 0) held.push(`${id},${player.keys[id]}`);
  }
  const entities: string[] = [];
  for (const e of engine.getEntities()) {
    entities.push(e.kind === 'monster' ? `${e.type}@${e.x},${e.y},${e.dir},${e.cooldownTicks}` : `${e.type}@${e.x},${e.y}`);
  }
  entities.sort();
  return `${player.x},${player.y}|${held.sort().join()}|${[...player.boots].sort().join()}|${engine.getChipsRemaining()}|${entities.join(';')}|${changed}`;
}
