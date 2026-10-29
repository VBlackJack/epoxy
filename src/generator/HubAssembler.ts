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
import { SeededRandom } from '../core/Random';
import { CloneLink, Direction, EntityPlacement, GridPoint, HubConfig, TrapLink } from '../core/types';
import { HubPlan, HubWing } from './HubPlanner';
import { AssembledLevel, Box, RouteSegment } from './LevelAssembler';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece, orientTileId } from './PieceCompiler';
import { CompiledPiece, PieceOrientation } from './PieceTypes';

const WALL_TILE_ID = 'wall';
const EXIT_TILE_ID = 'exit';
const CHIP_ITEM_ID = 'chip';
const MAP_MARGIN = 1;
/** Segment id of the hub floor; wings use two ids each, before and after their puzzle. */
const HUB_SEGMENT = 0;
const NO_SEGMENT = -1;
const QUARTER_TURNS = [0, 1, 2, 3] as const;

/** Where a guard is checked: walling `box` must cut `guarded` off from the start. */
export interface LevelGuard {
  box: Box;
  guarded: GridPoint;
}

export interface AssembledHubLevel extends AssembledLevel {
  guards: LevelGuard[];
}

interface WingPlacement {
  piece: CompiledPiece;
  origin: GridPoint;
  outward: Direction;
  /** Gate cells then connector cells, from the hub outwards. */
  approach: GridPoint[];
  gateLength: number;
  exitDir: Direction;
  /** Room cells (non-final wings), the first one touching the exit port. */
  room: GridPoint[];
  finale?: {
    piece: CompiledPiece;
    origin: GridPoint;
    /** Moves from the cell past the puzzle exit to the cell before the finale. */
    path: Direction[];
    /** Direction of the last step, into the finale's entry port. */
    approachDir: Direction;
  };
}

/**
 * Lays a hub plan out: an open hub in the middle of the map, the player
 * starting at its centre, and each wing leaving the hub straight through a
 * gate cell in the hub's wall ring. A wing is gate, optional short connector,
 * the puzzle piece turned to face the hub, then either a dead-end reward room
 * or, for the final wing, the finale piece with the exit.
 *
 * Every open cell belongs to a segment: the hub, the part of a wing before
 * its puzzle, or the part after it. Two open cells of different segments are
 * never neighbours, except a gate and the hub cell in front of it, so the
 * only way past a puzzle is through it.
 */
export class HubAssembler {
  private readonly width: number;
  private readonly height: number;
  private readonly terrain: string[][];
  private readonly items: (string | null)[][];
  private readonly segment: Int16Array;
  private readonly taken: Uint8Array;
  private readonly entities: EntityPlacement[] = [];
  private readonly trapLinks: TrapLink[] = [];
  private readonly cloneLinks: CloneLink[] = [];
  private readonly boxes: Box[] = [];
  private hub: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private chipCount = 0;

  private constructor(
    private readonly cfg: HubConfig,
    private readonly rng: SeededRandom
  ) {
    const grid = ConfigRegistry.getGame().grid;
    this.width = grid.mapWidth;
    this.height = grid.mapHeight;
    this.terrain = Array.from({ length: this.height }, () => new Array<string>(this.width).fill(WALL_TILE_ID));
    this.items = Array.from({ length: this.height }, () => new Array<string | null>(this.width).fill(null));
    this.segment = new Int16Array(this.width * this.height).fill(NO_SEGMENT);
    this.taken = new Uint8Array(this.width * this.height);
  }

  /** Returns the assembled level, or null when the wings do not fit around the hub. */
  public static assemble(plan: HubPlan, cfg: HubConfig, rng: SeededRandom): AssembledHubLevel | null {
    return new HubAssembler(cfg, rng).build(plan);
  }

