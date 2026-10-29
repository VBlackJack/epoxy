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
 * backwards breadth-first: a layout at depth d needs at least d pushes.
 *
 * Candidates are ranked the way human-made Sokoban levels are judged: by
 * effective pushes (the pushes of a shortest solution, minus the forced
 * opening pushes and minus the trivial tail where every remaining block is
 * pushed straight home in one run), then by box lines plus box changes, which
 * reward interleaving the blocks. Goals may be forced into one connected
 * cluster, which reads as hand-made. Each candidate is finally solved again
 * by the real engine and passes the library's fairness rules.
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
const ROOMS_TRIED = 260;
const KEPT = 30;
/** Room interior sizes and block counts drawn per attempt. */
const ROOM_WIDTH: [number, number] = [5, 6];
const ROOM_HEIGHT: [number, number] = [4, 5];
const BLOCKS: [number, number] = [3, 4];
const WALL_DENSITY: [number, number] = [0.06, 0.22];
/** Share of rooms whose goals form one 4-connected cluster. */
const CONNECTED_GOALS_SHARE = 0.6;
/** Bound on the backward search, in layouts. */
const MAX_REVERSE_STATES = 120000;
/** Candidate depth window, in pushes: a mistake restarts a whole level, so no big warehouses. */
const MIN_PUSHES = 8;
const MAX_PUSHES = 22;
/** Layouts ranked per room, sampled evenly from the deepest ones. */
const CANDIDATES_PER_ROOM = 160;
/** Best distinct layouts of one room sent to the engine. */
const KEPT_PER_ROOM = 2;
/** A puzzle below these is not worth a piece. */
const MIN_EFFECTIVE_PUSHES = 7;
const MIN_BOX_CHANGES = 3;
const ENGINE_MAX_STATES = 40000;
/** Wall-clock budget of one run; the results found so far are written when it is spent. */
const TIME_BUDGET_MS = 20 * 60 * 1000;
/** Results are rewritten every this many rooms, so a long run can be read early. */
const WRITE_EVERY_ROOMS = 10;

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
  connected: boolean;
}

interface Metrics {
  pushes: number;
  opening: number;
  tail: number;
  effective: number;
  lines: number;
  changes: number;
}

interface Forged extends Metrics {
  rows: string[];
  trapLinks: Array<{ buttonX: number; buttonY: number; trapX: number; trapY: number }>;
  connected: boolean;
  moves: number;
  states: number;
  dead: number;
  reachable: number;
}

/** One layout of the backward search; `pulledFrom` and `pulledTo` describe the pull that made it. */
interface ReverseState {
  blocks: number[];
  reach: number[];
  parent: number;
  pulledFrom: number;
  pulledTo: number;
  depth: number;
}

interface Push {
  from: number;
  to: number;
}

