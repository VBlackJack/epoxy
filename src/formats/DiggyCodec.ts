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
 * Decoder and converter for Diggy's Adventure mine floor JSON definitions
 * (`floors_*.json`, runtime `MineData` / `CommandSynchronize` payloads, and
 * browser `.har` network captures). Reconstructs the room and corridor topology,
 * diggable dirt tiles, collectible tokens, levers/gates, laser/mirror puzzles,
 * boulder pressure-plate doors, grappling-glove pull recesses, and teleporter
 * pairs into native Epoxy levels proven solvable end-to-end.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DEFAULT_LEVEL_PASSWORD, DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import {
  CHIP_ITEM_ID,
  DEFAULT_FACING,
  DEFAULT_RULESET,
  DEFAULT_WIN_RULE,
  EXIT_TILE_ID,
  FLOOR_TILE_ID,
  OPPOSITE_DIRECTION,
  WALL_TILE_ID,
  reflectOnMirror
} from '../core/coreConstants';
import { GameEngine } from '../core/GameEngine';
import type {
  CellUnderlay,
  ChannelColor,
  CompiledLevel,
  Direction,
  EntityPlacement,
  GridPoint
} from '../core/types';

/** File pattern matching multi-file selections of Diggy floor JSON or HAR files. */
const DIGGY_FLOOR_FILE_PATTERN = /^(?:floors_\d+.*|.*\.diggy)\.json$|\.har$/i;

/** Background ID representing solid void rock in Diggy floor definitions. */
const DIGGY_VOID_BG_ID = 5;
/** Default stone background ID in newer Diggy floor definitions. */
const DIGGY_STONE_BG_ID = 1;
/** Runtime tile ID representing dug/open floor in Diggy beacon actions. */
const DIGGY_OPEN_TILE_ID = 5;
/** Runtime tile subtype representing an impassable wall in Diggy runtime MineData. */
const DIGGY_WALL_SUBTYPE = 153;
/** Runtime tile status representing dug/cleared floor in Diggy beacon actions. */
const DIGGY_CLEARED_STATUS = 2;
/** Upper bound on loot area minimum count before an area is treated as a system dummy. */
const MAX_PLAYABLE_LOOT_MIN = 999;
/** Minimum open cells required for a floor to form a playable puzzle level. */
const MIN_OPEN_CELLS = 4;
/** Minimum upstream reachable cells required before a lever gate door. */
const MIN_GATE_UPSTREAM_CELLS = 4;
/** Minimum cells in a secondary connected component to link via a teleporter pair. */
const MIN_TELEPORT_COMPONENT_CELLS = 6;
/** Maximum teleporter pairs supported by native Epoxy teleport channels. */
const MAX_TELEPORT_PAIRS = 5;
/** Maximum block puzzles placed per converted floor. */
const MAX_BLOCK_PUZZLES_PER_FLOOR = 2;
/** Maximum laser and mirror puzzles placed per converted floor. */
const MAX_LASER_PUZZLES_PER_FLOOR = 2;
/** Maximum open cells a laser beam corridor may span inside a room. */
const MAX_BEAM_CORRIDOR_CELLS = 10;
/** Maximum key/door lever gates placed per converted floor. */
const MAX_LEVER_GATES_PER_FLOOR = 3;
/** Maximum ratio of open floor cells that may be filled with diggable dirt. */
const MAX_DIRT_RATIO = 0.35;
/** Default untimed time limit for converted mine floors. */
const UNTIMED_SECONDS = 0;
/** Maximum recursion depth when unwrapping HAR or CommandSynchronize envelopes. */
const MAX_JSON_UNWRAP_DEPTH = 6;
/** Maximum object nodes visited when unwrapping HAR or CommandSynchronize envelopes. */
const MAX_JSON_UNWRAP_NODES = 5000;
/** Block entity type placed for push, pull, and pit beacons. */
const PUSH_BLOCK_ENTITY_ID = 'dirt_block';
/** Collectible item ID of the Grappling Gloves (`boots_pull`). */
const BOOTS_PULL_ITEM_ID = 'boots_pull';
/** Mirror block entity IDs for `/` and `\` laser reflection. */
const MIRROR_SLASH_ENTITY_ID = 'mirror_slash';
const MIRROR_BACKSLASH_ENTITY_ID = 'mirror_backslash';
/** Terrain ID of diggable dirt. */
const DIRT_TILE_ID = 'dirt';
/** Terrain ID of water pits filled by pushed dirt blocks. */
const WATER_TILE_ID = 'water';
/** Terrain ID of the exit socket. */
const SOCKET_TILE_ID = 'socket';

/** Native Epoxy teleport tile IDs in channel order. */
const TELEPORT_TILE_IDS: readonly string[] = [
  'teleport',
  'teleport_red',
  'teleport_blue',
  'teleport_yellow',
  'teleport_green'
];

/** Colour channels used for boulder pressure plates and hold doors. */
const PLATE_CHANNEL_COLORS: readonly ChannelColor[] = ['red', 'blue'];

/** Colour channels used for laser receivers and laser gates. */
const LASER_CHANNEL_COLORS: readonly ChannelColor[] = ['red', 'blue'];

/** Key and door pairs used to represent one-way lever gates (`activation: "use"`). */
const KEY_DOOR_CHANNELS: ReadonlyArray<{ readonly keyId: string; readonly doorId: string }> = [
  { keyId: 'key_yellow', doorId: 'door_yellow' },
  { keyId: 'key_red', doorId: 'door_red' },
  { keyId: 'key_blue', doorId: 'door_blue' },
  { keyId: 'key_green', doorId: 'door_green' }
];

/** Theme IDs mapped from Diggy floor environment attributes. */
const THEME_ARCTIC = 'arctic_lab';
const THEME_MAGMA = 'magma_core';
const THEME_CYBER = 'cyber_neon';

/** Why a non-placeholder floor in a Diggy JSON payload was skipped. */
export type DiggySkipReason = 'bad_size' | 'too_few_open_cells' | 'unsolvable';

export interface DiggySkippedFloor {
  readonly floorId: number;
  readonly title: string;
  readonly reason: DiggySkipReason;
}

export interface DiggyDecodeResult {
  readonly levels: CompiledLevel[];
  readonly skipped: DiggySkippedFloor[];
}

interface RawDiggyFloor {
  readonly def_id?: number;
  readonly floor_id?: number;
  readonly name?: string;
  readonly rows?: number;
  readonly columns?: number;
  readonly progress?: number;
  readonly underwater?: number;
  readonly bg_id?: number;
  readonly blocked?: unknown;
  readonly blocked_tiles?: unknown;
  readonly backgrounds?: { readonly background?: unknown };
  readonly loot_areas?: { readonly loot_area?: unknown };
  readonly entrances?: { readonly entrance?: unknown };
  readonly exits?: { readonly exit?: unknown };
  readonly teleports?: { readonly teleport?: unknown };
  readonly tutorial_system?: { readonly triggers?: { readonly trigger?: unknown } };
  readonly beacons?: { readonly beacon?: unknown };
  readonly tiles?: unknown;
}

interface RawBeaconPart {
  readonly part_id?: number;
  readonly req_drag?: number;
  readonly req_light?: number;
  readonly activation?: string;
  readonly gr_clip?: unknown;
}

interface RawBeaconAction {
  readonly tiles?: unknown;
  readonly layer?: string;
  readonly values?: unknown;
}

interface RawBeacon {
  readonly beacon_id?: number;
  readonly parts?: { readonly part?: unknown };
  readonly actions?: { readonly action?: unknown };
}

interface RawLootArea {
  readonly area_id?: number;
  readonly object_id?: number;
  readonly type?: string;
  readonly min?: number;
  readonly max?: number;
  readonly tiles?: unknown;
}

interface RawTrigger {
  readonly row?: number;
  readonly column?: number;
  readonly target_object_id?: number;
  readonly target_object_type?: unknown;
}

interface RawTeleport {
  readonly teleport_id?: number;
  readonly target_teleport_id?: number;
  readonly beacon_id?: number;
}

interface RawExit {
  readonly exit_id?: number;
  readonly beacon_id?: number;
}

interface RawRuntimeTile {
  readonly x?: number;
  readonly y?: number;
  readonly row?: number;
  readonly column?: number;
  readonly type?: string;
  readonly subtype?: number;
  readonly status?: number;
}

/** True when a file name matches the Diggy floor naming pattern for multi-file import. */
export function isDiggyFloorFileName(name: string): boolean {
  return DIGGY_FLOOR_FILE_PATTERN.test(name);
}

/** Normalizes an XML-to-JSON element field that may be undefined, a single item, or an array. */
function asArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return [];
  return [value as T];
}

/** Decodes a HAR response content string (plain text or base64) into a parsed JSON value, or null. */
function parseHarEntryContent(content: Record<string, unknown>): unknown {
  if (typeof content.mimeType === 'string' && /^(?:image|audio|video|font)\//i.test(content.mimeType)) {
    return null;
  }
  const rawText = content.text;
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  let decoded = rawText.trim();
  if (content.encoding === 'base64') {
    try {
      if (typeof atob === 'function') {
        decoded = atob(decoded).trim();
      }
    } catch {
      return null;
    }
  }
  if (!decoded.startsWith('{') && !decoded.startsWith('[')) return null;
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
}

/**
 * Extracts raw Diggy floor definitions from direct CDN floor JSON (`floors_*.json`),
 * `CommandSynchronize` / `MineData` envelopes, or browser `.har` network captures.
 */
