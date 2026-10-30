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
import { FLOOR_TILE_ID } from '../core/coreConstants';
import { SeededRandom } from '../core/Random';
import {
  CloneLink,
  Direction,
  EntityPlacement,
  GridPoint,
  ProceduralConfig,
  TrapLink
} from '../core/types';
import { LevelPlan } from './ProgressionPlanner';
import { CompiledPiece } from './PieceTypes';

const WALL_TILE_ID = 'wall';
const EXIT_TILE_ID = 'exit';
/** Cells kept free between two pieces, so a corridor can always pass between them. */
const PIECE_GAP = 1;
/** Map border that stays wall. */
const MAP_MARGIN = 1;
const NO_PARENT = -1;

/**
 * A stretch of the proven route: plain moves, a cell to walk to by the
 * shortest safe path, or a piece to solve on the spot, forwards to its exit
 * or backwards to its entry when the player leaves a dead-end wing.
 */
export type RouteSegment =
  | { kind: 'walk'; moves: Direction[] }
  | { kind: 'goto'; target: GridPoint }
  /** Pushes a block ahead of the player along `moves`; it must then rest on `block`. */
  | { kind: 'push'; moves: Direction[]; block: GridPoint }
  | {
      kind: 'piece';
      piece: CompiledPiece;
      origin: GridPoint;
      isFinale: boolean;
      towards?: 'exit' | 'entry';
    };

export interface AssembledLevel {
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  playerStart: GridPoint;
  route: RouteSegment[];
  chipCount: number;
  /** Bounds of every placed piece, finale last. */
  pieceBoxes: Box[];
}

/** Inclusive cell bounds. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Placement {
  origin: GridPoint;
  path: GridPoint[];
  score: number;
}

/**
 * Lays a planned chain of pieces out on the map and joins them with
 * corridors. The layout keeps the chain a chain: a corridor never touches
 * another corridor, the start, or a port other than the two it joins, so no
 * piece can be skipped. Boots a piece needs lie on the corridor leading to it.
 */
export class LevelAssembler {
  private readonly width: number;
  private readonly height: number;
  private readonly terrain: string[][];
  private readonly items: (string | null)[][];
  private readonly occupied = new Set<number>();
  private readonly boxes: Box[] = [];
  private readonly entities: EntityPlacement[] = [];
  private readonly trapLinks: TrapLink[] = [];
  private readonly cloneLinks: CloneLink[] = [];
  private readonly route: RouteSegment[] = [];
  private region: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Bounds of everything placed so far: what compact placement keeps small. */
  private bounds: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private chipCount = 0;
  /** Where the next corridor starts: the start cell, then each exit's outer cell. */
  private head: GridPoint = { x: 0, y: 0 };

  private constructor(
    private readonly cfg: ProceduralConfig,
    private readonly rng: SeededRandom
  ) {
    const grid = ConfigRegistry.getGame().grid;
    this.width = grid.mapWidth;
    this.height = grid.mapHeight;
    this.terrain = Array.from({ length: this.height }, () =>
      new Array<string>(this.width).fill(WALL_TILE_ID)
    );
    this.items = Array.from({ length: this.height }, () =>
      new Array<string | null>(this.width).fill(null)
    );
  }

  /** Returns the assembled level, or null when the pieces do not fit the region. */
  public static assemble(
    plan: LevelPlan,
    regionSize: number,
    cfg: ProceduralConfig,
    rng: SeededRandom
  ): AssembledLevel | null {
    const assembler = new LevelAssembler(cfg, rng);
    return assembler.build(plan, regionSize);
  }

  private build(plan: LevelPlan, regionSize: number): AssembledLevel | null {
    const side = Math.min(regionSize, this.width - 2 * MAP_MARGIN, this.height - 2 * MAP_MARGIN);
    const x0 = Math.floor((this.width - side) / 2);
    const y0 = Math.floor((this.height - side) / 2);
    this.region = { x0, y0, x1: x0 + side - 1, y1: y0 + side - 1 };

    const start = {
      x: this.rng.nextInt(this.region.x0, this.region.x1),
      y: this.rng.nextInt(this.region.y0, this.region.y1)
    };
    this.carve(start);
    this.bounds = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    this.head = start;

    for (let i = 0; i < plan.steps.length; i++) {
      const { piece, giveBefore } = plan.steps[i];
      const isFinale = i === plan.steps.length - 1;
      const placement = this.findPlacement(piece, isFinale, giveBefore.length);
      if (!placement) return null;
      this.commit(piece, placement, giveBefore, isFinale);
    }

    return {
      terrain: this.terrain,
      items: this.items,
      entities: this.entities,
      trapLinks: this.trapLinks,
      cloneLinks: this.cloneLinks,
      playerStart: start,
      route: this.route,
      chipCount: this.chipCount,
      pieceBoxes: [...this.boxes]
    };
  }

