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
import { BLOCK_TARGET_TILE_ID, FLOOR_TILE_ID, HINT_TILE_ID, WALL_TILE_ID } from './coreConstants';
import { cellEdgeMask, isEdgeBlockedAt } from './EdgeRules';
import { GameEngine } from './GameEngine';
import {
  bootsPullBlocks,
  hasChargeContent,
  hasPocketGateContent,
  hasPullBootsContent,
  hasRelayPadContent,
  hasStoneContent,
  hasTokenContent,
  isChargeTileId,
  isPocketGateTileId,
  isStoneTileId,
  isTokenTileId,
  isTransmogrifierTileId,
  isWardTileId
} from './RulesetFeatures';
import { allowedPushDirs } from './epoxy/epoxyArrowBlocks';

/** Terrain ids of the two turn plates, whose quarter turn the search applies to an arrow block that lands on them. */
/** True when the player wears a ward or one lies on the map: it can destroy a monster, so no monster stays a wall. */
function wardAvailable(engine: GameEngine): boolean {
  if ([...engine.getPlayer().boots].some(isWardTileId)) return true;
  return engine.getItems().some((row) => row.some(isWardTileId));
}

/** True when a blast charge is held or lies on the map: a blast removes monsters and blocks, which the search does not model. */
function chargeAvailable(engine: GameEngine): boolean {
  if (Object.entries(engine.getPlayer().keys).some(([id, count]) => count > 0 && isChargeTileId(id))) return true;
  return hasChargeContent({ terrain: engine.getTerrain(), items: engine.getItems() });
}

/**
 * True when a pocket gate is held or the level places a gate, a pad or a relay pad: a pad links blocks and monsters to
 * wherever another pad stands (and a signal lights or darkens a relay pad), which the search does not model.
 */
function padsAvailable(engine: GameEngine): boolean {
  if (Object.entries(engine.getPlayer().keys).some(([id, count]) => count > 0 && isPocketGateTileId(id))) return true;
  return (
    hasPocketGateContent({ terrain: engine.getTerrain(), items: engine.getItems(), underlays: engine.getLevel().underlays }) ||
    hasRelayPadContent({ terrain: engine.getTerrain() })
  );
}

/** True when the level places several players: the searches follow a single player and refuse such a level. */
function hasSeveralPlayers(engine: GameEngine): boolean {
  return (engine.getLevel().extraPlayers?.length ?? 0) > 0;
}

/** True when a hurl stone is held or lies on the map: a throw destroys monsters and melts ice blocks, which the search does not model. */
function stoneAvailable(engine: GameEngine): boolean {
  if (Object.entries(engine.getPlayer().keys).some(([id, count]) => count > 0 && isStoneTileId(id))) return true;
  return hasStoneContent({ terrain: engine.getTerrain(), items: engine.getItems() });
}

/** True when a toll token is held or lies on the map: whether a thief takes anything then depends on the order of the walk, which the search does not model. */
function tokenAvailable(engine: GameEngine): boolean {
  if (Object.entries(engine.getPlayer().keys).some(([id, count]) => count > 0 && isTokenTileId(id))) return true;
  return hasTokenContent({ terrain: engine.getTerrain(), items: engine.getItems() });
}

/**
 * True when a chain-capable block (its definition lists `chainPushes`) shares the level with another block or a
 * block cloner: one push may then move several blocks, which the search does not model. Callers answer "not
 * decided" (never "stuck") then.
 */
function chainPushPossible(engine: GameEngine): boolean {
  const cloneLinks = engine.getLevel().cloneLinks;
  // A block a clone machine makes counts too.
  const types = [...engine.getEntities().filter((e) => e.kind === 'block').map((e) => e.type), ...cloneLinks.map((l) => l.templateType)];
  if (!types.some((type) => ConfigRegistry.getEntityDef(type)?.chainPushes !== undefined)) return false;
  return types.length > 1 || cloneLinks.length > 0;
}