function extractRawFloors(parsed: unknown): RawDiggyFloor[] {
  const floors: RawDiggyFloor[] = [];
  let visitedNodes = 0;

  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > MAX_JSON_UNWRAP_DEPTH || visitedNodes >= MAX_JSON_UNWRAP_NODES) {
      return;
    }
    visitedNodes++;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }
      return;
    }

    const obj = node as Record<string, unknown>;

    // 1. Direct floor containers (`floor` or `floors`).
    if ('floor' in obj && (Array.isArray(obj.floor) || (obj.floor && typeof obj.floor === 'object'))) {
      for (const item of asArray<RawDiggyFloor>(obj.floor)) {
        if (item && typeof item === 'object' && typeof item.rows === 'number' && typeof item.columns === 'number') {
          floors.push(item);
        }
      }
      return;
    }
    if ('floors' in obj && (Array.isArray(obj.floors) || (obj.floors && typeof obj.floors === 'object'))) {
      for (const item of asArray<RawDiggyFloor>(obj.floors)) {
        if (item && typeof item === 'object' && typeof item.rows === 'number' && typeof item.columns === 'number') {
          floors.push(item);
        }
      }
      return;
    }

    // 2. Single floor or runtime MineData object (`rows` + `columns` + Diggy floor/tile fields).
    if (
      typeof obj.rows === 'number' &&
      typeof obj.columns === 'number' &&
      ('floor_id' in obj || 'def_id' in obj || 'blocked' in obj || 'blocked_tiles' in obj || 'tiles' in obj)
    ) {
      floors.push(obj as RawDiggyFloor);
      return;
    }

    // 3. Browser DevTools HAR archive (`{ log: { entries: [...] } }`).
    if ('log' in obj && obj.log && typeof obj.log === 'object') {
      const entries = (obj.log as Record<string, unknown>).entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (visitedNodes >= MAX_JSON_UNWRAP_NODES) break;
          visitedNodes++;
          if (!entry || typeof entry !== 'object') continue;
          const response = (entry as Record<string, unknown>).response;
          if (!response || typeof response !== 'object') continue;
          const content = (response as Record<string, unknown>).content;
          if (!content || typeof content !== 'object') continue;
          const inner = parseHarEntryContent(content as Record<string, unknown>);
          if (inner) visit(inner, depth + 1);
        }
        return;
      }
    }

    // 4. Known envelope keys in CommandSynchronize / MineData responses.
    const envelopeKeys = ['location', 'locations', 'mine', 'mine_data', 'commands', 'data', 'response', 'result'];
    for (const key of envelopeKeys) {
      if (key in obj && obj[key] && typeof obj[key] === 'object') {
        visit(obj[key], depth + 1);
      }
    }
  };

  visit(parsed, 0);
  return floors;
}

/** True when `parsed` is a Diggy's Adventure floor JSON object, CommandSynchronize payload, or HAR capture. */
export function isDiggyJson(parsed: unknown): boolean {
  return extractRawFloors(parsed).length > 0;
}

/** Parses `"r,c;r,c"` strings into `{ x: col, y: row }` coordinates within `[0..width-1, 0..height-1]`. */
function parseRowColList(raw: unknown, width: number, height: number): GridPoint[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const points: GridPoint[] = [];
  for (const token of raw.split(';')) {
    const parts = token.split(',');
    if (parts.length !== 2) continue;
    const row = Number(parts[0]);
    const col = Number(parts[1]);
    if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < height && col >= 0 && col < width) {
      points.push({ x: col, y: row });
    }
  }
  return points;
}

/** Parses `"r_c;r_c"` blocked strings into `{ x: col, y: row }` coordinates. */
function parseBlockedUnderscoreList(raw: unknown, width: number, height: number): GridPoint[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const points: GridPoint[] = [];
  for (const token of raw.split(';')) {
    const parts = token.split('_');
    if (parts.length !== 2) continue;
    const row = Number(parts[0]);
    const col = Number(parts[1]);
    if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < height && col >= 0 && col < width) {
      points.push({ x: col, y: row });
    }
  }
  return points;
}

/** Parses `"col,row;col,row"` `blocked_tiles` strings into `{ x: col, y: row }` coordinates. */
function parseBlockedColRowList(raw: unknown, width: number, height: number): GridPoint[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const points: GridPoint[] = [];
  for (const token of raw.split(';')) {
    const parts = token.split(',');
    if (parts.length !== 2) continue;
    const col = Number(parts[0]);
    const row = Number(parts[1]);
    if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < height && col >= 0 && col < width) {
      points.push({ x: col, y: row });
    }
  }
  return points;
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Chooses an Epoxy visual theme matching the Diggy floor environment. */
function selectTheme(floor: RawDiggyFloor, beacons: readonly RawBeacon[]): string {
  if (floor.underwater === 1) return THEME_ARCTIC;
  for (const beacon of beacons) {
    for (const part of asArray<RawBeaconPart>(beacon.parts?.part)) {
      if (typeof part.gr_clip === 'string' && part.gr_clip.includes('ice')) {
        return THEME_ARCTIC;
      }
    }
  }
  if (floor.bg_id === DIGGY_STONE_BG_ID) return THEME_MAGMA;
  return THEME_CYBER;
}

/**
 * Reconstructs the boolean open-cell mask (`true` = walkable interior, `false` = wall)
 * from a Diggy floor's `backgrounds`, `blocked_tiles`, `blocked`, `loot_areas`,
 * `beacons.actions`, or optional runtime `tiles`.
 */
function buildOpenMask(
  floor: RawDiggyFloor,
  width: number,
  height: number,
  beacons: readonly RawBeacon[],
  lootAreas: readonly RawLootArea[]
): boolean[][] {
  const open: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false));

  // Optional runtime MineData tiles array takes precedence when provided.
  const runtimeTiles = asArray<RawRuntimeTile>(floor.tiles);
  if (runtimeTiles.length > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) open[y][x] = true;
    }
    for (const tile of runtimeTiles) {
      const x = typeof tile.x === 'number' ? tile.x : tile.column;
      const y = typeof tile.y === 'number' ? tile.y : tile.row;
      if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x >= width || y < 0 || y >= height) continue;
      if (tile.type === 'wall' || tile.subtype === DIGGY_WALL_SUBTYPE) {
        open[y][x] = false;
      } else {
        open[y][x] = true;
      }
    }
    return open;
  }

  const bgGrid: number[][] = Array.from({ length: height }, () =>
    Array<number>(width).fill(typeof floor.bg_id === 'number' ? floor.bg_id : 0)
  );
  for (const bg of asArray<{ id?: number; tiles?: unknown }>(floor.backgrounds?.background)) {
    const bgId = Number(bg.id ?? 0);
    for (const pt of parseRowColList(bg.tiles, width, height)) {
      bgGrid[pt.y][pt.x] = bgId;
    }
  }

  const blockedTilesPts = parseBlockedColRowList(floor.blocked_tiles, width, height);
  if (blockedTilesPts.length > 0) {
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const blockedSet = new Set<string>();
    for (const pt of blockedTilesPts) {
      blockedSet.add(pointKey(pt.x, pt.y));
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          open[y][x] = !blockedSet.has(pointKey(x, y));
        } else {
          const bg = bgGrid[y][x];
          open[y][x] = bg !== DIGGY_VOID_BG_ID && bg !== DIGGY_STONE_BG_ID;
        }
      }
    }
  } else {
    const hasNonVoidBg = bgGrid.some((row) => row.some((id) => id !== DIGGY_VOID_BG_ID));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        open[y][x] = !hasNonVoidBg || bgGrid[y][x] !== DIGGY_VOID_BG_ID;
      }
    }
  }

  for (const pt of parseBlockedUnderscoreList(floor.blocked, width, height)) {
    open[pt.y][pt.x] = false;
  }

  // Interactive cells modified by beacon actions (bridges, gates, drag targets) are openable.
  for (const beacon of beacons) {
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      const layer = action.layer ?? '';
      const isInteractiveLayer =
        layer === 'misc' ||
        layer === 'drag' ||
        layer === 'drag_swap' ||
        (layer === 'id' && String(action.values) !== String(DIGGY_OPEN_TILE_ID)) ||
        (layer === 'status' && Number(action.values) === DIGGY_CLEARED_STATUS);
      if (!isInteractiveLayer) continue;
      for (const pt of parseRowColList(action.tiles, width, height)) {
        open[pt.y][pt.x] = true;
      }
    }
  }

  // Playable loot cells sitting on a blocked border are diggable caches when adjacent to open floor.
  const lootCandidates: GridPoint[] = [];
  for (const area of lootAreas) {
    if (area.type === 'system' || Number(area.min ?? 0) >= MAX_PLAYABLE_LOOT_MIN) continue;
    for (const pt of parseRowColList(area.tiles, width, height)) {
      lootCandidates.push(pt);
    }
  }
  for (const pt of lootCandidates) {
    if (open[pt.y][pt.x]) continue;
    const touchesOpen = ORDERED_DIRECTIONS.some((dir) => {
      const vec = DIRECTION_VECTORS[dir];
      const nx = pt.x + vec.dx;
      const ny = pt.y + vec.dy;
      return nx >= 0 && nx < width && ny >= 0 && ny < height && open[ny][nx];
    });
    if (touchesOpen) {
      open[pt.y][pt.x] = true;
    }
  }

  return open;
}

