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

/**
 * Optional looks of the player character. A skin only changes how the player is drawn: the
 * sprite name for the sprite styles, the vector drawing for HD Neon, the character for Runeward.
 * The Runeward skins draw only in the Runeward style: in every other style they look like the default
 * skin, and the default skin is the mage in Runeward. Pure module: no DOM.
 */

import type { RunewardCharacterId } from './styles/runeward/runewardCharacter';

/** Every skin the player can pick, the default first. */
export const PLAYER_SKIN_IDS = ['default', 'julien', 'runeward_scribe', 'runeward_adventurer'] as const;
export type PlayerSkinId = (typeof PLAYER_SKIN_IDS)[number];

/** Skin used when nothing valid is stored. */
export const DEFAULT_PLAYER_SKIN: PlayerSkinId = 'default';

/** Prefix the sprite names of a skin start with in the sheet; the default skin has none. */
export const PLAYER_SKIN_SPRITE_PREFIX: Readonly<Record<PlayerSkinId, string>> = {
  default: '',
  julien: 'julien_',
  runeward_scribe: '',
  runeward_adventurer: ''
};

/** Skins that exist only in the Runeward style. */
const RUNEWARD_ONLY_SKINS: ReadonlySet<PlayerSkinId> = new Set<PlayerSkinId>(['runeward_scribe', 'runeward_adventurer']);

/** Character a skin draws in the Runeward style; the default skin is the mage, Julien keeps the shared drawing. */
export const PLAYER_SKIN_RUNEWARD_CHARACTER: Readonly<Record<PlayerSkinId, RunewardCharacterId>> = {
  default: 'mage',
  julien: 'mage',
  runeward_scribe: 'scribe',
  runeward_adventurer: 'adventurer'
};

/** The skins offered in a style: the Runeward ones only in the Runeward style. */
export function playerSkinsForStyle(runeward: boolean): readonly PlayerSkinId[] {
  return PLAYER_SKIN_IDS.filter((skin) => runeward || !RUNEWARD_ONLY_SKINS.has(skin));
}

/** The skin that is drawn: a Runeward-only skin means the default skin in any other style. */
export function effectivePlayerSkin(skin: PlayerSkinId, runeward: boolean): PlayerSkinId {
  return !runeward && RUNEWARD_ONLY_SKINS.has(skin) ? DEFAULT_PLAYER_SKIN : skin;
}

/** Reads a stored or selected skin; anything unknown means the default skin. */
export function parsePlayerSkin(value: unknown): PlayerSkinId {
  return (PLAYER_SKIN_IDS as readonly unknown[]).includes(value) ? (value as PlayerSkinId) : DEFAULT_PLAYER_SKIN;
}

/** Locale name of the default skin in the Runeward style. */
export const RUNEWARD_DEFAULT_LABEL = 'runeward_mage';

/** Locale key of the label of a skin in the options drawer; in Runeward the default skin is called the mage. */
export function playerSkinLabelKey(skin: PlayerSkinId, runeward = false): string {
  const name = runeward && skin === DEFAULT_PLAYER_SKIN ? RUNEWARD_DEFAULT_LABEL : skin;
  return `app.player_skin.${name}.label`;
}
