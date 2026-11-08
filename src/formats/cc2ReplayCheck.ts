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
import { GameEngine } from '../core/GameEngine';
import { LynxEngine } from '../core/lynx/LynxEngine';
import type { PlayEngine } from '../core/PlayEngine';
import type { CompiledLevel, Direction } from '../core/types';
import {
  CC2_FRAMES_PER_TICK,
  CC2_REPLAY_ACTION_BITS,
  CC2_REPLAY_KEY_BITS,
  type Cc2Direction,
  type Cc2Replay
} from './cc2Replay';

/**
 * Coarse acceptance check of a converted CC2 level: plays the winning replay stored in the file on a native engine
 * and says whether the level is won. It is a diagnostic, not a frame exact replay. Only the player cadence matches
 * CC2 (a step every 4 ticks on plain floor, 20 ticks per second). Everything else differs on the Epoxy engine:
 * monster speeds (5 ticks per move in Epoxy, 4 in CC2), the speed of force floors and ice (3 ticks per tile in Epoxy,
 * 2 in CC2), how a move is resolved and the order in which actors take their turn. Random elements are not
 * reproduced either: the header blob seed is not the generator of either engine, and the header force floor start is
 * used only by the Lynx engine (which has such an option). Two engines can be driven (`Cc2ReplayEngine`): the Epoxy
 * engine, and the Lynx engine, which is fed the held direction like the page does. Two strategies are tried:
 *
 * - `held`: at each tick, the keys held at that CC2 tick are offered to the engine, which keeps its own move cadence
 *   (cooldown, ice, force floors). This is the closest to how a person plays. The Epoxy engine is sent a move
 *   attempt every tick (most recent press first, the older key as fallback); the Lynx engine is told the first held
 *   direction each tick and falls back to the second key on a tick after the player was free to move and did not.
 * - `steps`: each key press becomes `ceil(held ticks / cadence)` steps; before each step the engine is ticked until
 *   the player is at rest. The time spent holding a key is ignored, only the sequence of moves is kept, so it
 *   tolerates timing drift but not monsters that must be dodged on the beat.
 *
 * Measured on the 200 official CC2 levels with the Epoxy engine (2026-11-08): of the 24 assignments of the four
 * direction bits, the one of cc2Replay.ts (0x02 S, 0x04 W, 0x08 E, 0x10 N) wins 21 replays with `held`, the next
 * best 4. A buffered tap (a press made during the move cooldown kept until it can move) and a start offset of 1 to 4
 * ticks did not win more.
 *
 * Not played: drop, switch player and cycle inventory (reported in `ignoredKeyBits`), a second player.
 */

/** The engine that plays the replay. */
export type Cc2ReplayEngine = 'epoxy' | 'lynx';

export type Cc2ReplayStrategy = 'held' | 'steps';

/** Strategies in the order they are tried. */
export const CC2_REPLAY_STRATEGIES: readonly Cc2ReplayStrategy[] = ['held', 'steps'];

/** How the run ended when the level was not won. */
export type Cc2DivergenceKind =
  /** The player died; `reasonKey` says of what. */
  | 'death'
  /** The replay ran out (plus the grace period) with the player alive and the level not won. */
  | 'no_exit'
  /** As `no_exit`, but a held direction had left the player in place for the whole stuck window at some point. */
  | 'stuck'
  /** `steps` only: the player never came to rest within the settle cap. */
  | 'no_rest';

export interface Cc2Divergence {
  kind: Cc2DivergenceKind;
  /** Engine tick at which the run ended. */
  tick: number;
  /** Steps the engine accepted so far. */
  move: number;
  x: number;
  y: number;
  /** Locale key of the death, for `death`. */
  reasonKey?: string;
  /** First tick of the first blocked stretch (a direction held, the player not moving), when one was seen. */
  blockedSinceTick?: number;
}

export interface Cc2ReplayResult {
  strategy: Cc2ReplayStrategy;
  won: boolean;
  /** Engine tick of the win. */
  winTick?: number;
  divergence?: Cc2Divergence;
  /** Steps the engine accepted. */
  moves: number;
}

export interface Cc2ReplayBestResult {
  won: boolean;
  /** First strategy that won, in `CC2_REPLAY_STRATEGIES` order. */
  winner?: Cc2ReplayStrategy;
  results: Cc2ReplayResult[];
  /** Key bits the replay uses and the check cannot play (drop, switch player, cycle inventory, player 2). */
  ignoredKeyBits: number;
}

/** Ticks the engine runs after the last replay input, in case a slide or a conveyor still has to carry the player. */
export const GRACE_TICKS = 100;
/** Ticks a held direction may leave the player in place before the run counts as blocked. */
export const STUCK_TICKS = 40;
/** Cap of the ticks `steps` waits for the player to come to rest after one step. */
export const MAX_SETTLE_TICKS = 400;
/** Quiet ticks in a row that count as standing still (a slide may start a tick after arrival). */
const STABLE_TICKS = 3;
/** Fallback of the walking cadence when the config is not readable. */
const DEFAULT_CADENCE_TICKS = 4;

