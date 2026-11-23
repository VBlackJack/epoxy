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

import { CC2_GATE_BASE_IDS, DEFAULT_RULESET, NO_SIGN_ITEM_IDS, NO_SIGN_ITEM_PREFIX, SIGNAL_GATE_CC2_ID_SUFFIX } from '../core/coreConstants';
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

/** Ruleset given to the levels of a .DAT / .CCL file the player imports: they play on the Epoxy engine with the classic rules flavor. */
export const IMPORTED_PACK_RULESET: Ruleset = DEFAULT_RULESET;

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
 * black button, gray area button, wired trap, wired flame jet, Chip's Challenge 2 swivel doors, green chip and bomb, steel wall, hiking boots, gender signs, the track junction and the railroad sign, the no-signs over every carried item, the NAND gate, the data latch, the counter gates, the wire floor, the lightning bolt, steel foil, toggle clock, bribe, dynamite, the floor mimic, timid teeth, ghost, rover, mirror Chip and mirror Melinda monsters, the CC3D walker, bouncer, snappy, nibble, blinky, baby blinky, limpy, limpa, omni, green and red legs, screamer, baby screamer, blue golem and yellow golem monsters, the sand floor), or a level
 * played by Melinda (its `character` field), a level with a canopy (the `canopy` flag of a cell edge), the locked arrow block (a block no push moves), or a level where one push can move a line of blocks (a block listing `chainPushes`,
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
  'mirror_chip',
  'mirror_melinda',
  // The CC3D monsters, each with its own pattern, speed and immunities.
  'bouncer',
  'snappy',
  'nibble',
  'blinky',
  'baby_blinky',
  'limpy',
  'limpa',
  'omni',
  'legs_green',
  'legs_red',
  'screamer',
  'baby_screamer',
  'walker_3d',
  'golem_blue',
  'golem_yellow',
  'sand',
  'steel_foil',
  'toggle_clock',
  'bribe',
  'rail_junction',
  'railroad_sign',
  'arrow_block_none',
  'dynamite',
  'dynamite_lit',
  // The fish gate and the teleporters of the CC3D exit orders.
  'fish_gate',
  'teleport_forward',
  'teleport_turning',
  // The item-layer no-signs: one per item a player can carry.
  ...NO_SIGN_ITEM_IDS.map((id) => `${NO_SIGN_ITEM_PREFIX}${id}`)
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 14 (see
 * PACK_JSON_VERSION_V14_IDS): the Chip's Challenge 2 mechanisms that differ from their Epoxy look-alikes (the slime that
 * dirt and ice blocks clear, the turtle monsters may cross, the wired flame jets, the block barrier floor, the frame
 * block with four arrows, the Chip's Challenge 2 transmogrifier, the random and Chip's Challenge 2 red teleporters, and
 * the helmet). An older build would read the tiles as floor or play them with the rules of their look-alikes, so it must
 * refuse the file.
 */
export const PACK_JSON_VERSION_V14 = 14;

