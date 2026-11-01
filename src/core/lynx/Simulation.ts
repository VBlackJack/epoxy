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

import { VisualEventKind } from '../PlayEngine';
import { CompiledLevel, Direction, TimedMove } from '../types';
import { Cell, neighbour, sameCell } from './directions';
import { drawMainDirection, drawWalker } from './generators';
import {
  CHIP_PLACE,
  COLOR,
  DEATH_KEY,
  FAST_FLOOR_SPEED_FACTOR,
  FIRST_FORCED_TICK,
  FIRST_SPARE_PLACE,
  NORMAL_UNITS_PER_TICK,
  REMAINS_BASE_TICKS,
  SFX,
  STEP_UNITS
} from './lynxConstants';
import {
  Creature,
  CreatureKind,
  DeathCause,
  ForcedMove,
  Remains,
  StepIntent,
  StepPlan,
  World,
  isCreature,
  isRemains
} from './model';
import { RuleBook } from './ruleBook';
import { MonsterRule, RuleContext, RuleModule, StepOutcome, StepProbe, TileRule } from './ruleApi';
import { newCreature } from './worldBuilder';

/** Where the simulation sends what the player sees and hears. */
export interface SimulationEvents {
  visual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void;
  sound(id: string): void;
  /** Chip began a voluntary step onto the terrain tile; the boots he holds decide hazard steps. */
  step(tileId: string, boots: ReadonlySet<string>): void;
}

/** What happened to Chip's input during the last tick (the engine decides about undo snapshots). */
export interface TickReport {
  chipTookInput: boolean;
  chipStartedStep: boolean;
}

/** The verdict on a step, with the block Chip would push when there is one. */
type StepAnalysis =
  | { allowed: true; block: Creature | null }
  | { allowed: false; pushRefusedBy: Creature | null };

const REFUSED: StepAnalysis = { allowed: false, pushRefusedBy: null };
const ALLOWED: StepAnalysis = { allowed: true, block: null };

const DEATH_REASON: Record<DeathCause, string> = {
  drown: DEATH_KEY.water,
  burn: DEATH_KEY.fire,
  bomb: DEATH_KEY.bomb,
  monster: DEATH_KEY.monster,
  block: DEATH_KEY.block,
  timeout: DEATH_KEY.time
};

/**
 * Plays ticks over a World (spec section 4). It also is the RuleContext the
 * rule modules work through. The world is plain data, replaced wholesale on undo.
 */
export class Simulation implements RuleContext {
  public world: World;
  /** The one direction the player asked for and Chip has not taken yet. */
  public pending: Direction | null = null;
  /** The direction the player holds down right now; Chip reads it only at a moment he can decide. */
  public held: Direction | null = null;
  public readonly moves: Direction[] = [];
  public readonly timedMoves: TimedMove[] = [];
  public report: TickReport = { chipTookInput: false, chipStartedStep: false };
  /** Phase A deaths are counted down in their own tick. */
  private inStartPhase = false;

  constructor(
    public readonly level: CompiledLevel,
    world: World,
    private readonly book: RuleBook,
    private readonly events: SimulationEvents,
    private readonly ticksPerSecond: number
  ) {
    this.world = world;
  }

  // ---------------------------------------------------------------- queries

  public get width(): number {
    return this.world.terrain[0]?.length ?? 0;
  }

  public get height(): number {
    return this.world.terrain.length;
  }

  public get tick(): number {
    return this.world.tick;
  }