const DIRECTIONS: readonly Cc2Direction[] = ['N', 'E', 'S', 'W'];
const IGNORED_KEY_MASK =
  CC2_REPLAY_ACTION_BITS.drop |
  CC2_REPLAY_ACTION_BITS.switchPlayer |
  CC2_REPLAY_ACTION_BITS.cycleInventory |
  CC2_REPLAY_ACTION_BITS.player2;

/** Key bits per engine tick, from the state changes of the replay: the state in force by the end of the tick's frames. */
function keysPerTick(replay: Cc2Replay, tickCount: number): number[] {
  const out: number[] = [];
  let at = 0;
  let keys = 0;
  for (let tick = 0; tick < tickCount; tick++) {
    const limit = (tick + 1) * CC2_FRAMES_PER_TICK;
    while (at < replay.inputs.length && replay.inputs[at].frame < limit) keys = replay.inputs[at++].keys;
    out.push(keys);
  }
  return out;
}

function heldDirections(keys: number): Cc2Direction[] {
  return DIRECTIONS.filter((d) => (keys & CC2_REPLAY_KEY_BITS[d]) !== 0);
}

/** Replay ticks, rounded up to cover the last input. */
function replayTicks(replay: Cc2Replay): number {
  return replay.totalTicks + 1;
}

function walkCadence(): number {
  try {
    return Math.max(1, ConfigRegistry.getGame().timing.playerMoveCooldownTicks);
  } catch {
    return DEFAULT_CADENCE_TICKS;
  }
}

/** Direction of the header force floor start byte (0-3), in N, E, S, W order. */
const FORCE_START_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const FORCE_START_MASK = 3;

/** Lynx sound player: the check plays in silence. */
const SILENT_SOUND = { effect: () => undefined, step: () => undefined };

function newEngine(level: CompiledLevel, replay: Cc2Replay, kind: Cc2ReplayEngine): PlayEngine {
  if (kind === 'lynx') {
    const lynx = new LynxEngine(SILENT_SOUND);
    lynx.setReplayOptions({ randomForceStart: FORCE_START_DIRECTIONS[replay.forceFloorStart & FORCE_START_MASK] });
    lynx.loadLevel(level, replay.blobSeed);
    return lynx;
  }
  const engine = new GameEngine();
  engine.loadLevel(level, replay.blobSeed);
  return engine;
}

function divergenceOf(kind: Cc2DivergenceKind, engine: PlayEngine, moves: number, blockedSinceTick?: number): Cc2Divergence {
  const p = engine.getPlayer();
  return {
    kind,
    tick: engine.getTick(),
    move: moves,
    x: p.x,
    y: p.y,
    ...(!p.alive && p.deathReasonKey ? { reasonKey: p.deathReasonKey } : {}),
    ...(blockedSinceTick !== undefined ? { blockedSinceTick } : {})
  };
}

/** Finds the first stretch where a direction was held and the player did not move. */
class BlockTracker {
  private x = -1;
  private y = -1;
  private since = 0;
  /** Start of the first stretch that reached STUCK_TICKS. */
  public blockedSince: number | undefined;

  public observe(tick: number, x: number, y: number, held: boolean): void {
    if (x !== this.x || y !== this.y || !held) {
      this.x = x;
      this.y = y;
      this.since = tick;
      return;
    }
    if (this.blockedSince === undefined && tick - this.since >= STUCK_TICKS) this.blockedSince = this.since;
  }
}

/** Strategy `held`: offer the held keys to the engine at every tick. */
function playHeld(level: CompiledLevel, replay: Cc2Replay, engineKind: Cc2ReplayEngine): Cc2ReplayResult {
  const engine = newEngine(level, replay, engineKind);
  const lynx = engineKind === 'lynx' ? (engine as LynxEngine) : null;
  let lastX = -1;
  let lastY = -1;
  let lastFree = false;
  const keys = keysPerTick(replay, replayTicks(replay));
  const total = keys.length + GRACE_TICKS;
  const down = new Map<Cc2Direction, number>();
  const tracker = new BlockTracker();
  let moves = 0;
  for (let tick = 0; tick < total; tick++) {
    const held = heldDirections(tick < keys.length ? keys[tick] : 0);
    for (const dir of DIRECTIONS) if (!held.includes(dir)) down.delete(dir);
    for (const dir of held) if (!down.has(dir)) down.set(dir, tick);
    // Most recent press first; the older key is the fallback when the newer one is blocked.
    const order = [...held].sort((a, b) => (down.get(b) ?? 0) - (down.get(a) ?? 0));
    if (lynx) {
      // The older key leads; the newer one is tried on a tick after a free player did not move.
      const byAge = [...order].reverse();
      const pick = byAge.length > 1 && lastFree && engine.getPlayer().x === lastX && engine.getPlayer().y === lastY ? byAge[1] : byAge[0];
      lynx.holdPlayerDirection(pick ? (pick as Direction) : null);
      lastX = engine.getPlayer().x;
      lastY = engine.getPlayer().y;
      lastFree = held.length > 0 && engine.getPlayer().moveCooldown === 0 && !engine.getPlayer().isSliding;
    } else {
      for (const dir of order) {
        if (engine.attemptPlayerMove(dir as Direction)) {
          moves++;
          break;
        }
      }
    }
    const p = engine.getPlayer();
    tracker.observe(tick, p.x, p.y, held.length > 0);
    engine.tick();
    if (engine.isLevelCompleted()) return { strategy: 'held', won: true, winTick: engine.getTick(), moves };
    if (!engine.getPlayer().alive) {
      return { strategy: 'held', won: false, moves, divergence: divergenceOf('death', engine, moves, tracker.blockedSince) };
    }
  }
  const kind: Cc2DivergenceKind = tracker.blockedSince !== undefined ? 'stuck' : 'no_exit';
  return { strategy: 'held', won: false, moves, divergence: divergenceOf(kind, engine, moves, tracker.blockedSince) };
}

