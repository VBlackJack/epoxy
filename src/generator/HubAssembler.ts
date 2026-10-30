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
import { CloneLink, Direction, EntityPlacement, GridPoint, HubConfig, HubGateConfig, TrapLink } from '../core/types';
import { HubPlan, HubWing } from './HubPlanner';
import { AssembledLevel, Box, RouteSegment } from './LevelAssembler';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece, orientTileId } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';
import { CompiledPiece } from './PieceTypes';

const WALL_TILE_ID = 'wall';
const EXIT_TILE_ID = 'exit';
const CHIP_ITEM_ID = 'chip';
const MAP_MARGIN = 1;
/** Floor character of hub outlines in game.json. */
const HUB_FLOOR_CHAR = '.';
/** Segment id of the hub floor; wings use two ids each, before and after their puzzle. */
const HUB_SEGMENT = 0;
const NO_SEGMENT = -1;
const QUARTER_TURNS = [0, 1, 2, 3] as const;
/** Placements gathered per chosen one, so the cheapest of a wider pool is kept. */
const PLACEMENT_POOL_FACTOR = 2;

/** Where a guard is checked: walling `box` must cut `guarded` off from the start. */
export interface LevelGuard {
  box: Box;
  guarded: GridPoint;
}

export interface AssembledHubLevel extends AssembledLevel {
  guards: LevelGuard[];
  /** Id of the hub outline used, from game.json. */
  hubShape: string;
}

