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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { OPPOSITE_DIRECTION } from './coreConstants';
import { GameEngine } from './GameEngine';

/** Layouts the exact search may visit, for the dead-end watch that runs by itself, before giving up without a verdict. */
export function watchSearchBudget(): number {
  return ConfigRegistry.getGame().blockPuzzle.watchSearchBudget;
}

/** Layouts the exact search may visit, for a hint or a check the player asked for, before giving up without a verdict. */
export function requestedSearchBudget(): number {
  return ConfigRegistry.getGame().blockPuzzle.hintSearchBudget;
}

type Dir = (typeof ORDERED_DIRECTIONS)[number];

interface SearchNode {
  blocks: number[];
  reach: number[];
  parent: number;
  /** The push leading here: the block's cell before it, and the direction. */
  pushFrom: number;
  pushDir: Dir | null;
}

type SearchOutcome =
  | { kind: 'covered'; nodes: SearchNode[]; goal: number }
  | { kind: 'exhausted' }
  | { kind: 'budget' };

/**
 * Solves the block puzzles of a running level, to keep the player from
 * being stuck and to give hints. The puzzle in
 * question is the Sokoban one: every brown button (hold_trap) must end up
 * under a block. A fast test first looks for a block that can no longer
 * reach any free button, the other blocks standing still. Only when it fires
 * does an exact search run: breadth-first over block layouts, the player
 * walking freely between pushes. A dead end is reported only when that
 * search proves no sequence of pushes covers every button; when it runs out
 * of budget it reports nothing, so the player is never told a false
 * "stuck".
 *
 * The model is deliberately strict about what blocks and the player may
 * cross (hazards, doors without a key, traps and slides count as walls), so
 * it only judges levels whose block puzzles stand on plain ground.
 */
export class BlockPuzzleSolver {
  private readonly width: number;
  private readonly height: number;
  private readonly playerOk: Uint8Array;
  private readonly blockOk: Uint8Array;
  /** Cells a block may enter that the model does not follow (water, ice, force floors...). */
  private readonly blockUnmodelled: Uint8Array;
  /** Per cell and direction (in ORDERED_DIRECTIONS order): the step is stopped by a thin wall or an entry rule. */
  private readonly edgeBlocked: Uint8Array;
  private readonly buttons: number[];
  private readonly blocks: number[];
  private readonly player: number;

