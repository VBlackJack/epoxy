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
import { ORDERED_DIRECTIONS } from '../config/constants';
import { FLOOR_TILE_ID } from '../core/coreConstants';
import { SeededRandom } from '../core/Random';
import { Direction, EntityPlacement, GridPoint, HubConfig } from '../core/types';
import { HubGrid } from './HubGrid';
import { HubPlan } from './HubPlanner';
import { CHIP_ITEM_ID, HUB_SEGMENT, NO_SEGMENT, OpenArea } from './HubTypes';

const WALL_TILE_ID = 'wall';
/** Relative turns of monsters.json, as steps round ORDERED_DIRECTIONS. */
const TURN_STEPS: Record<string, number> = { FORWARD: 0, RIGHT: 1, BACK: 2, LEFT: 3 };
/** Neighbours a chip's cell needs on open ground, so it never sits at the tip of a dead end. */
const MIN_OPEN_NEIGHBOURS = 2;

/** What the open fill hands back: the area, and the cells to visit in the hub in walking order. */
export interface OpenFill {
  open: OpenArea;
  targets: GridPoint[];
}

/** A monster's start, and the cells it walks over from there. */
interface Lane {
  start: GridPoint;
  dir: Direction;
  cells: GridPoint[];
}

/**
 * Fills the hub region of a loop level once its wings and bays are laid out.
 * The region is the one connected stretch of open floor the hub owns; every
 * other open cell belongs to a wing. It is closed with gravel at each gate and
 * strip end, cut into lanes with wall bars, and given a few deterministic
 * monsters, fire and water patches and the level's loose chips and items, so
 * the floor outside the puzzles carries play instead of lying empty.
 */
export class HubOpenAssembler {
  constructor(
    private readonly grid: HubGrid,
    private readonly cfg: HubConfig,
    private readonly rng: SeededRandom
  ) {}

  /**
   * Fills the region around `start`. Null when the plan's hub items do not fit.
   * Monsters, chips and patches that find no room are left out, not failed.
   * The chips are the plan's, or one per `openChips.regionCellsPerChip` cells
   * of the region when that is more, up to `openChips.max`.
   */
  public fill(plan: HubPlan, start: GridPoint): OpenFill | null {
    const aprons = this.closeRegion();
    const dividers = this.carveDividers(start);
    const monsters: EntityPlacement[] = [];
    const lanes = new Set<number>();
    for (const type of plan.openMonsters) {
      const lane = this.placeMonster(type, start, lanes);
      if (!lane) continue;
      monsters.push({ x: lane.start.x, y: lane.start.y, type, dir: lane.dir });
      for (const cell of lane.cells) lanes.add(this.grid.key(cell));
    }
    this.grid.entities.push(...monsters);
    const hazards = this.placeHazards(start, lanes);

    // The plan's count, or more when the region is large: a chip per so many cells keeps the floor served.
    const chipRule = this.cfg.openChips;
    const chipCount = Math.min(
      chipRule.max,
      Math.max(plan.openChips, Math.floor(this.regionCells().length / chipRule.regionCellsPerChip))
    );
    const loot = [
      ...plan.hubItems.map((id) => ({ id, near: false })),
      ...Array.from({ length: chipCount }, (_, i) => ({
        id: CHIP_ITEM_ID,
        near: i < Math.round(chipCount * chipRule.nearLaneShare)
      }))
    ];
    const placed = this.placeLoot(loot, start, lanes);
    if (!placed) return null;
    const chips = placed.filter((p) => p.id === CHIP_ITEM_ID).map((p) => p.cell);
    const targets = this.walkingOrder(
      placed.map((p) => p.cell),
      start
    );
    const region = this.regionCells();
    return {
      open: {
        region,
        aprons,
        monsters,
        lanes: [...lanes].map((k) => this.grid.point(k)),
        chips,
        hazards,
        dividers
      },
      targets
    };
  }

  /** Every cell of the hub region: open floor owned by the hub segment. */
  private regionCells(): GridPoint[] {
    const cells: GridPoint[] = [];
    for (let k = 0; k < this.grid.segment.length; k++) {
      if (this.grid.segment[k] === HUB_SEGMENT) cells.push(this.grid.point(k));
    }
    return cells;
  }

  private inRegion(p: GridPoint): boolean {
    return this.grid.inMap(p) && this.grid.segment[this.grid.key(p)] === HUB_SEGMENT;
  }

  private terrainAt(p: GridPoint): string {
    return this.grid.terrain[p.y][p.x];
  }