/** Finds all orthogonal connected components of open cells, sorted largest first. */
function findOpenComponents(open: boolean[][], width: number, height: number): GridPoint[][] {
  const visited: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  const components: GridPoint[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!open[y][x] || visited[y][x]) continue;
      const queue: GridPoint[] = [{ x, y }];
      visited[y][x] = true;
      for (let i = 0; i < queue.length; i++) {
        const cur = queue[i];
        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = cur.x + vec.dx;
          const ny = cur.y + vec.dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && open[ny][nx] && !visited[ny][nx]) {
            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny });
          }
        }
      }
      components.push(queue);
    }
  }

  components.sort((a, b) => b.length - a.length);
  return components;
}

/** Counts how many orthogonal neighbors of `(x, y)` are open in `activeMask`. */
function countOpenNeighbors(activeMask: boolean[][], x: number, y: number, width: number, height: number): number {
  let count = 0;
  for (const dir of ORDERED_DIRECTIONS) {
    const vec = DIRECTION_VECTORS[dir];
    const nx = x + vec.dx;
    const ny = y + vec.dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height && activeMask[ny][nx]) {
      count++;
    }
  }
  return count;
}

/**
 * Picks an interior cell in `component` suitable for a teleporter pad: must not be in `reserved`,
 * and prefers cells with 3 or 4 open neighbors so `teleportPlayer` always has free exit neighbors.
 */
function pickTeleportPadCell(
  component: readonly GridPoint[],
  activeMask: boolean[][],
  reserved: ReadonlySet<string>,
  width: number,
  height: number
): GridPoint | null {
  let best: GridPoint | null = null;
  let bestScore = -1;
  for (const pt of component) {
    const key = pointKey(pt.x, pt.y);
    if (reserved.has(key)) continue;
    let freeNeighbors = 0;
    for (const dir of ORDERED_DIRECTIONS) {
      const vec = DIRECTION_VECTORS[dir];
      const nx = pt.x + vec.dx;
      const ny = pt.y + vec.dy;
      if (
        nx >= 0 &&
        nx < width &&
        ny >= 0 &&
        ny < height &&
        activeMask[ny][nx] &&
        !reserved.has(pointKey(nx, ny))
      ) {
        freeNeighbors++;
      }
    }
    if (freeNeighbors >= 2 && freeNeighbors > bestScore) {
      best = pt;
      bestScore = freeNeighbors;
      if (freeNeighbors === 4) break;
    }
  }
  return best;
}

/** Reserves a cell and its orthogonal neighbors. */
function reserveNeighborhood(cell: GridPoint, reserved: Set<string>, width: number, height: number): void {
  reserved.add(pointKey(cell.x, cell.y));
  for (const dir of ORDERED_DIRECTIONS) {
    const vec = DIRECTION_VECTORS[dir];
    const nx = cell.x + vec.dx;
    const ny = cell.y + vec.dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      reserved.add(pointKey(nx, ny));
    }
  }
}

/** Computes BFS distances from `start` over `activeMask`, treating any key in `blockedKeys` as impassable. */
function bfsDistances(
  activeMask: boolean[][],
  start: GridPoint,
  width: number,
  height: number,
  blockedKeys?: ReadonlySet<string>
): Map<string, number> {
  const dist = new Map<string, number>();
  const startKey = pointKey(start.x, start.y);
  if (!activeMask[start.y]?.[start.x] || blockedKeys?.has(startKey)) return dist;

  const queue: GridPoint[] = [start];
  dist.set(startKey, 0);

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(pointKey(cur.x, cur.y))!;
    for (const dir of ORDERED_DIRECTIONS) {
      const vec = DIRECTION_VECTORS[dir];
      const nx = cur.x + vec.dx;
      const ny = cur.y + vec.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || !activeMask[ny][nx]) continue;
      const nKey = pointKey(nx, ny);
      if (blockedKeys?.has(nKey)) continue;
      if (!dist.has(nKey)) {
        dist.set(nKey, d + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
}

interface CarvedVaultPocket {
  readonly entryCell: GridPoint;
  readonly gateCell: GridPoint;
  readonly vaultCell: GridPoint;
}

/**
 * Finds and reserves an isolated 2-cell vault pocket (`gateCell` + `vaultCell`) in the walls
 * adjacent to a reachable unreserved open cell `entryCell` in `mainComp`. Every orthogonal neighbor
 * of `gateCell` (other than `entryCell` and `vaultCell`) and of `vaultCell` (other than `gateCell`)
 * must be an uncarved wall or map boundary so the vault chip can only be reached through `gateCell`.
 */
function carveVaultPocket(
  activeMask: boolean[][],
  terrain: string[][],
  reserved: Set<string>,
  mainComp: readonly GridPoint[],
  reachDist: ReadonlyMap<string, number>,
  width: number,
  height: number
): CarvedVaultPocket | null {
  const isSolidBoundaryOrWall = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return true;
    return !activeMask[y][x] && terrain[y][x] === WALL_TILE_ID;
  };

  for (const entryCell of mainComp) {
    const eKey = pointKey(entryCell.x, entryCell.y);
    if (!reachDist.has(eKey) || reserved.has(eKey)) continue;

    for (const dir1 of ORDERED_DIRECTIONS) {
      const v1 = DIRECTION_VECTORS[dir1];
      const gateCell: GridPoint = { x: entryCell.x + v1.dx, y: entryCell.y + v1.dy };
      if (gateCell.x < 0 || gateCell.x >= width || gateCell.y < 0 || gateCell.y >= height) continue;
      const gKey = pointKey(gateCell.x, gateCell.y);
      if (activeMask[gateCell.y][gateCell.x] || terrain[gateCell.y][gateCell.x] !== WALL_TILE_ID || reserved.has(gKey)) {
        continue;
      }

      const dirOrder: Direction[] = [dir1, ...ORDERED_DIRECTIONS.filter((d) => d !== dir1)];
      for (const dir2 of dirOrder) {
        const v2 = DIRECTION_VECTORS[dir2];
        const vaultCell: GridPoint = { x: gateCell.x + v2.dx, y: gateCell.y + v2.dy };
        if (vaultCell.x < 0 || vaultCell.x >= width || vaultCell.y < 0 || vaultCell.y >= height) continue;
        if (vaultCell.x === entryCell.x && vaultCell.y === entryCell.y) continue;
        const vKey = pointKey(vaultCell.x, vaultCell.y);
        if (
          activeMask[vaultCell.y][vaultCell.x] ||
          terrain[vaultCell.y][vaultCell.x] !== WALL_TILE_ID ||
          reserved.has(vKey)
        ) {
          continue;
        }

        const gateIsolated = ORDERED_DIRECTIONS.every((d) => {
          const nx = gateCell.x + DIRECTION_VECTORS[d].dx;
          const ny = gateCell.y + DIRECTION_VECTORS[d].dy;
          if ((nx === entryCell.x && ny === entryCell.y) || (nx === vaultCell.x && ny === vaultCell.y)) return true;
          return isSolidBoundaryOrWall(nx, ny);
        });
        if (!gateIsolated) continue;

        const vaultIsolated = ORDERED_DIRECTIONS.every((d) => {
          const nx = vaultCell.x + DIRECTION_VECTORS[d].dx;
          const ny = vaultCell.y + DIRECTION_VECTORS[d].dy;
          if (nx === gateCell.x && ny === gateCell.y) return true;
          return isSolidBoundaryOrWall(nx, ny);
        });
        if (!vaultIsolated) continue;

        reserved.add(eKey);
        reserveNeighborhood(gateCell, reserved, width, height);
        reserveNeighborhood(vaultCell, reserved, width, height);
        return { entryCell, gateCell, vaultCell };
      }
    }
  }
  return null;
}

/**
 * Simulates a single player move on the compiled level topology (including Epoxy's exact
 * `teleportPlayer` adjacent-cell exit rule) and returns the resulting player coordinates,
 * or `null` if the move is blocked.
 */
function simulateStepOnTopology(
  terrain: string[][],
  teleportPadsByChannel: ReadonlyMap<string, readonly [GridPoint, GridPoint]>,
  from: GridPoint,
  dir: Direction,
  width: number,
  height: number,
  impassableKeys: ReadonlySet<string>
): GridPoint | null {
  const vec = DIRECTION_VECTORS[dir];
  const tx = from.x + vec.dx;
  const ty = from.y + vec.dy;
  if (tx < 0 || tx >= width || ty < 0 || ty >= height) return null;
  if (terrain[ty][tx] === WALL_TILE_ID || impassableKeys.has(pointKey(tx, ty))) return null;

  const tileId = terrain[ty][tx];
  const pair = teleportPadsByChannel.get(tileId);
  if (!pair) {
    return { x: tx, y: ty };
  }

  const destPad = pair[0].x === tx && pair[0].y === ty ? pair[1] : pair[0];
  const candidateDirs: Direction[] = [dir, ...ORDERED_DIRECTIONS.filter((d) => d !== dir)];
  for (const tryDir of candidateDirs) {
    const exitVec = DIRECTION_VECTORS[tryDir];
    const ex = destPad.x + exitVec.dx;
    const ey = destPad.y + exitVec.dy;
    if (ex < 0 || ex >= width || ey < 0 || ey >= height) continue;
    if (terrain[ey][ex] === WALL_TILE_ID || impassableKeys.has(pointKey(ex, ey))) continue;
    return { x: ex, y: ey };
  }
  return { x: tx, y: ty };
}

/** Finds the shortest move sequence from `from` to `to` across `terrain` and teleporters. */
function findMovePath(
  terrain: string[][],
  teleportPadsByChannel: ReadonlyMap<string, readonly [GridPoint, GridPoint]>,
  from: GridPoint,
  to: GridPoint,
  width: number,
  height: number,
  impassableKeys: ReadonlySet<string>
): Direction[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const startKey = pointKey(from.x, from.y);
  const targetKey = pointKey(to.x, to.y);
  const parent = new Map<string, { prevKey: string; dir: Direction }>();
  const visited = new Set<string>([startKey]);
  const queue: GridPoint[] = [from];

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const curKey = pointKey(cur.x, cur.y);
    for (const dir of ORDERED_DIRECTIONS) {
      const next = simulateStepOnTopology(terrain, teleportPadsByChannel, cur, dir, width, height, impassableKeys);
      if (!next) continue;
      const nKey = pointKey(next.x, next.y);
      if (visited.has(nKey)) continue;
      visited.add(nKey);
      parent.set(nKey, { prevKey: curKey, dir });
      if (nKey === targetKey) {
        const moves: Direction[] = [];
        let trace = targetKey;
        while (trace !== startKey) {
          const step = parent.get(trace)!;
          moves.push(step.dir);
          trace = step.prevKey;
        }
        moves.reverse();
        return moves;
      }
      queue.push(next);
    }
  }
  return null;
}