  private constructor(engine: GameEngine) {
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const player = engine.getPlayer();
    this.height = terrain.length;
    this.width = terrain[0].length;
    const size = this.width * this.height;
    this.playerOk = new Uint8Array(size);
    this.blockOk = new Uint8Array(size);
    this.blockUnmodelled = new Uint8Array(size);
    this.edgeBlocked = new Uint8Array(size * ORDERED_DIRECTIONS.length);
    this.buttons = [];
    const monsters = new Set<number>();
    this.blocks = [];
    for (const e of engine.getEntities()) {
      const kind = ConfigRegistry.getEntityDef(e.type)?.kind;
      if (kind === 'block') this.blocks.push(e.y * this.width + e.x);
      else monsters.add(e.y * this.width + e.x);
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const k = y * this.width + x;
        const tile = ConfigRegistry.getTile(terrain[y][x]);
        const item = items[y][x];
        const itemHazard = item ? Boolean(ConfigRegistry.getTile(item).hazard) : false;
        const plain = !tile.slideType && !tile.hazard && !tile.isTrap && !tile.isTeleporter && !itemHazard;
        const unlocked = !tile.requiredKey || (player.keys[tile.requiredKey] ?? 0) > 0;
        this.playerOk[k] = plain && unlocked && tile.passableByPlayer === true && !monsters.has(k) ? 1 : 0;
        this.blockOk[k] = plain && tile.passableByBlock === true && !monsters.has(k) ? 1 : 0;
        this.blockUnmodelled[k] = !plain && tile.passableByBlock === true ? 1 : 0;
        if (tile.buttonAction === 'hold_trap') this.buttons.push(k);
      }
    }
    this.player = player.y * this.width + player.x;
    this.markBlockedEdges(terrain);
  }

  /** Records the steps the engine refuses on the edge between two cells, whoever takes them. */
  private markBlockedEdges(terrain: string[][]): void {
    ORDERED_DIRECTIONS.forEach((dir, dirIdx) => {
      const vec = DIRECTION_VECTORS[dir];
      const opposite = OPPOSITE_DIRECTION[dir];
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const nx = x + vec.dx;
          const ny = y + vec.dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
          const from = ConfigRegistry.getTile(terrain[y][x]);
          const to = ConfigRegistry.getTile(terrain[ny][nx]);
          if (
            from.blockedEdges?.includes(dir) ||
            to.blockedEdges?.includes(opposite) ||
            from.blockedEntryDirections?.includes(opposite) ||
            to.blockedEntryDirections?.includes(dir)
          ) {
            this.edgeBlocked[(y * this.width + x) * ORDERED_DIRECTIONS.length + dirIdx] = 1;
          }
        }
      }
    });
  }

  /**
   * True only when the blocks provably cannot cover every hold-trap button
   * any more. False means solvable, not a block puzzle, or not decided
   * within the budget.
   */
  public static isStuck(engine: GameEngine, budget: number = watchSearchBudget()): boolean {
    const detector = new BlockPuzzleSolver(engine);
    if (detector.buttons.length === 0) return false;
    // Separate block puzzles (two Sokoban rooms) are judged one at a time.
    // A puzzle whose blocks can reach ground the model does not follow is not judged.
    return detector
      .areas()
      .some((area) => area.modelled && detector.areaIsStuck(area.blocks, area.buttons, budget));
  }

  /**
   * Groups blocks and buttons by the ground a block could ever cover: two
   * blocks share an area when one could be pushed where the other stands.
   */
  private areas(): Array<{ blocks: number[]; buttons: number[]; modelled: boolean }> {
    const areaOf = new Int32Array(this.width * this.height).fill(-1);
    const result: Array<{ blocks: number[]; buttons: number[]; modelled: boolean }> = [];
    for (const start of this.blocks) {
      if (areaOf[start] >= 0) continue;
      const id = result.length;
      result.push({ blocks: [], buttons: [], modelled: true });
      areaOf[start] = id;
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        for (const dir of ORDERED_DIRECTIONS) {
          const n = this.step(queue[i], dir, 1);
          // Unmodelled ground counts only if a block could be pushed onto it from here.
          const behind = this.step(queue[i], dir, -1);
          if (n >= 0 && this.blockUnmodelled[n] && behind >= 0 && this.playerOk[behind]) {
            result[id].modelled = false;
          }
          if (n < 0 || areaOf[n] >= 0 || !this.blockOk[n]) continue;
          areaOf[n] = id;
          queue.push(n);
        }
      }
    }
    for (const b of this.blocks) result[areaOf[b]].blocks.push(b);
    for (const b of this.buttons) if (areaOf[b] >= 0) result[areaOf[b]].buttons.push(b);
    return result;
  }

  /**
   * Whether the player can walk up to one of the area's blocks right now. A
   * puzzle behind a door the player has no key for yet is not judged: from
   * the outside it would look like a dead end.
   */
  private playerReaches(blocks: number[]): boolean {
    const reach = new Set(this.region(this.player, new Set(this.blocks)));
    // The player must be able to step into the block's cell from the neighbour it reaches.
    return blocks.some((b) => ORDERED_DIRECTIONS.some((dir) => reach.has(this.step(b, dir, -1))));
  }

  private areaIsStuck(blocks: number[], buttons: number[], budget: number): boolean {
    // Only a puzzle with enough blocks for its buttons, within the player's reach, is judged.
    if (buttons.length === 0 || blocks.length < buttons.length) return false;
    if (!this.playerReaches(blocks)) return false;
    const fixed = new Set(this.blocks.filter((b) => !blocks.includes(b)));
    const occupied = new Set(this.blocks);
    const freeButtons = buttons.filter((b) => !occupied.has(b));
    if (freeButtons.length === 0) return false;
    // Fast test: a loose block that can reach no free button, the others standing still.
    const cutOff = blocks.some((block) => {
      if (buttons.includes(block)) return false;
      const others = new Set(this.blocks.filter((b) => b !== block));
      return !this.singleBlockReaches(block, others, freeButtons);
    });
    return cutOff && this.search(blocks, buttons, fixed, budget).kind === 'exhausted';
  }

  /**
   * The moves that walk the player to the next useful push and make it: the
   * first push of a shortest push sequence covering every button of a block
   * puzzle still open. Null when every puzzle is done, stuck or too large.
   */
  public static hint(engine: GameEngine, budget: number = requestedSearchBudget()): Dir[] | null {
    const solver = new BlockPuzzleSolver(engine);
    const occupied = new Set(solver.blocks);
    for (const area of solver.areas()) {
      if (!area.modelled) continue;
      if (area.buttons.length === 0 || area.buttons.every((b) => occupied.has(b))) continue;
      if (area.blocks.length < area.buttons.length || !solver.playerReaches(area.blocks)) continue;
      const fixed = new Set(solver.blocks.filter((b) => !area.blocks.includes(b)));
      const outcome = solver.search(area.blocks, area.buttons, fixed, budget);
      if (outcome.kind !== 'covered') continue;
      let node = outcome.goal;
      while (outcome.nodes[node].parent > 0) node = outcome.nodes[node].parent;
      const first = outcome.nodes[node];
      if (first.pushDir === null) continue;
      const behind = solver.step(first.pushFrom, first.pushDir, -1);
      const walk = solver.walkPath(solver.player, behind, occupied);
      if (walk) return [...walk, first.pushDir];
    }
    return null;
  }

  private singleBlockReaches(block: number, others: Set<number>, targets: number[]): boolean {
    const keyOf = (b: number, region: number) => b * this.width * this.height + region;
    const startRegion = this.region(this.player, new Set([...others, block]));
    const seen = new Set([keyOf(block, Math.min(...startRegion))]);
    const queue: Array<{ b: number; reach: number[] }> = [{ b: block, reach: startRegion }];
    for (let i = 0; i < queue.length; i++) {
      const { b, reach } = queue[i];
      if (targets.includes(b)) return true;
      const reachSet = new Set(reach);
      for (const dir of ORDERED_DIRECTIONS) {
        const behind = this.step(b, dir, -1);
        const ahead = this.step(b, dir, 1);
        if (behind < 0 || ahead < 0 || !reachSet.has(behind)) continue;
        if (!this.blockOk[ahead] || others.has(ahead)) continue;
        const nextReach = this.region(b, new Set([...others, ahead]));
        const key = keyOf(ahead, Math.min(...nextReach));
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ b: ahead, reach: nextReach });
      }
    }
    return false;
  }

  /**
   * Breadth-first search over one area's block layouts, the player walking
   * freely between pushes; other blocks stay put. A covering result keeps
   * the search tree so the first push can be read back.
   */
  private search(areaBlocks: number[], buttons: number[], fixed: Set<number>, budget: number): SearchOutcome {
    const covered = (blocks: number[]) => buttons.every((b) => blocks.includes(b));
    const startBlocks = [...areaBlocks].sort((a, b) => a - b);
    const startReach = this.region(this.player, new Set([...startBlocks, ...fixed]));
    const keyOf = (blocks: number[], reach: number[]) => `${blocks.join(',')}|${Math.min(...reach)}`;
    const seen = new Set([keyOf(startBlocks, startReach)]);
    const nodes: SearchNode[] = [{ blocks: startBlocks, reach: startReach, parent: -1, pushFrom: -1, pushDir: null }];
    for (let i = 0; i < nodes.length; i++) {
      const { blocks, reach } = nodes[i];
      if (covered(blocks)) return { kind: 'covered', nodes, goal: i };
      // The reach is only read while a node is expanded; keeping it would hold a region per layout.
      nodes[i].reach = [];
      const blockSet = new Set([...blocks, ...fixed]);
      const reachSet = new Set(reach);
      for (const b of blocks) {
        for (const dir of ORDERED_DIRECTIONS) {
          const behind = this.step(b, dir, -1);
          const ahead = this.step(b, dir, 1);
          if (behind < 0 || ahead < 0 || !reachSet.has(behind)) continue;
          if (!this.blockOk[ahead] || blockSet.has(ahead)) continue;
          const next = blocks.map((c) => (c === b ? ahead : c)).sort((m, n) => m - n);
          const nextReach = this.region(b, new Set([...next, ...fixed]));
          const key = keyOf(next, nextReach);
          if (seen.has(key)) continue;
          if (seen.size >= budget) return { kind: 'budget' };
          seen.add(key);
          nodes.push({ blocks: next, reach: nextReach, parent: i, pushFrom: b, pushDir: dir });
        }
      }
    }
    return { kind: 'exhausted' };
  }

  /** Shortest walk between two cells without moving a block. */
  private walkPath(from: number, to: number, blocks: Set<number>): Dir[] | null {
    const parent = new Map<number, { cell: number; dir: Dir }>();
    const queue = [from];
    const seen = new Set([from]);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (cell === to) {
        const path: Dir[] = [];
        for (let c = to; c !== from; c = (parent.get(c) as { cell: number }).cell) {
          path.push((parent.get(c) as { dir: Dir }).dir);
        }
        return path.reverse();
      }
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(cell, dir, 1);
        if (n < 0 || seen.has(n) || blocks.has(n) || !this.playerOk[n]) continue;
        seen.add(n);
        parent.set(n, { cell, dir });
        queue.push(n);
      }
    }
    return null;
  }

  /** Cells the player reaches from `from` without moving a block. */
  private region(from: number, blocks: Set<number>): number[] {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(queue[i], dir, 1);
        if (n < 0 || seen.has(n) || blocks.has(n) || !this.playerOk[n]) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return queue;
  }

  /**
   * Neighbour of a cell, `sign` steps along `dir`; -1 outside the map or when
   * a thin wall or entry rule stops the step. With sign -1 it is the cell
   * behind, so the step checked is the one from there into `cell`.
   */
  private step(cell: number, dir: Dir, sign: 1 | -1): number {
    const x = (cell % this.width) + DIRECTION_VECTORS[dir].dx * sign;
    const y = Math.floor(cell / this.width) + DIRECTION_VECTORS[dir].dy * sign;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    const next = y * this.width + x;
    const stepFrom = sign === 1 ? cell : next;
    return this.edgeBlocked[stepFrom * ORDERED_DIRECTIONS.length + ORDERED_DIRECTIONS.indexOf(dir)] ? -1 : next;
  }
}
