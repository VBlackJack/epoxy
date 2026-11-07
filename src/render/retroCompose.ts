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
 * Composition of the 16-Bit Retro tiles out of sprite layers. Pure module (no DOM): it decides
 * which sprites make up a tile, an item, a monster or the player, stacks them into one 16x16
 * RGBA buffer and dithers the floor shadow on it, so the rules can be tested in node.
 */

import { relativeTo } from '../core/lynx/directions';
import { Direction, RelativeTurn, TileDefinition } from '../core/types';
import {
  BUTTON_COLOR_KEYS,
  BUTTON_GLYPH_KEYS,
  DEFAULT_COLOR_KEY,
  RETRO_BOOT_RAMPS,
  RETRO_PLAIN_TELEPORT_RAMP,
  RETRO_SWAP_RAMPS,
  teleporterGlyphKey
} from './paletteKeys';
import { NEIGHBOUR } from './tileNeighbours';
import { DEFAULT_PLAYER_SKIN, PLAYER_SKIN_SPRITE_PREFIX, type PlayerSkinId } from './playerSkin';
import {
  RETRO_HIDDEN_WALL_MARKERS,
  RETRO_PLAIN_OVERLAY_TILES,
  RETRO_SIGNAL_LIT_SUFFIX,
  RETRO_SIGNAL_TILES,
  RETRO_SPRITE,
  RETRO_SPRITE_PREFIX
} from './retroSpriteNames';
import { quantizeColour } from './retro32/colour';
import {
  blitPixels,
  createRetro16SpriteSource,
  RETRO_CHAR_WIDTH,
  RETRO_FLAG_TEXT,
  RETRO_GLYPH_PREFIX,
  RETRO_GLYPH_SIZE,
  RETRO_SIDE_SHADOW_RATIO,
  RETRO_SPRITE_SIZE,
  RETRO16_SPEC,
  RetroRamps,
  SpriteSource,
  SpriteStyleSpec
} from './retroSprites';

export { RETRO_SIDE_SHADOW_RATIO };

/**
 * One sprite stacked into a composed tile, at (x, y) with an optional swap ramp. Offsets are in
 * pixels of the 16-px authoring grid whatever the style: the composition multiplies them by the
 * style's layer scale, so one layer selection serves every sprite style.
 */
export interface RetroLayer {
  readonly name: string;
  readonly swap?: string;
  readonly x?: number;
  readonly y?: number;
}

/** Which part of a tile is composed: the static part is cached, the animated part is redrawn each frame. */
export type RetroPass = 'all' | 'static' | 'animated';

/** The fields of a tile definition the composition reads. */
export type RetroTileSource = Pick<
  TileDefinition,
  | 'colorKey'
  | 'blockedEdges'
  | 'forbiddenItem'
  | 'isTeleporter'
  | 'scoreBonus'
  | 'scoreMultiplier'
  | 'laserReceiverGroup'
  | 'laserGateGroup'
  | 'laserGateOpen'
>;

export interface RetroTileInput {
  tileId: string;
  def: RetroTileSource;
  /** Definition of any tile or item id, used for the item a forbid tile shows. */
  resolve: (id: string) => RetroTileSource;
  pass: RetroPass;
  /** Cell hash: picks the floor detail. */
  hash: number;
  /** Neighbours of the same wall mass (NEIGHBOUR bits). */
  wallMask: number;
  /** One floor cell in this many shows a detail. */
  floorDetailEvery: number;
  isEditor: boolean;
  /** Hidden walls show their marker outside the editor too (the player holds boots that reveal them). */
  revealHiddenWalls: boolean;
  isClosedTrap: boolean;
  /** A signal tile whose node is on: its lit overlay is stacked over the sprite (absent: off). */
  powered?: boolean;
  /** Animation phase, 0 to RETRO_PHASE_COUNT - 1, shared by every animated tile. */
  phase: number;
  reducedMotion: boolean;
}

/** Number of frames each animated family has in the sprite sheet. */
export const RETRO_FRAME_COUNTS = {
  water: 4,
  fire: 3,
  exit: 2,
  teleport: 2,
  force: 4
} as const;

