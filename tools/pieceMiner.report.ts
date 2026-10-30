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
 * Mines puzzle pieces: for each theme, random rooms are grown by hill
 * climbing towards harder puzzles (longer solutions, more block pushes, a
 * larger search), keeping only rooms the solver proves solvable. Survivors
 * then pass the library's fairness rules (no block escape, no unfinishable
 * exit, the theme's mechanic actually used). Results go to
 * local/mined-pieces.txt as motifs.json rows, for a human to curate.
 *
 * Run with: npm run mine:pieces
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { GameEngine } from '../src/core/GameEngine';
import { SeededRandom } from '../src/core/Random';
import { Direction } from '../src/core/types';
import { PieceSolver, SolverAction } from '../src/generator/PieceSolver';
import { CompiledPiece } from '../src/generator/PieceTypes';
import { IDENTITY_ORIENTATION } from '../src/generator/PieceCompiler';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'mined-pieces.txt');

const MINER_SEED = 20261029;
const RESTARTS_PER_THEME = 12;
const ITERATIONS_PER_RESTART = 220;
const MINING_MAX_STATES = 20000;
const KEPT_PER_THEME = 6;
/** Weights of the difficulty score. */
const PUSH_WEIGHT = 3;
const SEARCH_WEIGHT = 2;
/** Chance to keep a slightly worse room, so the climb can leave a local peak. */
const ACCEPT_WORSE_CHANCE = 0.05;
const BLOCK_ENTITY = 'dirt_block';

interface Theme {
  id: string;
  width: number;
  height: number;
  /** Interior terrain drawn on mutation, with relative weights. */
  palette: Array<[string, number]>;
  blocks: [number, number];
  chips: [number, number];
  /** Items placed once each (keys, boots). */
  items: string[];
  /** Terrain the winning run must stand on or push a block through, proving the theme is used. */
  mechanicTiles: string[];
  minPushes: number;
}

const THEMES: Theme[] = [
  { id: 'blocks_water', width: 8, height: 8, palette: [['floor', 6], ['wall', 3], ['water', 3]], blocks: [2, 4], chips: [1, 2], items: [], mechanicTiles: ['water'], minPushes: 3 },
  { id: 'bomb', width: 8, height: 7, palette: [['floor', 6], ['wall', 3]], blocks: [2, 3], chips: [1, 2], items: ['bomb', 'bomb'], mechanicTiles: [], minPushes: 3 },
  { id: 'force', width: 8, height: 8, palette: [['floor', 4], ['wall', 2], ['force_n', 1], ['force_e', 1], ['force_s', 1], ['force_w', 1]], blocks: [0, 1], chips: [2, 3], items: [], mechanicTiles: ['force_n', 'force_e', 'force_s', 'force_w'], minPushes: 0 },
  { id: 'ice', width: 8, height: 8, palette: [['ice', 6], ['wall', 2], ['floor', 1], ['ice_nw', 1], ['ice_ne', 1], ['ice_sw', 1], ['ice_se', 1]], blocks: [0, 0], chips: [2, 3], items: [], mechanicTiles: ['ice', 'ice_nw', 'ice_ne', 'ice_sw', 'ice_se'], minPushes: 0 },
  { id: 'keys_doors', width: 9, height: 7, palette: [['floor', 6], ['wall', 4], ['door_red', 1], ['door_blue', 1], ['door_yellow', 1]], blocks: [0, 0], chips: [1, 3], items: ['key_red', 'key_blue', 'key_yellow'], mechanicTiles: ['door_red', 'door_blue', 'door_yellow'], minPushes: 0 },
  { id: 'fire', width: 8, height: 8, palette: [['floor', 5], ['wall', 3], ['fire', 3], ['water', 2]], blocks: [0, 1], chips: [1, 3], items: ['boots_fire'], mechanicTiles: ['fire'], minPushes: 0 }
];

interface Room {
  terrain: string[][];
  items: (string | null)[][];
  blocks: Array<{ x: number; y: number }>;
  entry: { x: number; y: number };
  exit: { x: number; y: number };
}

interface Evaluated {
  room: Room;
  score: number;
  moves: number;
  pushes: number;
  states: number;
}

function toPiece(theme: Theme, room: Room): CompiledPiece {
  return {
    id: `mined_${theme.id}`,
    motif: theme.id,
    tier: 3,
    width: theme.width,
    height: theme.height,
    terrain: room.terrain.map((r) => [...r]),
    items: room.items.map((r) => [...r]),
    entities: room.blocks.map((b) => ({ ...b, type: BLOCK_ENTITY, dir: 'S' as Direction })),
    trapLinks: [],
    cloneLinks: [],
    exports: null,
    imports: null,
    entry: room.entry,
    exit: room.exit,
    requires: [],
    rotatable: true,
    oneShot: false,
    deadEnds: 0,
    orientation: IDENTITY_ORIENTATION
  };
}

