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
import { ClaimedCells, HubGrid } from './HubGrid';
import { HubWing } from './HubPlanner';
import { CHIP_ITEM_ID, ChainLink, EXIT_TILE_ID, HUB_SEGMENT, LevelGuard, LoopPlacement, MAP_MARGIN, NO_SEGMENT, WingPlacement, WingTrial } from './HubTypes';
import { Box, RouteSegment } from './LevelAssembler';
import { ALL_ORIENTATIONS, IDENTITY_ORIENTATION, orientPiece } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

/** Placements gathered per chosen one, so the cheapest of a wider pool is kept. */
const PLACEMENT_POOL_FACTOR = 2;

/** Largest generation stamp before the stamp arrays are cleared and counting restarts at 1. */
const MAX_STAMP = 0x7fffffff;

/** Parent marker of the first corridor cell. */
const NO_PARENT = -1;

/** Buffers of the corridor search; `seen` (negated for cells that do not fit) and `pathMark` hold generation stamps, so they are never cleared. */
interface SearchScratch {
  generation: number;
  pathGeneration: number;
  seen: Int32Array;
  parents: Int32Array;
  depth: Int32Array;
  order: Int32Array;
  pathKeys: Int32Array;
  pathXs: Int32Array;
  pathYs: Int32Array;
  pathMark: Int32Array;
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

/**
 * Places and walks the loop wings of an endless level: chains of puzzles that
 * leave the hub through a gate and return through a one-way strip, routed over
 * the shared grid.
 */
export class HubLoopAssembler {
  private scratch: SearchScratch | null = null;
  /** Cache keyed by options array: those arrays must never be mutated after first use. */
  private readonly entryBuckets = new WeakMap<CompiledPiece[], Record<Direction, CompiledPiece[]>>();

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
      pushedAt[index + 1] ? { options: chainTurns[index], last: index + 1 === chainTurns.length } : null
    );
    for (const fit of fits) {
      if (budget.returns <= 0) return null;
      const next = this.chainStateAfter(state, fit, seg);
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
      const corridorCells = next.fits
        .slice(1)
        .filter((f) => !f.pushed)
        .reduce((sum, f) => sum + f.corridor.length, 0);
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
    const grid = this.grid;
    const width = grid.width;
    const { boxes, ports, claims } = state;
    for (const [k, seg] of claims) {
      const x = k % width;
      const y = Math.floor(k / width);
      if (!grid.inMapAt(x, y)) return false;
      if (!ports.has(k)) {
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return false;
        }
      }
      const link = links.get(k);
      if (grid.taken[k] && !link?.ring) return false;
      if (link?.ring && grid.segment[k] !== NO_SEGMENT) return false;
      for (let d = 0; d < ORDERED_DIRECTIONS.length; d++) {
        const dir = ORDERED_DIRECTIONS[d];
        const nx = x + DIRECTION_VECTORS[dir].dx;
        const ny = y + DIRECTION_VECTORS[dir].dy;
        const nk = ny * width + nx;
        const neighbourSeg = claims.get(nk) ?? (grid.inMapAt(nx, ny) ? grid.segment[nk] : NO_SEGMENT);
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
   * out of the previous puzzle can be pushed along it into the next. With a
   * `follower`, the next puzzle needs such a lane: a placement is offered only
   * when a lane and one of the follower's orientations have room straight beyond
   * its exit, a cheap check of free cells ahead of the full search that follows.
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
    follower: { options: CompiledPiece[]; last: boolean } | null = null
  ): PlacementFit[] {
    const { boxes, claims, extent } = state;
    const scratch = this.searchScratch();
    const width = this.grid.width;
    const start = this.grid.step(from, heading);
    this.grid.indexClaims(claims);
    // Corridors in order of length: the cells reached (by key), each with the way to it.
    const { parents, depth, seen, order, pathKeys, pathMark } = scratch;
    if (scratch.generation >= MAX_STAMP) {
      scratch.generation = 0;
      scratch.seen.fill(0);
    }
    const generation = ++scratch.generation;
    let reached = 0;
    if (this.grid.fitsIndexed(start.x, start.y, seg, boxes)) {
      const startKey = this.grid.key(start);
      seen[startKey] = generation;
      parents[startKey] = NO_PARENT;
      depth[startKey] = 1;
      order[reached++] = startKey;
      const directions = straight ? [heading] : [...ORDERED_DIRECTIONS];
      this.rng.shuffle(directions);
      const dxs = directions.map((d) => DIRECTION_VECTORS[d].dx);
      const dys = directions.map((d) => DIRECTION_VECTORS[d].dy);
      const maxLength = this.cfg.maxLinkLength;
      const grid = this.grid;
      for (let i = 0; i < reached; i++) {
        const cellKey = order[i];
        const cells = depth[cellKey];
        if (cells >= maxLength) continue;
        const cx = cellKey % width;
        const cy = (cellKey - cx) / width;
        for (let d = 0; d < dxs.length; d++) {
          const nx = cx + dxs[d];
          const ny = cy + dys[d];
          // A cell off the map never fits (the test below drops it); its key stays inside the arrays, as the margin is one cell wide.
          const nk = ny * width + nx;
          const stamp = seen[nk];
          if (stamp === generation || stamp === -generation) continue;
          if (!grid.fitsIndexed(nx, ny, seg, boxes)) {
            // A cell that does not fit never will within this search: it is not weighed again from its other neighbours.
            seen[nk] = -generation;
            continue;
          }
          seen[nk] = generation;
          parents[nk] = cellKey;
          depth[nk] = cells + 1;
          order[reached++] = nk;
        }
      }
    }
    const { pathXs, pathYs } = scratch;
    const touches = (cell: GridPoint, count: number): boolean => {
      for (let i = 0; i < count; i++) {
        if (Math.abs(pathXs[i] - cell.x) + Math.abs(pathYs[i] - cell.y) <= 1) return true;
      }
      return false;
    };
    // Both are pure and only needed once a box has passed the cheap tests, so they are built on first use.
    let ringEnds: GridPoint[] | null = null;
    let claimed: ClaimedCells | null = null;

    const base = this.grid.union(this.grid.bounds, extent);
    const baseArea = this.grid.area(base);
    const fits: PlacementFit[] = [];
    const probe: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    const grid = this.grid;
    const boxCount = boxes.length;
    const takenSum = grid.freshTakenSum();
    const sumStride = width + 1;
    const freeMaxX = width - 1 - MAP_MARGIN;
    const freeMaxY = grid.height - 1 - MAP_MARGIN;
    // Per approach direction, as numbers and arrays: the loops below run millions of times.
    const stepX = ORDERED_DIRECTIONS.map((d) => DIRECTION_VECTORS[d].dx);
    const stepY = ORDERED_DIRECTIONS.map((d) => DIRECTION_VECTORS[d].dy);
    const facingPieces = ORDERED_DIRECTIONS.map((d) => this.entryFacing(options, OPPOSITE_DIRECTION[d]));
    const headingIndex = ORDERED_DIRECTIONS.indexOf(heading);
    // The pseudo cell `from` stands for an empty corridor: end index -1.
    for (let endIndex = direct ? -1 : 0; endIndex < reached; endIndex++) {
      // The corridor leading to this end, first cell first, filled without shifting, and only once a box fits.
      let length = 0;
      let tipX = from.x;
      let tipY = from.y;
      let endKey = -1;
      if (endIndex >= 0) {
        endKey = order[endIndex];
        length = depth[endKey];
        tipX = endKey % width;
        tipY = (endKey - tipX) / width;
      }
      let mark = 0;
      let corridor: GridPoint[] | null = null;
      // Every approach direction, or only the heading: the corridor leaves `from` straight on, or a puzzle follows `from` head-on.
      const firstDir = endIndex >= 0 && !straight ? 0 : headingIndex;
      const lastDir = endIndex >= 0 && !straight ? ORDERED_DIRECTIONS.length - 1 : headingIndex;
      for (let dirIndex = firstDir; dirIndex <= lastDir; dirIndex++) {
        const candidates = facingPieces[dirIndex];
        if (candidates.length === 0) continue;
        const approachDir = ORDERED_DIRECTIONS[dirIndex];
        const entryX = tipX + stepX[dirIndex];
        const entryY = tipY + stepY[dirIndex];
        const entryKey = entryY * width + entryX;
        if (grid.isClaimed(entryKey)) continue;
        // Every candidate box holds the entry port: where it is off the map, taken or inside a box, none can fit.
        if (!grid.inMapAt(entryX, entryY) || grid.taken[entryKey]) continue;
        let inside = false;
        for (let i = 0; i < boxCount; i++) {
          const b = boxes[i];
          if (entryX >= b.x0 && entryX <= b.x1 && entryY >= b.y0 && entryY <= b.y1) {
            inside = true;
            break;
          }
        }
        if (inside) continue;
        const entryPort = { x: entryX, y: entryY };
        for (let pieceIndex = 0; pieceIndex < candidates.length; pieceIndex++) {
          const piece = candidates[pieceIndex];
          // The candidate box is a reused probe until it passes the cheap tests: no object per rejected piece.
          const originX = entryPort.x - piece.entry.x;
          const originY = entryPort.y - piece.entry.y;
          probe.x0 = originX;
          probe.y0 = originY;
          probe.x1 = originX + piece.width - 1;
          probe.y1 = originY + piece.height - 1;
          // The same test as `boxFree`, inline: it runs for every puzzle at every end of the search.
          if (probe.x0 < MAP_MARGIN || probe.y0 < MAP_MARGIN || probe.x1 > freeMaxX || probe.y1 > freeMaxY) continue;
          if (
            takenSum[(probe.y1 + 1) * sumStride + probe.x1 + 1] -
              takenSum[probe.y0 * sumStride + probe.x1 + 1] -
              takenSum[(probe.y1 + 1) * sumStride + probe.x0] +
              takenSum[probe.y0 * sumStride + probe.x0] !==
            0
          ) {
            continue;
          }
          let overlapsBox = false;
          for (let i = 0; i < boxCount; i++) {
            if (grid.overlaps(probe, boxes[i])) {
              overlapsBox = true;
              break;
            }
          }
          if (overlapsBox) continue;
          if (mark === 0) {
            // First box of this end to fit: lay the corridor out (generation stamps keep the marks apart).
            if (scratch.pathGeneration >= MAX_STAMP) {
              scratch.pathGeneration = 0;
              pathMark.fill(0);
            }
            mark = ++scratch.pathGeneration;
            let k = endKey;
            for (let i = length - 1; i >= 0; i--) {
              pathKeys[i] = k;
              pathMark[k] = mark;
              k = parents[k];
            }
            for (let i = 0; i < length; i++) {
              pathXs[i] = pathKeys[i] % width;
              pathYs[i] = (pathKeys[i] - pathXs[i]) / width;
            }
          }
          if (pathMark[entryKey] === mark) continue;
          let crosses = false;
          for (let i = 0; i < length; i++) {
            if (pathXs[i] >= probe.x0 && pathXs[i] <= probe.x1 && pathYs[i] >= probe.y0 && pathYs[i] <= probe.y1) {
              crosses = true;
              break;
            }
          }
          if (crosses) continue;
          claimed ??= grid.claimedCells(claims);
          if (grid.claimedTouchBox(claimed, probe, entryPort)) continue;
          const origin = { x: originX, y: originY };
          const box: Box = { x0: probe.x0, y0: probe.y0, x1: probe.x1, y1: probe.y1 };
          const exitPort = { x: origin.x + piece.exit.x, y: origin.y + piece.exit.y };
          const exitDir = this.grid.outwardOf(piece, piece.exit);
          const beyond = this.grid.step(exitPort, exitDir);
          // Neither the exit nor the cell outside it may touch the corridor leading in.
          const beyondTouchesEntry = Math.abs(entryPort.x - beyond.x) + Math.abs(entryPort.y - beyond.y) <= 1;
          if (touches(exitPort, length) || touches(beyond, length) || beyondTouchesEntry) continue;
          if (last && terminal) {
            // The exit of the finale: nothing open may sit right outside it; the map border is fine.
            const bk = this.grid.key(beyond);
            if (this.grid.inMap(beyond) && (this.grid.segment[bk] !== NO_SEGMENT || claims.has(bk))) continue;
          } else {
            if (!grid.fitsIndexed(beyond.x, beyond.y, seg + 1, boxes, box)) continue;
          }
          if (follower) {
            if (!this.laneHasRoom(exitPort, exitDir, seg + 1, follower.options, boxes, box)) continue;
          }
          // The extent once the corridor, the entry port and the box are in.
          let x0 = Math.min(base.x0, box.x0, entryPort.x);
          let y0 = Math.min(base.y0, box.y0, entryPort.y);
          let x1 = Math.max(base.x1, box.x1, entryPort.x);
          let y1 = Math.max(base.y1, box.y1, entryPort.y);
          for (let i = 0; i < length; i++) {
            x0 = Math.min(x0, pathXs[i]);
            y0 = Math.min(y0, pathYs[i]);
            x1 = Math.max(x1, pathXs[i]);
            y1 = Math.max(y1, pathYs[i]);
          }
          const hugged = this.contact(box, boxes);
          let toHub = 0;
          if (last && !terminal) {
            ringEnds ??= this.freeReturnEnds();
            toHub = Infinity;
            for (let i = 0; i < ringEnds.length; i++) {
              toHub = Math.min(toHub, Math.abs(ringEnds[i].x - beyond.x) + Math.abs(ringEnds[i].y - beyond.y));
            }
          }
          const cost =
            ((x1 - x0 + 1) * (y1 - y0 + 1) - baseArea) * this.cfg.fillTarget +
            length -
            hugged * this.cfg.contactWeight +
            toHub * this.cfg.returnDistanceWeight;
          if (corridor === null) {
            corridor = [];
            for (let i = 0; i < length; i++) corridor.push({ x: pathXs[i], y: pathYs[i] });
          }
          fits.push({ piece, origin, box, corridor, approachDir, entryPort, exitPort, exitDir, pushed: straight, cost });
          if (fits.length >= this.cfg.chainPlacementSamples * PLACEMENT_POOL_FACTOR) {
            return this.cheapest(fits);
          }
        }
      }
    }
    return this.cheapest(fits);
  }

  /** The reusable buffers of the corridor search, allocated once for the grid size. */
  private searchScratch(): SearchScratch {
    if (!this.scratch) {
      const cells = this.grid.width * this.grid.height;
      const pathCapacity = this.cfg.maxLinkLength + 1;
      this.scratch = {
        generation: 0,
        pathGeneration: 0,
        seen: new Int32Array(cells),
        parents: new Int32Array(cells),
        depth: new Int32Array(cells),
        order: new Int32Array(cells),
        pathKeys: new Int32Array(pathCapacity),
        pathXs: new Int32Array(pathCapacity),
        pathYs: new Int32Array(pathCapacity),
        pathMark: new Int32Array(cells)
      };
    }
    return this.scratch;
  }

  /**
   * The pieces of `options` whose entry port faces `facing`, in their order in
   * `options`. Grouped once per options array, since the same arrays are searched
   * thousands of times.
   */
  private entryFacing(options: CompiledPiece[], facing: Direction): CompiledPiece[] {
    let buckets = this.entryBuckets.get(options);
    if (!buckets) {
      buckets = { N: [], E: [], S: [], W: [] };
      for (const piece of options) buckets[this.grid.outwardOf(piece, piece.entry)].push(piece);
      this.entryBuckets.set(options, buckets);
    }
    return buckets[facing];
  }

  /**
   * Whether a straight lane of free cells leaves `exitPort` toward `exitDir` and
   * one of the `options`, its entry facing back, has a free box at the end of
   * it. Cells of the puzzle being placed are not claimed yet, so this is a
   * sieve, not a proof: the placement search of the follower decides. It reads the claims
   * indexed by the running `findPlacements`.
   */
  private laneHasRoom(
    exitPort: GridPoint,
    exitDir: Direction,
    seg: number,
    options: CompiledPiece[],
    boxes: Box[],
    extra: Box
  ): boolean {
    const facing = this.entryFacing(options, OPPOSITE_DIRECTION[exitDir]);
    const vector = DIRECTION_VECTORS[exitDir];
    const probe: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    for (let length = 1; length <= this.cfg.maxLinkLength; length++) {
      if (!this.grid.fitsIndexed(exitPort.x + vector.dx * length, exitPort.y + vector.dy * length, seg, boxes, extra)) return false;
      const entryX = exitPort.x + vector.dx * (length + 1);
      const entryY = exitPort.y + vector.dy * (length + 1);
      for (const piece of facing) {
        const originX = entryX - piece.entry.x;
        const originY = entryY - piece.entry.y;
        probe.x0 = originX;
        probe.y0 = originY;
        probe.x1 = originX + piece.width - 1;
        probe.y1 = originY + piece.height - 1;
        if (this.grid.boxFree(probe) && !this.grid.overlaps(probe, extra) && !boxes.some((b) => this.grid.overlaps(probe, b))) return true;
      }
    }
    return false;
  }

  /** The chain once `fit` is added: its corridor and entry port join segment `seg`, its exit port the next. */
  private chainStateAfter(state: ChainState, fit: PlacementFit, seg: number): ChainState {
    const grid = this.grid;
    const claims = new Map(state.claims);
    for (const p of fit.corridor) claims.set(grid.key(p), seg);
    const entryKey = grid.key(fit.entryPort);
    const exitKey = grid.key(fit.exitPort);
    claims.set(entryKey, seg);
    claims.set(exitKey, seg + 1);
    const ports = new Set(state.ports);
    ports.add(entryKey);
    ports.add(exitKey);
    const boxes = state.boxes.slice();
    boxes.push(fit.box);
    const fits = state.fits.slice();
    fits.push(fit);
    return {
      claims,
      boxes,
      ports,
      extent: grid.union(grid.union(state.extent, fit.box), grid.cellsBox([...fit.corridor, fit.entryPort])),
      fits,
      gateCells: state.gateCells,
      from: fit.exitPort,
      heading: fit.exitDir
    };
  }

  private directionBetween(from: GridPoint, to: GridPoint): Direction {
    return ORDERED_DIRECTIONS.find((d) => from.x + DIRECTION_VECTORS[d].dx === to.x && from.y + DIRECTION_VECTORS[d].dy === to.y) as Direction;
  }

  private cheapest(fits: PlacementFit[]): PlacementFit[] {
    return fits.sort((a, b) => a.cost - b.cost).slice(0, this.cfg.chainPlacementSamples);
  }

  /** Cells just outside the box that are already occupied or off the map: what a placement leans against. */
  private contact(box: Box, boxes: Box[]): number {
    const grid = this.grid;
    const lean = (x: number, y: number): number => {
      if (!grid.inMapAt(x, y) || grid.taken[y * grid.width + x]) return 1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return 1;
      }
      return 0;
    };
    let count = 0;
    for (let x = box.x0; x <= box.x1; x++) count += lean(x, box.y0 - 1) + lean(x, box.y1 + 1);
    for (let y = box.y0; y <= box.y1; y++) count += lean(box.x0 - 1, y) + lean(box.x1 + 1, y);
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
    this.grid.indexClaims(claims);
    if (!this.grid.fitsIndexed(first.x, first.y, seg, boxes)) return null;
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
        if (strip.slice(1).every((c) => this.grid.fitsIndexed(c.x, c.y, seg, boxes))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[ring.outward], joined: null };
        }
      }
      const join = joinEnds.get(cell);
      if (!anchor && join) {
        const strip = Array.from({ length: depth }, (_, j) => this.grid.stepN(join.from, join.outward, j + 1));
        const touching = this.grid.key(join.from);
        if (strip.every((c, j) => this.grid.fitsIndexed(c.x, c.y, seg, boxes, null, j === 0 ? touching : -1))) {
          anchor = { strip, toHub: OPPOSITE_DIRECTION[join.outward], joined: join.from };
        }
      }
      anchors.set(cell, anchor);
      return anchor;
    };

    const directions = [...ORDERED_DIRECTIONS];
    this.rng.shuffle(directions);
    const width = this.grid.width;
    const scratch = this.searchScratch();
    const { parents, depth: length, seen, order: queue } = scratch;
    if (scratch.generation >= MAX_STAMP) {
      scratch.generation = 0;
      scratch.seen.fill(0);
    }
    const generation = ++scratch.generation;
    const firstKey = this.grid.key(first);
    seen[firstKey] = generation;
    length[firstKey] = 1;
    parents[firstKey] = NO_PARENT;
    queue[0] = firstKey;
    let queued = 1;
    const reached: number[] = [];
    for (let i = 0; i < queued && reached.length < this.cfg.chainPlacementSamples; i++) {
      const ck = queue[i];
      const cells = length[ck];
      if (cells >= minCells && (ends.has(ck) || joinEnds.has(ck)) && anchorAt(ck)) reached.push(ck);
      if (cells >= this.cfg.maxReturnLength) continue;
      const cx = ck % width;
      const cy = (ck - cx) / width;
      for (const dir of directions) {
        const nx = cx + DIRECTION_VECTORS[dir].dx;
        const ny = cy + DIRECTION_VECTORS[dir].dy;
        const nk = ny * width + nx;
        if (seen[nk] === generation || !this.grid.fitsIndexed(nx, ny, seg, boxes)) continue;
        seen[nk] = generation;
        length[nk] = cells + 1;
        parents[nk] = ck;
        queue[queued++] = nk;
      }
    }

    let best: ReturnRoute | null = null;
    let bestGrowth = Number.POSITIVE_INFINITY;
    for (const endKey of reached) {
      const anchor = anchorAt(endKey) as ReturnAnchor;
      const tail: GridPoint[] = [];
      for (let k = endKey; k !== NO_PARENT; k = parents[k]) tail.unshift(this.grid.point(k));
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
    const corridor = [...loop.links.filter((l) => !l.pushed).flatMap((l) => l.connector), ...loop.tail];
    // Rewards stand before bonus chips so a short corridor never drops a required item.
    const loot = [...wing.rewards, ...new Array<string>(this.cfg.rewardChips).fill(CHIP_ITEM_ID)].slice(
      0,
      corridor.length
    );
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
