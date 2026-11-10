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

import type { CompiledLevel } from '../core/types';

/**
 * The contract of the tutorial pack: which mechanic each room teaches and what a room may use.
 *
 * A family groups the tile and entity ids that one lesson covers (state variants join their base family).
 * A synthetic member, written with the SYNTHETIC_PREFIX, stands for a level feature that is not a tile or an
 * entity: wires, thin walls on cells, underlays, clone and trap links, launcher links, and the win rules.
 * `TutorialPack.test.ts` enforces the contract against tiles.json, monsters.json and the stored levels.
 */

/** Marks a family member that is a level feature rather than a tile or entity id. */
export const SYNTHETIC_PREFIX = '@';

export const SYNTHETIC_CELL_EDGES = `${SYNTHETIC_PREFIX}cell_edges`;
export const SYNTHETIC_UNDERLAYS = `${SYNTHETIC_PREFIX}underlays`;
export const SYNTHETIC_SIGNAL_LINKS = `${SYNTHETIC_PREFIX}signal_links`;
export const SYNTHETIC_CLONE_LINKS = `${SYNTHETIC_PREFIX}clone_links`;
export const SYNTHETIC_TRAP_LINKS = `${SYNTHETIC_PREFIX}trap_links`;
export const SYNTHETIC_LAUNCHER_LINKS = `${SYNTHETIC_PREFIX}launcher_links`;
export const SYNTHETIC_WIN_TARGETS = `${SYNTHETIC_PREFIX}win_targets`;
export const SYNTHETIC_WIN_RECEIVERS = `${SYNTHETIC_PREFIX}win_receivers`;

/** Every synthetic member, for the tests that tell them from tile and entity ids. */
export const SYNTHETIC_MEMBERS: readonly string[] = [
  SYNTHETIC_CELL_EDGES,
  SYNTHETIC_UNDERLAYS,
  SYNTHETIC_SIGNAL_LINKS,
  SYNTHETIC_CLONE_LINKS,
  SYNTHETIC_TRAP_LINKS,
  SYNTHETIC_LAUNCHER_LINKS,
  SYNTHETIC_WIN_TARGETS,
  SYNTHETIC_WIN_RECEIVERS
];

/** Most families that may be exempt from teaching (each with a reason); more means the syllabus is losing its point. */
export const MAX_EXEMPTIONS = 10;
/** Longest hint a room may carry, in characters. */
export const MAX_HINT_LENGTH = 160;
/** Largest room, in cells. */
export const MAX_ROOM_WIDTH = 11;
export const MAX_ROOM_HEIGHT = 9;

const THIN_WALL_SIDES = ['n', 'e', 's', 'w', 'se', 'ne', 'nw', 'sw', 'ns', 'ew', 'nes', 'new', 'nsw', 'esw', 'nesw'];
const COLOURS = ['red', 'blue', 'yellow', 'green'];

