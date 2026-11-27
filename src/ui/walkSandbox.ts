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

import { AudioManager } from '../audio/AudioManager';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { GameEngine } from '../core/GameEngine';
import { RuleModule } from '../core/lynx/ruleApi';
import { Simulation } from '../core/lynx/Simulation';
import { World } from '../core/lynx/model';
import { CompiledLevel, Direction, PlayerState } from '../core/types';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { applyTimedMove, collectDueMoves } from './replaySchedule';
import { TIMING_DEFAULTS } from './uiConstants';

/**
 * The private copies of the game a monster forecast plays on. A copy is never the game on screen: it follows it (the CCLP
 * copy plays along tick by tick, the Epoxy copy is set to the state on screen before each forecast) and a forecast on it
 * is always taken back, so nothing a forecast does reaches the player's game.
 */

/** What a forecast plays on: a private game at the state of the one on screen. */
export interface ForkEngine {
  getPlayer(): PlayerState;
  attemptPlayerMove(dir: Direction): boolean;
  tick(): void;
  isLevelCompleted(): boolean;
}

/** A private copy of the running game: `open` sets it to the state on screen (null when it cannot), `close` gives it back. */
export interface Sandbox {
  open(): ForkEngine | null;
  close(): void;
}

/** Ticks the CCLP copy plays catching up in one call (game.json timing): an undo late in a long level replays over several ticks. */
export function walkCatchUpTicks(): number {
  return ConfigRegistry.getGame().timing.walkCatchUpTicks ?? TIMING_DEFAULTS.walkCatchUpTicks;
}

const SILENT = { effect: (): void => undefined, step: (): void => undefined };

/** Epoxy engine: a second engine set to the captured state of the one on screen before each forecast, played silently. */
export class EpoxySandbox implements Sandbox {
  private readonly shadow = new GameEngine();

  /** The private engine, for the tests and the measurement harness. */
  public get copy(): GameEngine {
    return this.shadow;
  }
  private level: CompiledLevel | null = null;

  constructor(private readonly live: GameEngine) {}

  /** The next open loads the level again (a restart, an undo, a new level). */
  public reset(): void {
    this.level = null;
  }

  public open(): ForkEngine | null {
    const level = this.live.getLevel();
    if (this.level !== level) {
      AudioManager.runSilently(() => this.shadow.loadLevel(level));
      this.level = level;
    }
    this.shadow.restoreState(this.live.captureState());
    const shadow = this.shadow;
    return {
      getPlayer: () => shadow.getPlayer(),
      attemptPlayerMove: (dir) => AudioManager.runSilently(() => shadow.attemptPlayerMove(dir)),
      tick: () =>
        AudioManager.runSilently(() => {
          shadow.tick();
          shadow.flushPendingStepEnd();
        }),
      isLevelCompleted: () => shadow.isLevelCompleted()
    };
  }

  public close(): void {
    // The next open restores the state again.
  }
}

/** What a forecast on the CCLP copy changes and must put back. */
interface SimulationMark {
  world: World;
  moves: number;
  timedMoves: number;
  held: Direction | null;
  heldKeys: Direction[];
  pending: Direction | null;
  pendingKeys: Direction[];
  report: Simulation['report'];
}

/**
 * CCLP engine: a second engine that plays the game on screen tick for tick (`follow`, once per real tick), from the recorded
 * timed moves, the way the high score replay does. A forecast is played on it and taken back exactly: the simulation is
 * captured before and put back after, through the extra rule module the copy is built with (the frozen Lynx files keep
 * their capture to themselves; the module hook hands over the simulation). The copy is loaded once per level and reused;
 * it is rebuilt from the level start only when it no longer matches the game on screen (an undo, a restart).
 */
export class CclpSandbox implements Sandbox {
  private sim: Simulation | null = null;
  private readonly shadow: CclpEngine;
  private level: CompiledLevel | null = null;
  private moveIndex = 0;
  private mark: SimulationMark | null = null;
  private rebuiltAfterMismatch = false;
  /** Counters for the measurement harness and the tests. */
  public rebuilds = 0;
  public mismatches = 0;

  constructor(private readonly live: CclpEngine) {
    const tap: RuleModule = {
      name: 'walkForecastTap',
      onLoad: (ctx) => {
        if (ctx instanceof Simulation) this.sim = ctx;
      }
    };
    this.shadow = new CclpEngine(SILENT, [tap]);
  }

  /** The copy no longer follows the game on screen (an undo, a restart, a new level): the next follow or open loads it again. */
  public reset(): void {
    this.level = null;
    this.rebuiltAfterMismatch = false;
  }

  /** The private engine, for the tests and the measurement harness. */
  public get copy(): CclpEngine {
    return this.shadow;
  }