interface Candidate {
  blocks: number[];
  metrics: Metrics;
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

/** Pushes available in a layout: (block, direction) pairs the player can reach. */
function legalPushes(room: Room, blocks: Set<number>, reach: number[]): number {
  const reachable = new Set(reach);
  let count = 0;
  for (const block of blocks) {
    const bx = block % room.w;
    const by = Math.floor(block / room.w);
    for (const [dx, dy] of DIRS) {
      const px = bx - dx;
      const py = by - dy;
      const tx = bx + dx;
      const ty = by + dy;
      if (px < 0 || py < 0 || px >= room.w || py >= room.h) continue;
      if (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) continue;
      const t = ty * room.w + tx;
      if (!reachable.has(py * room.w + px) || room.wall[t] || blocks.has(t)) continue;
      count++;
    }
  }
  return count;
}

/**
 * Scores a solution given as pushes from the start layout: effective pushes
 * (minus forced opening, minus trivial tail), box lines and box changes.
 */
function measure(room: Room, start: number[], pushes: Push[], playerStart: number): Metrics {
  const ids = new Map<number, number>(start.map((cell, i) => [cell, i]));
  const blocks = new Set(start);
  let player = playerStart;
  let opening = 0;
  let stillForced = true;
  let lines = 0;
  let changes = 0;
  let previousId = -1;
  let previousDelta = 0;
  const sequence: Array<{ id: number; delta: number }> = [];
  for (const push of pushes) {
    if (stillForced) {
      const reach = region(room, blocks, player);
      if (legalPushes(room, blocks, reach) === 1) opening++;
      else stillForced = false;
    }
    const id = ids.get(push.from) as number;
    const delta = push.to - push.from;
    if (id !== previousId) changes++;
    if (id !== previousId || delta !== previousDelta) lines++;
    sequence.push({ id, delta });
    previousId = id;
    previousDelta = delta;
    ids.delete(push.from);
    ids.set(push.to, id);
    blocks.delete(push.from);
    blocks.add(push.to);
    player = push.from;
  }
  // Trivial tail: whole trailing runs where a block is pushed straight, once.
  let tail = 0;
  const finished = new Set<number>();
  let end = sequence.length;
  while (end > opening) {
    const id = sequence[end - 1].id;
    let begin = end;
    while (begin > 0 && sequence[begin - 1].id === id) begin--;
    const straight = sequence.slice(begin, end).every((s) => s.delta === sequence[begin].delta);
    if (!straight || finished.has(id) || begin < opening) break;
    finished.add(id);
    tail += end - begin;
    end = begin;
  }
  return {
    pushes: pushes.length,
    opening,
    tail,
    effective: Math.max(0, pushes.length - opening - tail),
    lines,
    changes: Math.max(0, changes - 1)
  };
}

/**
 * Breadth-first search over pulls from the solved layout. A pull is the
 * reverse of a push: the player steps back away from a block it stands next
 * to, dragging the block along. Depth equals the fewest pushes forward. The
 * layouts where the player can stand at the entry become candidates, ranked
 * by the YASGen-style fitness.
 */
function bestStarts(room: Room, solvedPlayer: number): Candidate[] {
  const entryCell = room.entryX; // row 0 of the interior, just inside the entry port
  const keyOf = (blocks: number[], reach: number[]) => `${blocks.join(',')}|${Math.min(...reach)}`;
  const startBlocks = [...room.goals].sort((a, b) => a - b);
  const startReach = region(room, new Set(startBlocks), solvedPlayer);
  const states: ReverseState[] = [
    { blocks: startBlocks, reach: startReach, parent: -1, pulledFrom: -1, pulledTo: -1, depth: 0 }
  ];
  const seen = new Set([keyOf(startBlocks, startReach)]);
  const candidateIndexes: number[] = [];
  for (let head = 0; head < states.length && states.length < MAX_REVERSE_STATES; head++) {
    const state = states[head];
    if (state.depth >= MAX_PUSHES) break;
    const blockSet = new Set(state.blocks);
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
        const depth = state.depth + 1;
        states.push({ blocks, reach, parent: head, pulledFrom: b, pulledTo: p, depth });
        const onGoals = blocks.filter((c) => room.goals.includes(c)).length;
        if (depth >= MIN_PUSHES && onGoals === 0 && reach.includes(entryCell)) candidateIndexes.push(states.length - 1);
      }
    }
  }
  // Deepest layouts first, sampled evenly so one depth does not crowd the rest out.
  candidateIndexes.sort((a, b) => states[b].depth - states[a].depth);
  const stride = Math.max(1, Math.floor(candidateIndexes.length / CANDIDATES_PER_ROOM));
  const ranked: Candidate[] = [];
  for (let i = 0; i < candidateIndexes.length; i += stride) {
    const pushes: Push[] = [];
    for (let at = candidateIndexes[i]; states[at].parent >= 0; at = states[at].parent) {
      pushes.push({ from: states[at].pulledTo, to: states[at].pulledFrom });
    }
    ranked.push({ blocks: states[candidateIndexes[i]].blocks, metrics: measure(room, states[candidateIndexes[i]].blocks, pushes, entryCell) });
  }
  ranked.sort(
    (a, b) =>
      b.metrics.effective - a.metrics.effective || b.metrics.lines + b.metrics.changes - (a.metrics.lines + a.metrics.changes)
  );
  return ranked.slice(0, KEPT_PER_ROOM);
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
  const reach = region({ w, h, wall, goals: [], entryX, trapX, connected: false }, new Set(), entryX);
  if (reach.length !== open.length || !reach.includes((h - 1) * w + trapX)) return null;
  const blockCount = rng.nextInt(BLOCKS[0], BLOCKS[1]);
  const candidates = open.filter((c) => c !== entryX && c !== (h - 1) * w + trapX);
  if (candidates.length < blockCount + 4) return null;
  const connected = rng.next() < CONNECTED_GOALS_SHARE;
  let goals: number[];
  if (connected) {
    const grown = growCluster(w, candidates, blockCount, rng);
    if (!grown) return null;
    goals = grown;
  } else {
    rng.shuffle(candidates);
    goals = candidates.slice(0, blockCount);
  }
  return { w, h, wall, goals, entryX, trapX, connected };
}

