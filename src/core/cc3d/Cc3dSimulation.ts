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

import type { VisualEventKind } from '../PlayEngine';
import { SeededRandom } from '../Random';
import type { Direction, TimedMove } from '../types';
import { onArrival, openOnEntry } from './cc3dArrival';
import { updateDevices } from './cc3dDevices';
import { chooseMonsterDirection } from './cc3dMonsters';
import { MONSTER_TRAITS, isSupportedMonster } from './cc3dMonsterTraits';
import { DEATH_KEY, DeathCause, SFX, STEP_TICKS, VISUAL_COLOR } from './cc3dConstants';
import { StepPlan, planStep } from './cc3dMovement';
import { ForcedMove, forcedMoveOf, inputAllowed, onLeave } from './cc3dTerrainRules';
import {
  Actor,
  Cell,
  MobState,
  PlayerData,
  RuleContext,
  World,
  isBlockKind,
  moveActor,
  neighbour,
  opposite,
  reindexMobs,
  speedOrbFactor,
  replaceTop
} from './cc3dWorld';
import type { Cc3dCell } from './model';

/** Where the simulation sends what the player sees and hears. */
export interface SimulationEvents {
  visual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void;
  sound(id: string): void;
  /** The player began a chosen step onto the cell (the engine maps it to a footstep). */
  step(x: number, y: number): void;
}

/** What an undo restores: the small state, plus the cells the journal kept. */
export interface Cc3dSnapshot {
  tick: number;
  steps: number;
  fishRemaining: number;
  complete: boolean;
  nextUid: number;
  rngState: number;
  closing: number[];
  player: PlayerData;
  mobs: MobState[];
  /** Pre-change copies of the cells first changed since this snapshot (copy-on-write). */
  journal: Map<number, Cc3dCell>;
  /** The journal that was active before this snapshot began; dropped once kept or discarded. */
  previous: Map<number, Cc3dCell> | null;
}

/** What happened to the player's input during the last tick (the engine decides about undo snapshots). */
export interface TickReport {
  tookInput: boolean;
  startedStep: boolean;
}

type StepIntent = 'chosen' | 'forced' | 'pushed';

/**
 * Plays ticks over a World. Order inside a tick: the player, then the mob list
 * in its fixed order. A mover mid-step advances; an idle one decides (the floor's
 * forced move, else the player's input) and starts its step in the same tick.
 */
export class Cc3dSimulation implements RuleContext {
  public world: World;
  /** The one direction the player asked for and has not taken yet. */
  public pending: Direction | null = null;
  /** The direction held down right now. */
  public held: Direction | null = null;
  public readonly moves: Direction[] = [];
  public readonly timedMoves: TimedMove[] = [];
  public report: TickReport = { tookInput: false, startedStep: false };
  /** The blocked sound plays once per bump, not once per tick. */
  private blockedLatch = false;

  constructor(
    world: World,
    private readonly events: SimulationEvents,
    private readonly timeLimitTicks: number
  ) {
    this.world = world;
    updateDevices(world);
  }

  // ---------------------------------------------------------- RuleContext

  public emitVisual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void {
    this.events.visual(kind, x, y, colorKey);
  }

  public playSfx(id: string): void {
    this.events.sound(id);
  }

  public releaseMob(mob: MobState, dir: Direction): void {
    this.startStep(mob, dir, 'pushed', !isBlockKind(mob.kind));
  }

  public stepMob(mob: MobState, dir: Direction): boolean {
    return this.tryStep(mob, dir, 'chosen');
  }

  public randomDirection(): Direction {
    const rng = new SeededRandom(this.world.rngState);
    const dir = (['N', 'E', 'S', 'W'] as const)[rng.nextInt(0, 3)];
    this.world.rngState = rng.getState();
    return dir;
  }

  public killPlayer(cause: DeathCause): void {
    const player = this.world.player;
    if (!player.alive) return;
    player.alive = false;
    player.deathKey = DEATH_KEY[cause];
    const watery = cause === 'water' || cause === 'slime';
    this.events.visual(watery ? 'splash' : 'explosion', player.x, player.y, watery ? undefined : VISUAL_COLOR.death);
    if (watery) this.events.sound(SFX.splash);
    else if (cause === 'fire') this.events.sound(SFX.burn);
    else if (cause === 'bomb') this.events.sound(SFX.bomb);
    else if (cause !== 'time') this.events.sound(SFX.death);
  }

  // -------------------------------------------------------------- snapshot