function interiorCells(theme: Theme): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < theme.height - 1; y++) for (let x = 1; x < theme.width - 1; x++) cells.push({ x, y });
  return cells;
}

function weighted(rng: SeededRandom, palette: Array<[string, number]>): string {
  const total = palette.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [id, w] of palette) {
    roll -= w;
    if (roll < 0) return id;
  }
  return palette[0][0];
}

/** Cells that must stay plain floor: the ports and the cell just inside each. */
function reserved(room: Room, theme: Theme): Set<string> {
  const inside = (p: { x: number; y: number }) => ({
    x: p.x === 0 ? 1 : p.x === theme.width - 1 ? theme.width - 2 : p.x,
    y: p.y === 0 ? 1 : p.y === theme.height - 1 ? theme.height - 2 : p.y
  });
  return new Set([room.entry, room.exit, inside(room.entry), inside(room.exit)].map((p) => `${p.x},${p.y}`));
}

function freeFloorCell(rng: SeededRandom, room: Room, theme: Theme): { x: number; y: number } | null {
  const keep = reserved(room, theme);
  const cells = interiorCells(theme).filter(
    (c) =>
      room.terrain[c.y][c.x] === 'floor' &&
      !room.items[c.y][c.x] &&
      !room.blocks.some((b) => b.x === c.x && b.y === c.y) &&
      !keep.has(`${c.x},${c.y}`)
  );
  return cells.length > 0 ? cells[rng.nextInt(0, cells.length - 1)] : null;
}

function randomRoom(rng: SeededRandom, theme: Theme): Room {
  const terrain = Array.from({ length: theme.height }, (_, y) =>
    Array.from({ length: theme.width }, (_, x) =>
      x === 0 || y === 0 || x === theme.width - 1 || y === theme.height - 1 ? 'wall' : 'floor'
    )
  );
  const items = Array.from({ length: theme.height }, () => new Array<string | null>(theme.width).fill(null));
  const room: Room = {
    terrain,
    items,
    blocks: [],
    entry: { x: rng.nextInt(1, theme.width - 2), y: 0 },
    exit: { x: rng.nextInt(1, theme.width - 2), y: theme.height - 1 }
  };
  room.terrain[room.entry.y][room.entry.x] = 'floor';
  room.terrain[room.exit.y][room.exit.x] = 'floor';
  const keep = reserved(room, theme);
  for (const c of interiorCells(theme)) {
    if (!keep.has(`${c.x},${c.y}`)) room.terrain[c.y][c.x] = weighted(rng, theme.palette);
  }
  const place = (fill: (cell: { x: number; y: number }) => void, count: number) => {
    for (let i = 0; i < count; i++) {
      const cell = freeFloorCell(rng, room, theme);
      if (cell) fill(cell);
    }
  };
  place((c) => (room.items[c.y][c.x] = 'chip'), rng.nextInt(theme.chips[0], theme.chips[1]));
  for (const item of theme.items) place((c) => (room.items[c.y][c.x] = item), 1);
  place((c) => room.blocks.push(c), rng.nextInt(theme.blocks[0], theme.blocks[1]));
  return room;
}

function mutate(rng: SeededRandom, source: Room, theme: Theme): Room {
  const room: Room = {
    terrain: source.terrain.map((r) => [...r]),
    items: source.items.map((r) => [...r]),
    blocks: source.blocks.map((b) => ({ ...b })),
    entry: source.entry,
    exit: source.exit
  };
  const keep = reserved(room, theme);
  const cells = interiorCells(theme).filter((c) => !keep.has(`${c.x},${c.y}`));
  const roll = rng.next();
  if (roll < 0.6 || (room.blocks.length === 0 && theme.blocks[1] === 0)) {
    const c = cells[rng.nextInt(0, cells.length - 1)];
    if (!room.items[c.y][c.x] && !room.blocks.some((b) => b.x === c.x && b.y === c.y)) {
      room.terrain[c.y][c.x] = weighted(rng, theme.palette);
    }
  } else if (roll < 0.8 && room.blocks.length > 0) {
    const index = rng.nextInt(0, room.blocks.length - 1);
    const target = freeFloorCell(rng, room, theme);
    if (target) room.blocks[index] = target;
  } else {
    const placed = cells.filter((c) => room.items[c.y][c.x]);
    if (placed.length > 0) {
      const from = placed[rng.nextInt(0, placed.length - 1)];
      const target = freeFloorCell(rng, room, theme);
      if (target) {
        room.items[target.y][target.x] = room.items[from.y][from.x];
        room.items[from.y][from.x] = null;
      }
    }
  }
  return room;
}

