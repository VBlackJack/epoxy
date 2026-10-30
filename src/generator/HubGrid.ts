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
import { FLOOR_TILE_ID, OPPOSITE_DIRECTION } from '../core/coreConstants';
import { CloneLink, Direction, EntityPlacement, GridPoint, HubConfig, HubGateConfig, TrapLink } from '../core/types';
import { HubWing } from './HubPlanner';
import { MAP_MARGIN, NO_SEGMENT } from './HubTypes';
import { Box } from './LevelAssembler';
import { orientTileId } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

const WALL_TILE_ID = 'wall';
const QUARTER_TURNS = [0, 1, 2, 3] as const;

/** Claimed cells of a wing under construction, laid out for repeated box tests. */
export interface ClaimedCells {
  xs: Int32Array;
  ys: Int32Array;
  bounds: Box;
}

/** The mutable parts of an assembly, kept to undo a wing placement. */
export interface AssemblySnapshot {
  terrain: string[][];
  items: (string | null)[][];
  segment: Int16Array;
  taken: Uint8Array;
  entities: number;
  trapLinks: number;
  cloneLinks: number;
  boxes: number;
  bounds: Box;
  chipCount: number;
}

/**
 * The map under construction: terrain, items, entities, the segment and taken
 * state of every cell, and the geometry and corridor routines the dead-end and
 * loop wing placers share.
 */
export class HubGrid {
  public readonly width: number;
  public readonly height: number;
  public readonly terrain: string[][];
  public readonly items: (string | null)[][];
  public readonly segment: Int16Array;
  public readonly taken: Uint8Array;
  public readonly takenSum: Int32Array;
  public takenSumDirty = true;
  public readonly entities: EntityPlacement[] = [];
  public readonly trapLinks: TrapLink[] = [];
  public readonly cloneLinks: CloneLink[] = [];
  public readonly boxes: Box[] = [];
  /** Floor cells of the hub, by key. */
  public hubFloor = new Set<number>();
  public chipCount = 0;
  public ringCache: Array<{ gate: GridPoint; outward: Direction }> | null = null;
  public endCache: Map<number, { gate: GridPoint; outward: Direction }> | null = null;
  /** Bounds of the hub floor and every wing placed so far: what compact placement keeps small. */
  public bounds: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(private readonly cfg: HubConfig) {
    const grid = ConfigRegistry.getGame().grid;
    this.width = grid.mapWidth;
    this.height = grid.mapHeight;
    this.terrain = Array.from({ length: this.height }, () => new Array<string>(this.width).fill(WALL_TILE_ID));
    this.items = Array.from({ length: this.height }, () => new Array<string | null>(this.width).fill(null));
    this.segment = new Int16Array(this.width * this.height).fill(NO_SEGMENT);
    this.taken = new Uint8Array(this.width * this.height);
    this.takenSum = new Int32Array((this.width + 1) * (this.height + 1));
  }

  /**
   * Cells of the hub's wall ring where a wing may leave: next to exactly one
   * hub floor cell, the wing heading straight away from it, with no hub floor
   * beside the gate (a concave corner would open two ways).
   */
  public gateCandidates(): Array<{ gate: GridPoint; outward: Direction }> {
    const candidates: Array<{ gate: GridPoint; outward: Direction }> = [];
    for (const k of this.hubFloor) {
      const floor = this.point(k);
      for (const outward of ORDERED_DIRECTIONS) {
        const gate = this.step(floor, outward);
        const gk = this.key(gate);
        if (this.hubFloor.has(gk) || !this.inMap(gate)) continue;
        const touching = ORDERED_DIRECTIONS.filter((d) => this.hubFloor.has(this.key(this.step(gate, d))));
        if (touching.length !== 1) continue;
        // No hub floor diagonal to the gate either: the opening must be a clean notch.
        const sideways: Direction[] = outward === 'N' || outward === 'S' ? ['E', 'W'] : ['N', 'S'];
        if (sideways.some((d) => this.hubFloor.has(this.key(this.step(this.step(gate, d), outward))))) continue;
        candidates.push({ gate, outward });
      }
    }
    return candidates;
  }

  /** Everything a wing placement changes, so a placement can be taken back. */
  public snapshot(): AssemblySnapshot {
    return {
      terrain: this.terrain.map((row) => [...row]),
      items: this.items.map((row) => [...row]),
      segment: this.segment.slice(),
      taken: this.taken.slice(),
      entities: this.entities.length,
      trapLinks: this.trapLinks.length,
      cloneLinks: this.cloneLinks.length,
      boxes: this.boxes.length,
      bounds: { ...this.bounds },
      chipCount: this.chipCount
    };
  }

