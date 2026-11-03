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

import type { Ruleset } from '../core/types';

export const ENV_CONFIG = {
  CONFIG_BASE_URL: import.meta.env.VITE_APP_CONFIG_BASE_URL || './configs',
  DEFAULT_LOCALE: import.meta.env.VITE_APP_DEFAULT_LOCALE || 'fr',
  STORAGE_PREFIX: import.meta.env.VITE_APP_STORAGE_PREFIX || 'epoxy_v1_'
} as const;

export const CONFIG_ENDPOINTS = {
  GAME: `${ENV_CONFIG.CONFIG_BASE_URL}/game.json`,
  TILES: `${ENV_CONFIG.CONFIG_BASE_URL}/tiles.json`,
  CC3D_TILES: `${ENV_CONFIG.CONFIG_BASE_URL}/cc3d-tiles.json`,
  MONSTERS: `${ENV_CONFIG.CONFIG_BASE_URL}/monsters.json`,
  AUDIO: `${ENV_CONFIG.CONFIG_BASE_URL}/audio.json`,
  LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/levels.json`,
  DAT_FORMAT: `${ENV_CONFIG.CONFIG_BASE_URL}/dat_format.json`,
  MOTIFS: `${ENV_CONFIG.CONFIG_BASE_URL}/motifs.json`,
  MOTIF_ANNOTATIONS: `${ENV_CONFIG.CONFIG_BASE_URL}/motif-annotations.json`,
  CAMPAIGN: `${ENV_CONFIG.CONFIG_BASE_URL}/campaign.json`,
  PILOT_LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/pilot-levels.json`,
  PILOT_CAMPAIGN: `${ENV_CONFIG.CONFIG_BASE_URL}/pilot-campaign.json`,
  TEMPLATES: `${ENV_CONFIG.CONFIG_BASE_URL}/templates.json`
} as const;

export const DIRECTION_VECTORS = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
} as const;

export const ORDERED_DIRECTIONS = ['N', 'E', 'S', 'W'] as const;

/** Ruleset given to the levels of a .DAT / .CCL file the player imports: community content. */
export const IMPORTED_PACK_RULESET: Ruleset = 'lynx';

/** Password assigned to a level that does not define one. */
export const DEFAULT_LEVEL_PASSWORD = 'EPOX';

/** Sort rank for a pack missing from the configured order. */
export const UNORDERED_PACK_RANK = Number.MAX_SAFE_INTEGER;

/** Neighbour count from which a walkable cell is a junction (a place with a choice). */
export const JUNCTION_MIN_NEIGHBOURS = 3;

/** Maximum entries kept in solver memoisation caches across levels. */
export const MAX_SOLVER_CACHE_ENTRIES = 4096;

export const BUILTIN_PACK_IDS = {
  CAMPAIGN: 'epoxy_campaign',
  /** The pilot of the rebuilt campaign: listed only while Playtest mode is on. */
  PILOT: 'epoxy_pilot',
  CUSTOM: 'epoxy_custom',
  PROCEDURAL: 'epoxy_procedural'
} as const;

/** Prefix every pilot level id carries, so its records never collide with the campaign ones. */
export const PILOT_LEVEL_ID_PREFIX = 'epoxy_p_';

/** Prefix of the id of a pack the player creates, followed by a timestamp. */
export const USER_PACK_ID_PREFIX = 'user_pack_';

/** Joins the id of a pack and the original id of one of its levels, so level ids stay unique across packs. */
export const LEVEL_ID_SEPARATOR = '__';

/** Name of the pack that holds the levels saved by the editor, until the player renames it. */
export const CUSTOM_PACK_FALLBACK_NAME = 'Custom';

/** i18n key of the label shown for the custom pack until it is renamed. */
export const CUSTOM_PACK_I18N_KEY = 'app.packs.custom.label';

/** Longest pack name kept, in characters. */
export const PACK_NAME_MAX_LENGTH = 60;

/** Value of the `format` field of an exported pack file. */
export const PACK_JSON_FORMAT = 'epoxy-pack';

/** Version of the exported pack file format; a file with a higher version is refused. */
export const PACK_JSON_VERSION = 1;

/** Fragment parameter of a pack share link: `#pack=<version>.<payload>`. */
export const SHARE_LINK_PARAM = 'pack';

/** Version of the share link transport (deflate-raw, then base64url); read before anything is decoded. */
export const SHARE_LINK_TRANSPORT_VERSION = 1;

/** Separates the transport version from the payload in a share link. */
export const SHARE_LINK_VERSION_SEPARATOR = '.';

/** Compression format of the share link payload. */
export const SHARE_LINK_COMPRESSION_FORMAT = 'deflate-raw';

/** Format id of the playtest export file. */
export const PLAYTEST_FORMAT_ID = 'epoxy-playtest';
/** Version of the playtest export file layout; bumped when a field changes meaning. */
export const PLAYTEST_FORMAT_VERSION = 1;
/** Start of the playtest export file name; the export date follows. */
export const PLAYTEST_FILE_BASE = 'epoxy-playtest';
