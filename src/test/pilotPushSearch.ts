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
 * Exact searches of the block rooms that hold water: the block solver of the game does not follow
 * water, and the engine search of pilotSearch.ts, which keeps the facing and the cooldowns of every
 * piece, is too heavy once four blocks move. These two searches model the rules that matter in such
 * a room and nothing else:
 *  - plain floor, hint tiles, block targets, walls, water and dirt only (anything else throws);
 *  - a block cannot push a block, and walls and fresh dirt stop a block;
 *  - a block pushed into water sinks and leaves fresh dirt, which a block cannot cross until the
 *    player has stepped on it (the player then leaves floor behind);
 *  - the player never enters water, and a level is won when every target holds a block.
 * Their verdicts are checked against the engine on small rooms in pilotPushSearch.test.ts.
 */

const WATER_TILE_ID = 'water';
const DIRT_TILE_ID = 'dirt';
const DEFAULT_STATE_CAP = 3000000;
const BLOCK_ENTITY_TYPE = 'dirt_block';

/** Condition of a cell that changes during play: water, fresh dirt, or trodden floor. */
const SOFT_WATER = 0;
const SOFT_DIRT = 1;
const SOFT_FLOOR = 2;

export interface PushSearchOptions {
  /** Most states to visit; exceeding it throws, so a runaway proof fails loudly. */
  stateCap?: number;
}

export interface PushSearchResult {
  /** Number of pushes of the shortest win, the player walking freely between them. */
  pushes: number;
}

export interface MoveSearchResult {
  /** Moves of the shortest win, as N, E, S and W letters. */
  moves: string;
}

interface Room {
  width: number;
  height: number;
  wall: Uint8Array;
  target: Uint8Array;
  /** Index into the soft cells of each cell, or -1 for a cell that never changes. */
  softIndex: Int32Array;
  soft: number[];
  startSoft: number[];
  startBlocks: number[];
  startPlayer: number;
}

function readRoom(engine: GameEngine): Room {
  const terrain = engine.getTerrain();
  const height = terrain.length;
  const width = terrain[0].length;
  const wall = new Uint8Array(width * height);
  const target = new Uint8Array(width * height);
  const softIndex = new Int32Array(width * height).fill(-1);
  const soft: number[] = [];
  const startSoft: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = terrain[y][x];
      const k = y * width + x;
      if (id === WALL_TILE_ID) wall[k] = 1;
      else if (id === BLOCK_TARGET_TILE_ID) target[k] = 1;
      else if (id === WATER_TILE_ID || id === DIRT_TILE_ID) {
        softIndex[k] = soft.length;
        soft.push(k);
        startSoft.push(id === WATER_TILE_ID ? SOFT_WATER : SOFT_DIRT);
      } else if (id !== FLOOR_TILE_ID && id !== HINT_TILE_ID) {
        throw new Error(`pilotPushSearch does not model the terrain ${id} at ${x},${y}`);
      }
    }
  }
  const startBlocks: number[] = [];
  for (const e of engine.getEntities()) {
    if (e.type !== BLOCK_ENTITY_TYPE) throw new Error(`pilotPushSearch does not model the entity ${e.type}`);
    startBlocks.push(e.y * width + e.x);
  }
  startBlocks.sort((a, b) => a - b);
  const player = engine.getPlayer();
  return { width, height, wall, target, softIndex, soft, startSoft, startBlocks, startPlayer: player.y * width + player.x };
}

function neighbour(room: Room, cell: number, dir: Direction, sign: 1 | -1 = 1): number {
  const vec = DIRECTION_VECTORS[dir];
  const x = (cell % room.width) + vec.dx * sign;
  const y = Math.floor(cell / room.width) + vec.dy * sign;
  return x < 0 || y < 0 || x >= room.width || y >= room.height ? -1 : y * room.width + x;
}

function covered(room: Room, blocks: number[]): boolean {
  for (let k = 0; k < room.target.length; k++) if (room.target[k] && !blocks.includes(k)) return false;
  return true;
}