  public restore(saved: AssemblySnapshot): void {
    saved.terrain.forEach((row, y) => this.terrain[y].splice(0, row.length, ...row));
    saved.items.forEach((row, y) => this.items[y].splice(0, row.length, ...row));
    this.segment.set(saved.segment);
    this.taken.set(saved.taken);
    this.takenSumDirty = true;
    this.entities.length = saved.entities;
    this.trapLinks.length = saved.trapLinks;
    this.cloneLinks.length = saved.cloneLinks;
    this.boxes.length = saved.boxes;
    this.bounds = { ...saved.bounds };
    this.chipCount = saved.chipCount;
  }

  /** The ring cells a way back may end at, keyed by the cell right outside the strip leaving each. */
  public returnEnds(): Map<number, { gate: GridPoint; outward: Direction }> {
    if (!this.endCache) {
      this.ringCache ??= this.gateCandidates();
      this.endCache = new Map(
        this.ringCache.map((ring) => [this.key(this.stepN(ring.gate, ring.outward, this.cfg.returnDepth)), ring])
      );
    }
    return this.endCache;
  }

  /** Whether a corridor cell of segment `seg` can be opened here: free ground that touches nothing of another segment. */
  public corridorFits(p: GridPoint, seg: number, boxes: Box[], claims: Map<number, number>, touching = -1): boolean {
    if (!this.inMap(p)) return false;
    const k = this.key(p);
    if (this.taken[k] || claims.has(k) || boxes.some((b) => this.inBox(p, b))) return false;
    // The hottest loop of the layout: neighbours are addressed by arithmetic, not by points.
    for (const dir of ORDERED_DIRECTIONS) {
      const nx = p.x + DIRECTION_VECTORS[dir].dx;
      const ny = p.y + DIRECTION_VECTORS[dir].dy;
      const nk = ny * this.width + nx;
      if (nk === touching) continue;
      const neighbourSeg = claims.get(nk) ?? (this.inMapAt(nx, ny) ? this.segment[nk] : NO_SEGMENT);
      if (neighbourSeg !== NO_SEGMENT && neighbourSeg !== seg) return false;
    }
    return true;
  }

  /**
   * The claimed cells laid out for many box tests: their coordinates and
   * their bounds, so a box clear of the bounds is dismissed at once.
   */
  public claimedCells(claims: Map<number, number>): ClaimedCells {
    const xs = new Int32Array(claims.size);
    const ys = new Int32Array(claims.size);
    const bounds: Box = { x0: this.width, y0: this.height, x1: -1, y1: -1 };
    let i = 0;
    for (const k of claims.keys()) {
      const x = k % this.width;
      const y = Math.floor(k / this.width);
      xs[i] = x;
      ys[i] = y;
      i++;
      if (x < bounds.x0) bounds.x0 = x;
      if (x > bounds.x1) bounds.x1 = x;
      if (y < bounds.y0) bounds.y0 = y;
      if (y > bounds.y1) bounds.y1 = y;
    }
    return { xs, ys, bounds };
  }

  /** Whether any of the claimed cells but `except` lies in the box. */
  public claimedTouchBox(claimed: ClaimedCells, box: Box, except: GridPoint): boolean {
    if (!this.overlaps(claimed.bounds, box)) return false;
    for (let i = 0; i < claimed.xs.length; i++) {
      const x = claimed.xs[i];
      const y = claimed.ys[i];
      if (x === except.x && y === except.y) continue;
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return true;
    }
    return false;
  }

  /** The terrain of a lock on a wing leaving the hub toward `outward`: turned to push back when it is a force floor. */
  public gateTerrain(config: HubGateConfig, outward: Direction): string {
    if (!config.orientTowardHub) return config.terrain;
    // The lock pushes the player back toward the hub.
    for (const quarterTurns of QUARTER_TURNS) {
      const turned = orientTileId(config.terrain, { quarterTurns, mirrored: false });
      if (turned && ConfigRegistry.getTile(turned).forceDirection === OPPOSITE_DIRECTION[outward]) return turned;
    }
    return config.terrain;
  }

  public paintGate(wing: HubWing, cells: GridPoint[], outward: Direction): void {
    const config = wing.gate.config;
    if (!config) return;
    const terrain = this.gateTerrain(config, outward);
    const painted = wing.gate.kind === 'door' ? cells.slice(0, 1) : cells;
    for (const cell of painted) this.terrain[cell.y][cell.x] = terrain;
  }

