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

import { CompiledLevel } from '../core/types';
import {
  THUMBNAIL_BYTES_PER_PIXEL,
  THUMBNAIL_ENTITY_COLOR,
  THUMBNAIL_FALLBACK_COLOR,
  THUMBNAIL_OPAQUE_ALPHA,
  THUMBNAIL_PLACEHOLDER_CELLS,
  THUMBNAIL_PLACEHOLDER_PALETTE_KEYS,
  THUMBNAIL_PLAYER_COLOR
} from './uiConstants';

/**
 * A level reduced to one pixel per cell, as an RGBA buffer. The colours come
 * from the base palette of `game.json` through the table below; this is a
 * recognisable summary of the map, NOT the active render style (the retro and
 * modern styles recolour tiles, and the thumbnail ignores them on purpose).
 * Pure: no DOM, so the colours and sizes are tested without a canvas.
 */

export interface ThumbnailBuffer {
  width: number;
  height: number;
  /** RGBA, row by row, `width * height * 4` bytes. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Palette keys of the tiles that have one colour of their own. */
const TILE_PALETTE_KEYS: Readonly<Record<string, string>> = {
  floor: 'floorBase',
  wall: 'wallBase',
  recessed_wall: 'recessedWall',
  blue_wall_real: 'blueWall',
  blue_wall_fake: 'blueWall',
  invisible_wall: 'floorBase',
  appearing_wall: 'floorBase',
  dirt: 'dirtBase',
  gravel: 'gravelBase',
  turtle: 'turtleShell',
  socket: 'socketInner',
  exit: 'exitBase',
  hint: 'hintSign',
  water: 'waterDeep',
  fire: 'fireBase',
  slime: 'slimeBase',
  thief: 'thiefCloak',
  thief_keys: 'thiefKeysCloak',
  chip: 'chipBody',
  green_chip: 'green',
  green_bomb: 'bombBody',
  hiking_boots: 'brown',
  lightning_bolt: 'blue',
  steel_foil: 'wallTop',
  toggle_clock: 'blue',
  bribe: 'green',
  steel_wall: 'wallTop',
  sign_chip_only: 'blue',
  sign_melinda_only: 'monsterPinkBall',
  boots_water: 'waterWave',
  boots_fire: 'fireMid',
  boots_ice: 'iceShine',
  boots_force: 'forceArrow',
  boots_speed: 'yellow',
  boots_eye: 'teleportRing',
  boots_pull: 'orange',
  ward: 'blue',
  slow_time: 'blue',
  bomb: 'bombBody',
  charge: 'orange',
  dynamite: 'orange',
  dynamite_lit: 'bombSpark',
  pocket_gate: 'teleportRing',
  pocket_gate_pad: 'teleportRing',
  relay_pad_dark: 'floorBorder',
  relay_pad_lit: 'teleportRing',
  hurl_stone: 'wallBase',
  toll_token: 'yellow',
  charge_lit: 'bombSpark',
  score_2x: 'bonusFlagMultiplier',
  block_target: 'blockTarget',
  flame_jet_off: 'flameJetRim',
  flame_jet_on: 'fireMid',
  toggle_wall_closed: 'wallTop',
  toggle_wall_open: 'floorBorder',
  teleport: 'teleportRing',
  puppet_control: 'yellow',
  shot_trigger: 'yellow',
  trap: 'trapBorder',
  clone_machine: 'clonerBorder',
  transmogrifier: 'teleportRing',
  turn_plate_cw: 'teleportRing',
  turn_plate_ccw: 'teleportRing',
  signal_plate: 'yellow',
  signal_wire_floor: 'yellow',
  signal_button: 'yellow',
  purple_wall: 'teleportRing',
  purple_floor: 'teleportCore',
  toggle_switch_off: 'gravelBase',
  toggle_switch_on: 'yellow',
  black_button: 'chipBody',
  button_gray_area: 'gray',
  trap_wired: 'trapBorder',
  flame_jet_wired_off: 'flameJetRim',
  flame_jet_wired_on: 'fireMid'
};

/** Families of tiles named `<prefix><suffix>`; the palette key is `key` or, when null, the suffix itself (a colour name). */
const TILE_PREFIX_RULES: ReadonlyArray<{ prefix: string; key: string | null }> = [
  { prefix: 'thin_wall', key: 'wallTop' },
  { prefix: 'swivel_door_', key: 'wallTop' },
  { prefix: 'rail_', key: 'wallTop' },
  { prefix: 'ice', key: 'iceBase' },
  { prefix: 'force_', key: 'forceBase' },
  { prefix: 'forbid_', key: 'forbidSign' },
  { prefix: 'door_', key: null },
  { prefix: 'key_', key: null },
  { prefix: 'button_', key: null },
  { prefix: 'pressure_plate_', key: null },
  { prefix: 'toggle_button_', key: null },
  { prefix: 'floating_block_', key: 'waterDeep' },
  { prefix: 'teleport_', key: null },
  { prefix: 'laser_emitter_', key: 'laserBeam' },
  { prefix: 'shot_launcher_', key: 'wallBase' },
  { prefix: 'laser_receiver_', key: null },
  { prefix: 'score_', key: 'bonusFlag' },
  { prefix: 'stopwatch_', key: 'stopwatchBody' },
  { prefix: 'signal_gate_', key: 'teleportRing' },
  { prefix: 'signal_latch_', key: 'teleportRing' },
  { prefix: 'signal_counter_', key: 'teleportRing' }
];

/** Gates are `laser_gate_<colour>_<state>`; an open gate looks like floor. */
const LASER_GATE_PATTERN = /^laser_gate_([a-z]+)_(closed|open)$/;
const LASER_GATE_OPEN = 'open';
const OPEN_GATE_PALETTE_KEY = 'floorBorder';

/** Doors and walls of a colour channel are `<family>_<colour>_<state>`; an open one looks like floor. */
const CHANNEL_DOOR_PATTERN = /^(?:hold_door|toggle_wall)_([a-z]+)_(closed|open)$/;

/** Palette key that colours a tile id; null when the table has no rule for it. */
export function thumbnailPaletteKey(tileId: string): string | null {
  const exact = TILE_PALETTE_KEYS[tileId];
  if (exact) return exact;
  const gate = LASER_GATE_PATTERN.exec(tileId);
  if (gate) return gate[2] === LASER_GATE_OPEN ? OPEN_GATE_PALETTE_KEY : gate[1];
  const channelDoor = CHANNEL_DOOR_PATTERN.exec(tileId);
  if (channelDoor) return channelDoor[2] === LASER_GATE_OPEN ? OPEN_GATE_PALETTE_KEY : channelDoor[1];
  for (const rule of TILE_PREFIX_RULES) {
    if (tileId.startsWith(rule.prefix)) return rule.key ?? tileId.slice(rule.prefix.length);
  }
  return null;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const NIBBLE_REPEAT = 17;

type Rgb = readonly [number, number, number];

/** Reads `#rgb` or `#rrggbb`; null for anything else. */
export function parseHexColor(text: string | undefined): Rgb | null {
  if (!text) return null;
  const long = HEX_LONG.exec(text);
  if (long) return [long[1], long[2], long[3]].map((part) => parseInt(part, HEX_RADIX)) as unknown as Rgb;
  const short = HEX_SHORT.exec(text);
  if (short) {
    return [short[1], short[2], short[3]].map((part) => parseInt(part, HEX_RADIX) * NIBBLE_REPEAT) as unknown as Rgb;
  }
  return null;
}

/** Colour of a tile: its palette entry, else the neutral fallback. */
function tileColor(tileId: string, palette: Readonly<Record<string, string>>, fallback: Rgb): Rgb {
  const key = thumbnailPaletteKey(tileId);
  return (key ? parseHexColor(palette[key]) : null) ?? fallback;
}

function paint(buffer: ThumbnailBuffer, x: number, y: number, color: Rgb): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  const at = (y * buffer.width + x) * THUMBNAIL_BYTES_PER_PIXEL;
  buffer.data[at] = color[0];
  buffer.data[at + 1] = color[1];
  buffer.data[at + 2] = color[2];
  buffer.data[at + 3] = THUMBNAIL_OPAQUE_ALPHA;
}

function emptyBuffer(width: number, height: number): ThumbnailBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * THUMBNAIL_BYTES_PER_PIXEL) };
}

