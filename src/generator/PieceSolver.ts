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
import { CompiledLevel, Direction, UndoSnapshot } from '../core/types';
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

export interface PieceSolveOptions {
  /** Items the player starts with; defaults to the piece's `requires`. */
  carried?: string[];
  maxStates?: number;
}

export interface PieceSolveResult {
  solvable: boolean;
  /** Shortest move sequence found, entry to exit port. */
  moves: Direction[] | null;
  statesExplored: number;
  /** True when the search stopped at maxStates without an answer. */
  truncated: boolean;
}

export interface PieceAnalysis {
  reachableStates: number;
  deadStates: number;
  deadExits: number;
  blockEscapes: number;
  /** Whether the goal can be reached from the start state. */
  winnable: boolean;
  truncated: boolean;
}

interface SearchNode {
  state: UndoSnapshot;
  parent: number;
  move: Direction | null;
}

/**
 * Proves a piece solvable by breadth-first search over real game states. The
 * piece is loaded into the actual GameEngine, each move is played and ticked
 * until it settles, and states are compared by what can matter: player cell,
 * inventory, chips left, and every terrain, item and entity in the piece. The
 * rules are therefore the game's own, not a model of them.
 *
 * Pieces holding monsters are out of scope: their timing makes the state
 * space depend on ticks, which this search ignores.
 */
export class PieceSolver {
  public static solve(piece: CompiledPiece, options: PieceSolveOptions = {}): PieceSolveResult {
    const maxStates = options.maxStates ?? DEFAULT_MAX_SOLVER_STATES;
    const engine = new GameEngine();
    engine.loadLevel(this.toLevel(piece));

    this.grantCarried(engine, options.carried ?? piece.requires);

    const nodes: SearchNode[] = [{ state: engine.captureState(), parent: -1, move: null }];
    const seen = new Set<string>([this.stateKey(engine, piece)]);

    for (let head = 0; head < nodes.length; head++) {
      for (const dir of ORDERED_DIRECTIONS) {
        engine.restoreState(nodes[head].state);
        if (!engine.attemptPlayerMove(dir) && !this.changedByFailedMove(engine, nodes[head].state)) {
          continue;
        }
        if (!this.settle(engine)) continue;
        if (engine.isLevelCompleted()) {
          // The exit tile ends the level whatever is left; a piece also wants every chip.
          if (engine.getChipsRemaining() > 0) continue;
          return {
            solvable: true,
            moves: [...this.pathTo(nodes, head), dir],
            statesExplored: nodes.length,
            truncated: false
          };
        }
        const key = this.stateKey(engine, piece);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({ state: engine.captureState(), parent: head, move: dir });
        if (nodes.length >= maxStates) {
          return { solvable: false, moves: null, statesExplored: nodes.length, truncated: true };
        }
      }
    }
    return { solvable: false, moves: null, statesExplored: nodes.length, truncated: false };
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

    const states: (UndoSnapshot | null)[] = [engine.captureState()];
    const index = new Map<string, number>([[this.stateKey(engine, piece) + extraKey(), 0]]);
    const predecessors: number[][] = [[]];
    const goals: number[] = [];
    const exits: number[] = [];
    let blockEscapes = 0;
    let truncated = false;

    for (let head = 0; head < states.length; head++) {
      for (const dir of ORDERED_DIRECTIONS) {
        const from = states[head] as UndoSnapshot;
        engine.restoreState(from);
        if (!engine.attemptPlayerMove(dir) && !this.changedByFailedMove(engine, from)) continue;
        if (!this.settle(engine)) continue;
        const key = this.stateKey(engine, piece) + extraKey();
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
    return {
      reachableStates: states.length,
      deadStates,
      deadExits: exits.filter((e) => !canWin[e]).length,
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

  private static grantCarried(engine: GameEngine, carried: string[]): void {
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

  private static stateKey(engine: GameEngine, piece: CompiledPiece): string {
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
        .map((e) => `${e.type}@${e.x},${e.y}`)
        .sort()
        .join(';')
    ];
    for (let y = 0; y < piece.height; y++) {
      const row = terrain[y + PIECE_OFFSET];
      const itemRow = items[y + PIECE_OFFSET];
      for (let x = 0; x < piece.width; x++) {
        parts.push(row[x + PIECE_OFFSET], itemRow[x + PIECE_OFFSET] ?? '');
      }
    }
    return parts.join('|');
  }

  private static pathTo(nodes: SearchNode[], index: number): Direction[] {
    const moves: Direction[] = [];
    for (let i = index; i > 0; i = nodes[i].parent) {
      const move = nodes[i].move;
      if (move) moves.push(move);
    }
    return moves.reverse();
  }
}
