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
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction, GridPoint, UndoSnapshot } from '../core/types';
import { CompiledPiece } from './PieceTypes';

/** Where the piece is drawn inside the otherwise walled map. */
const PIECE_OFFSET = 1;
const WALL_TILE_ID = 'wall';
const EXIT_TILE_ID = 'exit';
const SOLVER_LEVEL_PASSWORD = 'SOLV';
/** Default bound on explored states; pieces are small, so a real one stays far below. */
export const DEFAULT_MAX_SOLVER_STATES = 50000;
/** Ticks a single move may take to settle (cooldowns, slides) before it counts as a loop. */
const MAX_SETTLE_TICKS = 400;

/** Reversibility per oriented piece; it depends on the piece alone. */
const reversibleCache = new Map<string, boolean>();

/** Standing still for one step: with monsters around, timing is part of a solution. */
export const WAIT_ACTION = 'WAIT';
export type SolverAction = Direction | typeof WAIT_ACTION;

/** Letter standing for a wait in a written action list; moves use N, E, S and W. */
const WAIT_LETTER = '.';

export function encodeActions(actions: readonly SolverAction[]): string {
  return actions.map((a) => (a === WAIT_ACTION ? WAIT_LETTER : a)).join('');
}

export function decodeActions(text: string): SolverAction[] {
  return [...text].map((ch) => (ch === WAIT_LETTER ? WAIT_ACTION : (ch as Direction)));
}

export interface PieceSolveOptions {
  /** Items the player starts with; defaults to the piece's `requires`. */
  carried?: string[];
  maxStates?: number;
  /** Steps the player waits at the entry first: monsters arrive at another phase. */
  startWaits?: number;
}

export interface PieceSolveResult {
  solvable: boolean;
  /** Shortest action sequence found, entry to exit port. */
  moves: SolverAction[] | null;
  statesExplored: number;
  /** True when the search stopped at maxStates without an answer. */
  truncated: boolean;
}

export interface PieceAnalysis {
  reachableStates: number;
  deadStates: number;
  deadExits: number;
  /** Winning states from which the player cannot walk back out through the entry. */
  unreturnableGoals: number;
  blockEscapes: number;
  /** Whether the goal can be reached from the start state. */
  winnable: boolean;
  truncated: boolean;
}

interface SearchNode {
  state: UndoSnapshot;
  parent: number;
  move: SolverAction | null;
}

/**
 * Proves a piece solvable by breadth-first search over real game states. The
 * piece is loaded into the actual GameEngine, each move is played and ticked
 * until it settles, and states are compared by what can matter: player cell,
 * inventory, chips left, and every terrain, item and entity in the piece. The
 * rules are therefore the game's own, not a model of them.
 *
 * With monsters, the player may also wait a step, and a monster's facing and
 * move timer are part of the state, so solutions account for timing.
 * Monsters that move at random (walker, blob) are kept out of pieces: their
 * random stream would make every state unique.
 */
export class PieceSolver {
  public static solve(piece: CompiledPiece, options: PieceSolveOptions = {}): PieceSolveResult {
    const engine = new GameEngine();
    engine.loadLevel(this.toLevel(piece));
    this.grantCarried(engine, options.carried ?? piece.requires);
    for (let i = 0; i < (options.startWaits ?? 0); i++) {
      if (!this.play(engine, WAIT_ACTION)) {
        return { solvable: false, moves: null, statesExplored: 0, truncated: false };
      }
    }
    const origin = { x: PIECE_OFFSET, y: PIECE_OFFSET };
    return this.search(engine, piece, origin, options.maxStates ?? DEFAULT_MAX_SOLVER_STATES, () => {
      // The exit tile ends the level whatever is left; a piece also wants every chip.
      if (!engine.isLevelCompleted()) return false;
      return engine.getChipsRemaining() === 0 ? true : null;
    });
  }

