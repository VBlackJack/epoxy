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
 * The declarative type table of the CC3D level file, shared by the decoder and the encoder. Every row is
 * file-format data: the type id, the `flags` value the community corpus stores for it (one value per type,
 * measured on the 485 community files), the sections it is stored in (the most frequent first), and what the
 * id stands for in the level model.
 */

import type {
  Cc3dColor,
  Cc3dItem,
  Cc3dMobKind,
  Cc3dTerrain,
  Cc3dTerrainKind
} from '../core/cc3d/model';
import type { Direction } from '../core/types';

/* ------------------------------------------------------------------ */
/* Vocabulary of the file                                              */
/* ------------------------------------------------------------------ */

export const ROOT_ELEMENT = 'map';
export const TILE_ELEMENT = 'tile';
export const TILE_ATTRIBUTES_ELEMENT = 'attributes';
export const ATTR_NAME = 'name';
export const ATTR_AUTHOR = 'author';
export const ATTR_WIDTH = 'width';
export const ATTR_HEIGHT = 'height';
export const ATTR_BACKGROUND = 'background';
export const ATTR_TYPE = 'type';
export const ATTR_IMAGE_INDEX = 'image_index';
export const ATTR_X = 'x';
export const ATTR_Y = 'y';
export const ATTR_DIRECTION = 'direction';
export const ATTR_FLAGS = 'flags';

/** Pixels per cell in the file. */
export const PIXELS_PER_CELL = 64;
/** Mask of the flag bits that carry the initial state of a toggle door: all set when open, all clear when closed. */
export const TOGGLE_DOOR_STATE_MASK = 0b1111;
/** Background theme written when the level carries none (341 of the 485 corpus files use it). */
export const DEFAULT_BACKGROUND = 2;

/** Id of the tile that marks the player start. */
export const PLAYER_TYPE_ID = 22;
/** Id of the tile counted as a required fish. */
export const FISH_TYPE_ID = 42;
/** Directions by the value of the direction attribute: 0 north, 1 east, 2 south, 3 west. */
export const DIRECTIONS_BY_VALUE: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** The order in which the blocked sides of a cell are stored, and the order of the four panel type ids. */
export const PANEL_SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Facing of the player when the file or the level gives none. */
export const DEFAULT_PLAYER_DIRECTION: Direction = 'W';
/** Value of the direction attribute on a tile that does not face anywhere (floors, items, devices). */
export const DIRECTION_NONE = 0;
/**
 * Direction attribute of a panel by the side it blocks, as the community editor stores it (dominant convention
 * of the corpus: Up 3 on 1,682 of 2,088 tiles, Right 0 on 2,099 of 2,548, Down 1 on 1,953 of 2,326, Left 2 on
 * 1,635 of 1,964). The decoder ignores it: the type id wins.
 */
export const PANEL_FILE_DIRECTION: Readonly<Record<Direction, number>> = { N: 3, E: 0, S: 1, W: 2 };

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export const CC3D_SECTIONS = ['player', 'tiles', 'objects', 'enemies', 'blocks', 'walls', 'switches'] as const;
export type Cc3dSection = (typeof CC3D_SECTIONS)[number];