/** The mutable parts of an assembly, kept to undo a wing placement. */
interface AssemblySnapshot {
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

/** A wing placement that fits but is not written yet: what it costs the level's density, and how to write it. */
interface WingTrial {
  /** Bounding box growth weighed by the fill target, minus the walkable cells added: lower is better. */
  cost: number;
  commit: () => WingPlacement;
}

/** A puzzle chained after another in a loop wing, and the corridor leading to it. */
interface ChainLink {
  piece: CompiledPiece;
  origin: GridPoint;
  /** Cells between the previous puzzle's exit and this one's entry port, the first one past the exit. */
  connector: GridPoint[];
  /** Direction of the last step, into the entry port. */
  approachDir: Direction;
  exitDir: Direction;
  /**
   * The previous puzzle pushes a block out and this one needs it: the connector is a
   * straight lane the block is pushed along, kept clear of items.
   */
  pushed: boolean;
}

/** What makes a wing a loop: more puzzles in a chain, and the one-way way back to the hub. */
interface LoopPlacement {
  links: ChainLink[];
  /** Cells from the one past the last puzzle's exit to the cell before the return strip. */
  tail: GridPoint[];
  /** The one-way strip, its cell in the hub's wall ring first. */
  strip: GridPoint[];
  /** Direction of a step along the strip toward the hub. */
  toHub: Direction;
}

/** A puzzle of a loop wing placed past a corridor. */
interface PlacementFit {
  piece: CompiledPiece;
  origin: GridPoint;
  box: Box;
  /** Corridor cells leading in, the first one next to where the previous stretch ended. */
  corridor: GridPoint[];
  /** Direction of the last step, into the entry port. */
  approachDir: Direction;
  entryPort: GridPoint;
  exitPort: GridPoint;
  exitDir: Direction;
  /** The corridor is a straight lane for a block pushed from the previous puzzle. */
  pushed: boolean;
  /** Lower is better. */
  cost: number;
}

/** What a loop wing has claimed so far while its puzzles are being placed. */
interface ChainState {
  claims: Map<number, number>;
  boxes: Box[];
  ports: Set<number>;
  extent: Box;
  fits: PlacementFit[];
  /** The cells of the gate, the one in the hub's wall ring first. */
  gateCells: GridPoint[];
  /** The last fixed cell and the direction the next corridor leaves it. */
  from: GridPoint;
  heading: Direction;
}

/** A place a loop wing can return to the hub: a strip leaving the ring, and the cell it starts from. */
interface ReturnAnchor {
  strip: GridPoint[];
  toHub: Direction;
  /** The cell of the wing's own approach the strip flows into, when it does not reach the hub. */
  joined: GridPoint | null;
}

/** The way back of a loop wing, from the cell past its last puzzle to where the strip ends. */
interface ReturnRoute extends ReturnAnchor {
  tail: GridPoint[];
}

/** A cell allowed to touch a cell of another segment, in one direction. */
interface SegmentLink {
  dir: Direction;
  seg: number;
  /** In the hub's wall ring, which the other cells around the hub keep taken. */
  ring: boolean;
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
  /** Set for a loop wing, which has no room. */
  loop?: LoopPlacement;
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
  private readonly takenSum: Int32Array;
  private takenSumDirty = true;
  private readonly entities: EntityPlacement[] = [];
  private readonly trapLinks: TrapLink[] = [];
  private readonly cloneLinks: CloneLink[] = [];
  private readonly boxes: Box[] = [];
  private hub: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Floor cells of the hub, by key. */
  private hubFloor = new Set<number>();
  private chipCount = 0;
  private finaleTurns: CompiledPiece[] | null = null;
  private loopLevel = false;
  private ringCache: Array<{ gate: GridPoint; outward: Direction }> | null = null;
  private endCache: Map<number, { gate: GridPoint; outward: Direction }> | null = null;
  /** Bounds of the hub floor and every wing placed so far: what compact placement keeps small. */
  private bounds: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };

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
    this.takenSum = new Int32Array((this.width + 1) * (this.height + 1));
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
    const x0 = Math.max(MAP_MARGIN + 1, Math.min(this.width - shapeWidth - MAP_MARGIN - 1, Math.floor((this.width - shapeWidth) / 2) + shiftX));
    const y0 = Math.max(MAP_MARGIN + 1, Math.min(this.height - shapeHeight - MAP_MARGIN - 1, Math.floor((this.height - shapeHeight) / 2) + shiftY));
    this.hub = { x0, y0, x1: x0 + shapeWidth - 1, y1: y0 + shapeHeight - 1 };
    this.hubFloor = new Set();
    shape.rows.forEach((row, dy) =>
      [...row].forEach((ch, dx) => {
        if (ch === HUB_FLOOR_CHAR) this.hubFloor.add(this.key({ x: x0 + dx, y: y0 + dy }));
      })
    );
    // The hub and every cell around it are taken; only its floor is open.
    for (const k of this.hubFloor) {
      const p = this.point(k);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.take({ x: p.x + dx, y: p.y + dy });
    }
    for (const k of this.hubFloor) this.open(this.point(k), HUB_SEGMENT);
    this.bounds = this.cellsBox([...this.hubFloor].map((k) => this.point(k)));
    const centre = { x: (this.hub.x0 + this.hub.x1) / 2, y: (this.hub.y0 + this.hub.y1) / 2 };
    const start = [...this.hubFloor]
      .map((k) => this.point(k))
      .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];

    // Place the largest wings first; the visit order stays the plan's.
    const order = plan.wings
      .map((wing, index) => ({ wing, index }))
      .sort((a, b) => this.wingArea(b.wing) - this.wingArea(a.wing));
    const loopLevel = plan.wings.some((w) => w.loop);
    this.loopLevel = loopLevel;
    let placements: WingPlacement[] = new Array(plan.wings.length);
    if (loopLevel) {
      const placed = this.placeWithBacktracking(order, plan.wings.length, plan.finale);
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
    const hubItemCells = this.scatter(plan.hubItems, this.hubCells(start));
    if (!hubItemCells) return null;
    const hubChipCells = this.scatter(
      new Array<string>(this.cfg.hubChips).fill(CHIP_ITEM_ID),
      this.hubCells(start)
    );
    if (!hubChipCells) return null;

    const route: RouteSegment[] = [...hubItemCells, ...hubChipCells].map((target) => ({ kind: 'goto', target }));
    const guards: LevelGuard[] = [];
    const wingRoutes: RouteSegment[][] = [];
    plan.wings.forEach((wing, index) => {
      const placement = placements[index];
      const rewardCells = this.fillRoom(wing, placement);
      wingRoutes[index] = this.wingRoute(placement, rewardCells, wing.isFinal);
      if (placement.loop) {
        guards.push(...this.loopGuards(placement, placement.loop, rewardCells));
        return;
      }
      const box = this.boxOf(placement.piece, placement.origin);
      guards.push({
        box,
        guarded: wing.isFinal ? this.finaleExit(placement) : placement.room[0]
      });
    });
    // The wings are visited in the order the plan proved, which is not always their index order.
    for (const index of plan.order) route.push(...wingRoutes[index]);

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
      guards,
      hubShape: shape.id
    };
  }

  /**
   * Cells of the hub's wall ring where a wing may leave: next to exactly one
   * hub floor cell, the wing heading straight away from it, with no hub floor
   * beside the gate (a concave corner would open two ways).
   */
  private gateCandidates(): Array<{ gate: GridPoint; outward: Direction }> {
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
    const candidates = this.gateCandidates();
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
      ? wing.then.map((p) => this.turnedShuffled(p))
      : finalLoose
        ? [this.turnedFinales(finale)]
        : [];

    const search = (asLoop: boolean): WingTrial[] => {
      const trials: WingTrial[] = [];
      search: for (const { gate, outward } of candidates) {
        if (asLoop) {
          const trial = this.tryLoopWing(wing, turned, gate, outward, gateLength, firstSegment, chainTurns);
          if (!trial) continue;
          trials.push(trial);
          if (trials.length >= this.cfg.wingPlacementSamples) break search;
          continue;
        }
        for (let connectors = 0; connectors <= this.cfg.maxConnectorLength; connectors++) {
          for (const piece of turned) {
            if (this.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[outward]) continue;
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

  /**
   * Places the wings of a level with loop wings, backtracking: when a wing finds
   * no room, the wings before it are placed differently, within a budget of
   * placement searches. Returns the placements by wing index, or null.
   */
  private placeWithBacktracking(
    order: Array<{ wing: HubWing; index: number }>,
    count: number,
    finale: CompiledPiece
  ): WingPlacement[] | null {
    const placements: WingPlacement[] = new Array(count);
    const budget = { searches: this.cfg.backtrackBudget };
    const place = (at: number): boolean => {
      if (at === order.length) return true;
      if (budget.searches-- <= 0) return false;
      const { wing, index } = order[at];
      const trials = this.wingTrials(wing, index, finale, true).slice(0, this.cfg.wingAlternatives);
      for (const trial of trials) {
        const saved = this.snapshot();
        placements[order[at].index] = trial.commit();
        if (place(at + 1)) return true;
        this.restore(saved);
      }
      return false;
    };
    return place(0) ? placements : null;
  }

  /** Everything a wing placement changes, so a placement can be taken back. */
  private snapshot(): AssemblySnapshot {
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

  private restore(saved: AssemblySnapshot): void {
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

  /** Every orientation of a puzzle the generator may turn, in random order. */
  private turnedShuffled(piece: CompiledPiece): CompiledPiece[] {
    const orientations = piece.rotatable ? [...ALL_ORIENTATIONS] : [IDENTITY_ORIENTATION];
    this.rng.shuffle(orientations);
    return orientations.map((o) => orientPiece(piece, o));
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
    const approach = Array.from({ length: gateLength + connectors }, (_, i) => this.stepN(gate, outward, i));
    const entryPort = this.stepN(gate, outward, gateLength + connectors);
    const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
    const box = this.boxOf(piece, origin);
    if (!this.boxFree(box)) return null;
    const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
    const exitDir = this.outwardOf(piece, piece.exit);

    // A reward room grows straight out of the exit, or sideways along the
    // piece when a long piece leaves no depth; the finale finds its own way.
    const sideways: Direction[] = exitDir === 'N' || exitDir === 'S' ? ['E', 'W'] : ['N', 'S'];
    const growDirs: Direction[] = wing.isFinal ? [exitDir] : [exitDir, ...sideways];
    variants: for (const growDir of growDirs) {
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
        if (!placedFinale) continue variants;
        finalePlacement = placedFinale;
      } else {
        room = this.roomCells(first, exitDir, growDir);
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
        if (!this.inMap(p)) continue variants;
        if (!isPort && (this.inBox(p, box) || (finaleBox && this.inBox(p, finaleBox)))) continue variants;
        const isGate = k === this.key(gate);
        if (this.taken[k] && !isGate) continue variants;
        if (isGate && this.segment[k] !== NO_SEGMENT) continue variants;
        for (const dir of ORDERED_DIRECTIONS) {
          const n = this.step(p, dir);
          const nk = this.key(n);
          const neighbourSeg = claims.get(nk) ?? (this.inMap(n) ? this.segment[nk] : NO_SEGMENT);
          if (neighbourSeg === NO_SEGMENT || neighbourSeg === seg) continue;
          if (isGate && neighbourSeg === HUB_SEGMENT && dir === OPPOSITE_DIRECTION[outward]) continue;
          continue variants;
        }
      }
      if (finalePlacement && !this.boxFree(this.boxOf(finalePlacement.piece, finalePlacement.origin))) continue variants;

      const reach = this.cellsBox([...claims.keys()].map((k) => this.point(k)));
      let spread = this.union(reach, box);
      if (finaleBox) spread = this.union(spread, finaleBox);
      // A cell the wing adds is worth a cell of bounding box at the target fill: roomy
      // wings that fill gaps beat tight ones that leave them.
      const growth = this.area(this.union(this.bounds, spread)) - this.area(this.bounds);
      const cost = growth * this.cfg.fillTarget - claims.size;
      const commit = (): WingPlacement => {
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
        this.bounds = this.union(this.bounds, spread);
        return { piece, origin, outward, approach, gateLength, exitDir, room, finale: finalePlacement };
      };
      return { cost, commit };
    }
    return null;
  }

  /**
   * Tries a loop wing behind one gate: the lead puzzle past a corridor from the
   * gate, then each chained puzzle past a corridor from the previous exit, then a
   * corridor back to a one-way strip in the hub's wall ring. Each stretch between
   * two puzzles is a segment of its own, so no puzzle can be walked around. Where
   * the way back cannot be routed, the last puzzles are placed differently.
   */
  private tryLoopWing(
    wing: HubWing,
    leadOptions: CompiledPiece[],
    gate: GridPoint,
    outward: Direction,
    gateLength: number,
    firstSegment: number,
    chainTurns: CompiledPiece[][]
  ): WingTrial | null {
    const gateCells = Array.from({ length: gateLength }, (_, i) => this.stepN(gate, outward, i));
    if (gateCells.some((c) => !this.inMap(c) || (this.taken[this.key(c)] && this.key(c) !== this.key(gate)))) return null;
    const claims = new Map<number, number>();
    gateCells.forEach((p) => claims.set(this.key(p), firstSegment));
    const start: ChainState = {
      claims,
      boxes: [],
      ports: new Set<number>(),
      extent: this.cellsBox(gateCells),
      fits: [],
      gateCells,
      from: gateCells[gateCells.length - 1],
      heading: outward
    };
    const loot = wing.rewards.length + this.cfg.rewardChips;
    const budget = { returns: this.cfg.returnAttempts };
    // A puzzle that needs the block the one before it pushes out is reached by a straight lane.
    const chain = [wing.piece, ...wing.then];
    const pushedAt = chain.map(
      (piece, i) => i > 0 && piece.imports?.kind === 'block' && chain[i - 1].exports?.kind === 'block'
    );
    const done = this.extendChain(wing, 0, start, gate, outward, firstSegment, leadOptions, chainTurns, loot, budget, pushedAt);
    if (!done) return null;
    const { state, back } = done;
    const finaleFit = wing.isFinal ? state.fits[state.fits.length - 1] : null;

    const reach = this.cellsBox([...state.claims.keys()].map((k) => this.point(k)));
    const spread = state.boxes.reduce((acc, b) => this.union(acc, b), reach);
    const growth = this.area(this.union(this.bounds, spread)) - this.area(this.bounds);
    const cost = growth * this.cfg.fillTarget - state.claims.size;
    const lead = state.fits[0];
    const approach = [...gateCells, ...lead.corridor];
    const links: ChainLink[] = state.fits.slice(1, finaleFit ? -1 : undefined).map((f) => ({
      piece: f.piece,
      origin: f.origin,
      connector: f.corridor,
      approachDir: f.approachDir,
      exitDir: f.exitDir,
      pushed: f.pushed
    }));
    const commit = (): WingPlacement => {
      for (const f of state.fits) this.stamp(f.piece, f.origin);
      for (const [k, seg] of state.claims) this.open(this.point(k), seg, false);
      this.paintGate(wing, approach.slice(0, gateLength), outward);
      this.bounds = this.union(this.bounds, spread);
      if (finaleFit) {
        const exitCell = {
          x: finaleFit.origin.x + finaleFit.piece.exit.x,
          y: finaleFit.origin.y + finaleFit.piece.exit.y
        };
        this.terrain[exitCell.y][exitCell.x] = EXIT_TILE_ID;
        // The finale hangs off the lead puzzle, as in a dead-end wing; a longer chain is not planned for it.
        const cells = [state.fits[state.fits.length - 2].exitPort, ...finaleFit.corridor];
        return {
          piece: lead.piece,
          origin: lead.origin,
          outward: lead.approachDir,
          approach,
          gateLength,
          exitDir: lead.exitDir,
          room: [],
          finale: {
            piece: finaleFit.piece,
            origin: finaleFit.origin,
            path: cells.slice(1).map((c, i) => this.directionBetween(cells[i], c)).slice(1),
            approachDir: finaleFit.approachDir
          }
        };
      }
      const strip = this.gateTerrain(this.cfg.returnGate, OPPOSITE_DIRECTION[(back as ReturnRoute).toHub]);
      for (const cell of (back as ReturnRoute).strip) this.terrain[cell.y][cell.x] = strip;
      return {
        piece: lead.piece,
        origin: lead.origin,
        outward: lead.approachDir,
        approach,
        gateLength,
        exitDir: lead.exitDir,
        room: [],
        loop: { links, tail: (back as ReturnRoute).tail, strip: (back as ReturnRoute).strip, toHub: (back as ReturnRoute).toHub }
      };
    };
    return { cost, commit };
  }

  /**
   * Places puzzle `index` of a loop wing and, recursively, the ones after it,
   * then routes the way back. The placements tried for a puzzle come cheapest
   * first; when nothing after one of them works out, the next is tried, within
   * the budget of way-back searches. Returns the completed chain, or null.
   */
  private extendChain(
    wing: HubWing,
    index: number,
    state: ChainState,
    gate: GridPoint,
    outward: Direction,
    firstSegment: number,
    leadOptions: CompiledPiece[],
    chainTurns: CompiledPiece[][],
    loot: number,
    budget: { returns: number },
    pushedAt: boolean[]
  ): { state: ChainState; back: ReturnRoute | null } | null {
    const last = index === chainTurns.length;
    const seg = firstSegment + index;
    const fits = this.findPlacements(
      state.from,
      state.heading,
      seg,
      index === 0 ? leadOptions : chainTurns[index - 1],
      state,
      index === 0,
      last,
      wing.isFinal,
      pushedAt[index] ?? false
    );
    for (const fit of fits) {
      if (budget.returns <= 0) return null;
      const claims = new Map(state.claims);
      fit.corridor.forEach((p) => claims.set(this.key(p), seg));
      claims.set(this.key(fit.entryPort), seg);
      claims.set(this.key(fit.exitPort), seg + 1);
      const next: ChainState = {
        claims,
        boxes: [...state.boxes, fit.box],
        ports: new Set([...state.ports, this.key(fit.entryPort), this.key(fit.exitPort)]),
        extent: this.union(this.union(state.extent, fit.box), this.cellsBox([...fit.corridor, fit.entryPort])),
        fits: [...state.fits, fit],
        gateCells: state.gateCells,
        from: fit.exitPort,
        heading: fit.exitDir
      };
      if (!last) {
        const done = this.extendChain(
          wing,
          index + 1,
          next,
          gate,
          outward,
          firstSegment,
          leadOptions,
          chainTurns,
          loot,
          budget,
          pushedAt
        );
        if (done) return done;
        continue;
      }
      if (wing.isFinal) {
        const links = new Map<number, SegmentLink>([
          [this.key(gate), { dir: OPPOSITE_DIRECTION[outward], seg: HUB_SEGMENT, ring: true }]
        ]);
        if (this.chainIsClean(next, links)) return { state: next, back: null };
        continue;
      }
      budget.returns--;
      const corridorCells = next.fits.slice(1).reduce((sum, f) => sum + f.corridor.length, 0);
      const back = this.routeReturn(
        this.step(fit.exitPort, fit.exitDir),
        seg + 1,
        next.claims,
        next.boxes,
        Math.max(1, loot - corridorCells),
        next.extent,
        // The approach of the wing, past the ring: where the strip may flow in instead of the hub.
        [...state.gateCells.slice(1), ...next.fits[0].corridor]
      );
      if (!back) continue;
      back.tail.forEach((p) => next.claims.set(this.key(p), seg + 1));
      back.strip.forEach((p) => next.claims.set(this.key(p), seg + 1));
      const links = new Map<number, SegmentLink>([
        [this.key(gate), { dir: OPPOSITE_DIRECTION[outward], seg: HUB_SEGMENT, ring: true }]
      ]);
      if (back.joined) {
        links.set(this.key(back.strip[0]), { dir: back.toHub, seg: firstSegment, ring: false });
        links.set(this.key(back.joined), { dir: OPPOSITE_DIRECTION[back.toHub], seg: seg + 1, ring: false });
      } else {
        links.set(this.key(back.strip[0]), { dir: back.toHub, seg: HUB_SEGMENT, ring: true });
      }
      if (this.chainIsClean(next, links)) return { state: next, back };
    }
    return null;
  }

  /**
   * Whether a whole wing, as claimed, keeps to the segments: in the map, outside
   * the puzzles but for their ports, on free ground, and touching no cell of
   * another segment. `links` lists the cells that may touch another segment, and where.
   */
  private chainIsClean(state: ChainState, links: Map<number, SegmentLink>): boolean {
    for (const [k, seg] of state.claims) {
      const p = this.point(k);
      if (!this.inMap(p)) return false;
      if (!state.ports.has(k) && state.boxes.some((b) => this.inBox(p, b))) return false;
      const link = links.get(k);
      if (this.taken[k] && !link?.ring) return false;
      if (link?.ring && this.segment[k] !== NO_SEGMENT) return false;
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(p, dir);
        const nk = this.key(n);
        const neighbourSeg = state.claims.get(nk) ?? (this.inMap(n) ? this.segment[nk] : NO_SEGMENT);
        if (neighbourSeg === NO_SEGMENT || neighbourSeg === seg) continue;
        if (link?.dir === dir && neighbourSeg === link.seg) continue;
        return false;
      }
    }
    return true;
  }

  /**
   * Finds where the next puzzle of a loop wing can go: a corridor of up to
   * `maxLinkLength` cells leaves `from` toward `heading` and ends at the entry
   * port of one of the `options`. The placements nearest to `from` are weighed
   * by how much they grow the level's extent and how closely they hug what is
   * already there; they come back cheapest first. With `direct`, the entry port
   * may follow `from` at once. The last puzzle is also weighed by its distance
   * to the hub, since the way back starts there. With `straight`, the corridor
   * runs straight on from `from` and enters the piece head-on: a block pushed
   * out of the previous puzzle can be pushed along it into the next.
   */
  private findPlacements(
    from: GridPoint,
    heading: Direction,
    seg: number,
    options: CompiledPiece[],
    state: ChainState,
    direct: boolean,
    last: boolean,
    terminal: boolean,
    straight = false
  ): PlacementFit[] {
    const { boxes, claims, extent } = state;
    const start = this.step(from, heading);
    // Corridors in order of length: the cells reached, each with the way to it.
    const parents = new Map<number, number>();
    const order: GridPoint[] = [];
    if (this.corridorFits(start, seg, boxes, claims)) {
      parents.set(this.key(start), -1);
      order.push(start);
      const directions = straight ? [heading] : [...ORDERED_DIRECTIONS];
      this.rng.shuffle(directions);
      const depth = new Map<number, number>([[this.key(start), 1]]);
      for (let i = 0; i < order.length; i++) {
        const cell = order[i];
        const cells = depth.get(this.key(cell)) as number;
        if (cells >= this.cfg.maxLinkLength) continue;
        for (const dir of directions) {
          const n = this.step(cell, dir);
          const nk = this.key(n);
          if (parents.has(nk) || !this.corridorFits(n, seg, boxes, claims)) continue;
          parents.set(nk, this.key(cell));
          depth.set(nk, cells + 1);
          order.push(n);
        }
      }
    }
    const pathTo = (cell: GridPoint | null): GridPoint[] => {
      const path: GridPoint[] = [];
      for (let k: number | undefined = cell ? this.key(cell) : -1; k !== undefined && k !== -1; k = parents.get(k)) {
        path.unshift(this.point(k));
      }
      return path;
    };
    const touches = (cell: GridPoint, cells: GridPoint[]): boolean =>
      cells.some((c) => Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) <= 1);
    const ringEnds = last && !terminal ? this.freeReturnEnds() : [];
    const claimed = [...claims.keys()].map((k) => this.point(k));

    const base = this.union(this.bounds, extent);
    const fits: PlacementFit[] = [];
    // The pseudo cell `from` stands for an empty corridor.
    const ends: Array<GridPoint | null> = direct ? [null, ...order] : order;
    for (const end of ends) {
      const path = pathTo(end);
      const tip = end ?? from;
      const dirs = end && !straight ? ORDERED_DIRECTIONS : [heading];
      for (const approachDir of dirs) {
        const entryPort = this.step(tip, approachDir);
        if (claims.has(this.key(entryPort)) || path.some((c) => c.x === entryPort.x && c.y === entryPort.y)) continue;
        for (const piece of options) {
          if (this.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[approachDir]) continue;
          const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
          const box = this.boxOf(piece, origin);
          if (!this.boxFree(box) || boxes.some((b) => this.overlaps(box, b))) continue;
          if (path.some((c) => this.inBox(c, box))) continue;
          if (claimed.some((c) => (c.x !== entryPort.x || c.y !== entryPort.y) && this.inBox(c, box))) continue;
          const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
          const exitDir = this.outwardOf(piece, piece.exit);
          const beyond = this.step(exitPort, exitDir);
          // Neither the exit nor the cell outside it may touch the corridor leading in.
          const leading = [...path, entryPort];
          if (touches(exitPort, path) || touches(beyond, leading)) continue;
          if (last && terminal) {
            // The exit of the finale: nothing open may sit right outside it; the map border is fine.
            const bk = this.key(beyond);
            if (this.inMap(beyond) && (this.segment[bk] !== NO_SEGMENT || claims.has(bk) || touches(beyond, leading))) continue;
          } else if (!this.corridorFits(beyond, seg + 1, [...boxes, box], claims)) continue;
          const spread = this.union(this.union(base, box), this.cellsBox(leading));
          const hugged = this.contact(box, boxes);
          const toHub = last && !terminal ? Math.min(...ringEnds.map((r) => Math.abs(r.x - beyond.x) + Math.abs(r.y - beyond.y))) : 0;
          const cost =
            (this.area(spread) - this.area(base)) * this.cfg.fillTarget +
            path.length -
            hugged * this.cfg.contactWeight +
            toHub * this.cfg.returnDistanceWeight;
          fits.push({ piece, origin, box, corridor: path, approachDir, entryPort, exitPort, exitDir, pushed: straight, cost });
          if (fits.length >= this.cfg.chainPlacementSamples * PLACEMENT_POOL_FACTOR) {
            return this.cheapest(fits);
          }
        }
      }
    }
    return this.cheapest(fits);
  }

  private directionBetween(from: GridPoint, to: GridPoint): Direction {
    return ORDERED_DIRECTIONS.find((d) => from.x + DIRECTION_VECTORS[d].dx === to.x && from.y + DIRECTION_VECTORS[d].dy === to.y) as Direction;
  }

  private cheapest(fits: PlacementFit[]): PlacementFit[] {
    return fits.sort((a, b) => a.cost - b.cost).slice(0, this.cfg.chainPlacementSamples);
  }

  /** Cells just outside the box that are already occupied or off the map: what a placement leans against. */
  private contact(box: Box, boxes: Box[]): number {
    let count = 0;
    const lean = (p: GridPoint): void => {
      if (!this.inMap(p) || this.taken[this.key(p)] || boxes.some((b) => this.inBox(p, b))) count++;
    };
    for (let x = box.x0; x <= box.x1; x++) {
      lean({ x, y: box.y0 - 1 });
      lean({ x, y: box.y1 + 1 });
    }
    for (let y = box.y0; y <= box.y1; y++) {
      lean({ x: box.x0 - 1, y });
      lean({ x: box.x1 + 1, y });
    }
    return count;
  }

  /** Cells right outside the strips still free in the hub's wall ring. */
  private freeReturnEnds(): GridPoint[] {
    const free = [...this.returnEnds()]
      .filter(([, ring]) => this.segment[this.key(ring.gate)] === NO_SEGMENT)
      .map(([k]) => this.point(k));
    return free.length > 0 ? free : [{ x: 0, y: 0 }];
  }

  /** The ring cells a way back may end at, keyed by the cell right outside the strip leaving each. */
  private returnEnds(): Map<number, { gate: GridPoint; outward: Direction }> {
    if (!this.endCache) {
      this.ringCache ??= this.gateCandidates();
      this.endCache = new Map(
        this.ringCache.map((ring) => [this.key(this.stepN(ring.gate, ring.outward, this.cfg.returnDepth)), ring])
      );
    }
    return this.endCache;
  }

  /** Whether a corridor cell of segment `seg` can be opened here: free ground that touches nothing of another segment. */
  private corridorFits(p: GridPoint, seg: number, boxes: Box[], claims: Map<number, number>, touching = -1): boolean {
    const k = this.key(p);
    if (!this.inMap(p) || this.taken[k] || claims.has(k) || boxes.some((b) => this.inBox(p, b))) return false;
    for (const dir of ORDERED_DIRECTIONS) {
      const n = this.step(p, dir);
      const nk = this.key(n);
      if (nk === touching) continue;
      const neighbourSeg = claims.get(nk) ?? (this.inMap(n) ? this.segment[nk] : NO_SEGMENT);
      if (neighbourSeg !== NO_SEGMENT && neighbourSeg !== seg) return false;
    }
    return true;
  }

  /**
   * Finds the corridor from `first`, the cell past the last puzzle's exit, to a
   * one-way strip in the hub's wall ring. Among the nearest strips that leave at
   * least `minCells` corridor cells for rewards, the one growing the extent least wins.
   */
  private routeReturn(
    first: GridPoint,
    seg: number,
    claims: Map<number, number>,
    boxes: Box[],
    minCells: number,
    extent: Box,
    joins: GridPoint[]
  ): ReturnRoute | null {
    if (!this.corridorFits(first, seg, boxes, claims)) return null;
    // A way back ends on the cell right outside a strip; the strips are checked when reached.
    // A strip leaves the hub's wall ring, or a cell of the wing's own approach.
    const depth = this.cfg.returnDepth;
    const ends = this.returnEnds();
    const joinEnds = new Map<number, { from: GridPoint; outward: Direction }>();
    for (const from of joins) {
      for (const outward of ORDERED_DIRECTIONS) {
        joinEnds.set(this.key(this.stepN(from, outward, depth + 1)), { from, outward });
      }
    }
    const anchors = new Map<number, ReturnAnchor | null>();
    const anchorAt = (cell: number): ReturnAnchor | null => {
      if (anchors.has(cell)) return anchors.get(cell) as ReturnAnchor | null;
      let anchor: ReturnAnchor | null = null;
      const ring = ends.get(cell);
      if (ring && this.segment[this.key(ring.gate)] === NO_SEGMENT && !claims.has(this.key(ring.gate))) {
        const strip = Array.from({ length: depth }, (_, j) => this.stepN(ring.gate, ring.outward, j));
        if (strip.slice(1).every((c) => this.corridorFits(c, seg, boxes, claims))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[ring.outward], joined: null };
        }
      }
      const join = joinEnds.get(cell);
      if (!anchor && join) {
        const strip = Array.from({ length: depth }, (_, j) => this.stepN(join.from, join.outward, j + 1));
        const touching = this.key(join.from);
        if (strip.every((c, j) => this.corridorFits(c, seg, boxes, claims, j === 0 ? touching : -1))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[join.outward], joined: join.from };
        }
      }
      anchors.set(cell, anchor);
      return anchor;
    };

    const directions = [...ORDERED_DIRECTIONS];
    this.rng.shuffle(directions);
    const length = new Map<number, number>([[this.key(first), 1]]);
    const parent = new Map<number, number>();
    const queue: GridPoint[] = [first];
    const reached: number[] = [];
    for (let i = 0; i < queue.length && reached.length < this.cfg.chainPlacementSamples; i++) {
      const cell = queue[i];
      const ck = this.key(cell);
      const cells = length.get(ck) as number;
      if (cells >= minCells && (ends.has(ck) || joinEnds.has(ck)) && anchorAt(ck)) reached.push(ck);
      if (cells >= this.cfg.maxReturnLength) continue;
      for (const dir of directions) {
        const n = this.step(cell, dir);
        const nk = this.key(n);
        if (length.has(nk) || !this.corridorFits(n, seg, boxes, claims)) continue;
        length.set(nk, cells + 1);
        parent.set(nk, ck);
        queue.push(n);
      }
    }

    let best: ReturnRoute | null = null;
    let bestGrowth = Number.POSITIVE_INFINITY;
    for (const endKey of reached) {
      const anchor = anchorAt(endKey) as ReturnAnchor;
      const tail: GridPoint[] = [];
      for (let k: number | undefined = endKey; k !== undefined; k = parent.get(k)) tail.unshift(this.point(k));
      const stripKeys = new Set(anchor.strip.map((c) => this.key(c)));
      if (tail.some((c) => stripKeys.has(this.key(c)))) continue;
      const growth = this.area(this.union(extent, this.cellsBox([...tail, ...anchor.strip]))) - this.area(extent);
      if (growth < bestGrowth) {
        bestGrowth = growth;
        best = { tail, ...anchor };
      }
    }
    return best;
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
        last = this.step(last, dir);
        cells.push(last);
      }
      const approachDir = path.length > 0 ? path[path.length - 1] : exitDir;
      if (cells.some((c) => !this.inMap(c) || this.taken[this.key(c)] || this.inBox(c, wingBox))) continue;
      for (const piece of options) {
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
      ? { x0: MAP_MARGIN, y0: MAP_MARGIN, x1: this.width - 1 - MAP_MARGIN, y1: this.height - 1 - MAP_MARGIN }
      : this.bounds;
    for (let y = area.y0; y < area.y1; y++) {
      for (let x = area.x0; x < area.x1; x++) {
        if (this.baySegment({ x, y }) !== null) anchors.push({ x, y });
      }
    }
    // Loop levels widen corridors and rooms as well as the hub: any single segment may grow.
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
        this.open(cell, seg);
        if (seg === HUB_SEGMENT) this.hubFloor.add(this.key(cell));
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
    if (this.loopLevel) this.fillNooks(area);
  }

  /**
   * Fills the nooks left between a loop level's open floor and its walls: free
   * cells touching two or more open cells that all belong to one segment, which
   * square bays do not reach. A cell is checked again when drawn.
   */
  private fillNooks(area: Box): void {
    let added = 0;
    while (added < this.cfg.loopNookCells) {
      const nooks: Array<{ cell: GridPoint; seg: number }> = [];
      for (let y = area.y0; y <= area.y1; y++) {
        for (let x = area.x0; x <= area.x1; x++) {
          const seg = this.nookSegment({ x, y });
          if (seg !== null) nooks.push({ cell: { x, y }, seg });
        }
      }
      if (nooks.length === 0) return;
      this.rng.shuffle(nooks);
      for (const { cell } of nooks) {
        // Earlier fills of this round may have changed what a cell touches.
        const seg = this.nookSegment(cell);
        if (seg === null) continue;
        this.open(cell, seg);
        if (seg === HUB_SEGMENT) this.hubFloor.add(this.key(cell));
        if (++added >= this.cfg.loopNookCells) return;
      }
    }
  }

  /** The segment a free cell can join as a nook: two or more open neighbours, all of one segment. */
  private nookSegment(cell: GridPoint): number | null {
    const k = this.key(cell);
    if (!this.inMap(cell) || this.segment[k] !== NO_SEGMENT || this.inAnyBox(cell)) return null;
    let joined: number | null = null;
    let open = 0;
    for (const dir of ORDERED_DIRECTIONS) {
      const n = this.step(cell, dir);
      if (!this.inMap(n)) continue;
      const seg = this.segment[this.key(n)];
      if (seg === NO_SEGMENT) continue;
      if (joined !== null && joined !== seg) return null;
      joined = seg;
      open++;
    }
    return open >= 2 ? joined : null;
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
   * The segment a free 2x2 square in the bounds can join: the hub, or in a loop
   * level any single segment, when it touches open cells of that segment only.
   * Null when the square is not free or would link two segments.
   */
  private baySegment(anchor: GridPoint): number | null {
    const cells = this.squareCells(anchor);
    const own = new Set(cells.map((c) => this.key(c)));
    let joined: number | null = null;
    for (const cell of cells) {
      const k = this.key(cell);
      if (!this.inMap(cell) || this.segment[k] !== NO_SEGMENT || this.inAnyBox(cell)) return null;
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(cell, dir);
        const nk = this.key(n);
        if (own.has(nk) || !this.inMap(n)) continue;
        const seg = this.segment[nk];
        if (seg === NO_SEGMENT) continue;
        if (!this.loopLevel && seg !== HUB_SEGMENT) return null;
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
        const row = this.stepN(first, exitDir, d);
        grid.push(
          Array.from({ length: width }, (_, i) => {
            const side = i - left;
            return side >= 0 ? this.stepN(row, lateral, side) : this.stepN(row, OPPOSITE_DIRECTION[lateral], -side);
          })
        );
      }
    } else {
      for (let d = 0; d < depth; d++) {
        grid.push(Array.from({ length: width + 1 }, (_, along) => this.stepN(this.stepN(first, growDir, along), exitDir, d)));
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
    if (placement.loop) return this.fillChain(wing, placement.loop);
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

  /**
   * Scatters the wing's rewards and chips over the corridors of its chain, but
   * never on a lane a block is pushed along; returns their cells in walking order.
   */
  private fillChain(wing: HubWing, loop: LoopPlacement): GridPoint[] {
    const loot = [...wing.rewards, ...new Array<string>(this.cfg.rewardChips).fill(CHIP_ITEM_ID)];
    const corridor = [...loop.links.filter((l) => !l.pushed).flatMap((l) => l.connector), ...loop.tail];
    const picks = corridor.map((_, i) => i);
    this.rng.shuffle(picks);
    this.rng.shuffle(loot);
    const chosen = picks.slice(0, loot.length).sort((a, b) => a - b);
    return chosen.map((at, i) => {
      const cell = corridor[at];
      this.items[cell.y][cell.x] = loot[i];
      if (loot[i] === CHIP_ITEM_ID) this.chipCount++;
      return cell;
    });
  }

  /**
   * Walks a loop wing: each puzzle, the rewards lying in the corridor after it,
   * and out through the one-way strip. One step into the strip is enough, the
   * floor carries the player into the hub. A block pushed out of a puzzle is
   * pushed along the lane onto the next puzzle's entry port, where that
   * puzzle's own solution takes it over.
   */
  private loopRoute(placement: WingPlacement, loop: LoopPlacement, rewardCells: GridPoint[]): RouteSegment[] {
    const { piece, origin, outward, approach } = placement;
    const route: RouteSegment[] = [
      { kind: 'goto', target: approach[approach.length - 1] },
      { kind: 'walk', moves: [outward] },
      { kind: 'piece', piece, origin, isFinale: false }
    ];
    const lootAt = new Set(rewardCells.map((c) => this.key(c)));
    const collect = (cells: GridPoint[]) => {
      for (const cell of cells) if (lootAt.has(this.key(cell))) route.push({ kind: 'goto', target: cell });
    };
    let exitDir = placement.exitDir;
    for (const link of loop.links) {
      if (link.pushed) {
        const entryPort = { x: link.origin.x + link.piece.entry.x, y: link.origin.y + link.piece.entry.y };
        route.push({ kind: 'push', moves: new Array<Direction>(link.connector.length).fill(exitDir), block: entryPort });
      } else {
        route.push({ kind: 'walk', moves: [exitDir] });
        collect(link.connector);
        route.push({ kind: 'goto', target: link.connector[link.connector.length - 1] });
        route.push({ kind: 'walk', moves: [link.approachDir] });
      }
      route.push({ kind: 'piece', piece: link.piece, origin: link.origin, isFinale: false });
      exitDir = link.exitDir;
    }
    route.push({ kind: 'walk', moves: [exitDir] });
    collect(loop.tail);
    route.push({ kind: 'goto', target: loop.tail[loop.tail.length - 1] });
    route.push({ kind: 'walk', moves: [loop.toHub] });
    return route;
  }

  /**
   * Guards of a loop wing: walling any of its puzzles must cut off the corridor
   * after it, the rewards beyond it and the end of the return corridor, which
   * the one-way strip must not let the player reach from the hub.
   */
  private loopGuards(placement: WingPlacement, loop: LoopPlacement, rewardCells: GridPoint[]): LevelGuard[] {
    const pieces = [
      { piece: placement.piece, origin: placement.origin },
      ...loop.links.map((l) => ({ piece: l.piece, origin: l.origin }))
    ];
    // The last puzzle that must be crossed to reach a cell of the chain.
    const crossed = new Map<number, number>();
    loop.links.forEach((l, j) => l.connector.forEach((c) => crossed.set(this.key(c), j)));
    loop.tail.forEach((c) => crossed.set(this.key(c), loop.links.length));
    const end = loop.tail[loop.tail.length - 1];
    const guards: LevelGuard[] = [];
    pieces.forEach(({ piece, origin }, i) => {
      const box = this.boxOf(piece, origin);
      const after = i < loop.links.length ? loop.links[i].connector[0] : loop.tail[0];
      const guarded = [after, end, ...rewardCells.filter((c) => (crossed.get(this.key(c)) ?? 0) >= i)];
      const seen = new Set<number>();
      for (const cell of guarded) {
        if (seen.has(this.key(cell))) continue;
        seen.add(this.key(cell));
        guards.push({ box, guarded: cell });
      }
    });
    return guards;
  }

  private wingRoute(placement: WingPlacement, rewardCells: GridPoint[], isFinal: boolean): RouteSegment[] {
    if (placement.loop) return this.loopRoute(placement, placement.loop, rewardCells);
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

  /** The terrain of a lock on a wing leaving the hub toward `outward`: turned to push back when it is a force floor. */
  private gateTerrain(config: HubGateConfig, outward: Direction): string {
    if (!config.orientTowardHub) return config.terrain;
    // The lock pushes the player back toward the hub.
    for (const quarterTurns of QUARTER_TURNS) {
      const turned = orientTileId(config.terrain, { quarterTurns, mirrored: false });
      if (turned && ConfigRegistry.getTile(turned).forceDirection === OPPOSITE_DIRECTION[outward]) return turned;
    }
    return config.terrain;
  }

  private paintGate(wing: HubWing, cells: GridPoint[], outward: Direction): void {
    const config = wing.gate.config;
    if (!config) return;
    const terrain = this.gateTerrain(config, outward);
    const painted = wing.gate.kind === 'door' ? cells.slice(0, 1) : cells;
    for (const cell of painted) this.terrain[cell.y][cell.x] = terrain;
  }

  private finaleExit(placement: WingPlacement): GridPoint {
    const finale = placement.finale as NonNullable<WingPlacement['finale']>;
    return { x: finale.origin.x + finale.piece.exit.x, y: finale.origin.y + finale.piece.exit.y };
  }

  /** Hub cells that are free for an item, away from the start and the gates. */
  private hubCells(start: GridPoint): GridPoint[] {
    return [...this.hubFloor]
      .map((k) => this.point(k))
      .filter((p) => !(p.x === start.x && p.y === start.y) && !this.items[p.y][p.x]);
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
    this.takenSumDirty = true;
    // Ports keep their piece terrain; other open cells become floor.
    if (carve || !this.inAnyBox(p)) this.terrain[p.y][p.x] = FLOOR_TILE_ID;
  }

  private take(p: GridPoint): void {
    if (this.inMap(p)) {
      this.taken[this.key(p)] = 1;
      this.takenSumDirty = true;
    }
  }

  private boxFree(box: Box): boolean {
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
  private rebuildTakenSum(): void {
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

  private wingArea(wing: HubWing): number {
    const chained = wing.then.reduce((sum, p) => sum + p.width * p.height, 0);
    return wing.piece.width * wing.piece.height + chained + (wing.isFinal ? 1 : 0);
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

  private area(b: Box): number {
    return (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  }

  private cellBox(p: GridPoint): Box {
    return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  private cellsBox(cells: GridPoint[]): Box {
    return cells.map((c) => this.cellBox(c)).reduce((a, b) => this.union(a, b));
  }

  private union(a: Box, b: Box): Box {
    return {
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1)
    };
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
