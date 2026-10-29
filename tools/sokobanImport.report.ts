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
 * Adapts a Sokoban collection in the standard XSB text format into Epoxy
 * pieces. Boxes become blocks, goals become brown buttons, and each button
 * holds open one trap of a column leading to a new exit; a shaft is cut from
 * the top border to the player's area as the entrance. Only levels small
 * enough for a hub wing are kept, and each must pass the solver and the
 * library's fairness rules. Results go to local/sokoban-import.txt as
 * motifs.json entries carrying a credit line.
 *
 * Only use collections whose licence allows reuse; credit their authors.
 *
 * Run with:
 *   EPOXY_SOKOBAN_FILE=path/to/collection.xsb EPOXY_SOKOBAN_CREDIT="Title by Author" npm run import:sokoban
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { compilePiece } from '../src/generator/PieceCompiler';
import { PieceSolver } from '../src/generator/PieceSolver';
import { PieceDefinition } from '../src/generator/PieceTypes';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'sokoban-import.txt');
/** Largest piece kept, in cells, so it fits a hub wing on the 32x32 map. */
const MAX_PIECE_WIDTH = 11;
const MAX_PIECE_HEIGHT = 12;
const ENGINE_MAX_STATES = 150000;

/** XSB characters. */
const XSB_WALL = '#';
const XSB_BOX = '$';
const XSB_GOAL = '.';
const XSB_BOX_ON_GOAL = '*';
const XSB_PLAYER = '@';
const XSB_PLAYER_ON_GOAL = '+';
const XSB_LEVEL_CHARS = /^[#$.*@+ \-_]+$/;

/** Epoxy piece legend characters (see public/configs/motifs.json). */
const WALL = '#';
const FLOOR = '.';
const BLOCK = '&';
const BUTTON = 'm';
const BLOCK_ON_BUTTON = 'o';
const TRAP = 'X';
const ENTRY = '@';
const EXIT = '$';

interface XsbLevel {
  title: string;
  lines: string[];
}

function parseCollection(text: string): XsbLevel[] {
  const levels: XsbLevel[] = [];
  let lines: string[] = [];
  let title = '';
  const flush = () => {
    if (lines.length > 0) levels.push({ title: title || `#${levels.length + 1}`, lines });
    lines = [];
    title = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line.length > 0 && XSB_LEVEL_CHARS.test(line) && line.includes(XSB_WALL)) {
      lines.push(line);
    } else {
      flush();
      if (line.toLowerCase().startsWith('title:')) title = line.slice('title:'.length).trim();
      else if (line.startsWith(';')) title = line.slice(1).trim();
    }
  }
  flush();
  return levels;
}