interface PlannedBlockPuzzle {
  readonly mode: 'push' | 'pull';
  readonly approach: GridPoint;
  readonly blockStart: GridPoint;
  readonly target: GridPoint;
  readonly pushDir: Direction;
  readonly color?: ChannelColor;
  readonly vault?: CarvedVaultPocket;
  readonly bootsPullPt?: GridPoint;
  readonly pullStand?: GridPoint;
}

interface PlannedLaserPuzzle {
  readonly color: ChannelColor;
  readonly emitterCell: GridPoint;
  readonly inDir: Direction;
  readonly receiverCell: GridPoint;
  readonly corner: GridPoint;
  readonly mirrorStart: GridPoint;
  readonly approach: GridPoint;
  readonly pushDir: Direction;
  readonly mirrorEntityId: string;
  readonly beamCorridorCells: readonly GridPoint[];
  readonly openCornerNeighbors: readonly GridPoint[];
  readonly vault: CarvedVaultPocket;
}

interface PlannedLeverGate {
  readonly keyCell: GridPoint;
  readonly doorCell: GridPoint;
  readonly keyId: string;
  readonly doorId: string;
}

/**
 * Traces a straight ray from `start` in `dir` over `activeMask` until it hits an uncarved wall cell.
 * Returns the intermediate open cells and the terminating wall cell, or `null` if the ray goes out of bounds
 * or crosses a reserved cell.
 */
function traceRayToWall(
  activeMask: boolean[][],
  terrain: string[][],
  reserved: ReadonlySet<string>,
  start: GridPoint,
  dir: Direction,
  width: number,
  height: number
): { openCells: GridPoint[]; wallCell: GridPoint } | null {
  const openCells: GridPoint[] = [];
  const vec = DIRECTION_VECTORS[dir];
  let cx = start.x + vec.dx;
  let cy = start.y + vec.dy;
  while (cx >= 0 && cx < width && cy >= 0 && cy < height) {
    const k = pointKey(cx, cy);
    if (reserved.has(k)) return null;
    if (!activeMask[cy][cx]) {
      if (terrain[cy][cx] === WALL_TILE_ID) {
        return { openCells, wallCell: { x: cx, y: cy } };
      }
      return null;
    }
    openCells.push({ x: cx, y: cy });
    if (openCells.length > MAX_BEAM_CORRIDOR_CELLS) return null;
    cx += vec.dx;
    cy += vec.dy;
  }
  return null;
}

/**
 * Replays a candidate move sequence on a fresh `GameEngine` instance and returns `true`
 * only when the level is won (`engine.isLevelCompleted() === true` and `engine.getPlayer().alive === true`).
 */
function verifySolutionInEngine(level: CompiledLevel, moves: readonly Direction[]): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const dir of moves) {
    while (engine.getPlayer().moveCooldown > 0 && engine.getPlayer().alive && !engine.isLevelCompleted()) {
      engine.tick();
    }
    if (!engine.attemptPlayerMove(dir)) return false;
    if (engine.isLevelCompleted()) return true;
    if (!engine.getPlayer().alive) return false;
  }
  return engine.isLevelCompleted();
}

/**
 * Builds a complete, validated, end-to-end solvable `CompiledLevel` from a single Diggy floor.
 */