/** Tiles drawn from several frames, so the terrain cache only holds their floor. */
export const RETRO_SPRITE_ANIMATED_TILES: ReadonlySet<string> = new Set([
  'water',
  'turtle',
  'fire',
  'flame_jet_on',
  'exit',
  'teleport',
  'teleport_red',
  'teleport_blue',
  'teleport_yellow',
  'teleport_green',
  'force_n',
  'force_e',
  'force_s',
  'force_w',
  'force_random',
  'force_cycle'
]);

const FLOOR_DETAIL_KINDS = 3;
/** Bits of the cell hash skipped before picking the detail kind, so it does not follow the density test. */
const FLOOR_DETAIL_KIND_SHIFT = 8;
const FORCE_PREFIX = 'force_';
/** Frame every animated family shows under reduced motion. */
const FIRST_FRAME = 0;
/** Edge letters, in the order their thin panels are stacked. */
const THIN_EDGES: readonly Direction[] = ['N', 'E', 'S', 'W'];
const BLUE_WALL_TILES: ReadonlySet<string> = new Set(['blue_wall_real', 'blue_wall_fake']);
const BLUE_WALL_FAKE = 'blue_wall_fake';
const PLAIN_OVERLAY_TILES: ReadonlySet<string> = new Set(RETRO_PLAIN_OVERLAY_TILES);
const SIGNAL_TILES: ReadonlySet<string> = new Set(RETRO_SIGNAL_TILES);
const DOOR_TILES: ReadonlySet<string> = new Set(['door_red', 'door_blue', 'door_yellow', 'door_green']);
const KEY_ITEM_PREFIX = 'key_';
const BOOTS_ITEM_PREFIX = 'boots_';
/** The Grappling Gloves are a glove, not a pair of boots: they have their own sprite. */
const GLOVES_ITEM_ID = 'boots_pull';
const SCORE_ITEM_PREFIX = 'score_';

/** Centre of a 5x5 glyph in a 16x16 sprite, in authoring-grid pixels. */
const GLYPH_ORIGIN = Math.floor((RETRO_SPRITE_SIZE - RETRO_GLYPH_SIZE) / 2);

/** Score flag text: a 3x5 string centred on `centerX`, its top row at `top` (authoring-grid pixels). */
const FLAG_TEXT = RETRO_FLAG_TEXT;
const MULTIPLIER_PREFIX = 'x';
const THOUSAND = 1000;
const THOUSAND_SUFFIX = 'K';

const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;
/** The shadow checkerboard paints the pixels whose x + y is a multiple of this. */
const CHECKER_MODULUS = 2;
const HEX_PREFIX_LENGTH = 1;
const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;
const RGB_CHANNELS = 3;
/** Ramp and tone of the dithered floor shadow. */
const SHADOW_RAMP = 'shadow';
const SHADOW_TONE = 0;
/** Bits of the shadow signature: which casters the floor cell receives shadow from. */
const SHADOW_NORTH = 1;
const SHADOW_WEST = 2;
const SHADOW_CORNER = 4;

function glyphLayer(colorKey: string | null | undefined): RetroLayer[] {
  if (!colorKey) return [];
  return [{ name: `${RETRO_GLYPH_PREFIX}${colorKey}`, x: GLYPH_ORIGIN, y: GLYPH_ORIGIN }];
}

function swapRampOf(colorKey: string | undefined): string {
  return RETRO_SWAP_RAMPS[colorKey ?? DEFAULT_COLOR_KEY] ?? RETRO_SWAP_RAMPS[DEFAULT_COLOR_KEY];
}

/** Frame of an animated family for the current phase. */
export function retroFrame(frames: number, phase: number): number {
  return ((phase % frames) + frames) % frames;
}

