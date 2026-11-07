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
  EXCAVATION_LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/excavation-levels.json`,
  EXCAVATION_CAMPAIGN: `${ENV_CONFIG.CONFIG_BASE_URL}/excavation-campaign.json`,
  TEMPLATES: `${ENV_CONFIG.CONFIG_BASE_URL}/templates.json`
} as const;

export const DIRECTION_VECTORS = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
} as const;

export const ORDERED_DIRECTIONS = ['N', 'E', 'S', 'W'] as const;

/** The directions a turning force floor pushes in, one per arrival of any actor, in turn. */
export const FORCE_CYCLE_ORDER = ['E', 'S', 'W', 'N'] as const;

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
  /** Subterranean excavation campaign built around boulder trenches, hold plates, and prism optics. */
  EXCAVATION: 'epoxy_excavation',
  CUSTOM: 'epoxy_custom',
  PROCEDURAL: 'epoxy_procedural'
} as const;

/** Joins the save slot key and a pack id, for the packs that keep a resume point of their own. */
export const SAVE_SLOT_PACK_SEPARATOR = '_';

/** Prefix every pilot level id carries, so its records never collide with the campaign ones. */
export const PILOT_LEVEL_ID_PREFIX = 'epoxy_p_';

/** Prefix every excavation campaign level id carries, so its records never collide with other packs. */
export const EXCAVATION_LEVEL_ID_PREFIX = 'epoxy_x_';

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

/**
 * Version of the exported pack file format that a pack without cell edges is written in.
 *
 * Rule: the version goes up when a level field changes how a level plays and an older build
 * would play the file wrongly instead of refusing it. A file is written in the lowest version
 * that carries what it holds, so a pack that does not need the new field stays readable by older
 * builds. Levels kept in the browser carry no version: a build older than the field drops it on
 * load, which loses the walls and nothing else (declared, not guarded).
 */
export const PACK_JSON_VERSION = 1;

/** Version of a pack file that holds at least one level with cell edges (thin walls on any terrain). */
export const PACK_JSON_VERSION_CELL_EDGES = 2;

/** Version of a pack file that holds at least one level with underlays (terrain hidden under a removable top). */
export const PACK_JSON_VERSION_UNDERLAYS = 3;

/** Version of a pack file that holds at least one level with launcher links (triggers wired to shot launchers). */
export const PACK_JSON_VERSION_LAUNCHERS = 4;

/** Version of a pack file that holds at least one level with signal links (wires between logic devices). */
export const PACK_JSON_VERSION_SIGNALS = 5;

/**
 * Version of a pack file that holds at least one level with a pulse button, or a signal link that ends on a shot
 * launcher or a clone machine. An older build would read the pulse tile as floor and drop the links to launchers
 * and cloners, so the file would play wrongly instead of being refused.
 */
export const PACK_JSON_VERSION_PULSE_SINKS = 6;

/**
 * Version of a pack file that holds at least one level using a tile, item or entity id introduced with format 7
 * (see PACK_JSON_VERSION_V7_IDS). An older build would not know the ids, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V7 = 7;

/** Ids that only exist from pack format 7; matched by name in terrain, underlays, items, entities and clone templates. */
export const PACK_JSON_VERSION_V7_IDS: ReadonlySet<string> = new Set([
  'force_cycle',
  'charge',
  'charge_lit',
  'ward',
  'lurker_dormant',
  'lurker'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 8 (see
 * PACK_JSON_VERSION_V8_IDS): the pocket gate and its pad. An older build would read the pad as floor and the gate as
 * nothing, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V8 = 8;

/** Ids that only exist from pack format 8; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V8_IDS: ReadonlySet<string> = new Set(['pocket_gate', 'pocket_gate_pad']);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 9 (see
 * PACK_JSON_VERSION_V9_IDS): the rail pieces. An older build would read them as plain floor, so it must refuse the
 * file.
 */
export const PACK_JSON_VERSION_V9 = 9;

/** Ids that only exist from pack format 9; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V9_IDS: ReadonlySet<string> = new Set([
  'rail_ns',
  'rail_ew',
  'rail_ne',
  'rail_se',
  'rail_sw',
  'rail_nw',
  'rail_switch_a',
  'rail_switch_b'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 10 (see
 * PACK_JSON_VERSION_V10_IDS): the hurl stone and the wisp. An older build would not know the item or the monster, so it
 * must refuse the file.
 */
export const PACK_JSON_VERSION_V10 = 10;

/** Ids that only exist from pack format 10; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V10_IDS: ReadonlySet<string> = new Set(['hurl_stone', 'wisp']);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 11 (see
 * PACK_JSON_VERSION_V11_IDS): the relay pads and the toll token, or a level whose signal links fire a flip tile (see
 * usesFlipSinkFormat). An older build would read the dark pad as floor and the lit pad as a plain teleporter, would not
 * know the token, and would drop the signal links that power them or that flip a tile, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V11 = 11;

/** Ids that only exist from pack format 11; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V11_IDS: ReadonlySet<string> = new Set(['relay_pad_dark', 'relay_pad_lit', 'toll_token']);

/**
 * The pack format that introduced each set of ids, lowest first. A file is written in the highest version whose ids
 * one of its levels uses, so a later format only has to add a row here.
 */
export const PACK_JSON_ID_SET_VERSIONS: ReadonlyArray<{ version: number; ids: ReadonlySet<string> }> = [
  { version: PACK_JSON_VERSION_V7, ids: PACK_JSON_VERSION_V7_IDS },
  { version: PACK_JSON_VERSION_V8, ids: PACK_JSON_VERSION_V8_IDS },
  { version: PACK_JSON_VERSION_V9, ids: PACK_JSON_VERSION_V9_IDS },
  { version: PACK_JSON_VERSION_V10, ids: PACK_JSON_VERSION_V10_IDS },
  { version: PACK_JSON_VERSION_V11, ids: PACK_JSON_VERSION_V11_IDS }
];

/**
 * Highest pack file version this build reads; a file with a higher version is refused. Every id of
 * PACK_JSON_ID_SET_VERSIONS exists in the configs, so this build reads version 11.
 */
export const PACK_JSON_MAX_VERSION = PACK_JSON_VERSION_V11;

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