function buildLevelFromDiggyFloor(
  floor: RawDiggyFloor,
  packName: string,
  levelNumber: number
): { level: CompiledLevel | null; skipReason?: DiggySkipReason } {
  const width = Number(floor.columns ?? 0);
  const height = Number(floor.rows ?? 0);
  const bounds = ConfigRegistry.getLevelSizeBounds();
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < bounds.minSize ||
    width > bounds.maxSize ||
    height < bounds.minSize ||
    height > bounds.maxSize
  ) {
    return { level: null, skipReason: 'bad_size' };
  }

  const beacons = asArray<RawBeacon>(floor.beacons?.beacon);
  const lootAreas = asArray<RawLootArea>(floor.loot_areas?.loot_area);
  const triggers = asArray<RawTrigger>(floor.tutorial_system?.triggers?.trigger);
  const teleports = asArray<RawTeleport>(floor.teleports?.teleport);
  const exits = asArray<RawExit>(floor.exits?.exit);

  const open = buildOpenMask(floor, width, height, beacons, lootAreas);
  const components = findOpenComponents(open, width, height);
  if (components.length === 0 || components[0].length < MIN_OPEN_CELLS) {
    return { level: null, skipReason: 'too_few_open_cells' };
  }

  // Select the main component and up to MAX_TELEPORT_PAIRS secondary components when teleports exist.
  const maxExtraComponents = Math.min(
    MAX_TELEPORT_PAIRS,
    Math.floor(teleports.length / 2),
    components.slice(1).filter((c) => c.length >= MIN_TELEPORT_COMPONENT_CELLS).length
  );
  const activeComponents = [components[0], ...components.slice(1, 1 + maxExtraComponents)];
  const activeMask: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (const comp of activeComponents) {
    for (const pt of comp) {
      activeMask[pt.y][pt.x] = true;
    }
  }

  const terrain: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (__, x) => (activeMask[y][x] ? FLOOR_TILE_ID : WALL_TILE_ID))
  );
  const itemGrid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null));
  const reserved = new Set<string>();
  const teleportPadsByChannel = new Map<string, readonly [GridPoint, GridPoint]>();

  // 1. Place teleporter pairs connecting the main component with each secondary component.
  for (let i = 1; i < activeComponents.length; i++) {
    const channelId = TELEPORT_TILE_IDS[i - 1];
    const padMain = pickTeleportPadCell(activeComponents[0], activeMask, reserved, width, height);
    const padSub = pickTeleportPadCell(activeComponents[i], activeMask, reserved, width, height);
    if (padMain && padSub) {
      terrain[padMain.y][padMain.x] = channelId;
      terrain[padSub.y][padSub.x] = channelId;
      reserveNeighborhood(padMain, reserved, width, height);
      reserveNeighborhood(padSub, reserved, width, height);
      teleportPadsByChannel.set(channelId, [padMain, padSub]);
    }
  }

  // 2. Choose playerStart in the main component (preferring trigger/entrance vicinity).
  const mainComp = activeComponents[0];
  let playerStartPt: GridPoint | null = null;
  for (const trig of triggers) {
    if (trig.target_object_type === 'drag') continue;
    const x = Number(trig.column ?? -1);
    const y = Number(trig.row ?? -1);
    if (x >= 0 && x < width && y >= 0 && y < height && activeMask[y][x] && !reserved.has(pointKey(x, y))) {
      playerStartPt = { x, y };
      break;
    }
  }
  if (!playerStartPt) {
    playerStartPt =
      mainComp.find(
        (pt) => !reserved.has(pointKey(pt.x, pt.y)) && countOpenNeighbors(activeMask, pt.x, pt.y, width, height) >= 2
      ) ?? mainComp[0];
  }
  reserved.add(pointKey(playerStartPt.x, playerStartPt.y));

  // 3. Compute BFS distances from playerStart across the main component to orient progression.
  const mainDist = bfsDistances(activeMask, playerStartPt, width, height);

  // 4. Choose exit cell in the main component (preferring exit beacon action cells or farthest reachable cell).
  let exitPt: GridPoint | null = null;
  const exitBeaconIds = new Set<number>(exits.map((e) => Number(e.beacon_id ?? 0)).filter((id) => id > 0));
  for (const beacon of beacons) {
    if (!exitBeaconIds.has(Number(beacon.beacon_id ?? 0))) continue;
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      for (const pt of parseRowColList(action.tiles, width, height)) {
        if (activeMask[pt.y][pt.x] && !reserved.has(pointKey(pt.x, pt.y)) && mainDist.has(pointKey(pt.x, pt.y))) {
          exitPt = pt;
          break;
        }
      }
      if (exitPt) break;
    }
  }
  if (!exitPt) {
    let maxD = -1;
    for (const pt of mainComp) {
      const key = pointKey(pt.x, pt.y);
      if (reserved.has(key)) continue;
      const d = mainDist.get(key) ?? -1;
      if (d > maxD) {
        maxD = d;
        exitPt = pt;
      }
    }
  }
  if (!exitPt) {
    return { level: null, skipReason: 'unsolvable' };
  }
  reserved.add(pointKey(exitPt.x, exitPt.y));

  // 5. Plan push/pull boulder puzzles (`activation: "push" | "pit"`, `req_drag > 0`).
  const plannedBlocks: PlannedBlockPuzzle[] = [];
  const pushTargetCandidates: GridPoint[] = [];
  for (const beacon of beacons) {
    const parts = asArray<RawBeaconPart>(beacon.parts?.part);
    const isPushOrPit = parts.some(
      (p) => (p.activation === 'push' || p.activation === 'pit') && Number(p.req_drag ?? 0) > 0
    );
    if (!isPushOrPit) continue;
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      if (action.layer === 'drag' || action.layer === 'drag_swap' || action.layer === 'loot') {
        for (const pt of parseRowColList(action.tiles, width, height)) {
          if (activeMask[pt.y][pt.x] && mainDist.has(pointKey(pt.x, pt.y))) {
            pushTargetCandidates.push(pt);
          }
        }
      }
    }
  }

  const closedBlockKeys = new Set<string>([pointKey(exitPt.x, exitPt.y)]);
  let plateColorIdx = 0;

  for (const target of pushTargetCandidates) {
    if (plannedBlocks.length >= MAX_BLOCK_PUZZLES_PER_FLOOR) break;
    const tKey = pointKey(target.x, target.y);
    if (reserved.has(tKey)) continue;

    let plannedThisTarget = false;

    // 5a. Try Lot 3 Pull Recess (`boots_pull` + recessed boulder pulled onto `pressure_plate_<color>`)
    // for the first boulder puzzle when `target` touches an isolated 1-cell wall recess.
    if (!plannedBlocks.some((b) => b.mode === 'pull') && plateColorIdx < PLATE_CHANNEL_COLORS.length) {
      for (const pushDir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[pushDir];
        const recess: GridPoint = { x: target.x - vec.dx, y: target.y - vec.dy };
        const pullStand: GridPoint = { x: target.x + vec.dx, y: target.y + vec.dy };
        if (
          recess.x < 0 ||
          recess.x >= width ||
          recess.y < 0 ||
          recess.y >= height ||
          pullStand.x < 0 ||
          pullStand.x >= width ||
          pullStand.y < 0 ||
          pullStand.y >= height
        ) {
          continue;
        }
        const rKey = pointKey(recess.x, recess.y);
        const pKey = pointKey(pullStand.x, pullStand.y);
        if (activeMask[recess.y][recess.x] || terrain[recess.y][recess.x] !== WALL_TILE_ID || reserved.has(rKey)) {
          continue;
        }
        if (!activeMask[pullStand.y][pullStand.x] || reserved.has(pKey)) continue;

        const recessIsolated = ORDERED_DIRECTIONS.every((d) => {
          const nx = recess.x + DIRECTION_VECTORS[d].dx;
          const ny = recess.y + DIRECTION_VECTORS[d].dy;
          if (nx === target.x && ny === target.y) return true;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
          return !activeMask[ny][nx] && terrain[ny][nx] === WALL_TILE_ID;
        });
        if (!recessIsolated) continue;

        const trialClosed = new Set<string>(closedBlockKeys);
        trialClosed.add(tKey);
        const distWithoutTarget = bfsDistances(activeMask, playerStartPt, width, height, trialClosed);
        if (distWithoutTarget.size < mainComp.length - trialClosed.size || !distWithoutTarget.has(pKey)) continue;

        // Pick an unreserved reachable non-articulation cell for `boots_pull`.
        const bootsPullPt = mainComp.find((pt) => {
          const k = pointKey(pt.x, pt.y);
          if (reserved.has(k) || k === tKey || k === pKey || (distWithoutTarget.get(k) ?? 0) < 1) return false;
          const trialWithBoots = new Set<string>(trialClosed);
          trialWithBoots.add(k);
          const distWithBootsClosed = bfsDistances(activeMask, playerStartPt, width, height, trialWithBoots);
          return distWithBootsClosed.size >= mainComp.length - trialWithBoots.size && distWithBootsClosed.has(pKey);
        });
        if (!bootsPullPt) continue;

        const trialReserved = new Set<string>(reserved);
        trialReserved.add(tKey);
        trialReserved.add(pKey);
        trialReserved.add(pointKey(bootsPullPt.x, bootsPullPt.y));
        reserveNeighborhood(recess, trialReserved, width, height);

        const vault = carveVaultPocket(
          activeMask,
          terrain,
          trialReserved,
          mainComp,
          distWithoutTarget,
          width,
          height
        );
        if (!vault) continue;

        for (const k of trialReserved) reserved.add(k);
        closedBlockKeys.add(tKey);
        const color = PLATE_CHANNEL_COLORS[plateColorIdx++];
        plannedBlocks.push({
          mode: 'pull',
          approach: target,
          blockStart: recess,
          target,
          pushDir,
          color,
          vault,
          bootsPullPt,
          pullStand
        });
        plannedThisTarget = true;
        break;
      }
    }

    if (plannedThisTarget) continue;

    // 5b. Try Lot 2 Push (`dirt_block` pushed onto `pressure_plate_<color>` + `hold_door_<color>_closed` vault,
    // or fallback to `water` pit when no vault pocket can be carved).
    for (const pushDir of ORDERED_DIRECTIONS) {
      const vec = DIRECTION_VECTORS[pushDir];
      const blockStart: GridPoint = { x: target.x - vec.dx, y: target.y - vec.dy };
      const approach: GridPoint = { x: target.x - 2 * vec.dx, y: target.y - 2 * vec.dy };
      if (
        blockStart.x < 0 ||
        blockStart.x >= width ||
        blockStart.y < 0 ||
        blockStart.y >= height ||
        approach.x < 0 ||
        approach.x >= width ||
        approach.y < 0 ||
        approach.y >= height
      ) {
        continue;
      }
      const bKey = pointKey(blockStart.x, blockStart.y);
      const aKey = pointKey(approach.x, approach.y);
      if (!activeMask[blockStart.y][blockStart.x] || !activeMask[approach.y][approach.x]) continue;
      if (reserved.has(bKey) || reserved.has(aKey)) continue;

      const trialClosed = new Set<string>(closedBlockKeys);
      trialClosed.add(tKey);
      trialClosed.add(bKey);
      const distWithoutPair = bfsDistances(activeMask, playerStartPt, width, height, trialClosed);
      if (distWithoutPair.size < mainComp.length - trialClosed.size || !distWithoutPair.has(aKey)) continue;

      reserved.add(tKey);
      reserved.add(bKey);
      reserved.add(aKey);
      closedBlockKeys.add(tKey);
      closedBlockKeys.add(bKey);

      let color: ChannelColor | undefined;
      let vault: CarvedVaultPocket | undefined;
      if (plateColorIdx < PLATE_CHANNEL_COLORS.length) {
        const carved = carveVaultPocket(activeMask, terrain, reserved, mainComp, distWithoutPair, width, height);
        if (carved) {
          color = PLATE_CHANNEL_COLORS[plateColorIdx++];
          vault = carved;
        }
      }

      plannedBlocks.push({
        mode: 'push',
        approach,
        blockStart,
        target,
        pushDir,
        ...(color ? { color } : {}),
        ...(vault ? { vault } : {})
      });
      break;
    }
  }

  // 5c. Plan Lot 1 Laser & Mirror puzzles (`activation: "sensor"` or `req_light > 0`).
  const plannedLasers: PlannedLaserPuzzle[] = [];
  const lightBeacons = beacons.filter((beacon) =>
    asArray<RawBeaconPart>(beacon.parts?.part).some(
      (p) => p.activation === 'sensor' || Number(p.req_light ?? 0) > 0
    )
  );
  const targetLaserCount = Math.min(MAX_LASER_PUZZLES_PER_FLOOR, lightBeacons.length, LASER_CHANNEL_COLORS.length);

  if (targetLaserCount > 0) {
    const cornerCandidates: GridPoint[] = [];
    const seenCornerKeys = new Set<string>();
    const addCornerCandidate = (pt: GridPoint): void => {
      const k = pointKey(pt.x, pt.y);
      if (activeMask[pt.y]?.[pt.x] && mainDist.has(k) && !seenCornerKeys.has(k)) {
        seenCornerKeys.add(k);
        cornerCandidates.push(pt);
      }
    };

    for (const beacon of lightBeacons) {
      for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
        for (const pt of parseRowColList(action.tiles, width, height)) {
          addCornerCandidate(pt);
        }
      }
    }
    for (const pt of mainComp) {
      addCornerCandidate(pt);
    }

    const hasPullBootsOnFloor = plannedBlocks.some((b) => b.mode === 'pull');

    for (let lIdx = 0; lIdx < targetLaserCount; lIdx++) {
      const laserColor = LASER_CHANNEL_COLORS[lIdx];
      let bestCandidate: {
        emitterCell: GridPoint;
        stopWallCell: GridPoint;
        inDir: Direction;
        receiverCell: GridPoint;
        corner: GridPoint;
        mirrorStart: GridPoint;
        approach: GridPoint;
        pushDir: Direction;
        mirrorEntityId: string;
        beamCorridorCells: GridPoint[];
        openCornerNeighbors: GridPoint[];
        distAfter: Map<string, number>;
      } | null = null;

      for (const corner of cornerCandidates) {
        const cKey = pointKey(corner.x, corner.y);
        if (reserved.has(cKey)) continue;

        for (const pushDir of ORDERED_DIRECTIONS) {
          const pVec = DIRECTION_VECTORS[pushDir];
          const mirrorStart: GridPoint = { x: corner.x - pVec.dx, y: corner.y - pVec.dy };
          const approach: GridPoint = { x: corner.x - 2 * pVec.dx, y: corner.y - 2 * pVec.dy };
          if (
            mirrorStart.x < 0 ||
            mirrorStart.x >= width ||
            mirrorStart.y < 0 ||
            mirrorStart.y >= height ||
            approach.x < 0 ||
            approach.x >= width ||
            approach.y < 0 ||
            approach.y >= height
          ) {
            continue;
          }
          const mKey = pointKey(mirrorStart.x, mirrorStart.y);
          const aKey = pointKey(approach.x, approach.y);
          if (!activeMask[mirrorStart.y][mirrorStart.x] || !activeMask[approach.y][approach.x]) continue;
          if (reserved.has(mKey) || reserved.has(aKey)) continue;

          // Trace reflected beam ray (`outDir = pushDir`) from `corner` to `receiverCell`.
          const outRay = traceRayToWall(activeMask, terrain, reserved, corner, pushDir, width, height);
          if (!outRay) continue;

          const perpDirs = ORDERED_DIRECTIONS.filter(
            (d) => d !== pushDir && d !== OPPOSITE_DIRECTION[pushDir]
          );
          for (const inDir of perpDirs) {
            // Trace incoming beam ray (`-inDir`) from `corner` to `emitterCell`, and continuation (`+inDir`) to `stopWallCell`.
            const inRayBack = traceRayToWall(
              activeMask,
              terrain,
              reserved,
              corner,
              OPPOSITE_DIRECTION[inDir],
              width,
              height
            );
            if (!inRayBack) continue;
            const inRayFwd = traceRayToWall(activeMask, terrain, reserved, corner, inDir, width, height);
            if (!inRayFwd) continue;

            const wallKeys = new Set<string>([
              pointKey(inRayBack.wallCell.x, inRayBack.wallCell.y),
              pointKey(inRayFwd.wallCell.x, inRayFwd.wallCell.y),
              pointKey(outRay.wallCell.x, outRay.wallCell.y)
            ]);
            if (wallKeys.size < 3) continue;

            const beamCorridorCells: GridPoint[] = [
              ...inRayBack.openCells,
              corner,
              ...inRayFwd.openCells,
              ...outRay.openCells
            ];
            if (beamCorridorCells.length > MAX_BEAM_CORRIDOR_CELLS) continue;
            if (
              beamCorridorCells.some((pt) => {
                const k = pointKey(pt.x, pt.y);
                return k === mKey || k === aKey || reserved.has(k);
              })
            ) {
              continue;
            }

            const openCornerNeighbors: GridPoint[] = [];
            for (const d of ORDERED_DIRECTIONS) {
              const nx = corner.x + DIRECTION_VECTORS[d].dx;
              const ny = corner.y + DIRECTION_VECTORS[d].dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height && activeMask[ny][nx]) {
                openCornerNeighbors.push({ x: nx, y: ny });
              }
            }
            if (hasPullBootsOnFloor && openCornerNeighbors.some((pt) => reserved.has(pointKey(pt.x, pt.y)))) {
              continue;
            }

            const trialClosed = new Set<string>(closedBlockKeys);
            trialClosed.add(mKey);
            for (const pt of beamCorridorCells) trialClosed.add(pointKey(pt.x, pt.y));
            if (hasPullBootsOnFloor) {
              for (const pt of openCornerNeighbors) trialClosed.add(pointKey(pt.x, pt.y));
            }

            const distAfter = bfsDistances(activeMask, playerStartPt, width, height, trialClosed);
            if (distAfter.size < mainComp.length - trialClosed.size || !distAfter.has(aKey)) continue;

            const mirrorEntityId =
              reflectOnMirror('slash', undefined, inDir) === pushDir
                ? MIRROR_SLASH_ENTITY_ID
                : MIRROR_BACKSLASH_ENTITY_ID;

            if (!bestCandidate || beamCorridorCells.length < bestCandidate.beamCorridorCells.length) {
              bestCandidate = {
                emitterCell: inRayBack.wallCell,
                stopWallCell: inRayFwd.wallCell,
                inDir,
                receiverCell: outRay.wallCell,
                corner,
                mirrorStart,
                approach,
                pushDir,
                mirrorEntityId,
                beamCorridorCells,
                openCornerNeighbors,
                distAfter
              };
              if (beamCorridorCells.length === 1) break;
            }
          }
          if (bestCandidate && bestCandidate.beamCorridorCells.length === 1) break;
        }
        if (bestCandidate && bestCandidate.beamCorridorCells.length === 1) break;
      }

      if (!bestCandidate) break;

      const trialReserved = new Set<string>(reserved);
      trialReserved.add(pointKey(bestCandidate.emitterCell.x, bestCandidate.emitterCell.y));
      trialReserved.add(pointKey(bestCandidate.stopWallCell.x, bestCandidate.stopWallCell.y));
      trialReserved.add(pointKey(bestCandidate.receiverCell.x, bestCandidate.receiverCell.y));
      trialReserved.add(pointKey(bestCandidate.mirrorStart.x, bestCandidate.mirrorStart.y));
      trialReserved.add(pointKey(bestCandidate.approach.x, bestCandidate.approach.y));
      for (const pt of bestCandidate.beamCorridorCells) trialReserved.add(pointKey(pt.x, pt.y));
      if (hasPullBootsOnFloor) {
        for (const pt of bestCandidate.openCornerNeighbors) trialReserved.add(pointKey(pt.x, pt.y));
      }

      const vault = carveVaultPocket(
        activeMask,
        terrain,
        trialReserved,
        mainComp,
        bestCandidate.distAfter,
        width,
        height
      );
      if (!vault) break;

      for (const k of trialReserved) reserved.add(k);
      closedBlockKeys.add(pointKey(bestCandidate.mirrorStart.x, bestCandidate.mirrorStart.y));
      for (const pt of bestCandidate.beamCorridorCells) closedBlockKeys.add(pointKey(pt.x, pt.y));
      if (hasPullBootsOnFloor) {
        for (const pt of bestCandidate.openCornerNeighbors) closedBlockKeys.add(pointKey(pt.x, pt.y));
      }

      plannedLasers.push({
        color: laserColor,
        emitterCell: bestCandidate.emitterCell,
        inDir: bestCandidate.inDir,
        receiverCell: bestCandidate.receiverCell,
        corner: bestCandidate.corner,
        mirrorStart: bestCandidate.mirrorStart,
        approach: bestCandidate.approach,
        pushDir: bestCandidate.pushDir,
        mirrorEntityId: bestCandidate.mirrorEntityId,
        beamCorridorCells: bestCandidate.beamCorridorCells,
        openCornerNeighbors: bestCandidate.openCornerNeighbors,
        vault
      });
    }
  }

  // 6. Plan lever gates (`activation: "use"` -> key + door) on articulation chokepoints when safe.
  const plannedGates: PlannedLeverGate[] = [];
  const gateCandidates: GridPoint[] = [];
  for (const beacon of beacons) {
    const parts = asArray<RawBeaconPart>(beacon.parts?.part);
    if (!parts.some((p) => p.activation === 'use')) continue;
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      if (action.layer === 'misc' && typeof action.values === 'string' && action.values.startsWith('B_')) {
        for (const pt of parseRowColList(action.tiles, width, height)) {
          if (activeMask[pt.y][pt.x] && mainDist.has(pointKey(pt.x, pt.y))) {
            gateCandidates.push(pt);
          }
        }
      }
    }
  }

  for (const doorCell of gateCandidates) {
    if (plannedGates.length >= MAX_LEVER_GATES_PER_FLOOR) break;
    const dKey = pointKey(doorCell.x, doorCell.y);
    if (reserved.has(dKey)) continue;

    // Check reachability from playerStart when `doorCell`, prior gates, and initial blocks/lasers are closed:
    const gateClosedSet = new Set<string>([
      ...closedBlockKeys,
      dKey,
      ...plannedGates.map((g) => pointKey(g.doorCell.x, g.doorCell.y))
    ]);
    const upstreamDist = bfsDistances(activeMask, playerStartPt, width, height, gateClosedSet);
    if (upstreamDist.size < MIN_GATE_UPSTREAM_CELLS || upstreamDist.has(pointKey(exitPt.x, exitPt.y))) continue;

    const doorTouchesUpstream = ORDERED_DIRECTIONS.some((dir) => {
      const vec = DIRECTION_VECTORS[dir];
      return upstreamDist.has(pointKey(doorCell.x + vec.dx, doorCell.y + vec.dy));
    });
    const blocksUpstream = plannedBlocks.every((b) => {
      if (b.mode === 'pull') {
        return (
          upstreamDist.has(pointKey(b.pullStand!.x, b.pullStand!.y)) &&
          upstreamDist.has(pointKey(b.bootsPullPt!.x, b.bootsPullPt!.y)) &&
          upstreamDist.has(pointKey(b.vault!.entryCell.x, b.vault!.entryCell.y))
        );
      }
      return (
        upstreamDist.has(pointKey(b.approach.x, b.approach.y)) &&
        (!b.vault || upstreamDist.has(pointKey(b.vault.entryCell.x, b.vault.entryCell.y)))
      );
    });
    const lasersUpstream = plannedLasers.every(
      (l) =>
        upstreamDist.has(pointKey(l.approach.x, l.approach.y)) &&
        upstreamDist.has(pointKey(l.vault.entryCell.x, l.vault.entryCell.y))
    );
    const priorGatesUpstream = plannedGates.every(
      (g) =>
        upstreamDist.has(pointKey(g.keyCell.x, g.keyCell.y)) &&
        ORDERED_DIRECTIONS.some((dir) => {
          const vec = DIRECTION_VECTORS[dir];
          return upstreamDist.has(pointKey(g.doorCell.x + vec.dx, g.doorCell.y + vec.dy));
        })
    );
    if (!doorTouchesUpstream || !blocksUpstream || !lasersUpstream || !priorGatesUpstream) continue;

    // Pick an unreserved upstream cell for the key that opens `doorCell`.
    let keyCell: GridPoint | null = null;
    let bestKeyDist = -1;
    for (const [cellKey, dist] of upstreamDist.entries()) {
      if (reserved.has(cellKey)) continue;
      const [cx, cy] = cellKey.split(',').map(Number);
      if (dist > bestKeyDist) {
        bestKeyDist = dist;
        keyCell = { x: cx, y: cy };
      }
    }
    if (!keyCell) continue;

    const channel = KEY_DOOR_CHANNELS[plannedGates.length % KEY_DOOR_CHANNELS.length];
    reserved.add(dKey);
    reserved.add(pointKey(keyCell.x, keyCell.y));
    plannedGates.push({
      keyCell,
      doorCell,
      keyId: channel.keyId,
      doorId: channel.doorId
    });
  }

  // 7. Place collectible chips (`chip`) from Diggy loot_areas and beacon loot actions.
  const chipPoints: GridPoint[] = [];
  const chipKeys = new Set<string>();
  const tryAddChip = (pt: GridPoint): void => {
    const k = pointKey(pt.x, pt.y);
    if (!activeMask[pt.y][pt.x] || reserved.has(k) || chipKeys.has(k)) return;
    chipKeys.add(k);
    chipPoints.push(pt);
  };

  for (const area of lootAreas) {
    if (area.type === 'system' || Number(area.min ?? 0) >= MAX_PLAYABLE_LOOT_MIN) continue;
    if (area.type === 'token' || area.type === 'tablet' || area.type === 'usable') {
      for (const pt of parseRowColList(area.tiles, width, height)) {
        tryAddChip(pt);
      }
    }
  }
  for (const beacon of beacons) {
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      if (action.layer === 'loot') {
        for (const pt of parseRowColList(action.tiles, width, height)) {
          tryAddChip(pt);
        }
      }
    }
  }
  if (chipPoints.length === 0) {
    for (const area of lootAreas) {
      if (area.type === 'system' || Number(area.min ?? 0) >= MAX_PLAYABLE_LOOT_MIN) continue;
      for (const pt of parseRowColList(area.tiles, width, height)) {
        tryAddChip(pt);
      }
    }
  }

  // 8. Place diggable `dirt` tiles from `dig` beacons, material loot areas, and chip cells.
  const dirtCandidates: GridPoint[] = [...chipPoints];
  for (const area of lootAreas) {
    if (area.type === 'material' && Number(area.min ?? 0) < MAX_PLAYABLE_LOOT_MIN) {
      for (const pt of parseRowColList(area.tiles, width, height)) {
        dirtCandidates.push(pt);
      }
    }
  }
  for (const beacon of beacons) {
    for (const action of asArray<RawBeaconAction>(beacon.actions?.action)) {
      if (action.layer === 'vision' && Number(action.values) === 1) {
        const visionPts = parseRowColList(action.tiles, width, height);
        if (visionPts.length > 0) dirtCandidates.push(visionPts[0]);
      }
    }
  }

  const maxDirtCells = Math.max(chipPoints.length, Math.floor(mainComp.length * MAX_DIRT_RATIO));
  let placedDirt = 0;
  for (const pt of dirtCandidates) {
    if (placedDirt >= maxDirtCells) break;
    const k = pointKey(pt.x, pt.y);
    if (!activeMask[pt.y][pt.x] || reserved.has(k)) continue;
    if (terrain[pt.y][pt.x] === FLOOR_TILE_ID) {
      terrain[pt.y][pt.x] = DIRT_TILE_ID;
      placedDirt++;
    }
  }

  // Apply chips on `dirt` (so `dirt_block` can never slide/push over a chip on `floor`, avoiding `hidden_by_block`).
  for (const pt of chipPoints) {
    terrain[pt.y][pt.x] = DIRT_TILE_ID;
    itemGrid[pt.y][pt.x] = CHIP_ITEM_ID;
  }

  // Apply lever gates (`key_*` on `dirt` + `door_*`).
  for (const gate of plannedGates) {
    terrain[gate.keyCell.y][gate.keyCell.x] = DIRT_TILE_ID;
    itemGrid[gate.keyCell.y][gate.keyCell.x] = gate.keyId;
    terrain[gate.doorCell.y][gate.doorCell.x] = gate.doorId;
  }

  // Apply boulder puzzles (Lot 2 pressure plates + hold doors + vault chips, Lot 3 `boots_pull` + pull recess, or `water` fallback).
  const entities: EntityPlacement[] = [];
  for (const bp of plannedBlocks) {
    if (bp.mode === 'pull') {
      terrain[bp.blockStart.y][bp.blockStart.x] = FLOOR_TILE_ID;
      terrain[bp.bootsPullPt!.y][bp.bootsPullPt!.x] = DIRT_TILE_ID;
      itemGrid[bp.bootsPullPt!.y][bp.bootsPullPt!.x] = BOOTS_PULL_ITEM_ID;
    }
    if (bp.color && bp.vault) {
      terrain[bp.target.y][bp.target.x] = `pressure_plate_${bp.color}`;
      terrain[bp.vault.gateCell.y][bp.vault.gateCell.x] = `hold_door_${bp.color}_closed`;
      terrain[bp.vault.vaultCell.y][bp.vault.vaultCell.x] = DIRT_TILE_ID;
      itemGrid[bp.vault.vaultCell.y][bp.vault.vaultCell.x] = CHIP_ITEM_ID;
      chipPoints.push(bp.vault.vaultCell);
    } else {
      terrain[bp.target.y][bp.target.x] = WATER_TILE_ID;
    }
    entities.push({
      x: bp.blockStart.x,
      y: bp.blockStart.y,
      type: PUSH_BLOCK_ENTITY_ID,
      dir: DEFAULT_FACING
    });
  }

  // Apply laser & mirror puzzles (Lot 1 emitter + mirror + receiver + laser gate + vault chip).
  for (const lp of plannedLasers) {
    terrain[lp.emitterCell.y][lp.emitterCell.x] = `laser_emitter_${lp.inDir.toLowerCase()}`;
    terrain[lp.receiverCell.y][lp.receiverCell.x] = `laser_receiver_${lp.color}`;
    terrain[lp.vault.gateCell.y][lp.vault.gateCell.x] = `laser_gate_${lp.color}_closed`;
    terrain[lp.vault.vaultCell.y][lp.vault.vaultCell.x] = DIRT_TILE_ID;
    itemGrid[lp.vault.vaultCell.y][lp.vault.vaultCell.x] = CHIP_ITEM_ID;
    chipPoints.push(lp.vault.vaultCell);
    entities.push({
      x: lp.mirrorStart.x,
      y: lp.mirrorStart.y,
      type: lp.mirrorEntityId,
      dir: DEFAULT_FACING
    });
  }

  // Apply exit (`socket` with `'exit'` underlay when `chipsRequired > 0`, else `'exit'`).
  const chipsRequired = chipPoints.length;
  let underlays: CellUnderlay[] | undefined;
  if (chipsRequired > 0) {
    terrain[exitPt.y][exitPt.x] = SOCKET_TILE_ID;
    underlays = [{ x: exitPt.x, y: exitPt.y, terrain: EXIT_TILE_ID }];
  } else {
    terrain[exitPt.y][exitPt.x] = EXIT_TILE_ID;
  }

  // 9. Synthesize the winning move sequence (`solution`) and verify in `GameEngine`.
  const impassable = new Set<string>();
  for (const gate of plannedGates) impassable.add(pointKey(gate.doorCell.x, gate.doorCell.y));
  for (const bp of plannedBlocks) {
    impassable.add(pointKey(bp.blockStart.x, bp.blockStart.y));
    impassable.add(pointKey(bp.target.x, bp.target.y));
    if (bp.vault) {
      impassable.add(pointKey(bp.vault.gateCell.x, bp.vault.gateCell.y));
    }
    if (bp.bootsPullPt) {
      impassable.add(pointKey(bp.bootsPullPt.x, bp.bootsPullPt.y));
    }
  }
  for (const lp of plannedLasers) {
    impassable.add(pointKey(lp.emitterCell.x, lp.emitterCell.y));
    impassable.add(pointKey(lp.receiverCell.x, lp.receiverCell.y));
    impassable.add(pointKey(lp.mirrorStart.x, lp.mirrorStart.y));
    for (const pt of lp.beamCorridorCells) {
      impassable.add(pointKey(pt.x, pt.y));
    }
    impassable.add(pointKey(lp.vault.gateCell.x, lp.vault.gateCell.y));
  }
  if (chipsRequired > 0) {
    impassable.add(pointKey(exitPt.x, exitPt.y));
  }

  const remainingChips = new Set<string>(chipPoints.map((p) => pointKey(p.x, p.y)));
  remainingChips.delete(pointKey(playerStartPt.x, playerStartPt.y));

  const moves: Direction[] = [];
  let cursor: GridPoint = { x: playerStartPt.x, y: playerStartPt.y };

  // Step A1: Execute standard boulder pushes (`mode === 'push'`).
  for (const bp of plannedBlocks) {
    if (bp.mode !== 'push') continue;
    const toApproach = findMovePath(terrain, teleportPadsByChannel, cursor, bp.approach, width, height, impassable);
    if (!toApproach) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toApproach, bp.pushDir);
    impassable.delete(pointKey(bp.blockStart.x, bp.blockStart.y));
    cursor = { x: bp.blockStart.x, y: bp.blockStart.y };
    if (bp.vault) {
      // Keep `bp.target` in `impassable` because `dirt_block` remains on `pressure_plate_<color>`.
      impassable.delete(pointKey(bp.vault.gateCell.x, bp.vault.gateCell.y));
      const toVault = findMovePath(
        terrain,
        teleportPadsByChannel,
        cursor,
        bp.vault.vaultCell,
        width,
        height,
        impassable
      );
      if (!toVault) return { level: null, skipReason: 'unsolvable' };
      moves.push(...toVault);
      cursor = bp.vault.vaultCell;
      remainingChips.delete(pointKey(bp.vault.vaultCell.x, bp.vault.vaultCell.y));
    } else {
      impassable.delete(pointKey(bp.target.x, bp.target.y));
    }
  }

  // Step A2: Execute laser mirror pushes (`plannedLasers`).
  for (const lp of plannedLasers) {
    const toApproach = findMovePath(terrain, teleportPadsByChannel, cursor, lp.approach, width, height, impassable);
    if (!toApproach) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toApproach, lp.pushDir);
    impassable.delete(pointKey(lp.mirrorStart.x, lp.mirrorStart.y));
    cursor = { x: lp.mirrorStart.x, y: lp.mirrorStart.y };
    impassable.delete(pointKey(lp.vault.gateCell.x, lp.vault.gateCell.y));
    const toVault = findMovePath(terrain, teleportPadsByChannel, cursor, lp.vault.vaultCell, width, height, impassable);
    if (!toVault) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toVault);
    cursor = lp.vault.vaultCell;
    remainingChips.delete(pointKey(lp.vault.vaultCell.x, lp.vault.vaultCell.y));
    if (plannedBlocks.some((b) => b.mode === 'pull')) {
      for (const pt of lp.openCornerNeighbors) {
        impassable.add(pointKey(pt.x, pt.y));
      }
    }
  }

  // Step A3: Execute grappling-glove boulder pulls (`mode === 'pull'`), after all mirrors are in place.
  for (const bp of plannedBlocks) {
    if (bp.mode !== 'pull' || !bp.bootsPullPt || !bp.pullStand || !bp.vault) continue;
    impassable.delete(pointKey(bp.bootsPullPt.x, bp.bootsPullPt.y));
    const toBoots = findMovePath(terrain, teleportPadsByChannel, cursor, bp.bootsPullPt, width, height, impassable);
    if (!toBoots) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toBoots);
    cursor = bp.bootsPullPt;

    impassable.delete(pointKey(bp.target.x, bp.target.y));
    const toTarget = findMovePath(terrain, teleportPadsByChannel, cursor, bp.target, width, height, impassable);
    if (!toTarget) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toTarget, bp.pushDir);
    cursor = { x: bp.pullStand.x, y: bp.pullStand.y };

    // The boulder now rests on `bp.target` (`pressure_plate_<color>`), opening `bp.vault.gateCell`.
    impassable.add(pointKey(bp.target.x, bp.target.y));
    impassable.delete(pointKey(bp.vault.gateCell.x, bp.vault.gateCell.y));
    const toVault = findMovePath(terrain, teleportPadsByChannel, cursor, bp.vault.vaultCell, width, height, impassable);
    if (!toVault) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toVault);
    cursor = bp.vault.vaultCell;
    remainingChips.delete(pointKey(bp.vault.vaultCell.x, bp.vault.vaultCell.y));
  }

  // Step B: Open each lever gate (`cursor -> keyCell`, then `keyCell -> doorCell`).
  for (const gate of plannedGates) {
    const toKey = findMovePath(terrain, teleportPadsByChannel, cursor, gate.keyCell, width, height, impassable);
    if (!toKey) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toKey);
    cursor = gate.keyCell;
    impassable.delete(pointKey(gate.doorCell.x, gate.doorCell.y));
    const toDoor = findMovePath(terrain, teleportPadsByChannel, cursor, gate.doorCell, width, height, impassable);
    if (!toDoor) return { level: null, skipReason: 'unsolvable' };
    moves.push(...toDoor);
    cursor = gate.doorCell;
  }

  // Step C: Collect all remaining chips using nearest-neighbor BFS order.
  remainingChips.delete(pointKey(cursor.x, cursor.y));
  while (remainingChips.size > 0) {
    let bestPath: Direction[] | null = null;
    let bestTarget: GridPoint | null = null;
    for (const pt of chipPoints) {
      const k = pointKey(pt.x, pt.y);
      if (!remainingChips.has(k)) continue;
      const path = findMovePath(terrain, teleportPadsByChannel, cursor, pt, width, height, impassable);
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
        bestTarget = pt;
      }
    }
    if (!bestPath || !bestTarget) return { level: null, skipReason: 'unsolvable' };
    moves.push(...bestPath);
    cursor = bestTarget;
    remainingChips.delete(pointKey(bestTarget.x, bestTarget.y));
  }

  // Step D: Unlock exit socket and step onto exit.
  impassable.delete(pointKey(exitPt.x, exitPt.y));
  const toExit = findMovePath(terrain, teleportPadsByChannel, cursor, exitPt, width, height, impassable);
  if (!toExit) return { level: null, skipReason: 'unsolvable' };
  moves.push(...toExit);

  const textLimits = ConfigRegistry.getGame().levelText;
  const rawId = `${packName}-floor-${floor.floor_id || floor.def_id || levelNumber}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, textLimits.idMaxLength);
  const rawTitle = (typeof floor.name === 'string' && floor.name.trim() ? floor.name.trim() : `Floor ${levelNumber}`).slice(
    0,
    textLimits.titleMaxLength
  );
  const solutionStr = moves.join('');

  const compiled: CompiledLevel = {
    id: rawId || `diggy-${levelNumber}`,
    number: levelNumber,
    customTitle: rawTitle,
    password: DEFAULT_LEVEL_PASSWORD,
    ruleset: DEFAULT_RULESET,
    winRule: DEFAULT_WIN_RULE,
    theme: selectTheme(floor, beacons),
    timeLimitSeconds: UNTIMED_SECONDS,
    chipsRequired,
    playerStart: { x: playerStartPt.x, y: playerStartPt.y, dir: DEFAULT_FACING },
    terrain,
    ...(underlays ? { underlays } : {}),
    items: itemGrid,
    entities,
    trapLinks: [],
    cloneLinks: [],
    ...(solutionStr.length <= textLimits.solutionMaxLength ? { solution: solutionStr } : {})
  };

  if (!verifySolutionInEngine(compiled, moves)) {
    return { level: null, skipReason: 'unsolvable' };
  }

  return { level: compiled };
}

/**
 * Decodes a parsed Diggy floor JSON payload into native Epoxy levels.
 * Dummy `0x0` placeholder floors (`rows <= 0 && columns <= 0`) are ignored silently.
 */
export function decodeDiggyJson(parsed: unknown, packName: string, startNumber = 1): DiggyDecodeResult {
  const rawFloors = extractRawFloors(parsed);
  const levels: CompiledLevel[] = [];
  const skipped: DiggySkippedFloor[] = [];

  for (const floor of rawFloors) {
    const rows = Number(floor?.rows ?? 0);
    const cols = Number(floor?.columns ?? 0);
    // Ignore Diggy's built-in 0x0 "Default" placeholder floor entry.
    if (rows <= 0 && cols <= 0) continue;

    const floorId = Number(floor.floor_id || floor.def_id || 0);
    const title = typeof floor.name === 'string' && floor.name.trim() ? floor.name.trim() : `Floor ${floorId}`;
    const built = buildLevelFromDiggyFloor(floor, packName, startNumber + levels.length);
    if (built.level) {
      levels.push(built.level);
    } else if (built.skipReason) {
      skipped.push({ floorId, title, reason: built.skipReason });
    }
  }

  return { levels, skipped };
}

/**
 * Decodes a collection of Diggy floor JSON or HAR files in natural numeric filename order
 * into a single list of native Epoxy levels.
 */
export function decodeDiggyFiles(
  files: ReadonlyArray<{ readonly name: string; readonly text: string }>,
  packName: string
): DiggyDecodeResult {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const levels: CompiledLevel[] = [];
  const skipped: DiggySkippedFloor[] = [];

  for (const file of sorted) {
    try {
      const parsed = JSON.parse(file.text) as unknown;
      if (!isDiggyJson(parsed)) {
        skipped.push({ floorId: 0, title: file.name, reason: 'bad_size' });
        continue;
      }
      const fileBase = file.name.replace(/\.[^.]+$/, '');
      const decoded = decodeDiggyJson(parsed, `${packName}-${fileBase}`, levels.length + 1);
      levels.push(...decoded.levels);
      skipped.push(...decoded.skipped);
      if (decoded.levels.length === 0 && decoded.skipped.length === 0) {
        skipped.push({ floorId: 0, title: file.name, reason: 'bad_size' });
      }
    } catch {
      skipped.push({ floorId: 0, title: file.name, reason: 'bad_size' });
    }
  }

  return { levels, skipped };
}