/** Text a score flag carries: "10", "100", "1K" for round thousands, "x2" for a multiplier. */
export function retroBonusLabel(def: Pick<TileDefinition, 'scoreBonus' | 'scoreMultiplier'>): string {
  if (def.scoreMultiplier) return `${MULTIPLIER_PREFIX}${def.scoreMultiplier}`;
  const bonus = def.scoreBonus ?? 0;
  if (bonus >= THOUSAND && bonus % THOUSAND === 0) return `${bonus / THOUSAND}${THOUSAND_SUFFIX}`;
  return String(bonus);
}

/** Sprite name of one character of a flag label (the composition skips names the sheet lacks). */
function charSprite(ch: string): string {
  if (ch >= '0' && ch <= '9') return `${RETRO_SPRITE_PREFIX.digit}${ch}`;
  return `${RETRO_SPRITE_PREFIX.char}${ch.toLowerCase()}`;
}

/** Layers that print `label` in 3x5 characters, centred on the flag. */
export function retroLabelLayers(label: string): RetroLayer[] {
  const chars = [...label];
  const width = chars.length * RETRO_CHAR_WIDTH + (chars.length - 1) * FLAG_TEXT.spacing;
  const left = FLAG_TEXT.centerX - Math.floor(width / 2);
  const layers: RetroLayer[] = [];
  chars.forEach((ch, i) => {
    layers.push({ name: charSprite(ch), x: left + i * (RETRO_CHAR_WIDTH + FLAG_TEXT.spacing), y: FLAG_TEXT.top });
  });
  return layers;
}

/** Layers of an item (key, boots, chip, score flag...) as it sits on the floor. */
export function retroItemLayers(itemId: string, def: RetroTileSource): RetroLayer[] {
  if (itemId.startsWith(KEY_ITEM_PREFIX)) {
    return [{ name: RETRO_SPRITE.key, swap: swapRampOf(def.colorKey) }, ...glyphLayer(def.colorKey ?? DEFAULT_COLOR_KEY)];
  }
  if (itemId === GLOVES_ITEM_ID) {
    return [{ name: RETRO_SPRITE.gloves, swap: RETRO_BOOT_RAMPS[itemId] }];
  }
  if (itemId.startsWith(BOOTS_ITEM_PREFIX) || Object.hasOwn(RETRO_BOOT_RAMPS, itemId)) {
    return [{ name: RETRO_SPRITE.boots, swap: RETRO_BOOT_RAMPS[itemId] }];
  }
  if (itemId.startsWith(SCORE_ITEM_PREFIX)) {
    return [{ name: RETRO_SPRITE.flag }, ...retroLabelLayers(retroBonusLabel(def))];
  }
  return [{ name: itemId }];
}

/** Layers of the floor of a cell: the base plus its hashed detail. */
function floorLayers(hash: number, every: number): RetroLayer[] {
  const layers: RetroLayer[] = [{ name: RETRO_SPRITE.floor }];
  if (every > 0 && hash % every === 0) {
    layers.push({ name: `${RETRO_SPRITE_PREFIX.floorDetail}${(hash >>> FLOOR_DETAIL_KIND_SHIFT) % FLOOR_DETAIL_KINDS}` });
  }
  return layers;
}

/** Layers of a wall cell: top face, lit rims on open north and west, dark rim east, front face south. */
export function retroWallLayers(wallMask: number): RetroLayer[] {
  const layers: RetroLayer[] = [{ name: RETRO_SPRITE.wallTop }];
  if (!(wallMask & NEIGHBOUR.N)) layers.push({ name: RETRO_SPRITE.wallRimN });
  if (!(wallMask & NEIGHBOUR.W)) layers.push({ name: RETRO_SPRITE.wallRimW });
  if (!(wallMask & NEIGHBOUR.E)) layers.push({ name: RETRO_SPRITE.wallRimE });
  if (!(wallMask & NEIGHBOUR.S)) layers.push({ name: RETRO_SPRITE.wallFront });
  return layers;
}

/** Layers of a thin wall cell: floor and one panel per blocked edge. */
export function retroThinLayers(edges: readonly Direction[]): RetroLayer[] {
  const layers: RetroLayer[] = [{ name: RETRO_SPRITE.floor }];
  for (const edge of THIN_EDGES) {
    if (edges.includes(edge)) layers.push({ name: `${RETRO_SPRITE_PREFIX.thin}${edge.toLowerCase()}` });
  }
  return layers;
}

