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
 * Adapts Sokoban levels in the standard XSB text format into Epoxy pieces.
 * Boxes become blocks and goals become brown buttons; each button holds open
 * one trap of the exit tunnel, so the exit opens only once every block rests
 * on a button, which is the Sokoban win.
 *
 * Both tunnels are carved through the rock around the room, on any side and
 * through any dead space the level leaves, along shortest paths that touch
 * the room only where they open into it. The entry opens into the area the
 * level starts the player in, so the puzzle stays the author's. The exit
 * opens into a pocket where the player can stand once every box is home,
 * found by a Sokoban search, so a last push that leaves the player in a
 * corner no longer loses the level. The traps run along the tunnel instead of
 * stacking one row each, and a layout too wide is transposed. Every layout
 * finally goes through the real engine and the library's fairness rules; a
 * level that cannot be kept says why.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { compilePiece } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece, PieceDefinition } from './PieceTypes';

/** Largest piece kept, in cells, so it fits a hub wing on the 32x32 map; a transposed fit counts. */
export const XSB_MAX_PIECE_WIDTH = 11;
export const XSB_MAX_PIECE_HEIGHT = 12;
/** Rock kept around a room for the tunnels, in cells: beyond it no piece would fit anyway. */
const TUNNEL_MARGIN = 4;
/** Engine bounds of the final check, the same as the hand-made pieces get. */
const ENGINE_SOLVE_STATES = 150000;
const ENGINE_ANALYZE_STATES = 300000;
/** Layouts of one level sent to the engine, best ranked first. */
const ENGINE_ATTEMPTS = 6;

/** XSB characters; '-' and '_' are floor, like a space. */
const XSB_WALL = '#';
const XSB_BOX = '$';
const XSB_GOAL = '.';
const XSB_BOX_ON_GOAL = '*';
const XSB_PLAYER = '@';
const XSB_PLAYER_ON_GOAL = '+';
const XSB_LEVEL_CHARS = /^[#$.*@+ \-_]+$/;
const XSB_TITLE_PREFIX = 'title:';
const XSB_COMMENT_PREFIX = ';';

/** Epoxy piece legend characters (see public/configs/motifs.json). */
const WALL = '#';
const FLOOR = '.';
const BLOCK = '&';
const BUTTON = 'm';
const BLOCK_ON_BUTTON = 'o';
const TRAP = 'X';
const ENTRY = '@';
const EXIT = '$';

const PIECE_MOTIF = 'sokoban';
const PIECE_TIER = 3;
const PIECE_ID_PREFIX = 'sokoban_import_';

export interface XsbLevel {
  title: string;
  lines: string[];
}

/** Why a level was not kept, in the order the checks run. */
export type XsbRejection =
  | 'no_player'
  | 'open_room'
  | 'box_goal_mismatch'
  | 'unsolved'
  | 'too_many_states'
  | 'no_entry'
  | 'no_exit'
  | 'too_large'
  | 'no_layout'
  | 'invalid_piece'
  | 'engine_unsolved'
  | 'engine_truncated'
  | 'block_escape'
  | 'dead_exit'
  | 'unreturnable';

export interface XsbImportResult {
  piece: PieceDefinition | null;
  /** Set when piece is null: the reason of the best ranked layout. */
  rejection?: XsbRejection;
}

/** Splits a collection into levels, titled by a "Title:" line or a ';' comment. */
export function parseXsbCollection(text: string): XsbLevel[] {
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
      if (line.toLowerCase().startsWith(XSB_TITLE_PREFIX)) title = line.slice(XSB_TITLE_PREFIX.length).trim();
      else if (line.startsWith(XSB_COMMENT_PREFIX)) title = line.slice(XSB_COMMENT_PREFIX.length).trim();
    }
  }
  flush();
  return levels;
}

/**
 * The level on a grid padded with rock on every side. Cells are indexed
 * y * width + x; the room never touches the padding's edge.
 */