  /** Open ground of the region the player can stand on: floor or gravel, no wall bar or patch. */
  private isOpen(p: GridPoint): boolean {
    if (!this.inRegion(p)) return false;
    const terrain = this.terrainAt(p);
    return terrain === FLOOR_TILE_ID || terrain === this.cfg.apronTerrain;
  }

  private isFloor(p: GridPoint): boolean {
    return this.inRegion(p) && this.terrainAt(p) === FLOOR_TILE_ID;
  }

  /**
   * Lays gravel on every region cell that touches an open cell of another segment:
   * the cell in front of each gate and return strip. The player crosses gravel,
   * monsters cannot enter it, so none can leave the region, and the player is
   * safe while standing on it.
   */
  private closeRegion(): GridPoint[] {
    const apron = this.cfg.apronTerrain;
    const aprons: GridPoint[] = [];
    for (const cell of this.regionCells()) {
      const touchesWing = ORDERED_DIRECTIONS.some((d) => {
        const n = this.grid.step(cell, d);
        if (!this.grid.inMap(n)) return false;
        const seg = this.grid.segment[this.grid.key(n)];
        return seg !== NO_SEGMENT && seg !== HUB_SEGMENT;
      });
      if (!touchesWing) continue;
      this.grid.terrain[cell.y][cell.x] = apron;
      aprons.push(cell);
    }
    return aprons;
  }

  /**
   * Sets wall bars (a single cell is a pillar) into the open parts of the region,
   * each with a margin of open ground all round and a gap to the next bar: they
   * cut the floor into lanes for a ball to run and a player to dodge in.
   */
  private carveDividers(start: GridPoint): GridPoint[] {
    const rule = this.cfg.openDividers;
    const margin = rule.clearance;
    const floor = this.regionCells().filter((c) => this.isFloor(c));
    const carved: GridPoint[] = [];
    let placed = 0;
    for (let attempt = 0; attempt < rule.attempts && placed < rule.max && floor.length > 0; attempt++) {
      const origin = floor[this.rng.nextInt(0, floor.length - 1)];
      const horizontal = this.rng.nextInt(0, 1) === 0;
      const length = this.rng.nextInt(rule.minLength, rule.maxLength);
      const bar = Array.from({ length }, (_, i) => ({ x: origin.x + (horizontal ? i : 0), y: origin.y + (horizontal ? 0 : i) }));
      if (bar.some((c) => c.x === start.x && c.y === start.y)) continue;
      if (bar.some((c) => carved.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) < rule.separation))) continue;
      const x1 = bar[length - 1].x;
      const y1 = bar[length - 1].y;
      let clear = true;
      for (let y = origin.y - margin; y <= y1 + margin && clear; y++) {
        for (let x = origin.x - margin; x <= x1 + margin; x++) {
          const cell = { x, y };
          if (!this.isOpen(cell) || this.grid.items[y][x]) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;
      for (const cell of bar) {
        this.grid.terrain[cell.y][cell.x] = WALL_TILE_ID;
        this.grid.segment[this.grid.key(cell)] = NO_SEGMENT;
        this.grid.hubFloor.delete(this.grid.key(cell));
        carved.push(cell);
      }
      placed++;
    }
    return carved;
  }

  /** Whether monster `type` can enter a cell of the bare region: open floor, nothing else. */
  private monsterFloor(p: GridPoint): boolean {
    return this.isFloor(p) && !this.grid.items[p.y][p.x];
  }