/** Layers that draw `tileId` for the requested pass; empty when the pass has nothing to draw. */
export function retroTileLayers(input: RetroTileInput): RetroLayer[] {
  const { tileId, def, pass } = input;
  const animated = RETRO_SPRITE_ANIMATED_TILES.has(tileId);
  if (pass === 'animated' && !animated) return [];
  const floorOnly: RetroLayer = { name: RETRO_SPRITE.floor };
  // The terrain cache keeps only the floor under a tile that animates.
  if (pass === 'static' && animated) return [floorOnly];
  // Reduced motion freezes every animated family on its first frame.
  const phase = input.reducedMotion ? FIRST_FRAME : input.phase;

  if (tileId === RETRO_SPRITE.floor) return floorLayers(input.hash, input.floorDetailEvery);
  const marker = RETRO_HIDDEN_WALL_MARKERS[tileId];
  if (marker) {
    const floor = floorLayers(input.hash, input.floorDetailEvery);
    return input.isEditor || input.revealHiddenWalls ? [...floor, { name: marker }] : floor;
  }
  if (tileId === 'wall') return retroWallLayers(input.wallMask);
  if (BLUE_WALL_TILES.has(tileId)) {
    const layers: RetroLayer[] = [{ name: RETRO_SPRITE.blueWall }];
    if (input.isEditor && tileId === BLUE_WALL_FAKE) layers.push({ name: RETRO_SPRITE.blueWallFakeMarker });
    return layers;
  }
  if (def.blockedEdges && def.blockedEdges.length > 0) return retroThinLayers(def.blockedEdges);
  if (PLAIN_OVERLAY_TILES.has(tileId)) return [floorOnly, { name: tileId }];
  if (SIGNAL_TILES.has(tileId)) {
    const layers: RetroLayer[] = [floorOnly, { name: tileId }];
    if (input.powered === true) layers.push({ name: `${tileId}${RETRO_SIGNAL_LIT_SUFFIX}` });
    return layers;
  }
  if (tileId === 'trap') {
    return [floorOnly, { name: input.isClosedTrap ? RETRO_SPRITE.trapClosed : RETRO_SPRITE.trapOpen }];
  }
  if (tileId === 'flame_jet_off') {
    return [...floorLayers(input.hash, input.floorDetailEvery), { name: RETRO_SPRITE.flameJetNozzle }];
  }
  if (def.forbiddenItem) {
    return [
      floorOnly,
      ...retroItemLayers(def.forbiddenItem, input.resolve(def.forbiddenItem)),
      { name: RETRO_SPRITE.forbidSign }
    ];
  }
  if (DOOR_TILES.has(tileId)) {
    return [floorOnly, { name: RETRO_SPRITE.door, swap: swapRampOf(def.colorKey) }, ...glyphLayer(def.colorKey ?? DEFAULT_COLOR_KEY)];
  }
  if (def.laserReceiverGroup !== undefined) {
    return [
      floorOnly,
      { name: RETRO_SPRITE.laserReceiver, swap: swapRampOf(def.laserReceiverGroup) },
      ...glyphLayer(def.laserReceiverGroup)
    ];
  }
  if (def.laserGateGroup !== undefined) {
    const name = def.laserGateOpen ? RETRO_SPRITE.laserGateOpen : RETRO_SPRITE.laserGateClosed;
    return [floorOnly, { name, swap: swapRampOf(def.laserGateGroup) }, ...glyphLayer(def.laserGateGroup)];
  }
  if (tileId in BUTTON_COLOR_KEYS) {
    return [
      floorOnly,
      { name: RETRO_SPRITE.button, swap: swapRampOf(BUTTON_COLOR_KEYS[tileId]) },
      ...glyphLayer(BUTTON_GLYPH_KEYS[tileId] ?? DEFAULT_COLOR_KEY)
    ];
  }

  switch (tileId) {
    case 'water':
      return [{ name: `${RETRO_SPRITE_PREFIX.water}${retroFrame(RETRO_FRAME_COUNTS.water, phase)}` }];
    case 'turtle':
      return [
        { name: `${RETRO_SPRITE_PREFIX.water}${retroFrame(RETRO_FRAME_COUNTS.water, phase)}` },
        { name: RETRO_SPRITE.turtle }
      ];
    case 'fire':
      return [{ name: `${RETRO_SPRITE_PREFIX.fire}${retroFrame(RETRO_FRAME_COUNTS.fire, phase)}` }];
    case 'flame_jet_on':
      return [
        { name: `${RETRO_SPRITE_PREFIX.fire}${retroFrame(RETRO_FRAME_COUNTS.fire, phase)}` },
        { name: RETRO_SPRITE.flameJetNozzle }
      ];
    case 'exit':
      return [floorOnly, { name: `${RETRO_SPRITE_PREFIX.exit}${retroFrame(RETRO_FRAME_COUNTS.exit, phase)}` }];
    default:
      break;
  }
  if (tileId.startsWith(FORCE_PREFIX)) {
    return [floorOnly, { name: `${tileId}_${retroFrame(RETRO_FRAME_COUNTS.force, phase)}` }];
  }
  if (def.isTeleporter) {
    const swap = def.colorKey ? swapRampOf(def.colorKey) : RETRO_PLAIN_TELEPORT_RAMP;
    return [
      floorOnly,
      { name: `${RETRO_SPRITE_PREFIX.teleport}${retroFrame(RETRO_FRAME_COUNTS.teleport, phase)}`, swap },
      ...glyphLayer(teleporterGlyphKey(def))
    ];
  }
  return [floorOnly];
}