interface Room {
  width: number;
  height: number;
  /** Cells the player reaches from the start, ignoring boxes. */
  inside: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
  offsets: number[];
  /** Bounds of the inside cells. */
  bounds: Bounds;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A tunnel from a room cell out to a port: cells[0] touches the anchor, the last is the port. */
interface Tunnel {
  anchor: number;
  cells: number[];
}

interface Layout extends Bounds {
  entry: Tunnel;
  exit: Tunnel;
  transposed: boolean;
  sameArea: boolean;
  /** Tunnels no box can be pushed out through, 0 to 2. */
  escapeProof: number;
}

/** Converts one level, or says why it cannot become a piece. */
export function importXsbLevel(level: XsbLevel, credit: string, index: number): XsbImportResult {
  const parsed = parseRoom(level);
  if (typeof parsed === 'string') return { piece: null, rejection: parsed };
  const room = parsed;
  const roomW = room.bounds.maxX - room.bounds.minX + 3;
  const roomH = room.bounds.maxY - room.bounds.minY + 3;
  const roomFits = roomW <= XSB_MAX_PIECE_WIDTH && roomH <= XSB_MAX_PIECE_HEIGHT;
  const roomFitsTransposed = roomH <= XSB_MAX_PIECE_WIDTH && roomW <= XSB_MAX_PIECE_HEIGHT;
  if (!roomFits && !roomFitsTransposed) return { piece: null, rejection: 'too_large' };

  const search = searchSolutions(room, ENGINE_ANALYZE_STATES);
  if (search.truncated) return { piece: null, rejection: 'too_many_states' };
  if (!search.solved) return { piece: null, rejection: 'unsolved' };

  const occupied = new Uint8Array(room.inside.length);
  for (const b of room.boxes) occupied[b] = 1;
  const startArea = flood(room, room.player, occupied);
  const entryAnchors = startArea.filter((c) => !occupied[c]);
  const entries = carveTunnels(room, entryAnchors, 1, null).filter((t) => canBePort(room, t));
  if (entries.length === 0) return { piece: null, rejection: 'no_entry' };

  // Areas of the solved room, where every box covers a goal: the entry should share the exit's.
  const homeArea = areasOf(room, room.goal);
  const exitAnchors = [...search.finalCells];
  const minExitLength = room.boxes.length + 1;
  const layouts: Layout[] = [];
  let exitFound = false;
  for (const entry of entries) {
    const forbidden = new Uint8Array(room.inside.length);
    for (const c of entry.cells) {
      forbidden[c] = 1;
      for (const n of neighbours(room, c)) forbidden[n] = 1;
    }
    for (const exit of carveTunnels(room, exitAnchors, minExitLength, forbidden).filter((t) => canBePort(room, t))) {
      exitFound = true;
      const layout = fitLayout(room, entry, exit);
      if (layout) {
        layout.sameArea = homeArea[entry.anchor] !== 0 && homeArea[entry.anchor] === homeArea[exit.anchor];
        layout.escapeProof = Number(isEscapeProof(room, entry)) + Number(isEscapeProof(room, exit));
        layouts.push(layout);
      }
    }
  }
  if (!exitFound) return { piece: null, rejection: 'no_exit' };
  // Tunnels exist, but none pairs up with both ports on the border of a piece small enough.
  if (layouts.length === 0) return { piece: null, rejection: 'no_layout' };

  layouts.sort(
    (a, b) =>
      b.escapeProof - a.escapeProof ||
      Number(b.sameArea) - Number(a.sameArea) ||
      area(a) - area(b) ||
      a.entry.cells.length + a.exit.cells.length - (b.entry.cells.length + b.exit.cells.length)
  );
  const tried = new Set<string>();
  let rejection: XsbRejection | undefined;
  for (const layout of layouts) {
    if (tried.size >= ENGINE_ATTEMPTS) break;
    const def = buildPiece(room, layout, `${PIECE_ID_PREFIX}${index}`, `${credit}, ${level.title}`);
    const key = def.rows.join('\n');
    if (tried.has(key)) continue;
    tried.add(key);
    const verdict = engineVerdict(def);
    if (verdict === null) return { piece: def };
    rejection ??= verdict;
  }
  return { piece: null, rejection };
}

function parseRoom(level: XsbLevel): Room | XsbRejection {
  const srcH = level.lines.length;
  const srcW = Math.max(...level.lines.map((l) => l.length));
  const at = (x: number, y: number) => level.lines[y]?.[x] ?? ' ';
  const width = srcW + 2 * TUNNEL_MARGIN;
  const height = srcH + 2 * TUNNEL_MARGIN;
  const offsets = [-width, 1, width, -1];
  const cell = (x: number, y: number) => (y + TUNNEL_MARGIN) * width + x + TUNNEL_MARGIN;

  let start: { x: number; y: number } | null = null;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      if (at(x, y) === XSB_PLAYER || at(x, y) === XSB_PLAYER_ON_GOAL) start = { x, y };
    }
  }
  if (!start) return 'no_player';

  // The room is what the player reaches, ignoring boxes; everything else is rock.
  const inside = new Uint8Array(width * height);
  const queue = [start];
  inside[cell(start.x, start.y)] = 1;
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= srcW || ny >= srcH) return 'open_room';
      if (at(nx, ny) === XSB_WALL || inside[cell(nx, ny)]) continue;
      inside[cell(nx, ny)] = 1;
      queue.push({ x: nx, y: ny });
    }
  }

  const goal = new Uint8Array(width * height);
  const boxes: number[] = [];
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const c = cell(x, y);
      if (!inside[c]) continue;
      const ch = at(x, y);
      if (ch === XSB_GOAL || ch === XSB_PLAYER_ON_GOAL || ch === XSB_BOX_ON_GOAL) goal[c] = 1;
      if (ch === XSB_BOX || ch === XSB_BOX_ON_GOAL) boxes.push(c);
    }
  }
  const goals = goal.reduce((n, g) => n + g, 0);
  if (goals === 0 || goals !== boxes.length) return 'box_goal_mismatch';
  const xs = queue.map((p) => p.x + TUNNEL_MARGIN);
  const ys = queue.map((p) => p.y + TUNNEL_MARGIN);
  const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { width, height, inside, goal, boxes, player: cell(start.x, start.y), offsets, bounds };
}