/**
 * Neutral stand-in for a level whose map the thumbnail does not read (cc3d):
 * a small chequerboard in two palette greys, so it cannot pass for a real map.
 */
function placeholder(palette: Readonly<Record<string, string>>, fallback: Rgb): ThumbnailBuffer {
  const size = THUMBNAIL_PLACEHOLDER_CELLS;
  const buffer = emptyBuffer(size, size);
  const [a, b] = THUMBNAIL_PLACEHOLDER_PALETTE_KEYS.map((key) => parseHexColor(palette[key]) ?? fallback);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) paint(buffer, x, y, (x + y) % 2 === 0 ? a : b);
  }
  return buffer;
}

/** Pixel size of the thumbnail of a level: its map size, or the placeholder's for a cc3d level. */
export function thumbnailSize(level: CompiledLevel): { width: number; height: number } {
  if (level.ruleset === 'cc3d') return { width: THUMBNAIL_PLACEHOLDER_CELLS, height: THUMBNAIL_PLACEHOLDER_CELLS };
  const rows = Array.isArray(level.terrain) ? level.terrain : [];
  return { width: rows.reduce((widest, row) => Math.max(widest, row.length), 0), height: rows.length };
}

/**
 * The thumbnail of a level: terrain, then items over it, then the entities and
 * the player start as single contrasting pixels. A cc3d level gets the neutral
 * placeholder, whatever its data.
 */
export function renderLevelThumbnail(level: CompiledLevel, palette: Readonly<Record<string, string>>): ThumbnailBuffer {
  const fallback = parseHexColor(THUMBNAIL_FALLBACK_COLOR) as Rgb;
  if (level.ruleset === 'cc3d') return placeholder(palette, fallback);

  const { width, height } = thumbnailSize(level);
  const buffer = emptyBuffer(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < level.terrain[y].length; x++) {
      const item = level.items?.[y]?.[x];
      paint(buffer, x, y, tileColor(item ?? level.terrain[y][x], palette, fallback));
    }
  }
  const entityColor = parseHexColor(THUMBNAIL_ENTITY_COLOR) as Rgb;
  for (const entity of level.entities) paint(buffer, entity.x, entity.y, entityColor);
  paint(buffer, level.playerStart.x, level.playerStart.y, parseHexColor(THUMBNAIL_PLAYER_COLOR) as Rgb);
  return buffer;
}

/**
 * CSS size to show a buffer at: the largest whole multiple of its pixels that
 * fits the box (cells stay sharp); a map longer than the box is scaled down to
 * fit it, which gives fractional CSS pixels.
 */
export function thumbnailDisplaySize(
  width: number,
  height: number,
  box: number
): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const scale = longest > box ? box / longest : Math.floor(box / longest);
  return { width: width * scale, height: height * scale };
}