  private findPlacement(
    piece: CompiledPiece,
    isFinale: boolean,
    itemsToHand: number
  ): Placement | null {
    const target = this.rng.nextInt(this.cfg.minCorridorLength, this.cfg.maxCorridorLength);
    let best: Placement | null = null;
    for (let sample = 0; sample < this.cfg.placementSamplesPerPiece; sample++) {
      const maxX = this.region.x1 - piece.width + 1;
      const maxY = this.region.y1 - piece.height + 1;
      if (maxX < this.region.x0 || maxY < this.region.y0) return null;
      // Sample near the head of the chain: short corridors keep the level packed
      // and leave room for the pieces still to come.
      const reach = this.cfg.maxCorridorLength;
      const loX = Math.max(this.region.x0, this.head.x - piece.width - reach);
      const hiX = Math.min(maxX, this.head.x + reach);
      const loY = Math.max(this.region.y0, this.head.y - piece.height - reach);
      const hiY = Math.min(maxY, this.head.y + reach);
      if (loX > hiX || loY > hiY) return null;
      const origin = {
        x: this.rng.nextInt(loX, hiX),
        y: this.rng.nextInt(loY, hiY)
      };
      const box = this.boxOf(piece, origin);
      if (this.boxes.some((b) => this.overlaps(b, box, PIECE_GAP))) continue;
      if (this.boxHasUsedCell(box)) continue;

      const entryPort = this.add(origin, piece.entry);
      const entryOut = this.step(entryPort, this.outward(piece, piece.entry));
      const exitPort = this.add(origin, piece.exit);
      const exitOut = this.step(exitPort, this.outward(piece, piece.exit));
      // A used cell right outside the exit port is a shortcut past the piece. This holds
      // for the finale too, whose exit port becomes the level exit.
      if (this.occupied.has(this.key(exitOut))) continue;
      const reserved = [exitPort];
      if (!isFinale) {
        if (!this.inRegion(exitOut) || this.inAnyBox(exitOut) || this.isTouched(exitOut, [])) {
          continue;
        }
        // An exit cell next to the entry port would let the player walk around the piece.
        if (Math.abs(exitOut.x - entryPort.x) + Math.abs(exitOut.y - entryPort.y) <= 1) continue;
        reserved.push(exitOut);
      }
      if (!this.inRegion(entryOut) || this.inAnyBox(entryOut)) continue;

      const path = this.corridor(this.head, entryOut, entryPort, box, reserved);
      // Boots placed straight on the corridor need cells of their own.
      if (!path || path.length < itemsToHand) continue;
      // Corridor length near its target, and as little growth of the level's bounds as possible.
      const spread = this.spreadOf(box, path);
      const growth = (this.area(this.union(this.bounds, spread)) - this.area(this.bounds)) / (piece.width * piece.height);
      const score = Math.abs(path.length - target) + this.cfg.placementCompactness * growth;
      if (!best || score < best.score) best = { origin, path, score };
      if (score === 0) break;
    }
    return best;
  }

