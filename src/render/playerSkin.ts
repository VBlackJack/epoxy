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
 * sprite name for the sprite styles, the vector drawing for HD Neon. Pure module: no DOM.
 */

/** Every skin the player can pick, the default first. */
export const PLAYER_SKIN_IDS = ['default', 'julien'] as const;
export type PlayerSkinId = (typeof PLAYER_SKIN_IDS)[number];

/** Skin used when nothing valid is stored. */
export const DEFAULT_PLAYER_SKIN: PlayerSkinId = 'default';

/** Prefix the sprite names of a skin start with in the sheet; the default skin has none. */
export const PLAYER_SKIN_SPRITE_PREFIX: Readonly<Record<PlayerSkinId, string>> = {
  default: '',
  julien: 'julien_'
};

/** Reads a stored or selected skin; anything unknown means the default skin. */
export function parsePlayerSkin(value: unknown): PlayerSkinId {
  return (PLAYER_SKIN_IDS as readonly unknown[]).includes(value) ? (value as PlayerSkinId) : DEFAULT_PLAYER_SKIN;
}

/** Locale key of the label of a skin in the options drawer. */
export function playerSkinLabelKey(skin: PlayerSkinId): string {
  return `app.player_skin.${skin}.label`;
}