  /** The cells a monster walks over from `start` facing `dir`, traced with the engine's own turn order. */
  private trace(type: string, start: GridPoint, dir: Direction): GridPoint[] {
    const turns = (ConfigRegistry.getEntityDef(type)?.turnOrder ?? ['FORWARD']).map((t) => TURN_STEPS[t]);
    const seen = new Set<number>();
    const cells = new Map<number, GridPoint>();
    let at = start;
    let heading = dir;
    for (let step = 0; step < this.cfg.openMonsters.laneTraceSteps; step++) {
      const state = this.grid.key(at) * ORDERED_DIRECTIONS.length + ORDERED_DIRECTIONS.indexOf(heading);
      if (seen.has(state)) break;
      seen.add(state);
      cells.set(this.grid.key(at), at);
      let moved = false;
      for (const turn of turns) {
        const candidate = ORDERED_DIRECTIONS[(ORDERED_DIRECTIONS.indexOf(heading) + turn) % ORDERED_DIRECTIONS.length];
        const next = this.grid.step(at, candidate);
        if (!this.monsterFloor(next)) continue;
        at = next;
        heading = candidate;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return [...cells.values()];
  }

  /**
   * Picks the start of a monster: of the cells far enough from the player, the one
   * whose path covers the most ground within the limits, without crossing the path
   * of a monster already placed. Null when the region has no such lane.
   */
  private placeMonster(type: string, start: GridPoint, taken: Set<number>): Lane | null {
    const rule = this.cfg.openMonsters;
    const starts = this.regionCells().filter(
      (c) => this.monsterFloor(c) && Math.abs(c.x - start.x) + Math.abs(c.y - start.y) >= rule.minStartDistance
    );
    this.rng.shuffle(starts);
    let best: Lane | null = null;
    let bestScore = -1;
    for (const cell of starts.slice(0, rule.startSamples)) {
      const dir = ORDERED_DIRECTIONS[this.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
      const cells = this.trace(type, cell, dir);
      if (cells.length < rule.minLaneCells || cells.length > rule.maxLaneCells) continue;
      if (cells.some((c) => taken.has(this.grid.key(c)) || (c.x === start.x && c.y === start.y))) continue;
      // The longer the path, the more ground the monster guards; a little noise keeps levels apart.
      const score = cells.length + this.rng.next();
      if (score > bestScore) {
        bestScore = score;
        best = { start: cell, dir, cells };
      }
    }
    return best;
  }

  /**
   * Whether every open, bare cell of the region can still be reached from `start` on
   * foot, and every item lying in it has a reached cell beside it to be picked up from.
   */
  private stillConnected(start: GridPoint): boolean {
    const walkable = (p: GridPoint): boolean => {
      if (!this.inRegion(p) || this.grid.items[p.y][p.x]) return false;
      const tile = ConfigRegistry.getTile(this.terrainAt(p));
      return tile.passableByPlayer === true && !tile.hazard;
    };
    let total = 0;
    for (const cell of this.regionCells()) if (walkable(cell)) total++;
    if (!walkable(start)) return false;
    const seen = new Set<number>([this.grid.key(start)]);
    const queue: GridPoint[] = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const d of ORDERED_DIRECTIONS) {
        const n = this.grid.step(queue[i], d);
        const k = this.grid.key(n);
        if (seen.has(k) || !walkable(n)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
    if (seen.size !== total) return false;
    return this.regionCells().every(
      (cell) =>
        !this.grid.items[cell.y][cell.x] ||
        (cell.x === start.x && cell.y === start.y) ||
        ORDERED_DIRECTIONS.some((d) => seen.has(this.grid.key(this.grid.step(cell, d))))
    );
  }

  /** Cells within `distance` steps on the grid of any cell of `of`. */
  private within(of: Set<number>, distance: number): Set<number> {
    const near = new Set<number>();
    for (const k of of) {
      const c = this.grid.point(k);
      for (let dy = -distance; dy <= distance; dy++) {
        for (let dx = -distance; dx <= distance; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= distance) near.add(this.grid.key({ x: c.x + dx, y: c.y + dy }));
        }
      }
    }
    return near;
  }

  /**
   * Sets a few fire and water patches on bare floor, clear of every monster path
   * and of the start, and only where the rest of the region stays connected on
   * foot: a patch shapes the way round, it never closes one.
   */
  private placeHazards(start: GridPoint, lanes: Set<number>): GridPoint[] {
    const rule = this.cfg.openHazards;
    const hazards: GridPoint[] = [];
    if (rule.terrains.length === 0) return hazards;
    const nearLane = this.within(lanes, rule.laneClearance);
    for (let patch = 0; patch < rule.patches; patch++) {
      const terrain = rule.terrains[this.rng.nextInt(0, rule.terrains.length - 1)];
      const seeds = this.regionCells().filter((c) => this.patchable(c, start, nearLane, rule.startClearance));
      this.rng.shuffle(seeds);
      for (const seed of seeds.slice(0, rule.patchCells * rule.patchCells)) {
        const cells = [seed];
        while (cells.length < rule.patchCells) {
          const frontier = cells
            .flatMap((c) => ORDERED_DIRECTIONS.map((d) => this.grid.step(c, d)))
            .filter((c) => !cells.some((o) => o.x === c.x && o.y === c.y) && this.patchable(c, start, nearLane, rule.startClearance));
          if (frontier.length === 0) break;
          cells.push(frontier[this.rng.nextInt(0, frontier.length - 1)]);
        }
        for (const c of cells) this.grid.terrain[c.y][c.x] = terrain;
        if (this.stillConnected(start)) {
          hazards.push(...cells);
          break;
        }
        for (const c of cells) this.grid.terrain[c.y][c.x] = FLOOR_TILE_ID;
      }
    }
    return hazards;
  }

  private patchable(cell: GridPoint, start: GridPoint, nearLane: Set<number>, startClearance: number): boolean {
    if (!this.isFloor(cell) || this.grid.items[cell.y][cell.x] || nearLane.has(this.grid.key(cell))) return false;
    return Math.abs(cell.x - start.x) + Math.abs(cell.y - start.y) > startClearance;
  }

  /**
   * Puts the hub's items and chips on bare floor, spread out: each goes where it is
   * farthest from the start and from what is already placed. A chip asked to be
   * `near` lies within a few cells of a monster's path, not on it, and one that
   * would close the region off, or sit at the tip of a dead end, is passed over.
   * Null when an item that is not a chip finds no place.
   */
  private placeLoot(
    loot: Array<{ id: string; near: boolean }>,
    start: GridPoint,
    lanes: Set<number>
  ): Array<{ id: string; cell: GridPoint }> | null {
    const rule = this.cfg.openChips;
    const aroundLane = this.within(lanes, rule.nearLaneDistance);
    const placed: Array<{ id: string; cell: GridPoint }> = [];
    const anchors: GridPoint[] = [start];
    // Items first: a boot or key must find a place, a chip may be left out.
    const ordered = [...loot].sort((a, b) => Number(a.id === CHIP_ITEM_ID) - Number(b.id === CHIP_ITEM_ID));
    for (const item of ordered) {
      const open = this.regionCells().filter((c) => this.lootable(c, start));
      this.rng.shuffle(open);
      const offLane = open.filter((c) => !lanes.has(this.grid.key(c)));
      let pool = offLane.length > 0 ? offLane : open;
      if (item.near) {
        const near = pool.filter((c) => aroundLane.has(this.grid.key(c)));
        if (near.length > 0) pool = near;
      }
      const distance = (c: GridPoint): number => Math.min(...anchors.map((a) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y)));
      const ranked = pool
        .map((cell) => ({ cell, d: distance(cell) }))
        .sort((a, b) => b.d - a.d)
        .slice(0, rule.placementSamples);
      let chosen: GridPoint | null = null;
      for (const { cell } of ranked) {
        this.grid.items[cell.y][cell.x] = item.id;
        if (this.stillConnected(start)) {
          chosen = cell;
          break;
        }
        this.grid.items[cell.y][cell.x] = null;
      }
      if (!chosen) {
        if (item.id === CHIP_ITEM_ID) continue;
        return null;
      }
      if (item.id === CHIP_ITEM_ID) this.grid.chipCount++;
      anchors.push(chosen);
      placed.push({ id: item.id, cell: chosen });
    }
    return placed;
  }

  /** Bare floor of the region with room around it for a pickup. */
  private lootable(cell: GridPoint, start: GridPoint): boolean {
    if (!this.isFloor(cell) || this.grid.items[cell.y][cell.x]) return false;
    if (cell.x === start.x && cell.y === start.y) return false;
    const open = ORDERED_DIRECTIONS.filter((d) => this.inRegion(this.grid.step(cell, d))).length;
    return open >= MIN_OPEN_NEIGHBOURS;
  }

  /** Orders the cells nearest first, by steps on foot over the region, starting from `start`. */
  private walkingOrder(cells: GridPoint[], start: GridPoint): GridPoint[] {
    const remaining = [...cells];
    const order: GridPoint[] = [];
    let at = start;
    while (remaining.length > 0) {
      const dist = this.distancesFrom(at);
      let best = 0;
      remaining.forEach((c, i) => {
        if ((dist.get(this.grid.key(c)) ?? Number.POSITIVE_INFINITY) < (dist.get(this.grid.key(remaining[best])) ?? Number.POSITIVE_INFINITY)) best = i;
      });
      at = remaining.splice(best, 1)[0];
      order.push(at);
    }
    return order;
  }

  /** Steps on foot from `from` to each region cell, hazards and walls excluded, items stepped on. */
  private distancesFrom(from: GridPoint): Map<number, number> {
    const dist = new Map<number, number>([[this.grid.key(from), 0]]);
    const queue: GridPoint[] = [from];
    for (let i = 0; i < queue.length; i++) {
      const base = dist.get(this.grid.key(queue[i])) as number;
      for (const d of ORDERED_DIRECTIONS) {
        const n = this.grid.step(queue[i], d);
        const k = this.grid.key(n);
        if (dist.has(k) || !this.inRegion(n) || ConfigRegistry.getTile(this.terrainAt(n)).hazard) continue;
        dist.set(k, base + 1);
        queue.push(n);
      }
    }
    return dist;
  }
}