/** Cells of the room the player reaches from a cell, around the blocked ones. */
function flood(room: Room, from: number, blocked: Uint8Array): number[] {
  const seen = new Uint8Array(room.inside.length);
  const region = [from];
  seen[from] = 1;
  for (let i = 0; i < region.length; i++) {
    for (const off of room.offsets) {
      const n = region[i] + off;
      if (!room.inside[n] || blocked[n] || seen[n]) continue;
      seen[n] = 1;
      region.push(n);
    }
  }
  return region;
}

/** Labels the connected areas of the room around the blocked cells, from 1; blocked and rock get 0. */
function areasOf(room: Room, blocked: Uint8Array): Int32Array {
  const label = new Int32Array(room.inside.length);
  let next = 0;
  for (let c = 0; c < room.inside.length; c++) {
    if (!room.inside[c] || blocked[c] || label[c]) continue;
    next++;
    for (const r of flood(room, c, blocked)) label[r] = next;
  }
  return label;
}

/**
 * Cells a box can still be pushed home from, ignoring the other boxes: a
 * box pushed anywhere else is dead, which prunes the search.
 */
function liveCells(room: Room): Uint8Array {
  const live = new Uint8Array(room.inside.length);
  const queue: number[] = [];
  for (let c = 0; c < room.goal.length; c++) {
    if (room.goal[c]) {
      live[c] = 1;
      queue.push(c);
    }
  }
  // Pulling a box from c to c - off needs the player at c - off, stepping back to c - 2 off.
  for (let i = 0; i < queue.length; i++) {
    for (const off of room.offsets) {
      const to = queue[i] - off;
      if (room.inside[to] && room.inside[to - off] && !live[to]) {
        live[to] = 1;
        queue.push(to);
      }
    }
  }
  return live;
}

interface SolutionSearch {
  solved: boolean;
  /** True when the search outgrew its budget before ending. */
  truncated: boolean;
  /** Cells the player can stand on in some solved state reached from the start. */
  finalCells: Set<number>;
}

/**
 * Explores every state of the Sokoban level: the boxes, and the area the
 * player can walk in. The budget counts player positions, which is how the
 * engine counts states, so outgrowing it means the engine's own analysis
 * would be truncated too.
 */