/** Ids that only exist from pack format 14; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V14_IDS: ReadonlySet<string> = new Set([
  'slime_cc2',
  'turtle_cc2',
  'flame_jet_cc2_off',
  'flame_jet_cc2_on',
  'block_barrier_floor',
  'arrow_block_cross',
  'transmogrifier_cc2',
  'teleport_random',
  'teleport_red_cc2',
  'helmet'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 15 (see
 * PACK_JSON_VERSION_V15_IDS): the Chip's Challenge 2 and Chip's Challenge 3D mechanisms that differ from their Epoxy
 * look-alikes (the CC3D dirt, the CC2 pop-up wall, the open trap, the appearing wall that anything reveals, the CC3D
 * slime, the powered-off teleporter and transmogrifier of CC2, and the CC3D ice block). An older build would read the
 * tiles as floor or play them with the rules of their look-alikes, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V15 = 15;

/** Ids that only exist from pack format 15; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V15_IDS: ReadonlySet<string> = new Set([
  'dirt_3d',
  'popup_wall_cc2',
  'trap_open',
  'appearing_wall_any',
  'slime_3d',
  'teleport_red_cc2_off',
  'transmogrifier_cc2_off',
  'ice_block_3d'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 16 (see
 * PACK_JSON_VERSION_V16_IDS): the CC2 orange button that any actor holds down, and the CC3D dirt block. An older build
 * would play them as the signal plate and the plain dirt block, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V16 = 16;

/** Ids that only exist from pack format 16; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V16_IDS: ReadonlySet<string> = new Set(['button_orange_cc2', 'dirt_block_3d']);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 17 (see
 * PACK_JSON_VERSION_V17_IDS): the sealed trap, which no button ever opens, the four CC3D colour blocks, which stop against a wall
 * on ice, and the four CC3D ice corners, which do not turn a bounce. An older build would play them as an ordinary trap that
 * a brown button releases, as the native colour blocks that bounce back and as native corners that turn the bounce, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V17 = 17;

/** Ids that only exist from pack format 17; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V17_IDS: ReadonlySet<string> = new Set([
  'trap_sealed',
  'color_block_3d_red',
  'color_block_3d_green',
  'color_block_3d_blue',
  'color_block_3d_yellow',
  'ice_corner_3d_nw',
  'ice_corner_3d_ne',
  'ice_corner_3d_sw',
  'ice_corner_3d_se'
]);

/**
 * Version of a pack file that holds at least one level using an id introduced with format 18 (see
 * PACK_JSON_VERSION_V18_IDS): the CC2 dirt, which every block but the dirt block packs, and the passable CC2 forms of the
 * logic gates and counters, which every actor walks through. An older build would play the CC2 dirt as plain dirt that blocks
 * every block and the gates as impassable, so it must refuse the file.
 */
export const PACK_JSON_VERSION_V18 = 18;

/** Ids that only exist from pack format 18: the CC2 dirt and the passable form of each logic gate and counter; matched by name like the format 7 ids. */
export const PACK_JSON_VERSION_V18_IDS: ReadonlySet<string> = new Set([
  'dirt_cc2',
  ...CC2_GATE_BASE_IDS.map((id) => `${id}${SIGNAL_GATE_CC2_ID_SUFFIX}`)
]);

/**
 * Version of a pack file whose levels link a wire or a button to a tile that flips on power (a force floor, a green toggle or a
 * swivel door of a CC2-engine level; see TileDefinition.flipsOnPower). An older build would drop those links, so it must refuse the
 * file. The writer uses it only for such a level (see usesPowerFlipSinkFormat).
 */
export const PACK_JSON_VERSION_V19 = 19;

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
  { version: PACK_JSON_VERSION_V13, ids: PACK_JSON_VERSION_V13_IDS },
  { version: PACK_JSON_VERSION_V14, ids: PACK_JSON_VERSION_V14_IDS },
  { version: PACK_JSON_VERSION_V15, ids: PACK_JSON_VERSION_V15_IDS },
  { version: PACK_JSON_VERSION_V16, ids: PACK_JSON_VERSION_V16_IDS },
  { version: PACK_JSON_VERSION_V17, ids: PACK_JSON_VERSION_V17_IDS },
  { version: PACK_JSON_VERSION_V18, ids: PACK_JSON_VERSION_V18_IDS }
];

/**
 * Highest pack file version this build reads; a file with a higher version is refused. Every id of
 * PACK_JSON_ID_SET_VERSIONS exists in the configs, so this build reads version 19.
 */
export const PACK_JSON_MAX_VERSION = PACK_JSON_VERSION_V19;

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

/** Rules version of native Epoxy levels; bump it when a change alters how recorded moves play out. */
export const NATIVE_RULES_VERSION = 1;

/**
 * Rules version of .DAT and native classic Epoxy levels played with the classic Chip's Challenge timing; bumping it drops
 * their stored replays. CC2 imports are versioned by CC2_RULES_VERSION.
 */
export const CC_RULES_VERSION = 9;