  /** Whether the copy is at the tick of the game on screen. */
  public caughtUp(): boolean {
    return this.level !== null && this.shadow.getTick() >= this.live.getTick();
  }

  private load(): void {
    this.shadow.loadLevel(this.live.getLevel());
    this.level = this.live.getLevel();
    this.moveIndex = 0;
    this.rebuilds++;
  }

  /**
   * Plays the copy forward towards the tick of the game on screen: normally one tick per call, and never more than the
   * catch-up cap of game.json timing, so an undo late in a long level cannot freeze a frame. The copy answers nothing
   * until it has caught up (see open).
   */
  public follow(): void {
    const until = this.live.getTick();
    if (this.level !== this.live.getLevel() || this.shadow.getTick() > until) this.load();
    if (this.shadow.getTick() >= until) return;
    const moves = this.live.getTimedMoveHistory();
    // The game on screen took moves back (an undo): the copy has played moves it no longer has.
    if (this.moveIndex > moves.length) this.load();
    const shadow = this.shadow;
    const stop = Math.min(until, shadow.getTick() + walkCatchUpTicks());
    while (shadow.getTick() < stop) {
      const { due, nextIndex } = collectDueMoves(moves, this.moveIndex, shadow.getTick());
      for (const move of due) applyTimedMove(shadow, move);
      this.moveIndex = nextIndex;
      shadow.tick();
      if (shadow.isLevelCompleted() || !shadow.getPlayer().alive) return;
    }
  }

  /** Whether the copy is, in everything a forecast reads, the game on screen. */
  public matchesLive(): boolean {
    const a = this.shadow;
    const b = this.live;
    if (a.getTick() !== b.getTick() || a.getChipsRemaining() !== b.getChipsRemaining()) return false;
    const pa = a.getPlayer();
    const pb = b.getPlayer();
    if (pa.x !== pb.x || pa.y !== pb.y || pa.dir !== pb.dir || pa.alive !== pb.alive || pa.moveCooldown !== pb.moveCooldown) return false;
    if (pa.isSliding !== pb.isSliding || pa.slideCooldown !== pb.slideCooldown || pa.inWater !== pb.inWater) return false;
    if (JSON.stringify(pa.keys) !== JSON.stringify(pb.keys)) return false;
    if (pa.boots.size !== pb.boots.size || [...pa.boots].some((boot) => !pb.boots.has(boot))) return false;
    const ea = a.getEntities();
    const eb = b.getEntities();
    if (ea.length !== eb.length || !ea.every((e, i) => e.type === eb[i].type && e.x === eb[i].x && e.y === eb[i].y && e.dir === eb[i].dir)) {
      return false;
    }
    return gridsEqual(a.getTerrain(), b.getTerrain()) && gridsEqual(a.getItems(), b.getItems());
  }

  public open(): ForkEngine | null {
    this.follow();
    // Still catching up after an undo or a restart: no forecast, the walk goes on as it did without the watch.
    if (!this.caughtUp()) return null;
    if (!this.matchesLive()) {
      // One rebuild per load of the game on screen; a copy that still does not match is left alone until the next reset.
      if (this.rebuiltAfterMismatch) return null;
      this.mismatches++;
      this.rebuiltAfterMismatch = true;
      this.load();
      this.follow();
      if (!this.caughtUp() || !this.matchesLive()) return null;
    }
    const sim = this.sim;
    if (sim === null) return null;
    this.mark = {
      world: sim.capture(),
      moves: sim.moves.length,
      timedMoves: sim.timedMoves.length,
      held: sim.held,
      heldKeys: [...sim.heldKeys],
      pending: sim.pending,
      pendingKeys: [...sim.pendingKeys],
      report: { ...sim.report }
    };
    const shadow = this.shadow;
    return {
      getPlayer: () => shadow.getPlayer(),
      attemptPlayerMove: (dir) => shadow.canChipTakeInput() && shadow.attemptPlayerMove(dir),
      tick: () => shadow.tick(),
      isLevelCompleted: () => shadow.isLevelCompleted()
    };
  }

  public close(): void {
    const sim = this.sim;
    const mark = this.mark;
    this.mark = null;
    if (sim === null || mark === null) {
      this.level = null;
      return;
    }
    sim.restore(mark.world);
    sim.moves.length = mark.moves;
    sim.timedMoves.length = mark.timedMoves;
    sim.held = mark.held;
    sim.heldKeys = mark.heldKeys;
    sim.pending = mark.pending;
    sim.pendingKeys = mark.pendingKeys;
    sim.report = mark.report;
  }
}

function gridsEqual(a: readonly (readonly (string | null)[])[], b: readonly (readonly (string | null)[])[]): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    const ra = a[y];
    const rb = b[y];
    if (ra.length !== rb.length) return false;
    for (let x = 0; x < ra.length; x++) if (ra[x] !== rb[x]) return false;
  }
  return true;
}

