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

/**
 * Forges Sokoban pieces by working backwards from the solution. A room gets
 * as many brown buttons (the goals) as blocks; each button holds open one
 * trap of the column leading to the exit, so the exit opens only once every
 * block rests on a button. Starting from the solved room, blocks are pulled
 * backwards breadth-first: the deepest reachable layout is the start of a
 * puzzle that needs at least that many pushes. Each candidate is then solved
 * again by the real engine and passes the library's fairness rules.
 * Results go to local/sokoban-forge.txt as motifs.json entries to curate.
 *
 * Run with: npm run forge:sokoban
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { SeededRandom } from '../src/core/Random';
import { compilePiece } from '../src/generator/PieceCompiler';
import { PieceSolver } from '../src/generator/PieceSolver';
import { PieceDefinition } from '../src/generator/PieceTypes';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'sokoban-forge.txt');

const FORGE_SEED = 20261030;
const ROOMS_TRIED = 400;
const KEPT = 24;
/** Room interior sizes and block counts drawn per attempt. */
const ROOM_WIDTH: [number, number] = [5, 7];
const ROOM_HEIGHT: [number, number] = [4, 6];
const BLOCKS: [number, number] = [2, 3];
const WALL_DENSITY: [number, number] = [0.08, 0.25];
/** Bound on the backward search, in layouts. */
const MAX_REVERSE_STATES = 150000;
/** Puzzles needing fewer pushes than this are not worth a piece. */
const MIN_PUSHES = 6;
const ENGINE_MAX_STATES = 120000;

const WALL = '#';
const FLOOR = '.';
const BLOCK = '&';
const BUTTON = 'm';
const TRAP = 'X';
const ENTRY = '@';
const EXIT = '$';
const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
] as const;

interface Room {
  w: number;
  h: number;
  /** True for wall cells, interior coordinates 0..w-1, 0..h-1. */
  wall: boolean[];
  goals: number[];
  entryX: number;
  trapX: number;
}

interface Forged {
  rows: string[];
  trapLinks: Array<{ buttonX: number; buttonY: number; trapX: number; trapY: number }>;
  pushes: number;
  moves: number;
  states: number;
  dead: number;
  reachable: number;
}

/** Cells reachable from `from` without moving a block. */
function region(room: Room, blocks: Set<number>, from: number): number[] {
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const x = c % room.w;
    const y = Math.floor(c / room.w);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= room.w || ny >= room.h) continue;
      const n = ny * room.w + nx;
      if (room.wall[n] || blocks.has(n) || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return queue;
}

/**
 * Breadth-first search over pulls from the solved layout. A pull is the
 * reverse of a push: the player steps back away from a block it stands next
 * to, dragging the block along. Depth equals the fewest pushes forward.
 */
function deepestStart(room: Room, solvedPlayer: number): { blocks: number[]; pushes: number } | null {
  const entryCell = room.entryX; // row 0 of the interior, just inside the entry port
  const keyOf = (blocks: number[], reach: number[]) => `${blocks.join(',')}|${Math.min(...reach)}`;
  const startBlocks = [...room.goals].sort((a, b) => a - b);
  const startReach = region(room, new Set(startBlocks), solvedPlayer);
  const seen = new Set([keyOf(startBlocks, startReach)]);
  let frontier: Array<{ blocks: number[]; reach: number[] }> = [{ blocks: startBlocks, reach: startReach }];
  let best: { blocks: number[]; pushes: number } | null = null;
  let depth = 0;
  while (frontier.length > 0 && seen.size < MAX_REVERSE_STATES) {
    const next: typeof frontier = [];
    for (const state of frontier) {
      const blockSet = new Set(state.blocks);
      const onGoals = state.blocks.filter((b) => room.goals.includes(b)).length;
      if (depth > 0 && onGoals === 0 && state.reach.includes(entryCell)) best = { blocks: state.blocks, pushes: depth };
      for (const p of state.reach) {
        const x = p % room.w;
        const y = Math.floor(p / room.w);
        for (const [dx, dy] of DIRS) {
          // Block on one side of the player, free cell on the other: pull it.
          const bx = x - dx;
          const by = y - dy;
          const tx = x + dx;
          const ty = y + dy;
          if (bx < 0 || by < 0 || bx >= room.w || by >= room.h) continue;
          if (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) continue;
          const b = by * room.w + bx;
          const t = ty * room.w + tx;
          if (!blockSet.has(b) || room.wall[t] || blockSet.has(t)) continue;
          const blocks = state.blocks.map((c) => (c === b ? p : c)).sort((m, n) => m - n);
          const reach = region(room, new Set(blocks), t);
          const key = keyOf(blocks, reach);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ blocks, reach });
        }
      }
    }
    frontier = next;
    depth++;
  }
  return best;
}