  /**
   * Starts an undo snapshot: the small state is copied now, the cells are kept
   * copy-on-write in the snapshot's journal (a cell is copied the first time
   * it changes). Cost: the mobs and the player, not the grid.
   */
  public beginSnapshot(): Cc3dSnapshot {
    const w = this.world;
    const snapshot: Cc3dSnapshot = {
      tick: w.tick,
      steps: w.steps,
      fishRemaining: w.fishRemaining,
      complete: w.complete,
      nextUid: w.nextUid,
      rngState: w.rngState,
      closing: [...w.closing],
      player: structuredClone(w.player),
      mobs: structuredClone(w.mobs),
      journal: new Map<number, Cc3dCell>(),
      previous: w.journal
    };
    w.journal = snapshot.journal;
    return snapshot;
  }

  /** The snapshot was not needed (no step started): its journal folds into the one before. */
  public discardSnapshot(snapshot: Cc3dSnapshot): void {
    const previous = snapshot.previous;
    if (previous) for (const [index, cell] of snapshot.journal) if (!previous.has(index)) previous.set(index, cell);
    this.world.journal = previous;
    snapshot.previous = null;
  }

  /** The snapshot is kept on the undo stack. */
  public keepSnapshot(snapshot: Cc3dSnapshot): void {
    snapshot.previous = null;
  }

  /** Puts the world back as it was at the snapshot; `before` is the snapshot that becomes the newest, if any. */
  public restoreSnapshot(snapshot: Cc3dSnapshot, before: Cc3dSnapshot | undefined): void {
    const w = this.world;
    for (const [index, cell] of snapshot.journal) {
      w.cells[index] = cell;
      w.changed.push(index);
    }
    w.tick = snapshot.tick;
    w.steps = snapshot.steps;
    w.fishRemaining = snapshot.fishRemaining;
    w.complete = snapshot.complete;
    w.nextUid = snapshot.nextUid;
    w.rngState = snapshot.rngState;
    w.closing = snapshot.closing;
    w.player = snapshot.player;
    w.mobs = snapshot.mobs;
    reindexMobs(w);
    w.journal = before?.journal ?? null;
    this.pending = null;
  }

  // ------------------------------------------------------------------ tick

  public tickOnce(): void {
    this.report = { tookInput: false, startedStep: false };
    const { world } = this;
    if (this.timeLimitTicks > 0 && world.tick >= this.timeLimitTicks) this.killPlayer('time');
    if (world.player.alive) this.turnOf(world.player);
    const order = [...world.mobs];
    const removalsAtStart = world.removals;
    for (const mob of order) {
      if (!world.player.alive || world.complete) break;
      // A mob removed earlier in this tick does not act any more.
      if (world.removals !== removalsAtStart && !world.mobs.includes(mob)) continue;
      this.turnOf(mob);
    }
    updateDevices(world);
    world.tick += 1;
  }

  private turnOf(actor: Actor): void {
    if (actor.remaining > 0) {
      if (actor.startedTick !== this.world.tick) this.advance(actor);
      return;
    }
    if (actor.kind === 'player') this.decidePlayer(actor);
    else this.decideMob(actor);
  }

  private advance(actor: Actor): void {
    actor.remaining -= 1;
    if (actor.remaining === 0) onArrival(this, actor);
  }

  // -------------------------------------------------------------- deciding

  /**
   * Blocks are only moved by the floor. The monsters of P1 follow the floor
   * first (ice, force floors), else their preference list; the other kinds
   * stand still and kill on contact until P2.
   */
  private decideMob(mob: MobState): void {
    const block = isBlockKind(mob.kind);
    if (mob.floating || (!block && !isSupportedMonster(mob.kind))) return;
    const forced = forcedMoveOf(this.world, mob);
    if (forced) {
      this.forceStep(mob, forced);
      return;
    }
    // Yellow golems never move on their own; their control moves them (cc3dDevices).
    if (block || mob.kind === 'golem_yellow') return;
    if (this.world.tick < mob.restUntilTick) return;
    const dir = chooseMonsterDirection(this, mob);
    if (dir) this.tryStep(mob, dir, 'chosen');
    else this.waitAfterNoMove(mob);
  }

  /**
   * A Snappy or Nibble that finds no direction waits one full normal step before
   * retrying; an Omni whose draw is blocked pays one slow step [U, 07 section 7.9 items 5 and 8].
   */
  private waitAfterNoMove(mob: MobState): void {
    const traits = MONSTER_TRAITS[mob.kind];
    const base = mob.kind === 'omni' ? STEP_TICKS.slow : traits?.restsBetweenSteps ? STEP_TICKS.normal : 0;
    if (base > 0) mob.restUntilTick = this.world.tick + base * speedOrbFactor(this.world);
  }