  private build(plan: HubPlan): AssembledHubLevel | null {
    const x0 = Math.floor((this.width - this.cfg.width) / 2);
    const y0 = Math.floor((this.height - this.cfg.height) / 2);
    this.hub = { x0, y0, x1: x0 + this.cfg.width - 1, y1: y0 + this.cfg.height - 1 };
    for (let y = this.hub.y0 - 1; y <= this.hub.y1 + 1; y++) {
      for (let x = this.hub.x0 - 1; x <= this.hub.x1 + 1; x++) this.take({ x, y });
    }
    for (let y = this.hub.y0; y <= this.hub.y1; y++) {
      for (let x = this.hub.x0; x <= this.hub.x1; x++) this.open({ x, y }, HUB_SEGMENT);
    }
    const start = { x: Math.floor((this.hub.x0 + this.hub.x1) / 2), y: Math.floor((this.hub.y0 + this.hub.y1) / 2) };

    // Place the largest wings first; the visit order stays the plan's.
    const order = plan.wings
      .map((wing, index) => ({ wing, index }))
      .sort((a, b) => this.area(b.wing) - this.area(a.wing));
    const placements: WingPlacement[] = new Array(plan.wings.length);
    for (const { wing, index } of order) {
      const placement = this.placeWing(wing, index, plan.finale);
      if (!placement) return null;
      placements[index] = placement;
    }

    const hubItemCells = this.scatter(plan.hubItems, this.hubCells(start));
    if (!hubItemCells) return null;
    const hubChipCells = this.scatter(
      new Array<string>(this.cfg.hubChips).fill(CHIP_ITEM_ID),
      this.hubCells(start)
    );
    if (!hubChipCells) return null;

    const route: RouteSegment[] = [...hubItemCells, ...hubChipCells].map((target) => ({ kind: 'goto', target }));
    const guards: LevelGuard[] = [];
    plan.wings.forEach((wing, index) => {
      const placement = placements[index];
      const rewardCells = this.fillRoom(wing, placement);
      route.push(...this.wingRoute(placement, rewardCells, wing.isFinal));
      const box = this.boxOf(placement.piece, placement.origin);
      guards.push({
        box,
        guarded: wing.isFinal ? this.finaleExit(placement) : placement.room[0]
      });
    });

    return {
      terrain: this.terrain,
      items: this.items,
      entities: this.entities,
      trapLinks: this.trapLinks,
      cloneLinks: this.cloneLinks,
      playerStart: start,
      route,
      chipCount: this.chipCount,
      pieceBoxes: [...this.boxes],
      guards
    };
  }

  /** Tries every gate cell of the hub ring, in random order, for the wing. */
  private placeWing(wing: HubWing, index: number, finale: CompiledPiece): WingPlacement | null {
    const candidates: Array<{ gate: GridPoint; outward: Direction }> = [];
    for (let x = this.hub.x0 + 1; x < this.hub.x1; x++) {
      candidates.push({ gate: { x, y: this.hub.y0 - 1 }, outward: 'N' });
      candidates.push({ gate: { x, y: this.hub.y1 + 1 }, outward: 'S' });
    }
    for (let y = this.hub.y0 + 1; y < this.hub.y1; y++) {
      candidates.push({ gate: { x: this.hub.x0 - 1, y }, outward: 'W' });
      candidates.push({ gate: { x: this.hub.x1 + 1, y }, outward: 'E' });
    }
    this.rng.shuffle(candidates);
    const orientations = wing.piece.rotatable ? [...ALL_ORIENTATIONS] : [IDENTITY_ORIENTATION];
    this.rng.shuffle(orientations);
    const gateLength = wing.gate.kind === 'hazard' ? this.cfg.hazardDepth : 1;
    const approachSegment = 2 * index + 1;
    const beyondSegment = 2 * index + 2;

    for (const { gate, outward } of candidates) {
      for (let connectors = 0; connectors <= this.cfg.maxConnectorLength; connectors++) {
        for (const o of orientations) {
          const piece = orientPiece(wing.piece, o);
          if (this.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[outward]) continue;
          const placement = this.tryWing(
            wing,
            piece,
            gate,
            outward,
            gateLength,
            connectors,
            approachSegment,
            beyondSegment,
            finale
          );
          if (placement) return placement;
        }
      }
    }
    return null;
  }

