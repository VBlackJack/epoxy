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
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, GridPoint, TileDefinition } from './types';

/**
 * Mechanic families a level can use. A level that mixes several families
 * offers more variety; the generator scores on this count.
 */
export const MECHANICS = {
  KEYS_DOORS: 'keys_doors',
  SOCKET: 'socket',
  WATER: 'water',
  FIRE: 'fire',
  ICE: 'ice',
  FORCE: 'force',
  THIEF: 'thief',
  TELEPORT: 'teleport',
  TRAP: 'trap',
  CLONER: 'cloner',
  TOGGLE_WALLS: 'toggle_walls',
  DIRT: 'dirt',
  HIDDEN_WALLS: 'hidden_walls',
  BOMB: 'bomb',
  BLOCKS: 'blocks',
  MONSTERS: 'monsters'
} as const;

export type Mechanic = (typeof MECHANICS)[keyof typeof MECHANICS];

/**
 * Quality measures for one level. They are proxies, computed on a permissive
 * view of the map (doors, sockets and toggle walls count as passable, hazards
 * as crossable, thin-wall edges are ignored), so they compare levels with each
 * other rather than prove anything about one level.
 */
export interface LevelMetricsReport {
  levelId: string;
  valid: boolean;
  issueCount: number;
  /** Bounding box of every non-wall cell. */
  usedWidth: number;
  usedHeight: number;
  /** Bounding box area over map area. */
  usedAreaRatio: number;
  walkableCells: number;
  /** Walkable cells with exactly one walkable neighbour, over walkable cells. */
  deadEndRatio: number;
  /** Greedy tour start -> required pickups -> socket -> exit, or null when a target is unreachable. */
  estimatedSolutionSteps: number | null;
  /** Tour steps over distinct cells the tour visits: 1 means no backtracking. */
  revisitRatio: number | null;
  /** Distinct tour cells over walkable cells: low values mean much unused space. */
  tourCoverageRatio: number | null;
  mechanics: Mechanic[];
  mechanicCount: number;
  chipsPlaced: number;
  chipsRequired: number;
  /** Mean distance of chips from their centroid, over the larger used dimension. */
  chipSpread: number;
  monsterCount: number;
  timeLimitSeconds: number;
  /** Seconds the tour takes at the player's move speed, or null without a tour. */
  estimatedSeconds: number | null;
  /** Time limit over estimated seconds; null without a time limit or a tour. */
  timeSlackRatio: number | null;
}

const UNREACHED = -1;

/**
 * Tiles told apart by id: dirt and fake blue walls share every behaviour
 * flag (both turn to floor when stepped on and stop blocks).
 */
const DIRT_TILE_IDS: ReadonlySet<string> = new Set(['dirt']);
const HIDDEN_WALL_TILE_IDS: ReadonlySet<string> = new Set([
  'blue_wall_fake',
  'blue_wall_real',
  'invisible_wall',
  'appearing_wall'
]);

interface Pickup extends GridPoint {
  kind: 'chip' | 'key' | 'boot';
}