/** A push is allowed when the cell ahead is no wall, no block and no fresh dirt. */
function pushAllowed(room: Room, blocks: number[], softState: number[], ahead: number): boolean {
  if (ahead < 0 || room.wall[ahead] || blocks.includes(ahead)) return false;
  const s = room.softIndex[ahead];
  return s < 0 || softState[s] !== SOFT_DIRT;
}

/** Cells the player reaches from `from`; fresh dirt met on the way is trodden into floor (in `softState`). */
function region(room: Room, from: number, blocks: number[], softState: number[]): number[] {
  const seen = new Uint8Array(room.wall.length);
  const queue = [from];
  seen[from] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const dir of ORDERED_DIRECTIONS) {
      const n = neighbour(room, queue[head], dir);
      if (n < 0 || seen[n] || room.wall[n] || blocks.includes(n)) continue;
      const s = room.softIndex[n];
      if (s >= 0 && softState[s] === SOFT_WATER) continue;
      if (s >= 0 && softState[s] === SOFT_DIRT) softState[s] = SOFT_FLOOR;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return queue;
}

/**
 * Breadth-first search over block layouts: the player walks freely between pushes, and the dirt he
 * could step on is taken as trodden (floor is never worse than dirt). Returns the fewest pushes of
 * a win, or null when the exhaustive search finds none. Throws when `stateCap` is exceeded.
 */