/** Family id to the tile ids, entity ids and synthetic members it covers. */
export const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  walk: ['floor', 'wall', 'exit', 'hint', 'steel_wall', 'sign_chip_only', 'sign_melinda_only'],
  chips: ['chip', 'socket', 'green_chip', 'green_bomb'],
  hidden_walls: ['recessed_wall', 'blue_wall_real', 'blue_wall_fake', 'invisible_wall', 'appearing_wall'],
  thin_walls: [...THIN_WALL_SIDES.map((sides) => `thin_wall_${sides}`), SYNTHETIC_CELL_EDGES],
  swivel_doors: [
    'swivel_door_ne', 'swivel_door_se', 'swivel_door_sw', 'swivel_door_nw',
    'swivel_door_cc2_ne', 'swivel_door_cc2_se', 'swivel_door_cc2_sw', 'swivel_door_cc2_nw'
  ],
  rails: ['rail_ns', 'rail_ew', 'rail_ne', 'rail_se', 'rail_sw', 'rail_nw', 'rail_switch_a', 'rail_switch_b'],
  transmogrifier: ['transmogrifier'],
  turn_plates: ['turn_plate_cw', 'turn_plate_ccw'],
  underlays: [SYNTHETIC_UNDERLAYS],
  dirt: ['dirt'],
  gravel: ['gravel', 'hiking_boots', 'no_sign_hiking_boots'],
  water_fire: ['water', 'fire'],
  water_fire_boots: ['boots_water', 'boots_fire'],
  slime: ['slime'],
  turtle: ['turtle'],
  ice: ['ice', 'ice_nw', 'ice_ne', 'ice_sw', 'ice_se'],
  ice_boots: ['boots_ice'],
  force_floors: ['force_n', 'force_e', 'force_s', 'force_w', 'force_random'],
  force_cycle: ['force_cycle'],
  force_boots: ['boots_force'],
  keys_doors: [...COLOURS.map((c) => `key_${c}`), ...COLOURS.map((c) => `door_${c}`)],
  key_thief: ['thief_keys', ...COLOURS.map((c) => `forbid_key_${c}`), ...COLOURS.map((c) => `no_sign_key_${c}`)],
  boot_thief: [
    'thief',
    'forbid_boots_ice', 'forbid_boots_water', 'forbid_boots_fire', 'forbid_boots_force',
    'no_sign_boots_ice', 'no_sign_boots_water', 'no_sign_boots_fire', 'no_sign_boots_force'
  ],
  green_button: ['button_green', 'toggle_wall_closed', 'toggle_wall_open'],
  teleports: ['teleport'],
  coloured_teleports: ['teleport_red', 'teleport_blue', 'teleport_yellow', 'teleport_green'],
  exit_order_teleports: ['teleport_forward', 'teleport_turning'],
  fish_gate: ['fish_gate'],
  // Format 14: the Chip's Challenge 2 mechanisms that differ from their Epoxy look-alikes.
  cc2_slime: ['slime_cc2'],
  cc2_turtle: ['turtle_cc2'],
  cc2_flame_jets: ['flame_jet_cc2_off', 'flame_jet_cc2_on'],
  block_barrier: ['block_barrier_floor'],
  cc2_arrow_block: ['arrow_block_cross'],
  cc2_transmogrifier: ['transmogrifier_cc2'],
  cc2_teleports: ['teleport_random', 'teleport_red_cc2'],
  helmet: ['helmet'],
  // Format 15: more Chip's Challenge 2 and Chip's Challenge 3D mechanisms.
  cc3d_dirt: ['dirt_3d'],
  cc2_popup_wall: ['popup_wall_cc2'],
  cc2_open_trap: ['trap_open'],
  cc3d_appearing_wall: ['appearing_wall_any'],
  cc3d_slime: ['slime_3d'],
  cc2_powered_devices: ['teleport_red_cc2_off', 'transmogrifier_cc2_off'],
  cc3d_ice_block: ['ice_block_3d'],
  // Format 16: the CC2 orange button and the CC3D dirt block.
  cc2_orange_button: ['button_orange_cc2'],
  cc3d_dirt_block: ['dirt_block_3d'],
  // Format 17: the sealed trap.
  sealed_trap: ['trap_sealed'],
  cc3d_colour_blocks: COLOURS.map((c) => `color_block_3d_${c}`),
  coloured_toggles: [
    ...['red', 'blue', 'yellow'].flatMap((c) => [
      `toggle_wall_${c}_closed`,
      `toggle_wall_${c}_open`,
      `toggle_button_${c}`
    ])
  ],
  pressure_plates: [
    ...COLOURS.map((c) => `pressure_plate_${c}`),
    ...COLOURS.flatMap((c) => [`hold_door_${c}_closed`, `hold_door_${c}_open`])
  ],
  flame_jets: ['flame_jet_off', 'flame_jet_on', 'button_orange'],
  bombs: ['bomb', 'button_gray'],
  traps: ['trap', 'button_brown', SYNTHETIC_TRAP_LINKS],
  clone_machines: ['clone_machine', 'button_red', SYNTHETIC_CLONE_LINKS],
  dirt_blocks: ['dirt_block'],
  ice_blocks: ['ice_block'],
  block_targets: ['block_target', SYNTHETIC_WIN_TARGETS],
  arrow_blocks: ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_none'],
  colour_blocks: [...COLOURS.map((c) => `color_block_${c}`), ...COLOURS.map((c) => `floating_block_${c}`)],
  pull_boots: ['boots_pull', 'no_sign_boots_pull'],
  bugs: ['bug', 'paramecium'],
  pink_ball: ['pink_ball'],
  tank: ['tank', 'button_blue'],
  gliders: ['glider'],
  fireballs: ['fireball'],
  walkers: ['walker'],
  blobs: ['blob'],
  teeth: ['teeth'],
  skitter: ['skitter'],
  lurkers: ['lurker_dormant', 'lurker'],
  wisp: ['wisp'],
  floor_mimic: ['floor_mimic'],
  timid_teeth: ['timid_teeth'],
  ghost: ['ghost'],
  rover: ['rover'],
  bouncer: ['bouncer'],
  snappy: ['snappy'],
  nibble: ['nibble'],
  blinky: ['blinky'],
  baby_blinky: ['baby_blinky'],
  limpy: ['limpy'],
  limpa: ['limpa'],
  omni: ['omni'],
  legs_green: ['legs_green'],
  legs_red: ['legs_red'],
  screamer: ['screamer'],
  baby_screamer: ['baby_screamer'],
  walker_3d: ['walker_3d'],
  golem_blue: ['golem_blue'],
  golem_yellow: ['golem_yellow'],
  sand: ['sand'],
  mirror_chip: ['mirror_chip'],
  mirror_melinda: ['mirror_melinda'],
  wires: ['signal_plate', 'signal_button', SYNTHETIC_SIGNAL_LINKS],
  and_or_gates: ['signal_gate_and', 'signal_gate_or', 'signal_gate_nand'],
  not_xor_gates: ['signal_gate_not', 'signal_gate_xor'],
  latches: [
    'signal_latch_off',
    'signal_latch_on',
    'signal_gate_dlatch',
    ...Array.from({ length: 10 }, (_, n) => `signal_counter_${n}`)
  ],
  relay_pads: ['relay_pad_dark', 'relay_pad_lit'],
  wired_devices: [
    'purple_wall',
    'purple_floor',
    'toggle_switch_off',
    'toggle_switch_on',
    'black_button',
    'button_gray_area',
    'trap_wired',
    'flame_jet_wired_off',
    'flame_jet_wired_on',
    'signal_wire_floor',
    'lightning_bolt',
    'no_sign_lightning_bolt'
  ],
  light_beams: [
    'laser_emitter_n',
    'laser_emitter_e',
    'laser_emitter_s',
    'laser_emitter_w',
    'mirror_slash',
    'mirror_backslash',
    'laser_receiver_red',
    'laser_receiver_blue',
    SYNTHETIC_WIN_RECEIVERS
  ],
  laser_gates: ['laser_gate_red_closed', 'laser_gate_red_open', 'laser_gate_blue_closed', 'laser_gate_blue_open'],
  one_sided_mirrors: ['one_sided_mirror_ne', 'one_sided_mirror_nw', 'one_sided_mirror_se', 'one_sided_mirror_sw'],
  turrets: ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'],
  shot_launchers: [
    'shot_launcher_n',
    'shot_launcher_e',
    'shot_launcher_s',
    'shot_launcher_w',
    'shot_trigger',
    SYNTHETIC_LAUNCHER_LINKS
  ],
  speed_boots: ['boots_speed', 'no_sign_boots_speed'],
  slow_time: ['slow_time', 'no_sign_slow_time'],
  truesight: ['boots_eye', 'no_sign_boots_eye'],
  ward: ['ward', 'no_sign_ward'],
  blast_charge: ['charge', 'charge_lit', 'no_sign_charge'],
  dynamite: ['dynamite', 'dynamite_lit', 'no_sign_dynamite'],
  pocket_gate: ['pocket_gate', 'pocket_gate_pad', 'no_sign_pocket_gate'],
  hurl_stone: ['hurl_stone', 'no_sign_hurl_stone'],
  toll_token: ['toll_token', 'no_sign_toll_token'],
  bribe: ['bribe', 'no_sign_bribe'],
  rail_junction: ['rail_junction'],
  railroad_sign: ['railroad_sign', 'no_sign_railroad_sign'],
  steel_foil: ['steel_foil', 'no_sign_steel_foil'],
  toggle_clock: ['toggle_clock'],
  puppet: ['puppet', 'puppet_control'],
  score_items: ['score_10', 'score_100', 'score_1000', 'score_2x'],
  stopwatches: ['stopwatch_bonus', 'stopwatch_penalty']
};

