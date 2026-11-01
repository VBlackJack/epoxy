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

import { Direction } from '../types';
import { Cell } from './directions';
import { MainGeneratorState, WalkerGeneratorState } from './generators';

/**
 * The state of a Lynx play. It holds plain data only (no classes, no
 * functions), so an undo snapshot is one structuredClone of the world.
 */

export type CreatureKind = 'chip' | 'block' | 'monster';

/** Why a creature starts a step. The rules for leaving and entering can depend on it. */
export type StepIntent =
  /** Chip's own input, a monster's own rule, or a block pushed by Chip's decision. */
  | 'chosen'
  /** Carried by ice or a force floor. */
  | 'carried'
  /** Forced out of a teleport after landing. */
  | 'teleportExit'
  /** Let out of a trap or a clone machine. */
  | 'released'
  /** A block pushed by Chip. */
  | 'pushed';

/** The intents a forced move can have. */
export type ForcedIntent = Extract<StepIntent, 'carried' | 'teleportExit'>;

export interface StepPlan {
  dir: Direction;
  intent: StepIntent;
}

/** A move a creature at rest is forced into this tick (never in tick 0). */
export interface ForcedMove {
  dir: Direction;
  intent: ForcedIntent;
  /** True when Chip may choose another direction instead (force floor with the slide permission). */
  chipMayChoose: boolean;
}

export interface Creature {
  /** Positive and stable for the creature's whole life; 0 for Chip, who is never listed. */
  uid: number;
  kind: CreatureKind;
  /** 'chip', 'dirt_block' or a monster id. */
  type: string;
  /** Logical cell: the cell it stands on, or the destination of the step in progress. */
  x: number;
  y: number;
  dir: Direction;
  /** Units left to cover in the step in progress; 0 when at rest. */
  remaining: number;
  /** Units covered per tick by the step in progress. */
  unitsPerTick: number;
  /** The step in progress was started by ice or a force floor. */
  carried: boolean;
  /** Shown to the renderer: progressed in a carried step during the last tick. */
  sliding: boolean;
  /** What it will attempt in phase C of this tick. */
  plan: StepPlan | null;
  /** The forced move received in phase B of this tick, if any. */
  forced: ForcedMove | null;
  /** Free numeric storage for rule modules (a tank mark, a teleported flag, a slide permission...). */
  data: Record<string, number>;
}

export type RemainsForm = 'splash' | 'explosion';

/** What a dead creature leaves for a short time. Not a creature; keeps its place in the list. */
export interface Remains {
  kind: 'remains';
  form: RemainsForm;
  x: number;
  y: number;
  /** Phase B of this tick removes the remains. */
  vanishTick: number;
  /** The creature was at rest when it died (only such remains hold a brown button). */
  atRest: boolean;
}

/** A place of the creature list: a creature, remains, or free. */
export type Slot = Creature | Remains | null;

export type DeathCause = 'drown' | 'burn' | 'bomb' | 'monster' | 'block' | 'timeout';

export interface ChipState {
  alive: boolean;
  deathReasonKey: string | null;
  exited: boolean;
  /** No landing was found on a teleport: Chip never moves again. */
  stuck: boolean;
  keys: Record<string, number>;
  boots: Set<string>;
  /** The `blocked` sound already played and no re-arming tick has come since. */
  blockedLatch: boolean;
  /** Chip attempted a step during the current tick. */
  attemptedThisTick: boolean;
}

/** A monster that started a step in the current tick, noted for the vacated-cell rule. */
export interface MonsterStart {
  uid: number;
  from: Cell;
}

export interface World {
  tick: number;
  terrain: string[][];
  items: (string | null)[][];
  /** The creature list. Place 0 is Chip's. Processing goes from the last place to the first. */
  slots: Slot[];
  chip: Creature;
  chipState: ChipState;
  chipsRemaining: number;
  complete: boolean;
  /** The direction shared by every random force floor. */
  randomForceDir: Direction;
  walker: WalkerGeneratorState;
  main: MainGeneratorState;
  phaseOffset: number;
  nextUid: number;
  steps: number;
  /** Cell in front of Chip when he chose his direction this tick. */
  chipTarget: Cell | null;
  monsterStarts: MonsterStart[];
  /** Free storage for rule modules, keyed by module name. Must stay structuredClone-able. */
  moduleData: Record<string, unknown>;
}

export function isRemains(slot: Slot): slot is Remains {
  return slot !== null && slot.kind === 'remains';
}

export function isCreature(slot: Slot): slot is Creature {
  return slot !== null && slot.kind !== 'remains';
}
