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

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import { SeededRandom } from '../core/Random';
import { Direction, GridPoint, HubConfig } from '../core/types';
import { HubGrid } from './HubGrid';
import { HubWing } from './HubPlanner';
import { CHIP_ITEM_ID, ChainLink, EXIT_TILE_ID, HUB_SEGMENT, LevelGuard, LoopPlacement, NO_SEGMENT, WingPlacement, WingTrial } from './HubTypes';
import { Box, RouteSegment } from './LevelAssembler';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

/** Placements gathered per chosen one, so the cheapest of a wider pool is kept. */
const PLACEMENT_POOL_FACTOR = 2;

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

/**
 * Places and walks the loop wings of an endless level: chains of puzzles that
 * leave the hub through a gate and return through a one-way strip, routed over
 * the shared grid.
 */
export class HubLoopAssembler {
  constructor(
    private readonly grid: HubGrid,
    private readonly cfg: HubConfig,
    private readonly rng: SeededRandom
  ) {}

  /**
   * Places the wings of a level with loop wings, backtracking: when a wing finds
   * no room, the wings before it are placed differently, within a budget of
   * placement searches. Returns the placements by wing index, or null.
   */
  public placeWithBacktracking(
    order: Array<{ wing: HubWing; index: number }>,
    count: number,
    trialsFor: (wing: HubWing, index: number) => WingTrial[]
  ): WingPlacement[] | null {
    const placements: WingPlacement[] = new Array(count);
    const budget = { searches: this.cfg.backtrackBudget };
    const place = (at: number): boolean => {
      if (at === order.length) return true;
      if (budget.searches-- <= 0) return false;
      const { wing, index } = order[at];
      const trials = trialsFor(wing, index).slice(0, this.cfg.wingAlternatives);
      for (const trial of trials) {
        const saved = this.grid.snapshot();
        placements[order[at].index] = trial.commit();
        if (place(at + 1)) return true;
        this.grid.restore(saved);
      }
      return false;
    };
    return place(0) ? placements : null;
  }

  /** Every orientation of a puzzle the generator may turn, in random order. */
  public turnedShuffled(piece: CompiledPiece): CompiledPiece[] {
    const orientations = piece.rotatable ? [...ALL_ORIENTATIONS] : [IDENTITY_ORIENTATION];
    this.rng.shuffle(orientations);
    return orientations.map((o) => orientPiece(piece, o));
  }

