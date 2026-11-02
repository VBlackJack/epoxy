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

export type Hazard = 'ice' | 'force' | 'water' | 'fire';

export interface MonsterTraits {
  /** Hazards the monster is unaffected by. Water and fire immunity also lets it enter them. */
  immunities: readonly Hazard[];
  /** Whether it presses plates and trap controls (blinky does not [U], screamer is unaffected by switches). */
  pressesPlates: boolean;
  /** Whether it flips toggles, works clone switches and golem controls. */
  triggersSwitches: boolean;
  /** Melts the ice blocks it touches. */
  meltsIce: boolean;
}

const BLINKY_TRAITS: MonsterTraits = {
  immunities: ['water', 'ice', 'force'],
  pressesPlates: false,
  triggersSwitches: true,
  meltsIce: false
};

const SCREAMER_TRAITS: MonsterTraits = {
  immunities: ['fire', 'ice', 'force'],
  pressesPlates: false,
  triggersSwitches: false,
  meltsIce: true
};

const PLAIN_TRAITS: MonsterTraits = { immunities: [], pressesPlates: true, triggersSwitches: true, meltsIce: false };

/** Monsters the engine plays since lot C2. The others (P2, P3) stand still and kill on contact. */
export const MONSTER_TRAITS: Partial<Record<Cc3dMobKind, MonsterTraits>> = {
  walker: PLAIN_TRAITS,
  limpa: PLAIN_TRAITS,
  limpy: PLAIN_TRAITS,
  bouncer: PLAIN_TRAITS,
  golem_blue: PLAIN_TRAITS,
  blinky: BLINKY_TRAITS,
  baby_blinky: { ...PLAIN_TRAITS, immunities: ['water'] },
  screamer: SCREAMER_TRAITS,
  baby_screamer: { ...PLAIN_TRAITS, immunities: ['fire'], meltsIce: true }
};

export function isSupportedMonster(kind: Cc3dMobKind): boolean {
  return MONSTER_TRAITS[kind] !== undefined;
}

/** Terrain no monster of P1 enters, on its own will [U genre default]. */
export const TERRAIN_REFUSED_BY_MONSTERS: readonly Cc3dTerrainKind[] = [
  'gravel',
  'sand',
  'dirt',
  'slime',
  'bomb',
  'exit'
];