  public inMap(cell: Cell): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
  }

  public tileIdAt(x: number, y: number): string {
    return this.world.items[y][x] ?? this.world.terrain[y][x];
  }

  public tileRuleAt(x: number, y: number): TileRule | undefined {
    return this.inMap({ x, y }) ? this.book.tiles.get(this.tileIdAt(x, y)) : undefined;
  }

  public monsterRuleOf(type: string): MonsterRule | undefined {
    return this.book.monsters.get(type);
  }

  public creatures(): Creature[] {
    return this.world.slots.filter(isCreature).filter((c) => c.kind !== 'chip' || this.chipOnBoard());
  }

  public remainsList(): Remains[] {
    return this.world.slots.filter(isRemains);
  }

  public creatureAt(x: number, y: number): Creature | undefined {
    return this.creatures().find((c) => c.x === x && c.y === y);
  }

  public occupantAt(x: number, y: number): Creature | undefined {
    return this.world.slots.filter(isCreature).find((c) => c.kind !== 'chip' && c.x === x && c.y === y);
  }

  public isAtRest(creature: Creature): boolean {
    return creature.remaining === 0;
  }

  public chipOnBoard(): boolean {
    return this.world.chipState.alive && !this.world.chipState.exited;
  }

  /** The forced move Chip would receive in the next tick, ignoring his own input. Changes nothing. */
  public forcedMoveOf(creature: Creature): { forced: ForcedMove; source: RuleModule } | null {
    if (this.world.tick < FIRST_FORCED_TICK) return null;
    if (creature.kind === 'chip' && this.world.chipState.stuck) return null;
    for (const module of this.book.modules) {
      const forced = module.forcedMove?.(this, creature);
      if (forced) return { forced, source: module };
    }
    return null;
  }

  /** True when Chip would take a direction in the next tick. */
  public chipCanTakeInput(): boolean {
    const { chip, chipState } = this.world;
    if (!this.chipOnBoard() || chipState.stuck || chip.remaining > 0) return false;
    const forced = this.forcedMoveOf(chip);
    return forced === null || forced.forced.chipMayChoose;
  }

  // -------------------------------------------------------------- mutations

  public setTerrain(x: number, y: number, id: string): void {
    this.world.terrain[y][x] = id;
  }

  public setItem(x: number, y: number, id: string | null): void {
    this.world.items[y][x] = id;
  }

  public eraseRemainsAt(x: number, y: number): void {
    const { slots } = this.world;
    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i];
      if (isRemains(slot) && slot.x === x && slot.y === y) this.freePlace(i);
    }
  }

  public relocate(creature: Creature, cell: Cell): void {
    creature.x = cell.x;
    creature.y = cell.y;
  }

  public spawn(type: string, kind: CreatureKind, cell: Cell, dir: Direction): Creature {
    const world = this.world;
    const created = newCreature(world.nextUid++, kind, type, cell.x, cell.y, dir);
    const free = world.slots.findIndex((slot, i) => i >= FIRST_SPARE_PLACE && slot === null);
    if (free >= 0) world.slots[free] = created;
    else world.slots.push(created);
    return created;
  }

  public drawWalker(): number {
    return drawWalker(this.world.walker);
  }

  public drawMainDirection(): Direction {
    return drawMainDirection(this.world.main);
  }

  public emitVisual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void {
    this.events.visual(kind, x, y, colorKey);
  }

  public playSfx(id: string): void {
    this.events.sound(id);
  }

  public capture(): World {
    return structuredClone(this.world);
  }

  public restore(world: World): void {
    this.world = world;
    this.pending = null;
  }

  // ------------------------------------------------------------------ tick

  /** Plays one tick: phases A to E of spec section 4. */
  public tickOnce(): void {
    this.beginTick();
    this.phaseStart();
    this.phaseDecisions();
    this.phaseMovement();
    for (const module of this.book.modules) module.onMovementEnd?.(this);
    this.endTick();
  }

  private beginTick(): void {
    const world = this.world;
    for (const slot of world.slots) {
      if (!isCreature(slot)) continue;
      slot.sliding = false;
      slot.plan = null;
      slot.forced = null;
    }
    world.monsterStarts = [];
    world.chipTarget = null;
    world.chipState.attemptedThisTick = false;
    this.report = { chipTookInput: false, chipStartedStep: false };
  }

  private endTick(): void {
    const { chipState } = this.world;
    if (!chipState.attemptedThisTick) chipState.blockedLatch = false;
    this.world.tick += 1;
  }

  // --------------------------------------------------------------- phase A

  private phaseStart(): void {
    const limit = this.level.timeLimitSeconds;
    if (limit > 0 && this.world.tick >= limit * this.ticksPerSecond && this.chipOnBoard()) {
      this.inStartPhase = true;
      this.killAt(this.world.chip, 'timeout', this.world.chip);
      this.inStartPhase = false;
    }
    for (const module of this.book.modules) module.onTickStart?.(this);
  }

  // --------------------------------------------------------------- phase B

  private phaseDecisions(): void {
    const { slots } = this.world;
    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i];
      if (slot === null) continue;
      if (isRemains(slot)) {
        if (this.world.tick >= slot.vanishTick) this.freePlace(i);
      } else if (slot.kind === 'chip') {
        this.decideChip();
      } else {
        this.decide(slot);
      }
    }
  }

  /** Asks the modules for a forced move and tells the one that gave it. */
  private takeForcedMove(creature: Creature): ForcedMove | null {
    const found = this.forcedMoveOf(creature);
    if (found === null) return null;
    found.source.onForcedMove?.(this, creature, found.forced);
    creature.forced = found.forced;
    return found.forced;
  }

  private decide(creature: Creature): void {
    if (creature.remaining > 0) return;
    const forced = this.takeForcedMove(creature);
    if (forced) {
      creature.plan = { dir: forced.dir, intent: forced.intent };
      return;
    }
    if (creature.kind !== 'monster') return;
    if (this.tileRuleAt(creature.x, creature.y)?.confinesCreatures) {
      creature.plan = { dir: creature.dir, intent: 'chosen' };
      return;
    }
    const dir = this.book.monsters.get(creature.type)?.decide(this, creature) ?? null;
    if (dir !== null) creature.plan = { dir, intent: 'chosen' };
  }

  private decideChip(): void {
    const { chip, chipState, tick } = this.world;
    if (!this.chipOnBoard()) return;
    if (chipState.stuck) {
      this.pending = null;
      return;
    }
    if (chip.remaining > 0) return;
    const forced = this.takeForcedMove(chip);
    const wanted = this.pending ?? this.held;
    if (wanted !== null && (forced === null || forced.chipMayChoose)) {
      const dir = wanted;
      this.pending = null;
      this.moves.push(dir);
      this.timedMoves.push({ tick, dir });
      this.report.chipTookInput = true;
      chip.plan = { dir, intent: 'chosen' };
      this.world.chipTarget = neighbour(chip, dir);
      this.preparePush(dir);
    } else if (forced) {
      chip.plan = { dir: forced.dir, intent: forced.intent };
    }
  }

  /** Chip chose a direction that points at a block: the block moves first, in its own turn. */
  private preparePush(dir: Direction): void {
    const { chip, chipTarget } = this.world;
    if (chipTarget === null) return;
    const block = this.blockAt(chipTarget);
    if (block === null) return;
    const verdict = this.analyze(chip, chip, dir, 'chosen', 'test', true);
    if (verdict.allowed) {
      block.dir = dir;
      block.plan = { dir, intent: 'pushed' };
    } else if (verdict.pushRefusedBy !== null && block.remaining === 0) {
      block.dir = dir;
    }
  }

  // --------------------------------------------------------------- phase C

  private phaseMovement(): void {
    const { slots } = this.world;
    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i];
      if (slot === null) continue;
      if (isRemains(slot)) {
        this.endTurn(slot);
        continue;
      }
      if (slot.kind === 'chip' && !this.chipOnBoard()) continue;
      this.takeTurn(slot);
      if (this.world.slots[i] === slot) this.endTurn(slot);
    }
  }

  private endTurn(subject: Creature | Remains): void {
    for (const module of this.book.modules) module.onTurnEnd?.(this, subject);
  }

  private takeTurn(creature: Creature): void {
    if (creature.remaining > 0) {
      this.advance(creature);
      return;
    }
    const plan = creature.plan;
    if (plan === null) return;
    creature.plan = null;
    if (creature.kind === 'chip') this.world.chipState.attemptedThisTick = true;
    this.beginStep(creature, plan);
  }

  public advance(creature: Creature): void {
    creature.remaining = Math.max(0, creature.remaining - creature.unitsPerTick);
    if (creature.carried) creature.sliding = true;
    if (creature.remaining === 0) this.arrive(creature);
  }

  private arrive(creature: Creature): void {
    this.tileRuleAt(creature.x, creature.y)?.arrival?.[creature.kind]?.(this, creature);
  }

  // ---------------------------------------------------------- starting steps

  public startStep(creature: Creature, dir: Direction, intent: StepIntent): StepOutcome {
    return this.beginStep(creature, { dir, intent });
  }

  public canStep(creature: Creature, dir: Direction, from?: Cell): boolean {
    return this.analyze(creature, from ?? creature, dir, 'chosen', 'test').allowed;
  }

  private beginStep(creature: Creature, plan: StepPlan): StepOutcome {
    const from: Cell = { x: creature.x, y: creature.y };
    creature.dir = plan.dir;
    const outcome = this.resolveStep(creature, plan, from);
    const attempt = { creature, from, dir: plan.dir, intent: plan.intent, outcome };
    for (const module of this.book.modules) module.onStepAttempt?.(this, attempt);
    if (creature.kind === 'chip' && plan.intent === 'chosen' && outcome !== 'refused') {
      this.report.chipStartedStep = true;
    }
    return outcome;
  }

  private resolveStep(creature: Creature, plan: StepPlan, from: Cell): StepOutcome {
    const verdict = this.analyze(creature, from, plan.dir, plan.intent, 'attempt');
    if (!verdict.allowed) {
      const blocker = verdict.pushRefusedBy;
      if (blocker && blocker.remaining === 0) blocker.dir = plan.dir;
      this.refuse(creature);
      return 'refused';
    }
    const to = neighbour(from, plan.dir);
    return creature.kind === 'chip'
      ? this.chipStep(creature, plan, from, to, verdict.block)
      : this.otherStep(creature, plan, from, to);
  }

  private refuse(creature: Creature): void {
    if (creature.kind !== 'chip') return;
    const { chipState } = this.world;
    if (chipState.blockedLatch) return;
    chipState.blockedLatch = true;
    this.events.sound(SFX.blocked);
  }

  private chipStep(chip: Creature, plan: StepPlan, from: Cell, to: Cell, block: Creature | null): StepOutcome {
    // The push is settled first: a collision only counts when Chip's step is otherwise allowed (spec 7.1).
    if (block && this.beginStep(block, { dir: plan.dir, intent: 'pushed' }) === 'refused') {
      this.refuse(chip);
      return 'refused';
    }
    if (block && this.refusedAfterPush(chip, plan, from, to)) {
      this.refuse(chip);
      return 'refused';
    }
    const standing = this.occupantAt(to.x, to.y);
    if (standing && standing.kind === 'monster') {
      this.collide(standing, 'monster', from, standing);
      return 'collided';
    }
    if (plan.intent === 'chosen') {
      const pulledBack = this.monsterThatLeft(to);
      if (pulledBack) {
        // Pulled back to the cell it started from: its remains count as at rest there.
        pulledBack.remaining = 0;
        this.collide(pulledBack, 'monster', from, to);
        return 'collided';
      }
    }
    this.world.steps += 1;
    this.world.chipState.blockedLatch = false;
    this.commitStep(chip, plan, from, to);
    // Only a step Chip chooses sounds; forced moves (ice, force floors, teleport exits) stay silent, as in the classic engine.
    if (plan.intent === 'chosen') this.events.step(this.world.terrain[to.y][to.x], this.world.chipState.boots);
    return 'started';
  }

  /** Whether the tile the pushed block left still refuses Chip, asked as a real attempt (spec 8). */
  private refusedAfterPush(chip: Creature, plan: StepPlan, from: Cell, to: Cell): boolean {
    const entering = this.tileRuleAt(to.x, to.y);
    if (!entering?.yieldsToPush || !entering.mayEnter) return false;
    const probe: StepProbe = { ctx: this, mover: chip, from, to, dir: plan.dir, intent: plan.intent, mode: 'attempt' };
    return !entering.mayEnter(probe);
  }

  /** The monster that started a step out of the cell earlier in this tick, if it is still alive. */
  private monsterThatLeft(cell: Cell): Creature | null {
    const start = this.world.monsterStarts.find((s) => sameCell(s.from, cell));
    if (!start) return null;
    return this.world.slots.filter(isCreature).find((c) => c.uid === start.uid && c.kind === 'monster') ?? null;
  }

  /** Chip and a monster die together. Chip's remains stay at `chipAt`, the monster's at `monsterAt`. */
  private collide(monster: Creature, cause: DeathCause, chipAt: Cell, monsterAt: Cell): void {
    this.killAt(this.world.chip, cause, chipAt);
    this.killAt(monster, cause, monsterAt);
  }

  private otherStep(creature: Creature, plan: StepPlan, from: Cell, to: Cell): StepOutcome {
    const { chip } = this.world;
    if (this.chipOnBoard() && chip.x === to.x && chip.y === to.y) {
      const cause: DeathCause = creature.kind === 'block' ? 'block' : 'monster';
      this.killAt(chip, cause, chip);
      this.killAt(creature, cause, from);
      return 'collided';
    }
    this.eraseRemainsAt(to.x, to.y);
    this.commitStep(creature, plan, from, to);
    return 'started';
  }

  private commitStep(creature: Creature, plan: StepPlan, from: Cell, to: Cell): void {
    creature.x = to.x;
    creature.y = to.y;
    creature.remaining = STEP_UNITS;
    creature.carried = plan.intent === 'carried';
    creature.unitsPerTick = this.speedOf(creature, to);
    if (creature.kind === 'monster') this.world.monsterStarts.push({ uid: creature.uid, from });
    this.advance(creature);
  }

  private speedOf(creature: Creature, destination: Cell): number {
    const base =
      creature.kind === 'monster'
        ? (this.book.monsters.get(creature.type)?.unitsPerTick ?? NORMAL_UNITS_PER_TICK)
        : NORMAL_UNITS_PER_TICK;
    const fast = this.tileRuleAt(destination.x, destination.y)?.isFast?.(this, creature) ?? false;
    return fast ? base * FAST_FLOOR_SPEED_FACTOR : base;
  }

  // ------------------------------------------------------------- step rules

  /** The live block whose logical cell is the cell. */
  private blockAt(cell: Cell): Creature | null {
    const found = this.occupantAt(cell.x, cell.y);
    return found && found.kind === 'block' ? found : null;
  }

  private remainsAt(cell: Cell): boolean {
    return this.world.slots.some((s) => isRemains(s) && s.x === cell.x && s.y === cell.y);
  }

  private admits(rule: TileRule, creature: Creature): boolean {
    if (creature.kind === 'chip') return rule.admits.chip;
    if (creature.kind === 'block') return rule.admits.block;
    const { monsters } = rule.admits;
    return monsters === 'all' || (monsters !== 'none' && monsters.includes(creature.type));
  }

  /** Applies the leaving rules, the entering rules, occupation, remains and pushing (spec 6.2 to 6.4, 8). */
  private analyze(
    creature: Creature,
    from: Cell,
    dir: Direction,
    intent: StepIntent,
    mode: StepProbe['mode'],
    preparesPush = false
  ): StepAnalysis {
    const to = neighbour(from, dir);
    if (!this.inMap(to)) return REFUSED;
    const probe: StepProbe = { ctx: this, mover: creature, from: { x: from.x, y: from.y }, to, dir, intent, mode };
    const leaving = this.tileRuleAt(from.x, from.y);
    if (leaving?.mayLeave && !leaving.mayLeave(probe)) return REFUSED;
    const entering = this.tileRuleAt(to.x, to.y);
    if (!entering || !this.admits(entering, creature)) return REFUSED;
    // Only Chip's real step and the decision that prepares his push yield to a block; landing tests do not.
    const mayYield = mode === 'attempt' || preparesPush;
    const yieldsToBlock =
      mayYield && creature.kind === 'chip' && entering.yieldsToPush === true && this.blockAt(to) !== null;
    if (entering.mayEnter && !yieldsToBlock && !entering.mayEnter(probe)) return REFUSED;
    if (creature.kind === 'chip') return this.analyzeChipEntry(to, dir);
    if (creature.remaining > 0 || this.occupiedByAnother(creature, to)) return REFUSED;
    return ALLOWED;
  }

  /** The mover itself never counts: when it tests a step from another cell, it has left its own. */
  private occupiedByAnother(mover: Creature, cell: Cell): boolean {
    const occupant = this.occupantAt(cell.x, cell.y);
    return occupant !== undefined && occupant !== mover;
  }

  private analyzeChipEntry(to: Cell, dir: Direction): StepAnalysis {
    if (this.remainsAt(to)) return REFUSED;
    const block = this.blockAt(to);
    if (block === null) return ALLOWED;
    return this.canPush(block, dir) ? { allowed: true, block } : { allowed: false, pushRefusedBy: block };
  }

  private canPush(block: Creature, dir: Direction): boolean {
    if (block.remaining > 0) return false;
    if (this.tileRuleAt(block.x, block.y)?.confinesCreatures) return false;
    return this.analyze(block, block, dir, 'pushed', 'test').allowed;
  }

  // ----------------------------------------------------------------- deaths

  public kill(creature: Creature, cause: DeathCause): void {
    this.killAt(creature, cause, creature);
  }

  private vanishTickOfNewRemains(): number {
    const { tick, phaseOffset } = this.world;
    const odd = (tick + phaseOffset) % 2 === 1 ? 1 : 0;
    return tick + REMAINS_BASE_TICKS + odd - (this.inStartPhase ? 1 : 0);
  }

  /** Kills a creature; its remains appear at `at` and take its place in the list. */
  private killAt(creature: Creature, cause: DeathCause, at: Cell): void {
    const isChip = creature.kind === 'chip';
    const { chipState, slots } = this.world;
    if (isChip) {
      if (!chipState.alive) return;
      chipState.alive = false;
      chipState.deathReasonKey = DEATH_REASON[cause];
    }
    const form = cause === 'drown' ? 'splash' : 'explosion';
    const remains: Remains = {
      kind: 'remains',
      form,
      x: at.x,
      y: at.y,
      vanishTick: this.vanishTickOfNewRemains(),
      atRest: creature.remaining === 0
    };
    const place = slots.indexOf(creature);
    if (place >= 0) slots[place] = remains;
    creature.x = at.x;
    creature.y = at.y;
    this.events.visual(form, at.x, at.y, isChip && form === 'explosion' ? COLOR.chipDeath : undefined);
    this.deathSound(cause, isChip);
  }

  private deathSound(cause: DeathCause, isChip: boolean): void {
    if (cause === 'drown') this.events.sound(SFX.splash);
    else if (cause === 'bomb') this.events.sound(SFX.bomb);
    else if (cause === 'burn') this.events.sound(SFX.burn);
    else if (isChip && cause !== 'timeout') this.events.sound(SFX.death);
  }

  // ------------------------------------------------------------------ places

  /** A place becomes free; the very last place is removed from the list instead. */
  private freePlace(index: number): void {
    const { slots } = this.world;
    if (index === slots.length - 1 && index !== CHIP_PLACE) slots.pop();
    else slots[index] = null;
  }
}