/** One key press of the replay: a direction and how many ticks it was held. */
interface Press {
  dir: Cc2Direction;
  startTick: number;
  durationTicks: number;
}

function pressesOf(replay: Cc2Replay): Press[] {
  return replay.players[0].moves
    .map((m) => ({ dir: m.direction, startTick: m.startTick, durationTicks: m.durationTicks }))
    .sort((a, b) => a.startTick - b.startTick);
}

/** Ticks until the player has stood still, with nothing under way, for STABLE_TICKS ticks. False when the cap ran out. */
function settle(engine: PlayEngine): boolean {
  const read = () => {
    const p = engine.getPlayer();
    return { x: p.x, y: p.y, busy: p.moveCooldown > 0 || p.isSliding };
  };
  let last = read();
  let quiet = 0;
  for (let i = 0; i < MAX_SETTLE_TICKS; i++) {
    if (engine.isLevelCompleted() || !engine.getPlayer().alive) return true;
    engine.tick();
    const now = read();
    quiet = !now.busy && !last.busy && now.x === last.x && now.y === last.y ? quiet + 1 : 0;
    last = now;
    if (quiet >= STABLE_TICKS) return true;
  }
  return false;
}

/** Strategy `steps`: replay the sequence of moves, waiting for the player to rest before each one. */
function playSteps(level: CompiledLevel, replay: Cc2Replay, engineKind: Cc2ReplayEngine): Cc2ReplayResult {
  const engine = newEngine(level, replay, engineKind);
  const cadence = walkCadence();
  let moves = 0;
  const lost = (kind: Cc2DivergenceKind): Cc2ReplayResult => ({
    strategy: 'steps',
    won: false,
    moves,
    divergence: divergenceOf(kind, engine, moves)
  });
  const won = (): Cc2ReplayResult => ({ strategy: 'steps', won: true, winTick: engine.getTick(), moves });
  for (const press of pressesOf(replay)) {
    const steps = Math.max(1, Math.ceil(press.durationTicks / cadence));
    for (let i = 0; i < steps; i++) {
      if (!settle(engine)) return lost('no_rest');
      if (engine.isLevelCompleted()) return won();
      if (!engine.getPlayer().alive) return lost('death');
      if (engine.attemptPlayerMove(press.dir as Direction)) moves++;
      if (engine.isLevelCompleted()) return won();
      if (!engine.getPlayer().alive) return lost('death');
    }
  }
  if (!settle(engine)) return lost('no_rest');
  if (engine.isLevelCompleted()) return won();
  return lost(engine.getPlayer().alive ? 'no_exit' : 'death');
}

/** Plays the replay with one strategy. The level is loaded in a fresh engine, so the call has no side effect. */
export function checkCc2Replay(
  level: CompiledLevel,
  replay: Cc2Replay,
  strategy: Cc2ReplayStrategy,
  engine: Cc2ReplayEngine = 'epoxy'
): Cc2ReplayResult {
  return strategy === 'held' ? playHeld(level, replay, engine) : playSteps(level, replay, engine);
}

/** Plays the replay with every strategy and reports the first that wins. */
export function checkCc2ReplayBest(level: CompiledLevel, replay: Cc2Replay, engine: Cc2ReplayEngine = 'epoxy'): Cc2ReplayBestResult {
  const results = CC2_REPLAY_STRATEGIES.map((strategy) => checkCc2Replay(level, replay, strategy, engine));
  const winner = results.find((r) => r.won);
  return {
    won: winner !== undefined,
    ...(winner ? { winner: winner.strategy } : {}),
    results,
    ignoredKeyBits: replay.otherKeyBits & IGNORED_KEY_MASK
  };
}
