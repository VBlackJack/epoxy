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

import { Cc2Layer } from './cc2Model';

/**
 * Tile codes of the C2M map format.
 *
 * The layer and the payload size of every code were derived from the 200
 * official levels: with these values all of them decode to exactly width x
 * height cells with no byte left over. Names are labels for reports only. A
 * name is `confirmed` when it comes from the checked tile list; the other
 * entries carry a neutral label.
 */
export interface Cc2TileInfo {
  code: number;
  layer: Cc2Layer;
  /** What the bytes that follow the code mean. */
  extra: Cc2ExtraKind;
  /** Number of those bytes. */
  extraBytes: number;
  name: string;
  /** How far the name can be trusted. 'confirmed' means the name rests on a verified fact. */
  confidence: Cc2NameConfidence;
  /** Epoxy element id the converter maps this code to, when the name alone does not say. */
  epoxyId?: string;
  /** Free-text note for the converter about that mapping. */
  note?: string;
  /** Set when the layer and size are known but the meaning is not: decoding succeeds with this warning. */
  warning?: string;
}

/** Trust level of a tile name. */
export type Cc2NameConfidence = 'confirmed' | 'mediumHigh' | 'medium' | 'low' | 'unknown';

/** Meaning of the payload bytes that follow a tile code. */
export type Cc2ExtraKind = 'none' | 'dir' | 'flags' | 'dirArrows';

/** CC1-style cloner: terrain, no payload. The converter maps it to clone_machine with the actor on top as template. */
export const CC2_CODE_CLONER_CC1 = 0x43;
/** Probably the unused open trap (low confidence): terrain, no payload. */
export const CC2_CODE_OPEN_TRAP = 0x41;
/** Thin wall panels with a fixed edge, no payload (medium confidence): south, east, south-east. */
export const CC2_CODE_THIN_WALL_S = 0x1b;
export const CC2_CODE_THIN_WALL_E = 0x1c;
export const CC2_CODE_THIN_WALL_SE = 0x1d;
/** Green wall variants: solid behaves like a real wall, fake like a fake blue wall. */
export const CC2_CODE_GREEN_WALL_SOLID = 0x7d;
export const CC2_CODE_GREEN_WALL_FAKE = 0x7e;
/** Extension codes of Lexy's Labyrinth: terrain, no payload, meaning unknown. */
export const CC2_CODE_LEXY_EXT_A = 0xf2;
export const CC2_CODE_LEXY_EXT_B = 0xf3;

/** Codes of terrain tiles: the tile that closes every cell stack. */
const TERRAIN_CODES: readonly number[] = [
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x1e, 0x1f, 0x20, 0x22, 0x23, 0x24, 0x25, 0x2c, 0x2d,
  0x2e, 0x2f, 0x30, 0x31, 0x32, 0x39, 0x3a, 0x3f, 0x42, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x4b, 0x4e, 0x4f, 0x50, 0x5a, 0x5b, 0x5c, 0x5e, 0x5f, 0x60, 0x61, 0x64, 0x6b, 0x70,
  0x71, 0x72, 0x73, 0x7d, 0x7e, 0x87, 0x88, 0x89, 0x8a, 0x8d,
  CC2_CODE_CLONER_CC1, CC2_CODE_OPEN_TRAP, CC2_CODE_LEXY_EXT_A, CC2_CODE_LEXY_EXT_B
];

/** Codes of actors (player, blocks, monsters): each is followed by a facing byte. */
const ACTOR_CODES: readonly number[] = [
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x21, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x56, 0x57, 0x63,
  0x65, 0x66, 0x69, 0x82, 0x8b
];

/** Codes of items (keys, chips, boots, tools...). */
const ITEM_CODES: readonly number[] = [
  0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x3b, 0x3c, 0x3d, 0x3e, 0x40, 0x4c, 0x4d, 0x51, 0x52,
  0x59, 0x62, 0x68, 0x6a, 0x6f, 0x7a, 0x7b, 0x7c, 0x80, 0x83, 0x84, 0x8c, 0x8e, 0x8f, 0x90,
  0x92
];