/** Families every room may use without having been taught them in the chapter. */
export const BASELINE_FAMILIES: readonly string[] = ['walk', 'chips'];

export interface TutorialChapter {
  id: string;
  /** Position in the pack; chapter 1 is the pushed path and its families are known to every later chapter. */
  order: number;
  /** Room ids, in play order. */
  rooms: readonly string[];
}

export const CHAPTERS: readonly TutorialChapter[] = [
  { id: 'basics', order: 1, rooms: ['epoxy_t_move', 'epoxy_t_chips', 'epoxy_t_detour'] },
  {
    id: 'refresher',
    order: 2,
    rooms: [
      'epoxy_t_r_secret_walls',
      'epoxy_t_r_thin_walls',
      'epoxy_t_r_dirt_gravel',
      'epoxy_t_r_keys',
      'epoxy_t_r_elements',
      'epoxy_t_r_ice',
      'epoxy_t_r_force',
      'epoxy_t_r_toggle',
      'epoxy_t_r_teleport',
      'epoxy_t_r_followers',
      'epoxy_t_r_skewers',
      'epoxy_t_r_wanderers',
      'epoxy_t_r_teeth',
      'epoxy_t_r_tank',
      'epoxy_t_r_trap',
      'epoxy_t_r_clone'
    ]
  }
];

