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
import { createCc2Engine } from '../core/cc2/Cc2Engine';
import { resolveCc2HeldOrder } from '../core/epoxy/cc2HeldInput';
import { usesCc2Engine } from '../core/epoxy/ccRules';
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
 * monster speeds (an Epoxy monster step lasts moveIntervalTicks + 1 ticks, CC2 monsters take 4), the speed of force floors and ice (3 ticks per tile in Epoxy,
 * 2 in CC2), how a move is resolved and the order in which actors take their turn. Random elements are not
 * reproduced either: the header blob seed is not the generator of either engine, and the header force floor start is
 * used only by the Lynx engine (which has such an option). Three engines can be driven (`Cc2ReplayEngine`): the Epoxy
 * engine, the Lynx engine and the CC2 engine (the Lynx engine plus CC2 rule modules), the last two being fed the
 * held direction like the page does. Two strategies are tried:
 *
 * - `held`: at each tick, the keys held at that CC2 tick are offered to the engine, which keeps its own move cadence
 *   (cooldown, ice, force floors). This is the closest to how a person plays. The Epoxy engine is sent a move
 *   attempt every tick with the keys held, most recent first (`attemptPlayerMoveHeld`, the two-key rules of the engine:
 *   an opposing pair held cancels all direction input, else the block slap, then the key matching the facing first,
 *   then the horizontal key, the other key as fallback; a level without a CC2 record keeps the harness order, tried key
 *   by key); the Lynx engine is told the first held
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
 * Drop puts down the oldest pair of boots held (CC2 drops
 * the first tool of the toolbelt; Epoxy keeps its boots in the order they were picked up, and a toolbelt of CC2 holds
 * nothing else, so the keys are never dropped). The Lynx based engines have no drop.
 *
 * Cycle inventory, drop and switch player act once per press at the player's decision (move cooldown 0), with a latch released on key-up; a switch eats that tick's input.
 * Not played: those three keys on the `steps` strategy and the Lynx based engines (still reported in `ignoredKeyBits`), a second player.
 */

/** The engine that plays the replay. */
export type Cc2ReplayEngine = 'epoxy' | 'lynx' | 'cc2';

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
  /** For `death`: the terrain id under the player. */
  tile?: string;
  /** For `death`: the monsters on the player's cell or next to it (same cell first), as entity type ids. */
  monsters?: string[];
}

export interface Cc2ReplayResult {
  strategy: Cc2ReplayStrategy;
  won: boolean;
  /** Engine tick of the win. */
  winTick?: number;
  divergence?: Cc2Divergence;
  /** Steps the engine accepted. */
  moves: number;
  /** Sorted ids the engine played as walls or left out (Lynx based engines only). */
  unsupported?: string[];
}

