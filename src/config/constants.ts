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

export const ENV_CONFIG = {
  CONFIG_BASE_URL: import.meta.env.VITE_APP_CONFIG_BASE_URL || './configs',
  DEFAULT_LOCALE: import.meta.env.VITE_APP_DEFAULT_LOCALE || 'fr',
  STORAGE_PREFIX: import.meta.env.VITE_APP_STORAGE_PREFIX || 'epoxy_v1_'
} as const;

export const CONFIG_ENDPOINTS = {
  GAME: `${ENV_CONFIG.CONFIG_BASE_URL}/game.json`,
  TILES: `${ENV_CONFIG.CONFIG_BASE_URL}/tiles.json`,
  MONSTERS: `${ENV_CONFIG.CONFIG_BASE_URL}/monsters.json`,
  AUDIO: `${ENV_CONFIG.CONFIG_BASE_URL}/audio.json`,
  LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/levels.json`,
  DAT_FORMAT: `${ENV_CONFIG.CONFIG_BASE_URL}/dat_format.json`
} as const;

export const DIRECTION_VECTORS = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
} as const;

export const ORDERED_DIRECTIONS = ['N', 'E', 'S', 'W'] as const;

/** Password assigned to a level that does not define one. */
export const DEFAULT_LEVEL_PASSWORD = 'EPOX';

/** Sort rank for a pack missing from the configured order. */
export const UNORDERED_PACK_RANK = Number.MAX_SAFE_INTEGER;

export const BUILTIN_PACK_IDS = {
  CAMPAIGN: 'epoxy_campaign',
  CUSTOM: 'epoxy_custom',
  PROCEDURAL: 'epoxy_procedural'
} as const;