/** Rank of a section: its position in document order. */
export function sectionRank(section: Cc3dSection): number {
  return CC3D_SECTIONS.indexOf(section);
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface Cc3dMobSpec {
  kind: Cc3dMobKind;
  color?: Cc3dColor;
  mirror?: string;
}

export type Cc3dTypeContent =
  | {
      role: 'terrain';
      terrain: Cc3dTerrain;
      /** The initial open state comes from the flag bits of the tile, never from the type id. */
      stateFromFlags?: true;
      /** The direction of the terrain comes from the direction attribute of the tile. */
      directionFromTile?: true;
    }
  | { role: 'panel'; side: Direction }
  | { role: 'item'; item: Cc3dItem }
  | { role: 'mob'; spec: Cc3dMobSpec }
  | { role: 'player' };

export interface Cc3dTypeEntry {
  id: number;
  /** The `flags` value stored for the type; for a toggle door, the closed value (the open one adds the state mask). */
  flags: number;
  /** Sections the type is stored in, the most frequent first. Never empty. */
  sections: readonly Cc3dSection[];
  content: Cc3dTypeContent;
  /** An id the decoder reads but the encoder never writes (a second id for the same thing). */
  alias?: true;
}

interface Cc3dTypeGroup {
  ids: readonly number[];
  flags: number;
  sections: readonly Cc3dSection[];
  contents: readonly Cc3dTypeContent[];
  alias?: true;
}

function terrain(kind: Cc3dTerrainKind, rest: Omit<Cc3dTerrain, 'kind'> = {}): Cc3dTypeContent {
  return { role: 'terrain', terrain: { kind, ...rest } };
}
function colored(kind: Cc3dTerrainKind, color: Cc3dColor): Cc3dTypeContent {
  return terrain(kind, { color });
}
function item(kind: Cc3dItem['kind'], color?: Cc3dColor): Cc3dTypeContent {
  return { role: 'item', item: color ? { kind, color } : { kind } };
}
function mob(kind: Cc3dMobKind, rest: Omit<Cc3dMobSpec, 'kind'> = {}): Cc3dTypeContent {
  return { role: 'mob', spec: { kind, ...rest } };
}
function panel(side: Direction): Cc3dTypeContent {
  return { role: 'panel', side };
}

/** Toggle door ids by colour: the id the encoder writes for a closed and for an open door. */
export const TOGGLE_DOOR_IDS: Readonly<Record<Cc3dColor, { closed: number; open: number }>> = {
  green: { closed: 14, open: 15 },
  blue: { closed: 168, open: 165 },
  red: { closed: 169, open: 166 },
  yellow: { closed: 170, open: 167 }
};

/** Corner closed sides by ice corner id, in id order 4 to 7. */
const ICE_CORNER_SIDES: ReadonlyArray<readonly [Direction, Direction]> = [
  ['S', 'W'],
  ['N', 'W'],
  ['N', 'E'],
  ['E', 'S']
];

const TOGGLE_DOOR_COLORS: readonly Cc3dColor[] = ['green', 'blue', 'red', 'yellow'];

const TOGGLE_DOOR_GROUPS: readonly Cc3dTypeGroup[] = TOGGLE_DOOR_COLORS.map((color) => ({
  ids: [TOGGLE_DOOR_IDS[color].closed, TOGGLE_DOOR_IDS[color].open],
  flags: 327680,
  sections: ['walls'],
  contents: [false, true].map(
    (open): Cc3dTypeContent => ({ role: 'terrain', terrain: { kind: 'toggle_door', color, open }, stateFromFlags: true })
  )
}));

const TYPE_GROUPS: readonly Cc3dTypeGroup[] = [
  { ids: [1], flags: 196608, sections: ['tiles'], contents: [terrain('floor')] },
  { ids: [2], flags: 0, sections: ['walls'], contents: [terrain('wall')] },
  { ids: [3], flags: 12583424, sections: ['tiles'], contents: [terrain('ice')] },
  { ids: [4], flags: 12583619, sections: ['tiles'], contents: [terrain('ice_corner', { corner: [...ICE_CORNER_SIDES[0]] })] },
  { ids: [5], flags: 12583574, sections: ['tiles'], contents: [terrain('ice_corner', { corner: [...ICE_CORNER_SIDES[1]] })] },
  { ids: [6], flags: 12583484, sections: ['tiles'], contents: [terrain('ice_corner', { corner: [...ICE_CORNER_SIDES[2]] })] },
  { ids: [7], flags: 12583529, sections: ['tiles'], contents: [terrain('ice_corner', { corner: [...ICE_CORNER_SIDES[3]] })] },
  { ids: [8], flags: 1024, sections: ['tiles'], contents: [terrain('water')] },
  { ids: [9], flags: 2048, sections: ['tiles'], contents: [terrain('fire')] },
  // Force floors take their direction from the type; the attribute is noise.
  { ids: [10], flags: 12910848, sections: ['tiles', 'blocks'], contents: [terrain('force', { dir: 'N' })] },
  { ids: [11], flags: 12910848, sections: ['blocks', 'tiles'], contents: [terrain('force', { dir: 'E' })] },
  { ids: [12], flags: 12910848, sections: ['tiles'], contents: [terrain('force', { dir: 'S' })] },
  { ids: [13], flags: 12910848, sections: ['blocks', 'tiles'], contents: [terrain('force', { dir: 'W' })] },
  { ids: [70], flags: 12583168, sections: ['blocks', 'tiles'], contents: [terrain('force_random')] },
  ...TOGGLE_DOOR_GROUPS,
  { ids: [16], flags: 8716288, sections: ['tiles'], contents: [terrain('teleport_red')] },
  { ids: [17], flags: 8585216, sections: ['tiles'], contents: [terrain('teleport_blue')] },
  { ids: [20], flags: 196608, sections: ['tiles'], contents: [terrain('exit')] },
  { ids: [21], flags: 0, sections: ['tiles'], contents: [terrain('slime')] },
  { ids: [30], flags: 32768, sections: ['enemies'], contents: [terrain('gravel')] },
  { ids: [198], flags: 32768, sections: ['enemies'], contents: [terrain('sand')] },
  { ids: [50], flags: 4096, sections: ['tiles'], contents: [terrain('dirt')] },
  { ids: [141], flags: 0, sections: ['tiles'], contents: [terrain('turtle')] },
  // Switches and plates.
  { ids: [31, 158, 159, 160], flags: 0, sections: ['switches'], contents: [colored('toggle_control', 'green'), colored('toggle_control', 'blue'), colored('toggle_control', 'red'), colored('toggle_control', 'yellow')] },
  { ids: [154, 155, 156, 157], flags: 0, sections: ['switches'], contents: [colored('plate', 'blue'), colored('plate', 'green'), colored('plate', 'red'), colored('plate', 'yellow')] },
  { ids: [32], flags: 0, sections: ['switches'], contents: [terrain('golem_control_blue')] },
  { ids: [100], flags: 0, sections: ['switches'], contents: [terrain('golem_control_yellow')] },
  { ids: [57], flags: 0, sections: ['switches'], contents: [terrain('clone_switch')] },
  // Doors, sockets and walls.
  { ids: [175, 176, 177, 178], flags: 4096, sections: ['walls'], contents: [colored('hold_door', 'green'), colored('hold_door', 'blue'), colored('hold_door', 'red'), colored('hold_door', 'yellow')] },
  { ids: [34, 35, 36, 37], flags: 67112960, sections: ['walls'], contents: [colored('door', 'red'), colored('door', 'blue'), colored('door', 'yellow'), colored('door', 'green')] },
  { ids: [44], flags: 4096, sections: ['walls'], contents: [terrain('socket')] },
  { ids: [199], flags: 4096, sections: ['tiles'], contents: [terrain('socket_red')] },
  { ids: [45], flags: 4096, sections: ['walls'], contents: [terrain('push_up_wall')] },
  { ids: [46], flags: 4096, sections: ['walls'], contents: [terrain('appearing_wall')] },
  { ids: [49], flags: 4096, sections: ['walls'], contents: [terrain('false_wall')] },
  { ids: [63], flags: 4096, sections: ['tiles'], contents: [terrain('gate_tools')] },
  { ids: [138], flags: 4096, sections: ['tiles'], contents: [terrain('gate_keys')] },
  // Devices.
  { ids: [64], flags: 35651584, sections: ['objects'], contents: [terrain('bomb')] },
  { ids: [65], flags: 327680, sections: ['tiles'], contents: [terrain('trap')] },
  { ids: [66], flags: 327920, sections: ['tiles'], contents: [terrain('trap_control')] },
  { ids: [75], flags: 327680, sections: ['tiles'], contents: [terrain('laser_controller')] },
  {
    ids: [68],
    flags: 327920,
    sections: ['walls'],
    contents: [{ role: 'terrain', terrain: { kind: 'clone_machine' }, directionFromTile: true }]
  },
  // Thin walls.
  { ids: [147, 148, 149, 150], flags: 4096, sections: ['walls'], contents: PANEL_SIDE_ORDER.map(panel) },
  // Items.
  { ids: [38, 39], flags: 35651584, sections: ['objects'], contents: [item('key', 'red'), item('key', 'blue')] },
  { ids: [40, 41], flags: 35655680, sections: ['objects'], contents: [item('key', 'yellow'), item('key', 'green')] },
  { ids: [FISH_TYPE_ID, 43], flags: 35655680, sections: ['objects'], contents: [item('fish'), item('fish_extra')] },
  {
    ids: [59, 60, 61, 62, 144],
    flags: 35655680,
    sections: ['objects'],
    contents: [item('orb_ice'), item('orb_force'), item('orb_fire'), item('orb_water'), item('orb_speed')]
  },
  // The player.
  { ids: [PLAYER_TYPE_ID], flags: 67657728, sections: ['player'], contents: [{ role: 'player' }] },
  // Blocks and reflectors.
  { ids: [23], flags: 67112960, sections: ['blocks'], contents: [mob('block_dirt')] },
  { ids: [26], flags: 67125248, sections: ['tiles', 'blocks'], contents: [mob('block_ice')] },
  {
    ids: [161, 162, 163, 164],
    flags: 67112960,
    sections: ['tiles', 'blocks'],
    contents: [
      mob('block_color', { color: 'blue' }),
      mob('block_color', { color: 'green' }),
      mob('block_color', { color: 'red' }),
      mob('block_color', { color: 'yellow' })
    ]
  },
  // Second ids of the green and red colour blocks: read, never written.
  {
    ids: [191, 192],
    flags: 67112960,
    sections: ['tiles', 'blocks'],
    contents: [mob('block_color', { color: 'green' }), mob('block_color', { color: 'red' })],
    alias: true
  },
  {
    ids: [184, 185, 186, 187],
    flags: 67112960,
    sections: ['tiles'],
    contents: [
      mob('reflector', { mirror: 'LU' }),
      mob('reflector', { mirror: 'DL' }),
      mob('reflector', { mirror: 'UR' }),
      mob('reflector', { mirror: 'RD' })
    ]
  },
  // Monsters.
  { ids: [24], flags: 67147776, sections: ['enemies'], contents: [mob('walker')] },
  { ids: [196, 197], flags: 67145728, sections: ['enemies'], contents: [mob('legs_green'), mob('legs_red')] },
  { ids: [25, 194], flags: 67147776, sections: ['enemies'], contents: [mob('blinky'), mob('baby_blinky')] },
  { ids: [51, 52, 53, 54], flags: 67147776, sections: ['enemies'], contents: [mob('limpa'), mob('limpy'), mob('bouncer'), mob('omni')] },
  { ids: [55, 87], flags: 67147776, sections: ['enemies'], contents: [mob('snappy'), mob('nibble')] },
  { ids: [56, 195], flags: 67145728, sections: ['enemies'], contents: [mob('screamer'), mob('baby_screamer')] },
  { ids: [33], flags: 67147776, sections: ['enemies'], contents: [mob('golem_blue')] },
  { ids: [99], flags: 67162112, sections: ['enemies'], contents: [mob('golem_yellow')] },
  { ids: [76], flags: 67147776, sections: ['enemies'], contents: [mob('laser_shooter')] },
  {
    ids: [72, 73, 190, 74],
    flags: 67162112,
    sections: ['enemies'],
    contents: [mob('bot_static'), mob('bot_cw'), mob('bot_ccw'), mob('bot_multi')]
  }
];

/**
 * Terrain kinds the corpus never stacks on a plain floor tile: a cell holding one of them stores that tile
 * alone, so the encoder leaves the implicit plain floor out. Doors and bombs are not here: the corpus mixes both
 * ways for them, and the floor is written.
 */
export const KINDS_WITHOUT_FLOOR_TILE: ReadonlySet<Cc3dTerrainKind> = new Set<Cc3dTerrainKind>([
  'wall',
  'socket',
  'socket_red',
  'push_up_wall',
  'appearing_wall',
  'false_wall',
  'toggle_door',
  'hold_door',
  'toggle_control',
  'plate',
  'trap',
  'trap_control',
  'clone_machine',
  'clone_switch',
  'golem_control_blue',
  'golem_control_yellow',
  'laser_controller',
  'gate_tools',
  'gate_keys'
]);

/* ------------------------------------------------------------------ */
/* Indexes                                                             */
/* ------------------------------------------------------------------ */

function flatten(groups: readonly Cc3dTypeGroup[]): Cc3dTypeEntry[] {
  const entries: Cc3dTypeEntry[] = [];
  for (const group of groups) {
    if (group.ids.length !== group.contents.length) throw new Error(`CC3D type table: ids and contents differ for ${group.ids[0]}`);
    group.ids.forEach((id, index) => {
      const entry: Cc3dTypeEntry = { id, flags: group.flags, sections: group.sections, content: group.contents[index] };
      if (group.alias) entry.alias = true;
      entries.push(entry);
    });
  }
  return entries;
}

/** Every row of the table. */
export const CC3D_TYPE_ENTRIES: readonly Cc3dTypeEntry[] = flatten(TYPE_GROUPS);

/** Rows by type id, for the decoder. */
export const CC3D_ENTRY_BY_ID: ReadonlyMap<number, Cc3dTypeEntry> = new Map(CC3D_TYPE_ENTRIES.map((entry) => [entry.id, entry]));

/** The identity of a terrain layer in the table: what distinguishes its type id from the others. */
export function terrainKey(layer: Cc3dTerrain): string {
  const parts: string[] = [layer.kind, layer.color ?? ''];
  parts.push(layer.kind === 'force' ? (layer.dir ?? '') : '');
  parts.push(layer.kind === 'ice_corner' && layer.corner ? [...layer.corner].sort().join('') : '');
  parts.push(layer.kind === 'toggle_door' ? (layer.open === true ? 'open' : 'closed') : '');
  return parts.join('|');
}

/** The identity of an item in the table. */
export function itemKey(value: Cc3dItem): string {
  return `${value.kind}|${value.color ?? ''}`;
}

/** The identity of a mob kind in the table. */
export function mobKey(value: Pick<Cc3dMobSpec, 'kind' | 'color' | 'mirror'>): string {
  return `${value.kind}|${value.color ?? ''}|${value.mirror ?? ''}`;
}

/** Rows to write, by the identity of what they stand for. */
export interface Cc3dWriteIndex {
  terrain: ReadonlyMap<string, Cc3dTypeEntry>;
  item: ReadonlyMap<string, Cc3dTypeEntry>;
  mob: ReadonlyMap<string, Cc3dTypeEntry>;
  panel: ReadonlyMap<Direction, Cc3dTypeEntry>;
  player: Cc3dTypeEntry;
}

function buildWriteIndex(): Cc3dWriteIndex {
  const terrainRows = new Map<string, Cc3dTypeEntry>();
  const itemRows = new Map<string, Cc3dTypeEntry>();
  const mobRows = new Map<string, Cc3dTypeEntry>();
  const panelRows = new Map<Direction, Cc3dTypeEntry>();
  let player: Cc3dTypeEntry | undefined;
  for (const entry of CC3D_TYPE_ENTRIES) {
    if (entry.alias) continue;
    const content = entry.content;
    switch (content.role) {
      case 'terrain':
        terrainRows.set(terrainKey(content.terrain), entry);
        break;
      case 'item':
        itemRows.set(itemKey(content.item), entry);
        break;
      case 'mob':
        mobRows.set(mobKey(content.spec), entry);
        break;
      case 'panel':
        panelRows.set(content.side, entry);
        break;
      case 'player':
        player = entry;
        break;
    }
  }
  if (!player) throw new Error('CC3D type table: no player row');
  return { terrain: terrainRows, item: itemRows, mob: mobRows, panel: panelRows, player };
}

export const CC3D_WRITE_INDEX: Cc3dWriteIndex = buildWriteIndex();
