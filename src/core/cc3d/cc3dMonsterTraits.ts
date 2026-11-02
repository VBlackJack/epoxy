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

import type { Cc3dMobKind, Cc3dTerrainKind } from './model';

/**
 * One table for what each monster of P1 is immune to, what it presses and
 * which terrain it refuses (02 section 2.6; the refusals are the genre default
 * [U]: the spec leaves open which monsters gravel, sand, dirt and fire stop).
 */

export type Hazard = 'ice' | 'force' | 'water' | 'fire' | 'slime';

export interface MonsterTraits {
  /** Hazards the monster is unaffected by. Water and fire immunity also lets it enter them. */
  immunities: readonly Hazard[];
  /** Whether it presses plates and trap controls (blinky does not [U], screamer is unaffected by switches). */
  pressesPlates: boolean;
  /** Whether it flips toggles, works clone switches and golem controls. */
  triggersSwitches: boolean;
  /** Melts the ice blocks it touches. */
  meltsIce: boolean;
  /** Decides only every other step: a step's worth of rest after each chosen step (Snappy, Nibble) [U, 07 section 7.1]. */
  restsBetweenSteps: boolean;
  /** Terrain it may enter although monsters refuse it by default (yellow golems: sand, water, fire, slime). */
  entersTerrain: readonly Cc3dTerrainKind[];
  /** Leaving a turtle does not sink it (both blinkies) [S, 10 item 5]. */
  crossesTurtles: boolean;
}

const PLAIN_TRAITS: MonsterTraits = {
  immunities: [],
  pressesPlates: true,
  triggersSwitches: true,
  meltsIce: false,
  restsBetweenSteps: false,
  entersTerrain: [],
  crossesTurtles: false
};

const BLINKY_TRAITS: MonsterTraits = {
  ...PLAIN_TRAITS,
  immunities: ['water', 'ice', 'force'],
  pressesPlates: false,
  triggersSwitches: false,
  crossesTurtles: true
};

const SCREAMER_TRAITS: MonsterTraits = {
  ...PLAIN_TRAITS,
  immunities: ['fire', 'ice', 'force'],
  pressesPlates: false,
  triggersSwitches: false,
  meltsIce: true
};


/** Monsters the engine plays since lot C2. The others (P2, P3) stand still and kill on contact. */
export const MONSTER_TRAITS: Partial<Record<Cc3dMobKind, MonsterTraits>> = {
  walker: PLAIN_TRAITS,
  limpa: PLAIN_TRAITS,
  limpy: PLAIN_TRAITS,
  bouncer: PLAIN_TRAITS,
  golem_blue: PLAIN_TRAITS,
  blinky: BLINKY_TRAITS,
  baby_blinky: { ...PLAIN_TRAITS, immunities: ['water'], crossesTurtles: true },
  screamer: SCREAMER_TRAITS,
  baby_screamer: { ...PLAIN_TRAITS, immunities: ['fire'], meltsIce: true },
  // P2 (07-p2-decisions): one row per kind.
  snappy: { ...PLAIN_TRAITS, restsBetweenSteps: true },
  nibble: { ...PLAIN_TRAITS, restsBetweenSteps: true },
  // Legs: plate-driven pattern switching is an open play question; only the base patterns exist (07 section 7.5).
  legs_green: PLAIN_TRAITS,
  legs_red: PLAIN_TRAITS,
  omni: { ...PLAIN_TRAITS, immunities: ['slime'] },
  // Yellow golems are never carried by ice or force floors and may enter sand; dirt and gravel stop them [S, 10 item 6].
  // They also walk into water, fire and slime and are lost there, having no immunity [P water, U fire and slime; 07 section 7.11].
  golem_yellow: { ...PLAIN_TRAITS, immunities: ['ice', 'force'], entersTerrain: ['sand', 'water', 'fire', 'slime'] }
};

export function isSupportedMonster(kind: Cc3dMobKind): boolean {
  return MONSTER_TRAITS[kind] !== undefined;
}

/**
 * Terrain every monster refuses [S, 10 item 7]: dirt, gravel, sand (yellow golem excepted), slime (Omni excepted),
 * both security gates and the exit. Fire and water need the matching immunity; cells holding an item are refused
 * in the admission rule. A bomb is no longer refused: any mob may enter it, and both are gone [10 item 20].
 */
export const TERRAIN_REFUSED_BY_MONSTERS: readonly Cc3dTerrainKind[] = [
  'gravel',
  'sand',
  'dirt',
  'slime',
  'exit',
  'gate_tools',
  'gate_keys'
];
