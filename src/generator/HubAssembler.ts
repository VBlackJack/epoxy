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

import { ORDERED_DIRECTIONS } from '../config/constants';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import { SeededRandom } from '../core/Random';
import { Direction, GridPoint, HubConfig } from '../core/types';
import { HubGrid } from './HubGrid';
import { HubLoopAssembler } from './HubLoopAssembler';
import { HubOpenAssembler } from './HubOpenAssembler';
import { HubPlan, HubWing } from './HubPlanner';
import { AssembledHubLevel, CHIP_ITEM_ID, EXIT_TILE_ID, HUB_SEGMENT, LevelGuard, MAP_MARGIN, NO_SEGMENT, OpenArea, WingPlacement, WingTrial } from './HubTypes';
import { Box, RouteSegment } from './LevelAssembler';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece } from './PieceTypes';

export type { AssembledHubLevel, LevelGuard } from './HubTypes';

/** Open hub neighbours a free cell needs to join the hub region's fringe. */
const FRINGE_MIN_OPEN_NEIGHBOURS = 1;
/** Floor character of hub outlines in game.json. */
const HUB_FLOOR_CHAR = '.';

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
  private readonly grid: HubGrid;
  private readonly loop: HubLoopAssembler;
  private readonly openFill: HubOpenAssembler;
  private hub: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private finaleTurns: CompiledPiece[] | null = null;
  private loopLevel = false;

  private constructor(
    private readonly cfg: HubConfig,
    private readonly rng: SeededRandom
  ) {
    this.grid = new HubGrid(cfg);
    this.loop = new HubLoopAssembler(this.grid, cfg, rng);
    this.openFill = new HubOpenAssembler(this.grid, cfg, rng);
  }

  /** Returns the assembled level, or null when the wings do not fit around the hub. */
  public static assemble(
    plan: HubPlan,
    cfg: HubConfig,
    rng: SeededRandom,
    shapeIds?: string[]
  ): AssembledHubLevel | null {
    return new HubAssembler(cfg, rng).build(plan, shapeIds);
  }

  private build(plan: HubPlan, shapeIds?: string[]): AssembledHubLevel | null {
    // A different outline per attempt among those allowed, shifted off centre
    // so one side leaves room for long wings.
    const outlines = this.cfg.shapes.filter((s) => !shapeIds || shapeIds.includes(s.id));
    const shape = outlines[this.rng.nextInt(0, outlines.length - 1)];
    const shapeHeight = shape.rows.length;
    const shapeWidth = Math.max(...shape.rows.map((r) => r.length));
    const shiftX = this.rng.nextInt(-this.cfg.maxShift, this.cfg.maxShift);
    const shiftY = this.rng.nextInt(-this.cfg.maxShift, this.cfg.maxShift);
    const x0 = Math.max(MAP_MARGIN + 1, Math.min(this.grid.width - shapeWidth - MAP_MARGIN - 1, Math.floor((this.grid.width - shapeWidth) / 2) + shiftX));
    const y0 = Math.max(MAP_MARGIN + 1, Math.min(this.grid.height - shapeHeight - MAP_MARGIN - 1, Math.floor((this.grid.height - shapeHeight) / 2) + shiftY));
    this.hub = { x0, y0, x1: x0 + shapeWidth - 1, y1: y0 + shapeHeight - 1 };
    this.grid.hubFloor = new Set();
    shape.rows.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        if (ch === HUB_FLOOR_CHAR) this.grid.hubFloor.add(this.grid.key({ x: x0 + dx, y: y0 + dy }));
      })
    );
    // The hub and every cell around it are taken; only its floor is open.
    for (const k of this.grid.hubFloor) {
      const p = this.grid.point(k);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.grid.take({ x: p.x + dx, y: p.y + dy });
    }
    for (const k of this.grid.hubFloor) this.grid.open(this.grid.point(k), HUB_SEGMENT);
    this.grid.bounds = this.grid.cellsBox([...this.grid.hubFloor].map((k) => this.grid.point(k)));
    const centre = { x: (this.hub.x0 + this.hub.x1) / 2, y: (this.hub.y0 + this.hub.y1) / 2 };
    const start = [...this.grid.hubFloor]
      .map((k) => this.grid.point(k))
      .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];

    // Place the largest wings first; the visit order stays the plan's.
    const order = plan.wings
      .map((wing, index) => ({ wing, index }))
      .sort((a, b) => this.wingArea(b.wing) - this.wingArea(a.wing));
    const loopLevel = plan.wings.some((w) => w.loop);
    this.loopLevel = loopLevel;
    let placements: WingPlacement[] = new Array(plan.wings.length);
    if (loopLevel) {
      const placed = this.loop.placeWithBacktracking(order, plan.wings.length, (wing, index) =>
        this.wingTrials(wing, index, plan.finale, true)
      );
      if (!placed) return null;
      placements = placed;
    } else {
      for (const { wing, index } of order) {
        const placement = this.placeWing(wing, index, plan.finale, loopLevel);
        if (!placement) return null;
        placements[index] = placement;
      }
    }

    this.growBays();
    let hubTargets: GridPoint[];
    let open: OpenArea | undefined;
    if (loopLevel) {
      // A loop level's hub is an open area of its own: closed with gravel, cut into lanes, with monsters, chips and patches.
      const filled = this.openFill.fill(plan, start);
      if (!filled) return null;
      hubTargets = filled.targets;
      open = filled.open;
    } else {
      const hubItemCells = this.scatter(plan.hubItems, this.hubCells(start));
      if (!hubItemCells) return null;
      const hubChipCells = this.scatter(
        new Array<string>(this.cfg.hubChips).fill(CHIP_ITEM_ID),
        this.hubCells(start)
      );
      if (!hubChipCells) return null;
      hubTargets = [...hubItemCells, ...hubChipCells];
    }

    const route: RouteSegment[] = hubTargets.map((target) => ({ kind: 'goto', target }));
    const guards: LevelGuard[] = [];
    const wingRoutes: RouteSegment[][] = [];
    plan.wings.forEach((wing, index) => {
      const placement = placements[index];
      const rewardCells = this.fillRoom(wing, placement);
      wingRoutes[index] = this.wingRoute(placement, rewardCells, wing.isFinal);
      if (placement.loop) {
        guards.push(...this.loop.loopGuards(placement, placement.loop, rewardCells));
        return;
      }
      const box = this.grid.boxOf(placement.piece, placement.origin);
      guards.push({
        box,
        guarded: wing.isFinal ? this.finaleExit(placement) : placement.room[0]
      });
    });
    // The wings are visited in the order the plan proved, which is not always their index order.
    for (const index of plan.order) route.push(...wingRoutes[index]);

    return {
      terrain: this.grid.terrain,
      items: this.grid.items,
      entities: this.grid.entities,
      trapLinks: this.grid.trapLinks,
      cloneLinks: this.grid.cloneLinks,
      playerStart: start,
      route,
      chipCount: this.grid.chipCount,
      pieceBoxes: [...this.grid.boxes],
      guards,
      open,
      hubShape: shape.id
    };
  }

  /**
   * Tries the gate cells of the hub ring, in random order, for the wing, and
   * keeps the cheapest placement among the first few that fit, in bounding
   * box growth against walkable cells added: wings huddle around the hub and
   * fill gaps instead of sprawling.
   */
  private placeWing(wing: HubWing, index: number, finale: CompiledPiece, loopLevel: boolean): WingPlacement | null {
    const trials = this.wingTrials(wing, index, finale, loopLevel);
    return trials.length > 0 ? trials[0].commit() : null;
  }

  /** The placements that fit for a wing, cheapest first. */
  private wingTrials(wing: HubWing, index: number, finale: CompiledPiece, loopLevel: boolean): WingTrial[] {
    const candidates = this.grid.gateCandidates();
    this.rng.shuffle(candidates);
    const orientations = wing.piece.rotatable ? [...ALL_ORIENTATIONS] : [IDENTITY_ORIENTATION];
    this.rng.shuffle(orientations);
    // Turned once per wing, not once per gate tried.
    const turned = orientations.map((o) => orientPiece(wing.piece, o));
    const gateLength = wing.gate.kind === 'hazard' ? this.cfg.hazardDepth : 1;
    // A level with loop wings gives every wing room for the segments of a whole chain.
    const firstSegment = loopLevel ? 1 + index * (this.cfg.maxPiecesPerWing + 1) : 2 * index + 1;
    const approachSegment = firstSegment;
    const beyondSegment = firstSegment + 1;
    // The final wing of a loop level is laid out the same way, its chain being the finale.
    const finalLoose = loopLevel && wing.isFinal;
    const chainTurns = wing.loop
      ? wing.then.map((p) => this.loop.turnedShuffled(p))
      : finalLoose
        ? [this.turnedFinales(finale)]
        : [];

    const search = (asLoop: boolean): WingTrial[] => {
      const trials: WingTrial[] = [];
      search: for (const { gate, outward } of candidates) {
        if (asLoop) {
          const trial = this.loop.tryLoopWing(wing, turned, gate, outward, gateLength, firstSegment, chainTurns);
          if (!trial) continue;
          trials.push(trial);
          if (trials.length >= this.cfg.wingPlacementSamples) break search;
          continue;
        }
        for (let connectors = 0; connectors <= this.cfg.maxConnectorLength; connectors++) {
          for (const piece of turned) {
            if (this.grid.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[outward]) continue;
            const trial = this.tryWing(
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
            if (!trial) continue;
            trials.push(trial);
            if (trials.length >= this.cfg.wingPlacementSamples) break search;
          }
        }
      }
      // Cheapest first; among equals the first found, as the sort is stable.
      return trials.sort((a, b) => a.cost - b.cost);
    };

    let trials = search(wing.loop || finalLoose);
    // A single puzzle that can be walked back may still end in a dead-end room.
    if (trials.length === 0 && wing.loop && wing.then.length === 0 && PieceSolver.isReversible(wing.piece)) {
      trials = search(false);
    }
    return trials;
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
  ): WingTrial | null {
    const approach = Array.from({ length: gateLength + connectors }, (_, i) => this.grid.stepN(gate, outward, i));
    const entryPort = this.grid.stepN(gate, outward, gateLength + connectors);
    const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
    const box = this.grid.boxOf(piece, origin);
    if (!this.grid.boxFree(box)) return null;
    const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
    const exitDir = this.grid.outwardOf(piece, piece.exit);

    // A reward room grows straight out of the exit, or sideways along the
    // piece when a long piece leaves no depth; the finale finds its own way.
    const sideways: Direction[] = exitDir === 'N' || exitDir === 'S' ? ['E', 'W'] : ['N', 'S'];
    const growDirs: Direction[] = wing.isFinal ? [exitDir] : [exitDir, ...sideways];
    variants: for (const growDir of growDirs) {
      const claims = new Map<number, number>();
      const claim = (p: GridPoint, seg: number) => claims.set(this.grid.key(p), seg);
      approach.forEach((p) => claim(p, approachSegment));
      claim(entryPort, approachSegment);
      claim(exitPort, beyondSegment);

      let room: GridPoint[] = [];
      let finalePlacement: WingPlacement['finale'];
      const first = this.grid.step(exitPort, exitDir);
      if (wing.isFinal) {
        claim(first, beyondSegment);
        const placedFinale = this.fitFinale(finale, first, exitDir, box, claims, beyondSegment);
        if (!placedFinale) continue variants;
        finalePlacement = placedFinale;
      } else {
        room = this.roomCells(first, exitDir, growDir);
        room.forEach((p) => claim(p, beyondSegment));
      }

      // Every claimed cell must be free (the gate sits on the hub ring), stay out
      // of the pieces but for their ports, and touch only open cells of its own
      // segment, except the gate facing the hub.
      const finaleBox = finalePlacement ? this.grid.boxOf(finalePlacement.piece, finalePlacement.origin) : null;
      const ports = new Set([this.grid.key(entryPort), this.grid.key(exitPort)]);
      if (finalePlacement) {
        ports.add(this.grid.key({
          x: finalePlacement.origin.x + finalePlacement.piece.entry.x,
          y: finalePlacement.origin.y + finalePlacement.piece.entry.y
        }));
      }
      for (const [k, seg] of claims) {
        const p = this.grid.point(k);
        const isPort = ports.has(k);
        if (!this.grid.inMap(p)) continue variants;
        if (!isPort && (this.grid.inBox(p, box) || (finaleBox && this.grid.inBox(p, finaleBox)))) continue variants;
        const isGate = k === this.grid.key(gate);
        if (this.grid.taken[k] && !isGate) continue variants;
        if (isGate && this.grid.segment[k] !== NO_SEGMENT) continue variants;
        for (const dir of ORDERED_DIRECTIONS) {
          const n = this.grid.step(p, dir);
          const nk = this.grid.key(n);
          const neighbourSeg = claims.get(nk) ?? (this.grid.inMap(n) ? this.grid.segment[nk] : NO_SEGMENT);
          if (neighbourSeg === NO_SEGMENT || neighbourSeg === seg) continue;
          if (isGate && neighbourSeg === HUB_SEGMENT && dir === OPPOSITE_DIRECTION[outward]) continue;
          continue variants;
        }
      }
      if (finalePlacement && !this.grid.boxFree(this.grid.boxOf(finalePlacement.piece, finalePlacement.origin))) continue variants;

      const reach = this.grid.cellsBox([...claims.keys()].map((k) => this.grid.point(k)));
      let spread = this.grid.union(reach, box);
      if (finaleBox) spread = this.grid.union(spread, finaleBox);
      // A cell the wing adds is worth a cell of bounding box at the target fill: roomy
      // wings that fill gaps beat tight ones that leave them.
      const growth = this.grid.area(this.grid.union(this.grid.bounds, spread)) - this.grid.area(this.grid.bounds);
      const cost = growth * this.cfg.fillTarget - claims.size;
      const commit = (): WingPlacement => {
        this.grid.stamp(piece, origin);
        if (finalePlacement) this.grid.stamp(finalePlacement.piece, finalePlacement.origin);
        for (const [k, seg] of claims) this.grid.open(this.grid.point(k), seg, false);
        this.grid.paintGate(wing, approach.slice(0, gateLength), outward);
        if (finalePlacement) {
          const exitCell = {
            x: finalePlacement.origin.x + finalePlacement.piece.exit.x,
            y: finalePlacement.origin.y + finalePlacement.piece.exit.y
          };
          this.grid.terrain[exitCell.y][exitCell.x] = EXIT_TILE_ID;
        }
        this.grid.bounds = this.grid.union(this.grid.bounds, spread);
        return { piece, origin, outward, approach, gateLength, exitDir, room, finale: finalePlacement };
      };
      return { cost, commit };
    }
    return null;
  }

  private fitFinale(
    finale: CompiledPiece,
    connector: GridPoint,
    exitDir: Direction,
    wingBox: Box,
    claims: Map<number, number>,
    beyondSegment: number
  ): WingPlacement['finale'] | null {
    const options = this.turnedFinales(finale);
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
        last = this.grid.step(last, dir);
        cells.push(last);
      }
      const approachDir = path.length > 0 ? path[path.length - 1] : exitDir;
      if (cells.some((c) => !this.grid.inMap(c) || this.grid.taken[this.grid.key(c)] || this.grid.inBox(c, wingBox))) continue;
      for (const piece of options) {
        if (this.grid.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[approachDir]) continue;
        const entryPort = this.grid.step(last, approachDir);
        const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
        const box = this.grid.boxOf(piece, origin);
        if (!this.grid.boxFree(box) || this.grid.overlaps(box, wingBox)) continue;
        if (cells.some((c) => this.grid.inBox(c, box))) continue;
        const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
        const beyondExit = this.grid.step(exitPort, this.grid.outwardOf(piece, piece.exit));
        // Nothing open may sit right outside the exit; the map border is fine.
        if (this.grid.inMap(beyondExit) && this.grid.segment[this.grid.key(beyondExit)] !== NO_SEGMENT) continue;
        if (claims.has(this.grid.key(beyondExit)) || cells.some((c) => c.x === beyondExit.x && c.y === beyondExit.y)) {
          continue;
        }
        for (const c of cells) claims.set(this.grid.key(c), beyondSegment);
        claims.set(this.grid.key(entryPort), beyondSegment);
        return { piece, origin, path, approachDir };
      }
    }
    return null;
  }

  /**
   * Widens the hub into the gaps the wings leave around it, in 2x2 squares
   * inside the level's existing bounds: more open floor, no more bounding
   * box. A bay cell touches only hub floor and wall, so it opens no way
   * round a puzzle.
   */
  private growBays(): void {
    const anchors: GridPoint[] = [];
    // A loop level may widen out to the edge of the map; a hub stays within its bounds.
    const area = this.loopLevel
      ? { x0: MAP_MARGIN, y0: MAP_MARGIN, x1: this.grid.width - 1 - MAP_MARGIN, y1: this.grid.height - 1 - MAP_MARGIN }
      : this.grid.bounds;
    for (let y = area.y0; y < area.y1; y++) {
      for (let x = area.x0; x < area.x1; x++) {
        if (this.baySegment({ x, y }) !== null) anchors.push({ x, y });
      }
    }
    const wanted = this.loopLevel ? this.cfg.loopBayCells : this.cfg.bayCells;
    let added = 0;
    while (added < wanted && anchors.length > 0) {
      // Squares are checked again when drawn: an earlier bay may have taken the room.
      const at = this.rng.nextInt(0, anchors.length - 1);
      const anchor = anchors[at];
      anchors[at] = anchors[anchors.length - 1];
      anchors.pop();
      const seg = this.baySegment(anchor);
      if (seg === null) continue;
      for (const cell of this.squareCells(anchor)) {
        this.grid.open(cell, seg);
        if (seg === HUB_SEGMENT) this.grid.hubFloor.add(this.grid.key(cell));
        added++;
      }
      // A new bay makes the squares around it reachable from the same segment.
      for (let dy = -2; dy <= 1; dy++) {
        for (let dx = -2; dx <= 1; dx++) {
          const near = { x: anchor.x + dx, y: anchor.y + dy };
          if (this.baySegment(near) !== null) anchors.push(near);
        }
      }
    }
    if (this.loopLevel) this.growFringe(area);
  }

  /**
   * Grows the hub region's edge one cell at a time, a layer per round: free cells
   * touching open cells that all belong to the hub, in the gaps square bays do
   * not reach. A cell is checked again when drawn.
   */
  private growFringe(area: Box): void {
    let added = 0;
    while (added < this.cfg.loopFringeCells) {
      const nooks: Array<{ cell: GridPoint; seg: number }> = [];
      for (let y = area.y0; y <= area.y1; y++) {
        for (let x = area.x0; x <= area.x1; x++) {
          const seg = this.fringeSegment({ x, y });
          if (seg !== null) nooks.push({ cell: { x, y }, seg });
        }
      }
      if (nooks.length === 0) return;
      this.rng.shuffle(nooks);
      for (const { cell } of nooks) {
        // Earlier fills of this round may have changed what a cell touches.
        const seg = this.fringeSegment(cell);
        if (seg === null) continue;
        this.grid.open(cell, seg);
        if (seg === HUB_SEGMENT) this.grid.hubFloor.add(this.grid.key(cell));
        if (++added >= this.cfg.loopFringeCells) return;
      }
    }
  }

  /** The segment a free cell can join as fringe: at least one open neighbour, all of the hub's. */
  private fringeSegment(cell: GridPoint): number | null {
    const k = this.grid.key(cell);
    if (!this.grid.inMap(cell) || this.grid.segment[k] !== NO_SEGMENT || this.grid.inAnyBox(cell)) return null;
    let joined: number | null = null;
    let open = 0;
    for (const dir of ORDERED_DIRECTIONS) {
      const n = this.grid.step(cell, dir);
      if (!this.grid.inMap(n)) continue;
      const seg = this.grid.segment[this.grid.key(n)];
      if (seg === NO_SEGMENT) continue;
      if (joined !== null && joined !== seg) return null;
      joined = seg;
      open++;
    }
    return open >= FRINGE_MIN_OPEN_NEIGHBOURS && joined === HUB_SEGMENT ? joined : null;
  }

  private squareCells(anchor: GridPoint): GridPoint[] {
    return [
      anchor,
      { x: anchor.x + 1, y: anchor.y },
      { x: anchor.x, y: anchor.y + 1 },
      { x: anchor.x + 1, y: anchor.y + 1 }
    ];
  }

  /**
   * The segment a free 2x2 square in the bounds can join: the hub, when it touches
   * open cells of the hub only. A wing's corridors are never widened: floor out
   * there would lie bare, away from the hub region where the level's play is.
   * Null when the square is not free or would link two segments.
   */
  private baySegment(anchor: GridPoint): number | null {
    const cells = this.squareCells(anchor);
    const own = new Set(cells.map((c) => this.grid.key(c)));
    let joined: number | null = null;
    for (const cell of cells) {
      const k = this.grid.key(cell);
      if (!this.grid.inMap(cell) || this.grid.segment[k] !== NO_SEGMENT || this.grid.inAnyBox(cell)) return null;
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.grid.step(cell, dir);
        const nk = this.grid.key(n);
        if (own.has(nk) || !this.grid.inMap(n)) continue;
        const seg = this.grid.segment[nk];
        if (seg === NO_SEGMENT) continue;
        if (seg !== HUB_SEGMENT) return null;
        if (joined !== null && joined !== seg) return null;
        joined = seg;
      }
    }
    return joined;
  }

  /** Every orientation of the finale, turned once per assembly. */
  private turnedFinales(finale: CompiledPiece): CompiledPiece[] {
    if (!this.finaleTurns) {
      const orientations = finale.rotatable ? ALL_ORIENTATIONS : [IDENTITY_ORIENTATION];
      this.finaleTurns = orientations.map((o) => orientPiece(finale, o));
    }
    return this.finaleTurns;
  }

  /**
   * Cells of a reward room starting at `first`, the cell past the exit port.
   * Grown straight, the room is centred on the exit; grown sideways, it runs
   * along the piece, one row past it.
   */
  private roomCells(first: GridPoint, exitDir: Direction, growDir: Direction): GridPoint[] {
    const widths = this.cfg.rewardRoomWidths;
    const depths = this.cfg.rewardRoomDepths;
    const width = widths[this.rng.nextInt(0, widths.length - 1)];
    const depth = depths[this.rng.nextInt(0, depths.length - 1)];
    const cells: GridPoint[] = [first];
    const add = (cell: GridPoint) => {
      if (!cells.some((c) => c.x === cell.x && c.y === cell.y)) cells.push(cell);
    };
    const grid: GridPoint[][] = [];
    if (growDir === exitDir) {
      const lateral: Direction = exitDir === 'N' || exitDir === 'S' ? 'E' : 'S';
      const left = Math.floor((width - 1) / 2);
      for (let d = 0; d < depth; d++) {
        const row = this.grid.stepN(first, exitDir, d);
        grid.push(
          Array.from({ length: width }, (_, i) => {
            const side = i - left;
            return side >= 0 ? this.grid.stepN(row, lateral, side) : this.grid.stepN(row, OPPOSITE_DIRECTION[lateral], -side);
          })
        );
      }
    } else {
      for (let d = 0; d < depth; d++) {
        grid.push(Array.from({ length: width + 1 }, (_, along) => this.grid.stepN(this.grid.stepN(first, growDir, along), exitDir, d)));
      }
    }
    // A large enough room keeps a pillar in its middle, which changes its silhouette.
    const pillar =
      width >= this.cfg.rewardRoomPillarMinSize && depth >= this.cfg.rewardRoomPillarMinSize
        ? grid[Math.floor(depth / 2)][Math.floor(grid[0].length / 2)]
        : null;
    for (const row of grid) {
      for (const cell of row) {
        if (pillar && cell.x === pillar.x && cell.y === pillar.y) continue;
        add(cell);
      }
    }
    return cells;
  }

  /** Puts the wing's rewards and chips in its room; returns the cells to visit. */
  private fillRoom(wing: HubWing, placement: WingPlacement): GridPoint[] {
    if (wing.isFinal) return [];
    if (placement.loop) return this.loop.fillChain(wing, placement.loop);
    const loot = [...wing.rewards, ...new Array<string>(this.cfg.rewardChips).fill(CHIP_ITEM_ID)];
    const cells = [...placement.room.slice(1), placement.room[0]];
    const used: GridPoint[] = [];
    loot.forEach((item, i) => {
      const cell = cells[i % cells.length];
      if (this.grid.items[cell.y][cell.x]) return;
      this.grid.items[cell.y][cell.x] = item;
      if (item === CHIP_ITEM_ID) this.grid.chipCount++;
      used.push(cell);
    });
    return used;
  }

  private wingRoute(placement: WingPlacement, rewardCells: GridPoint[], isFinal: boolean): RouteSegment[] {
    if (placement.loop) return this.loop.loopRoute(placement, placement.loop, rewardCells);
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

  private finaleExit(placement: WingPlacement): GridPoint {
    const finale = placement.finale as NonNullable<WingPlacement['finale']>;
    return { x: finale.origin.x + finale.piece.exit.x, y: finale.origin.y + finale.piece.exit.y };
  }

  /** Hub cells that are free for an item, away from the start and the gates. */
  private hubCells(start: GridPoint): GridPoint[] {
    return [...this.grid.hubFloor]
      .map((k) => this.grid.point(k))
      .filter((p) => !(p.x === start.x && p.y === start.y) && !this.grid.items[p.y][p.x]);
  }

  private scatter(itemIds: string[], cells: GridPoint[]): GridPoint[] | null {
    const free = [...cells];
    this.rng.shuffle(free);
    if (free.length < itemIds.length) return null;
    return itemIds.map((id, i) => {
      const cell = free[i];
      this.grid.items[cell.y][cell.x] = id;
      if (id === CHIP_ITEM_ID) this.grid.chipCount++;
      return cell;
    });
  }

  private wingArea(wing: HubWing): number {
    const chained = wing.then.reduce((sum, p) => sum + p.width * p.height, 0);
    return wing.piece.width * wing.piece.height + chained + (wing.isFinal ? 1 : 0);
  }
}