export function searchPushWin(engine: GameEngine, options: PushSearchOptions = {}): PushSearchResult | null {
  const room = readRoom(engine);
  const cap = options.stateCap ?? DEFAULT_STATE_CAP;
  interface Node {
    blocks: number[];
    soft: number[];
    reach: number[];
    depth: number;
  }
  const startSoft = [...room.startSoft];
  const startReach = region(room, room.startPlayer, room.startBlocks, startSoft);
  const keyOf = (blocks: number[], softState: number[], reach: number[]) =>
    `${blocks.join(',')}|${softState.join('')}|${Math.min(...reach)}`;
  const seen = new Set<string>([keyOf(room.startBlocks, startSoft, startReach)]);
  const queue: Node[] = [{ blocks: room.startBlocks, soft: startSoft, reach: startReach, depth: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (covered(room, node.blocks)) return { pushes: node.depth };
    const reachSet = new Set(node.reach);
    for (const block of node.blocks) {
      for (const dir of ORDERED_DIRECTIONS) {
        const behind = neighbour(room, block, dir, -1);
        const ahead = neighbour(room, block, dir);
        if (behind < 0 || !reachSet.has(behind)) continue;
        if (!pushAllowed(room, node.blocks, node.soft, ahead)) continue;
        const softState = [...node.soft];
        const s = room.softIndex[ahead];
        let blocks: number[];
        if (s >= 0 && softState[s] === SOFT_WATER) {
          softState[s] = SOFT_DIRT;
          blocks = node.blocks.filter((c) => c !== block);
        } else {
          blocks = node.blocks.map((c) => (c === block ? ahead : c)).sort((a, b) => a - b);
        }
        const reach = region(room, block, blocks, softState);
        const key = keyOf(blocks, softState, reach);
        if (seen.has(key)) continue;
        if (seen.size >= cap) throw new Error(`push search exceeded ${cap} states`);
        seen.add(key);
        queue.push({ blocks, soft: softState, reach, depth: node.depth + 1 });
      }
    }
  }
  return null;
}

/** Whether any sequence of pushes wins; see `searchPushWin`. */
export function pushWinExists(engine: GameEngine, options: PushSearchOptions = {}): boolean {
  return searchPushWin(engine, options) !== null;
}


/**
 * Shortest win in moves. Dijkstra over the layouts after each push, with the player's exact cell:
 * from a layout the player walks (never over fresh dirt) to the cell behind a block and pushes, or
 * walks next to fresh dirt and steps on it, which turns it into floor. Returns null when no win
 * exists; throws when `stateCap` is exceeded.
 */
export function searchMoveWin(engine: GameEngine, options: PushSearchOptions = {}): MoveSearchResult | null {
  const room = readRoom(engine);
  const cap = options.stateCap ?? DEFAULT_STATE_CAP;
  interface Node {
    blocks: number[];
    soft: number[];
    player: number;
    cost: number;
    parent: number;
    text: string;
    won: boolean;
  }
  const keyOf = (blocks: number[], softState: number[], player: number) => `${blocks.join(',')}|${softState.join('')}|${player}`;
  const nodes: Node[] = [
    { blocks: room.startBlocks, soft: [...room.startSoft], player: room.startPlayer, cost: 0, parent: -1, text: '', won: false }
  ];
  const best = new Map<string, number>([[keyOf(room.startBlocks, room.startSoft, room.startPlayer), 0]]);
  const buckets: number[][] = [[0]];
  let bestWin = Number.POSITIVE_INFINITY;
  const textOf = (index: number): string => {
    let text = '';
    for (let n = index; n > 0; n = nodes[n].parent) text = nodes[n].text + text;
    return text;
  };
  const offer = (blocks: number[], softState: number[], player: number, cost: number, parent: number, text: string, won = false): void => {
    const key = won ? 'WIN' : keyOf(blocks, softState, player);
    const known = best.get(key);
    if (known !== undefined && known <= cost) return;
    if (best.size >= cap) throw new Error(`move search exceeded ${cap} states`);
    best.set(key, cost);
    nodes.push({ blocks, soft: softState, player, cost, parent, text, won });
    (buckets[cost] ??= []).push(nodes.length - 1);
    if (won) bestWin = Math.min(bestWin, cost);
  };
  for (let level = 0; level < buckets.length && level <= bestWin; level++) {
    for (let at = 0; at < (buckets[level]?.length ?? 0); at++) {
      const index = buckets[level][at];
      const node = nodes[index];
      if (node.cost !== level) continue;
      if (node.won) return { moves: textOf(index) };
      if (best.get(keyOf(node.blocks, node.soft, node.player)) !== level) continue;
      // Walk: the path letters to every cell the player can stand on without treading dirt.
      const walkText = new Map<number, string>([[node.player, '']]);
      const queue = [node.player];
      for (let head = 0; head < queue.length; head++) {
        for (const dir of ORDERED_DIRECTIONS) {
          const n = neighbour(room, queue[head], dir);
          if (n < 0 || walkText.has(n) || room.wall[n] || node.blocks.includes(n)) continue;
          const s = room.softIndex[n];
          if (s >= 0 && node.soft[s] !== SOFT_FLOOR) continue;
          walkText.set(n, (walkText.get(queue[head]) as string) + dir);
          queue.push(n);
        }
      }
      for (const [cell, text] of walkText) {
        for (const dir of ORDERED_DIRECTIONS) {
          const into = neighbour(room, cell, dir);
          if (into < 0 || room.wall[into]) continue;
          const stepCost = level + text.length + 1;
          if (node.blocks.includes(into)) {
            const ahead = neighbour(room, into, dir);
            if (!pushAllowed(room, node.blocks, node.soft, ahead)) continue;
            const softState = [...node.soft];
            const s = room.softIndex[ahead];
            let blocks: number[];
            if (s >= 0 && softState[s] === SOFT_WATER) {
              softState[s] = SOFT_DIRT;
              blocks = node.blocks.filter((c) => c !== into);
            } else {
              blocks = node.blocks.map((c) => (c === into ? ahead : c)).sort((a, b) => a - b);
            }
            if (covered(room, blocks)) offer(blocks, softState, into, stepCost, index, text + dir, true);
            else offer(blocks, softState, into, stepCost, index, text + dir);
          } else {
            const s = room.softIndex[into];
            if (s >= 0 && node.soft[s] === SOFT_DIRT) {
              const softState = [...node.soft];
              softState[s] = SOFT_FLOOR;
              offer(node.blocks, softState, into, stepCost, index, text + dir);
            }
          }
        }
      }
    }
  }
  return null;
}