/** Picks `size` open cells forming one 4-connected cluster, or null when none grows that far. */
function growCluster(w: number, candidates: number[], size: number, rng: SeededRandom): number[] | null {
  const allowed = new Set(candidates);
  const cluster = [candidates[rng.nextInt(0, candidates.length - 1)]];
  while (cluster.length < size) {
    const border = new Set<number>();
    for (const c of cluster) {
      for (const [dx, dy] of DIRS) {
        const x = (c % w) + dx;
        if (x < 0 || x >= w) continue;
        const n = c + dy * w + dx;
        if (allowed.has(n) && !cluster.includes(n)) border.add(n);
      }
    }
    if (border.size === 0) return null;
    const options = [...border];
    cluster.push(options[rng.nextInt(0, options.length - 1)]);
  }
  return cluster;
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

function writeResults(forged: Forged[]): void {
  forged.sort((a, b) => b.effective - a.effective || b.lines + b.changes - (a.lines + a.changes) || b.states - a.states);
  const out = forged.slice(0, KEPT).map(
    (f) =>
      `effective=${f.effective} pushes=${f.pushes} opening=${f.opening} tail=${f.tail} lines=${f.lines} changes=${f.changes} ` +
      `connected=${f.connected} moves=${f.moves} states=${f.states} dead=${Math.round((100 * f.dead) / f.reachable)}%\n` +
      `${f.rows.join('\n')}\n` +
      `${JSON.stringify({ rows: f.rows, trapLinks: f.trapLinks })}`
  );
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${forged.length} forged\n\n${out.join('\n\n')}\n`);
}

it('forges Sokoban pieces', () => {
  loadTestConfigs();
  const rng = new SeededRandom(FORGE_SEED);
  const legend = ConfigRegistry.getPieceLegend();
  const forged: Forged[] = [];
  const seenRows = new Set<string>();
  const startedAt = Date.now();
  for (let attempt = 0; attempt < ROOMS_TRIED && Date.now() - startedAt < TIME_BUDGET_MS; attempt++) {
    if (attempt % WRITE_EVERY_ROOMS === 0) writeResults(forged);
    const room = randomRoom(rng);
    if (!room) continue;
    for (const [index, candidate] of bestStarts(room, (room.h - 1) * room.w + room.trapX).entries()) {
      const metrics = candidate.metrics;
      if (metrics.effective < MIN_EFFECTIVE_PUSHES || metrics.changes < MIN_BOX_CHANGES) continue;
      const def = toDefinition(room, candidate.blocks, `sokoban_${attempt}_${index}`);
      if (seenRows.has(def.rows.join('/'))) continue;
      seenRows.add(def.rows.join('/'));
      const piece = compilePiece(def, legend);
      const solved = PieceSolver.solve(piece, { maxStates: ENGINE_MAX_STATES });
      if (!solved.moves) continue;
      const analysis = PieceSolver.analyze(piece, { maxStates: ENGINE_MAX_STATES * 2 });
      if (analysis.truncated || analysis.blockEscapes > 0 || analysis.deadExits > 0 || analysis.unreturnableGoals > 0) continue;
      forged.push({
        ...metrics,
        rows: def.rows,
        trapLinks: def.trapLinks ?? [],
        connected: room.connected,
        moves: solved.moves.length,
        states: solved.statesExplored,
        dead: analysis.deadStates,
        reachable: analysis.reachableStates
      });
    }
  }
  writeResults(forged);
});