  /**
   * Shortest corridor from head to target. Every new cell lies in the region,
   * outside every piece, and touches no used cell except head and the target
   * entry port.
   */
  private corridor(
    head: GridPoint,
    target: GridPoint,
    entryPort: GridPoint,
    candidate: Box,
    reserved: GridPoint[]
  ): GridPoint[] | null {
    const allowedNeighbours = [this.key(head), this.key(entryPort)];
    const blocked = new Set(reserved.map((p) => this.key(p)));
    const usable = (p: GridPoint): boolean =>
      this.inRegion(p) &&
      !this.inBox(p, candidate) &&
      !this.inAnyBox(p) &&
      !this.occupied.has(this.key(p)) &&
      !blocked.has(this.key(p)) &&
      !this.isTouched(p, allowedNeighbours, blocked);
    if (!usable(target)) return null;

    const parent = new Map<number, number>([[this.key(head), NO_PARENT]]);
    const queue: GridPoint[] = [head];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (cell.x === target.x && cell.y === target.y) {
        const path: GridPoint[] = [];
        for (let k = this.key(cell); k !== this.key(head); k = parent.get(k) as number) {
          path.push(this.point(k));
        }
        return path.reverse();
      }
      for (const dir of ORDERED_DIRECTIONS) {
        const next = this.step(cell, dir);
        if (parent.has(this.key(next)) || !usable(next)) continue;
        parent.set(this.key(next), this.key(cell));
        queue.push(next);
      }
    }
    return null;
  }

  /**
   * Writes the piece and its corridor into the map and the route.
   */
  private commit(
    piece: CompiledPiece,
    placement: Placement,
    giveBefore: string[],
    isFinale: boolean
  ): void {
    const { origin, path } = placement;
    const corridorStart = this.head;
    this.bounds = this.union(this.bounds, this.spreadOf(this.boxOf(piece, origin), path));
    for (const cell of path) this.carve(cell);
    this.stamp(piece, origin);

    const exitPort = this.add(origin, piece.exit);
    const outDir = this.outward(piece, piece.exit);
    const exitOut = this.step(exitPort, outDir);
    if (isFinale) {
      this.terrain[exitPort.y][exitPort.x] = EXIT_TILE_ID;
    } else {
      this.carve(exitOut);
    }

    this.handOver(path, this.movesAlong(corridorStart, path), giveBefore);
    const entryPort = this.add(origin, piece.entry);
    const lastCorridorCell = path.length > 0 ? path[path.length - 1] : corridorStart;
    this.route.push({ kind: 'walk', moves: [this.directionBetween(lastCorridorCell, entryPort)] });
    this.route.push({ kind: 'piece', piece, origin, isFinale });
    if (!isFinale) {
      this.route.push({ kind: 'walk', moves: [outDir] });
      this.head = exitOut;
    }
  }

  /**
   * Places the items a piece needs on the corridor leading to it, where the
   * player cannot miss them. No side alcove is dug: an alcove is a dead end
   * that adds a detour and nothing to think about.
   */
  private handOver(path: GridPoint[], moves: Direction[], giveBefore: string[]): void {
    giveBefore.forEach((itemId, i) => {
      const cell = path[i];
      this.items[cell.y][cell.x] = itemId;
    });
    this.route.push({ kind: 'walk', moves });
  }

  private stamp(piece: CompiledPiece, origin: GridPoint): void {
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        this.terrain[origin.y + y][origin.x + x] = piece.terrain[y][x];
        const item = piece.items[y][x];
        this.items[origin.y + y][origin.x + x] = item;
        if (item && ConfigRegistry.getTile(item).collectible === 'chip') this.chipCount++;
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
    this.occupied.add(this.key(this.add(origin, piece.entry)));
    this.occupied.add(this.key(this.add(origin, piece.exit)));
  }

  private carve(p: GridPoint): void {
    this.terrain[p.y][p.x] = FLOOR_TILE_ID;
    this.occupied.add(this.key(p));
  }

  /** Whether a used cell other than the allowed ones sits next to p. */
  private isTouched(p: GridPoint, allowed: number[], extra: Set<number> = new Set()): boolean {
    return ORDERED_DIRECTIONS.some((dir) => {
      const k = this.key(this.step(p, dir));
      return (this.occupied.has(k) || extra.has(k)) && !allowed.includes(k);
    });
  }

  /** Direction pointing out of the piece from a port on its border. */
  private outward(piece: CompiledPiece, port: GridPoint): Direction {
    if (port.y === 0) return 'N';
    if (port.y === piece.height - 1) return 'S';
    if (port.x === 0) return 'W';
    return 'E';
  }

  private movesAlong(from: GridPoint, path: GridPoint[]): Direction[] {
    const moves: Direction[] = [];
    let previous = from;
    for (const cell of path) {
      moves.push(this.directionBetween(previous, cell));
      previous = cell;
    }
    return moves;
  }

  private directionBetween(a: GridPoint, b: GridPoint): Direction {
    const found = ORDERED_DIRECTIONS.find(
      (dir) => a.x + DIRECTION_VECTORS[dir].dx === b.x && a.y + DIRECTION_VECTORS[dir].dy === b.y
    );
    if (!found) throw new Error(`cells ${a.x},${a.y} and ${b.x},${b.y} are not adjacent`);
    return found;
  }

  private boxOf(piece: CompiledPiece, origin: GridPoint): Box {
    return { x0: origin.x, y0: origin.y, x1: origin.x + piece.width - 1, y1: origin.y + piece.height - 1 };
  }

  /** Smallest box holding a piece box and the corridor cells leading to it. */
  private spreadOf(box: Box, path: GridPoint[]): Box {
    return path.reduce<Box>(
      (acc, cell) => this.union(acc, { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y }),
      box
    );
  }

  private union(a: Box, b: Box): Box {
    return {
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1)
    };
  }

  private area(b: Box): number {
    return (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  }

  private overlaps(a: Box, b: Box, gap: number): boolean {
    return !(
      a.x1 + gap < b.x0 ||
      b.x1 + gap < a.x0 ||
      a.y1 + gap < b.y0 ||
      b.y1 + gap < a.y0
    );
  }

  private inBox(p: GridPoint, b: Box): boolean {
    return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  }

  private boxHasUsedCell(box: Box): boolean {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (this.occupied.has(this.key({ x, y }))) return true;
      }
    }
    return false;
  }

  private inAnyBox(p: GridPoint): boolean {
    return this.boxes.some((b) => this.inBox(p, b));
  }

  private inRegion(p: GridPoint): boolean {
    return this.inBox(p, this.region);
  }

  private step(p: GridPoint, dir: Direction): GridPoint {
    return { x: p.x + DIRECTION_VECTORS[dir].dx, y: p.y + DIRECTION_VECTORS[dir].dy };
  }

  private add(a: GridPoint, b: GridPoint): GridPoint {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  private key(p: GridPoint): number {
    return p.y * this.width + p.x;
  }

  private point(k: number): GridPoint {
    return { x: k % this.width, y: Math.floor(k / this.width) };
  }
}