/** Room id to the families the room teaches; a family is taught by exactly one room. */
export const TEACHES: Readonly<Record<string, readonly string[]>> = {
  epoxy_t_move: ['walk'],
  epoxy_t_chips: ['chips'],
  epoxy_t_detour: [],
  epoxy_t_r_secret_walls: ['hidden_walls'],
  epoxy_t_r_thin_walls: ['thin_walls'],
  epoxy_t_r_dirt_gravel: ['dirt', 'gravel'],
  epoxy_t_r_keys: ['keys_doors'],
  epoxy_t_r_elements: ['water_fire', 'water_fire_boots'],
  epoxy_t_r_ice: ['ice', 'ice_boots'],
  epoxy_t_r_force: ['force_floors', 'force_boots'],
  epoxy_t_r_toggle: ['green_button'],
  epoxy_t_r_teleport: ['teleports'],
  epoxy_t_r_followers: ['bugs', 'pink_ball'],
  epoxy_t_r_skewers: ['gliders', 'fireballs'],
  epoxy_t_r_wanderers: ['walkers', 'blobs'],
  epoxy_t_r_teeth: ['teeth'],
  epoxy_t_r_tank: ['tank'],
  epoxy_t_r_trap: ['traps'],
  epoxy_t_r_clone: ['clone_machines']
};

/** Family to the reason it is deliberately not taught in a room. */
export const EXEMPTIONS: Readonly<Record<string, string>> = {};

/** Room id to the validator info issues (by locale key) that room is allowed to raise; every other info issue fails. */
export const INFO_ISSUE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {};

/** The families chapter 1 teaches; the later chapters assume them. */
export function chapterOneFamilies(): string[] {
  const first = CHAPTERS.find((chapter) => chapter.order === 1);
  return (first?.rooms ?? []).flatMap((room) => TEACHES[room] ?? []);
}

/**
 * Families not yet taught by any room and not exempt: the authoring lots still to come. Each lot removes the
 * families its rooms teach; the lot that shows the pack leaves it empty.
 */