/** Replays a solution, counting block pushes and checking the theme's tiles are used. */
function replayStats(piece: CompiledPiece, moves: SolverAction[], theme: Theme): { pushes: number; usesMechanic: boolean } {
  const engine = new GameEngine();
  engine.loadLevel(PieceSolver.toLevel(piece));
  let pushes = 0;
  let usesMechanic = theme.mechanicTiles.length === 0;
  const blockKey = () => engine.getEntities().map((e) => `${e.x},${e.y}`).sort().join(';');
  for (const action of moves) {
    const before = blockKey();
    const terrainBefore = engine.getTerrain().map((r) => r.join()).join('|');
    PieceSolver.play(engine, action);
    if (blockKey() !== before) pushes++;
    const p = engine.getPlayer();
    const under = engine.getTerrain()[p.y][p.x];
    if (theme.mechanicTiles.includes(under)) usesMechanic = true;
    // A block sunk into water or a door opened changes terrain: the theme was used.
    if (engine.getTerrain().map((r) => r.join()).join('|') !== terrainBefore && theme.mechanicTiles.length > 0) {
      usesMechanic = true;
    }
  }
  return { pushes, usesMechanic };
}

function evaluate(theme: Theme, room: Room): Evaluated | null {
  const piece = toPiece(theme, room);
  const result = PieceSolver.solve(piece, { maxStates: MINING_MAX_STATES });
  if (!result.solvable || !result.moves) return null;
  const { pushes, usesMechanic } = replayStats(piece, result.moves, theme);
  if (!usesMechanic || pushes < theme.minPushes) return null;
  const score = result.moves.length + PUSH_WEIGHT * pushes + SEARCH_WEIGHT * Math.log2(result.statesExplored);
  return { room, score, moves: result.moves.length, pushes, states: result.statesExplored };
}

/** The library's fairness rules plus: every key and pair of boots is needed. */
function isFair(theme: Theme, room: Room): boolean {
  const piece = toPiece(theme, room);
  const analysis = PieceSolver.analyze(piece, { maxStates: MINING_MAX_STATES * 3 });
  if (analysis.truncated || !analysis.winnable || analysis.blockEscapes > 0 || analysis.deadExits > 0) return false;
  for (let y = 0; y < theme.height; y++) {
    for (let x = 0; x < theme.width; x++) {
      const id = room.items[y][x];
      if (!id) continue;
      const kind = ConfigRegistry.getTile(id).collectible;
      if (kind !== 'key' && kind !== 'boot') continue;
      const items = room.items.map((r) => [...r]);
      items[y][x] = null;
      if (PieceSolver.solve(toPiece(theme, { ...room, items }), { maxStates: MINING_MAX_STATES }).solvable) return false;
    }
  }
  return true;
}

function toRows(room: Room): string[] {
  const legend = ConfigRegistry.getPieceLegend();
  const reverse = new Map<string, string>();
  for (const [ch, e] of Object.entries(legend)) {
    const key = `${e.terrain}|${e.item ?? ''}|${e.entity ?? ''}`;
    if (!e.port && !reverse.has(key)) reverse.set(key, ch);
  }
  return room.terrain.map((row, y) =>
    row
      .map((id, x) => {
        if (x === room.entry.x && y === room.entry.y) return '@';
        if (x === room.exit.x && y === room.exit.y) return '$';
        const block = room.blocks.some((b) => b.x === x && b.y === y) ? BLOCK_ENTITY : '';
        return reverse.get(`${id}|${room.items[y][x] ?? ''}|${block}`) ?? '?';
      })
      .join('')
  );
}

it('mines puzzle pieces', () => {
  loadTestConfigs();
  const rng = new SeededRandom(MINER_SEED);
  const out: string[] = [];
  for (const theme of THEMES) {
    const found: Evaluated[] = [];
    for (let restart = 0; restart < RESTARTS_PER_THEME; restart++) {
      let current: Evaluated | null = null;
      for (let i = 0; i < ITERATIONS_PER_RESTART; i++) {
        const candidate = current ? mutate(rng, current.room, theme) : randomRoom(rng, theme);
        const evaluated = evaluate(theme, candidate);
        if (!evaluated) continue;
        if (!current || evaluated.score >= current.score || rng.next() < ACCEPT_WORSE_CHANCE) current = evaluated;
      }
      if (current && isFair(theme, current.room)) found.push(current);
    }
    const unique = new Map(found.map((f) => [toRows(f.room).join('/'), f]));
    const best = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, KEPT_PER_THEME);
    out.push(`## ${theme.id}: ${found.length} fair of ${RESTARTS_PER_THEME}`);
    for (const f of best) {
      out.push(`score=${f.score.toFixed(1)} moves=${f.moves} pushes=${f.pushes} states=${f.states}`);
      out.push(JSON.stringify(toRows(f.room)));
    }
    out.push('');
  }
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${out.join('\n')}\n`);
});