/** Converts one XSB level, or returns null when it cannot become a piece. */
function convert(level: XsbLevel, credit: string, index: number): PieceDefinition | null {
  const height = level.lines.length;
  const width = Math.max(...level.lines.map((l) => l.length));
  const at = (x: number, y: number) => level.lines[y]?.[x] ?? ' ';
  let player: { x: number; y: number } | null = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) === XSB_PLAYER || at(x, y) === XSB_PLAYER_ON_GOAL) player = { x, y };
    }
  }
  if (!player) return null;

  // The playable area is what the player reaches, ignoring boxes; the rest is wall.
  const inside = new Set<string>();
  const queue = [player];
  inside.add(`${player.x},${player.y}`);
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return null;
      if (at(nx, ny) === XSB_WALL || inside.has(`${nx},${ny}`)) continue;
      inside.add(`${nx},${ny}`);
      queue.push({ x: nx, y: ny });
    }
  }
  const cells = [...inside].map((k) => k.split(',').map(Number) as [number, number]);
  const minX = Math.min(...cells.map((c) => c[0])) - 1;
  const minY = Math.min(...cells.map((c) => c[1])) - 1;
  const roomW = Math.max(...cells.map((c) => c[0])) - minX + 2;
  const roomH = Math.max(...cells.map((c) => c[1])) - minY + 2;

  const goals: Array<[number, number]> = [];
  const grid: string[][] = Array.from({ length: roomH }, (_, y) =>
    Array.from({ length: roomW }, (_, x) => {
      const sx = x + minX;
      const sy = y + minY;
      if (!inside.has(`${sx},${sy}`)) return WALL;
      const ch = at(sx, sy);
      if (ch === XSB_GOAL || ch === XSB_PLAYER_ON_GOAL) {
        goals.push([x, y]);
        return BUTTON;
      }
      if (ch === XSB_BOX_ON_GOAL) {
        goals.push([x, y]);
        return BLOCK_ON_BUTTON;
      }
      if (ch === XSB_BOX) return BLOCK;
      return FLOOR;
    })
  );
  const boxes = grid.flat().filter((c) => c === BLOCK || c === BLOCK_ON_BUTTON).length;
  if (goals.length === 0 || goals.length !== boxes) return null;

  // Entrance: a shaft from a new top row down to the topmost open cell of a column.
  const top = new Array<string>(roomW).fill(WALL);
  const shafts: number[] = [];
  for (let x = 1; x < roomW - 1; x++) {
    const firstOpen = grid.findIndex((row) => row[x] !== WALL);
    if (firstOpen > 0 && grid[firstOpen][x] === FLOOR) shafts.push(x);
  }
  // Exit: a column of traps under the lowest open cell of a column.
  const exits: number[] = [];
  for (let x = 1; x < roomW - 1; x++) {
    const lastOpen = grid.map((row) => row[x]).lastIndexOf(FLOOR);
    if (lastOpen > 0 && grid.slice(lastOpen + 1).every((row) => row[x] === WALL)) exits.push(x);
  }
  for (const ex of shafts) {
    for (const tx of exits) {
      const rows = [top, ...grid.map((row) => [...row])];
      rows[0][ex] = ENTRY;
      for (let y = 1; rows[y][ex] === WALL; y++) rows[y][ex] = FLOOR;
      const lastOpen = rows.map((row) => row[tx]).lastIndexOf(FLOOR);
      for (let y = lastOpen + 1; y < rows.length; y++) rows[y][tx] = FLOOR;
      const trapLinks = goals.map(([gx, gy]) => {
        const trapRow = new Array<string>(roomW).fill(WALL);
        trapRow[tx] = TRAP;
        rows.push(trapRow);
        return { buttonX: gx, buttonY: gy + 1, trapX: tx, trapY: rows.length - 1 };
      });
      const exitRow = new Array<string>(roomW).fill(WALL);
      exitRow[tx] = EXIT;
      rows.push(exitRow);
      if (roomW > MAX_PIECE_WIDTH || rows.length > MAX_PIECE_HEIGHT) return null;
      const def: PieceDefinition = {
        id: `sokoban_import_${index}_${ex}_${tx}`,
        motif: 'sokoban',
        tier: 3,
        rotatable: true,
        rows: rows.map((r) => r.join('')),
        trapLinks,
        credit: `${credit}, ${level.title}`
      };
      if (passes(def)) return def;
    }
  }
  return null;
}

function passes(def: PieceDefinition): boolean {
  try {
    const piece = compilePiece(def, ConfigRegistry.getPieceLegend());
    if (!PieceSolver.solve(piece, { maxStates: ENGINE_MAX_STATES }).solvable) return false;
    const a = PieceSolver.analyze(piece, { maxStates: ENGINE_MAX_STATES * 2 });
    return !a.truncated && a.blockEscapes === 0 && a.deadExits === 0 && a.unreturnableGoals === 0;
  } catch {
    return false;
  }
}

it('imports a Sokoban collection', () => {
  const file = process.env.EPOXY_SOKOBAN_FILE;
  if (!file || !existsSync(file)) {
    console.warn('Set EPOXY_SOKOBAN_FILE to an .xsb collection whose licence allows reuse.');
    return;
  }
  const credit = process.env.EPOXY_SOKOBAN_CREDIT ?? file;
  loadTestConfigs();
  const levels = parseCollection(readFileSync(file, 'utf-8'));
  const kept = levels.map((level, i) => convert(level, credit, i + 1)).filter((d): d is PieceDefinition => d !== null);
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(
    OUTPUT_FILE,
    `${kept.length} of ${levels.length} levels adapted\n\n${kept.map((d) => JSON.stringify(d)).join('\n\n')}\n`
  );
});
