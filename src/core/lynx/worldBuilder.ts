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

import { CompiledLevel, Direction } from '../types';
import { newMainGenerator, newWalkerGenerator } from './generators';
import { CHIP_START_FACING, ENTITY } from './lynxConstants';
import { ChipState, Creature, CreatureKind, World } from './model';
import { RuleBook } from './ruleBook';

/** Settings that only a replay harness changes. Normal play uses the defaults. */
export interface ReplayOptions {
  /** 0 to 7: shifts the teeth cadence and the remains duration. */
  phaseOffset?: number;
  /** Starting direction of the random force floors. */
  randomForceStart?: Direction;
}

export const DEFAULT_RANDOM_FORCE_START: Direction = 'N';

const KEY_COLORS = ['key_red', 'key_blue', 'key_yellow', 'key_green'] as const;

export interface BuiltWorld {
  world: World;
  /** Sorted distinct ids that play as walls or were left out of play. */
  unsupported: string[];
}

export function newCreature(uid: number, kind: CreatureKind, type: string, x: number, y: number, dir: Direction): Creature {
  return {
    uid,
    kind,
    type,
    x,
    y,
    dir,
    remaining: 0,
    unitsPerTick: 0,
    carried: false,
    sliding: false,
    plan: null,
    forced: null,
    data: {}
  };
}

function newChipState(): ChipState {
  return {
    alive: true,
    deathReasonKey: null,
    exited: false,
    stuck: false,
    keys: Object.fromEntries(KEY_COLORS.map((id) => [id, 0])),
    boots: new Set<string>(),
    blockedLatch: false,
    attemptedThisTick: false
  };
}

function collectUnsupported(level: CompiledLevel, book: RuleBook): Set<string> {
  const found = new Set<string>();
  for (const grid of [level.terrain, level.items]) {
    for (const row of grid) {
      for (const id of row) if (id !== null && !book.tiles.has(id)) found.add(id);
    }
  }
  return found;
}

/** Builds the world of a level (spec section 16) with the creature list ordered (section 3). */
export function buildWorld(level: CompiledLevel, book: RuleBook, seed: number, options: ReplayOptions): BuiltWorld {
  const terrain = level.terrain.map((row) => [...row]);
  const items = terrain.map((row, y) => row.map((_, x) => level.items[y]?.[x] ?? null));
  const width = terrain[0]?.length ?? 0;
  const unsupported = collectUnsupported(level, book);

  const chip = newCreature(0, 'chip', 'chip', level.playerStart.x, level.playerStart.y, CHIP_START_FACING);
  const placed: Creature[] = [chip];
  for (const entity of level.entities) {
    const inMap = terrain[entity.y]?.[entity.x] !== undefined;
    const kind: CreatureKind | null =
      entity.type === ENTITY.block ? 'block' : book.monsters.has(entity.type) ? 'monster' : null;
    if (kind === null) unsupported.add(entity.type);
    else if (inMap) placed.push(newCreature(0, kind, entity.type, entity.x, entity.y, entity.dir));
  }

  const inReadingOrder = placed
    .map((creature, index) => ({ creature, index }))
    .sort((a, b) => a.creature.y * width + a.creature.x - (b.creature.y * width + b.creature.x) || a.index - b.index)
    .map((entry) => entry.creature);
  const chipPlace = inReadingOrder.indexOf(chip);
  [inReadingOrder[0], inReadingOrder[chipPlace]] = [inReadingOrder[chipPlace], inReadingOrder[0]];

  let nextUid = 1;
  for (const creature of inReadingOrder) if (creature !== chip) creature.uid = nextUid++;

  const world: World = {
    tick: 0,
    terrain,
    items,
    slots: inReadingOrder,
    chip,
    chipState: newChipState(),
    chipsRemaining: level.chipsRequired,
    complete: false,
    randomForceDir: options.randomForceStart ?? DEFAULT_RANDOM_FORCE_START,
    walker: newWalkerGenerator(),
    main: newMainGenerator(seed),
    phaseOffset: options.phaseOffset ?? 0,
    nextUid,
    steps: 0,
    chipTarget: null,
    monsterStarts: [],
    moduleData: {}
  };
  return { world, unsupported: [...unsupported].sort() };
}