const TURN_PLATE_CW_TILE_ID = 'turn_plate_cw';
const TURN_PLATE_CCW_TILE_ID = 'turn_plate_ccw';

/** Layouts the exact search may visit, for the dead-end watch that runs by itself, before giving up without a verdict. */
export function watchSearchBudget(): number {
  return ConfigRegistry.getGame().blockPuzzle.watchSearchBudget;
}

/** Layouts the exact search may visit, for a hint or a check the player asked for, before giving up without a verdict. */
export function requestedSearchBudget(): number {
  return ConfigRegistry.getGame().blockPuzzle.hintSearchBudget;
}

/** Observe-only counter a test may hand to `verdict`: `nodes` sums the layouts the searches visited. */
export interface SearchWork {
  nodes: number;
}

/** What `BlockPuzzleSolver.verdict` concludes about the block puzzles of a level. */
export type BlockPuzzleVerdict =
  | { kind: 'solved'; pushes: number }
  | { kind: 'unsolvable' }
  | { kind: 'not_checked' }
  | { kind: 'none' };

/**
 * Ground the verdict models exactly: plain floor and walls a block is pushed
 * across or stopped by, the block targets, and hint tiles (walkable and
 * pushable-across like floor, with no hazard and no transform), and the two turn plates (the search turns
 * the arrows of an arrow block that lands on one). The exit is left out because
 * the player ends the level by stepping on it, which the search does not model.
 */
const MODELLED_TERRAIN: readonly string[] = [
  FLOOR_TILE_ID,
  WALL_TILE_ID,
  BLOCK_TARGET_TILE_ID,
  HINT_TILE_ID,
  TURN_PLATE_CW_TILE_ID,
  TURN_PLATE_CCW_TILE_ID
];
/** Quarter turns of a push mask a turn plate applies: clockwise and counter-clockwise. */
const TURN_CLOCKWISE = 1;
const TURN_COUNTER_CLOCKWISE = -1;

/** Items that change nothing about where the player or a block may go: chips are only collected. */
const MODELLED_ITEMS: readonly string[] = ['chip'];
/** The one piece the search moves: a plain pushable block. Mirrors, ice blocks and monsters are not modelled. */
const MODELLED_ENTITIES: readonly string[] = ['dirt_block'];

/** Bits of a push mask: one per direction, in ORDERED_DIRECTIONS order. */
const ARROW_MASK_SPAN = 1 << ORDERED_DIRECTIONS.length;
/** The mask of a block that may be pushed anywhere: a plain dirt block. */
const FULL_PUSH_MASK = ARROW_MASK_SPAN - 1;

/** A search block is encoded as `cell * ARROW_MASK_SPAN + mask`, so sorting by it still sorts by cell. */
function encodeBlock(cell: number, mask: number): number {
  return cell * ARROW_MASK_SPAN + mask;
}
function blockCell(encoded: number): number {
  return Math.floor(encoded / ARROW_MASK_SPAN);
}
function blockMask(encoded: number): number {
  return encoded % ARROW_MASK_SPAN;
}

/** The push mask after a quarter turn: clockwise moves each arrow N to E to S to W, counter-clockwise the reverse. */
function turnMask(mask: number, turn: number): number {
  const lastBit = ORDERED_DIRECTIONS.length - 1;
  if (turn === TURN_CLOCKWISE) return ((mask << 1) | (mask >> lastBit)) & FULL_PUSH_MASK;
  if (turn === TURN_COUNTER_CLOCKWISE) return ((mask >> 1) | (mask << lastBit)) & FULL_PUSH_MASK;
  return mask;
}

/** Whether the level's entity is a block the search models: dirt, or an arrow block (a turn plate turns its arrows, see turnMask). */
function isModelledEntityType(type: string): boolean {
  return MODELLED_ENTITIES.includes(type) || ConfigRegistry.getEntityDef(type)?.pushArrows !== undefined;
}

type Dir = (typeof ORDERED_DIRECTIONS)[number];