export const PENDING: readonly string[] = [
  'swivel_doors',
  'rails',
  'transmogrifier',
  'turn_plates',
  'underlays',
  'slime',
  'turtle',
  'force_cycle',
  'key_thief',
  'boot_thief',
  'coloured_teleports',
  'exit_order_teleports',
  'fish_gate',
  'cc2_slime',
  'cc2_turtle',
  'cc2_flame_jets',
  'block_barrier',
  'cc2_arrow_block',
  'cc2_transmogrifier',
  'cc2_teleports',
  'helmet',
  'cc3d_dirt',
  'cc2_popup_wall',
  'cc2_open_trap',
  'cc3d_appearing_wall',
  'cc3d_slime',
  'cc2_powered_devices',
  'cc3d_ice_block',
  'cc2_orange_button',
  'cc3d_dirt_block',
  'sealed_trap',
  'cc3d_colour_blocks',
  'coloured_toggles',
  'pressure_plates',
  'flame_jets',
  'bombs',
  'dirt_blocks',
  'ice_blocks',
  'block_targets',
  'arrow_blocks',
  'colour_blocks',
  'pull_boots',
  'skitter',
  'lurkers',
  'wisp',
  'floor_mimic',
  'timid_teeth',
  'ghost',
  'rover',
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
  'mirror_chip',
  'mirror_melinda',
  'wires',
  'and_or_gates',
  'not_xor_gates',
  'latches',
  'relay_pads',
  'wired_devices',
  'light_beams',
  'laser_gates',
  'one_sided_mirrors',
  'turrets',
  'shot_launchers',
  'speed_boots',
  'slow_time',
  'truesight',
  'ward',
  'blast_charge',
  'dynamite',
  'pocket_gate',
  'hurl_stone',
  'toll_token',
  'bribe',
  'rail_junction',
  'railroad_sign',
  'steel_foil',
  'toggle_clock',
  'puppet',
  'score_items',
  'stopwatches'
];

/** Member (tile id, entity id or synthetic member) to its family. */
export function familyByMember(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [family, members] of Object.entries(FAMILIES)) {
    for (const member of members) map.set(member, family);
  }
  return map;
}

/** The members a level uses: its tile ids, item ids, entity types, underlay terrain and synthetic features. */
export function membersUsedBy(level: CompiledLevel): Set<string> {
  const used = new Set<string>();
  for (const row of level.terrain) for (const id of row) used.add(id);
  for (const row of level.items) for (const id of row) if (id !== null) used.add(id);
  for (const entity of level.entities) used.add(entity.type);
  for (const link of level.cloneLinks) used.add(link.templateType);
  for (const underlay of level.underlays ?? []) used.add(underlay.terrain);
  if ((level.cellEdges ?? []).length > 0) used.add(SYNTHETIC_CELL_EDGES);
  if ((level.underlays ?? []).length > 0) used.add(SYNTHETIC_UNDERLAYS);
  if ((level.signalLinks ?? []).length > 0) used.add(SYNTHETIC_SIGNAL_LINKS);
  if (level.cloneLinks.length > 0) used.add(SYNTHETIC_CLONE_LINKS);
  if (level.trapLinks.length > 0) used.add(SYNTHETIC_TRAP_LINKS);
  if ((level.launcherLinks ?? []).length > 0) used.add(SYNTHETIC_LAUNCHER_LINKS);
  if (level.winRule === 'targets') used.add(SYNTHETIC_WIN_TARGETS);
  if (level.winRule === 'receivers') used.add(SYNTHETIC_WIN_RECEIVERS);
  return used;
}

/** The families a level uses, through any of their members; an unknown member is returned under its own name. */
export function familiesUsedBy(level: CompiledLevel): Set<string> {
  const lookup = familyByMember();
  return new Set([...membersUsedBy(level)].map((member) => lookup.get(member) ?? member));
}

/**
 * The rooms that use a family before it is taught. `known` starts from the baseline (and the chapter 1 families
 * for a later chapter) and grows with what each room teaches, in play order, inside its own chapter only.
 */
export function orderViolations(
  chapters: readonly TutorialChapter[],
  teaches: Readonly<Record<string, readonly string[]>>,
  familiesOf: (room: string) => ReadonlySet<string>
): string[] {
  const first = chapters.find((chapter) => chapter.order === 1);
  const firstFamilies = (first?.rooms ?? []).flatMap((room) => teaches[room] ?? []);
  const problems: string[] = [];
  for (const chapter of chapters) {
    const known = new Set<string>(BASELINE_FAMILIES);
    if (chapter.order > 1) for (const family of firstFamilies) known.add(family);
    for (const room of chapter.rooms) {
      for (const family of teaches[room] ?? []) known.add(family);
      for (const family of familiesOf(room)) {
        if (!known.has(family)) problems.push(`${room} uses ${family} before it is taught`);
      }
    }
  }
  return problems;
}