  private tryWing(
    wing: HubWing,
    piece: CompiledPiece,
    gate: GridPoint,
    outward: Direction,
    gateLength: number,
    connectors: number,
    approachSegment: number,
    beyondSegment: number,
    finale: CompiledPiece
  ): WingPlacement | null {
    const approach = Array.from({ length: gateLength + connectors }, (_, i) => this.stepN(gate, outward, i));
    const entryPort = this.stepN(gate, outward, gateLength + connectors);
    const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
    const box = this.boxOf(piece, origin);
    if (!this.boxFree(box)) return null;
    const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
    const exitDir = this.outwardOf(piece, piece.exit);

    const claims = new Map<number, number>();
    const claim = (p: GridPoint, seg: number) => claims.set(this.key(p), seg);
    approach.forEach((p) => claim(p, approachSegment));
    claim(entryPort, approachSegment);
    claim(exitPort, beyondSegment);

    let room: GridPoint[] = [];
    let finalePlacement: WingPlacement['finale'];
    const first = this.step(exitPort, exitDir);
    if (wing.isFinal) {
      claim(first, beyondSegment);
      const placedFinale = this.fitFinale(finale, first, exitDir, box, claims, beyondSegment);
      if (!placedFinale) return null;
      finalePlacement = placedFinale;
    } else {
      room = this.roomCells(first, exitDir);
      room.forEach((p) => claim(p, beyondSegment));
    }

    // Every claimed cell must be free (the gate sits on the hub ring), stay out
    // of the pieces but for their ports, and touch only open cells of its own
    // segment, except the gate facing the hub.
    const finaleBox = finalePlacement ? this.boxOf(finalePlacement.piece, finalePlacement.origin) : null;
    const ports = new Set([this.key(entryPort), this.key(exitPort)]);
    if (finalePlacement) {
      ports.add(this.key({
        x: finalePlacement.origin.x + finalePlacement.piece.entry.x,
        y: finalePlacement.origin.y + finalePlacement.piece.entry.y
      }));
    }
    for (const [k, seg] of claims) {
      const p = this.point(k);
      const isPort = ports.has(k);
      if (!this.inMap(p)) return null;
      if (!isPort && (this.inBox(p, box) || (finaleBox && this.inBox(p, finaleBox)))) return null;
      const isGate = k === this.key(gate);
      if (this.taken[k] && !isGate) return null;
      if (isGate && this.segment[k] !== NO_SEGMENT) return null;
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(p, dir);
        const nk = this.key(n);
        const neighbourSeg = claims.get(nk) ?? (this.inMap(n) ? this.segment[nk] : NO_SEGMENT);
        if (neighbourSeg === NO_SEGMENT || neighbourSeg === seg) continue;
        if (isGate && neighbourSeg === HUB_SEGMENT && dir === OPPOSITE_DIRECTION[outward]) continue;
        return null;
      }
    }
    if (finalePlacement && !this.boxFree(this.boxOf(finalePlacement.piece, finalePlacement.origin))) return null;