/** Thin wall panel: followed by one byte of edge flags. */
export const CC2_CODE_THIN_WALL = 0x6d;
/** Directional block: followed by a facing byte and an allowed-arrows byte. */
export const CC2_CODE_DIRECTIONAL_BLOCK = 0x81;
/** Sign hidden below panels and above items, the only code seen on that layer. */
export const CC2_CODE_NO_SIGN = 0x7f;
/** Chip pickup, the code the chips-required count is made of. */
export const CC2_CODE_COMPUTER_CHIP = 0x2a;
/** The player character. */
export const CC2_CODE_PLAYER = 0x16;
/** Exit tile. */
export const CC2_CODE_EXIT = 0x14;
/** Railroad track: the tile that carries the 16-bit track modifier. */
export const CC2_CODE_TRACK = 0x4f;
export const CC2_CODE_BOWLING_BALL = 0x68;
export const CC2_CODE_RAILROAD_SIGN = 0x6f;

/** Confirmed labels, from the coordinator-supplied list. */
const CONFIRMED_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01, 'Floor'],
  [0x02, 'Wall'],
  [0x03, 'Ice'],
  [0x04, 'Ice Corner SW'],
  [0x05, 'Ice Corner NW'],
  [0x06, 'Ice Corner NE'],
  [0x07, 'Ice Corner SE'],
  [0x08, 'Water'],
  [0x09, 'Fire'],
  [0x0a, 'Force Floor N'],
  [0x0b, 'Force Floor E'],
  [0x0c, 'Force Floor S'],
  [0x0d, 'Force Floor W'],
  [0x46, 'Random Force Floor'],
  [0x0e, 'Toggle Wall'],
  [0x0f, 'Toggle Floor'],
  [0x10, 'Teleport Red'],
  [0x11, 'Teleport Blue'],
  [0x12, 'Teleport Yellow'],
  [0x13, 'Teleport Green'],
  [0x14, 'Exit'],
  [0x15, 'Slime'],
  [0x1e, 'Gravel'],
  [0x32, 'Dirt'],
  [0x1f, 'Green Button'],
  [0x20, 'Blue Button'],
  [0x39, 'Red Button'],
  [0x3a, 'Brown Button'],
  [0x47, 'Gray Button'],
  [0x5e, 'Pink Button'],
  [0x61, 'Orange Button'],
  [0x64, 'Yellow Button'],
  [0x87, 'Black Button'],
  [0x22, 'Red Door'],
  [0x23, 'Blue Door'],
  [0x24, 'Yellow Door'],
  [0x25, 'Green Door'],
  [0x2c, 'Socket'],
  [0x2d, 'Popup Wall'],
  [0x2e, 'Appearing Wall'],
  [0x2f, 'Invisible Wall'],
  [0x30, 'Blue Wall Real'],
  [0x31, 'Blue Wall Fake'],
  [0x3f, 'Tool Thief'],
  [0x8a, 'Key Thief'],
  [0x42, 'Trap'],
  [0x44, 'Cloner'],
  [0x45, 'Hint'],
  [0x48, 'Swivel Door SW'],
  [0x49, 'Swivel Door NW'],
  [0x4a, 'Swivel Door NE'],
  [0x4b, 'Swivel Door SE'],
  [0x4e, 'Transmogrifier'],
  [0x4f, 'Railroad Track'],
  [0x50, 'Steel Wall'],
  [0x5a, 'Male-Only Sign'],
  [0x5b, 'Female-Only Sign'],
  [0x5c, 'Logic Gate'],
  [0x5f, 'Flame Jet Off'],
  [0x60, 'Flame Jet On'],
  [0x6b, 'Custom Floor'],
  [0x70, 'Custom Wall'],
  [0x71, 'Letter Tile'],
  [0x72, 'Purple Floor'],
  [0x73, 'Purple Wall'],
  [0x88, 'Toggle Switch Off'],
  [0x89, 'Toggle Switch On'],
  [0x8d, 'Turtle'],
  [0x16, 'Chip'],
  [0x56, 'Melinda'],
  [0x17, 'Dirt Block'],
  [0x1a, 'Ice Block'],
  [0x81, 'Directional Block'],
  [0x18, 'Walker'],
  [0x19, 'Glider'],
  [0x21, 'Blue Tank'],
  [0x63, 'Yellow Tank'],
  [0x33, 'Bug'],
  [0x34, 'Paramecium'],
  [0x35, 'Ball'],
  [0x36, 'Blob'],
  [0x38, 'Fireball'],
  [0x37, 'Red Teeth'],
  [0x57, 'Blue Teeth'],
  [0x65, 'Mirror Chip'],
  [0x66, 'Mirror Melinda'],
  [0x69, 'Rover'],
  [0x82, 'Floor Mimic'],
  [0x8b, 'Ghost'],
  [0x26, 'Red Key'],
  [0x27, 'Blue Key'],
  [0x28, 'Yellow Key'],
  [0x29, 'Green Key'],
  [0x2a, 'Computer Chip'],
  [0x2b, 'Extra Computer Chip'],
  [0x84, 'Green Chip'],
  [0x3b, 'Ice Skates'],
  [0x3c, 'Suction Boots'],
  [0x3d, 'Fire Boots'],
  [0x3e, 'Flippers'],
  [0x40, 'Red Bomb'],
  [0x83, 'Green Bomb'],
  [0x4c, 'Time Bonus'],
  [0x4d, 'Stopwatch'],
  [0x6a, 'Time Penalty'],
  [0x51, 'Dynamite'],
  [0x52, 'Helmet'],
  [0x59, 'Hiking Boots'],
  [0x62, 'Lightning Bolt'],
  [0x68, 'Bowling Ball'],
  [0x6f, 'Railroad Sign'],
  [0x7a, '+10'],
  [0x7b, '+100'],
  [0x7c, '+1000'],
  [0x80, 'x2'],
  [0x8c, 'Steel Foil'],
  [0x8e, 'Secret Eye'],
  [0x8f, 'Bribe'],
  [0x90, 'Speed Boots'],
  [0x92, 'Hook'],
  [0x6d, 'Thin Wall'],
  [0x7f, 'No Sign']
]);