  /**
   * Solves a piece in place, inside a running level: the search starts from
   * the engine's current state (monsters wherever time has taken them) and
   * ends with the player on the piece's exit port and no chip left in it.
   * The engine is put back in its starting state before returning.
   */
  public static solveInLevel(
    engine: GameEngine,
    piece: CompiledPiece,
    origin: GridPoint,
    maxStates: number = DEFAULT_MAX_SOLVER_STATES,
    towards: 'exit' | 'entry' = 'exit'
  ): PieceSolveResult {
    const start = engine.captureState();
    try {
      // Monsters never leave their walled piece, so the piece is searched alone
      // (cheap: only its own monsters tick) and the answer is replayed here.
      if (this.hasMonsters(piece)) {
        const isolated = this.solveIsolated(start, piece, origin, maxStates, towards);
        if (!isolated.truncated && !isolated.moves) return isolated;
        if (isolated.moves && this.confirmInLevel(engine, piece, origin, towards, isolated.moves)) return isolated;
        engine.restoreState(start);
      }
      return this.search(engine, piece, origin, maxStates, this.goalIn(engine, piece, origin, towards));
    } finally {
      engine.restoreState(start);
    }
  }

  /** Win test shared by the in-level searches: standing on the target port, chips collected. */
  private static goalIn(
    engine: GameEngine,
    piece: CompiledPiece,
    origin: GridPoint,
    towards: 'exit' | 'entry'
  ): () => boolean | null {
    const port = towards === 'exit' ? piece.exit : piece.entry;
    const target = { x: origin.x + port.x, y: origin.y + port.y };
    return () => {
      const player = engine.getPlayer();
      if (engine.isLevelCompleted()) return null;
      if (player.x !== target.x || player.y !== target.y) return false;
      // Going back out, the chips were collected on the way in.
      return towards === 'entry' || !this.chipLeftInPiece(engine, piece, origin);
    };
  }