/** Epoxy-only monsters that wear the sprites of another monster (the game also marks them with a badge). */
const RETRO_MONSTER_SPRITE_BASES: Readonly<Record<string, string>> = {
  puppet: 'tank',
  skitter: 'teeth',
  lurker: 'blob',
  wisp: 'glider'
};

/** Sleeping monsters have one sprite whatever their facing and walk frame: the faint seam that gives them away. */
const RETRO_MONSTER_SPRITE_FIXED: Readonly<Record<string, string>> = {
  lurker_dormant: RETRO_SPRITE.lurkerTell
};

/**
 * Layers of an arrow block: the plain block sprite with one arrow overlay on each face that shows an arrow.
 * The arrows are read relative to the facing, so a turned block shows them on other faces.
 */
export function retroArrowBlockLayers(pushArrows: readonly RelativeTurn[], facing: Direction): RetroLayer[] {
  return [
    { name: RETRO_SPRITE.dirtBlock },
    ...pushArrows.map((turn) => ({ name: `${RETRO_SPRITE_PREFIX.arrowMark}${relativeTo(facing, turn).toLowerCase()}` }))
  ];
}

/** Sprite name of a monster for a facing and walk frame. */
export function retroMonsterSprite(type: string, dir: Direction, frame: number): string {
  const fixed = RETRO_MONSTER_SPRITE_FIXED[type];
  if (fixed !== undefined) return fixed;
  return `${RETRO_MONSTER_SPRITE_BASES[type] ?? type}_${dir}_${frame}`;
}

/**
 * Sprite name of the player: swimming and dead have their own, otherwise facing and stride frame.
 * A skin other than the default draws the same poses from its own prefixed sprites.
 */
export function retroPlayerSprite(
  dir: Direction,
  inWater: boolean,
  alive: boolean,
  frame: number,
  skin: PlayerSkinId = DEFAULT_PLAYER_SKIN
): string {
  const prefix = PLAYER_SKIN_SPRITE_PREFIX[skin];
  if (!alive) return `${prefix}${RETRO_SPRITE.playerDead}`;
  if (inWater) return `${prefix}${RETRO_SPRITE_PREFIX.playerSwim}${dir}`;
  return `${prefix}${RETRO_SPRITE_PREFIX.player}${dir}_${frame}`;
}