/** Names whose evidence is weaker than the checked list: code, name and confidence. */
const PROVISIONAL_NAMES: ReadonlyMap<number, { name: string; confidence: Cc2NameConfidence }> = new Map([
  [CC2_CODE_CLONER_CC1, { name: 'Clone Machine (CC1 style)', confidence: 'medium' }],
  [CC2_CODE_THIN_WALL_S, { name: 'Thin Wall S', confidence: 'medium' }],
  [CC2_CODE_THIN_WALL_E, { name: 'Thin Wall E', confidence: 'medium' }],
  [CC2_CODE_THIN_WALL_SE, { name: 'Thin Wall SE', confidence: 'medium' }],
  [CC2_CODE_OPEN_TRAP, { name: 'Open Trap', confidence: 'low' }],
  [CC2_CODE_GREEN_WALL_SOLID, { name: 'Green Wall Solid', confidence: 'mediumHigh' }],
  [CC2_CODE_GREEN_WALL_FAKE, { name: 'Green Wall Fake', confidence: 'medium' }]
]);

/** Epoxy ids the converter maps codes to, with an optional note. */
const EPOXY_MAPPINGS: ReadonlyMap<number, { epoxyId: string; note?: string }> = new Map([
  [CC2_CODE_CLONER_CC1, { epoxyId: 'clone_machine', note: 'the actor on top of the cell is the template' }],
  [CC2_CODE_GREEN_WALL_SOLID, { epoxyId: 'wall' }],
  [CC2_CODE_GREEN_WALL_FAKE, { epoxyId: 'blue_wall_fake' }]
]);