/**
 * Rules version of Epoxy levels imported from a CC2-engine source (.c2m), which carry rules of their own; bumping it
 * drops only their stored replays, never those of .DAT or native classic levels (CC_RULES_VERSION).
 */
export const CC2_RULES_VERSION = 29;
// Version 3: the wave 4 rules (brown button held by a step, step-end pulse sources) change what a recorded replay plays to.
// Version 3 also covers the wave 5 rules (green teleporter and transmogrifier draws, tools held by ghosts and rovers, the
// rolling ball), unreleased together with wave 4; bump again if a release ships between two rule changes.
// It also covers the wave 6 rules (the rolling ball as an actor, held buttons, wired traps, the yellow teleporter as an item,
// monster teleports at step end, the rover cadence): v2.33.0 signed .c2m replays with CC_RULES_VERSION, so 3 is still unreleased.
// Version 4: the wave 7 rules (wired force floors and swivels, blocks carried by force floors, the four-tool belt, Melinda's
// kept key, the yellow and red pad decisions, bombs and green buttons at step end, monsters on their load cell): v2.34.0 shipped
// wave 6 with 3.
// Version 5: the wave 8 rules (custom floors and walls bar ghosts, dirt packed at step end, CC2 hints, lit dynamite as a barrier,
// the dynamite fuse offset and thin wall blasts, monster brown buttons at step end, light switches worked by monsters, mirror
// players as actors). Policy: a merge to main is a release, because Pages deploys main; a change that alters what a recorded
// replay plays to bumps this number in the same merge, never later.
// Version 6: the wave 9 rules (the player acts at his place in the actor list, his decision pushes the block ahead, the forced
// step off a released trap, the wire settle before the pass, fireproof dirt blocks on a lit jet, cloned creatures take the
// template's place in the list). Every CC2-engine level also carries list ordinals from this version. Wave 8 is live as 5.
// Version 7: the wave 10 rules (the push judgement of the player's decision, teleports at step end, trap ejection, the pending
// push of a block jammed on a force floor). Wave 9 is live as 6.
// Version 8: the wave 11 rules (the press frame tag of a clone a wire released, wire edges firing before the pass, orange
// buttons at rest, a flame jet kills blocks, the held-tool slide immunity, teeth sliding out of phase). Wave 10 is live as 7.
// Version 9: the wave 12 rules (the rover tiles of the CC2 import and the rover walker emulation, a chain push per block over
// tracks, before-pass firing and the tic-0 wire phase on multi-player levels, water, slime and fire kills at the step end, the
// floor mimic CC2 cadence, bolt carriers powering wires, a teleport onto an open socket, a thrown bowling ball without the
// extra launch tick, the rolling ball and the blue fake wall or CC2 pop-up wall). Wave 11 is live as 8.
// Version 10: the wave 13 rules (monsters enter no-sign cells unless carrying the item, fireball melts an ice block on a forced
// slide, bombs still press the button under the actor they kill, rolling balls, rovers and non-dirt blocks enter an empty cloner
// which holds its template, a linked cloner fires its actual occupant, a wired cloner tries the other ways clockwise, the tool
// thief takes belt tools). Wave 12 is live as 9.
// Version 11: the wave 14 rules (blocks slide and land in their own frame within the tick, held arrivals, the pre-pass of frames
// 0 and 1 before the decisions, a monster refused on a force floor retries in frames 0 and 1). Wave 13 is live as 10.
// Version 12: the wave 15 rules (wired blue teleport networks, a player refused on a random force floor turns it and retries in the
// same attempt, a refused forced step retries in frames 0 and 1 of the next tick, a walk onto ice lasts the ice time). Wave 14 is
// live as 11.
// Version 13: the wave 16 rules (a yellow pad pushed off the belt teleports the player, duplicate boots on the belt, a block slide step of
// the main pass holds its arrival frame, a monster refused on a random force floor bonks and keeps its slide frame on turning floors, a
// clone leaving a machine onto a slide takes the slide step). Wave 15 is live as 12.
// Version 14: the wave 17 rules (a logic gate adds one wire phase, OR and NOT gates wired to their own input, the tick-end settle
// of three wire phases, gate-fed clone machines and launchers firing in the settle, gates stepping in the tic-0 and pre-pass settles,
// a vacated source reaching the wires first). Wave 16 is live as 13.
// Version 15: the wave 18 rules (a clone machine fed through delayed gates releases its clone in the frame of its wire phase, the tic-0
// frame-0 phase starts from all-off wires). Wave 17 is live as 14.
// Version 16: the wave 19 rules (one wire phase per Lexy frame: the tick end is the frame-2 phase and the frame-0 and frame-1 phases run
// with the pre-pass frames of the next tic, a gate release of a frame phase stamped with that frame, a clone released there counted
// before the decisions, a toggle switch entering at its own frame, an orange departure at frame 2). Wave 18 is live as 15.
// Version 17: the wave 20 rules (a sink with a straight-wired source keeps that choice on its deferred edge, a red button pressed by a
// clone at its step end, a lit jet judged when the step into it ends, data latches and counters timed by the gate delay). Wave 19 is live as 16.
// Version 18: the wave 21 rules (a step onto fire, water or slime is judged when the step ends, a flame jet lit while the step runs burns
// at the step end, a drop of the boots that guard the cell of a running step refused). Wave 20 is live as 17.
// Version 19: the wave 22 rules (a parked player's step end acts right after the controlled player's, a parked player's step onto a brown
// button works it when the step ends, a bomb goes off before the water or fire under it, real fire spares a lighting, a jet lit under
// a still player before his turn is judged at his turn). Wave 21 is live as 18.
// Version 20: the wave 23 rules (the swap key acts only at a decision of the controlled player: a swap pressed during his step is refused
// and the replay harness reads the action keys (switch, drop, cycle) only at a decision, the slide wait included). A stored solution with a mid-step swap is refused at that tick.
// Wave 22 is live as 19.
// Version 21: the wave 24 rules (a monster whose ice slide a frame-2 decision refused retries it in frames 0 and 1 of the next tic instead of once after the pass; a melting bump keeps the same-tick retry). A stored solution whose ice jam timing changed replays differently.
// Version 22: the wave 25 rules (the press of an out-of-turn monster step taken in frame 0 or 1 inside the entity pass lands at the frame CC2 ends
// that step in; a slide step on ice refused in frame 0 retries in frame 1; a monster refused both ways on ice in its own turn faces the
// bounce way (the pre-pass retry keeps its facing)). A stored solution whose press or ice jam timing changed replays differently.
// Version 23: the wave 26 rules (a block refused on a fixed force floor by another actor or block retries in the next frame (frame 0
// of the next tic after a main-pass refusal, frame 1 after a frame-0 one) and keeps that frame; turning and random force floors keep
// the after-pass retry; a block loaded on a fixed force floor first slides in frame 1 of tic 0; a monster refused both ways on ice in a
// pre-pass frame faces the bounce way, which replaces the version 22 note "the pre-pass retry keeps its facing"). A stored solution
// whose force-floor block timing changed replays differently.
// Version 24: the wave 27 rules (a block boxed in on ice tries again in the next frame - frame 1 after frame 0, frame 0 of the next tic
// after the main pass; the controlled player's red-button press at the end of a decision step acts at his place in frame 1 of the
// pre-pass, after the actors listed after him; a block that press releases from a template listed before him slides, or ends its plain-cell step (p + 10), one frame sooner; a press the pre-pass missed acts as his main-pass turn opens;
// his push of a block sliding on ice that moves in the main pass is a pending push, only for a block listed after him). A stored
// solution whose ice-block or clone-button timing changed replays differently.
// Version 25: the wave 28 rules (a bowling ball set down that rolls onto a teleporter goes through when its first step ends; on a level
// without actor order the ball is counted down from the frame-2 decision it was set down in; teeth leave a teleporter pad at once
// whatever their window; a block or a monster other than a ghost standing on a plain bomb when the level starts is blown up before the
// first tick). A stored solution that has teeth on a teleporter, sets a bowling ball down onto a teleporter or starts with an actor on a
// bomb replays differently.
// Version 26: the wave 29 rules (green buttons: a monster's press toggles after the frame its step ends in, not in the entity pass;
// green teleporters: a monster or a bowling ball entering one goes through when its step ends, at that frame, in the reverse actor
// order and before the player's frame step, and a failed jump spends the next decision; a ghost is barred by a no-sign over a tool it
// holds and bonks round at once on ice unless it holds cleats; a clone released by a pass-start press ends its step in frame 0). A
// stored solution with monsters on green buttons or green teleporters, or ghosts on ice, replays differently.
// Version 27: the wave 30 rules (a flame jet that lights spares what stands on real fire; a block entering a teleporter goes through
// when its step ends and takes its exit step; a yellow tank steps onto ice or a force floor at the sliding pace; a monster loaded on
// ice decides with its whole preference list and, boxed in, bonks and slides; a yellow press made by a monster or a block lands when
// its step ends, after a press made in between; a monster released from a trap presses when its step ends). A stored solution that
// pushes a block onto a teleporter, lights a flame jet beside real fire, steers a yellow tank onto ice or starts with a monster on
// ice replays differently.
// Version 28: the wave 31 rules (a player holding two keys does not take a way an actor held when he decided; a mirror does not copy
// the release of the player from a trap; a block presses a brown button when its step ends and the trap ejects what it holds at once,
// the player and a teeth out of their phase included; a bomb under a brown button keeps the press; a fireball retries after the pass
// only when its bump melted ice). A stored solution that holds two keys beside a monster, has a mirror beside a trap or pushes a block
// onto a brown button replays differently.
// Version 29: the wave 33 rules (a mirror copies the exit step of the player who left until it ends, MXC; on a level with several
// players a controlled or parked player at rest in a trap that a press opened steps out the way he faces, TEP / TEPK, but not when
// the press comes in the tick his step onto the trap ended from an actor listed after him, TEPF, and the release runs before the
// tick's input, TEPI; a trapped player's refused move is copied by the mirrors, and the horizontal key of two held decides, TDM /
// TDM2; a swap clears the mirrors' memory, remembers the leaver's same-tick slide for the new controller and lets the mirrors listed
// after him read the old memory, SWP / SWP2). A stored solution with mirrors beside a trap, an exit or a swap replays differently.
// CC2_RULES_VERSION is the replay signature, not a runtime switch: the rules above run for every CC2-engine level off the CC3D pace.
// Note: a later change to the two-key rules of the CC2 engine (the slap, the choice between two held keys) changes what a
// recorded {dir, alt} move replays to, so it needs a bump of CC2_RULES_VERSION.

/** The fake walls a block slap of the CC2 engine shows for what they are, as a bump does: a blue fake wall turns to floor. */
export const CC2_SLAP_REVEALED_TILE_IDS: readonly string[] = ['blue_wall_fake'];

/** Rules version of the Lynx engine, for replays recorded on Lynx levels. */
export const LYNX_RULES_VERSION = 1;

/** Rules version of the CC3D engine, for replays recorded on CC3D levels. */
export const CC3D_RULES_VERSION = 1;

/**
 * Pace version of a CC3D level converted to Epoxy, for replays recorded on those levels (they sign as
 * "epoxy-3d:<version>"); bump it when a change alters how recorded moves play out on them.
 */
export const CC3D_PACE_VERSION = 5;

/**
 * Feature switches. `foreignAuthoring` brings back the editing and export
 * paths for other games' formats: the Lynx and CC3D rule sets for new levels,
 * the CC3D room template, and the .DAT and CC3D XML exports. Off by default:
 * Epoxy levels are authored for Epoxy. The code and its tests stay in place.
 */
export const FEATURE_FLAGS = {
  foreignAuthoring: false
} as const;