function randomRoom(rng: SeededRandom): Room | null {
  const w = rng.nextInt(ROOM_WIDTH[0], ROOM_WIDTH[1]);
  const h = rng.nextInt(ROOM_HEIGHT[0], ROOM_HEIGHT[1]);
  const density = WALL_DENSITY[0] + rng.next() * (WALL_DENSITY[1] - WALL_DENSITY[0]);
  const entryX = rng.nextInt(0, w - 1);
  const trapX = rng.nextInt(0, w - 1);
  const wall = Array.from({ length: w * h }, () => rng.next() < density);
  // Bent entrances: the cell inside each port stays open, the next one in is
  // walled, so no block can be pushed out through a port.
  wall[entryX] = false;
  if (h > 2) wall[w + entryX] = true;
  wall[(h - 1) * w + trapX] = false;
  if (h > 2) wall[(h - 2) * w + trapX] = true;
  const open = wall.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const reach = region({ w, h, wall, goals: [], entryX, trapX }, new Set(), entryX);
  if (reach.length !== open.length || !reach.includes((h - 1) * w + trapX)) return null;
  const blockCount = rng.nextInt(BLOCKS[0], BLOCKS[1]);
  const candidates = open.filter((c) => c !== entryX && c !== (h - 1) * w + trapX);
  rng.shuffle(candidates);
  if (candidates.length < blockCount + 4) return null;
  return { w, h, wall, goals: candidates.slice(0, blockCount), entryX, trapX };
}

function toDefinition(room: Room, blocks: number[], id: string): PieceDefinition {
  const k = room.goals.length;
  const width = room.w + 2;
  const height = room.h + k + 2;
  const grid: string[][] = Array.from({ length: height }, () => new Array<string>(width).fill(WALL));
  for (let i = 0; i < room.w * room.h; i++) {
    const x = (i % room.w) + 1;
    const y = Math.floor(i / room.w) + 1;
    grid[y][x] = room.wall[i] ? WALL : FLOOR;
  }
  room.goals.forEach((g) => (grid[Math.floor(g / room.w) + 1][(g % room.w) + 1] = BUTTON));
  blocks.forEach((b) => (grid[Math.floor(b / room.w) + 1][(b % room.w) + 1] = BLOCK));
  grid[0][room.entryX + 1] = ENTRY;
  const trapLinks = room.goals.map((g, i) => {
    grid[room.h + 1 + i][room.trapX + 1] = TRAP;
    return { buttonX: (g % room.w) + 1, buttonY: Math.floor(g / room.w) + 1, trapX: room.trapX + 1, trapY: room.h + 1 + i };
  });
  grid[height - 1][room.trapX + 1] = EXIT;
  return { id, motif: 'sokoban', tier: 3, rotatable: true, rows: grid.map((r) => r.join('')), trapLinks };
}

it('forges Sokoban pieces', () => {
  loadTestConfigs();
  const rng = new SeededRandom(FORGE_SEED);
  const legend = ConfigRegistry.getPieceLegend();
  const forged: Forged[] = [];
  const seenRows = new Set<string>();
  for (let attempt = 0; attempt < ROOMS_TRIED; attempt++) {
    const room = randomRoom(rng);
    if (!room) continue;
    const start = deepestStart(room, (room.h - 1) * room.w + room.trapX);
    if (!start || start.pushes < MIN_PUSHES) continue;
    const def = toDefinition(room, start.blocks, `sokoban_${attempt}`);
    if (seenRows.has(def.rows.join('/'))) continue;
    seenRows.add(def.rows.join('/'));
    const piece = compilePiece(def, legend);
    const solved = PieceSolver.solve(piece, { maxStates: ENGINE_MAX_STATES });
    if (!solved.moves) continue;
    const analysis = PieceSolver.analyze(piece, { maxStates: ENGINE_MAX_STATES * 2 });
    if (analysis.truncated || analysis.blockEscapes > 0 || analysis.deadExits > 0 || analysis.unreturnableGoals > 0) continue;
    forged.push({
      rows: def.rows,
      trapLinks: def.trapLinks ?? [],
      pushes: start.pushes,
      moves: solved.moves.length,
      states: solved.statesExplored,
      dead: analysis.deadStates,
      reachable: analysis.reachableStates
    });
  }
  forged.sort((a, b) => b.pushes - a.pushes || b.states - a.states);
  const out = forged.slice(0, KEPT).map(
    (f) =>
      `pushes=${f.pushes} moves=${f.moves} states=${f.states} dead=${Math.round((100 * f.dead) / f.reachable)}%\n` +
      `${JSON.stringify({ rows: f.rows, trapLinks: f.trapLinks })}`
  );
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${forged.length} forged\n\n${out.join('\n\n')}\n`);
});