/** Codes decoded with a known size and an unknown meaning. */
const WARNINGS: ReadonlyMap<number, string> = new Map([
  [CC2_CODE_LEXY_EXT_A, "Lexy's Labyrinth extension code, meaning unknown"],
  [CC2_CODE_LEXY_EXT_B, "Lexy's Labyrinth extension code, meaning unknown"]
]);

/** Fixed-edge thin wall panels: panel layer, never close a cell. */
const THIN_WALL_FIXED_CODES: readonly number[] = [CC2_CODE_THIN_WALL_S, CC2_CODE_THIN_WALL_E, CC2_CODE_THIN_WALL_SE];

const PLAYER_FACING_BYTES = 1;
const THIN_WALL_EXTRA_BYTES = 1;
const DIRECTIONAL_BLOCK_EXTRA_BYTES = 2;
const NO_EXTRA_BYTES = 0;

function hexLabel(code: number): string {
  return `CC2 tile 0x${code.toString(16).padStart(2, '0')}`;
}

function entry(code: number, layer: Cc2Layer, extra: Cc2ExtraKind, extraBytes: number): Cc2TileInfo {
  const confirmedName = CONFIRMED_NAMES.get(code);
  const provisional = PROVISIONAL_NAMES.get(code);
  const confidence: Cc2NameConfidence = confirmedName !== undefined ? 'confirmed' : (provisional?.confidence ?? 'unknown');
  const result: Cc2TileInfo = {
    code,
    layer,
    extra,
    extraBytes,
    name: confirmedName ?? provisional?.name ?? hexLabel(code),
    confidence
  };
  const mapping = EPOXY_MAPPINGS.get(code);
  if (mapping !== undefined) {
    result.epoxyId = mapping.epoxyId;
    if (mapping.note !== undefined) result.note = mapping.note;
  }
  const warning = WARNINGS.get(code);
  if (warning !== undefined) result.warning = warning;
  return result;
}

function buildTable(): ReadonlyMap<number, Cc2TileInfo> {
  const table = new Map<number, Cc2TileInfo>();
  for (const code of TERRAIN_CODES) table.set(code, entry(code, Cc2Layer.Terrain, 'none', NO_EXTRA_BYTES));
  for (const code of ACTOR_CODES) table.set(code, entry(code, Cc2Layer.Actor, 'dir', PLAYER_FACING_BYTES));
  for (const code of ITEM_CODES) table.set(code, entry(code, Cc2Layer.Item, 'none', NO_EXTRA_BYTES));
  for (const code of THIN_WALL_FIXED_CODES) table.set(code, entry(code, Cc2Layer.Panel, 'none', NO_EXTRA_BYTES));
  table.set(CC2_CODE_NO_SIGN, entry(CC2_CODE_NO_SIGN, Cc2Layer.NoSign, 'none', NO_EXTRA_BYTES));
  table.set(CC2_CODE_THIN_WALL, entry(CC2_CODE_THIN_WALL, Cc2Layer.Panel, 'flags', THIN_WALL_EXTRA_BYTES));
  table.set(
    CC2_CODE_DIRECTIONAL_BLOCK,
    entry(CC2_CODE_DIRECTIONAL_BLOCK, Cc2Layer.Actor, 'dirArrows', DIRECTIONAL_BLOCK_EXTRA_BYTES)
  );
  return table;
}

const TILE_TABLE: ReadonlyMap<number, Cc2TileInfo> = buildTable();

/** Table entry for a code, or undefined for a code the table does not know. */
export function cc2TileInfo(code: number): Cc2TileInfo | undefined {
  return TILE_TABLE.get(code);
}

/** All known codes in ascending order. */
export function cc2KnownCodes(): number[] {
  return [...TILE_TABLE.keys()].sort((a, b) => a - b);
}

/** True when the layer closes a cell stack. */
export function closesCell(layer: Cc2Layer): boolean {
  return layer === Cc2Layer.Terrain;
}