interface SearchNode {
  blocks: number[];
  reach: number[];
  parent: number;
  /** The push leading here: the block's cell before it, and the direction. */
  pushFrom: number;
  pushDir: Dir | null;
}

type SearchOutcome =
  | { kind: 'covered'; nodes: SearchNode[]; goal: number }
  | { kind: 'exhausted' }
  | { kind: 'budget' };

/**
 * Solves the block puzzles of a running level, to keep the player from
 * being stuck and to give hints. The puzzle in
 * question is the Sokoban one: every brown button (hold_trap) must end up
 * under a block, or every block target when the level is won by covering
 * targets. A fast test first looks for a block that can no longer
 * reach any free button, the other blocks standing still. Only when it fires
 * does an exact search run: breadth-first over block layouts, the player
 * walking freely between pushes. A dead end is reported only when that
 * search proves no sequence of pushes covers every button; when it runs out
 * of budget it reports nothing, so the player is never told a false
 * "stuck".
 *
 * The model is deliberately strict about what blocks and the player may
 * cross (hazards, doors without a key, traps and slides count as walls), so
 * it only judges levels whose block puzzles stand on plain ground.
 */
export class BlockPuzzleSolver {
  private readonly width: number;
  private readonly height: number;
  private readonly playerOk: Uint8Array;
  private readonly blockOk: Uint8Array;
  /** Cells a block may enter that the model does not follow (water, ice, force floors...). */
  private readonly blockUnmodelled: Uint8Array;
  /** Per cell and direction (in ORDERED_DIRECTIONS order): the step is stopped by a thin wall or an entry rule. */
  private readonly edgeBlocked: Uint8Array;
  /** Per cell: the quarter turns (1, -1 or 0) a block pushed onto it applies to its arrows. */
  private readonly plateTurn: Int8Array;
  /** Cells a block must cover: the block targets of a 'targets' level, else the hold-trap buttons. */
  private readonly buttons: number[];
  private readonly blocks: number[];
  /** Per block cell: the bitset of absolute directions a push may move it toward. */
  private readonly pushMasks = new Map<number, number>();
  private readonly player: number;