export class LevelMetrics {
  public static measure(level: CompiledLevel): LevelMetricsReport {
    const height = level.terrain.length;
    const width = height > 0 ? level.terrain[0].length : 0;
    const tiles = level.terrain.map((row) => row.map((id) => ConfigRegistry.getTile(id)));
    const walkable = tiles.map((row) => row.map((tile) => this.isPermissivelyWalkable(tile)));
    const teleporters: GridPoint[] = [];
    tiles.forEach((row, y) =>
      row.forEach((tile, x) => {
        if (tile.isTeleporter) teleporters.push({ x, y });
      })
    );

    const validation = LevelValidator.validate(level);
    const mechanics = this.collectMechanics(level, tiles);
    const bounds = this.usedBounds(tiles, width, height);
    const walkableCells = walkable.flat().filter(Boolean).length;
    const deadEnds = this.countDeadEnds(walkable, width, height);

    const chips = this.findItems(level, (tile) => tile.collectible === 'chip');
    const tour = this.estimateTour(level, tiles, walkable, chips, teleporters);
    const timing = ConfigRegistry.getGame().timing;
    const estimatedSeconds =
      tour === null ? null : (tour.steps * timing.playerMoveCooldownTicks) / timing.ticksPerSecond;
    const monsterCount = level.entities.filter(
      (e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster'
    ).length;

    return {
      levelId: level.id,
      valid: validation.valid,
      issueCount: validation.issues.length,
      usedWidth: bounds.width,
      usedHeight: bounds.height,
      usedAreaRatio: width * height > 0 ? (bounds.width * bounds.height) / (width * height) : 0,
      walkableCells,
      deadEndRatio: walkableCells > 0 ? deadEnds / walkableCells : 0,
      estimatedSolutionSteps: tour?.steps ?? null,
      revisitRatio: tour && tour.distinctCells > 0 ? tour.steps / tour.distinctCells : null,
      tourCoverageRatio: tour && walkableCells > 0 ? tour.distinctCells / walkableCells : null,
      mechanics,
      mechanicCount: mechanics.length,
      chipsPlaced: chips.length,
      chipsRequired: level.chipsRequired,
      chipSpread: this.spread(chips, Math.max(bounds.width, bounds.height)),
      monsterCount,
      timeLimitSeconds: level.timeLimitSeconds,
      estimatedSeconds,
      timeSlackRatio:
        estimatedSeconds && level.timeLimitSeconds > 0
          ? level.timeLimitSeconds / estimatedSeconds
          : null
    };
  }

  /** Cells the player can stand on once every lock, socket and hazard is dealt with. */
  private static isPermissivelyWalkable(tile: TileDefinition): boolean {
    return Boolean(
      tile.passableByPlayer || tile.requiredKey || tile.requiresAllChips || tile.togglesTo
    );
  }

  private static usedBounds(
    tiles: TileDefinition[][],
    width: number,
    height: number
  ): { width: number; height: number } {
    let minX = width;
    let minY = height;
    let maxX = UNREACHED;
    let maxY = UNREACHED;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!this.isPermissivelyWalkable(tiles[y][x])) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX === UNREACHED) return { width: 0, height: 0 };
    return { width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  private static countDeadEnds(walkable: boolean[][], width: number, height: number): number {
    let deadEnds = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!walkable[y][x]) continue;
        let neighbours = 0;
        for (const dir of ORDERED_DIRECTIONS) {
          const nx = x + DIRECTION_VECTORS[dir].dx;
          const ny = y + DIRECTION_VECTORS[dir].dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && walkable[ny][nx]) neighbours++;
        }
        if (neighbours === 1) deadEnds++;
      }
    }
    return deadEnds;
  }

  private static findItems(
    level: CompiledLevel,
    predicate: (tile: TileDefinition) => boolean
  ): GridPoint[] {
    const found: GridPoint[] = [];
    level.items.forEach((row, y) =>
      row.forEach((id, x) => {
        if (id && predicate(ConfigRegistry.getTile(id))) found.push({ x, y });
      })
    );
    return found;
  }

  /**
   * Pickups a solution has to make: the required number of chips, one key per
   * locked door of each colour, and one pair of boots per hazard family that
   * the map contains and that has boots on the floor.
   */
  private static requiredPickups(
    level: CompiledLevel,
    tiles: TileDefinition[][],
    chips: GridPoint[]
  ): { pickups: Pickup[]; chipsNeeded: number } {
    const doorsByKey = new Map<string, number>();
    const protections = new Set<string>();
    for (const row of tiles) {
      for (const tile of row) {
        if (tile.requiredKey) doorsByKey.set(tile.requiredKey, (doorsByKey.get(tile.requiredKey) ?? 0) + 1);
        if (tile.protectedByItem && tile.hazard) protections.add(tile.protectedByItem);
      }
    }

    const pickups: Pickup[] = [];
    const keysTaken = new Map<string, number>();
    const bootsTaken = new Set<string>();
    level.items.forEach((row, y) =>
      row.forEach((id, x) => {
        if (!id) return;
        const tile = ConfigRegistry.getTile(id);
        if (tile.collectible === 'key') {
          const taken = keysTaken.get(id) ?? 0;
          if (taken < (doorsByKey.get(id) ?? 0)) {
            keysTaken.set(id, taken + 1);
            pickups.push({ x, y, kind: 'key' });
          }
        } else if (tile.collectible === 'boot' && protections.has(id) && !bootsTaken.has(id)) {
          bootsTaken.add(id);
          pickups.push({ x, y, kind: 'boot' });
        }
      })
    );
    for (const chip of chips) pickups.push({ ...chip, kind: 'chip' });
    return { pickups, chipsNeeded: Math.min(level.chipsRequired, chips.length) };
  }

  /**
   * Nearest-first tour over the required pickups, then the socket when there
   * is one, then the nearest exit. Returns null if any stop is unreachable.
   */
  private static estimateTour(
    level: CompiledLevel,
    tiles: TileDefinition[][],
    walkable: boolean[][],
    chips: GridPoint[],
    teleporters: GridPoint[]
  ): { steps: number; distinctCells: number } | null {
    const { pickups, chipsNeeded } = this.requiredPickups(level, tiles, chips);
    const sockets: GridPoint[] = [];
    const exits: GridPoint[] = [];
    tiles.forEach((row, y) =>
      row.forEach((tile, x) => {
        if (tile.requiresAllChips) sockets.push({ x, y });
        if (tile.isLevelExit) exits.push({ x, y });
      })
    );
    if (exits.length === 0) return null;

    let position: GridPoint = { x: level.playerStart.x, y: level.playerStart.y };
    let steps = 0;
    const visited = new Set<number>([this.cellKey(position, walkable)]);
    const remaining = [...pickups];
    let chipsLeft = chipsNeeded;

    const walkTo = (targets: GridPoint[]): GridPoint | null => {
      const { distance, parent } = this.bfs(walkable, position, teleporters);
      let best: GridPoint | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const target of targets) {
        const d = distance[target.y][target.x];
        if (d !== UNREACHED && d < bestDistance) {
          best = target;
          bestDistance = d;
        }
      }
      if (!best) return null;
      steps += bestDistance;
      let cursor: GridPoint | null = best;
      while (cursor) {
        visited.add(this.cellKey(cursor, walkable));
        cursor = parent[cursor.y][cursor.x];
      }
      position = best;
      return best;
    };

    while (remaining.some((p) => p.kind !== 'chip') || chipsLeft > 0) {
      const candidates = remaining.filter((p) => p.kind !== 'chip' || chipsLeft > 0);
      const reached = walkTo(candidates);
      if (!reached) return null;
      const index = remaining.findIndex((p) => p.x === reached.x && p.y === reached.y);
      if (remaining[index].kind === 'chip') chipsLeft--;
      remaining.splice(index, 1);
    }
    if (sockets.length > 0 && !walkTo(sockets)) return null;
    if (!walkTo(exits)) return null;
    return { steps, distinctCells: visited.size };
  }

  /**
   * Breadth-first distances. Stepping onto a teleporter may continue from any
   * other teleporter: the real destination order is ignored, which keeps the
   * estimate optimistic but connects the islands that only teleports join.
   */
  private static bfs(
    walkable: boolean[][],
    from: GridPoint,
    teleporters: GridPoint[] = []
  ): { distance: number[][]; parent: (GridPoint | null)[][] } {
    const height = walkable.length;
    const width = height > 0 ? walkable[0].length : 0;
    const distance = walkable.map((row) => row.map(() => UNREACHED));
    const parent: (GridPoint | null)[][] = walkable.map((row) => row.map(() => null));
    const queue: GridPoint[] = [from];
    distance[from.y][from.x] = 0;
    const isTeleporter = (p: GridPoint): boolean =>
      teleporters.some((t) => t.x === p.x && t.y === p.y);
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      if (isTeleporter(cell)) {
        for (const target of teleporters) {
          if (distance[target.y][target.x] !== UNREACHED) continue;
          distance[target.y][target.x] = distance[cell.y][cell.x];
          parent[target.y][target.x] = cell;
          queue.push(target);
        }
      }
      for (const dir of ORDERED_DIRECTIONS) {
        const nx = cell.x + DIRECTION_VECTORS[dir].dx;
        const ny = cell.y + DIRECTION_VECTORS[dir].dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!walkable[ny][nx] || distance[ny][nx] !== UNREACHED) continue;
        distance[ny][nx] = distance[cell.y][cell.x] + 1;
        parent[ny][nx] = cell;
        queue.push({ x: nx, y: ny });
      }
    }
    return { distance, parent };
  }

  private static cellKey(point: GridPoint, walkable: boolean[][]): number {
    const width = walkable.length > 0 ? walkable[0].length : 0;
    return point.y * width + point.x;
  }

  private static spread(points: GridPoint[], scale: number): number {
    if (points.length < 2 || scale <= 0) return 0;
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const mean = points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
    return mean / scale;
  }

  private static collectMechanics(level: CompiledLevel, tiles: TileDefinition[][]): Mechanic[] {
    const found = new Set<Mechanic>();
    const addTile = (tile: TileDefinition): void => {
      if (tile.requiredKey) found.add(MECHANICS.KEYS_DOORS);
      if (tile.requiresAllChips) found.add(MECHANICS.SOCKET);
      if (tile.hazard === 'water') found.add(MECHANICS.WATER);
      if (tile.hazard === 'fire') found.add(MECHANICS.FIRE);
      if (tile.hazard === 'bomb') found.add(MECHANICS.BOMB);
      if (tile.slideType === 'ice') found.add(MECHANICS.ICE);
      if (tile.slideType === 'force') found.add(MECHANICS.FORCE);
      if (tile.stealsBoots) found.add(MECHANICS.THIEF);
      if (tile.isTeleporter) found.add(MECHANICS.TELEPORT);
      if (tile.isTrap) found.add(MECHANICS.TRAP);
      if (tile.isCloneMachine) found.add(MECHANICS.CLONER);
      if (tile.togglesTo) found.add(MECHANICS.TOGGLE_WALLS);
      if (DIRT_TILE_IDS.has(tile.id)) found.add(MECHANICS.DIRT);
      if (tile.revealsToOnTouch || HIDDEN_WALL_TILE_IDS.has(tile.id)) {
        found.add(MECHANICS.HIDDEN_WALLS);
      }
    };
    for (const row of tiles) for (const tile of row) addTile(tile);
    for (const row of level.items) for (const id of row) if (id) addTile(ConfigRegistry.getTile(id));
    for (const entity of level.entities) {
      const kind = ConfigRegistry.getEntityDef(entity.type)?.kind;
      if (kind === 'block') found.add(MECHANICS.BLOCKS);
      if (kind === 'monster') found.add(MECHANICS.MONSTERS);
    }
    return [...found].sort();
  }
}
