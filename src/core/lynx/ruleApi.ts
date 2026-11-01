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
import { CompiledLevel, Direction } from '../types';
import { Cell } from './directions';
import { Creature, CreatureKind, DeathCause, ForcedMove, Remains, StepIntent, World } from './model';

/*
 * The extension surface of the Lynx core. A rule module (see rules/index.ts)
 * is a bundle of tile rules, monster rules and phase hooks. The core never
 * names a module; it asks the registry.
 */

/** How a probe of a step behaves. */
export type ProbeMode =
  /** A question only: nothing may change (monster decisions, push tests, teleport landing tests). */
  | 'test'
  /** The step is really attempted in phase C, or a release: tile rules may react (a wall appears). */
  | 'attempt';

/** Which monsters a tile admits. */
export type MonsterAdmission = 'all' | 'none' | readonly string[];

export interface Admission {
  chip: boolean;
  block: boolean;
  monsters: MonsterAdmission;
}

/** Everything a tile rule needs to judge a step. */
export interface StepProbe {
  ctx: RuleContext;
  mover: Creature;
  from: Cell;
  to: Cell;
  dir: Direction;
  intent: StepIntent;
  mode: ProbeMode;
}

/** What happens when a creature of one kind arrives on a tile. */
export type ArrivalEffect = (ctx: RuleContext, creature: Creature) => void;

/** The behaviour of one tile id (the item on the cell if any, else the terrain). */
export interface TileRule {
  /** Who may step in, before the extra checks below. */
  admits: Admission;
  /** Extra restriction on leaving the cell that has this tile. Return false to refuse. */
  mayLeave?: (probe: StepProbe) => boolean;
  /** Extra restriction on entering a cell with this tile. Return false to refuse. */
  mayEnter?: (probe: StepProbe) => boolean;
  /**
   * Chip's refusal by `mayEnter` does not stop a push of a block standing here: the push is
   * judged as if the tile admitted Chip, and `mayEnter` is asked again, as a real attempt,
   * once the block has left (hidden walls).
   */
  yieldsToPush?: boolean;
  /** True when a step into this tile is covered at fast speed (ice, force floors). */
  isFast?: (ctx: RuleContext, mover: Creature) => boolean;
  /** Monsters at rest here keep their facing and draw no random number; blocks here cannot be pushed. */
  confinesCreatures?: boolean;
  /** Effects when a creature of a kind arrives by a step. */
  arrival?: Partial<Record<CreatureKind, ArrivalEffect>>;
}

/** The movement rule of one monster id. */
export interface MonsterRule {
  /** Progress units per tick at normal speed; defaults to the normal speed. */
  unitsPerTick?: number;
  /** The monster is unharmed by water (the glider). */
  survivesWater?: boolean;
  /**
   * Chooses the direction to attempt in phase B, or null to stay at rest this
   * tick. Called only when the monster is at rest and not forced. Use
   * `chooseFirstEnterable` from monsterRules.ts for a list of candidates.
   */
  decide: (ctx: RuleContext, monster: Creature) => Direction | null;
}

export type StepOutcome =
  /** The step began. */
  | 'started'
  /** A leaving or entering rule refused it. */
  | 'refused'
  /** The step began into a collision with Chip: both died. */
  | 'collided';

/** What a module is told after each real attempt to start a step (phase C or a release). */
export interface StepAttempt {
  creature: Creature;
  from: Cell;
  dir: Direction;
  intent: StepIntent;
  outcome: StepOutcome;
}

/** The queries and actions the core offers to rule modules. Implemented by the simulation. */
export interface RuleContext {
  readonly level: CompiledLevel;
  readonly width: number;
  readonly height: number;
  /** The live state. Modules may write `moduleData`, `randomForceDir`, `chipState.stuck`, `creature.data`. */
  readonly world: World;
  /** The number of the tick being played (equals the ticks played before it). */
  readonly tick: number;

  inMap(cell: Cell): boolean;
  /** The tile of a cell: its item if there is one, else its terrain. */
  tileIdAt(x: number, y: number): string;
  tileRuleAt(x: number, y: number): TileRule | undefined;
  monsterRuleOf(type: string): MonsterRule | undefined;
  /** Live creatures in list order (Chip first while he is on the board). */
  creatures(): Creature[];
  remainsList(): Remains[];
  /** The first creature in list order whose logical cell is the cell, Chip included. */
  creatureAt(x: number, y: number): Creature | undefined;
  /** The live monster or block whose logical cell is the cell (Chip never occupies). */
  occupantAt(x: number, y: number): Creature | undefined;
  isAtRest(creature: Creature): boolean;

  setTerrain(x: number, y: number, id: string): void;
  setItem(x: number, y: number, id: string | null): void;
  eraseRemainsAt(x: number, y: number): void;

  /** Would the step be allowed now? Changes nothing. `from` defaults to the creature's cell. */
  canStep(creature: Creature, dir: Direction, from?: Cell): boolean;
  /** Starts a step out of turn (a release); it covers its first units at once. */
  startStep(creature: Creature, dir: Direction, intent: StepIntent): StepOutcome;
  /** Gives the creature one more tick of progress; it may arrive. */
  advance(creature: Creature): void;
  /** Moves a creature to a cell without a step (teleport landing). */
  relocate(creature: Creature, cell: Cell): void;
  /** Adds a creature in the first free place of the list. Returns it, with a fresh uid. */
  spawn(type: string, kind: CreatureKind, cell: Cell, dir: Direction): Creature;
  kill(creature: Creature, cause: DeathCause): void;

  drawWalker(): number;
  drawMainDirection(): Direction;

  emitVisual(kind: VisualEventKind, x: number, y: number, colorKey?: string): void;
  playSfx(id: string): void;
}

/** A module: one area of the rules, kept in its own file under rules/. */
export interface RuleModule {
  readonly name: string;
  readonly tiles?: Readonly<Record<string, TileRule>>;
  readonly monsters?: Readonly<Record<string, MonsterRule>>;

  /** The world is built, creatures placed, no tick played yet. Set up `world.moduleData`. */
  onLoad?: (ctx: RuleContext) => void;
  /** Phase A, after the time-out check. */
  onTickStart?: (ctx: RuleContext) => void;
  /** Phase B: the move this module forces on a creature at rest, or null. Must not change anything. */
  forcedMove?: (ctx: RuleContext, creature: Creature) => ForcedMove | null;
  /** Phase B: the creature received the forced move this module returned (side effects go here). */
  onForcedMove?: (ctx: RuleContext, creature: Creature, forced: ForcedMove) => void;
  /** After every real attempt to start a step, accepted or refused (bounce, slide permission). */
  onStepAttempt?: (ctx: RuleContext, attempt: StepAttempt) => void;
  /** Phase C, right after the turn of a live creature or of remains (brown button holds). */
  onTurnEnd?: (ctx: RuleContext, subject: Creature | Remains) => void;
  /** Phase D (teleports). */
  onMovementEnd?: (ctx: RuleContext) => void;
  /** The trap display; return null when the module does not know the cell. */
  isCellClosedTrap?: (ctx: RuleContext, x: number, y: number) => boolean | null;
}