  private constructor(engine: GameEngine) {
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const player = engine.getPlayer();
    this.height = terrain.length;
    this.width = terrain[0].length;
    const size = this.width * this.height;
    this.playerOk = new Uint8Array(size);
    this.blockOk = new Uint8Array(size);
    this.blockUnmodelled = new Uint8Array(size);
    this.edgeBlocked = new Uint8Array(size * ORDERED_DIRECTIONS.length);
    this.plateTurn = new Int8Array(size);
    this.buttons = [];
    const coversTargets = engine.getLevel().winRule === 'targets';
    // A 'receivers' level is won with beams, not by covering buttons: its blocks are not judged here.
    const lightsReceivers = engine.getLevel().winRule === 'receivers';
    const monsters = new Set<number>();
    this.blocks = [];
    for (const e of engine.getEntities()) {
      const kind = ConfigRegistry.getEntityDef(e.type)?.kind;
      if (kind === 'block') {
        const cell = e.y * this.width + e.x;
        this.blocks.push(cell);
        const allowed = allowedPushDirs(e, ConfigRegistry.getEntityDef(e.type));
        const mask = allowed === undefined
          ? FULL_PUSH_MASK
          : allowed.reduce((bits, d) => bits | (1 << ORDERED_DIRECTIONS.indexOf(d)), 0);
        this.pushMasks.set(cell, mask);
      }
      else monsters.add(e.y * this.width + e.x);
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const k = y * this.width + x;
        const tile = ConfigRegistry.getTile(terrain[y][x]);
        const item = items[y][x];
        const itemHazard = item ? Boolean(ConfigRegistry.getTile(item).hazard) : false;
        const plain = !tile.slideType && !tile.hazard && !tile.isTrap && !tile.isTeleporter && !tile.swivelTurns && !itemHazard;
        const unlocked = !tile.requiredKey || (player.keys[tile.requiredKey] ?? 0) > 0;
        this.playerOk[k] = plain && unlocked && tile.passableByPlayer === true && !monsters.has(k) ? 1 : 0;
        this.blockOk[k] = plain && tile.passableByBlock === true && !monsters.has(k) ? 1 : 0;
        this.plateTurn[k] = tile.facingTurn ?? 0;
        // A fish gate opens to a block once the chips are in, which the search does not play.
        this.blockUnmodelled[k] = (!plain && tile.passableByBlock === true) || tile.fishGate === true ? 1 : 0;
        const isGoal = coversTargets ? terrain[y][x] === BLOCK_TARGET_TILE_ID : tile.buttonAction === 'hold_trap';
        if (isGoal && !lightsReceivers) this.buttons.push(k);
      }
    }
    this.player = player.y * this.width + player.x;
    this.markBlockedEdges(terrain, cellEdgeMask(engine.getLevel()));
  }

  /** Records the steps the engine refuses on the edge between two cells, whoever takes them. */
  private markBlockedEdges(terrain: string[][], mask: Uint8Array | null): void {
    ORDERED_DIRECTIONS.forEach((dir, dirIdx) => {
      const vec = DIRECTION_VECTORS[dir];
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const nx = x + vec.dx;
          const ny = y + vec.dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
          if (isEdgeBlockedAt(terrain, mask, x, y, nx, ny, dir)) {
            this.edgeBlocked[(y * this.width + x) * ORDERED_DIRECTIONS.length + dirIdx] = 1;
          }
        }
      }
    });
  }

  /**
   * True only when the blocks provably cannot cover every hold-trap button
   * any more. False means solvable, not a block puzzle, or not decided
   * within the budget.
   */
  public static isStuck(engine: GameEngine, budget: number = watchSearchBudget()): boolean {
    // The search reads the grid as it is now; terrain hidden under a removable top is not modelled.
    if (engine.getUnderlays() !== undefined) return false;
    // The search follows one player; a level with several is never judged.
    if (hasSeveralPlayers(engine)) return false;
    // Signals open and close doors the search does not model: it never reports a wired level stuck.
    if ((engine.getLevel().signalLinks?.length ?? 0) > 0) return false;
    if (bootsPullBlocks(engine.getPlayer().boots) || hasPullBootsContent({ terrain: engine.getTerrain(), items: engine.getItems() })) return false;
    // A ward destroys the first monster touched, so no monster is a permanent wall while one is held or lies on the map.
    if (wardAvailable(engine)) return false;
    // A blast charge destroys monsters and blocks, so neither stays a permanent wall; a pocket gate moves them.
    if (chargeAvailable(engine) || padsAvailable(engine) || stoneAvailable(engine) || tokenAvailable(engine) || chainPushPossible(engine)) return false;
    const detector = new BlockPuzzleSolver(engine);
    if (detector.buttons.length === 0) return false;
    // Separate block puzzles (two Sokoban rooms) are judged one at a time.
    // A puzzle whose blocks can reach ground the model does not follow is not judged.
    return detector
      .areas()
      .some((area) => area.modelled && detector.areaIsStuck(area.blocks, area.buttons, budget));
  }

  /**
   * An honest verdict on the block puzzle of a 'targets' level, for a check the
   * designer asked for and for the automatic validator, which runs it with the
   * watch budget. Unlike `isStuck` it also reports success, and it never
   * runs the fast pre-test. It judges a level only when every cell of the map
   * is in the whitelists above, ground and pieces the search models exactly;
   * anything else anywhere on the map makes the verdict `not_checked`, so a
   * monster, a door, a trap or a cloner can never turn into a false claim.
   * It says nothing about the rest of the level (exit, chips, time).
   *  - `solved`: a sequence of pushes (`pushes` in all) covers every target.
   *  - `unsolvable`: the exhaustive search proved no push sequence covers every target.
   *  - `not_checked`: the map holds something outside the whitelists, the
   *    playable area is above `watchMaxCells`, the budget ran out, or the
   *    player cannot walk up to a block.
   *  - `none`: nothing to judge (not a 'targets' level, no target or no block).
   */
  public static verdict(
    engine: GameEngine,
    budget: number = requestedSearchBudget(),
    work?: SearchWork
  ): BlockPuzzleVerdict {
    if (engine.getLevel().winRule !== 'targets' || engine.getUnderlays() !== undefined) return { kind: 'none' };
    // The search follows one player; a level with several is never judged.
    if (hasSeveralPlayers(engine)) return { kind: 'not_checked' };
    const playable = BlockPuzzleSolver.modelledCellCount(engine);
    if (playable === null || playable > ConfigRegistry.getGame().blockPuzzle.watchMaxCells) {
      return { kind: 'not_checked' };
    }
    const solver = new BlockPuzzleSolver(engine);
    if (solver.buttons.length === 0 || solver.blocks.length === 0) return { kind: 'none' };
    const covered = new Set(solver.blocks);
    let pushes = 0;
    let undecided = false;
    let unsolvable = false;
    const areas = solver.areas();
    const inArea = new Set(areas.flatMap((area) => area.buttons));
    // A goal no block can ever reach cannot be covered, unless a block may slide onto ground the model does not follow.
    if (solver.buttons.some((b) => !inArea.has(b) && !covered.has(b))) {
      if (areas.every((area) => area.modelled)) unsolvable = true;
      else undecided = true;
    }
    for (const area of areas) {
      if (area.buttons.length === 0) continue;
      if (!area.modelled) {
        undecided = true;
        continue;
      }
      if (area.blocks.length < area.buttons.length) {
        unsolvable = true;
        continue;
      }
      if (!solver.playerReaches(area.blocks)) {
        undecided = true;
        continue;
      }
      const fixed = new Set(solver.blocks.filter((b) => !area.blocks.includes(b)));
      const outcome = solver.search(area.blocks, area.buttons, fixed, budget, work);
      if (outcome.kind === 'exhausted') unsolvable = true;
      else if (outcome.kind === 'budget') undecided = true;
      else {
        for (let node = outcome.goal; outcome.nodes[node].parent >= 0; node = outcome.nodes[node].parent) pushes++;
      }
    }
    if (unsolvable) return { kind: 'unsolvable' };
    if (undecided) return { kind: 'not_checked' };
    return { kind: 'solved', pushes };
  }

  /**
   * The number of non-wall cells of the map when everything on it is in the
   * whitelists, else null. The start cell must be walkable ground too.
   */
  private static modelledCellCount(engine: GameEngine): number | null {
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    let cells = 0;
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y].length; x++) {
        // A swivel door turns behind whoever passes: the search keeps edges fixed, so it never judges one.
        {
          const tile = ConfigRegistry.getTile(terrain[y][x]);
          // A swivel door turns and a rail switch flips with the green button: neither is modelled.
          if (tile.swivelTurns || (tile.railSides && tile.togglesTo)) return null;
        }
        if (!MODELLED_TERRAIN.includes(terrain[y][x])) return null;
        const item = items[y][x];
        if (item !== null && !MODELLED_ITEMS.includes(item)) return null;
        if (terrain[y][x] !== WALL_TILE_ID) cells++;
      }
    }
    if (engine.getEntities().some((e) => !isModelledEntityType(e.type))) return null;
    if (engine.getLevel().cloneLinks.length > 0 || engine.getLevel().trapLinks.length > 0) return null;
    // Melinda walks differently from Chip (ice, dirt, gravel, signs): the search models Chip only.
    if (engine.getLevel().character !== undefined) return null;
    // A transmogrifier would switch the character mid-search: the search models one character only.
    if (engine.getTerrain().some((row) => row.some((id) => isTransmogrifierTileId(id)))) return null;
    // Signal wiring changes the board as the player moves: the search does not model it.
    if ((engine.getLevel().signalLinks?.length ?? 0) > 0) return null;
    if (bootsPullBlocks(engine.getPlayer().boots) || hasPullBootsContent({ terrain: engine.getTerrain(), items: engine.getItems() })) return null;
    // A blast charge destroys monsters and blocks and a pocket gate moves them: the search does not model either.
    if (chargeAvailable(engine) || padsAvailable(engine) || stoneAvailable(engine) || tokenAvailable(engine) || chainPushPossible(engine)) return null;
    // Flying shots destroy blocks and monsters: the search does not model them.
    if (engine.getShots() !== undefined || (engine.getLevel().launcherLinks?.length ?? 0) > 0) return null;
    const { x, y } = engine.getPlayer();
    return terrain[y]?.[x] === WALL_TILE_ID ? null : cells;
  }

  /**
   * Groups blocks and buttons by the ground a block could ever cover: two
   * blocks share an area when one could be pushed where the other stands.
   */
  private areas(): Array<{ blocks: number[]; buttons: number[]; modelled: boolean }> {
    const areaOf = new Int32Array(this.width * this.height).fill(-1);
    const result: Array<{ blocks: number[]; buttons: number[]; modelled: boolean }> = [];
    for (const start of this.blocks) {
      if (areaOf[start] >= 0) continue;
      const id = result.length;
      result.push({ blocks: [], buttons: [], modelled: true });
      areaOf[start] = id;
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        for (const dir of ORDERED_DIRECTIONS) {
          const n = this.step(queue[i], dir, 1);
          // Unmodelled ground counts only if a block could be pushed onto it from here.
          const behind = this.step(queue[i], dir, -1);
          if (n >= 0 && this.blockUnmodelled[n] && behind >= 0 && this.playerOk[behind]) {
            result[id].modelled = false;
          }
          if (n < 0 || areaOf[n] >= 0 || !this.blockOk[n]) continue;
          areaOf[n] = id;
          queue.push(n);
        }
      }
    }
    for (const b of this.blocks) result[areaOf[b]].blocks.push(b);
    for (const b of this.buttons) if (areaOf[b] >= 0) result[areaOf[b]].buttons.push(b);
    return result;
  }

  /**
   * Whether the player can walk up to one of the area's blocks right now. A
   * puzzle behind a door the player has no key for yet is not judged: from
   * the outside it would look like a dead end.
   */
  private playerReaches(blocks: number[]): boolean {
    const reach = new Set(this.region(this.player, new Set(this.blocks)));
    // The player must be able to step into the block's cell from the neighbour it reaches.
    return blocks.some((b) => ORDERED_DIRECTIONS.some((dir) => reach.has(this.step(b, dir, -1))));
  }

  private areaIsStuck(blocks: number[], buttons: number[], budget: number): boolean {
    // Only a puzzle with enough blocks for its buttons, within the player's reach, is judged.
    if (buttons.length === 0 || blocks.length < buttons.length) return false;
    if (!this.playerReaches(blocks)) return false;
    const fixed = new Set(this.blocks.filter((b) => !blocks.includes(b)));
    const occupied = new Set(this.blocks);
    const freeButtons = buttons.filter((b) => !occupied.has(b));
    if (freeButtons.length === 0) return false;
    // Fast test: a loose block that can reach no free button, the others standing still.
    const cutOff = blocks.some((block) => {
      if (buttons.includes(block)) return false;
      const others = new Set(this.blocks.filter((b) => b !== block));
      return !this.singleBlockReaches(block, others, freeButtons, this.pushMasks.get(block) ?? FULL_PUSH_MASK);
    });
    return cutOff && this.search(blocks, buttons, fixed, budget).kind === 'exhausted';
  }

  /**
   * The moves that walk the player to the next useful push and make it: the
   * first push of a shortest push sequence covering every button of a block
   * puzzle still open. Null when every puzzle is done, stuck or too large.
   */
  public static hint(engine: GameEngine, budget: number = requestedSearchBudget()): Dir[] | null {
    if (engine.getUnderlays() !== undefined) return null;
    // The search follows one player; a level with several gets no hint.
    if (hasSeveralPlayers(engine)) return null;
    // Signals open and close doors the search does not model: it offers no hint on a wired level.
    if ((engine.getLevel().signalLinks?.length ?? 0) > 0) return null;
    if (bootsPullBlocks(engine.getPlayer().boots) || hasPullBootsContent({ terrain: engine.getTerrain(), items: engine.getItems() })) return null;
    // A blast charge destroys monsters and blocks and a pocket gate moves them: the search does not model either.
    if (chargeAvailable(engine) || padsAvailable(engine) || stoneAvailable(engine) || tokenAvailable(engine) || chainPushPossible(engine)) return null;
    const solver = new BlockPuzzleSolver(engine);
    const occupied = new Set(solver.blocks);
    for (const area of solver.areas()) {
      if (!area.modelled) continue;
      if (area.buttons.length === 0 || area.buttons.every((b) => occupied.has(b))) continue;
      if (area.blocks.length < area.buttons.length || !solver.playerReaches(area.blocks)) continue;
      const fixed = new Set(solver.blocks.filter((b) => !area.blocks.includes(b)));
      const outcome = solver.search(area.blocks, area.buttons, fixed, budget);
      if (outcome.kind !== 'covered') continue;
      let node = outcome.goal;
      while (outcome.nodes[node].parent > 0) node = outcome.nodes[node].parent;
      const first = outcome.nodes[node];
      if (first.pushDir === null) continue;
      const behind = solver.step(first.pushFrom, first.pushDir, -1);
      const walk = solver.walkPath(solver.player, behind, occupied);
      if (walk) return [...walk, first.pushDir];
    }
    return null;
  }

  private singleBlockReaches(block: number, others: Set<number>, targets: number[], startMask: number): boolean {
    const cells = this.width * this.height;
    const keyOf = (b: number, region: number, mask: number) => (b * cells + region) * ARROW_MASK_SPAN + mask;
    const startRegion = this.region(this.player, new Set([...others, block]));
    const seen = new Set([keyOf(block, Math.min(...startRegion), startMask)]);
    const queue: Array<{ b: number; reach: number[]; mask: number }> = [{ b: block, reach: startRegion, mask: startMask }];
    for (let i = 0; i < queue.length; i++) {
      const { b, reach, mask } = queue[i];
      if (targets.includes(b)) return true;
      const reachSet = new Set(reach);
      for (const dir of ORDERED_DIRECTIONS) {
        if ((mask & (1 << ORDERED_DIRECTIONS.indexOf(dir))) === 0) continue;
        const behind = this.step(b, dir, -1);
        const ahead = this.step(b, dir, 1);
        if (behind < 0 || ahead < 0 || !reachSet.has(behind)) continue;
        if (!this.blockOk[ahead] || others.has(ahead)) continue;
        const nextReach = this.region(b, new Set([...others, ahead]));
        const nextMask = turnMask(mask, this.plateTurn[ahead]);
        const key = keyOf(ahead, Math.min(...nextReach), nextMask);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ b: ahead, reach: nextReach, mask: nextMask });
      }
    }
    return false;
  }

  /**
   * Breadth-first search over one area's block layouts, the player walking
   * freely between pushes; other blocks stay put. A covering result keeps
   * the search tree so the first push can be read back.
   */
  private search(
    areaBlocks: number[],
    buttons: number[],
    fixed: Set<number>,
    budget: number,
    work?: SearchWork
  ): SearchOutcome {
    const covered = (blocks: number[]) => buttons.every((b) => blocks.some((c) => blockCell(c) === b));
    const startBlocks = areaBlocks
      .map((cell) => encodeBlock(cell, this.pushMasks.get(cell) ?? FULL_PUSH_MASK))
      .sort((a, b) => a - b);
    const startReach = this.region(this.player, new Set([...startBlocks.map(blockCell), ...fixed]));
    const keyOf = (blocks: number[], reach: number[]) => `${blocks.join(',')}|${Math.min(...reach)}`;
    const seen = new Set([keyOf(startBlocks, startReach)]);
    // Observe-only: adds the layouts visited, what the budget counts, to the caller's counter. Never read here.
    const done = (outcome: SearchOutcome): SearchOutcome => {
      if (work) work.nodes += seen.size;
      return outcome;
    };
    const nodes: SearchNode[] = [{ blocks: startBlocks, reach: startReach, parent: -1, pushFrom: -1, pushDir: null }];
    for (let i = 0; i < nodes.length; i++) {
      const { blocks, reach } = nodes[i];
      if (covered(blocks)) return done({ kind: 'covered', nodes, goal: i });
      // The reach is only read while a node is expanded; keeping it would hold a region per layout.
      nodes[i].reach = [];
      const blockSet = new Set([...blocks.map(blockCell), ...fixed]);
      const reachSet = new Set(reach);
      for (const encoded of blocks) {
        const b = blockCell(encoded);
        const mask = blockMask(encoded);
        for (const dir of ORDERED_DIRECTIONS) {
          if ((mask & (1 << ORDERED_DIRECTIONS.indexOf(dir))) === 0) continue;
          const behind = this.step(b, dir, -1);
          const ahead = this.step(b, dir, 1);
          if (behind < 0 || ahead < 0 || !reachSet.has(behind)) continue;
          if (!this.blockOk[ahead] || blockSet.has(ahead)) continue;
          const next = blocks.map((c) => (c === encoded ? encodeBlock(ahead, turnMask(mask, this.plateTurn[ahead])) : c)).sort((m, n) => m - n);
          const nextReach = this.region(b, new Set([...next.map(blockCell), ...fixed]));
          const key = keyOf(next, nextReach);
          if (seen.has(key)) continue;
          if (seen.size >= budget) return done({ kind: 'budget' });
          seen.add(key);
          nodes.push({ blocks: next, reach: nextReach, parent: i, pushFrom: b, pushDir: dir });
        }
      }
    }
    return done({ kind: 'exhausted' });
  }

  /** Shortest walk between two cells without moving a block. */
  private walkPath(from: number, to: number, blocks: Set<number>): Dir[] | null {
    const parent = new Map<number, { cell: number; dir: Dir }>();
    const queue = [from];
    const seen = new Set([from]);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (cell === to) {
        const path: Dir[] = [];
        for (let c = to; c !== from; c = (parent.get(c) as { cell: number }).cell) {
          path.push((parent.get(c) as { dir: Dir }).dir);
        }
        return path.reverse();
      }
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(cell, dir, 1);
        if (n < 0 || seen.has(n) || blocks.has(n) || !this.playerOk[n]) continue;
        seen.add(n);
        parent.set(n, { cell, dir });
        queue.push(n);
      }
    }
    return null;
  }

  /** Cells the player reaches from `from` without moving a block. */
  private region(from: number, blocks: Set<number>): number[] {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const dir of ORDERED_DIRECTIONS) {
        const n = this.step(queue[i], dir, 1);
        if (n < 0 || seen.has(n) || blocks.has(n) || !this.playerOk[n]) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return queue;
  }

  /**
   * Neighbour of a cell, `sign` steps along `dir`; -1 outside the map or when
   * a thin wall or entry rule stops the step. With sign -1 it is the cell
   * behind, so the step checked is the one from there into `cell`.
   */
  private step(cell: number, dir: Dir, sign: 1 | -1): number {
    const x = (cell % this.width) + DIRECTION_VECTORS[dir].dx * sign;
    const y = Math.floor(cell / this.width) + DIRECTION_VECTORS[dir].dy * sign;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    const next = y * this.width + x;
    const stepFrom = sign === 1 ? cell : next;
    return this.edgeBlocked[stepFrom * ORDERED_DIRECTIONS.length + ORDERED_DIRECTIONS.indexOf(dir)] ? -1 : next;
  }
}