function searchSolutions(room: Room, budget: number): SolutionSearch {
  const live = liveCells(room);
  const occupied = new Uint8Array(room.inside.length);
  const finalCells = new Set<number>();
  const keyOf = (boxes: number[], player: number): string => {
    for (const b of boxes) occupied[b] = 1;
    const region = flood(room, player, occupied);
    for (const b of boxes) occupied[b] = 0;
    return `${boxes.join(',')}|${Math.min(...region)}`;
  };
  const startBoxes = [...room.boxes].sort((a, b) => a - b);
  const queue: Array<{ boxes: number[]; player: number }> = [{ boxes: startBoxes, player: room.player }];
  const seen = new Set<string>([keyOf(startBoxes, room.player)]);
  let positions = 0;
  let solved = false;

  for (let head = 0; head < queue.length; head++) {
    const { boxes, player } = queue[head];
    for (const b of boxes) occupied[b] = 1;
    const region = flood(room, player, occupied);
    positions += region.length;
    if (positions > budget) return { solved, truncated: true, finalCells };
    if (boxes.every((b) => room.goal[b])) {
      solved = true;
      for (const c of region) finalCells.add(c);
    }
    const pushes: Array<{ boxes: number[]; player: number }> = [];
    for (const p of region) {
      for (const off of room.offsets) {
        const box = p + off;
        const to = box + off;
        if (!occupied[box] || !room.inside[to] || occupied[to] || !live[to]) continue;
        pushes.push({ boxes: boxes.map((c) => (c === box ? to : c)).sort((a, b) => a - b), player: box });
      }
    }
    for (const b of boxes) occupied[b] = 0;
    for (const next of pushes) {
      const key = keyOf(next.boxes, next.player);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return { solved, truncated: false, finalCells };
}

function neighbours(room: Room, c: number): number[] {
  const x = c % room.width;
  const y = Math.floor(c / room.width);
  const out: number[] = [];
  if (y > 0) out.push(c - room.width);
  if (x < room.width - 1) out.push(c + 1);
  if (y < room.height - 1) out.push(c + room.width);
  if (x > 0) out.push(c - 1);
  return out;
}

/**
 * Carves tunnels breadth-first through the rock from the anchors. A tunnel
 * touches the room only with its first cell, next to its anchor, so it is
 * no side door; and as a shortest path it never touches itself either.
 * Returns one tunnel per cell at least minLength away, that cell being the
 * port.
 */
function carveTunnels(room: Room, anchors: number[], minLength: number, forbidden: Uint8Array | null): Tunnel[] {
  const size = room.inside.length;
  const isAnchor = new Uint8Array(size);
  for (const a of anchors) isAnchor[a] = 1;
  const insideNeighbours = (c: number): number[] => neighbours(room, c).filter((n) => room.inside[n]);
  const parent = new Int32Array(size).fill(-1);
  const anchorOf = new Int32Array(size).fill(-1);
  const depth = new Int32Array(size);
  const queue: number[] = [];
  for (const a of anchors) {
    for (const c of neighbours(room, a)) {
      if (room.inside[c] || anchorOf[c] !== -1 || forbidden?.[c]) continue;
      const touching = insideNeighbours(c);
      if (touching.length !== 1 || !isAnchor[touching[0]]) continue;
      anchorOf[c] = a;
      depth[c] = 1;
      queue.push(c);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const n of neighbours(room, c)) {
      if (room.inside[n] || anchorOf[n] !== -1 || forbidden?.[n]) continue;
      if (insideNeighbours(n).length > 0) continue;
      anchorOf[n] = anchorOf[c];
      parent[n] = c;
      depth[n] = depth[c] + 1;
      queue.push(n);
    }
  }
  const tunnels: Tunnel[] = [];
  for (const port of queue) {
    if (depth[port] < minLength) continue;
    const cells: number[] = [];
    for (let c = port; c !== -1; c = parent[c]) cells.push(c);
    tunnels.push({ anchor: anchorOf[port], cells: cells.reverse() });
  }
  return tunnels;
}

/**
 * Whether no box can be pushed out through the tunnel's port. Pushing one in
 * from the anchor needs the player on the far side of it, which may be rock;
 * and a box pushed in only goes straight, so a bend stops it, dead like a
 * box pushed into any corner.
 */
function isEscapeProof(room: Room, tunnel: Tunnel): boolean {
  const step = tunnel.cells[0] - tunnel.anchor;
  if (!room.inside[tunnel.anchor - step]) return true;
  return tunnel.cells.some((c, i) => c !== tunnel.anchor + (i + 1) * step);
}

/**
 * Whether a tunnel's last cell can be a port at all: on or beyond the wall
 * ring of the room, and close enough for the piece to fit either way round.
 */
function canBePort(room: Room, tunnel: Tunnel): boolean {
  const port = tunnel.cells[tunnel.cells.length - 1];
  const x = port % room.width;
  const y = Math.floor(port / room.width);
  const { minX, minY, maxX, maxY } = room.bounds;
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) return false;
  const reach = Math.max(XSB_MAX_PIECE_WIDTH, XSB_MAX_PIECE_HEIGHT) - 1;
  return x > maxX - reach && x < minX + reach && y > maxY - reach && y < minY + reach;
}

/**
 * Bounds the room and both tunnels with a wall ring, and keeps the layout
 * when each port lands on that ring, off its corners, within the size limit.
 */
function fitLayout(room: Room, entry: Tunnel, exit: Tunnel): Layout | null {
  let { minX, minY, maxX, maxY } = room.bounds;
  const include = (c: number) => {
    const x = c % room.width;
    const y = Math.floor(c / room.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const t of [entry, exit]) t.cells.slice(0, -1).forEach(include);
  minX--;
  minY--;
  maxX++;
  maxY++;
  for (const t of [entry, exit]) {
    const port = t.cells[t.cells.length - 1];
    const x = port % room.width;
    const y = Math.floor(port / room.width);
    if (x < minX || x > maxX || y < minY || y > maxY) return null;
    const onSide = x === minX || x === maxX;
    const onEnd = y === minY || y === maxY;
    if (onSide === onEnd) return null;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const fits = w <= XSB_MAX_PIECE_WIDTH && h <= XSB_MAX_PIECE_HEIGHT;
  const fitsTransposed = h <= XSB_MAX_PIECE_WIDTH && w <= XSB_MAX_PIECE_HEIGHT;
  if (!fits && !fitsTransposed) return null;
  return { entry, exit, minX, minY, maxX, maxY, transposed: !fits, sameArea: false, escapeProof: 0 };
}

function area(layout: Layout): number {
  return (layout.maxX - layout.minX + 1) * (layout.maxY - layout.minY + 1);
}

/** Draws the layout as motifs.json rows; the traps are the tunnel cells just before the exit. */
function buildPiece(room: Room, layout: Layout, id: string, credit: string): PieceDefinition {
  const chars = new Map<number, string>();
  const box = new Set(room.boxes);
  for (let c = 0; c < room.inside.length; c++) {
    if (!room.inside[c]) continue;
    if (room.goal[c]) chars.set(c, box.has(c) ? BLOCK_ON_BUTTON : BUTTON);
    else chars.set(c, box.has(c) ? BLOCK : FLOOR);
  }
  for (const c of layout.entry.cells) chars.set(c, FLOOR);
  chars.set(layout.entry.cells[layout.entry.cells.length - 1], ENTRY);
  const exitCells = layout.exit.cells;
  for (const c of exitCells) chars.set(c, FLOOR);
  const traps = exitCells.slice(exitCells.length - 1 - room.boxes.length, exitCells.length - 1);
  for (const c of traps) chars.set(c, TRAP);
  chars.set(exitCells[exitCells.length - 1], EXIT);

  // Local coordinates, swapped when the layout only fits transposed.
  const local = (c: number): { x: number; y: number } => {
    const x = (c % room.width) - layout.minX;
    const y = Math.floor(c / room.width) - layout.minY;
    return layout.transposed ? { x: y, y: x } : { x, y };
  };
  const w = layout.maxX - layout.minX + 1;
  const h = layout.maxY - layout.minY + 1;
  const [outW, outH] = layout.transposed ? [h, w] : [w, h];
  const rows: string[][] = Array.from({ length: outH }, () => new Array<string>(outW).fill(WALL));
  for (const [c, ch] of chars) {
    const { x, y } = local(c);
    rows[y][x] = ch;
  }
  const goals: number[] = [];
  for (let c = 0; c < room.goal.length; c++) if (room.goal[c]) goals.push(c);
  const trapLinks = goals.map((g, i) => {
    const button = local(g);
    const trap = local(traps[i]);
    return { buttonX: button.x, buttonY: button.y, trapX: trap.x, trapY: trap.y };
  });
  return {
    id,
    motif: PIECE_MOTIF,
    tier: PIECE_TIER,
    rotatable: true,
    rows: rows.map((r) => r.join('')),
    trapLinks,
    credit
  };
}

/** Runs the real engine and the library's fairness rules; null when the piece is kept. */
function engineVerdict(def: PieceDefinition): XsbRejection | null {
  let piece: CompiledPiece;
  try {
    piece = compilePiece(def, ConfigRegistry.getPieceLegend());
  } catch {
    return 'invalid_piece';
  }
  const solved = PieceSolver.solve(piece, { maxStates: ENGINE_SOLVE_STATES });
  if (!solved.solvable) return solved.truncated ? 'engine_truncated' : 'engine_unsolved';
  const a = PieceSolver.analyze(piece, { maxStates: ENGINE_ANALYZE_STATES });
  if (a.truncated) return 'engine_truncated';
  if (a.blockEscapes > 0) return 'block_escape';
  if (a.deadExits > 0) return 'dead_exit';
  if (a.unreturnableGoals > 0) return 'unreturnable';
  return null;
}
