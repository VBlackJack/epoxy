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
  CC2_TILES: `${ENV_CONFIG.CONFIG_BASE_URL}/cc2-tiles.json`,
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
  CITADEL_LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/citadel-levels.json`,
  CITADEL_CAMPAIGN: `${ENV_CONFIG.CONFIG_BASE_URL}/citadel-campaign.json`,
  TUTORIAL_LEVELS: `${ENV_CONFIG.CONFIG_BASE_URL}/tutorial-levels.json`,
  TUTORIAL_CAMPAIGN: `${ENV_CONFIG.CONFIG_BASE_URL}/tutorial-campaign.json`,
  TEMPLATES: `${ENV_CONFIG.CONFIG_BASE_URL}/templates.json`
} as const;

export const DIRECTION_VECTORS = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
} as const;

export const ORDERED_DIRECTIONS = ['N', 'E', 'S', 'W'] as const;

/** Default facing direction for player starts and template entities when omitted. */
export const DEFAULT_FACING = 'S' as const;

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
  /** Multi-chamber clockwork citadel campaign synthesizing CC1, CC2, and CC3D puzzle archetypes. */
  CITADEL: 'epoxy_citadel',
  /** The tutorial, a room per mechanic: listed only while Playtest mode is on, until it is shown to everyone. */
  TUTORIAL: 'epoxy_tutorial',
  CUSTOM: 'epoxy_custom',
  PROCEDURAL: 'epoxy_procedural'
} as const;

/** Joins the save slot key and a pack id, for the packs that keep a resume point of their own. */
export const SAVE_SLOT_PACK_SEPARATOR = '_';

/** Prefix every pilot level id carries, so its records never collide with the campaign ones. */
export const PILOT_LEVEL_ID_PREFIX = 'epoxy_p_';

/** Prefix every excavation campaign level id carries, so its records never collide with other packs. */
export const EXCAVATION_LEVEL_ID_PREFIX = 'epoxy_x_';

/** Prefix every citadel campaign level id carries, so its records never collide with other packs. */
export const CITADEL_LEVEL_ID_PREFIX = 'epoxy_k_';

/** Prefix every tutorial level id carries, so its records never collide with other packs. */
export const TUTORIAL_LEVEL_ID_PREFIX = 'epoxy_t_';

/** Packs listed and playable only while Playtest mode is on. */
export const PLAYTEST_ONLY_PACK_IDS: readonly string[] = [BUILTIN_PACK_IDS.PILOT, BUILTIN_PACK_IDS.TUTORIAL];

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
 * Version of a pack file that holds at least one level using an id reserved for a Chip's Challenge 2 mechanic (see
 * PACK_JSON_VERSION_V12_IDS). The optional cc2 source record of a level never raises the version by itself: an older
 * build ignores it. An older build would not know the ids and would read
 * the tiles as floor, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V12 = 12;

/** Ids that only exist from pack format 12: every reserved cc2_* id, whether or not the engine plays it yet. */
export const PACK_JSON_VERSION_V12_IDS: ReadonlySet<string> = new Set([
  'cc2_purple_wall', 'cc2_purple_floor', 'cc2_toggle_switch', 'cc2_black_button', 'cc2_counter_gate', 'cc2_nand_gate', 'cc2_button_gray',
  'cc2_track_junction', 'cc2_button_orange_local', 'cc2_steel_wall', 'cc2_unknown',
  'cc2_lightning_bolt', 'cc2_green_chip', 'cc2_green_bomb', 'cc2_time_bomb', 'cc2_railroad_sign', 'cc2_helmet',
  'cc2_steel_foil', 'cc2_toggle_clock', 'cc2_extra_chip', 'cc2_hiking_boots', 'cc2_gender_sign_male',
  'cc2_gender_sign_female', 'cc2_melinda', 'cc2_mirror_chip', 'cc2_mirror_melinda', 'cc2_ghost', 'cc2_rover',
  'cc2_floor_mimic', 'cc2_timid_teeth'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 13 (see
 * PACK_JSON_VERSION_V13_IDS): the wired devices of the Chip's Challenge 2 family (purple wall and floor, toggle switch,
 * black button, gray area button, wired trap, wired flame jet, Chip's Challenge 2 swivel doors, green chip and bomb, steel wall, hiking boots, gender signs, the NAND gate, the data latch, the counter gates, the wire floor, the lightning bolt, steel foil, toggle clock, bribe, the floor mimic, timid teeth, ghost and rover monsters), or a level
 * played by Melinda (its `character` field), or a level where one push can move a line of blocks (a block listing `chainPushes`,
 * such as an ice or arrow block, together with another block or a block cloner). An older build would read the tiles as floor,
 * play Melinda as Chip and refuse the chain push, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V13 = 13;

/** Ids that only exist from pack format 13; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V13_IDS: ReadonlySet<string> = new Set([
  'purple_wall',
  'purple_floor',
  'toggle_switch_off',
  'toggle_switch_on',
  'black_button',
  'button_gray_area',
  'trap_wired',
  'flame_jet_wired_off',
  'flame_jet_wired_on',
  'swivel_door_cc2_ne',
  'swivel_door_cc2_se',
  'swivel_door_cc2_sw',
  'swivel_door_cc2_nw',
  'green_chip',
  'green_bomb',
  'steel_wall',
  'hiking_boots',
  'sign_chip_only',
  'sign_melinda_only',
  'signal_gate_nand',
  'signal_gate_dlatch',
  'signal_counter_0',
  'signal_counter_1',
  'signal_counter_2',
  'signal_counter_3',
  'signal_counter_4',
  'signal_counter_5',
  'signal_counter_6',
  'signal_counter_7',
  'signal_counter_8',
  'signal_counter_9',
  'signal_wire_floor',
  'lightning_bolt',
  'floor_mimic',
  'timid_teeth',
  'ghost',
  'rover',
  'steel_foil',
  'toggle_clock',
  'bribe'
]);

/**
 * The pack format that introduced each set of ids, lowest first. A file is written in the highest version whose ids
 * one of its levels uses, so a later format only has to add a row here.
 */
export const PACK_JSON_ID_SET_VERSIONS: ReadonlyArray<{ version: number; ids: ReadonlySet<string> }> = [
  { version: PACK_JSON_VERSION_V7, ids: PACK_JSON_VERSION_V7_IDS },
  { version: PACK_JSON_VERSION_V8, ids: PACK_JSON_VERSION_V8_IDS },
  { version: PACK_JSON_VERSION_V9, ids: PACK_JSON_VERSION_V9_IDS },
  { version: PACK_JSON_VERSION_V10, ids: PACK_JSON_VERSION_V10_IDS },
  { version: PACK_JSON_VERSION_V11, ids: PACK_JSON_VERSION_V11_IDS },
  { version: PACK_JSON_VERSION_V12, ids: PACK_JSON_VERSION_V12_IDS },
  { version: PACK_JSON_VERSION_V13, ids: PACK_JSON_VERSION_V13_IDS }
];

/**
 * Highest pack file version this build reads; a file with a higher version is refused. Every id of
 * PACK_JSON_ID_SET_VERSIONS exists in the configs, so this build reads version 13.
 */
export const PACK_JSON_MAX_VERSION = PACK_JSON_VERSION_V13;

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

/** File extensions of a Chip's Challenge 2 level and of its game script. */
export const CC2_LEVEL_EXTENSION = '.c2m';
export const CC2_SCRIPT_EXTENSION = '.c2g';

/** IndexedDB database and store holding the raw bytes of the CC2 files an imported pack was made from, keyed by SHA-256. */
export const CC2_SOURCE_DB_NAME = 'epoxy_cc2_sources_db';
export const CC2_SOURCE_STORE_NAME = 'cc2_sources';
export const CC2_SOURCE_DB_VERSION = 1;

/** Name of the optional pack file field that carries the raw CC2 sources, base64 by SHA-256. */
export const CC2_SOURCES_FIELD = 'cc2Sources';

/** Length of a lower case hex SHA-256 digest. */
export const SHA256_HEX_LENGTH = 64;