  public stamp(piece: CompiledPiece, origin: GridPoint): void {
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        const p = { x: origin.x + x, y: origin.y + y };
        this.terrain[p.y][p.x] = piece.terrain[y][x];
        const item = piece.items[y][x];
        this.items[p.y][p.x] = item;
        if (item && ConfigRegistry.getTile(item).collectible === 'chip') this.chipCount++;
        this.take(p);
      }
    }
    for (const e of piece.entities) this.entities.push({ ...e, x: e.x + origin.x, y: e.y + origin.y });
    for (const l of piece.trapLinks) {
      this.trapLinks.push({
        buttonX: l.buttonX + origin.x,
        buttonY: l.buttonY + origin.y,
        trapX: l.trapX + origin.x,
        trapY: l.trapY + origin.y
      });
    }
    for (const l of piece.cloneLinks) {
      this.cloneLinks.push({
        ...l,
        buttonX: l.buttonX + origin.x,
        buttonY: l.buttonY + origin.y,
        clonerX: l.clonerX + origin.x,
        clonerY: l.clonerY + origin.y
      });
    }
    this.boxes.push(this.boxOf(piece, origin));
  }

  public open(p: GridPoint, seg: number, carve = true): void {
    const k = this.key(p);
    this.segment[k] = seg;
    this.taken[k] = 1;
    this.takenSumDirty = true;
    // Ports keep their piece terrain; other open cells become floor.
    if (carve || !this.inAnyBox(p)) this.terrain[p.y][p.x] = FLOOR_TILE_ID;
  }

  public take(p: GridPoint): void {
    if (this.inMap(p)) {
      this.taken[this.key(p)] = 1;
      this.takenSumDirty = true;
    }
  }

  public boxFree(box: Box): boolean {
    if (box.x0 < MAP_MARGIN || box.y0 < MAP_MARGIN) return false;
    if (box.x1 > this.width - 1 - MAP_MARGIN || box.y1 > this.height - 1 - MAP_MARGIN) return false;
    if (this.takenSumDirty) this.rebuildTakenSum();
    const stride = this.width + 1;
    const sum =
      this.takenSum[(box.y1 + 1) * stride + box.x1 + 1] -
      this.takenSum[box.y0 * stride + box.x1 + 1] -
      this.takenSum[(box.y1 + 1) * stride + box.x0] +
      this.takenSum[box.y0 * stride + box.x0];
    return sum === 0;
  }

  /** Prefix sums of the taken cells, so that a box is checked free in constant time. */
  public rebuildTakenSum(): void {
    const stride = this.width + 1;
    for (let y = 0; y < this.height; y++) {
      let row = 0;
      for (let x = 0; x < this.width; x++) {
        row += this.taken[y * this.width + x];
        this.takenSum[(y + 1) * stride + x + 1] = this.takenSum[y * stride + x + 1] + row;
      }
    }
    this.takenSumDirty = false;
  }

  public outwardOf(piece: CompiledPiece, port: GridPoint): Direction {
    if (port.y === 0) return 'N';
    if (port.y === piece.height - 1) return 'S';
    if (port.x === 0) return 'W';
    return 'E';
  }

  public boxOf(piece: CompiledPiece, origin: GridPoint): Box {
    return { x0: origin.x, y0: origin.y, x1: origin.x + piece.width - 1, y1: origin.y + piece.height - 1 };
  }

  public area(b: Box): number {
    return (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  }

  public cellBox(p: GridPoint): Box {
    return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  public cellsBox(cells: GridPoint[]): Box {
    return cells.map((c) => this.cellBox(c)).reduce((a, b) => this.union(a, b));
  }

  public union(a: Box, b: Box): Box {
    return {
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1)
    };
  }

  public overlaps(a: Box, b: Box): boolean {
    return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
  }

  public inBox(p: GridPoint, b: Box): boolean {
    return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  }

  public inAnyBox(p: GridPoint): boolean {
    return this.boxes.some((b) => this.inBox(p, b));
  }

  public inMap(p: GridPoint): boolean {
    return this.inMapAt(p.x, p.y);
  }

  public inMapAt(x: number, y: number): boolean {
    return x >= MAP_MARGIN && y >= MAP_MARGIN && x < this.width - MAP_MARGIN && y < this.height - MAP_MARGIN;
  }

  public step(p: GridPoint, dir: Direction): GridPoint {
    return { x: p.x + DIRECTION_VECTORS[dir].dx, y: p.y + DIRECTION_VECTORS[dir].dy };
  }

  public stepN(p: GridPoint, dir: Direction, n: number): GridPoint {
    return { x: p.x + DIRECTION_VECTORS[dir].dx * n, y: p.y + DIRECTION_VECTORS[dir].dy * n };
  }

  public key(p: GridPoint): number {
    return p.y * this.width + p.x;
  }

  public point(k: number): GridPoint {
    return { x: k % this.width, y: Math.floor(k / this.width) };
  }
}