  private decidePlayer(player: PlayerData): void {
    const forced = forcedMoveOf(this.world, player);
    const wanted = this.pending ?? this.held;
    if (wanted !== null && !inputAllowed(forced, wanted)) this.pending = null;
    if (wanted !== null && inputAllowed(forced, wanted)) {
      this.pending = null;
      this.report.tookInput = true;
      if (this.tryStep(player, wanted, 'chosen')) {
        this.world.steps += 1;
        this.report.startedStep = true;
        this.moves.push(wanted);
        this.timedMoves.push({ tick: this.world.tick, dir: wanted });
        this.events.step(player.x, player.y);
        return;
      }
      if (forced === null) return;
    }
    if (forced) this.forceStep(player, forced);
  }

  /** A forced step; on ice a refused step bounces the slide back the way it came [P]. */
  private forceStep(actor: Actor, forced: ForcedMove): void {
    if (this.tryStep(actor, forced.dir, 'forced')) return;
    actor.exitDir = null;
    if (forced.source !== 'ice') return;
    const back = opposite(forced.dir);
    if (this.tryStep(actor, back, 'forced')) actor.drift = back;
    else actor.drift = null;
  }

  // -------------------------------------------------------------- stepping

  /** Starts a step if the plan allows it; returns whether it started. */
  private tryStep(actor: Actor, dir: Direction, intent: StepIntent): boolean {
    actor.dir = dir;
    const from: Cell = { x: actor.x, y: actor.y };
    let plan = planStep(this.world, actor, from, dir);
    if (!plan.ok) {
      this.refuse(actor, plan);
      return false;
    }
    if (actor.kind === 'player' && openOnEntry(this, actor, neighbour(from, dir))) {
      // The door, dirt, false wall or socket is gone (and the key spent): the layer below may still refuse.
      plan = planStep(this.world, actor, from, dir);
      if (!plan.ok) {
        this.refuse(actor, plan);
        return false;
      }
    }
    if ((plan.hits && actor.kind === 'player') || plan.hitsPlayer) {
      this.killPlayer('monster');
      return true;
    }
    // Steps started by monsters, and blocks they push, are slowed by the speed orb; the player's pushes are not.
    const byMonster = actor.kind !== 'player' && !isBlockKind(actor.kind);
    for (const block of plan.pushes) this.startStep(block, dir, 'pushed', byMonster);
    this.startStep(actor, dir, intent, byMonster);
    this.blockedLatch = false;
    return true;
  }

  private refuse(actor: Actor, plan: StepPlan): void {
    if (plan.bump && (actor.kind === 'player' || isBlockKind(actor.kind))) {
      replaceTop(this.world, plan.bump, { kind: 'wall' });
    }
    if (actor.kind !== 'player' || this.blockedLatch) return;
    this.blockedLatch = true;
    this.events.sound(SFX.blocked);
  }

  /** Leaves the cell and claims the next one; the step then runs its duration. */
  private startStep(actor: Actor, dir: Direction, intent: StepIntent, byMonster: boolean): void {
    onLeave(this.world, actor);
    if (actor.kind === 'omni' && actor.slimed) this.leaveSlime(actor);
    actor.dir = dir;
    const to = neighbour(actor, dir);
    moveActor(this.world, actor, to.x, to.y);
    actor.exitDir = null;
    actor.carried = intent === 'forced';
    actor.chose = intent === 'chosen';
    actor.duration = this.baseTicks(actor, intent) * (byMonster ? speedOrbFactor(this.world) : 1);
    actor.remaining = actor.duration;
    actor.startedTick = this.world.tick;
    this.advance(actor);
  }

  private baseTicks(actor: Actor, intent: StepIntent): number {
    if (intent === 'forced') return STEP_TICKS.fast;
    return actor.kind === 'omni' ? STEP_TICKS.slow : STEP_TICKS.normal;
  }

  /** Omni trail: the cell it leaves turns to slime, but only a bare [floor] cell: no other layer, item or panel [U, 07 section 7.9 item 3]. */
  private leaveSlime(omni: MobState): void {
    const cell = this.world.cells[omni.y * this.world.width + omni.x];
    const bare = cell.terrain.length === 1 && cell.terrain[0].kind === 'floor' && cell.item === null && cell.panels.length === 0;
    if (bare) replaceTop(this.world, omni, { kind: 'slime' });
  }
}