  /**
   * Tries a loop wing behind one gate: the lead puzzle past a corridor from the
   * gate, then each chained puzzle past a corridor from the previous exit, then a
   * corridor back to a one-way strip in the hub's wall ring. Each stretch between
   * two puzzles is a segment of its own, so no puzzle can be walked around. Where
   * the way back cannot be routed, the last puzzles are placed differently.
   */
  public tryLoopWing(
    wing: HubWing,
    leadOptions: CompiledPiece[],
    gate: GridPoint,
    outward: Direction,
    gateLength: number,
    firstSegment: number,
    chainTurns: CompiledPiece[][]
  ): WingTrial | null {
    const gateCells = Array.from({ length: gateLength }, (_, i) => this.grid.stepN(gate, outward, i));
    if (gateCells.some((c) => !this.grid.inMap(c) || (this.grid.taken[this.grid.key(c)] && this.grid.key(c) !== this.grid.key(gate)))) return null;
    const claims = new Map<number, number>();
    gateCells.forEach((p) => claims.set(this.grid.key(p), firstSegment));
    const start: ChainState = {
      claims,
      boxes: [],
      ports: new Set<number>(),
      extent: this.grid.cellsBox(gateCells),
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

    const reach = this.grid.cellsBox([...state.claims.keys()].map((k) => this.grid.point(k)));
    const spread = state.boxes.reduce((acc, b) => this.grid.union(acc, b), reach);
    const growth = this.grid.area(this.grid.union(this.grid.bounds, spread)) - this.grid.area(this.grid.bounds);
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
      for (const f of state.fits) this.grid.stamp(f.piece, f.origin);
      for (const [k, seg] of state.claims) this.grid.open(this.grid.point(k), seg, false);
      this.grid.paintGate(wing, approach.slice(0, gateLength), outward);
      this.grid.bounds = this.grid.union(this.grid.bounds, spread);
      if (finaleFit) {
        const exitCell = {
          x: finaleFit.origin.x + finaleFit.piece.exit.x,
          y: finaleFit.origin.y + finaleFit.piece.exit.y
        };
        this.grid.terrain[exitCell.y][exitCell.x] = EXIT_TILE_ID;
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
      const strip = this.grid.gateTerrain(this.cfg.returnGate, OPPOSITE_DIRECTION[(back as ReturnRoute).toHub]);
      for (const cell of (back as ReturnRoute).strip) this.grid.terrain[cell.y][cell.x] = strip;
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
      pushedAt[index] ?? false,
      pushedAt[index + 1] ? this.cfg.laneLookahead : 0
    );
    for (const fit of fits) {
      if (budget.returns <= 0) return null;
      const claims = new Map(state.claims);
      fit.corridor.forEach((p) => claims.set(this.grid.key(p), seg));
      claims.set(this.grid.key(fit.entryPort), seg);
      claims.set(this.grid.key(fit.exitPort), seg + 1);
      const next: ChainState = {
        claims,
        boxes: [...state.boxes, fit.box],
        ports: new Set([...state.ports, this.grid.key(fit.entryPort), this.grid.key(fit.exitPort)]),
        extent: this.grid.union(this.grid.union(state.extent, fit.box), this.grid.cellsBox([...fit.corridor, fit.entryPort])),
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
          [this.grid.key(gate), { dir: OPPOSITE_DIRECTION[outward], seg: HUB_SEGMENT, ring: true }]
        ]);
        if (this.chainIsClean(next, links)) return { state: next, back: null };
        continue;
      }
      budget.returns--;
      const corridorCells = next.fits.slice(1).reduce((sum, f) => sum + f.corridor.length, 0);
      const back = this.routeReturn(
        this.grid.step(fit.exitPort, fit.exitDir),
        seg + 1,
        next.claims,
        next.boxes,
        Math.max(1, loot - corridorCells),
        next.extent,
        // The approach of the wing, past the ring: where the strip may flow in instead of the hub.
        [...state.gateCells.slice(1), ...next.fits[0].corridor]
      );
      if (!back) continue;
      back.tail.forEach((p) => next.claims.set(this.grid.key(p), seg + 1));
      back.strip.forEach((p) => next.claims.set(this.grid.key(p), seg + 1));
      const links = new Map<number, SegmentLink>([
        [this.grid.key(gate), { dir: OPPOSITE_DIRECTION[outward], seg: HUB_SEGMENT, ring: true }]
      ]);
      if (back.joined) {
        links.set(this.grid.key(back.strip[0]), { dir: back.toHub, seg: firstSegment, ring: false });
        links.set(this.grid.key(back.joined), { dir: OPPOSITE_DIRECTION[back.toHub], seg: seg + 1, ring: false });
      } else {
        links.set(this.grid.key(back.strip[0]), { dir: back.toHub, seg: HUB_SEGMENT, ring: true });
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
      const p = this.grid.point(k);
      if (!this.grid.inMap(p)) return false;
      if (!state.ports.has(k) && state.boxes.some((b) => this.grid.inBox(p, b))) return false;
      const link = links.get(k);
      if (this.grid.taken[k] && !link?.ring) return false;
      if (link?.ring && this.grid.segment[k] !== NO_SEGMENT) return false;
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.grid.step(p, dir);
        const nk = this.grid.key(n);
        const neighbourSeg = state.claims.get(nk) ?? (this.grid.inMap(n) ? this.grid.segment[nk] : NO_SEGMENT);
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
   * out of the previous puzzle can be pushed along it into the next. With
   * `laneAhead`, that many cells must be free straight beyond the exit: the
   * next puzzle needs such a lane, so a placement facing a wall is not offered.
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
    straight = false,
    laneAhead = 0
  ): PlacementFit[] {
    const { boxes, claims, extent } = state;
    const start = this.grid.step(from, heading);
    // Corridors in order of length: the cells reached, each with the way to it.
    const parents = new Map<number, number>();
    const order: GridPoint[] = [];
    if (this.grid.corridorFits(start, seg, boxes, claims)) {
      parents.set(this.grid.key(start), -1);
      order.push(start);
      const directions = straight ? [heading] : [...ORDERED_DIRECTIONS];
      this.rng.shuffle(directions);
      const depth = new Map<number, number>([[this.grid.key(start), 1]]);
      for (let i = 0; i < order.length; i++) {
        const cell = order[i];
        const cells = depth.get(this.grid.key(cell)) as number;
        if (cells >= this.cfg.maxLinkLength) continue;
        for (const dir of directions) {
          const n = this.grid.step(cell, dir);
          const nk = this.grid.key(n);
          if (parents.has(nk) || !this.grid.corridorFits(n, seg, boxes, claims)) continue;
          parents.set(nk, this.grid.key(cell));
          depth.set(nk, cells + 1);
          order.push(n);
        }
      }
    }
    const pathTo = (cell: GridPoint | null): GridPoint[] => {
      const path: GridPoint[] = [];
      for (let k: number | undefined = cell ? this.grid.key(cell) : -1; k !== undefined && k !== -1; k = parents.get(k)) {
        path.unshift(this.grid.point(k));
      }
      return path;
    };
    const touches = (cell: GridPoint, cells: GridPoint[]): boolean =>
      cells.some((c) => Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) <= 1);
    const ringEnds = last && !terminal ? this.freeReturnEnds() : [];
    const claimed = [...claims.keys()].map((k) => this.grid.point(k));

    const base = this.grid.union(this.grid.bounds, extent);
    const fits: PlacementFit[] = [];
    // The pseudo cell `from` stands for an empty corridor.
    const ends: Array<GridPoint | null> = direct ? [null, ...order] : order;
    for (const end of ends) {
      const path = pathTo(end);
      const tip = end ?? from;
      const dirs = end && !straight ? ORDERED_DIRECTIONS : [heading];
      for (const approachDir of dirs) {
        const entryPort = this.grid.step(tip, approachDir);
        if (claims.has(this.grid.key(entryPort)) || path.some((c) => c.x === entryPort.x && c.y === entryPort.y)) continue;
        for (const piece of options) {
          if (this.grid.outwardOf(piece, piece.entry) !== OPPOSITE_DIRECTION[approachDir]) continue;
          const origin = { x: entryPort.x - piece.entry.x, y: entryPort.y - piece.entry.y };
          const box = this.grid.boxOf(piece, origin);
          if (!this.grid.boxFree(box) || boxes.some((b) => this.grid.overlaps(box, b))) continue;
          if (path.some((c) => this.grid.inBox(c, box))) continue;
          if (claimed.some((c) => (c.x !== entryPort.x || c.y !== entryPort.y) && this.grid.inBox(c, box))) continue;
          const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
          const exitDir = this.grid.outwardOf(piece, piece.exit);
          const beyond = this.grid.step(exitPort, exitDir);
          // Neither the exit nor the cell outside it may touch the corridor leading in.
          const leading = [...path, entryPort];
          if (touches(exitPort, path) || touches(beyond, leading)) continue;
          if (last && terminal) {
            // The exit of the finale: nothing open may sit right outside it; the map border is fine.
            const bk = this.grid.key(beyond);
            if (this.grid.inMap(beyond) && (this.grid.segment[bk] !== NO_SEGMENT || claims.has(bk) || touches(beyond, leading))) continue;
          } else if (!this.grid.corridorFits(beyond, seg + 1, [...boxes, box], claims)) continue;
          if (laneAhead > 0) {
            const lane = Array.from({ length: laneAhead }, (_, k) => this.grid.stepN(exitPort, exitDir, k + 2));
            if (lane.some((c) => !this.grid.corridorFits(c, seg + 1, [...boxes, box], claims))) continue;
          }
          const spread = this.grid.union(this.grid.union(base, box), this.grid.cellsBox(leading));
          const hugged = this.contact(box, boxes);
          const toHub = last && !terminal ? Math.min(...ringEnds.map((r) => Math.abs(r.x - beyond.x) + Math.abs(r.y - beyond.y))) : 0;
          const cost =
            (this.grid.area(spread) - this.grid.area(base)) * this.cfg.fillTarget +
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
      if (!this.grid.inMap(p) || this.grid.taken[this.grid.key(p)] || boxes.some((b) => this.grid.inBox(p, b))) count++;
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
    const free = [...this.grid.returnEnds()]
      .filter(([, ring]) => this.grid.segment[this.grid.key(ring.gate)] === NO_SEGMENT)
      .map(([k]) => this.grid.point(k));
    return free.length > 0 ? free : [{ x: 0, y: 0 }];
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
    if (!this.grid.corridorFits(first, seg, boxes, claims)) return null;
    // A way back ends on the cell right outside a strip; the strips are checked when reached.
    // A strip leaves the hub's wall ring, or a cell of the wing's own approach.
    const depth = this.cfg.returnDepth;
    const ends = this.grid.returnEnds();
    const joinEnds = new Map<number, { from: GridPoint; outward: Direction }>();
    for (const from of joins) {
      for (const outward of ORDERED_DIRECTIONS) {
        joinEnds.set(this.grid.key(this.grid.stepN(from, outward, depth + 1)), { from, outward });
      }
    }
    const anchors = new Map<number, ReturnAnchor | null>();
    const anchorAt = (cell: number): ReturnAnchor | null => {
      if (anchors.has(cell)) return anchors.get(cell) as ReturnAnchor | null;
      let anchor: ReturnAnchor | null = null;
      const ring = ends.get(cell);
      if (ring && this.grid.segment[this.grid.key(ring.gate)] === NO_SEGMENT && !claims.has(this.grid.key(ring.gate))) {
        const strip = Array.from({ length: depth }, (_, j) => this.grid.stepN(ring.gate, ring.outward, j));
        if (strip.slice(1).every((c) => this.grid.corridorFits(c, seg, boxes, claims))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[ring.outward], joined: null };
        }
      }
      const join = joinEnds.get(cell);
      if (!anchor && join) {
        const strip = Array.from({ length: depth }, (_, j) => this.grid.stepN(join.from, join.outward, j + 1));
        const touching = this.grid.key(join.from);
        if (strip.every((c, j) => this.grid.corridorFits(c, seg, boxes, claims, j === 0 ? touching : -1))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[join.outward], joined: join.from };
        }
      }
      anchors.set(cell, anchor);
      return anchor;
    };

    const directions = [...ORDERED_DIRECTIONS];
    this.rng.shuffle(directions);
    const length = new Map<number, number>([[this.grid.key(first), 1]]);
    const parent = new Map<number, number>();
    const queue: GridPoint[] = [first];
    const reached: number[] = [];
    for (let i = 0; i < queue.length && reached.length < this.cfg.chainPlacementSamples; i++) {
      const cell = queue[i];
      const ck = this.grid.key(cell);
      const cells = length.get(ck) as number;
      if (cells >= minCells && (ends.has(ck) || joinEnds.has(ck)) && anchorAt(ck)) reached.push(ck);
      if (cells >= this.cfg.maxReturnLength) continue;
      for (const dir of directions) {
        const n = this.grid.step(cell, dir);
        const nk = this.grid.key(n);
        if (length.has(nk) || !this.grid.corridorFits(n, seg, boxes, claims)) continue;
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
      for (let k: number | undefined = endKey; k !== undefined; k = parent.get(k)) tail.unshift(this.grid.point(k));
      const stripKeys = new Set(anchor.strip.map((c) => this.grid.key(c)));
      if (tail.some((c) => stripKeys.has(this.grid.key(c)))) continue;
      const growth = this.grid.area(this.grid.union(extent, this.grid.cellsBox([...tail, ...anchor.strip]))) - this.grid.area(extent);
      if (growth < bestGrowth) {
        bestGrowth = growth;
        best = { tail, ...anchor };
      }
    }
    return best;
  }

  /**
   * Scatters the wing's rewards and chips over the corridors of its chain, but
   * never on a lane a block is pushed along; returns their cells in walking order.
   */
  public fillChain(wing: HubWing, loop: LoopPlacement): GridPoint[] {
    const loot = [...wing.rewards, ...new Array<string>(this.cfg.rewardChips).fill(CHIP_ITEM_ID)];
    const corridor = [...loop.links.filter((l) => !l.pushed).flatMap((l) => l.connector), ...loop.tail];
    const picks = corridor.map((_, i) => i);
    this.rng.shuffle(picks);
    this.rng.shuffle(loot);
    const chosen = picks.slice(0, loot.length).sort((a, b) => a - b);
    return chosen.map((at, i) => {
      const cell = corridor[at];
      this.grid.items[cell.y][cell.x] = loot[i];
      if (loot[i] === CHIP_ITEM_ID) this.grid.chipCount++;
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
  public loopRoute(placement: WingPlacement, loop: LoopPlacement, rewardCells: GridPoint[]): RouteSegment[] {
    const { piece, origin, outward, approach } = placement;
    const route: RouteSegment[] = [
      { kind: 'goto', target: approach[approach.length - 1] },
      { kind: 'walk', moves: [outward] },
      { kind: 'piece', piece, origin, isFinale: false }
    ];
    const lootAt = new Set(rewardCells.map((c) => this.grid.key(c)));
    const collect = (cells: GridPoint[]) => {
      for (const cell of cells) if (lootAt.has(this.grid.key(cell))) route.push({ kind: 'goto', target: cell });
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
  public loopGuards(placement: WingPlacement, loop: LoopPlacement, rewardCells: GridPoint[]): LevelGuard[] {
    const pieces = [
      { piece: placement.piece, origin: placement.origin },
      ...loop.links.map((l) => ({ piece: l.piece, origin: l.origin }))
    ];
    // The last puzzle that must be crossed to reach a cell of the chain.
    const crossed = new Map<number, number>();
    loop.links.forEach((l, j) => l.connector.forEach((c) => crossed.set(this.grid.key(c), j)));
    loop.tail.forEach((c) => crossed.set(this.grid.key(c), loop.links.length));
    const end = loop.tail[loop.tail.length - 1];
    const guards: LevelGuard[] = [];
    pieces.forEach(({ piece, origin }, i) => {
      const box = this.grid.boxOf(piece, origin);
      const after = i < loop.links.length ? loop.links[i].connector[0] : loop.tail[0];
      const guarded = [after, end, ...rewardCells.filter((c) => (crossed.get(this.grid.key(c)) ?? 0) >= i)];
      const seen = new Set<number>();
      for (const cell of guarded) {
        if (seen.has(this.grid.key(cell))) continue;
        seen.add(this.grid.key(cell));
        guards.push({ box, guarded: cell });
      }
    });
    return guards;
  }
}