export interface Cc2ReplayBestResult {
  won: boolean;
  /** First strategy that won, in `CC2_REPLAY_STRATEGIES` order. */
  winner?: Cc2ReplayStrategy;
  results: Cc2ReplayResult[];
  /** Key bits the replay uses and the check cannot play (player 2; also drop, switch player and cycle inventory unless the held strategy on the Epoxy engine played them). */
  ignoredKeyBits: number;
  /** Sorted ids the Lynx based engines play as walls or leave out (empty for the Epoxy engine, which has none). */
  unsupported: string[];
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
/** The key bits no strategy plays: a second player. */
const PLAYER_TWO_KEY_MASK = CC2_REPLAY_ACTION_BITS.player2;
/** The key bits a strategy that ignores the action keys leaves unplayed. */
const IGNORED_KEY_MASK =
  CC2_REPLAY_ACTION_BITS.drop |
  CC2_REPLAY_ACTION_BITS.switchPlayer |
  CC2_REPLAY_ACTION_BITS.cycleInventory |
  PLAYER_TWO_KEY_MASK;

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

/** The CC2 dirt and the plain dirt: the frozen Lynx engine plays an id it does not know as a wall, and dirt_cc2 is the dirt the CC2 rules pack. */
const CC2_DIRT_ID = 'dirt_cc2';
const LYNX_DIRT_ID = 'dirt';

/** The level as the Lynx based engines read it: the Epoxy-only forms of a Lynx tile are replaced by that tile. */
function forLynxEngines(level: CompiledLevel): CompiledLevel {
  if (!level.terrain.some((row) => row.includes(CC2_DIRT_ID))) return level;
  return { ...level, terrain: level.terrain.map((row) => row.map((id) => (id === CC2_DIRT_ID ? LYNX_DIRT_ID : id))) };
}

function newEngine(level: CompiledLevel, replay: Cc2Replay, kind: Cc2ReplayEngine): PlayEngine {
  if (kind === 'lynx' || kind === 'cc2') {
    level = forLynxEngines(level);
    const lynx = kind === 'cc2' ? createCc2Engine(SILENT_SOUND) : new LynxEngine(SILENT_SOUND);
    lynx.setReplayOptions({ randomForceStart: FORCE_START_DIRECTIONS[replay.forceFloorStart & FORCE_START_MASK] });
    lynx.loadLevel(level, replay.blobSeed);
    return lynx;
  }
  const engine = new GameEngine();
  engine.loadLevel(level, replay.blobSeed);
  // The random force floors of a CC2-engine level start where the replay header says (live play starts them east, FORCE_CYCLE_ORDER[0]).
  engine.setReplayForceStart(FORCE_START_DIRECTIONS[replay.forceFloorStart & FORCE_START_MASK]);
  return engine;
}

/** Entity types of the monsters on a cell or on one of its four neighbours, the cell itself first. */
function monstersAround(engine: PlayEngine, x: number, y: number): string[] {
  const distance = (e: { x: number; y: number }): number => Math.abs(e.x - x) + Math.abs(e.y - y);
  return engine
    .getEntities()
    .filter((e) => e.kind === 'monster' && distance(e) <= 1)
    .sort((a, b) => distance(a) - distance(b))
    .map((e) => e.type);
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
    ...(kind === 'death' ? { tile: engine.getTerrain()[p.y]?.[p.x], monsters: monstersAround(engine, p.x, p.y) } : {}),
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

/** Puts down the oldest pair of boots held, the tool CC2 drops first; a Set keeps the order the boots were picked up in. */
function dropOldestBoots(engine: PlayEngine): void {
  const oldest = engine.getPlayer().boots.values().next();
  if (!oldest.done) engine.dropItem(oldest.value);
}

/** The belt the engine keeps itself (a CC2-engine level without the CC1 boot rules), or undefined when it keeps none. */
function engineBeltOf(engine: PlayEngine): readonly string[] | undefined {
  return engine instanceof GameEngine ? engine.getToolBelt() : undefined;
}

/**
 * The CC2 tool belt in pickup order, for the drop and cycle keys: the boots and the counted tools such as dynamite
 * or stones. The drop key puts down its oldest tool and the cycle key sends that tool to the end, as Lexy's drop_item
 * and cycle_inventory do. A level the engine keeps the belt of (see GameEngine.getToolBelt) is read from the engine, which
 * pushes the oldest tool out on a fifth pickup; any other level (the CC1 boot rules) keeps a belt of its own here. Keys are
 * not tools, and in that own belt a toll token or bribe stays off the belt: the engine never sets one down, so a bribe at
 * the head would block every later drop (Lexy does drop a bribe; the belt capacity is not modelled there).
 */
class ToolBelt {
  private order: string[] = [];

  /** Brings the belt in line with what the player holds: tools put down or spent leave, new pickups join at the end. */
  private sync(engine: PlayEngine): void {
    const own = engineBeltOf(engine);
    if (own !== undefined) {
      this.order = [...own];
      return;
    }
    const player = engine.getPlayer();
    const held: string[] = [...player.boots];
    for (const [id, count] of Object.entries(player.keys ?? {})) {
      const collectible = ConfigRegistry.getTile(id).collectible;
      if (collectible === 'key' || collectible === 'token') continue;
      for (let i = 0; i < count; i++) held.push(id);
    }
    const kept: string[] = [];
    for (const id of this.order) {
      const at = held.indexOf(id);
      if (at < 0) continue;
      kept.push(id);
      held.splice(at, 1);
    }
    this.order = [...kept, ...held];
  }

  /** The cycle key: the oldest tool goes to the end of the belt. */
  cycle(engine: PlayEngine): void {
    if (engineBeltOf(engine) !== undefined) {
      engine.cycleInventory?.();
      return;
    }
    this.sync(engine);
    if (this.order.length > 1) this.order.push(this.order.shift() as string);
    engine.cycleInventory?.();
  }

  /**
   * The drop key: puts the oldest tool down; it leaves the belt when the engine let it go. A level that plays in actor order stores
   * the drop for the player's turn, which puts down the head of the belt as it stands there, after a cycle given in the same tick:
   * the head read here would be the one before that cycle, so the engine is asked for the oldest tool (null) and chooses at the turn.
   */
  drop(engine: PlayEngine): void {
    this.sync(engine);
    const chosenAtTurn = engineBeltOf(engine) !== undefined && engine instanceof GameEngine && engine.playsInActorOrder();
    if (this.order.length > 0 && engine.dropItem(chosenAtTurn ? null : this.order[0])) this.order.shift();
  }

  /** Records what was picked up this tick, so that the pickup order survives until the next key press. */
  observe(engine: PlayEngine): void {
    this.sync(engine);
  }
}

/** The action keys that act once per press (cycle, drop, switch player). */
const ACTION_KEY_MASK =
  CC2_REPLAY_ACTION_BITS.drop | CC2_REPLAY_ACTION_BITS.switchPlayer | CC2_REPLAY_ACTION_BITS.cycleInventory;

/**
 * Plays the action keys freshly pressed this tick, at the player's decision only (move cooldown 0), as the reference
 * player does: cycle inventory, drop (not while sliding) and switch player. A key that acts is reported through
 * `consume` so that it does not act again until it is released; a key pressed while the player is not deciding keeps
 * waiting. Returns whether the player was switched, in which case the swap eats the input of the tick.
 */
function playActionKeys(engine: PlayEngine, fresh: number, consume: (bits: number) => void, belt: ToolBelt | null): boolean {
  const player = engine.getPlayer();
  if (fresh === 0 || player.moveCooldown !== 0) return false;
  if (fresh & CC2_REPLAY_ACTION_BITS.cycleInventory) {
    consume(CC2_REPLAY_ACTION_BITS.cycleInventory);
    if (belt) belt.cycle(engine);
    else engine.cycleInventory?.();
  }
  if (fresh & CC2_REPLAY_ACTION_BITS.drop && !player.isSliding) {
    consume(CC2_REPLAY_ACTION_BITS.drop);
    if (belt) belt.drop(engine);
    else dropOldestBoots(engine);
  }
  if (fresh & CC2_REPLAY_ACTION_BITS.switchPlayer) {
    consume(CC2_REPLAY_ACTION_BITS.switchPlayer);
    return engine.swapPlayer?.() === true;
  }
  return false;
}

/** Strategy `held`: offer the held keys to the engine at every tick. */
function playHeld(engine: PlayEngine, replay: Cc2Replay, engineKind: Cc2ReplayEngine, cc2Engine: boolean): Cc2ReplayResult {
  const lynx = engineKind === 'lynx' || engineKind === 'cc2' ? (engine as LynxEngine) : null;
  let lastX = -1;
  let lastY = -1;
  let lastFree = false;
  const keys = keysPerTick(replay, replayTicks(replay));
  const total = keys.length + GRACE_TICKS;
  const down = new Map<Cc2Direction, number>();
  const tracker = new BlockTracker();
  let moves = 0;
  // Actor order: a move the engine accepted is counted once the tick has played the turn that took it.
  let storedMove = false;
  // Action keys act once per press: a bit is released while the key is up and consumed by the press that acts.
  let released: number = ACTION_KEY_MASK;
  // The tool belt of the CC2 engine; any other level keeps dropping the oldest pair of boots.
  const belt = cc2Engine && !lynx ? new ToolBelt() : null;
  for (let tick = 0; tick < total; tick++) {
    // Past the replay end the Epoxy engine keeps holding the last input, as the reference player does; the Lynx based engines release.
    const tickKeys = tick < keys.length ? keys[tick] : !lynx && keys.length > 0 ? keys[keys.length - 1] : 0;
    const held = heldDirections(tickKeys);
    let swappedNow = false;
    storedMove = false;
    belt?.observe(engine);
    if (!lynx) {
      released |= ~tickKeys & ACTION_KEY_MASK;
      swappedNow = playActionKeys(engine, tickKeys & released, (consumed) => {
        released &= ~consumed;
      }, belt);
    }
    for (const dir of DIRECTIONS) if (!held.includes(dir)) down.delete(dir);
    for (const dir of held) if (!down.has(dir)) down.set(dir, tick);
    // Most recent press first; the older key is the fallback when the newer one is blocked.
    const byRecency = [...held].sort((a, b) => (down.get(b) ?? 0) - (down.get(a) ?? 0));
    if (lynx) {
      // The older key leads; the newer one is tried on a tick after a free player did not move.
      const byAge = [...byRecency].reverse();
      const pick = byAge.length > 1 && lastFree && engine.getPlayer().x === lastX && engine.getPlayer().y === lastY ? byAge[1] : byAge[0];
      lynx.holdPlayerDirection(pick ? (pick as Direction) : null);
      lastX = engine.getPlayer().x;
      lastY = engine.getPlayer().y;
      lastFree = held.length > 0 && engine.getPlayer().moveCooldown === 0 && !engine.getPlayer().isSliding;
    } else {
      // The Epoxy engine resolves several held keys itself on a CC2-engine level; the Lynx based engines keep their own.
      if (swappedNow) {
        // The swap key took this tick's input.
      } else if (cc2Engine && engine.attemptPlayerMoveHeld) {
        if (byRecency.length > 0 && engine.attemptPlayerMoveHeld(byRecency as Direction[])) {
          if (engine instanceof GameEngine && engine.playsInActorOrder()) storedMove = true;
          else moves++;
        }
      } else {
        // Any other level (a .DAT import) keeps the harness resolution: the CC2 order, the other key as the fallback.
        for (const dir of resolveCc2HeldOrder(held, engine.getPlayer().dir)) {
          if (engine.attemptPlayerMove(dir)) {
            moves++;
            break;
          }
        }
      }
    }
    const p = engine.getPlayer();
    tracker.observe(tick, p.x, p.y, held.length > 0);
    engine.tick();
    if (storedMove && engine instanceof GameEngine && engine.getLastPlayerTurn()?.moved === true) moves++;
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
function playSteps(engine: PlayEngine, replay: Cc2Replay): Cc2ReplayResult {
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
  const built = newEngine(level, replay, engine);
  const result = strategy === 'held' ? playHeld(built, replay, engine, usesCc2Engine(level)) : playSteps(built, replay);
  return engine === 'epoxy' ? result : { ...result, unsupported: (built as LynxEngine).getUnsupportedTiles() };
}

/** Plays the replay with every strategy and reports the first that wins. */
export function checkCc2ReplayBest(level: CompiledLevel, replay: Cc2Replay, engine: Cc2ReplayEngine = 'epoxy'): Cc2ReplayBestResult {
  const results = CC2_REPLAY_STRATEGIES.map((strategy) => checkCc2Replay(level, replay, strategy, engine));
  const winner = results.find((r) => r.won);
  // The held strategy on the Epoxy engine plays drop, switch and cycle; only a run that `steps` won, or that the Lynx based engines played, leaves them unplayed.
  const heldPlaysActions = engine === 'epoxy' && (winner === undefined || winner.strategy === 'held');
  return {
    won: winner !== undefined,
    ...(winner ? { winner: winner.strategy } : {}),
    results,
    ignoredKeyBits: replay.otherKeyBits & (heldPlaysActions ? PLAYER_TWO_KEY_MASK : IGNORED_KEY_MASK),
    unsupported: results[0]?.unsupported ?? []
  };
}