  /**
   * Searches the piece in an engine holding only the piece, started from the
   * piece's region of a running level: terrain, items, the piece's monsters
   * and blocks at their current phase, and what the player carries.
   */
  private static solveIsolated(
    start: UndoSnapshot,
    piece: CompiledPiece,
    origin: GridPoint,
    maxStates: number,
    towards: 'exit' | 'entry'
  ): PieceSolveResult {
    const local = new GameEngine();
    local.loadLevel(this.toLevel(piece));
    const state = local.captureState();
    const shiftX = PIECE_OFFSET - origin.x;
    const shiftY = PIECE_OFFSET - origin.y;
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        state.terrain[y + PIECE_OFFSET][x + PIECE_OFFSET] = start.terrain[y + origin.y][x + origin.x];
        state.items[y + PIECE_OFFSET][x + PIECE_OFFSET] = start.items[y + origin.y][x + origin.x];
      }
    }
    state.entities = start.entities
      .filter(
        (e) =>
          e.x >= origin.x && e.y >= origin.y && e.x < origin.x + piece.width && e.y < origin.y + piece.height
      )
      .map((e) => ({ ...e, x: e.x + shiftX, y: e.y + shiftY }));
    state.player = { ...start.player, keys: { ...start.player.keys }, boots: [...start.player.boots] };
    state.player.x += shiftX;
    state.player.y += shiftY;
    state.chipsRemaining = start.chipsRemaining;
    state.nextEntityUid = Math.max(state.nextEntityUid, start.nextEntityUid);
    local.restoreState(state);
    const localOrigin = { x: PIECE_OFFSET, y: PIECE_OFFSET };
    return this.search(local, piece, localOrigin, maxStates, this.goalIn(local, piece, localOrigin, towards));
  }

  /** Plays moves found in isolation inside the level; true when they reach the goal there too. */
  private static confirmInLevel(
    engine: GameEngine,
    piece: CompiledPiece,
    origin: GridPoint,
    towards: 'exit' | 'entry',
    moves: SolverAction[]
  ): boolean {
    for (const action of moves) {
      if (!this.play(engine, action)) return false;
    }
    return this.goalIn(engine, piece, origin, towards)() === true;
  }

  /**
   * Whether a solved piece can always be walked back: from every state where
   * the player has left through the exit with every chip, however the puzzle
   * was solved, a way leads back out through the entry. Only such pieces fit
   * a dead-end wing, which the player must leave the way they came. Cached per
   * piece definition and orientation.
   */
  public static isReversible(piece: CompiledPiece): boolean {
    if (piece.reversible !== undefined) return piece.reversible;
    const { quarterTurns, mirrored } = piece.orientation;
    const cacheKey = `${piece.id}|${quarterTurns}|${mirrored}|${piece.requires.join()}`;
    const cached = reversibleCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const analysis = this.analyze(piece);
    const reversible = analysis.winnable && !analysis.truncated && analysis.unreturnableGoals === 0;
    reversibleCache.set(cacheKey, reversible);
    return reversible;
  }

  /** Plays one solver action and lets it settle; false if the player died or never settles. */
  public static play(engine: GameEngine, action: SolverAction): boolean {
    if (action === WAIT_ACTION) {
      const ticks = ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
      for (let i = 0; i < ticks; i++) engine.tick();
      return this.settle(engine);
    }
    engine.attemptPlayerMove(action);
    return this.settle(engine);
  }

  /** Whether a piece holds monsters, whose timing makes waiting a real move. */
  public static hasMonsters(piece: CompiledPiece): boolean {
    return piece.entities.some((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster');
  }

  /**
   * Breadth-first search from the engine's current state. `goal` says whether
   * the state just reached wins (true), is a dead end to drop (null), or is
   * an ordinary state (false). Waiting is offered only when monsters move.
   */
  private static search(
    engine: GameEngine,
    piece: CompiledPiece,
    origin: GridPoint,
    maxStates: number,
    goal: () => boolean | null
  ): PieceSolveResult {
    const actions: SolverAction[] = this.hasMonsters(piece)
      ? [...ORDERED_DIRECTIONS, WAIT_ACTION]
      : [...ORDERED_DIRECTIONS];
    const nodes: SearchNode[] = [{ state: engine.captureState(), parent: -1, move: null }];
    const seen = new Set<string>([this.stateKey(engine, piece, origin)]);

    for (let head = 0; head < nodes.length; head++) {
      for (const action of actions) {
        const from = nodes[head].state;
        engine.restoreState(from);
        if (action !== WAIT_ACTION && !engine.attemptPlayerMove(action) && !this.changedByFailedMove(engine, from)) {
          continue;
        }
        if (action === WAIT_ACTION) {
          if (!this.play(engine, WAIT_ACTION)) continue;
        } else if (!this.settle(engine)) {
          continue;
        }
        const reached = goal();
        if (reached === null) continue;
        if (reached) {
          return {
            solvable: true,
            moves: [...this.pathTo(nodes, head), action],
            statesExplored: nodes.length,
            truncated: false
          };
        }
        const key = this.stateKey(engine, piece, origin);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({ state: engine.captureState(), parent: head, move: action });
        if (nodes.length >= maxStates) {
          return { solvable: false, moves: null, statesExplored: nodes.length, truncated: true };
        }
      }
    }
    return { solvable: false, moves: null, statesExplored: nodes.length, truncated: false };
  }

  private static chipLeftInPiece(engine: GameEngine, piece: CompiledPiece, origin: GridPoint): boolean {
    const items = engine.getItems();
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        const item = items[origin.y + y][origin.x + x];
        if (item && ConfigRegistry.getTile(item).collectible === 'chip') return true;
      }
    }
    return false;
  }

  /**
   * Explores every state of the piece to judge its fairness. The piece gets a
   * floor cell outside each port, as the corridors it joins in a level, and
   * the goal is to stand outside the exit with every chip. Reports:
   * - blockEscapes: states with a block pushed out through a port, where it
   *   would land in a corridor the solver cannot see;
   * - deadExits: states outside the exit from which the goal is lost, that
   *   is, leaving the piece unfinished for good;
   * - deadStates: all reachable states that cannot reach the goal, a measure
   *   of how unforgiving the piece is.
   */
  public static analyze(piece: CompiledPiece, options: PieceSolveOptions = {}): PieceAnalysis {
    const maxStates = options.maxStates ?? DEFAULT_MAX_SOLVER_STATES;
    const engine = new GameEngine();
    const level = this.toLevel(piece);
    const outside = (port: { x: number; y: number }) => {
      const dir = this.outwardOf(piece, port);
      return {
        x: port.x + PIECE_OFFSET + DIRECTION_VECTORS[dir].dx,
        y: port.y + PIECE_OFFSET + DIRECTION_VECTORS[dir].dy
      };
    };
    const entryStub = outside(piece.entry);
    const exitStub = outside(piece.exit);
    level.terrain[piece.exit.y + PIECE_OFFSET][piece.exit.x + PIECE_OFFSET] = piece.terrain[piece.exit.y][piece.exit.x];
    for (const stub of [entryStub, exitStub]) level.terrain[stub.y][stub.x] = FLOOR_TILE_ID;
    engine.loadLevel(level);
    this.grantCarried(engine, options.carried ?? piece.requires);

    const isStub = (x: number, y: number): boolean =>
      (x === entryStub.x && y === entryStub.y) || (x === exitStub.x && y === exitStub.y);
    const extraKey = (): string => {
      const p = engine.getPlayer();
      return isStub(p.x, p.y) ? `@${p.x},${p.y}` : '';
    };

    const origin = { x: PIECE_OFFSET, y: PIECE_OFFSET };
    const actions: SolverAction[] = this.hasMonsters(piece)
      ? [...ORDERED_DIRECTIONS, WAIT_ACTION]
      : [...ORDERED_DIRECTIONS];
    const states: (UndoSnapshot | null)[] = [engine.captureState()];
    const index = new Map<string, number>([[this.stateKey(engine, piece, origin) + extraKey(), 0]]);
    const predecessors: number[][] = [[]];
    const goals: number[] = [];
    const returns: number[] = [];
    const exits: number[] = [];
    let blockEscapes = 0;
    let truncated = false;

    for (let head = 0; head < states.length; head++) {
      for (const action of actions) {
        const from = states[head] as UndoSnapshot;
        engine.restoreState(from);
        if (action === WAIT_ACTION) {
          if (!this.play(engine, WAIT_ACTION)) continue;
        } else {
          if (!engine.attemptPlayerMove(action) && !this.changedByFailedMove(engine, from)) continue;
          if (!this.settle(engine)) continue;
        }
        const key = this.stateKey(engine, piece, origin) + extraKey();
        let target = index.get(key);
        if (target === undefined) {
          if (states.length >= maxStates) {
            truncated = true;
            continue;
          }
          target = states.length;
          index.set(key, target);
          states.push(engine.captureState());
          predecessors.push([]);
          const player = engine.getPlayer();
          if (engine.getEntities().some((e) => e.kind === 'block' && isStub(e.x, e.y))) blockEscapes++;
          if (player.x === exitStub.x && player.y === exitStub.y) {
            exits.push(target);
            if (engine.getChipsRemaining() === 0) goals.push(target);
          }
          if (player.x === entryStub.x && player.y === entryStub.y) returns.push(target);
        }
        predecessors[target].push(head);
      }
      // A snapshot is only needed to expand its state; free it once done.
      states[head] = null;
    }

    const canWin = new Uint8Array(states.length);
    const queue = [...goals];
    for (const g of goals) canWin[g] = 1;
    for (let i = 0; i < queue.length; i++) {
      for (const p of predecessors[queue[i]]) {
        if (!canWin[p]) {
          canWin[p] = 1;
          queue.push(p);
        }
      }
    }
    let deadStates = 0;
    for (let i = 0; i < states.length; i++) if (!canWin[i]) deadStates++;
    // States from which the player can still walk back out through the entry.
    const canReturn = new Uint8Array(states.length);
    const back = [...returns];
    for (const r of returns) canReturn[r] = 1;
    for (let i = 0; i < back.length; i++) {
      for (const p of predecessors[back[i]]) {
        if (!canReturn[p]) {
          canReturn[p] = 1;
          back.push(p);
        }
      }
    }
    return {
      reachableStates: states.length,
      deadStates,
      deadExits: exits.filter((e) => !canWin[e]).length,
      unreturnableGoals: goals.filter((g) => !canReturn[g]).length,
      blockEscapes,
      winnable: goals.length > 0 && canWin[0] === 1,
      truncated
    };
  }

  private static outwardOf(piece: CompiledPiece, port: { x: number; y: number }): Direction {
    if (port.y === 0) return 'N';
    if (port.y === piece.height - 1) return 'S';
    if (port.x === 0) return 'W';
    return 'E';
  }

  /** Gives the player boots and keys, as if carried in from elsewhere in the level. */
  public static grantCarried(engine: GameEngine, carried: string[]): void {
    const start = engine.captureState();
    for (const itemId of carried) {
      const tile = ConfigRegistry.getTile(itemId);
      if (tile.collectible === 'boot') start.player.boots.push(itemId);
      if (tile.collectible === 'key') start.player.keys[itemId] = (start.player.keys[itemId] ?? 0) + 1;
    }
    engine.restoreState(start);
  }

  /** The piece drawn into a walled map, its exit port turned into the level exit. */
  public static toLevel(piece: CompiledPiece): CompiledLevel {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const terrain = Array.from({ length: mapHeight }, () => new Array<string>(mapWidth).fill(WALL_TILE_ID));
    const items = Array.from({ length: mapHeight }, () => new Array<string | null>(mapWidth).fill(null));
    let chips = 0;
    for (let y = 0; y < piece.height; y++) {
      for (let x = 0; x < piece.width; x++) {
        terrain[y + PIECE_OFFSET][x + PIECE_OFFSET] = piece.terrain[y][x];
        const item = piece.items[y][x];
        items[y + PIECE_OFFSET][x + PIECE_OFFSET] = item;
        if (item && ConfigRegistry.getTile(item).collectible === 'chip') chips++;
      }
    }
    terrain[piece.exit.y + PIECE_OFFSET][piece.exit.x + PIECE_OFFSET] = EXIT_TILE_ID;

    const shift = <T extends { x: number; y: number }>(p: T): T => ({
      ...p,
      x: p.x + PIECE_OFFSET,
      y: p.y + PIECE_OFFSET
    });
    return {
      id: `piece_${piece.id}`,
      number: 1,
      password: SOLVER_LEVEL_PASSWORD,
      timeLimitSeconds: 0,
      chipsRequired: chips,
      playerStart: { ...shift(piece.entry), dir: 'S' },
      terrain,
      items,
      entities: piece.entities.map(shift),
      trapLinks: piece.trapLinks.map((l) => ({
        buttonX: l.buttonX + PIECE_OFFSET,
        buttonY: l.buttonY + PIECE_OFFSET,
        trapX: l.trapX + PIECE_OFFSET,
        trapY: l.trapY + PIECE_OFFSET
      })),
      cloneLinks: piece.cloneLinks.map((l) => ({
        ...l,
        buttonX: l.buttonX + PIECE_OFFSET,
        buttonY: l.buttonY + PIECE_OFFSET,
        clonerX: l.clonerX + PIECE_OFFSET,
        clonerY: l.clonerY + PIECE_OFFSET
      }))
    };
  }

  /** A refused move can still matter: it may reveal a hidden wall or turn the player. */
  private static changedByFailedMove(engine: GameEngine, before: UndoSnapshot): boolean {
    const after = engine.captureState();
    return after.terrain.some((row, y) => row.some((id, x) => id !== before.terrain[y][x]));
  }

  /** Ticks until the player can move again; false if the player died or never settles. */
  public static settle(engine: GameEngine): boolean {
    for (let tick = 0; tick < MAX_SETTLE_TICKS; tick++) {
      const player = engine.getPlayer();
      if (!player.alive) return false;
      if (engine.isLevelCompleted()) return true;
      const moving =
        player.isSliding ||
        player.moveCooldown > 0 ||
        engine.getEntities().some((e) => e.isSliding);
      if (!moving) return true;
      engine.tick();
    }
    return false;
  }

  private static stateKey(engine: GameEngine, piece: CompiledPiece, origin: GridPoint): string {
    const player = engine.getPlayer();
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const parts: string[] = [
      `${player.x},${player.y}`,
      Object.entries(player.keys)
        .filter(([, count]) => count > 0)
        .sort()
        .join(),
      [...player.boots].sort().join(),
      String(engine.getChipsRemaining()),
      engine
        .getEntities()
        .filter((e) => this.inPiece(e, piece, origin))
        // A monster's next move depends on where it faces and when it moves next.
        .map((e) =>
          e.kind === 'monster' ? `${e.type}@${e.x},${e.y},${e.dir},${e.cooldownTicks}` : `${e.type}@${e.x},${e.y}`
        )
        .sort()
        .join(';')
    ];
    for (let y = 0; y < piece.height; y++) {
      const row = terrain[y + origin.y];
      const itemRow = items[y + origin.y];
      for (let x = 0; x < piece.width; x++) {
        parts.push(row[x + origin.x], itemRow[x + origin.x] ?? '');
      }
    }
    return parts.join('|');
  }

  private static inPiece(p: GridPoint, piece: CompiledPiece, origin: GridPoint): boolean {
    // The cell outside each port is kept: a block pushed out must still tell states apart.
    return (
      p.x >= origin.x - 1 &&
      p.y >= origin.y - 1 &&
      p.x <= origin.x + piece.width &&
      p.y <= origin.y + piece.height
    );
  }

  private static pathTo(nodes: SearchNode[], index: number): SolverAction[] {
    const moves: SolverAction[] = [];
    for (let i = index; i > 0; i = nodes[i].parent) {
      const move = nodes[i].move;
      if (move) moves.push(move);
    }
    return moves.reverse();
  }
}