/** Which of the north, west and corner shadow parts a floor cell receives, as a small integer. */
export function retroShadowSignature(shadowMask: number): number {
  const north = (shadowMask & NEIGHBOUR.N) !== 0;
  const west = (shadowMask & NEIGHBOUR.W) !== 0;
  const corner = !north && !west && (shadowMask & NEIGHBOUR.NW) !== 0;
  return (north ? SHADOW_NORTH : 0) | (west ? SHADOW_WEST : 0) | (corner ? SHADOW_CORNER : 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const channels: number[] = [];
  for (let i = 0; i < RGB_CHANNELS; i++) {
    const start = HEX_PREFIX_LENGTH + i * HEX_CHANNEL_DIGITS;
    channels.push(parseInt(hex.slice(start, start + HEX_CHANNEL_DIGITS), HEX_RADIX));
  }
  return [channels[0], channels[1], channels[2]];
}

/**
 * Dithers the floor shadow onto a composed tile: a checkerboard of the shadow ramp colour over
 * the rows below a north caster and the columns right of a west caster, `depth` and `side`
 * being pixels of the style. Tiles sit on multiples of the sprite size, so the checkerboard stays
 * continuous from tile to tile.
 */
export function applyRetroShadow(
  buffer: Uint8ClampedArray,
  size: number,
  signature: number,
  ramps: RetroRamps,
  depth: number,
  side: number,
  spec: SpriteStyleSpec = RETRO16_SPEC
): void {
  if (signature === 0) return;
  const hex = ramps[SHADOW_RAMP]?.[SHADOW_TONE];
  if (!hex) return;
  const rgb = hexToRgb(hex);
  const [r, g, b] = spec.quantiseShadow ? quantizeColour(rgb) : rgb;
  const northRows = signature & SHADOW_NORTH ? Math.min(depth, size) : 0;
  const paint = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y < Math.min(y1, size); y++) {
      for (let x = x0; x < Math.min(x1, size); x++) {
        if ((x + y) % CHECKER_MODULUS !== 0) continue;
        const o = (y * size + x) * BYTES_PER_PIXEL;
        buffer[o] = r;
        buffer[o + 1] = g;
        buffer[o + 2] = b;
        buffer[o + ALPHA_OFFSET] = OPAQUE_ALPHA;
      }
    }
  };
  if (northRows > 0) paint(0, 0, size, northRows);
  if (signature & SHADOW_WEST) paint(0, northRows, side, size);
  else if (signature & SHADOW_CORNER) paint(0, 0, side, depth);
}

/** Shadow depth and side width in pixels of the style for a depth given as a fraction of a tile. */
export function retroShadowExtent(depthTile: number, spec: SpriteStyleSpec = RETRO16_SPEC): { depth: number; side: number } {
  return spec.shadowExtent(depthTile);
}

/**
 * Stacks the layers into one RGBA buffer of the style's tile size, later layers over earlier
 * ones. A layer whose sprite the source lacks is skipped, so a missing drawing leaves a hole
 * instead of an error. `source` defaults to the 16-Bit sheet rasterized with `ramps`.
 */
export function composeRetroLayers(
  layers: readonly RetroLayer[],
  ramps: RetroRamps,
  spec: SpriteStyleSpec = RETRO16_SPEC,
  source: SpriteSource = createRetro16SpriteSource(ramps)
): Uint8ClampedArray {
  const size = spec.tileSize;
  const out = new Uint8ClampedArray(size * size * BYTES_PER_PIXEL);
  for (const layer of layers) {
    const dims = source.dims(layer.name);
    if (!dims) continue;
    const pixels = source.pixels(layer.name, layer.swap);
    blitPixels(out, size, pixels, dims.width, (layer.x ?? 0) * spec.layerScale, (layer.y ?? 0) * spec.layerScale);
  }
  return out;
}

/** Cache key of a composed layer stack. */
export function retroLayersKey(layers: readonly RetroLayer[]): string {
  return layers.map((l) => `${l.name}${l.swap ? `:${l.swap}` : ''}${l.x !== undefined ? `@${l.x},${l.y}` : ''}`).join('+');
}