    // Commit.
    this.stamp(piece, origin);
    if (finalePlacement) this.stamp(finalePlacement.piece, finalePlacement.origin);
    for (const [k, seg] of claims) this.open(this.point(k), seg, false);
    this.paintGate(wing, approach.slice(0, gateLength), outward);
    if (finalePlacement) {
      const exitCell = {
        x: finalePlacement.origin.x + finalePlacement.piece.exit.x,
        y: finalePlacement.origin.y + finalePlacement.piece.exit.y
      };
      this.terrain[exitCell.y][exitCell.x] = EXIT_TILE_ID;
    }
    return { piece, origin, outward, approach, gateLength, exitDir, room, finale: finalePlacement };
  }

  /**
   * Places the finale past the last puzzle's exit: one cell straight out,
   * then optionally a short turn sideways, so a long piece near the map edge
   * still leaves room. The finale is turned to open back toward that path.
   */
  private fitFinale(
    finale: CompiledPiece,
    connector: GridPoint,
    exitDir: Direction,
    wingBox: Box,
    claims: Map<number, number>,
    beyondSegment: number
  ): WingPlacement['finale'] | null {
    const options: PieceOrientation[] = finale.rotatable ? [...ALL_ORIENTATIONS] : [IDENTITY_ORIENTATION];
    const sideways: Direction[] = exitDir === 'N' || exitDir === 'S' ? ['E', 'W'] : ['N', 'S'];
    const paths: Direction[][] = [[]];
    for (const side of sideways) {
      for (let length = 1; length <= this.cfg.maxConnectorLength; length++) {
        paths.push(new Array<Direction>(length).fill(side));
      }
    }
    for (const path of paths) {
      const cells: GridPoint[] = [];
      let last = connector;
      for (const dir of path) {
        last = this.step(last, dir);
        cells.push(last);
      }
      const approachDir = path.length > 0 ? path[path.length - 1] : exitDir;
      if (cells.some((c) => !this.inMap(c) || this.taken[this.key(c)] || this.inBox(c, wingBox))) continue;
      for (const o of options) {
        const piece = orientPiece(finale, o);
        if (this.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[approachDir]) continue;
        const entryPort = this.step(last, approachDir);
        const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
        const box = this.boxOf(piece, origin);
        if (!this.boxFree(box) || this.overlaps(box, wingBox)) continue;
        if (cells.some((c) => this.inBox(c, box))) continue;
        const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
        const beyondExit = this.step(exitPort, this.outwardOf(piece, piece.exit));
        // Nothing open may sit right outside the exit; the map border is fine.
        if (this.inMap(beyondExit) && this.segment[this.key(beyondExit)] !== NO_SEGMENT) continue;
        if (claims.has(this.key(beyondExit)) || cells.some((c) => c.x === beyondExit.x && c.y === beyondExit.y)) {
          continue;
        }
        for (const c of cells) claims.set(this.key(c), beyondSegment);
        claims.set(this.key(entryPort), beyondSegment);
        return { piece, origin, path, approachDir };
      }
    }
    return null;
  }

  private roomCells(first: GridPoint, exitDir: Direction): GridPoint[] {
    const lateral: Direction = exitDir === 'N' || exitDir === 'S' ? 'E' : 'S';
    const half = Math.floor((this.cfg.rewardRoomWidth - 1) / 2);
    const cells: GridPoint[] = [first];
    for (let depth = 0; depth < this.cfg.rewardRoomDepth; depth++) {
      const row = this.stepN(first, exitDir, depth);
      for (let side = -half; side <= half; side++) {
        const cell =
          side >= 0
            ? this.stepN(row, lateral, side)
            : this.stepN(row, OPPOSITE_DIRECTION[lateral], -side);
        if (!cells.some((c) => c.x === cell.x && c.y === cell.y)) cells.push(cell);
      }
    }
    return cells;
  }

  /** Puts the wing's rewards and chips in its room; returns the cells to visit. */
  private fillRoom(wing: HubWing, placement: WingPlacement): GridPoint[] {
    if (wing.isFinal) return [];
    const loot = [...wing.rewards, ...new Array<string>(this.cfg.rewardChips).fill(CHIP_ITEM_ID)];
    const cells = [...placement.room.slice(1), placement.room[0]];
    const used: GridPoint[] = [];
    loot.forEach((item, i) => {
      const cell = cells[i % cells.length];
      if (this.items[cell.y][cell.x]) return;
      this.items[cell.y][cell.x] = item;
      if (item === CHIP_ITEM_ID) this.chipCount++;
      used.push(cell);
    });
    return used;
  }

  private wingRoute(placement: WingPlacement, rewardCells: GridPoint[], isFinal: boolean): RouteSegment[] {
    const { piece, origin, outward, approach, exitDir } = placement;
    const lastApproach = approach[approach.length - 1];
    const route: RouteSegment[] = [
      { kind: 'goto', target: lastApproach },
      { kind: 'walk', moves: [outward] },
      { kind: 'piece', piece, origin, isFinale: false }
    ];
    if (isFinal && placement.finale) {
      route.push({ kind: 'walk', moves: [exitDir, ...placement.finale.path, placement.finale.approachDir] });
      route.push({ kind: 'piece', piece: placement.finale.piece, origin: placement.finale.origin, isFinale: true });
      return route;
    }
    const doorstep = placement.room[0];
    route.push({ kind: 'walk', moves: [exitDir] });
    for (const target of rewardCells) route.push({ kind: 'goto', target });
    route.push({ kind: 'goto', target: doorstep });
    route.push({ kind: 'walk', moves: [OPPOSITE_DIRECTION[exitDir]] });
    route.push({ kind: 'piece', piece, origin, isFinale: false, towards: 'entry' });
    route.push({ kind: 'walk', moves: [OPPOSITE_DIRECTION[outward]] });
    return route;
  }

  private paintGate(wing: HubWing, cells: GridPoint[], outward: Direction): void {
    const config = wing.gate.config;
    if (!config) return;
    let terrain = config.terrain;
    if (config.orientTowardHub) {
      // The lock pushes the player back toward the hub.
      for (const quarterTurns of QUARTER_TURNS) {
        const turned = orientTileId(config.terrain, { quarterTurns, mirrored: false });
        if (turned && ConfigRegistry.getTile(turned).forceDirection === OPPOSITE_DIRECTION[outward]) {
          terrain = turned;
          break;
        }
      }
    }
    const painted = wing.gate.kind === 'door' ? cells.slice(0, 1) : cells;
    for (const cell of painted) this.terrain[cell.y][cell.x] = terrain;
  }

  private finaleExit(placement: WingPlacement): GridPoint {
    const finale = placement.finale as NonNullable<WingPlacement['finale']>;
    return { x: finale.origin.x + finale.piece.exit.x, y: finale.origin.y + finale.piece.exit.y };
  }

  /** Hub cells that are free for an item, away from the start and the gates. */
  private hubCells(start: GridPoint): GridPoint[] {
    const cells: GridPoint[] = [];
    for (let y = this.hub.y0; y <= this.hub.y1; y++) {
      for (let x = this.hub.x0; x <= this.hub.x1; x++) {
        if (x === start.x && y === start.y) continue;
        if (this.items[y][x]) continue;
        cells.push({ x, y });
      }
    }
    return cells;
  }

  private scatter(itemIds: string[], cells: GridPoint[]): GridPoint[] | null {
    const free = [...cells];
    this.rng.shuffle(free);
    if (free.length < itemIds.length) return null;
    return itemIds.map((id, i) => {
      const cell = free[i];
      this.items[cell.y][cell.x] = id;
      if (id === CHIP_ITEM_ID) this.chipCount++;
      return cell;
    });
  }

  private stamp(piece: CompiledPiece, origin: GridPoint): void {
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

  private open(p: GridPoint, seg: number, carve = true): void {
    const k = this.key(p);
    this.segment[k] = seg;
    this.taken[k] = 1;
    // Ports keep their piece terrain; other open cells become floor.
    if (carve || !this.inAnyBox(p)) this.terrain[p.y][p.x] = FLOOR_TILE_ID;
  }

  private take(p: GridPoint): void {
    if (this.inMap(p)) this.taken[this.key(p)] = 1;
  }

  private boxFree(box: Box): boolean {
    if (box.x0 < MAP_MARGIN || box.y0 < MAP_MARGIN) return false;
    if (box.x1 > this.width - 1 - MAP_MARGIN || box.y1 > this.height - 1 - MAP_MARGIN) return false;
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) if (this.taken[this.key({ x, y })]) return false;
    }
    return true;
  }

  private area(wing: HubWing): number {
    return wing.piece.width * wing.piece.height + (wing.isFinal ? 1 : 0);
  }

  private outwardOf(piece: CompiledPiece, port: GridPoint): Direction {
    if (port.y === 0) return 'N';
    if (port.y === piece.height - 1) return 'S';
    if (port.x === 0) return 'W';
    return 'E';
  }

  private boxOf(piece: CompiledPiece, origin: GridPoint): Box {
    return { x0: origin.x, y0: origin.y, x1: origin.x + piece.width - 1, y1: origin.y + piece.height - 1 };
  }

  private overlaps(a: Box, b: Box): boolean {
    return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
  }

  private inBox(p: GridPoint, b: Box): boolean {
    return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  }

  private inAnyBox(p: GridPoint): boolean {
    return this.boxes.some((b) => this.inBox(p, b));
  }

  private inMap(p: GridPoint): boolean {
    return (
      p.x >= MAP_MARGIN && p.y >= MAP_MARGIN && p.x < this.width - MAP_MARGIN && p.y < this.height - MAP_MARGIN
    );
  }

  private step(p: GridPoint, dir: Direction): GridPoint {
    return { x: p.x + DIRECTION_VECTORS[dir].dx, y: p.y + DIRECTION_VECTORS[dir].dy };
  }

  private stepN(p: GridPoint, dir: Direction, n: number): GridPoint {
    return { x: p.x + DIRECTION_VECTORS[dir].dx * n, y: p.y + DIRECTION_VECTORS[dir].dy * n };
  }

  private key(p: GridPoint): number {
    return p.y * this.width + p.x;
  }

  private point(k: number): GridPoint {
    return { x: k % this.width, y: Math.floor(k / this.width) };
  }
}
