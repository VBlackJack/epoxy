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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { BLOCK_TARGET_TILE_ID, CHANNEL_COLORS, FLOOR_TILE_ID, TOGGLE_CHANNEL_COLORS, channelOfButtonAction } from '../core/coreConstants';
import { PlayEngine } from '../core/PlayEngine';
import { BeamCell, Direction, GraphicsStyle, GridPoint, MirrorAxis, MirrorCorner, ThemePalette, TileDefinition } from '../core/types';
import {
  BOOT_COLOR_KEYS,
  BLOCK_ON_TARGET_COLOR_KEY,
  BLOCK_TARGET_COLOR_KEY,
  BUTTON_COLOR_KEYS,
  BUTTON_GLYPH_KEYS,
  DEFAULT_BOOT_COLOR_KEY,
  DEFAULT_COLOR_KEY,
  DEFAULT_MONSTER_COLOR_KEY,
  FX_COLOR_KEYS,
  MONSTER_COLOR_KEYS,
  teleporterGlyphKey
} from './paletteKeys';
import { blockCellsKey, collectBlockCells } from './blockCover';
import {
  CC3D_MOB_BASES,
  EPOXY_MOB_BASES,
  EPOXY_SHOT_PAINTERS,
  SHOT_PAINTER_ID,
  GOLEM_CONTROL_PAINTER_ID,
  GOLEM_YELLOW_PAINTER_ID,
  Cc3dMobBase,
  Cc3dPaintTools,
  isCc3dId,
  paintCc3dBadge,
  paintCc3dFloatingBlock,
  paintCc3dItem,
  paintCc3dMob,
  paintCc3dTerrain
} from './cc3dPainters';
import { FrameBudgetGuard } from './frameBudget';
import {
  AUTO_QUALITY_ID,
  GraphicsQuality,
  DEFAULT_RENDER_SETTINGS,
  QUALITY_LEVELS,
  RenderSettings,
  resolveFrameBudget,
  resolveQualitySettings,
  resolveTheme
} from './renderSettings';
import type { SokobanSkinLoader } from './sokobanSkin';
import { DEFAULT_PLAYER_SKIN, type PlayerSkinId } from './playerSkin';
import { frameScaleFromDelta, scaleDecay, scaleLerpFactor } from './renderTiming';
import {
  collectTerrainFeatures,
  EMPTY_TERRAIN_FEATURES,
  TerrainFeatures,
  TerrainSnapshot,
  teleportGroupKey
} from './terrainState';
import { cameraPosition, FrameGeometry, pointToGrid } from './viewMapping';
import { Light, LightingLayer } from './LightingLayer';
import {
  EDITOR_HIDDEN_STATE_BADGE_EDGE,
  EDITOR_HIDDEN_STATE_BADGE_FILL,
  EDITOR_HIDDEN_STATE_BADGE_INSET_TILE,
  EDITOR_HIDDEN_STATE_BADGE_LINE_TILE,
  EDITOR_HIDDEN_STATE_BADGE_MIN_LINE_PX,
  EDITOR_HIDDEN_STATE_BADGE_SIZE_TILE
} from '../ui/uiConstants';
import { iceBendGeometry, IceBendGeometry, QUARTER_TURN } from './iceBend';
import { armRects, BEAM_CORE_TILE, BEAM_HALO_TILE, beamArms, BeamBoard } from './laserBeams';
import {
  cellHash,
  hasAll,
  ISOLATED_TILE,
  NEIGHBOUR,
  neighbourMask,
  TileNeighbours,
  tileNeighbours
} from './tileNeighbours';
import {
  applyRetroShadow,
  composeRetroLayers,
  retroItemLayers,
  retroLayersKey,
  RetroLayer,
  retroMonsterSprite,
  retroPlayerSprite,
  retroShadowExtent,
  retroShadowSignature,
  retroThinLayers,
  retroTileLayers,
  RETRO_SPRITE_ANIMATED_TILES
} from './retroCompose';
import {
  createRetro16SpriteSource,
  findRetro32PaletteErrors,
  findRetroSheetErrors,
  hasRetroSprite,
  resolveRetroRamps,
  RetroRamps,
  RETRO_SHEET,
  RETRO_SPRITE_SIZE,
  SpriteSource,
  SpriteStyleSpec
} from './retroSprites';
import { RETRO_SPRITE } from './retroSpriteNames';
import { getRenderStyle, nextRenderStyle, OverlayKind, RenderStyleDescriptor } from './styles/renderStyles';
import { createRetro32SpriteCache, createRetro32ThemeSprites, Retro32SpriteCache } from './retro32';
import { bandStops, GradientStop } from './styles/gradientBands';
import {
  createRetroHdRecolour,
  findStyleFamilyErrors,
  findStylePaletteErrors
} from './styles/retroHdPalette';

/** What PixelRenderer.drawBeamCells paints: beam cells, the receivers they light, and the board around them. */
export interface BeamCellsDraw {
  /** Every cell a beam crosses, emitter and turret beams together. */
  readonly cells: readonly BeamCell[];
  /** The cells the emitter beams cross, which the corners of a mirror follow. */
  readonly emitterCells: readonly BeamCell[];
  readonly litReceivers: readonly GridPoint[];
  readonly entities: readonly { type: string; kind: string; x: number; y: number }[];
  readonly terrain: readonly (readonly string[])[];
  readonly originX: number;
  readonly originY: number;
  /** Top-left cell of the drawn region. */
  readonly region: { x0: number; y0: number };
  /** Size of a cell in pixels. */
  readonly unit: number;
  /** Styles that draw a receiver glow as a disc. */
  readonly round: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius as a fraction of a tile. */
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
}

/**
 * Which part of a tile to draw: the static part goes into the terrain cache, the
 * animated part is drawn over it every frame, 'all' draws both (editor, icons).
 */
type TilePass = 'all' | 'static' | 'animated';

/** Sprites, ramps and parameters the retro sprite path draws with right now. */
interface ActiveSpriteStyle {
  readonly spec: SpriteStyleSpec;
  readonly ramps: RetroRamps;
  readonly source: SpriteSource;
}

type RetroPaletteTable = Record<string, Record<string, string[]>> | undefined;

/** Palette and theme a style draws with: the config's own, or recoloured for a Retro HD style. */
interface StyleColours {
  readonly palette: Record<string, string>;
  readonly theme: ThemePalette | undefined;
}

/** Prefix of the console report when the colours of a Retro HD style fail validation. */
/** Facing of the creatures and the player in palette icons. */
const ICON_FACING: Direction = 'S';

const STYLE_PALETTE_INVALID_REPORT = 'Render style palette rejected, drawing with the HD Neon colours:';
/** Multiplier and increment of the generator that scatters the grain specks (Numerical Recipes LCG). */
const GRAIN_LCG_MULTIPLIER = 1664525;
const GRAIN_LCG_INCREMENT = 1013904223;
const GRAIN_LCG_MODULUS = 4294967296;
const GRAIN_SEED = 1;
/** Width in pixels of a grid line, and shortest distance between two scanlines. */
const OVERLAY_LINE_PX = 1;
const MIN_SCANLINE_PERIOD_PX = 2;
/** Quality level at which overlays are not drawn. */
const LOWEST_QUALITY: GraphicsQuality = QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
/** A gradient needs at least this many bands to be cut; offset of the stop that closes a gradient. */
const MIN_GRADIENT_BANDS = 2;
const GRADIENT_END_OFFSET = 1;

/** Parts of the shadow a floor cell receives from casters north, west or only north-west of it. */
type ShadowPart = 'north' | 'west' | 'corner';

const MODERN_ANIMATED_TILES: ReadonlySet<string> = new Set([
  'water',
  'fire',
  'force_n',
  'force_e',
  'force_s',
  'force_w',
  'force_random',
  'flame_jet_on',
  'exit',
  'teleport',
  'teleport_red',
  'teleport_blue',
  'teleport_yellow',
  'teleport_green',
  'ice',
  'ice_nw',
  'ice_ne',
  'ice_sw',
  'ice_se'
]);
/** Tiles the legacy flat retro drawer animates (HD Neon editor, icons and no-theme fallback). */
const RETRO_ANIMATED_TILES: ReadonlySet<string> = new Set([
  'water',
  'fire',
  'flame_jet_on',
  'exit',
  'teleport',
  'teleport_red',
  'teleport_blue',
  'teleport_yellow',
  'teleport_green'
]);
const ANY_ANIMATED_TILES: ReadonlySet<string> = new Set([
  ...MODERN_ANIMATED_TILES,
  ...RETRO_ANIMATED_TILES,
  ...RETRO_SPRITE_ANIMATED_TILES
]);

const FULL_TURN = Math.PI * 2;
/** Thin wall bar: thickness as a share of the tile, with a floor in pixels per drawing style. */
const THIN_BAR_TILE = 0.14;
const THIN_BAR_MIN_PX_NEON = 5;
const THIN_BAR_MIN_PX_FLAT = 4;
/** Swivel door pivot dot radius, as a multiple of the bar thickness. */
const SWIVEL_PIVOT_RADIUS_BARS = 1.1;
/** Swivel door pivot dot centre, as a multiple of the bar thickness from the closed corner. */
const SWIVEL_PIVOT_OFFSET_BARS = 0.5;
/**
 * Whether cells with stacked layers under the shown one get a corner marker. Off in play; meant for
 * the CC3D editor, which turns it on for its own canvas.
 */
const HIDDEN_LAYER_MARKER_DEFAULT = false;
const HIDDEN_LAYER_MARKER_TILE = 0.22;
const HINT_GLYPH = '?';
const HINT_FONT_WEIGHT = 'bold';
/** Forbidden-item barrier: the item's icon, scaled down, under a crossed ring. */
const FORBID_ICON_SCALE = 0.66;
const FORBID_RING_TILE = 0.4;
const FORBID_LINE_WIDTH_TILE = 0.075;
/** Flame jet nozzle set into the floor, as fractions of a tile. */
const FLAME_JET_NOZZLE_TILE = 0.26;
const FLAME_JET_RIM_TILE = 0.32;
/** Bonus flag: pole position and flag box, as fractions of a tile. */
const BONUS_POLE_X_TILE = 0.26;
const BONUS_FLAG = { top: 0.16, height: 0.4, width: 0.56 } as const;
const BONUS_FONT_SCALE = 0.26;
const BONUS_MULTIPLIER_PREFIX = 'x';
/** Stopwatch: dial and crown, as fractions of a tile. */
const STOPWATCH = { cy: 0.56, radius: 0.28, crownWidth: 0.14, crownHeight: 0.12, signHalf: 0.12, signThickness: 0.07 } as const;
/** Slow-time charm: the two bars of its pause mark, as fractions of a tile, and the palette key of its blue body. */
const SLOW_MARK = { barOffset: 0.07, barWidth: 0.06, barHalfHeight: 0.12 } as const;
const SLOW_TIME_BODY_KEY = 'blue';
/** Turtle shell and head, as fractions of a tile. */
const TURTLE = { shellRx: 0.3, shellRy: 0.24, headRadius: 0.1, headX: 0.84 } as const;

/** Sprite padding around a glowing shape, as a multiple of the strongest blur radius. */
const GLOW_PAD_FACTOR = 2;

/** Retro tiles flip animation phase every N engine ticks, over a cycle of N phases. */
const RETRO_PHASE_TICKS = 8;
const RETRO_PHASE_COUNT = 4;
/** The retro sprite style is usable once this sprite and this palette ramp exist. */
const RETRO_READY_SPRITE = RETRO_SPRITE.floor;
const RETRO_READY_RAMP = 'floor';
/** Prefix of the console report when the retro palettes or sprites fail validation. */
const RETRO_INVALID_REPORT = 'Retro sprites rejected, using the flat retro drawer:';
/** Prefix of the console report when the 32-Bit ramps cannot be derived and 16-Bit sprites are used. */
const RETRO32_INVALID_REPORT = '32-Bit Retro ramps unavailable, using the 16-Bit sprites:';
/** Smallest sprite cache the 32-Bit style may be given. */
const RETRO32_MIN_CACHE_ENTRIES = 1;
/** Separator of the parts of a retro canvas key; never part of a layer name. */
const RETRO_KEY_SEPARATOR = '|';
/** The 32-Bit shine sweeps across a sprite during this many animation frames of the 60 frame cycle. */
const SHINE_SWEEP_FRAMES = 24;
/** Distinct positions of the shine band over one sweep (one cached overlay each). */
const SHINE_STEPS = 12;
/** Half width of the fully lit shine band, as a fraction of the sprite size. */
const SHINE_CORE_HALF_WIDTH_RATIO = 0.09;
/** The soft edge of the band is this many times wider than its core. */
const SHINE_EDGE_FACTOR = 2;
/** Overlay alpha (0..255) of the band core and of its soft edge. */
const SHINE_CORE_ALPHA = 255;
const SHINE_EDGE_ALPHA = 110;
/** Bytes per RGBA pixel and offsets used when painting the shine overlay. */
const RGBA_BYTES = 4;
const RGBA_ALPHA_OFFSET = 3;
const OVERLAY_WHITE = 255;
/** Modern tile animation speed, in radians per reference frame. */
const MODERN_ANIM_SPEED = 0.08;
const ITEM_BOB_SPEED = 0.1;
const ITEM_BOB_AMPLITUDE_TILE = 0.04;
const FLOOR_RIVET_SIZE_TILE = 0.04;
const FLOOR_RIVET_INSET_TILE = 0.06;
/** Floor details picked by cell hash: a panel seam, a vent grille or a scuff. */
const FLOOR_DETAIL_KINDS = 3;
/** Bits of the cell hash skipped before picking the detail kind, so it does not follow the density test. */
const FLOOR_DETAIL_KIND_SHIFT = 8;
const FLOOR_VENT_SLATS = 3;
const FLOOR_VENT_WIDTH_TILE = 0.36;
const FLOOR_VENT_PITCH_TILE = 0.1;
const FLOOR_DETAIL_LINE_TILE = 0.025;
/** The shadow thrown sideways by a west caster is shallower than the one thrown by a north caster. */
const SIDE_SHADOW_RATIO = 0.6;
/** Retro shadows are dithered with square dots of one sixteenth of a tile. */
const RETRO_DITHER_DIVISOR = 16;
const WALL_RIM_ALPHA = 0.55;
/** Wall cells whose hash is a multiple of this show an engraved panel in their interior. */
const WALL_PANEL_EVERY = 3;
/** Retro wall front faces show a mortar joint every this fraction of a tile. */
const RETRO_BRICK_SPAN_TILE = 0.5;

/** Rotation applied to sprites drawn facing north, so they face their direction of travel. */
const DIRECTION_ANGLE: Readonly<Record<Direction, number>> = {
  N: 0,
  E: Math.PI / 2,
  S: Math.PI,
  W: -Math.PI / 2
};
/** Monsters alternate between two walk frames every this many reference frames. */
const MONSTER_FRAME_TICKS = 10;
const WALK_FRAMES = 2;
/** Below this distance (in tiles) from its cell, a sprite counts as standing still. */
const MOVING_EPSILON_TILES = 0.02;

/** Lights are gathered from terrain this many tiles beyond the view, so their glow can reach in. */
const LIGHT_MARGIN_TILES = 2;
const FLICKERING_LIGHTS: ReadonlySet<string> = new Set(['fire', 'flame_jet_on', 'fireball']);
const LIGHT_FLICKER_SPEED = 0.35;
const LIGHT_PHASE_X = 1.7;
const LIGHT_PHASE_Y = 2.3;
/** Width of the dark gap between LCD pixels, as a fraction of one retro dot. */
export const LCD_GAP_RATIO = 0.25;
/** The iris starts as a small window on the player, this many tiles wide. */
const IRIS_MIN_RADIUS_TILE = 0.6;

/** Colours of the plate, hold door, toggle and block families that Epoxy shares with the cc3d painters. */
const CHANNEL_PAINTER_COLORS = CHANNEL_COLORS;
/** Colours that have a colour toggle wall and button (green is the plain toggle wall). */
const TOGGLE_PAINTER_COLORS = TOGGLE_CHANNEL_COLORS;

/**
 * Epoxy colour channel ids drawn by the cc3d painter of the same mechanic: the cc3d display id to paint.
 * Looked up before `isCc3dId`, which only knows the ids of the cc3d ruleset.
 */
const EPOXY_TO_CC3D_PAINTER: Readonly<Record<string, string>> = Object.fromEntries([
  ...CHANNEL_PAINTER_COLORS.map((c) => [`pressure_plate_${c}`, `cc3d_plate_${c}`]),
  ...CHANNEL_PAINTER_COLORS.flatMap((c) => [
    [`hold_door_${c}_closed`, `cc3d_hold_door_${c}_closed`],
    [`hold_door_${c}_open`, `cc3d_hold_door_${c}_open`]
  ]),
  ...TOGGLE_PAINTER_COLORS.flatMap((c) => [
    [`toggle_wall_${c}_closed`, `cc3d_toggle_door_${c}_closed`],
    [`toggle_wall_${c}_open`, `cc3d_toggle_door_${c}_open`],
    [`toggle_button_${c}`, `cc3d_toggle_control_${c}`]
  ]),
  ...CHANNEL_PAINTER_COLORS.map((c) => [`color_block_${c}`, `cc3d_block_${c}`]),
  // Turrets are drawn as the cc3d bots they play.
  ['turret_fixed', 'cc3d_bot_static'],
  ['turret_cw', 'cc3d_bot_cw'],
  ['turret_ccw', 'cc3d_bot_ccw'],
  ['turret_multi', 'cc3d_bot_multi'],
  // The puppet is the yellow golem and its control the golem control; the skitter is in EPOXY_MOB_BASES.
  ['puppet', GOLEM_YELLOW_PAINTER_ID],
  ['puppet_control', GOLEM_CONTROL_PAINTER_ID],
  ...Object.entries(EPOXY_SHOT_PAINTERS)
]);

/** Colour of each floating block tile: water with the block faint under the surface. */
const FLOATING_BLOCK_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  CHANNEL_PAINTER_COLORS.map((c) => [`floating_block_${c}`, c])
);

const BLOCK_TYPES:ReadonlySet<string> = new Set([
  'dirt_block',
  'ice_block',
  ...CHANNEL_PAINTER_COLORS.map((c) => `color_block_${c}`)
]);
const GLOWING_MONSTERS: ReadonlySet<string> = new Set(['fireball', 'pink_ball', 'glider']);
/** Monsters drawn facing their direction of travel; the others stay upright and look towards it. */
const HEAD_FIRST_MONSTERS: ReadonlySet<string> = new Set(['bug', 'paramecium', 'glider', 'tank', 'fireball']);
const BLOCK_INSET_TILE = 0.05;
/** Block target mark, in tile units: ring inset from the cell edge, ring width, centre dot radius. */
const BLOCK_TARGET_MARK = { ringInset: 0.26, ringWidth: 0.08, dotRadius: 0.1 };
/** Outline of a block standing on a target, in tile units: inset from the block edge and width. */
const BLOCK_ON_TARGET_OUTLINE = { inset: 0.14, width: 0.07 };
const BLOCK_RADIUS_TILE = 0.1;
/**
 * Laser devices, in tile units: housing inset, nozzle length and width, emitter barrel width, emitter
 * turret radius and its glowing core radius, lens radius, gate bar width, glyph radius, post size.
 */
const LASER_DEVICE = {
  inset: 0.06,
  nozzleLength: 0.3,
  nozzleWidth: 0.26,
  barrelWidth: 0.2,
  turretRadius: 0.2,
  turretCoreRadius: 0.08,
  lensRadius: 0.26,
  barWidth: 0.1,
  glyphRadius: 0.09,
  postSize: 0.2,
  openAlpha: 0.45
};
/** Emitter nozzle bright core, as a fraction of the nozzle width and length. */
const LASER_NOZZLE_CORE_RATIO = 0.5;
/** Closed gate field overlap under the posts, as a fraction of a post. */
const LASER_GATE_FIELD_OVERLAP_RATIO = 0.5;
/** Gate bars across a closed laser gate. */
const LASER_GATE_BAR_COUNT = 3;
/** Lit receiver lens, in tile units: glowing halo radius and bright core radius. */
const LASER_LIT_LENS = { halo: 0.3, core: 0.15 };
/** Angle a north-facing emitter nozzle is turned by, per direction the emitter fires in. */
const LASER_EMITTER_ANGLE: Readonly<Record<Direction, number>> = {
  N: 0,
  E: QUARTER_TURN,
  S: QUARTER_TURN * 2,
  W: -QUARTER_TURN
};
/** Mirror, in tile units: frame inset, glass inset from the frame, width of the reflecting line. */
const MIRROR_BODY = { inset: 0.07, glassInset: 0.1, lineWidth: 0.1, shadowOffsetFactor: 1.5 };
/** Monster part sizes, in tile units (sprites are painted in a unit square). */
const LIMB_WIDTH = 0.05;
const PARAMECIUM_CILIA = 12;
const BLOB_LOBES = 8;
const TEETH_COUNT = 4;
const TANK_LINK_PITCH = 0.12;
/** Eyes shift towards where they look by this fraction of their radius; pupils further. */
const EYE_LOOK_SHIFT = 0.6;
const EYE_PUPIL_SHIFT = 0.4;
const EYE_PUPIL_RATIO = 0.5;
/** Player stride, in tile units: a lifted leg seen from the front, a swing seen from the side. */
const PLAYER_STRIDE_LIFT = 0.05;
const PLAYER_STRIDE_SWING = 0.06;
const PLAYER_ARM_SWING = 0.03;
/**
 * Vector drawing of the Julien skin, in tile units relative to the head centre: how far below
 * the top of the head the hair ends, how far below its centre the beard starts, the glasses and
 * the quiff and chest sun.
 */
const JULIEN_HAIRLINE_DROP = 0.12;
const JULIEN_BEARD_TOP = 0.03;
const JULIEN_GLASSES_Y = -0.035;
const JULIEN_LENS = { width: 0.1, height: 0.07, gap: 0.03, line: 0.016 } as const;
const JULIEN_GLINT = { size: 0.022, inset: 0.012 } as const;
const JULIEN_QUIFF = { x: -0.01, width: 0.1, height: 0.05, lift: 0.03 } as const;
const JULIEN_CHEST_SUN = { y: 0.06, radius: 0.045 } as const;
const JULIEN_MOUSTACHE = { y: 0.015, width: 0.18, height: 0.04 } as const;
const JULIEN_CHIN = { y: 0.78, rx: 0.09, ry: 0.05, sideShift: 0.045 } as const;
const JULIEN_SIDE_LENS_X = 0.06;
const JULIEN_TEMPLE_START_X = -0.02;
const JULIEN_EARBUD_RADIUS = 0.022;
const JULIEN_BEARD_SIDE = { x: 0.15, y: 0.11, rx: 0.045, ry: 0.07 } as const;
/** The player's shadow shrinks by this much per tile of hop height. */
const PLAYER_SHADOW_SHRINK = 2.5;
/** Ground shadow under floating items, as fractions of a tile; it shrinks as the item bobs up. */
const ITEM_SHADOW = { y: 0.86, rx: 0.22, ry: 0.06, shrinkPerTile: 4 } as const;
/** Force floor arrows scroll over this span (tile fraction) at this speed (tile fraction per frame). */
const FORCE_SCROLL_SPAN_TILE = 0.15;
const FORCE_SCROLL_SPEED_TILE = 0.015;
const EXIT_PULSE_BASE = 0.34;
const EXIT_PULSE_AMPLITUDE = 0.05;
const TELEPORT_CORE_BASE = 0.14;
const TELEPORT_CORE_AMPLITUDE = 0.03;
/** Radius of the colour-blind glyph at the centre of a colour teleporter, in tiles. */
const TELEPORT_GLYPH_RADIUS_TILE = 0.11;
/** Low bits of the cell hash turned into an animation phase. */
const PHASE_MASK = 0xff;
const WATER_SPARKLE_SPEED = 0.6;
const WATER_SPARKLE_RADIUS_TILE = 0.035;
const FIRE_EMBERS = 3;
const FIRE_EMBER_SPEED = 0.9;
const FIRE_EMBER_SIZE_TILE = 0.04;
/** Ice glints sweep during the first part of a slow cycle, then the ice rests. */
const ICE_GLINT_SPEED = 0.18;
const ICE_GLINT_WINDOW = 0.18;
const ICE_GLINT_WIDTH_TILE = 0.06;
/**
 * Ice bends: the slide path through a corner tile is a quarter-circle band centred on the open
 * corner of the cell. Radii and widths are fractions of a tile.
 */
const ICE_BEND_RADIUS_TILE = 0.5;
const ICE_BEND_BAND_WIDTH_TILE = 0.3;
const ICE_BEND_STREAK_WIDTH_TILE = 0.06;
const ICE_BEND_RIM_WIDTH_TILE = 0.05;
/** Angular length (radians) of the glint that runs along a bend; it changes direction every cycle. */
const ICE_BEND_GLINT_SPAN = 0.5;
/** Retro ice keeps a one-dot floor gutter around the cell; bends keep the same so the seam is even. */
const RETRO_ICE_INSET_PX = 1;

/** Mechanism wires and objective beacon styling. */
const LINK_DASH_PATTERN: number[] = [6, 4];
const NO_DASH: number[] = [];
const LINK_STYLE = {
  dashSpeed: 0.6,
  widthTile: 0.07,
  minWidthPx: 2,
  hoverAlpha: 0.95,
  trapAlpha: 0.72,
  clonerAlpha: 0.75,
  toggleAlpha: 0.65,
  teleportAlpha: 0.72,
  objectiveAlpha: 0.92,
  objectivePulseBase: 0.36,
  objectivePulseAmplitude: 0.12,
  objectivePulseSpeed: 0.16,
  objectiveHaloOffset: 0.14,
  objectiveRingWidthTile: 0.058,
  objectiveHaloWidthTile: 0.029
} as const;

export class PixelRenderer {
  private animFrame: number = 0;
  /** Animation clock in reference frames (fractional), advanced from real elapsed time. */
  private timeTick: number = 0;
  private lastFrameTimeMs: number | null = null;
  private currentViewportTiles: number = 13;
  private visualViewportTiles: number = 13;
  /** Camera, tile size and canvas size of the last drawn frame, for mapping clicks to cells. */
  private lastFrame: FrameGeometry | null = null;
  private lastMapWidth = 0;
  private lastMapHeight = 0;
  private style: GraphicsStyle = 'modern';
  private themeId: string = 'cyber_neon';
  private shakeIntensity: number = 0;
  private plannedPath: GridPoint[] = [];
  private showMechanismLinks: boolean = false;
  private hoveredGridPoint: GridPoint | null = null;
  private objectivePoint: GridPoint | null = null;

  private visualPlayerPos: { x: number; y: number } | null = null;
  private visualCameraPos: { x: number; y: number } | null = null;
  private visualEntityPos: Map<number, { x: number; y: number }> = new Map();
  private readonly activeEntityUids: Set<number> = new Set();
  // Cells covered by pushable blocks this frame (key y * width + x); a block hides what is under it.
  private readonly blockCells: Set<number> = new Set();
  private blockCellsWidth: number = 0;
  private hiddenLayerMarkers: boolean = HIDDEN_LAYER_MARKER_DEFAULT;
  private readonly panelLayerCache = new Map<string, readonly RetroLayer[]>();
  private lastLevelId: string = '';

  private particles: Particle[] = [];
  private shockwaves: ShockwaveRing[] = [];

  // Terrain cache: static tiles of the visible area plus a margin, redrawn only when
  // the terrain, trap states, style, theme or tile size change, or the camera leaves it.
  private readonly terrainSnapshot = new TerrainSnapshot();
  private terrainFeatures: TerrainFeatures = EMPTY_TERRAIN_FEATURES;
  private terrainCache: HTMLCanvasElement | null = null;
  private terrainCacheCtx: CanvasRenderingContext2D | null = null;
  private terrainCacheKey: string = '';
  private trapStateKey: string = '';
  private blockCellsStateKey: string = '';
  private readonly cacheRegion = { x0: 0, y0: 0, x1: -1, y1: -1 };

  /** Pre-rendered glowing shapes, keyed by kind, style and size. */
  private readonly sprites: Map<string, HTMLCanvasElement> = new Map();

  /** Wall-joining and shadow-casting tile sets, rebuilt when the settings object changes. */
  private tileSetsSource: RenderSettings | null = null;
  private wallJoinTiles: ReadonlySet<string> = new Set();
  private shadowCasterTiles: ReadonlySet<string> = new Set();
  private litTiles: ReadonlySet<string> = new Set();
  /** Retro shadow dithering, one pattern per dot size and colour. */
  private readonly ditherPatterns: Map<string, CanvasPattern> = new Map();
  /** Composed 16x16 retro sprites (tiles, items, monsters, player), keyed by theme and layer stack. */
  private readonly resolveTile = (id: string): TileDefinition => ConfigRegistry.getTile(id);
  private readonly retroCanvases: Map<string, HTMLCanvasElement> = new Map();
  private retroRampsSource: Record<string, Record<string, string[]>> | undefined;
  /** False until the palettes object has been validated once; a new object is validated again. */
  private retroPalettesSeen = false;
  private retroPalettesValid = false;
  /** Floor shadow extent in sprite pixels, recomputed only when the configured depth changes. */
  private retroExtentTile = Number.NaN;
  private retroExtent = { depth: 0, side: 0 };
  /** The LCD grid is painted once per size and scale, then blitted every frame. */
  private lcdGridCanvas: HTMLCanvasElement | null = null;
  private lcdGridKey = '';
  private retroRampsTheme: string = '';
  private retroRampsCache: RetroRamps = {};
  /** Sprite style in use, rebuilt when the style, the 16-Bit ramps or the 32-Bit palettes change. */
  private spriteStyleMemo: {
    styleId: GraphicsStyle;
    ramps16: RetroRamps;
    palettes32: RetroPaletteTable;
    cacheEntries: number;
    value: ActiveSpriteStyle | null;
    /** The 16-Bit sprites a 32-Bit style degrades to when tiles are drawn smaller than its sprites. */
    small: ActiveSpriteStyle | null;
  } | null = null;
  /** Tile size in pixels of the frame being drawn; infinite outside a frame (icons, editor). */
  private frameTilePx = Number.POSITIVE_INFINITY;
  /** Sprite style resolved once for the frame being drawn; undefined until first asked in a frame. */
  private frameSprite: ActiveSpriteStyle | null | undefined;
  /** True while a frame is drawn, so the per-frame sprite style may be kept. */
  private inFrame = false;
  /** The next frame is not timed: it rebuilds caches after a style or theme change. */
  private skipBudgetFrame = false;
  /** Rasterized 32-Bit sprites, one instance for every theme (the keys carry the theme). */
  private retro32Cache: Retro32SpriteCache | null = null;
  private retro32CacheSize = 0;
  /** Problems found in the 32-Bit palette overrides, checked once per palettes object. */
  private retro32PaletteErrors: string[] = [];
  /** Palettes the 32-Bit cache was filled from; a new object empties it. */
  private retro32CachePalettes: { p16: RetroPaletteTable; p32: RetroPaletteTable } | null = null;
  /** Colours of the active Retro HD style, rebuilt when the style, the theme or one of the config tables changes. */
  private styleColoursMemo: {
    styleId: string;
    themeId: string;
    palette: unknown;
    themes: unknown;
    table: unknown;
    families: unknown;
    value: StyleColours;
  } | null = null;
  /** Config objects whose invalid Retro HD palettes were already reported. */
  private readonly reportedStyleConfigs: WeakSet<object> = new WeakSet();
  /** Texture a Retro HD style lays over the board, painted once per size and blitted every frame. */
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayKey = '';
  /** Shine overlays of 32-Bit items and blocks, keyed like retroCanvases plus the sweep step. */
  private readonly retroShineCanvases: Map<string, HTMLCanvasElement> = new Map();
  /** Style id the cached shadow extent was computed for. */
  private retroExtentStyle = '';
  /** Low resolution canvas the retro scene is drawn on, one pixel per sprite pixel. */
  private retroScene: HTMLCanvasElement | null = null;
  private retroSceneCtx: CanvasRenderingContext2D | null = null;
  /** Bend geometry per corner ice tile id, null for ice that slides straight. */
  private readonly iceBends: Map<string, IceBendGeometry | null> = new Map();

  /** Sokoban skin images, once the app has installed them; null in tests that do not. */
  private skinLoader: SokobanSkinLoader | null = null;
  /** The player's choice; the skin also needs a Sokoban level and loaded images. */
  private skinEnabled = true;
  /** Skin in use for the scene being drawn; read only by the scene path, never by public draw calls. */
  private skinActive = false;
  /** Look of the player character; the default is the stock player. */
  private playerSkin: PlayerSkinId = DEFAULT_PLAYER_SKIN;

  private readonly lighting = new LightingLayer();
  /** Lights gathered while drawing a frame, reused across frames. */
  private readonly lights: Light[] = [];
  /** Scratch neighbourhood for animated tiles, which only need the cell hash. */
  private readonly animNeighbours: TileNeighbours = { ...ISOLATED_TILE };
  private lcdEnabled: boolean = false;
  private reducedMotion: boolean = false;
  /** Opening iris: 0 when a level starts, 1 once fully open. */
  private irisProgress: number = 1;
  private irisLevelId: string = '';
  private irisLastSteps: number = 0;
  private quality: GraphicsQuality | typeof AUTO_QUALITY_ID = AUTO_QUALITY_ID;
  private effectiveQuality: GraphicsQuality = QUALITY_LEVELS[0];
  private readonly frameGuard = new FrameBudgetGuard();
  private onQualityLowered: ((quality: GraphicsQuality) => void) | null = null;

  public incrementFrame(): void {
    this.animFrame = (this.animFrame + 1) % 60;
  }

  public getStyle(): GraphicsStyle {
    return this.style;
  }

  public setStyle(style: GraphicsStyle): void {
    if (style !== this.style) this.restartFrameBudget();
    this.style = style;
  }

  public toggleStyle(): GraphicsStyle {
    this.restartFrameBudget();
    this.style = nextRenderStyle(this.style).id;
    return this.style;
  }

  /** Installs the loader of the Sokoban skin images. */
  public setSkinLoader(loader: SokobanSkinLoader | null): void {
    this.skinLoader = loader;
  }

  /**
   * One string that changes whenever how the same cells look changes (style, theme, player skin, quality):
   * a caller that keeps a picture of the map compares it to know the picture is stale.
   */
  public getAppearanceKey(): string {
    return [this.getStyle(), this.getThemeId(), this.getPlayerSkin(), this.getQuality()].join('|');
  }

  public getPlayerSkin(): PlayerSkinId {
    return this.playerSkin;
  }

  public setPlayerSkin(skin: PlayerSkinId): void {
    this.playerSkin = skin;
  }

  public isSokobanSkinEnabled(): boolean {
    return this.skinEnabled;
  }

  public setSokobanSkinEnabled(enabled: boolean): void {
    this.skinEnabled = enabled;
  }

  public getThemeId(): string {
    return this.themeId;
  }

  public setThemeId(id: string): void {
    if (id !== this.themeId) this.restartFrameBudget();
    this.themeId = id;
  }

  /** Accent colour of the active theme, for the HUD to follow the biome. */
  public getThemeAccent(): string | undefined {
    return this.getRawTheme()?.accentGlow;
  }

  /** True when the LCD grid is shown: it was asked for and the active style allows it. */
  public isLcdEnabled(): boolean {
    return this.lcdEnabled && this.descriptor().lcdAllowed;
  }

  /** The LCD choice the player made, kept whatever the active style does with it. */
  public getLcdPreference(): boolean {
    return this.lcdEnabled;
  }

  private descriptor(): RenderStyleDescriptor {
    return getRenderStyle(this.style);
  }

  /** True for the vector HD Neon drawing, false for the sprite styles and the flat retro fallback look. */
  private isHdVector(): boolean {
    return this.descriptor().sprite === null;
  }

  public setLcdEnabled(enabled: boolean): void {
    this.lcdEnabled = enabled;
  }

  /**
   * With reduced motion, the opening iris, the hops, the bobbing, the screen shake and the ice
   * glints are skipped.
   */
  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** The quality chosen by the player; 'auto' starts high and steps down when frames run slow. */
  public getQuality(): GraphicsQuality | typeof AUTO_QUALITY_ID {
    return this.quality;
  }

  public setQuality(quality: GraphicsQuality | typeof AUTO_QUALITY_ID): void {
    this.quality = quality;
    this.effectiveQuality = quality === AUTO_QUALITY_ID ? QUALITY_LEVELS[0] : quality;
    this.frameGuard.reset();
  }

  /** Quality in use right now, which differs from the chosen one only in automatic mode. */
  public getEffectiveQuality(): GraphicsQuality {
    return this.effectiveQuality;
  }

  /** Called when automatic quality steps down, with the new level. */
  public setOnQualityLowered(callback: ((quality: GraphicsQuality) => void) | null): void {
    this.onQualityLowered = callback;
  }

  /** Drops the timings gathered so far and ignores the next frame, which rebuilds caches. */
  private restartFrameBudget(): void {
    this.frameGuard.reset();
    this.skipBudgetFrame = true;
  }

  /** In automatic mode, steps quality down one level when frames keep exceeding the budget. */
  private watchFrameBudget(frameMs: number): void {
    if (this.skipBudgetFrame) {
      // A frame that rebuilt caches is a one-off cost, not a sign the device is slow.
      this.skipBudgetFrame = false;
      this.frameGuard.reset();
      return;
    }
    if (this.quality !== AUTO_QUALITY_ID) return;
    if (!this.frameGuard.record(frameMs, resolveFrameBudget(ConfigRegistry.getGame().graphics))) return;
    const index = QUALITY_LEVELS.indexOf(this.effectiveQuality);
    if (index >= QUALITY_LEVELS.length - 1) return;
    this.effectiveQuality = QUALITY_LEVELS[index + 1];
    this.onQualityLowered?.(this.effectiveQuality);
  }

  public cycleTheme(): string {
    const themes = ConfigRegistry.getGame().themes;
    if (!themes) return this.themeId;
    const keys = Object.keys(themes);
    if (keys.length === 0) return this.themeId;
    const idx = keys.indexOf(this.themeId);
    this.restartFrameBudget();
    this.themeId = keys[(idx + 1) % keys.length];
    return this.themeId;
  }

  public setPlannedPath(points: GridPoint[]): void {
    this.plannedPath = points;
  }

  public setHoveredGridPoint(pt: GridPoint | null): void {
    this.hoveredGridPoint = pt;
  }

  public setObjectivePoint(pt: GridPoint | null): void {
    this.objectivePoint = pt;
  }

  public toggleMechanismLinks(): boolean {
    this.showMechanismLinks = !this.showMechanismLinks;
    return this.showMechanismLinks;
  }

  public setShowMechanismLinks(show: boolean): void {
    this.showMechanismLinks = show;
  }

  public isShowingMechanismLinks(): boolean {
    return this.showMechanismLinks;
  }

  public screenToGrid(canvas: HTMLCanvasElement, clientX: number, clientY: number): GridPoint | null {
    // Map the click with the geometry of the last drawn frame, not the canvas size now.
    if (!this.lastFrame) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const gridCfg = ConfigRegistry.getGame().grid;
    return pointToGrid(
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
      this.lastFrame,
      this.lastMapWidth || gridCfg.mapWidth,
      this.lastMapHeight || gridCfg.mapHeight
    );
  }

  public getViewportTiles(): number {
    return this.currentViewportTiles;
  }

  public setViewportTiles(tiles: number): void {
    this.currentViewportTiles = tiles;
  }

  public triggerVisualEvent(
    kind: 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win',
    gridX: number,
    gridY: number,
    colorKey?: string
  ): void {
    const pal = this.pal();
    const settings = this.getSettings();

    const fxKey = FX_COLOR_KEYS[kind];
    const primaryColor = fxKey ? pal[fxKey] : (colorKey && pal[colorKey]) || pal.yellow;

    if (kind === 'explosion') {
      this.shakeIntensity = this.reducedMotion ? 0 : settings.screenShakeExplosion;
    }

    // Shockwaves and particle bursts are pure motion: skipped under reduced motion and in styles without effects.
    if (this.reducedMotion || !this.effectsActive()) return;

    if (kind === 'teleport' || kind === 'unlock' || kind === 'win' || kind === 'explosion') {
      this.shockwaves.push({
        x: gridX + 0.5,
        y: gridY + 0.5,
        radius: settings.shockwaveStartRadius,
        maxRadius: kind === 'win' ? settings.shockwaveWinMaxRadius : settings.shockwaveMaxRadius,
        color: primaryColor,
        alpha: 1
      });
    }

    const burstCount = settings.particleBurstCount;
    for (let i = 0; i < burstCount; i++) {
      if (this.particles.length >= settings.maxParticles) {
        this.particles.shift();
      }
      const angle = (FULL_TURN * i) / burstCount + (Math.random() - 0.5) * settings.particleAngleJitter;
      const speed = settings.particleSpeedMin + Math.random() * settings.particleSpeedRange;
      this.particles.push({
        x: gridX + 0.5,
        y: gridY + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: settings.particleRadiusMinTile + Math.random() * settings.particleRadiusRangeTile,
        color: i % settings.particleSparkleEvery === 0 ? pal.fxSparkle : primaryColor,
        alpha: 1,
        decay: settings.particleDecayMin + Math.random() * settings.particleDecayRange
      });
    }
  }

  /** Advances the animation clock from the real frame time; returns the frame scale. */
  private advanceClock(settings: RenderSettings): number {
    const now = performance.now();
    const frameScale =
      this.lastFrameTimeMs === null ? 1 : frameScaleFromDelta(now - this.lastFrameTimeMs, settings.maxFrameDeltaMs);
    this.lastFrameTimeMs = now;
    this.timeTick += frameScale;
    return frameScale;
  }

  /** The theme in use, in the colours of the active style. */
  private getActiveTheme(): ThemePalette | undefined {
    if (!this.descriptor().finish) return this.getRawTheme();
    return this.getStyleColours().theme;
  }

  /** The theme in use as game.json declares it (the HUD follows these colours in every style). */
  private getRawTheme(): ThemePalette | undefined {
    const gameCfg = ConfigRegistry.getGame();
    return resolveTheme(gameCfg.themes, this.themeId, gameCfg.graphics?.defaultTheme);
  }

  /** The palette in use: game.json's own, or recoloured for a Retro HD style. */
  private pal(): Record<string, string> {
    if (!this.descriptor().finish) return ConfigRegistry.getGame().palette;
    return this.getStyleColours().palette;
  }

  /**
   * Palette and theme of the active Retro HD style, rebuilt only when the style, the theme or one of
   * the config objects it comes from changes. An unusable config is reported once and the style draws
   * with the HD Neon colours.
   */
  private getStyleColours(): StyleColours {
    const reported = this.reportedStyleConfigs;
    const desc = this.descriptor();
    const game = ConfigRegistry.getGame();
    const memo = this.styleColoursMemo;
    if (
      memo &&
      memo.styleId === desc.id &&
      memo.themeId === this.themeId &&
      memo.palette === game.palette &&
      memo.themes === game.themes &&
      memo.table === game.renderStylePalettes &&
      memo.families === game.renderStyleFamilies
    ) {
      return memo.value;
    }
    const theme = this.getRawTheme();
    let value: StyleColours = { palette: game.palette, theme };
    const key = desc.transformKey;
    if (key) {
      const errors = [
        ...findStylePaletteErrors(game.renderStylePalettes, [key]),
        ...findStyleFamilyErrors(game.renderStyleFamilies, Object.keys(game.palette))
      ];
      if (errors.length > 0) {
        // Once per config object, however often the theme or style changes.
        if (!reported.has(game)) {
          reported.add(game);
          console.error(STYLE_PALETTE_INVALID_REPORT, errors.join('; '));
        }
      } else {
        const recolour = createRetroHdRecolour(
          (game.renderStylePalettes ?? {})[key],
          game.renderStyleFamilies ?? { palette: {}, theme: {} }
        );
        value = { palette: recolour.palette(game.palette), theme: theme ? recolour.theme(theme) : undefined };
      }
    }
    if (memo && (memo.palette !== game.palette || memo.table !== game.renderStylePalettes || memo.families !== game.renderStyleFamilies)) {
      // The config was replaced: sprites and the terrain cache hold colours of the old tables.
      this.sprites.clear();
      this.terrainCacheKey = '';
    }
    this.styleColoursMemo = {
      styleId: desc.id,
      themeId: this.themeId,
      palette: game.palette,
      themes: game.themes,
      table: game.renderStylePalettes,
      families: game.renderStyleFamilies,
      value
    };
    return value;
  }

  public renderViewport(ctx: CanvasRenderingContext2D, engine: PlayEngine): void {
    const startMs = performance.now();
    this.inFrame = true;
    this.frameSprite = undefined;
    this.skinActive =
      this.skinEnabled && engine.getLevel().winRule === 'targets' && (this.skinLoader?.ready ?? false);
    try {
      this.renderScene(ctx, engine);
    } finally {
      this.skinActive = false;
      this.inFrame = false;
      this.frameSprite = undefined;
      this.frameTilePx = Number.POSITIVE_INFINITY;
    }
    this.watchFrameBudget(performance.now() - startMs);
  }

  private renderScene(ctx: CanvasRenderingContext2D, engine: PlayEngine): void {
    const gameCfg = ConfigRegistry.getGame();
    const settings = this.getSettings();
    const frameScale = this.advanceClock(settings);
    const gridCfg = gameCfg.grid;
    // The level sets its own size; the grid config only gives the default.
    const mapWidth = engine.getMapWidth() || gridCfg.mapWidth;
    const mapHeight = engine.getMapHeight() || gridCfg.mapHeight;
    this.lastMapWidth = mapWidth;
    this.lastMapHeight = mapHeight;
    const targetTiles = this.currentViewportTiles || gridCfg.viewportWidth;
    const desc = this.descriptor();
    const smooth = desc.smoothMotion;
    const camLerp = smooth ? scaleLerpFactor(settings.cameraLerpFactor, frameScale) : 1;

    if (
      !this.visualViewportTiles ||
      !smooth ||
      Math.abs(targetTiles - this.visualViewportTiles) < settings.zoomSnapEpsilonTiles
    ) {
      this.visualViewportTiles = targetTiles;
    } else {
      this.visualViewportTiles += (targetTiles - this.visualViewportTiles) * camLerp;
    }

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const baseTiles = this.visualViewportTiles;
    const minSide = Math.max(1, Math.min(canvasWidth, canvasHeight));
    const tilePixelSize = minSide / baseTiles;
    this.frameTilePx = tilePixelSize;
    // Tiles across the canvas; a map smaller than this is centred by the camera.
    const viewportWidth = canvasWidth / tilePixelSize;
    const viewportHeight = canvasHeight / tilePixelSize;
    const player = engine.getPlayer();

    // Reset interpolation caches on level change or undo/restart
    if (this.lastLevelId !== engine.getLevel().id || engine.getStepsCount() === 0) {
      this.lastLevelId = engine.getLevel().id;
      this.visualPlayerPos = { x: player.x, y: player.y };
    }

    const entityLerp = smooth ? scaleLerpFactor(settings.entityLerpFactor, frameScale) : 1;
    const snapDist = settings.teleportSnapDistance;

    if (!this.visualPlayerPos) {
      this.visualPlayerPos = { x: player.x, y: player.y };
    } else {
      const dist = Math.hypot(player.x - this.visualPlayerPos.x, player.y - this.visualPlayerPos.y);
      if (dist > snapDist) {
        this.visualPlayerPos.x = player.x;
        this.visualPlayerPos.y = player.y;
      } else {
        this.visualPlayerPos.x += (player.x - this.visualPlayerPos.x) * entityLerp;
        this.visualPlayerPos.y += (player.y - this.visualPlayerPos.y) * entityLerp;
      }
    }

    const halfW = viewportWidth / 2 - 0.5;
    const halfH = viewportHeight / 2 - 0.5;
    const targetCamX = cameraPosition(this.visualPlayerPos.x - halfW, mapWidth, viewportWidth);
    const targetCamY = cameraPosition(this.visualPlayerPos.y - halfH, mapHeight, viewportHeight);

    if (!this.visualCameraPos || !smooth) {
      this.visualCameraPos = {
        x: cameraPosition(player.x - Math.floor(viewportWidth / 2), mapWidth, viewportWidth),
        y: cameraPosition(player.y - Math.floor(viewportHeight / 2), mapHeight, viewportHeight)
      };
    } else {
      this.visualCameraPos.x += (targetCamX - this.visualCameraPos.x) * camLerp;
      this.visualCameraPos.y += (targetCamY - this.visualCameraPos.y) * camLerp;
    }

    // Sprite styles snap the camera to a sprite pixel, so overlays and clicks line up with the low-res scene.
    const sprite = this.getSpriteStyle();
    const spriteSize = sprite?.spec.tileSize ?? RETRO_SPRITE_SIZE;
    const snapCamera = (v: number): number => (desc.pixelSnap ? Math.round(v * spriteSize) / spriteSize : v);
    const camX = snapCamera(this.visualCameraPos.x);
    const camY = snapCamera(this.visualCameraPos.y);
    this.lastFrame = { camX, camY, tilePixelSize, canvasWidth, canvasHeight };

    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const entities = engine.getEntities();
    this.blockCellsWidth = mapWidth;
    collectBlockCells(entities, mapWidth, this.blockCells);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // The sprite styles draw the scene on a canvas with one pixel per sprite pixel, then scale it up
    // once, so every sprite pixel stays a square block whatever the zoom.
    const spriteScale = tilePixelSize / spriteSize;
    const lowCtx =
      desc.lowResScene && sprite && !this.skinActive
        ? this.prepareRetroScene(Math.ceil(canvasWidth / spriteScale), Math.ceil(canvasHeight / spriteScale))
        : null;
    const lowRes = lowCtx !== null;
    const sceneCtx = lowCtx ?? ctx;
    // Tile size in the space the scene is drawn in.
    const unit = lowRes ? spriteSize : tilePixelSize;

    ctx.save();
    if (this.shakeIntensity > settings.screenShakeMinIntensity) {
      const sx = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      const sy = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      ctx.translate(sx, sy);
      this.shakeIntensity *= scaleDecay(settings.screenShakeDecay, frameScale);
    } else {
      this.shakeIntensity = 0;
    }

    const startTileX = Math.max(0, Math.floor(camX));
    const endTileX = Math.min(mapWidth - 1, Math.ceil(camX + viewportWidth));
    const startTileY = Math.max(0, Math.floor(camY));
    const endTileY = Math.min(mapHeight - 1, Math.ceil(camY + viewportHeight));

    this.syncTerrainCache(engine, terrain, unit, startTileX, endTileX, startTileY, endTileY, settings);

    // Every tile is placed relative to the cache origin so overlays line up with it.
    const region = this.cacheRegion;
    const originX = Math.round((region.x0 - camX) * unit);
    const originY = Math.round((region.y0 - camY) * unit);
    const drawSize = Math.ceil(unit);
    if (this.terrainCache) {
      sceneCtx.drawImage(this.terrainCache, originX, originY);
    }

    const animatedTiles = desc.sprite === null
      ? MODERN_ANIMATED_TILES
      : lowRes
        ? RETRO_SPRITE_ANIMATED_TILES
        : RETRO_ANIMATED_TILES;
    const animNeighbours = this.animNeighbours;
    for (const cell of this.terrainFeatures.animatedCells) {
      if (cell.x < startTileX || cell.x > endTileX || cell.y < startTileY || cell.y > endTileY) continue;
      if (!animatedTiles.has(cell.tileId)) continue;
      if (this.isBlockCovered(cell.x, cell.y)) continue;
      if (this.skinActive && this.skinLoader?.getTerrain(cell.tileId)) continue;
      const px = originX + Math.floor((cell.x - region.x0) * unit);
      const py = originY + Math.floor((cell.y - region.y0) * unit);
      animNeighbours.hash = cellHash(cell.x, cell.y);
      // A retro animated tile redraws its floor shadow, which the frame would otherwise cover.
      animNeighbours.shadowMask = lowRes ? neighbourMask(terrain, cell.x, cell.y, this.shadowCasterTiles, false) : 0;
      this.drawTile(sceneCtx, cell.tileId, px, py, drawSize, false, false, 'animated', animNeighbours);
    }

    this.drawCellOverlays(sceneCtx, engine, mapWidth, startTileX, endTileX, startTileY, endTileY, originX, originY, region, unit, drawSize);

    this.drawLaserBeams(sceneCtx, engine, entities, terrain, originX, originY, region, unit, !lowRes);

    // Lights are gathered while the scene is drawn and applied once it is complete.
    const lit = this.lightingActive() && settings.lightingEnabled;
    this.lights.length = 0;
    if (lit) {
      for (const cell of this.terrainFeatures.litCells) {
        if (
          cell.x < startTileX - LIGHT_MARGIN_TILES ||
          cell.x > endTileX + LIGHT_MARGIN_TILES ||
          cell.y < startTileY - LIGHT_MARGIN_TILES ||
          cell.y > endTileY + LIGHT_MARGIN_TILES
        ) {
          continue;
        }
        if (this.isBlockCovered(cell.x, cell.y)) continue;
        this.addLight(cell.tileId, cell.x - camX, cell.y - camY, tilePixelSize, settings);
      }
    }

    for (let my = startTileY; my <= endTileY; my++) {
      const itemRow = items[my];
      if (!itemRow) continue;
      for (let mx = startTileX; mx <= endTileX; mx++) {
        const itemId = itemRow[mx];
        if (itemId && !this.isBlockCovered(mx, my)) {
          const px = originX + Math.floor((mx - region.x0) * unit);
          const py = originY + Math.floor((my - region.y0) * unit);
          this.drawItem(sceneCtx, itemId, px, py, drawSize);
          if (lit) this.addLight(itemId, mx - camX, my - camY, tilePixelSize, settings);
        }
      }
    }

    // Update & render entities with smooth interpolation
    const activeUids = this.activeEntityUids;
    activeUids.clear();
    for (const ent of entities) {
      activeUids.add(ent.uid);
      let vPos = this.visualEntityPos.get(ent.uid);
      if (!vPos) {
        vPos = { x: ent.x, y: ent.y };
        this.visualEntityPos.set(ent.uid, vPos);
      } else {
        const dist = Math.hypot(ent.x - vPos.x, ent.y - vPos.y);
        if (dist > snapDist) {
          vPos.x = ent.x;
          vPos.y = ent.y;
        } else {
          vPos.x += (ent.x - vPos.x) * entityLerp;
          vPos.y += (ent.y - vPos.y) * entityLerp;
        }
      }

      if (
        vPos.x >= camX - 1 &&
        vPos.x <= camX + viewportWidth + 1 &&
        vPos.y >= camY - 1 &&
        vPos.y <= camY + viewportHeight + 1
      ) {
        // Retro sprites sit on whole sprite pixels, like the terrain they stand on.
        const px = lowRes ? originX + Math.round((vPos.x - region.x0) * unit) : (vPos.x - camX) * tilePixelSize;
        const py = lowRes ? originY + Math.round((vPos.y - region.y0) * unit) : (vPos.y - camY) * tilePixelSize;
        const onTarget = ent.kind === 'block' && terrain[ent.y]?.[ent.x] === BLOCK_TARGET_TILE_ID;
        const skinned = this.skinActive
          ? ((onTarget ? this.skinLoader?.getBlockOnTarget() : null) ?? this.skinLoader?.getEntity(ent.type) ?? null)
          : null;
        if (skinned) {
          this.drawSkinLayers(sceneCtx, skinned, px, py, unit);
        } else {
          // A turret is drawn facing the way it fires, which is not the way it was pushed.
          this.drawEntity(sceneCtx, ent.type, ent.facing ?? ent.dir, px, py, unit);
          if (onTarget) this.drawBlockOnTargetOutline(sceneCtx, px, py, unit);
        }
        if (lit) this.addLight(ent.type, vPos.x - camX, vPos.y - camY, tilePixelSize, settings);
      }
    }

    for (const uid of this.visualEntityPos.keys()) {
      if (!activeUids.has(uid)) {
        this.visualEntityPos.delete(uid);
      }
    }

    // Shots in flight sit in their cell, over the entities and under the player.
    for (const shot of engine.getShots?.() ?? []) {
      if (shot.x < camX - 1 || shot.x > camX + viewportWidth + 1 || shot.y < camY - 1 || shot.y > camY + viewportHeight + 1) continue;
      const px = lowRes ? originX + Math.round((shot.x - region.x0) * unit) : (shot.x - camX) * tilePixelSize;
      const py = lowRes ? originY + Math.round((shot.y - region.y0) * unit) : (shot.y - camY) * tilePixelSize;
      this.drawCc3dEntity(sceneCtx, SHOT_PAINTER_ID, shot.dir, px, py, unit);
    }

    // Render A* Click-to-Move planned path waypoints (retro draws it after the scene is scaled up)
    if (!lowRes) this.drawPlannedPath(ctx, camX, camY, tilePixelSize, settings);

    const playerPx = (this.visualPlayerPos.x - camX) * tilePixelSize;
    const playerPy = (this.visualPlayerPos.y - camY) * tilePixelSize;
    // Smooth styles: stride and hop while gliding between cells. The others snap to cells, so the
    // stride alternates with each step taken instead.
    const steps = engine.getStepsCount();
    const remaining = Math.hypot(player.x - this.visualPlayerPos.x, player.y - this.visualPlayerPos.y);
    let walkFrame = 0;
    let hop = 0;
    if (smooth) {
      if (remaining > MOVING_EPSILON_TILES) {
        walkFrame = 1 + (steps % WALK_FRAMES);
        if (!this.reducedMotion) hop = Math.sin(Math.min(1, remaining) * Math.PI) * settings.playerHopTile;
      }
    } else if (steps > 0) {
      walkFrame = 1 + (steps % WALK_FRAMES);
    }
    const spritePx = lowRes ? originX + Math.round((this.visualPlayerPos.x - region.x0) * unit) : playerPx;
    const spritePy = lowRes ? originY + Math.round((this.visualPlayerPos.y - region.y0) * unit) : playerPy;
    this.drawPlayer(
      sceneCtx,
      spritePx,
      spritePy,
      unit,
      player.dir,
      player.inWater,
      player.alive,
      walkFrame,
      hop
    );

    if (lowCtx) {
      this.presentRetroScene(ctx, lowCtx.canvas, spriteScale);
      this.drawPlannedPath(ctx, camX, camY, tilePixelSize, settings);
    }

    if (lit) {
      this.addLight('player', this.visualPlayerPos.x - camX, this.visualPlayerPos.y - camY - hop, tilePixelSize, settings);
      const pal = this.pal();
      this.lighting.render(
        ctx,
        this.lights,
        { ambient: pal.lightAmbient, mask: pal.lightMask, vignette: pal.vignetteShade },
        {
          ambientAlpha: settings.lightingAmbientAlpha,
          tintAlpha: settings.lightingTintAlpha,
          resolutionDivisor: settings.lightingResolutionDivisor,
          vignetteAlpha: settings.vignetteAlpha,
          vignetteInnerRatio: settings.vignetteInnerRatio
        }
      );
    } else if (this.isLcdEnabled()) {
      this.drawLcdGrid(ctx, spriteScale, settings);
    }
    this.drawStyleOverlay(ctx, tilePixelSize, settings);

    this.drawMechanismLinksAndObjective(ctx, engine, camX, camY, tilePixelSize);

    if (this.effectsActive()) {
      this.updateAndDrawEffects(ctx, camX, camY, tilePixelSize, frameScale, settings);
    }

    ctx.restore();

    const half = tilePixelSize / 2;
    this.drawIris(ctx, engine, playerPx + half, playerPy + half, tilePixelSize, frameScale, settings);
  }

  /**
   * Adds the light of `id` (a tile, item, monster or 'player') centred on the cell whose
   * top-left corner is (gx, gy) in tiles from the camera, when that id gives off light.
   */
  private addLight(id: string, gx: number, gy: number, tilePixelSize: number, settings: RenderSettings): void {
    const source = settings.lightSources[id];
    if (!source) return;
    const color = this.pal()[source.colorKey];
    if (!color) return;
    let radius = source.radiusTile * tilePixelSize;
    if (FLICKERING_LIGHTS.has(id) && !this.reducedMotion) {
      // Each light flickers on its own phase, taken from where it is.
      const phase = this.timeTick * LIGHT_FLICKER_SPEED + gx * LIGHT_PHASE_X + gy * LIGHT_PHASE_Y;
      radius *= 1 + Math.sin(phase) * settings.lightingFlicker;
    }
    this.lights.push({ x: (gx + 0.5) * tilePixelSize, y: (gy + 0.5) * tilePixelSize, radius, color });
  }

  /** Draws the A* click-to-move path: a line through the waypoints and a ring on the destination. */
  private drawPlannedPath(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tilePixelSize: number,
    settings: RenderSettings
  ): void {
    if (this.plannedPath.length === 0) return;
    ctx.save();
    const theme = this.getActiveTheme();
    const pathColor = theme ? theme.accentGlow : this.pal().pathLine;
    ctx.strokeStyle = pathColor;
    ctx.fillStyle = pathColor;
    ctx.lineWidth = tilePixelSize * settings.pathLineWidthTile;
    ctx.globalAlpha = settings.pathAlpha;
    ctx.beginPath();
    for (let i = 0; i < this.plannedPath.length; i++) {
      const pt = this.plannedPath[i];
      const cx = (pt.x + 0.5 - camX) * tilePixelSize;
      const cy = (pt.y + 0.5 - camY) * tilePixelSize;
      if (i === 0) {
        ctx.moveTo(cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();

    const lastPt = this.plannedPath[this.plannedPath.length - 1];
    const tx = (lastPt.x + 0.5 - camX) * tilePixelSize;
    const ty = (lastPt.y + 0.5 - camY) * tilePixelSize;
    ctx.beginPath();
    ctx.arc(tx, ty, tilePixelSize * 0.22, 0, FULL_TURN);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Retro LCD look: dark gaps between screen pixels, one screen pixel being one sprite pixel of
   * the scaled-up scene, so the grid lines follow the pixels of the sprites.
   */
  private drawLcdGrid(ctx: CanvasRenderingContext2D, spriteScale: number, settings: RenderSettings): void {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const gap = Math.max(1, Math.round(spriteScale * LCD_GAP_RATIO));
    const colour = this.pal().lcdGrid;
    ctx.save();
    ctx.globalAlpha = settings.lcdGridAlpha;
    const key = `${width}|${height}|${spriteScale}|${gap}|${colour}`;
    if (key !== this.lcdGridKey || !this.lcdGridCanvas) {
      this.lcdGridKey = key;
      this.lcdGridCanvas = null;
      if (typeof document === 'undefined') {
        this.paintLcdGrid(ctx, width, height, spriteScale, gap, colour);
        ctx.restore();
        return;
      }
      const grid = document.createElement('canvas');
      grid.width = width;
      grid.height = height;
      const gctx = grid.getContext('2d');
      if (gctx) {
        this.paintLcdGrid(gctx, width, height, spriteScale, gap, colour);
        this.lcdGridCanvas = grid;
      }
    }
    if (this.lcdGridCanvas) ctx.drawImage(this.lcdGridCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * Lays the texture of a Retro HD style over the board. It is painted once per size, zoom and
   * colour on an offscreen canvas and blitted every frame; without a DOM it is painted directly.
   * The lowest quality level skips it.
   */
  private drawStyleOverlay(ctx: CanvasRenderingContext2D, tilePixelSize: number, settings: RenderSettings): void {
    const kind = this.descriptor().finish?.overlay;
    if (!kind || this.effectiveQuality === LOWEST_QUALITY) return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const colour = this.overlayColour(kind);
    // The vignette and the grain do not depend on the zoom, the other textures follow the size of a tile.
    const zoomKey = kind === 'vignetteGrain' ? '' : tilePixelSize;
    const tuning = [
      settings.lcdGridAlpha, settings.overlayGridAlpha, settings.overlayGridDivisions, settings.overlayScanlineAlpha,
      settings.overlayScanlinesPerTile, settings.overlayVignetteAlpha, settings.overlayVignetteSteps,
      settings.vignetteInnerRatio, settings.overlayGrainAlpha, settings.overlayGrainDensity, settings.overlayGrainSizePx
    ].join(',');
    const key = `${this.style}|${kind}|${width}|${height}|${zoomKey}|${colour}|${tuning}`;
    if (key !== this.overlayKey || !this.overlayCanvas) {
      this.overlayKey = key;
      this.overlayCanvas = null;
      if (typeof document === 'undefined') {
        ctx.save();
        this.paintOverlay(ctx, kind, width, height, tilePixelSize, settings);
        ctx.restore();
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const octx = canvas.getContext('2d');
      if (octx) {
        this.paintOverlay(octx, kind, width, height, tilePixelSize, settings);
        this.overlayCanvas = canvas;
      }
    }
    if (this.overlayCanvas) ctx.drawImage(this.overlayCanvas, 0, 0);
  }

  /** Palette colour an overlay is painted with, which also tells the cached texture when to be repainted. */
  private overlayColour(kind: OverlayKind): string {
    const pal = this.pal();
    switch (kind) {
      case 'lcdDots':
        return pal.lcdGrid;
      case 'gridLines':
        return pal.overlayGridLine;
      case 'scanlines':
        return pal.overlayScanline;
      case 'vignetteGrain':
        return `${pal.vignetteShade}|${pal.overlayGrain}`;
    }
  }

  private paintOverlay(
    ctx: CanvasRenderingContext2D,
    kind: OverlayKind,
    width: number,
    height: number,
    tilePixelSize: number,
    settings: RenderSettings
  ): void {
    const pal = this.pal();
    switch (kind) {
      case 'lcdDots': {
        const spriteScale = tilePixelSize / RETRO_SPRITE_SIZE;
        const gap = Math.max(1, Math.round(spriteScale * LCD_GAP_RATIO));
        ctx.globalAlpha = settings.lcdGridAlpha;
        this.paintLcdGrid(ctx, width, height, spriteScale, gap, pal.lcdGrid);
        break;
      }
      case 'gridLines': {
        const spacing = tilePixelSize / Math.max(1, settings.overlayGridDivisions);
        ctx.globalAlpha = settings.overlayGridAlpha;
        ctx.fillStyle = pal.overlayGridLine;
        ctx.beginPath();
        for (let i = 0; i * spacing < width; i++) ctx.rect(Math.round(i * spacing), 0, OVERLAY_LINE_PX, height);
        for (let j = 0; j * spacing < height; j++) ctx.rect(0, Math.round(j * spacing), width, OVERLAY_LINE_PX);
        ctx.fill();
        break;
      }
      case 'scanlines': {
        const period = Math.max(MIN_SCANLINE_PERIOD_PX, Math.round(tilePixelSize / Math.max(1, settings.overlayScanlinesPerTile)));
        const thickness = Math.max(OVERLAY_LINE_PX, Math.floor(period / 2));
        ctx.globalAlpha = settings.overlayScanlineAlpha;
        ctx.fillStyle = pal.overlayScanline;
        ctx.beginPath();
        for (let y = 0; y < height; y += period) ctx.rect(0, y, width, thickness);
        ctx.fill();
        break;
      }
      case 'vignetteGrain': {
        this.paintVignetteRings(ctx, width, height, settings);
        this.paintGrain(ctx, width, height, settings);
        break;
      }
    }
  }

  /** Darkened corners as flat concentric frames, darkest on the outside, like a banded gradient. */
  private paintVignetteRings(ctx: CanvasRenderingContext2D, width: number, height: number, settings: RenderSettings): void {
    const steps = Math.max(1, Math.floor(settings.overlayVignetteSteps));
    const reach = (Math.min(width, height) / 2) * (1 - settings.vignetteInnerRatio);
    const thickness = reach / steps;
    ctx.fillStyle = this.pal().vignetteShade;
    for (let i = 0; i < steps; i++) {
      const inset = i * thickness;
      const innerW = width - 2 * inset;
      const innerH = height - 2 * inset;
      ctx.globalAlpha = (settings.overlayVignetteAlpha * (steps - i)) / steps;
      ctx.beginPath();
      ctx.rect(inset, inset, innerW, thickness);
      ctx.rect(inset, height - inset - thickness, innerW, thickness);
      ctx.rect(inset, inset + thickness, thickness, innerH - 2 * thickness);
      ctx.rect(width - inset - thickness, inset + thickness, thickness, innerH - 2 * thickness);
      ctx.fill();
    }
  }

  /** Light specks scattered over the view by a seeded generator, so the grain is the same every run. */
  private paintGrain(ctx: CanvasRenderingContext2D, width: number, height: number, settings: RenderSettings): void {
    const size = Math.max(1, settings.overlayGrainSizePx);
    const count = Math.floor(width * height * settings.overlayGrainDensity);
    let seed = GRAIN_SEED;
    const next = (): number => {
      seed = (seed * GRAIN_LCG_MULTIPLIER + GRAIN_LCG_INCREMENT) % GRAIN_LCG_MODULUS;
      return seed / GRAIN_LCG_MODULUS;
    };
    ctx.globalAlpha = settings.overlayGrainAlpha;
    ctx.fillStyle = this.pal().overlayGrain;
    ctx.beginPath();
    for (let i = 0; i < count; i++) ctx.rect(Math.floor(next() * width), Math.floor(next() * height), size, size);
    ctx.fill();
  }

  /** Fills the gap lines on the right and bottom edge of every sprite pixel. */
  private paintLcdGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    spriteScale: number,
    gap: number,
    colour: string
  ): void {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = 1; i * spriteScale - gap < width; i++) {
      ctx.rect(Math.round(i * spriteScale) - gap, 0, gap, height);
    }
    for (let j = 1; j * spriteScale - gap < height; j++) {
      ctx.rect(0, Math.round(j * spriteScale) - gap, width, gap);
    }
    ctx.fill();
  }

  /** The retro scene canvas at the given size in sprite pixels, cleared; null without a DOM. */
  private prepareRetroScene(width: number, height: number): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    if (!this.retroScene) {
      this.retroScene = document.createElement('canvas');
      this.retroSceneCtx = this.retroScene.getContext('2d');
    }
    const sceneCtx = this.retroSceneCtx;
    if (!sceneCtx) return null;
    if (this.retroScene.width !== width || this.retroScene.height !== height) {
      this.retroScene.width = width;
      this.retroScene.height = height;
    } else {
      sceneCtx.clearRect(0, 0, width, height);
    }
    // A canvas resize resets the context, so smoothing is switched off again every frame.
    sceneCtx.imageSmoothingEnabled = false;
    return sceneCtx;
  }

  /** Scales the retro scene onto the canvas in one blit, smoothing off so sprite pixels stay sharp. */
  private presentRetroScene(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, spriteScale: number): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scene, 0, 0, scene.width * spriteScale, scene.height * spriteScale);
    ctx.restore();
  }

  /**
   * Iris opening on the player when a level starts or restarts. Drawn outside the
   * screen shake, skipped with reduced motion.
   */
  private drawIris(
    ctx: CanvasRenderingContext2D,
    engine: PlayEngine,
    cx: number,
    cy: number,
    tilePixelSize: number,
    frameScale: number,
    settings: RenderSettings
  ): void {
    const levelId = engine.getLevel().id;
    const steps = engine.getStepsCount();
    const restarted = steps === 0 && this.irisLastSteps > 0;
    if (levelId !== this.irisLevelId || restarted) {
      this.irisProgress = this.reducedMotion || settings.irisOpenFrames <= 0 ? 1 : 0;
    }
    this.irisLevelId = levelId;
    this.irisLastSteps = steps;
    if (this.irisProgress >= 1) return;

    this.irisProgress = Math.min(1, this.irisProgress + frameScale / settings.irisOpenFrames);
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    // Far enough to uncover the corner furthest from the player.
    const maxRadius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
    const eased = this.irisProgress * this.irisProgress;
    const radius = Math.max(tilePixelSize * IRIS_MIN_RADIUS_TILE, maxRadius * eased);
    ctx.save();
    ctx.fillStyle = this.pal().irisShade;
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(cx, cy, radius, 0, FULL_TURN, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  /**
   * Keeps the terrain features and the static terrain cache in step with the engine.
   * The terrain grid is compared against a private copy, so no engine change
   * notification is needed.
   */
  private syncTerrainCache(
    engine: PlayEngine,
    terrain: string[][],
    tilePixelSize: number,
    startTileX: number,
    endTileX: number,
    startTileY: number,
    endTileY: number,
    settings: RenderSettings
  ): void {
    this.syncTileSets(settings);
    const terrainChanged = this.terrainSnapshot.update(terrain);
    if (terrainChanged) {
      this.terrainFeatures = collectTerrainFeatures(
        terrain,
        ANY_ANIMATED_TILES,
        this.litTiles,
        ConfigRegistry.getTiles().tiles
      );
    }

    let trapKey = '';
    for (const trap of this.terrainFeatures.traps) {
      trapKey += engine.isCellClosedTrap(trap.x, trap.y) ? '1' : '0';
    }

    const blockKey = blockCellsKey(this.blockCells);
    const skinKey = this.skinActive ? `skin${this.skinLoader?.version ?? 0}` : '';
    const cacheKey = `${this.style}|${this.getSpriteStyle()?.spec.id ?? ''}|${this.themeId}|${tilePixelSize}|${skinKey}`;
    const region = this.cacheRegion;
    const covered =
      this.terrainCache !== null &&
      startTileX >= region.x0 &&
      endTileX <= region.x1 &&
      startTileY >= region.y0 &&
      endTileY <= region.y1;
    if (
      !terrainChanged &&
      covered &&
      trapKey === this.trapStateKey &&
      blockKey === this.blockCellsStateKey &&
      cacheKey === this.terrainCacheKey
    ) {
      return;
    }
    this.trapStateKey = trapKey;
    this.blockCellsStateKey = blockKey;
    if (cacheKey !== this.terrainCacheKey) this.restartFrameBudget();
    this.terrainCacheKey = cacheKey;

    // Cache the visible area plus a margin, so small camera moves reuse it, within a pixel budget.
    const maxTiles = Math.max(1, Math.floor(settings.terrainCacheMaxPx / tilePixelSize));
    const marginX = Math.max(0, Math.min(settings.terrainCacheMarginTiles, Math.floor((maxTiles - (endTileX - startTileX + 1)) / 2)));
    const marginY = Math.max(0, Math.min(settings.terrainCacheMarginTiles, Math.floor((maxTiles - (endTileY - startTileY + 1)) / 2)));
    const mapHeight = terrain.length;
    const mapWidth = mapHeight > 0 ? terrain[0].length : 0;
    region.x0 = Math.max(0, startTileX - marginX);
    region.y0 = Math.max(0, startTileY - marginY);
    region.x1 = Math.min(mapWidth - 1, endTileX + marginX);
    region.y1 = Math.min(mapHeight - 1, endTileY + marginY);

    if (!this.terrainCache) {
      this.terrainCache = document.createElement('canvas');
      this.terrainCacheCtx = this.terrainCache.getContext('2d');
    }
    const cache = this.terrainCache;
    const cacheCtx = this.terrainCacheCtx;
    if (!cacheCtx) return;
    const widthPx = Math.ceil((region.x1 - region.x0 + 1) * tilePixelSize) + 1;
    const heightPx = Math.ceil((region.y1 - region.y0 + 1) * tilePixelSize) + 1;
    if (cache.width !== widthPx || cache.height !== heightPx) {
      cache.width = widthPx;
      cache.height = heightPx;
    } else {
      cacheCtx.clearRect(0, 0, widthPx, heightPx);
    }

    const drawSize = Math.ceil(tilePixelSize);
    for (let my = region.y0; my <= region.y1; my++) {
      for (let mx = region.x0; mx <= region.x1; mx++) {
        const px = Math.floor((mx - region.x0) * tilePixelSize);
        const py = Math.floor((my - region.y0) * tilePixelSize);
        // A block hides the terrain under it; neighbours still read the real terrain for shadows.
        const tileId = this.isBlockCovered(mx, my) ? 'floor' : terrain[my]?.[mx] || 'floor';
        if (this.skinActive) {
          const skinLayers = this.skinLoader?.getTerrain(tileId);
          if (skinLayers) {
            this.drawSkinLayers(cacheCtx, skinLayers, px, py, drawSize);
            continue;
          }
        }
        const isClosedTrap = tileId === 'trap' ? engine.isCellClosedTrap(mx, my) : false;
        const neighbours = tileNeighbours(terrain, mx, my, this.wallJoinTiles, this.shadowCasterTiles);
        this.drawTile(cacheCtx, tileId, px, py, drawSize, false, isClosedTrap, 'static', neighbours);
      }
    }
  }

  /** Draws skin images scaled to the cell, smoothed so they shrink cleanly at any zoom. */
  private drawSkinLayers(
    ctx: CanvasRenderingContext2D,
    layers: readonly CanvasImageSource[],
    x: number,
    y: number,
    size: number
  ): void {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const layer of layers) ctx.drawImage(layer, x, y, size, size);
    ctx.restore();
  }

  private syncTileSets(settings: RenderSettings): void {
    if (this.tileSetsSource === settings) return;
    this.tileSetsSource = settings;
    this.wallJoinTiles = new Set(settings.wallJoinTiles);
    this.shadowCasterTiles = new Set(settings.shadowCasterTiles);
    this.litTiles = new Set(Object.keys(settings.lightSources));
  }

  /** True when a pushable block currently sits on the cell. */
  private isBlockCovered(x: number, y: number): boolean {
    return this.blockCells.has(y * this.blockCellsWidth + x);
  }

  /** Strokes a straight wire between the centres of two grid cells. */
  private strokeGridLink(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    if (this.isBlockCovered(ax, ay) || this.isBlockCovered(bx, by)) return;
    ctx.beginPath();
    ctx.moveTo((ax + 0.5 - camX) * tilePixelSize, (ay + 0.5 - camY) * tilePixelSize);
    ctx.lineTo((bx + 0.5 - camX) * tilePixelSize, (by + 0.5 - camY) * tilePixelSize);
    ctx.stroke();
  }

  /** Strokes a wire from every button to every target with the current stroke style. */
  private strokeButtonLinks(
    ctx: CanvasRenderingContext2D,
    buttons: readonly GridPoint[],
    targets: readonly GridPoint[],
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    for (const button of buttons) {
      for (const target of targets) {
        this.strokeGridLink(ctx, button.x, button.y, target.x, target.y, camX, camY, tilePixelSize);
      }
    }
  }

  private drawMechanismLinksAndObjective(
    ctx: CanvasRenderingContext2D,
    engine: PlayEngine,
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    const pal = this.pal();
    const terrain = engine.getTerrain();
    // A cell under a block reveals nothing on hover.
    const hovered = this.hoveredGridPoint;
    const hov = hovered && !this.isBlockCovered(hovered.x, hovered.y) ? hovered : null;
    const hovTile = hov ? terrain[hov.y]?.[hov.x] : null;
    const showAll = this.showMechanismLinks;

    ctx.save();
    ctx.setLineDash(LINK_DASH_PATTERN);
    ctx.lineDashOffset = -(this.timeTick * LINK_STYLE.dashSpeed);
    ctx.lineWidth = Math.max(LINK_STYLE.minWidthPx, tilePixelSize * LINK_STYLE.widthTile);

    // 1. Brown Button <-> Bear Trap wires
    ctx.strokeStyle = pal.linkTrap;
    for (const link of engine.getTrapLinks()) {
      const isHovered =
        hov &&
        ((hov.x === link.buttonX && hov.y === link.buttonY) ||
          (hov.x === link.trapX && hov.y === link.trapY));
      if (!showAll && !isHovered) continue;
      ctx.globalAlpha = isHovered ? LINK_STYLE.hoverAlpha : LINK_STYLE.trapAlpha;
      this.strokeGridLink(ctx, link.buttonX, link.buttonY, link.trapX, link.trapY, camX, camY, tilePixelSize);
    }

    // 2. Red Button <-> Clone Machine wires
    ctx.strokeStyle = pal.linkCloner;
    for (const link of engine.getCloneLinks()) {
      const isHovered =
        hov &&
        ((hov.x === link.buttonX && hov.y === link.buttonY) ||
          (hov.x === link.clonerX && hov.y === link.clonerY));
      if (!showAll && !isHovered) continue;
      ctx.globalAlpha = isHovered ? LINK_STYLE.hoverAlpha : LINK_STYLE.clonerAlpha;
      this.strokeGridLink(ctx, link.buttonX, link.buttonY, link.clonerX, link.clonerY, camX, camY, tilePixelSize);
    }

    // 3. Buttons <-> the tiles they toggle, and teleporter networks (lists cached on terrain change)
    const { toggleButtons, toggleWalls, channelButtons, channelWalls, flameButtons, flameTargets, teleporterGroups } =
      this.terrainFeatures;
    const hovDef = hovTile ? ConfigRegistry.getTile(hovTile) : undefined;
    const toggleVisible = showAll || hovDef?.buttonAction === 'toggle_walls';
    const flameVisible = showAll || hovDef?.buttonAction === 'toggle_flames';
    ctx.strokeStyle = pal.linkToggle;
    ctx.globalAlpha = LINK_STYLE.toggleAlpha;
    if (toggleVisible) {
      this.strokeButtonLinks(ctx, toggleButtons, toggleWalls, camX, camY, tilePixelSize);
    }
    // A colour toggle button links to the walls of its own channel only.
    const hoveredChannel = channelOfButtonAction(hovDef?.buttonAction);
    for (const [channel, buttons] of channelButtons) {
      if (!showAll && channel !== hoveredChannel) continue;
      this.strokeButtonLinks(ctx, buttons, channelWalls.get(channel) ?? [], camX, camY, tilePixelSize);
    }
    if (flameVisible) {
      this.strokeButtonLinks(ctx, flameButtons, flameTargets, camX, camY, tilePixelSize);
    }

    ctx.strokeStyle = pal.linkTeleport;
    ctx.globalAlpha = LINK_STYLE.teleportAlpha;
    const hovGroupKey = hovDef?.isTeleporter ? teleportGroupKey(hovDef) : null;
    for (const [groupKey, cells] of teleporterGroups) {
      if (cells.length < 2 || !(showAll || groupKey === hovGroupKey)) continue;
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        const b = cells[(i + 1) % cells.length];
        this.strokeGridLink(ctx, a.x, a.y, b.x, b.y, camX, camY, tilePixelSize);
      }
    }

    // 4. Objective Beacon Reticle
    if (this.objectivePoint) {
      ctx.setLineDash(NO_DASH);
      const pulse =
        LINK_STYLE.objectivePulseBase +
        LINK_STYLE.objectivePulseAmplitude * Math.sin(this.timeTick * LINK_STYLE.objectivePulseSpeed);
      const ox = (this.objectivePoint.x + 0.5 - camX) * tilePixelSize;
      const oy = (this.objectivePoint.y + 0.5 - camY) * tilePixelSize;

      ctx.strokeStyle = pal.objectiveRing;
      ctx.lineWidth = Math.max(1, tilePixelSize * LINK_STYLE.objectiveRingWidthTile);
      ctx.globalAlpha = LINK_STYLE.objectiveAlpha;
      ctx.beginPath();
      ctx.arc(ox, oy, tilePixelSize * pulse, 0, FULL_TURN);
      ctx.stroke();

      ctx.strokeStyle = pal.objectiveHalo;
      ctx.lineWidth = Math.max(1, tilePixelSize * LINK_STYLE.objectiveHaloWidthTile);
      ctx.beginPath();
      ctx.arc(ox, oy, tilePixelSize * (pulse + LINK_STYLE.objectiveHaloOffset), 0, FULL_TURN);
      ctx.stroke();
    }

    ctx.restore();
  }

  private updateAndDrawEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tilePixelSize: number,
    frameScale: number,
    settings: RenderSettings
  ): void {
    ctx.save();
    ctx.lineWidth = Math.max(1, tilePixelSize * settings.shockwaveLineWidthTile);
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += settings.shockwaveGrowthPerFrame * frameScale;
      sw.alpha -= settings.shockwaveFadePerFrame * frameScale;
      if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const sx = (sw.x - camX) * tilePixelSize;
      const sy = (sw.y - camY) * tilePixelSize;
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, sw.radius * tilePixelSize, 0, FULL_TURN);
      ctx.stroke();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * frameScale;
      p.y += p.vy * frameScale;
      p.alpha -= p.decay * frameScale;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const px = (p.x - camX) * tilePixelSize;
      const py = (p.y - camY) * tilePixelSize;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(px, py, p.radius * tilePixelSize, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.restore();
  }

  public drawTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isEditor: boolean = false,
    isClosedTrap: boolean = true,
    pass: TilePass = 'all',
    neighbours: Readonly<TileNeighbours> = ISOLATED_TILE
  ): void {
    const painterId = EPOXY_TO_CC3D_PAINTER[tileId];
    if (painterId) {
      this.drawCc3dTile(ctx, painterId, x, y, size, isEditor, isClosedTrap, pass, neighbours);
      return;
    }
    const floatingColor = FLOATING_BLOCK_COLORS[tileId];
    if (floatingColor) {
      this.drawTile(ctx, 'water', x, y, size, isEditor, isClosedTrap, pass, neighbours);
      if (pass !== 'animated') paintCc3dFloatingBlock(ctx, floatingColor, x, y, size, this.cc3dTools(ctx));
      return;
    }
    if (isCc3dId(tileId)) {
      this.drawCc3dTile(ctx, tileId, x, y, size, isEditor, isClosedTrap, pass, neighbours);
      return;
    }
    if (this.isHdVector()) {
      const theme = this.getActiveTheme();
      // Modern tiles are themed; the editor, the icons and a game without any theme use the flat legacy look.
      if (!isEditor && theme) {
        this.drawModernTile(ctx, tileId, x, y, size, isClosedTrap, theme, pass, neighbours);
        return;
      }
      this.drawLegacyTile(ctx, tileId, x, y, size, isEditor, isClosedTrap, pass, neighbours);
      return;
    }

    if (this.retroSpritesReady()) {
      this.drawRetroSpriteTile(ctx, tileId, x, y, size, isEditor, isClosedTrap, pass, neighbours);
    } else {
      this.drawLegacyTile(ctx, tileId, x, y, size, isEditor, isClosedTrap, pass, neighbours);
    }
  }

  /** One neon bar per blocked edge (modern style), drawn over whatever is under the cell. */
  private paintNeonPanelBars(
    ctx: CanvasRenderingContext2D,
    edges: readonly Direction[],
    x: number,
    y: number,
    size: number
  ): void {
    if (edges.length === 0) return;
    const pal = this.pal();
    const bar = Math.max(THIN_BAR_MIN_PX_NEON, Math.floor(size * THIN_BAR_TILE));
    ctx.save();
    ctx.fillStyle = pal.modernThinWall;
    ctx.shadowColor = pal.modernThinWall;
    ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    if (edges.includes('N')) ctx.fillRect(x, y, size, bar);
    if (edges.includes('S')) ctx.fillRect(x, y + size - bar, size, bar);
    if (edges.includes('W')) ctx.fillRect(x, y, bar, size);
    if (edges.includes('E')) ctx.fillRect(x + size - bar, y, bar, size);
    ctx.restore();
  }

  /**
   * Pivot dot of a swivel door, at the corner where its two closed sides meet. Retro sprite styles keep
   * the plain thin-wall bars (no dedicated sprite), so only the flat and neon looks call this.
   */
  private paintSwivelPivot(
    ctx: CanvasRenderingContext2D,
    edges: readonly Direction[],
    x: number,
    y: number,
    size: number,
    minBarPx: number,
    fill: string
  ): void {
    const vertical = edges.includes('N') ? 'N' : edges.includes('S') ? 'S' : null;
    const horizontal = edges.includes('W') ? 'W' : edges.includes('E') ? 'E' : null;
    if (!vertical || !horizontal) return;
    const bar = Math.max(minBarPx, Math.floor(size * THIN_BAR_TILE));
    const offset = bar * SWIVEL_PIVOT_OFFSET_BARS;
    const cx = horizontal === 'W' ? x + offset : x + size - offset;
    const cy = vertical === 'N' ? y + offset : y + size - offset;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, bar * SWIVEL_PIVOT_RADIUS_BARS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** One flat bar per blocked edge (vector retro look), drawn over whatever is under the cell. */
  private paintFlatPanelBars(
    ctx: CanvasRenderingContext2D,
    edges: readonly Direction[],
    x: number,
    y: number,
    size: number
  ): void {
    if (edges.length === 0) return;
    const pal = this.pal();
    const bar = Math.max(THIN_BAR_MIN_PX_FLAT, Math.floor(size * THIN_BAR_TILE));
    ctx.fillStyle = pal.wallShadow;
    if (edges.includes('N')) ctx.fillRect(x, y, size, bar);
    if (edges.includes('S')) ctx.fillRect(x, y + size - bar, size, bar);
    if (edges.includes('W')) ctx.fillRect(x, y, bar, size);
    if (edges.includes('E')) ctx.fillRect(x + size - bar, y, bar, size);

    ctx.fillStyle = pal.wallTop;
    if (edges.includes('N')) ctx.fillRect(x + 1, y + 1, size - 2, bar - 2);
    if (edges.includes('S')) ctx.fillRect(x + 1, y + size - bar + 1, size - 2, bar - 2);
    if (edges.includes('W')) ctx.fillRect(x + 1, y + 1, bar - 2, size - 2);
    if (edges.includes('E')) ctx.fillRect(x + size - bar + 1, y + 1, bar - 2, size - 2);
  }

  /**
   * Panel bars over a cell that shows other terrain (water, ice, gravel...), in the bar look of the
   * current style: the same drawing a plain floor cell uses for its thin wall, without the floor.
   */
  public drawPanelBars(
    ctx: CanvasRenderingContext2D,
    edges: readonly Direction[],
    x: number,
    y: number,
    size: number
  ): void {
    if (this.isHdVector()) {
      if (!this.getActiveTheme()) this.paintFlatPanelBars(ctx, edges, x, y, size);
      else this.paintNeonPanelBars(ctx, edges, x, y, size);
      return;
    }
    if (this.retroSpritesReady()) {
      // The first layer of a thin wall is its floor: only the panels go over the terrain.
      this.drawRetroLayers(ctx, this.panelLayers(edges), x, y, size);
      return;
    }
    this.paintFlatPanelBars(ctx, edges, x, y, size);
  }

  /** Sprite layers of the panels alone (no floor) for an edge set, built once per set. */
  private panelLayers(edges: readonly Direction[]): readonly RetroLayer[] {
    const key = edges.join('');
    let layers = this.panelLayerCache.get(key);
    if (!layers) {
      layers = retroThinLayers(edges).slice(1);
      this.panelLayerCache.set(key, layers);
    }
    return layers;
  }

  /** A small corner triangle on a cell whose stack holds layers under the shown one. */
  private drawHiddenLayerMarker(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const reach = size * HIDDEN_LAYER_MARKER_TILE;
    ctx.save();
    ctx.fillStyle = this.pal().yellow;
    ctx.beginPath();
    ctx.moveTo(x + size - reach, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size, y + reach);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A small square in the opposite corner: filled when the hidden terrain is stored closed, outlined when open. */
  private drawHiddenStateBadge(ctx: CanvasRenderingContext2D, closed: boolean, x: number, y: number, size: number): void {
    const side = size * EDITOR_HIDDEN_STATE_BADGE_SIZE_TILE;
    const inset = size * EDITOR_HIDDEN_STATE_BADGE_INSET_TILE;
    const line = Math.max(EDITOR_HIDDEN_STATE_BADGE_MIN_LINE_PX, size * EDITOR_HIDDEN_STATE_BADGE_LINE_TILE);
    const left = x + inset;
    const top = y + size - inset - side;
    ctx.save();
    ctx.fillStyle = EDITOR_HIDDEN_STATE_BADGE_EDGE;
    ctx.fillRect(left - line, top - line, side + 2 * line, side + 2 * line);
    if (closed) {
      ctx.fillStyle = EDITOR_HIDDEN_STATE_BADGE_FILL;
      ctx.fillRect(left, top, side, side);
    } else {
      ctx.strokeStyle = EDITOR_HIDDEN_STATE_BADGE_FILL;
      ctx.lineWidth = line;
      ctx.strokeRect(left + line / 2, top + line / 2, side - line, side - line);
    }
    ctx.restore();
  }

  /** Turns the stacked-layer corner marker on or off (the level editor shows it, play does not). */
  public setHiddenLayerMarkers(visible: boolean): void {
    this.hiddenLayerMarkers = visible;
  }

  /** Panels and layer markers of the visible cells, over the terrain and under items and mobs. */
  private drawCellOverlays(
    ctx: CanvasRenderingContext2D,
    engine: PlayEngine,
    mapWidth: number,
    startTileX: number,
    endTileX: number,
    startTileY: number,
    endTileY: number,
    originX: number,
    originY: number,
    region: { x0: number; y0: number },
    unit: number,
    drawSize: number
  ): void {
    const panels = engine.getPanels?.();
    const hidden = this.hiddenLayerMarkers ? engine.getHiddenLayerCells?.() : undefined;
    if (!panels?.size && !hidden?.size) return;
    for (let my = startTileY; my <= endTileY; my++) {
      for (let mx = startTileX; mx <= endTileX; mx++) {
        if (this.isBlockCovered(mx, my)) continue;
        const index = my * mapWidth + mx;
        const edges = panels?.get(index);
        const marked = hidden?.has(index) ?? false;
        if (!edges && !marked) continue;
        const px = originX + Math.floor((mx - region.x0) * unit);
        const py = originY + Math.floor((my - region.y0) * unit);
        this.drawCellOverlay(ctx, edges, marked, px, py, drawSize);
      }
    }
  }

  /**
   * The panel bars and the stacked-layer marker of one cell, for a caller that draws its cells itself
   * (the level editor). The marker only shows while setHiddenLayerMarkers(true) is on. `hiddenClosed` adds the
   * stored-state badge of a hidden toggle wall or hold door (true closed, false open); play never passes it.
   */
  public drawCellOverlay(
    ctx: CanvasRenderingContext2D,
    edges: readonly Direction[] | undefined,
    marked: boolean,
    x: number,
    y: number,
    size: number,
    hiddenClosed?: boolean
  ): void {
    if (edges && edges.length > 0) this.drawPanelBars(ctx, edges, x, y, size);
    if (marked && this.hiddenLayerMarkers) {
      this.drawHiddenLayerMarker(ctx, x, y, size);
      if (hiddenClosed !== undefined) this.drawHiddenStateBadge(ctx, hiddenClosed, x, y, size);
    }
  }

  /** Palette and colour-blind glyphs the cc3d painters draw with. */
  private cc3dTools(ctx: CanvasRenderingContext2D): Cc3dPaintTools {
    return {
      pal: this.pal(),
      glyph: (colorKey, cx, cy, radius, fill) => this.drawColorGlyph(ctx, colorKey, cx, cy, radius, fill)
    };
  }

  /**
   * A tile of the cc3d ruleset: the style's own floor, then the glyph in palette colours. Every style
   * draws these the same way; only the floor under them changes with the style.
   */
  private drawCc3dTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isEditor: boolean,
    isClosedTrap: boolean,
    pass: TilePass,
    neighbours: Readonly<TileNeighbours>
  ): void {
    if (pass === 'animated') return;
    this.drawTile(ctx, 'floor', x, y, size, isEditor, isClosedTrap, pass, neighbours);
    paintCc3dTerrain(ctx, tileId, x, y, size, this.cc3dTools(ctx));
  }

  /**
   * A mob of the cc3d ruleset. Variants of an existing monster (walkers, small gliders and fireballs,
   * the yellow tank) are that monster, scaled and marked with a colour dot, in the active style's own
   * sprite; the others are palette shapes.
   */
  private drawCc3dEntity(
    ctx: CanvasRenderingContext2D,
    type: string,
    dir: Direction,
    x: number,
    y: number,
    size: number
  ): void {
    const variant = CC3D_MOB_BASES[type];
    if (!variant) {
      paintCc3dMob(ctx, type, dir, x, y, size, this.cc3dTools(ctx));
      return;
    }
    this.drawMobVariant(ctx, variant, dir, x, y, size);
  }

  /** A monster of the active style, scaled and marked with a colour dot, as a variant of it. */
  private drawMobVariant(
    ctx: CanvasRenderingContext2D,
    variant: Cc3dMobBase,
    dir: Direction,
    x: number,
    y: number,
    size: number
  ): void {
    const tools = this.cc3dTools(ctx);
    const scaled = size * variant.scale;
    const offset = (size - scaled) / 2;
    this.drawEntity(ctx, variant.base, dir, x + offset, y + offset, scaled);
    if (variant.badge) paintCc3dBadge(ctx, variant.badge, x, y, size, tools);
  }

  /**
   * The flat vector tiles the 16-Bit Retro style used before it moved to sprites. HD Neon still
   * draws them for the editor grid, the HUD and palette icons and a game without a theme, and
   * 16-Bit Retro falls back to them when the config carries no retro palettes.
   */
  private drawLegacyTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isEditor: boolean,
    isClosedTrap: boolean,
    pass: TilePass,
    neighbours: Readonly<TileNeighbours>
  ): void {
    if (pass === 'animated') {
      if (RETRO_ANIMATED_TILES.has(tileId)) this.drawRetroAnimatedOverlay(ctx, tileId, x, y, size);
      return;
    }

    const pal = this.pal();

    ctx.fillStyle = pal.floorBase;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = pal.floorBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    ctx.fillStyle = pal.floorHighlight;
    ctx.fillRect(x + 1, y + 1, size - 2, 2);
    ctx.fillRect(x + 1, y + 1, 2, size - 2);

    switch (tileId) {
      case 'floor':
        this.drawRetroFloorDetail(ctx, x, y, size, neighbours.hash);
        break;

      case 'invisible_wall':
      case 'appearing_wall':
        // Same details as plain floor, so a hidden wall gives nothing away.
        this.drawRetroFloorDetail(ctx, x, y, size, neighbours.hash);
        if (isEditor) {
          ctx.strokeStyle = tileId === 'appearing_wall' ? pal.yellow : pal.wallBase;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x + 3, y + 3, size - 6, size - 6);
          ctx.setLineDash([]);
        }
        break;

      default: {
        // Any thin panel combination: one bar per blocked edge, read from tiles.json.
        const tile = ConfigRegistry.getTile(tileId);
        this.paintFlatPanelBars(ctx, tile.blockedEdges || [], x, y, size);
        if (tile.swivelTurns) {
          this.paintSwivelPivot(ctx, tile.blockedEdges || [], x, y, size, THIN_BAR_MIN_PX_FLAT, this.pal().yellow);
        }
        break;
      }

      case 'wall':
        this.drawRetroWall(ctx, x, y, size, neighbours.wallMask);
        break;

      case 'recessed_wall': {
        ctx.fillStyle = pal.recessedWall;
        ctx.fillRect(x + 4, y + 4, size - 8, size - 8);
        ctx.strokeStyle = pal.wallShadow;
        ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
        break;
      }

      case 'blue_wall_real':
      case 'blue_wall_fake': {
        ctx.fillStyle = pal.blueWallBorder;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = pal.blueWall;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.fillStyle = pal.blueWallBorder;
        ctx.fillRect(x + 2, y + Math.floor(size / 2), size - 4, 2);
        ctx.fillRect(x + Math.floor(size / 2), y + 2, 2, Math.floor(size / 2));
        if (isEditor && tileId === 'blue_wall_fake') {
          ctx.fillStyle = pal.yellow;
          ctx.fillRect(x + size * 0.4, y + size * 0.4, size * 0.2, size * 0.2);
        }
        break;
      }

      case 'dirt': {
        ctx.fillStyle = pal.dirtBase;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = pal.dirtSpeck;
        const step = Math.max(3, Math.floor(size / 6));
        for (let dy = 3; dy < size - 3; dy += step) {
          for (let dx = 3; dx < size - 3; dx += step) {
            if ((dx + dy) % 2 === 0) {
              ctx.fillRect(x + dx, y + dy, 2, 2);
            }
          }
        }
        break;
      }

      case 'gravel': {
        ctx.fillStyle = pal.gravelBase;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = pal.gravelSpeck;
        const step = Math.max(4, Math.floor(size / 5));
        for (let dy = 3; dy < size - 4; dy += step) {
          for (let dx = 3; dx < size - 4; dx += step) {
            ctx.fillRect(x + dx, y + dy, 3, 2);
          }
        }
        break;
      }

      case 'water': {
        ctx.fillStyle = pal.waterDeep;
        ctx.fillRect(x, y, size, size);
        break;
      }

      case 'fire':
      case 'flame_jet_on': {
        ctx.fillStyle = pal.fireBase;
        ctx.fillRect(x, y, size, size);
        if (tileId === 'flame_jet_on') this.drawFlameJetNozzle(ctx, x, y, size, false);
        break;
      }

      case 'slime': {
        ctx.fillStyle = pal.slimeBase;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = pal.slimeBlob;
        ctx.beginPath();
        ctx.arc(x + size * 0.35, y + size * 0.38, size * 0.14, 0, FULL_TURN);
        ctx.arc(x + size * 0.68, y + size * 0.62, size * 0.12, 0, FULL_TURN);
        ctx.fill();
        break;
      }

      case 'flame_jet_off': {
        this.drawRetroFloorDetail(ctx, x, y, size, neighbours.hash);
        this.drawFlameJetNozzle(ctx, x, y, size, false);
        break;
      }

      case 'turtle': {
        ctx.fillStyle = pal.waterDeep;
        ctx.fillRect(x, y, size, size);
        this.drawTurtle(ctx, x, y, size, false);
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        const bend = this.iceBend(tileId);
        if (bend) {
          this.drawIceBend(ctx, bend, x, y, size, RETRO_ICE_INSET_PX, {
            wall: pal.iceCornerWall,
            fill: pal.iceBase,
            band: pal.iceBendBand,
            streak: pal.iceShine
          });
          break;
        }
        ctx.fillStyle = pal.iceBase;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.strokeStyle = pal.iceShine;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.2, y + size * 0.8);
        ctx.lineTo(x + size * 0.8, y + size * 0.2);
        ctx.stroke();
        break;
      }

      case 'force_n':
      case 'force_e':
      case 'force_s':
      case 'force_w':
      case 'force_random': {
        ctx.fillStyle = pal.forceBase;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = pal.forceArrow;
        const cx = x + size / 2;
        const cy = y + size / 2;
        const r = size * 0.28;
        if (tileId === 'force_random') {
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.8, 0, FULL_TURN);
          ctx.fill();
        } else {
          ctx.beginPath();
          if (tileId === 'force_n') {
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx + r, cy + r * 0.7);
            ctx.lineTo(cx - r, cy + r * 0.7);
          } else if (tileId === 'force_s') {
            ctx.moveTo(cx, cy + r);
            ctx.lineTo(cx + r, cy - r * 0.7);
            ctx.lineTo(cx - r, cy - r * 0.7);
          } else if (tileId === 'force_e') {
            ctx.moveTo(cx + r, cy);
            ctx.lineTo(cx - r * 0.7, cy - r);
            ctx.lineTo(cx - r * 0.7, cy + r);
          } else if (tileId === 'force_w') {
            ctx.moveTo(cx - r, cy);
            ctx.lineTo(cx + r * 0.7, cy - r);
            ctx.lineTo(cx + r * 0.7, cy + r);
          }
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'socket': {
        ctx.fillStyle = pal.socketOuter;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.fillStyle = pal.socketInner;
        ctx.fillRect(x + size * 0.25, y + size * 0.25, size * 0.5, size * 0.5);
        ctx.fillStyle = pal.socketOuter;
        ctx.fillRect(x + size * 0.35, y + size * 0.35, size * 0.3, size * 0.3);
        break;
      }

      case 'exit':
        // Fully animated, drawn by drawRetroAnimatedOverlay.
        break;

      case 'hint': {
        ctx.fillStyle = pal.hintSign;
        ctx.fillRect(x + size * 0.2, y + size * 0.15, size * 0.6, size * 0.7);
        this.drawHintGlyph(ctx, x, y, size, 0.55, this.getSettings().hintFontRetro, pal.hintGlyph);
        break;
      }

      case 'thief': {
        ctx.fillStyle = pal.thiefCloak;
        ctx.fillRect(x + size * 0.2, y + size * 0.18, size * 0.6, size * 0.68);
        ctx.fillStyle = pal.thiefMask;
        ctx.fillRect(x + size * 0.28, y + size * 0.32, size * 0.44, size * 0.14);
        break;
      }

      case 'thief_keys': {
        ctx.fillStyle = pal.thiefKeysCloak;
        ctx.fillRect(x + size * 0.2, y + size * 0.18, size * 0.6, size * 0.68);
        ctx.fillStyle = pal.thiefMask;
        ctx.fillRect(x + size * 0.28, y + size * 0.32, size * 0.44, size * 0.14);
        this.drawKeyGlyph(ctx, x, y, size, pal.yellow);
        break;
      }

      case 'forbid_key_red':
      case 'forbid_key_blue':
      case 'forbid_key_yellow':
      case 'forbid_key_green':
      case 'forbid_boots_ice':
      case 'forbid_boots_water':
      case 'forbid_boots_fire':
      case 'forbid_boots_force': {
        this.drawForbiddenItem(ctx, tileId, x, y, size, false);
        break;
      }

      case 'door_red':
      case 'door_blue':
      case 'door_yellow':
      case 'door_green': {
        const def = ConfigRegistry.getTile(tileId);
        const cKey = def.colorKey || DEFAULT_COLOR_KEY;
        const color = pal[cKey] || pal[DEFAULT_COLOR_KEY];
        ctx.fillStyle = pal.wallShadow;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = color;
        ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
        this.drawColorGlyph(ctx, cKey, x + size / 2, y + size * 0.44, size * 0.16, pal.wallShadow);
        ctx.fillStyle = pal.wallShadow;
        ctx.fillRect(x + size * 0.45, y + size * 0.56, size * 0.1, size * 0.18);
        break;
      }

      case 'button_green':
      case 'button_blue':
      case 'button_brown':
      case 'button_red':
      case 'button_gray':
      case 'button_orange': {
        ctx.fillStyle = pal.wallShadow;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = this.buttonColor(tileId);
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.22, 0, FULL_TURN);
        ctx.fill();
        this.drawButtonGlyph(ctx, tileId, x, y, size);
        break;
      }

      case 'block_target': {
        const ink = pal[BLOCK_TARGET_COLOR_KEY];
        const ring = size * BLOCK_TARGET_MARK.ringInset;
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, size * BLOCK_TARGET_MARK.ringWidth);
        ctx.strokeRect(x + ring, y + ring, size - ring * 2, size - ring * 2);
        ctx.fillStyle = ink;
        ctx.fillRect(
          x + size / 2 - size * BLOCK_TARGET_MARK.dotRadius,
          y + size / 2 - size * BLOCK_TARGET_MARK.dotRadius,
          size * BLOCK_TARGET_MARK.dotRadius * 2,
          size * BLOCK_TARGET_MARK.dotRadius * 2
        );
        break;
      }

      case 'toggle_wall_closed': {
        ctx.fillStyle = pal.wallShadow;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.strokeStyle = pal.green;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
        break;
      }

      case 'toggle_wall_open': {
        ctx.strokeStyle = pal.green;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
        ctx.setLineDash([]);
        break;
      }

      case 'teleport':
      case 'teleport_red':
      case 'teleport_blue':
      case 'teleport_yellow':
      case 'teleport_green': {
        ctx.strokeStyle = this.teleportRingColor(tileId, pal.teleportRing);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.34, 0, FULL_TURN);
        ctx.stroke();
        const glyphKey = teleporterGlyphKey(ConfigRegistry.getTile(tileId));
        if (glyphKey) {
          this.drawColorGlyph(
            ctx,
            glyphKey,
            x + size / 2,
            y + size / 2,
            size * TELEPORT_GLYPH_RADIUS_TILE,
            this.teleportRingColor(tileId, pal.teleportRing)
          );
        }
        break;
      }

      case 'trap': {
        ctx.fillStyle = pal.trapBorder;
        ctx.fillRect(x + 4, y + 4, size - 8, size - 8);
        ctx.fillStyle = isClosedTrap ? pal.trapInner : pal.floorBase;
        ctx.fillRect(x + 8, y + 8, size - 16, size - 16);
        if (isClosedTrap) {
          ctx.fillStyle = pal.trapTeeth;
          for (let i = 0; i < 3; i++) {
            const tx = x + 9 + i * Math.floor((size - 18) / 3);
            ctx.fillRect(tx, y + size * 0.45, 3, 5);
          }
        }
        break;
      }

      case 'laser_emitter_n':
      case 'laser_emitter_e':
      case 'laser_emitter_s':
      case 'laser_emitter_w':
      case 'laser_receiver_red':
      case 'laser_receiver_blue':
      case 'laser_gate_red_closed':
      case 'laser_gate_red_open':
      case 'laser_gate_blue_closed':
      case 'laser_gate_blue_open':
        this.paintLaserTile(ctx, tileId, x, y, size, false);
        break;

      case 'clone_machine': {
        ctx.fillStyle = pal.clonerBorder;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.fillStyle = pal.clonerInner;
        ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
        ctx.fillStyle = pal.yellow;
        ctx.fillRect(x + size * 0.4, y + size * 0.4, size * 0.2, size * 0.2);
        break;
      }
    }

    if (!this.shadowCasterTiles.has(tileId)) {
      this.drawRetroFloorShadow(ctx, x, y, size, neighbours.shadowMask);
    }

    if (pass === 'all' && RETRO_ANIMATED_TILES.has(tileId)) {
      this.drawRetroAnimatedOverlay(ctx, tileId, x, y, size);
    }
  }

  // ---------------------------------------------------------------------------
  // Retro sprites (16-Bit and 32-Bit)
  // ---------------------------------------------------------------------------

  /** Ramps of the active theme, resolved once per theme; empty when game.json has no retro palettes. */
  private getRetroRamps(): RetroRamps {
    const palettes = ConfigRegistry.getGame().retroPalettes;
    let stale = this.themeId !== this.retroRampsTheme;
    if (!this.retroPalettesSeen || palettes !== this.retroRampsSource) {
      this.retroPalettesSeen = true;
      this.retroRampsSource = palettes;
      this.retroPalettesValid = this.validateRetroPalettes(palettes);
      // Everything composed or cached from the previous palettes is out of date.
      this.retroCanvases.clear();
      this.retroShineCanvases.clear();
      this.terrainCacheKey = '';
      stale = true;
    }
    if (stale) {
      this.retroRampsTheme = this.themeId;
      this.retroRampsCache = this.retroPalettesValid ? resolveRetroRamps(palettes, this.themeId) : {};
    }
    return this.retroRampsCache;
  }

  /**
   * Checks the palettes against the sprite sheet once per palettes object. Problems are reported on
   * the console and the style falls back to the flat drawer; missing palettes fall back silently.
   */
  private validateRetroPalettes(palettes: Record<string, Record<string, string[]>> | undefined): boolean {
    if (!palettes) return false;
    const errors = findRetroSheetErrors(RETRO_SHEET, palettes);
    if (errors.length > 0) console.error(RETRO_INVALID_REPORT, errors.join('; '));
    return errors.length === 0;
  }

  /** Shadow depth and side width in pixels of the sprite style for the configured depth. */
  private getRetroExtent(spec: SpriteStyleSpec): { depth: number; side: number } {
    const depthTile = this.getSettings().floorShadowDepthTile;
    if (depthTile !== this.retroExtentTile || spec.id !== this.retroExtentStyle) {
      this.retroExtentTile = depthTile;
      this.retroExtentStyle = spec.id;
      this.retroExtent = retroShadowExtent(depthTile, spec);
    }
    return this.retroExtent;
  }

  /**
   * The sprites the active style draws with, or null when it has none (HD Neon) or cannot get any
   * (no valid retro palettes). 32-Bit Retro that cannot derive its ramps draws the 16-Bit sprites.
   */
  private getSpriteStyle(): ActiveSpriteStyle | null {
    if (this.inFrame && this.frameSprite !== undefined) return this.frameSprite;
    const value = this.resolveSpriteStyle();
    if (this.inFrame) this.frameSprite = value;
    return value;
  }

  private resolveSpriteStyle(): ActiveSpriteStyle | null {
    const desc = this.descriptor();
    if (!desc.sprite) return null;
    const ramps16 = this.getRetroRamps();
    if (!hasRetroSprite(RETRO_READY_SPRITE) || !(RETRO_READY_RAMP in ramps16)) return null;
    const palettes32 = desc.palettesKey === 'retro32Palettes' ? ConfigRegistry.getGame().retro32Palettes : undefined;
    const cacheEntries = desc.palettesKey === 'retro32Palettes' ? this.getRetro32CacheSize() : 0;
    let memo = this.spriteStyleMemo;
    if (
      !memo ||
      memo.styleId !== desc.id ||
      memo.ramps16 !== ramps16 ||
      memo.palettes32 !== palettes32 ||
      memo.cacheEntries !== cacheEntries
    ) {
      const value =
        desc.base === 'retro32'
          ? this.buildRetro32Style(desc, ramps16, palettes32, cacheEntries)
          : this.buildRetro16Style(desc.sprite, ramps16);
      memo = { styleId: desc.id, ramps16, palettes32, cacheEntries, value, small: null };
      this.spriteStyleMemo = memo;
    }
    // Tiles drawn smaller than the sprites would shrink them with nearest neighbour: use the 16-px sprites.
    if (memo.value && memo.value.spec.tileSize > this.frameTilePx) {
      memo.small ??= this.buildRetro16Style(desc.smallSprite ?? desc.sprite, ramps16);
      return memo.small;
    }
    return memo.value;
  }

  /** Configured size of the 32-Bit sprite cache, floored and bounded below. */
  private getRetro32CacheSize(): number {
    const configured = this.getSettings().retro32SpriteCacheMaxEntries;
    return Number.isFinite(configured)
      ? Math.max(RETRO32_MIN_CACHE_ENTRIES, Math.floor(configured))
      : DEFAULT_RENDER_SETTINGS.retro32SpriteCacheMaxEntries;
  }

  /** True when the style draws without sprites (HD Neon) or has the sprites it needs. */
  private styleHasSprites(): boolean {
    return this.descriptor().sprite === null || this.getSpriteStyle() !== null;
  }

  /** Lights and vignette apply only to a style that can draw its scene, not to the flat fallback. */
  private lightingActive(): boolean {
    return this.descriptor().lighting && this.styleHasSprites();
  }

  /** Particles and shine apply only to a style that can draw its scene, not to the flat fallback. */
  private effectsActive(): boolean {
    return this.descriptor().effects && this.styleHasSprites();
  }

  private buildRetro16Style(spec: SpriteStyleSpec, ramps16: RetroRamps): ActiveSpriteStyle {
    return { spec, ramps: ramps16, source: createRetro16SpriteSource(ramps16) };
  }

  private buildRetro32Style(
    desc: RenderStyleDescriptor,
    ramps16: RetroRamps,
    palettes32: RetroPaletteTable,
    size: number
  ): ActiveSpriteStyle {
    const spec = desc.sprite as SpriteStyleSpec;
    const fallback = (): ActiveSpriteStyle => this.buildRetro16Style(desc.smallSprite ?? spec, ramps16);
    const palettes16 = this.retroRampsSource;
    const seen = this.retro32CachePalettes;
    if (!seen || seen.p16 !== palettes16 || seen.p32 !== palettes32) {
      if (seen) {
        // Palettes were replaced: nothing rasterized or composed from the old ones is valid.
        this.retro32Cache?.clear();
        this.retroCanvases.clear();
        this.retroShineCanvases.clear();
        this.terrainCacheKey = '';
      }
      this.retro32PaletteErrors = findRetro32PaletteErrors(palettes32, Object.keys(palettes16 ?? {}));
      if (this.retro32PaletteErrors.length > 0) {
        console.error(RETRO32_INVALID_REPORT, this.retro32PaletteErrors.join('; '));
      }
    }
    this.retro32CachePalettes = { p16: palettes16, p32: palettes32 };
    if (this.retro32PaletteErrors.length > 0) return fallback();
    if (!this.retro32Cache || this.retro32CacheSize !== size) {
      this.retro32Cache = createRetro32SpriteCache(size);
      this.retro32CacheSize = size;
    }
    try {
      const sprites = createRetro32ThemeSprites(
        this.themeId,
        ramps16,
        palettes32,
        this.retro32Cache,
        RETRO_SHEET
      );
      if (!(RETRO_READY_RAMP in sprites.ramps32)) throw new Error(`missing ramp ${RETRO_READY_RAMP}`);
      return { spec, ramps: sprites.ramps32, source: sprites.source };
    } catch (error) {
      console.error(RETRO32_INVALID_REPORT, error instanceof Error ? error.message : String(error));
      return fallback();
    }
  }

  /** True when the active style can draw from sprites: the sheet and the palettes are both present. */
  private retroSpritesReady(): boolean {
    return this.getSpriteStyle() !== null;
  }

  /** Animation phase shared by every animated retro tile. */
  private retroPhase(): number {
    return Math.floor(this.animFrame / RETRO_PHASE_TICKS) % RETRO_PHASE_COUNT;
  }

  /** Marks `map` entry `key` as the most recently used and drops the oldest entries over `maxEntries`. */
  private touchLru(map: Map<string, HTMLCanvasElement>, key: string, canvas: HTMLCanvasElement): void {
    map.delete(key);
    map.set(key, canvas);
    if (map.size > this.getSettings().retroSpriteCacheMaxEntries) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
  }

  /**
   * The canvas of a layer stack with the floor shadow of `shadowSignature` dithered on it, at the
   * tile size of the active sprite style, composed on first use. Null without a DOM.
   */
  private getRetroCanvas(layers: readonly RetroLayer[], shadowSignature: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const sprite = this.getSpriteStyle();
    if (!sprite) return null;
    const { spec } = sprite;
    const extent = this.getRetroExtent(spec);
    const key = [spec.id, this.themeId, retroLayersKey(layers), shadowSignature, extent.depth].join(RETRO_KEY_SEPARATOR);
    const cached = this.retroCanvases.get(key);
    if (cached) {
      // Move to the end of the map: the first key is always the least recently used.
      this.retroCanvases.delete(key);
      this.retroCanvases.set(key, cached);
      return cached;
    }
    const pixels = composeRetroLayers(layers, sprite.ramps, spec, sprite.source);
    applyRetroShadow(pixels, spec.tileSize, shadowSignature, sprite.ramps, extent.depth, extent.side, spec);
    const canvas = this.canvasFromPixels(pixels, spec.tileSize);
    if (!canvas) return null;
    this.touchLru(this.retroCanvases, key, canvas);
    return canvas;
  }

  /** A square canvas holding the RGBA pixels; null when the canvas has no 2D context. */
  private canvasFromPixels(pixels: Uint8ClampedArray, size: number): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const cctx = canvas.getContext('2d');
    if (!cctx) return null;
    const image = cctx.createImageData(size, size);
    image.data.set(pixels);
    cctx.putImageData(image, 0, 0);
    return canvas;
  }

  /**
   * Step of the shine sweep for the current animation frame, or -1 when no shine is drawn: the
   * style has no effects, the shine is off (quality, setting), motion is reduced, or the sweep rests.
   */
  private shineStep(): number {
    if (!this.effectsActive() || this.reducedMotion || this.getSettings().retro32ShineAlpha <= 0) return -1;
    if (this.animFrame >= SHINE_SWEEP_FRAMES) return -1;
    return Math.floor((this.animFrame * SHINE_STEPS) / SHINE_SWEEP_FRAMES);
  }

  /**
   * Overlay of one shine step over a layer stack: white where the diagonal band crosses an opaque
   * pixel, so the shine never leaves the sprite's outline. Composed on first use, then cached.
   */
  private getShineCanvas(layers: readonly RetroLayer[], step: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const sprite = this.getSpriteStyle();
    if (!sprite) return null;
    const { spec } = sprite;
    const key = [spec.id, this.themeId, retroLayersKey(layers), 'shine', step].join(RETRO_KEY_SEPARATOR);
    const cached = this.retroShineCanvases.get(key);
    if (cached) {
      this.touchLru(this.retroShineCanvases, key, cached);
      return cached;
    }
    const size = spec.tileSize;
    const base = composeRetroLayers(layers, sprite.ramps, spec, sprite.source);
    const core = Math.max(1, Math.round(size * SHINE_CORE_HALF_WIDTH_RATIO));
    const edge = core * SHINE_EDGE_FACTOR;
    // The band centre runs along the diagonal x + y from before the first to past the last pixel.
    const travel = 2 * size + 2 * edge;
    const centre = -edge + (travel * step) / SHINE_STEPS;
    const overlay = new Uint8ClampedArray(base.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * RGBA_BYTES;
        if (base[o + RGBA_ALPHA_OFFSET] === 0) continue;
        const distance = Math.abs(x + y - centre);
        const alpha = distance <= core ? SHINE_CORE_ALPHA : distance <= edge ? SHINE_EDGE_ALPHA : 0;
        if (alpha === 0) continue;
        overlay[o] = OVERLAY_WHITE;
        overlay[o + 1] = OVERLAY_WHITE;
        overlay[o + 2] = OVERLAY_WHITE;
        overlay[o + RGBA_ALPHA_OFFSET] = alpha;
      }
    }
    const canvas = this.canvasFromPixels(overlay, size);
    if (!canvas) return null;
    this.touchLru(this.retroShineCanvases, key, canvas);
    return canvas;
  }

  /** Adds the shine sweep over a sprite already drawn on the retro scene (never on icons or the editor). */
  private drawRetroShine(
    ctx: CanvasRenderingContext2D,
    layers: readonly RetroLayer[],
    x: number,
    y: number,
    size: number
  ): void {
    if (ctx !== this.retroSceneCtx) return;
    const step = this.shineStep();
    if (step < 0) return;
    const overlay = this.getShineCanvas(layers, step);
    if (!overlay) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.getSettings().retro32ShineAlpha;
    ctx.drawImage(overlay, x, y, size, size);
    ctx.restore();
  }

  /**
   * Draws a composed sprite on a tile rect with smoothing off, so its pixels stay square. The retro
   * scene context has smoothing off for good; any other context gets it for this blit only.
   */
  private blitRetro(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, y: number, size: number): void {
    if (ctx === this.retroSceneCtx) {
      ctx.drawImage(canvas, x, y, size, size);
      return;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, y, size, size);
    ctx.restore();
  }

  private drawRetroLayers(
    ctx: CanvasRenderingContext2D,
    layers: readonly RetroLayer[],
    x: number,
    y: number,
    size: number,
    shadowSignature: number = 0,
    shine: boolean = false
  ): void {
    if (layers.length === 0) return;
    const canvas = this.getRetroCanvas(layers, shadowSignature);
    if (!canvas) return;
    this.blitRetro(ctx, canvas, x, y, size);
    if (shine) this.drawRetroShine(ctx, layers, x, y, size);
  }

  /** A tile from sprites: floor, wall, door... stacked from layers, with its floor shadow dithered on. */
  private drawRetroSpriteTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isEditor: boolean,
    isClosedTrap: boolean,
    pass: TilePass,
    neighbours: Readonly<TileNeighbours>
  ): void {
    const layers = retroTileLayers({
      tileId,
      def: ConfigRegistry.getTile(tileId),
      resolve: this.resolveTile,
      pass,
      hash: neighbours.hash,
      wallMask: neighbours.wallMask,
      floorDetailEvery: this.getSettings().floorDetailEvery,
      isEditor,
      isClosedTrap,
      phase: this.retroPhase(),
      reducedMotion: this.reducedMotion
    });
    const shadow =
      !this.descriptor().floorShadows || this.shadowCasterTiles.has(tileId) ? 0 : retroShadowSignature(neighbours.shadowMask);
    this.drawRetroLayers(ctx, layers, x, y, size, shadow);
  }

  /**
   * Corner radii of a wall cell, in canvas order (top-left, top-right, bottom-right,
   * bottom-left): only corners where both sides face open floor are rounded.
   */
  private wallCornerRadii(wallMask: number, radius: number): [number, number, number, number] {
    const openN = !(wallMask & NEIGHBOUR.N);
    const openE = !(wallMask & NEIGHBOUR.E);
    const openS = !(wallMask & NEIGHBOUR.S);
    const openW = !(wallMask & NEIGHBOUR.W);
    return [
      openN && openW ? radius : 0,
      openN && openE ? radius : 0,
      openS && openE ? radius : 0,
      openS && openW ? radius : 0
    ];
  }

  /**
   * Draws one cell of a wall mass seen from above and slightly south: a lit band runs
   * along every edge that faces open floor, the interior of the mass stays darker, and
   * a front face shows under the cells that have open floor south of them.
   */
  private drawModernWall(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    neighbours: Readonly<TileNeighbours>,
    theme: ThemePalette
  ): void {
    const pal = this.pal();
    const settings = this.getSettings();
    const mask = neighbours.wallMask;
    const openS = !(mask & NEIGHBOUR.S);
    const front = openS ? Math.round(size * settings.wallFrontDepthTile) : 0;
    const topHeight = size - front;
    const band = Math.max(1, Math.round(size * settings.wallPanelInsetTile));
    const rim = Math.max(1, Math.round(size * settings.wallRimWidthTile));
    const radii = this.wallCornerRadii(mask, size * settings.wallCornerRadiusTile);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radii);
    ctx.clip();

    // Front face, then the lit top band over the whole top face.
    if (front > 0) {
      ctx.fillStyle = theme.wallBottom;
      ctx.fillRect(x, y + topHeight, size, front);
      ctx.fillStyle = pal.modernWallFrontShade;
      ctx.fillRect(x, y + topHeight + rim, size, front - rim);
    }
    ctx.fillStyle = theme.wallTop;
    ctx.fillRect(x, y, size, topHeight);

    // Dark interior: inset from open edges only, so it flows into joined neighbours.
    const inN = mask & NEIGHBOUR.N ? 0 : band;
    const inE = mask & NEIGHBOUR.E ? 0 : band;
    const inS = openS ? band : 0;
    const inW = mask & NEIGHBOUR.W ? 0 : band;
    ctx.fillStyle = theme.wallBottom;
    ctx.fillRect(x + inW, y + inN, size - inW - inE, topHeight - inN - inS);

    // Concave corners: both sides joined but the diagonal open, the lit band turns the corner.
    ctx.fillStyle = theme.wallTop;
    if (hasAll(mask, NEIGHBOUR.N | NEIGHBOUR.W) && !(mask & NEIGHBOUR.NW)) ctx.fillRect(x, y, band, band);
    if (hasAll(mask, NEIGHBOUR.N | NEIGHBOUR.E) && !(mask & NEIGHBOUR.NE)) ctx.fillRect(x + size - band, y, band, band);
    if (!openS) {
      if (hasAll(mask, NEIGHBOUR.W) && !(mask & NEIGHBOUR.SW)) ctx.fillRect(x, y + size - band, band, band);
      if (hasAll(mask, NEIGHBOUR.E) && !(mask & NEIGHBOUR.SE)) ctx.fillRect(x + size - band, y + size - band, band, band);
    }

    // Sheen on the lit band, and an engraved panel on some interior cells.
    if (inN > 0) {
      ctx.fillStyle = pal.modernWallTopShine;
      ctx.fillRect(x, y, size, Math.min(topHeight, band));
    }
    if (mask === 0xff && neighbours.hash % WALL_PANEL_EVERY === 0) {
      ctx.strokeStyle = pal.modernFloorDetailDark;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + band + 0.5, y + band + 0.5, size - band * 2 - 1, size - band * 2 - 1);
      ctx.strokeStyle = pal.modernFloorDetail;
      ctx.strokeRect(x + band + 1.5, y + band + 1.5, size - band * 2 - 1, size - band * 2 - 1);
    }

    // Lit rim along the open edges of the top face.
    ctx.fillStyle = theme.wallBevel;
    ctx.globalAlpha = WALL_RIM_ALPHA;
    if (!(mask & NEIGHBOUR.N)) ctx.fillRect(x, y, size, rim);
    if (!(mask & NEIGHBOUR.W)) ctx.fillRect(x, y, rim, topHeight);
    if (!(mask & NEIGHBOUR.E)) ctx.fillRect(x + size - rim, y, rim, topHeight);
    if (openS) ctx.fillRect(x, y + topHeight - rim, size, rim);
    ctx.restore();
  }

  /** Retro counterpart of drawModernWall, with flat colours and a brick front face. */
  private drawRetroWall(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mask: number): void {
    const pal = this.pal();
    const settings = this.getSettings();
    const openS = !(mask & NEIGHBOUR.S);
    const front = openS ? Math.round(size * settings.wallFrontDepthTile) : 0;
    const topHeight = size - front;
    const band = Math.max(1, Math.round(size * settings.wallRimWidthTile));
    const dot = this.retroDot(size);

    ctx.fillStyle = pal.wallTop;
    ctx.fillRect(x, y, size, topHeight);
    const inN = mask & NEIGHBOUR.N ? 0 : band;
    const inE = mask & NEIGHBOUR.E ? 0 : band;
    const inW = mask & NEIGHBOUR.W ? 0 : band;
    ctx.fillStyle = pal.wallBase;
    ctx.fillRect(x + inW, y + inN, size - inW - inE, topHeight - inN);

    // Two brick courses per cell, joints offset by half a brick, so the bond runs across cells.
    const course = Math.max(dot, Math.round(size * RETRO_BRICK_SPAN_TILE));
    const half = Math.floor(course / 2);
    ctx.fillStyle = pal.wallShadow;
    for (let row = 0; row * course < topHeight; row++) {
      const top = row * course;
      if (top > 0) ctx.fillRect(x + inW, y + top, size - inW - inE, dot);
      const joint = row % 2 === 0 ? half : 0;
      const bottom = Math.min(topHeight, top + course);
      for (let jx = joint; jx < size; jx += course) {
        if (jx >= inW && jx < size - inE) ctx.fillRect(x + jx, y + Math.max(top, inN), dot, bottom - Math.max(top, inN));
      }
    }

    if (front > 0) {
      ctx.fillStyle = pal.wallShadow;
      ctx.fillRect(x, y + topHeight, size, front);
      ctx.fillStyle = pal.wallBase;
      const joint = Math.max(1, Math.round(size * RETRO_BRICK_SPAN_TILE));
      for (let bx = Math.floor(joint / 2); bx < size; bx += joint) {
        ctx.fillRect(x + bx, y + topHeight + dot, dot, front - dot * 2);
      }
    }

    ctx.fillStyle = pal.floorHighlight;
    if (!(mask & NEIGHBOUR.N)) ctx.fillRect(x, y, size, dot);
    if (!(mask & NEIGHBOUR.W)) ctx.fillRect(x, y, dot, topHeight);
  }

  /** Size of one retro "pixel" at this tile size. */
  private retroDot(size: number): number {
    return Math.max(1, Math.round(size / RETRO_DITHER_DIVISOR));
  }

  /** Dithered shadow thrown by casters north and west of a cell. */
  private drawRetroFloorShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mask: number): void {
    if (!(mask & (NEIGHBOUR.N | NEIGHBOUR.W | NEIGHBOUR.NW))) return;
    const pal = this.pal();
    const dot = this.retroDot(size);
    const depth = Math.round(size * this.getSettings().floorShadowDepthTile);
    const side = Math.round(depth * SIDE_SHADOW_RATIO);
    const pattern = this.getDitherPattern(ctx, dot, pal.floorBorder);
    if (!pattern) return;
    ctx.fillStyle = pattern;
    const northRows = mask & NEIGHBOUR.N ? depth : 0;
    if (northRows > 0) ctx.fillRect(x, y, size, northRows);
    if (mask & NEIGHBOUR.W) {
      ctx.fillRect(x, y + northRows, side, size - northRows);
    } else if (mask & NEIGHBOUR.NW && northRows === 0) {
      ctx.fillRect(x, y, side, depth);
    }
  }

  /** Checkerboard of `dot`-sized squares, anchored on the canvas origin, cached per size and colour. */
  private getDitherPattern(ctx: CanvasRenderingContext2D, dot: number, color: string): CanvasPattern | null {
    const key = `${dot}|${color}`;
    const cached = this.ditherPatterns.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null;
    const tile = document.createElement('canvas');
    tile.width = dot * 2;
    tile.height = dot * 2;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, dot, dot);
    tctx.fillRect(dot, dot, dot, dot);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) this.ditherPatterns.set(key, pattern);
    return pattern;
  }

  /** Sparse dark specks on some retro floor cells. */
  private drawRetroFloorDetail(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, hash: number): void {
    if (hash % this.getSettings().floorDetailEvery !== 0) return;
    const pal = this.pal();
    const dot = this.retroDot(size);
    ctx.fillStyle = pal.floorBorder;
    const kind = (hash >>> FLOOR_DETAIL_KIND_SHIFT) % FLOOR_DETAIL_KINDS;
    const cx = x + Math.floor(size / 2);
    const cy = y + Math.floor(size / 2);
    if (kind === 0) {
      ctx.fillRect(x + dot * 2, cy, size - dot * 4, dot);
    } else if (kind === 1) {
      for (let i = 0; i < FLOOR_VENT_SLATS; i++) {
        ctx.fillRect(cx - dot * 3, cy - dot * 3 + i * dot * 2, dot * 6, dot);
      }
    } else {
      ctx.fillRect(cx - dot * 2, cy + dot, dot, dot);
      ctx.fillRect(cx + dot, cy - dot, dot, dot);
      ctx.fillRect(cx + dot * 3, cy + dot * 2, dot, dot);
    }
  }

  /** Retro parts that change with the engine tick phase. */
  private drawRetroAnimatedOverlay(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number
  ): void {
    const pal = this.pal();
    const phase = Math.floor(this.animFrame / RETRO_PHASE_TICKS) % RETRO_PHASE_COUNT;

    switch (tileId) {
      case 'water': {
        ctx.fillStyle = pal.waterWave;
        const waveOffset = (phase * 3) % 8;
        for (let row = 0; row < 3; row++) {
          const wy = y + Math.floor(size * (0.22 + row * 0.28));
          ctx.fillRect(x + 4 + waveOffset, wy, Math.floor(size * 0.35), 2);
          ctx.fillRect(x + Math.floor(size * 0.55) - waveOffset, wy + 2, Math.floor(size * 0.3), 2);
        }
        break;
      }

      case 'fire':
      case 'flame_jet_on': {
        ctx.fillStyle = pal.fireMid;
        const flicker = (phase % 2) * 2;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.15, y + size * 0.88);
        ctx.lineTo(x + size * 0.32, y + size * 0.25 + flicker);
        ctx.lineTo(x + size * 0.5, y + size * 0.65);
        ctx.lineTo(x + size * 0.68, y + size * 0.18 - flicker);
        ctx.lineTo(x + size * 0.85, y + size * 0.88);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = pal.fireTip;
        ctx.fillRect(x + size * 0.3, y + size * 0.45 + flicker, size * 0.14, size * 0.3);
        ctx.fillRect(x + size * 0.58, y + size * 0.38 - flicker, size * 0.14, size * 0.35);
        break;
      }

      case 'exit': {
        const pulse = phase % 2 === 0 ? pal.exitBase : pal.exitPulse;
        ctx.fillStyle = pulse;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.fillStyle = pal.exitCore;
        ctx.fillRect(x + size * 0.22, y + size * 0.22, size * 0.56, size * 0.56);
        ctx.fillStyle = pulse;
        ctx.fillRect(x + size * 0.36, y + size * 0.36, size * 0.28, size * 0.28);
        break;
      }

      case 'teleport':
      case 'teleport_red':
      case 'teleport_blue':
      case 'teleport_yellow':
      case 'teleport_green': {
        ctx.fillStyle = pal.teleportCore;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * (0.14 + (phase % 2) * 0.04), 0, FULL_TURN);
        ctx.fill();
        break;
      }
    }
  }

  private drawModernTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isClosedTrap: boolean,
    theme: ThemePalette,
    pass: TilePass,
    neighbours: Readonly<TileNeighbours>
  ): void {
    if (pass === 'animated') {
      if (MODERN_ANIMATED_TILES.has(tileId)) this.drawModernAnimatedOverlay(ctx, tileId, x, y, size, neighbours.hash);
      return;
    }

    const pal = this.pal();
    const glow = this.getSettings().glowBlurPx;

    // Modern sleek biome-themed floor with subtle gradient
    const floorGrad = this.gradient(ctx.createLinearGradient(x, y, x + size, y + size));
    floorGrad.addColorStop(0, theme.floorTop);
    floorGrad.addColorStop(1, theme.floorBottom);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = theme.floorGrid;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    // Subtle corner tech rivets on floor
    const rivet = Math.max(1, size * FLOOR_RIVET_SIZE_TILE);
    const inset = size * FLOOR_RIVET_INSET_TILE;
    ctx.fillStyle = pal.modernFloorRivet;
    ctx.fillRect(x + inset, y + inset, rivet, rivet);
    ctx.fillRect(x + size - inset - rivet, y + size - inset - rivet, rivet, rivet);

    switch (tileId) {
      case 'floor':
      case 'invisible_wall':
      case 'appearing_wall':
        // Hidden walls get the same details as plain floor, so they give nothing away.
        this.drawModernFloorDetail(ctx, x, y, size, neighbours.hash);
        break;

      case 'wall':
        this.drawModernWall(ctx, x, y, size, neighbours, theme);
        break;

      case 'recessed_wall': {
        ctx.fillStyle = pal.modernRecessedFill;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.fill();
        ctx.strokeStyle = pal.modernWallAccent;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }

      case 'blue_wall_real':
      case 'blue_wall_fake': {
        const bGrad = this.gradient(ctx.createLinearGradient(x, y, x + size, y + size));
        bGrad.addColorStop(0, pal.modernBlueWallTop);
        bGrad.addColorStop(1, pal.modernBlueWallBottom);
        ctx.fillStyle = bGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 5);
        ctx.fill();
        ctx.strokeStyle = pal.modernBlueWallEdge;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 3);
        ctx.stroke();
        break;
      }

      default: {
        // Any thin panel combination: one neon bar per blocked edge, read from tiles.json.
        const tile = ConfigRegistry.getTile(tileId);
        this.paintNeonPanelBars(ctx, tile.blockedEdges || [], x, y, size);
        if (tile.swivelTurns) {
          this.paintSwivelPivot(ctx, tile.blockedEdges || [], x, y, size, THIN_BAR_MIN_PX_NEON, this.pal().yellow);
        }
        break;
      }

      case 'dirt': {
        const dGrad = this.gradient(ctx.createRadialGradient(
          x + size / 2,
          y + size / 2,
          size * 0.1,
          x + size / 2,
          y + size / 2,
          size * 0.7
        ));
        dGrad.addColorStop(0, pal.modernDirtCenter);
        dGrad.addColorStop(1, pal.modernDirtEdge);
        ctx.fillStyle = dGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 4);
        ctx.fill();
        break;
      }

      case 'gravel': {
        ctx.fillStyle = pal.modernGravelBase;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 4);
        ctx.fill();
        ctx.fillStyle = pal.modernGravelStone;
        for (let i = 0; i < 5; i++) {
          const gx = x + ((i * 17 + 7) % (size - 12)) + 5;
          const gy = y + ((i * 23 + 9) % (size - 12)) + 5;
          ctx.beginPath();
          ctx.arc(gx, gy, 2.5, 0, FULL_TURN);
          ctx.fill();
        }
        break;
      }

      case 'water': {
        const wGrad = this.gradient(ctx.createLinearGradient(x, y, x + size, y + size));
        wGrad.addColorStop(0, pal.modernWaterTop);
        wGrad.addColorStop(1, pal.modernWaterBottom);
        ctx.fillStyle = wGrad;
        ctx.fillRect(x, y, size, size);
        break;
      }

      case 'fire':
      case 'flame_jet_on': {
        const fGrad = this.gradient(ctx.createRadialGradient(
          x + size / 2,
          y + size * 0.65,
          2,
          x + size / 2,
          y + size / 2,
          size * 0.65
        ));
        fGrad.addColorStop(0, pal.modernFireCore);
        fGrad.addColorStop(0.55, pal.modernFireMid);
        fGrad.addColorStop(1, pal.modernFireEdge);
        ctx.fillStyle = fGrad;
        ctx.fillRect(x, y, size, size);
        if (tileId === 'flame_jet_on') this.drawFlameJetNozzle(ctx, x, y, size, true);
        break;
      }

      case 'slime': {
        const sGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        sGrad.addColorStop(0, pal.modernSlimeTop);
        sGrad.addColorStop(1, pal.modernSlimeBottom);
        ctx.fillStyle = sGrad;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = pal.modernSlimeGlow;
        ctx.beginPath();
        ctx.arc(x + size * 0.36, y + size * 0.38, size * 0.15, 0, FULL_TURN);
        ctx.arc(x + size * 0.66, y + size * 0.64, size * 0.12, 0, FULL_TURN);
        ctx.fill();
        break;
      }

      case 'flame_jet_off': {
        this.drawModernFloorDetail(ctx, x, y, size, neighbours.hash);
        this.drawFlameJetNozzle(ctx, x, y, size, true);
        break;
      }

      case 'turtle': {
        const tGrad = this.gradient(ctx.createLinearGradient(x, y, x + size, y + size));
        tGrad.addColorStop(0, pal.modernWaterTop);
        tGrad.addColorStop(1, pal.modernWaterBottom);
        ctx.fillStyle = tGrad;
        ctx.fillRect(x, y, size, size);
        this.drawTurtle(ctx, x, y, size, true);
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        const iGrad = this.gradient(ctx.createLinearGradient(x, y, x + size, y + size));
        iGrad.addColorStop(0, pal.modernIceTop);
        iGrad.addColorStop(0.5, pal.modernIceMid);
        iGrad.addColorStop(1, pal.modernIceBottom);
        const bend = this.iceBend(tileId);
        if (bend) {
          this.drawIceBend(ctx, bend, x, y, size, 0, {
            wall: pal.modernIceCornerWall,
            fill: iGrad,
            band: pal.modernIceBendBand,
            streak: pal.modernIceStreak,
            rim: pal.modernIceBendRim || pal.modernIceStreak
          });
          break;
        }
        ctx.fillStyle = iGrad;
        ctx.fillRect(x, y, size, size);

        // Glossy diagonal specular streak
        ctx.strokeStyle = pal.modernIceStreak;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.18, y + size * 0.78);
        ctx.lineTo(x + size * 0.78, y + size * 0.18);
        ctx.stroke();
        break;
      }

      case 'force_n':
      case 'force_e':
      case 'force_s':
      case 'force_w':
      case 'force_random': {
        ctx.fillStyle = pal.modernForceBg;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        break;
      }

      case 'socket': {
        ctx.fillStyle = pal.modernSocketBase;
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 6);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = pal.modernSocketRing;
        ctx.shadowColor = pal.modernSocketRing;
        ctx.shadowBlur = glow.medium;
        ctx.lineWidth = 2.5;
        this.roundRect(ctx, x + size * 0.24, y + size * 0.24, size * 0.52, size * 0.52, 4);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'exit':
      case 'teleport':
      case 'teleport_red':
      case 'teleport_blue':
      case 'teleport_yellow':
      case 'teleport_green':
        // Fully animated, drawn by drawModernAnimatedOverlay.
        break;

      case 'hint': {
        ctx.save();
        ctx.fillStyle = pal.modernHintFill;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 6);
        ctx.fill();
        ctx.strokeStyle = pal.modernHintRing;
        ctx.shadowColor = pal.modernHintRing;
        ctx.shadowBlur = glow.medium;
        ctx.lineWidth = 2;
        ctx.stroke();
        this.drawHintGlyph(ctx, x, y, size, 0.52, this.getSettings().hintFontModern, pal.hintGlyph);
        ctx.restore();
        break;
      }

      case 'thief': {
        ctx.fillStyle = pal.thiefCloak;
        this.roundRect(ctx, x + size * 0.18, y + size * 0.16, size * 0.64, size * 0.68, 8);
        ctx.fill();
        ctx.fillStyle = pal.thiefMask;
        ctx.fillRect(x + size * 0.26, y + size * 0.34, size * 0.48, size * 0.14);
        break;
      }

      case 'thief_keys': {
        ctx.fillStyle = pal.thiefKeysCloak;
        this.roundRect(ctx, x + size * 0.18, y + size * 0.16, size * 0.64, size * 0.68, 8);
        ctx.fill();
        ctx.fillStyle = pal.thiefMask;
        ctx.fillRect(x + size * 0.26, y + size * 0.34, size * 0.48, size * 0.14);
        ctx.save();
        ctx.shadowColor = pal.yellow;
        ctx.shadowBlur = glow.soft;
        this.drawKeyGlyph(ctx, x, y, size, pal.yellow);
        ctx.restore();
        break;
      }

      case 'forbid_key_red':
      case 'forbid_key_blue':
      case 'forbid_key_yellow':
      case 'forbid_key_green':
      case 'forbid_boots_ice':
      case 'forbid_boots_water':
      case 'forbid_boots_fire':
      case 'forbid_boots_force': {
        this.drawModernFloorDetail(ctx, x, y, size, neighbours.hash);
        this.drawForbiddenItem(ctx, tileId, x, y, size, true);
        break;
      }

      case 'door_red':
      case 'door_blue':
      case 'door_yellow':
      case 'door_green': {
        const def = ConfigRegistry.getTile(tileId);
        const cKey = def.colorKey || DEFAULT_COLOR_KEY;
        const color = pal[cKey] || pal[DEFAULT_COLOR_KEY];
        ctx.fillStyle = pal.modernDoorFrame;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 6);
        ctx.fill();

        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = glow.medium;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.fill();
        ctx.restore();

        this.drawColorGlyph(ctx, cKey, x + size / 2, y + size * 0.44, size * 0.15, pal.modernDoorFrame);
        ctx.fillStyle = pal.modernDoorFrame;
        ctx.fillRect(x + size * 0.46, y + size * 0.56, size * 0.08, size * 0.16);
        break;
      }

      case 'button_green':
      case 'button_blue':
      case 'button_brown':
      case 'button_red':
      case 'button_gray':
      case 'button_orange': {
        const c = this.buttonColor(tileId);
        ctx.fillStyle = pal.modernButtonBase;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, FULL_TURN);
        ctx.fill();

        ctx.save();
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = glow.medium;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.21, 0, FULL_TURN);
        ctx.fill();
        ctx.restore();
        this.drawButtonGlyph(ctx, tileId, x, y, size);
        break;
      }

      case 'block_target': {
        const ink = pal[BLOCK_TARGET_COLOR_KEY];
        const ring = size * BLOCK_TARGET_MARK.ringInset;
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.shadowColor = ink;
        ctx.shadowBlur = glow.soft;
        ctx.lineWidth = Math.max(1, size * BLOCK_TARGET_MARK.ringWidth);
        this.roundRect(ctx, x + ring, y + ring, size - ring * 2, size - ring * 2, size * BLOCK_RADIUS_TILE);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * BLOCK_TARGET_MARK.dotRadius, 0, FULL_TURN);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'toggle_wall_closed': {
        ctx.fillStyle = pal.modernToggleBase;
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 5);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = pal.modernToggleRing;
        ctx.shadowColor = pal.modernToggleRing;
        ctx.shadowBlur = glow.soft;
        ctx.lineWidth = 2.5;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'toggle_wall_open': {
        ctx.strokeStyle = pal.modernToggleOpen;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }

      case 'trap': {
        ctx.strokeStyle = pal.modernTrapRing;
        ctx.lineWidth = 2;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        if (isClosedTrap) {
          ctx.fillStyle = pal.modernTrapClosed;
          this.roundRect(ctx, x + 7, y + 7, size - 14, size - 14, 3);
          ctx.fill();
        }
        break;
      }

      case 'laser_emitter_n':
      case 'laser_emitter_e':
      case 'laser_emitter_s':
      case 'laser_emitter_w':
      case 'laser_receiver_red':
      case 'laser_receiver_blue':
      case 'laser_gate_red_closed':
      case 'laser_gate_red_open':
      case 'laser_gate_blue_closed':
      case 'laser_gate_blue_open':
        this.paintLaserTile(ctx, tileId, x, y, size, true);
        break;

      case 'clone_machine': {
        ctx.fillStyle = pal.modernClonerBase;
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 5);
        ctx.fill();
        ctx.strokeStyle = pal.modernClonerRing;
        ctx.lineWidth = 2;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        break;
      }
    }

    if (!this.shadowCasterTiles.has(tileId)) {
      this.drawModernFloorShadow(ctx, x, y, size, neighbours.shadowMask);
    }

    if (pass === 'all' && MODERN_ANIMATED_TILES.has(tileId)) {
      this.drawModernAnimatedOverlay(ctx, tileId, x, y, size, neighbours.hash);
    }
  }

  /**
   * Wraps a gradient so a Retro HD style cuts it into flat colour bands: the colour stops are held
   * back until the closing one (offset 1) arrives, then replaced by the hard-edged bands. Any other
   * style gets the gradient as it is.
   */
  private gradient(grad: CanvasGradient): CanvasGradient {
    const bands = this.descriptor().finish?.gradientBands ?? 0;
    if (bands < MIN_GRADIENT_BANDS) return grad;
    const held: GradientStop[] = [];
    const addStop = grad.addColorStop;
    grad.addColorStop = (offset: number, colour: string): void => {
      held.push({ offset, colour });
      if (offset < GRADIENT_END_OFFSET) return;
      for (const stop of bandStops(held, bands)) addStop.call(grad, stop.offset, stop.colour);
      held.length = 0;
    };
    return grad;
  }

  /** Soft shadow thrown by casters north and west of a cell, fading away from them. */
  private drawModernFloorShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mask: number): void {
    if (!this.descriptor().floorShadows) return;
    if (!(mask & (NEIGHBOUR.N | NEIGHBOUR.W | NEIGHBOUR.NW))) return;
    const parts: ShadowPart[] = [];
    if (mask & NEIGHBOUR.N) parts.push('north');
    if (mask & NEIGHBOUR.W) parts.push('west');
    else if (mask & NEIGHBOUR.NW && !(mask & NEIGHBOUR.N)) parts.push('corner');
    for (const part of parts) {
      const sprite = this.getSprite(`shadow|${this.style}|${part}|${size}`, size, size, 0, (sctx) =>
        this.paintFloorShadow(sctx, part, size)
      );
      if (sprite) ctx.drawImage(sprite, x, y);
      else this.paintFloorShadow(ctx, part, size, x, y);
    }
  }

  /** One part of a floor shadow, as a gradient fading away from the caster. */
  private paintFloorShadow(ctx: CanvasRenderingContext2D, part: ShadowPart, size: number, x = 0, y = 0): void {
    const pal = this.pal();
    const depth = size * this.getSettings().floorShadowDepthTile;
    const side = depth * SIDE_SHADOW_RATIO;
    let grad: CanvasGradient;
    if (part === 'north') {
      grad = this.gradient(ctx.createLinearGradient(0, y, 0, y + depth));
    } else if (part === 'west') {
      grad = this.gradient(ctx.createLinearGradient(x, 0, x + side, 0));
    } else {
      grad = this.gradient(ctx.createRadialGradient(x, y, 0, x, y, depth));
    }
    grad.addColorStop(0, pal.modernFloorShadow);
    grad.addColorStop(1, pal.modernShadowClear);
    ctx.fillStyle = grad;
    if (part === 'north') ctx.fillRect(x, y, size, depth);
    else if (part === 'west') ctx.fillRect(x, y, side, size);
    else ctx.fillRect(x, y, depth, depth);
  }

  /** Seams, vents and scuffs on some floor cells, so open areas are not a flat grid. */
  private drawModernFloorDetail(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, hash: number): void {
    if (hash % this.getSettings().floorDetailEvery !== 0) return;
    const pal = this.pal();
    const kind = (hash >>> FLOOR_DETAIL_KIND_SHIFT) % FLOOR_DETAIL_KINDS;
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.save();
    ctx.lineWidth = Math.max(1, size * FLOOR_DETAIL_LINE_TILE);
    if (kind === 0) {
      // Panel seam across the cell, a dark groove with a lit lip.
      ctx.fillStyle = pal.modernFloorDetailDark;
      ctx.fillRect(x, cy, size, ctx.lineWidth);
      ctx.fillStyle = pal.modernFloorDetail;
      ctx.fillRect(x, cy + ctx.lineWidth, size, ctx.lineWidth);
    } else if (kind === 1) {
      // Vent grille.
      const slatW = size * FLOOR_VENT_WIDTH_TILE;
      const pitch = size * FLOOR_VENT_PITCH_TILE;
      ctx.fillStyle = pal.modernFloorDetailDark;
      for (let i = 0; i < FLOOR_VENT_SLATS; i++) {
        this.roundRect(ctx, cx - slatW / 2, cy + (i - 1) * pitch - ctx.lineWidth, slatW, ctx.lineWidth * 2, ctx.lineWidth);
        ctx.fill();
      }
    } else {
      // Scuff marks.
      ctx.strokeStyle = pal.modernFloorDetail;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.2, cy + size * 0.12);
      ctx.lineTo(cx + size * 0.05, cy - size * 0.06);
      ctx.moveTo(cx - size * 0.08, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.18, cy + size * 0.02);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Modern per-frame overlays. Glowing parts are pre-rendered sprites that are only
   * moved, rotated or scaled here, so no shadow blur or gradient is built per frame.
   */
  private drawModernAnimatedOverlay(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    hash: number = 0
  ): void {
    const pal = this.pal();
    const t = this.timeTick * MODERN_ANIM_SPEED;
    const cx = x + size / 2;
    const cy = y + size / 2;
    // Per-cell phase, so neighbouring cells of the same tile do not move in lockstep.
    const phase = ((hash & PHASE_MASK) / PHASE_MASK) * FULL_TURN;

    switch (tileId) {
      case 'water': {
        // Animated glowing caustic waves
        ctx.strokeStyle = pal.modernWaterGlow;
        ctx.lineWidth = 2;
        for (let r = 0; r < 2; r++) {
          const wy = y + size * (0.32 + r * 0.36);
          const shift = Math.sin(t + r * 2) * (size * 0.12);
          ctx.beginPath();
          ctx.moveTo(x + size * 0.18 + shift, wy);
          ctx.quadraticCurveTo(x + size * 0.5, wy - 4, x + size * 0.82 + shift, wy);
          ctx.stroke();
        }
        // A sparkle that drifts across the cell and fades in and out.
        const drift = (t * WATER_SPARKLE_SPEED + phase) % FULL_TURN;
        const glint = Math.sin(drift);
        if (glint > 0) {
          ctx.save();
          ctx.globalAlpha = glint;
          ctx.fillStyle = pal.waterSparkle;
          const sx = x + size * (0.2 + (0.6 * drift) / FULL_TURN);
          const sy = y + size * (0.5 + Math.sin(phase) * 0.12);
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1, size * WATER_SPARKLE_RADIUS_TILE), 0, FULL_TURN);
          ctx.fill();
          ctx.restore();
        }
        break;
      }

      case 'fire':
      case 'flame_jet_on': {
        // Two flame tongues swaying out of step, and embers rising from the cell.
        ctx.fillStyle = pal.modernFireTongue;
        for (let i = 0; i < 2; i++) {
          const sway = Math.sin(t * 2.2 + phase + i * Math.PI) * (size * 0.08);
          const left = x + size * (0.14 + i * 0.32);
          const width = size * 0.42;
          const height = size * (0.62 + 0.1 * Math.sin(t * 3 + phase + i));
          ctx.beginPath();
          ctx.moveTo(left, y + size * 0.86);
          ctx.quadraticCurveTo(left + width * 0.3 + sway, y + size * 0.86 - height, left + width / 2 + sway, y + size * 0.86 - height);
          ctx.quadraticCurveTo(left + width * 0.7 + sway, y + size * 0.86 - height * 0.6, left + width, y + size * 0.86);
          ctx.closePath();
          ctx.fill();
        }
        ctx.save();
        ctx.fillStyle = pal.fireEmber;
        for (let i = 0; i < FIRE_EMBERS; i++) {
          const rise = (t * FIRE_EMBER_SPEED + phase + (i * FULL_TURN) / FIRE_EMBERS) % FULL_TURN;
          const progress = rise / FULL_TURN;
          ctx.globalAlpha = 1 - progress;
          const ex = x + size * (0.3 + 0.4 * ((i + 0.5) / FIRE_EMBERS)) + Math.sin(rise * 2) * size * 0.05;
          const ey = y + size * (0.8 - 0.75 * progress);
          const ember = Math.max(1, size * FIRE_EMBER_SIZE_TILE);
          ctx.fillRect(ex, ey, ember, ember);
        }
        ctx.restore();
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        // Now and then, a glint sweeps diagonally across the ice; with reduced motion the ice rests.
        if (this.reducedMotion) break;
        const turns = (t * ICE_GLINT_SPEED + phase) / FULL_TURN;
        const cycle = turns % 1;
        if (cycle > ICE_GLINT_WINDOW) break;
        const sweep = cycle / ICE_GLINT_WINDOW;
        const bend = this.iceBend(tileId);
        if (bend) {
          // On a bend the glint runs along the curve, one way then the other on alternating
          // cycles, so both travel directions through the corner get shown.
          const forward = Math.floor(turns) % 2 === 0;
          const progress = forward ? sweep : 1 - sweep;
          this.drawIceBendGlint(ctx, bend, x, y, size, progress, Math.sin(sweep * Math.PI), pal.iceGlint);
          break;
        }
        const offset = size * (sweep * 2 - 0.5);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, size, size);
        ctx.clip();
        ctx.strokeStyle = pal.iceGlint;
        ctx.globalAlpha = Math.sin(sweep * Math.PI);
        ctx.lineWidth = Math.max(1, size * ICE_GLINT_WIDTH_TILE);
        ctx.beginPath();
        ctx.moveTo(x + offset - size * 0.5, y + size);
        ctx.lineTo(x + offset, y);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'force_n':
      case 'force_e':
      case 'force_s':
      case 'force_w':
      case 'force_random': {
        const pad = this.glowPad();
        const sprite = this.getSprite(`force|${this.style}|${tileId}|${size}`, size, size, pad, (sctx, o) =>
          this.paintForceArrow(sctx, tileId, o, o, size)
        );
        if (!sprite) break;
        const span = size * FORCE_SCROLL_SPAN_TILE;
        const shift = ((this.timeTick * size * FORCE_SCROLL_SPEED_TILE) % span) - span / 2;
        let dx = 0;
        let dy = 0;
        if (tileId === 'force_n') dy = -shift;
        else if (tileId === 'force_s') dy = shift;
        else if (tileId === 'force_e') dx = shift;
        else if (tileId === 'force_w') dx = -shift;
        ctx.drawImage(sprite, x - pad + dx, y - pad + dy);
        break;
      }

      case 'exit': {
        // Pulsing radial disc: one pre-rendered gradient, scaled to the pulse radius.
        const maxR = size * (EXIT_PULSE_BASE + EXIT_PULSE_AMPLITUDE);
        const disc = this.getSprite(`exitDisc|${this.style}|${size}`, maxR * 2, maxR * 2, 0, (sctx) => {
          const grad = this.gradient(sctx.createRadialGradient(maxR, maxR, 2, maxR, maxR, maxR));
          grad.addColorStop(0, pal.modernExitCore);
          grad.addColorStop(0.45, pal.modernExitMid);
          grad.addColorStop(1, pal.modernExitEdge);
          sctx.fillStyle = grad;
          sctx.beginPath();
          sctx.arc(maxR, maxR, maxR, 0, FULL_TURN);
          sctx.fill();
        });
        const pulseR = size * (EXIT_PULSE_BASE + Math.sin(t * 2) * EXIT_PULSE_AMPLITUDE);
        if (disc) {
          ctx.drawImage(disc, cx - pulseR, cy - pulseR, pulseR * 2, pulseR * 2);
        }

        ctx.strokeStyle = pal.modernExitRing;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.3, t, t + Math.PI * 1.4);
        ctx.stroke();
        break;
      }

      case 'teleport':
      case 'teleport_red':
      case 'teleport_blue':
      case 'teleport_yellow':
      case 'teleport_green': {
        const glow = this.getSettings().glowBlurPx;
        const pad = this.glowPad();
        const ringColor = this.teleportRingColor(tileId, pal.modernTeleportRing);
        const ring = this.getSprite(`teleRing|${this.style}|${tileId}|${size}`, size, size, pad, (sctx, o) => {
          sctx.strokeStyle = ringColor;
          sctx.shadowColor = ringColor;
          sctx.shadowBlur = glow.strong;
          sctx.lineWidth = 2.5;
          sctx.beginPath();
          sctx.arc(o + size / 2, o + size / 2, size * 0.34, 0, Math.PI * 1.5);
          sctx.stroke();
        });
        if (ring) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(t);
          ctx.drawImage(ring, -(size / 2 + pad), -(size / 2 + pad));
          ctx.restore();
        }

        const maxCore = size * (TELEPORT_CORE_BASE + TELEPORT_CORE_AMPLITUDE);
        const core = this.getSprite(`teleCore|${this.style}|${tileId}|${size}`, maxCore * 2, maxCore * 2, pad, (sctx, o) => {
          sctx.fillStyle = pal.teleportCore;
          sctx.shadowColor = ringColor;
          sctx.shadowBlur = glow.strong;
          sctx.beginPath();
          sctx.arc(o + maxCore, o + maxCore, maxCore, 0, FULL_TURN);
          sctx.fill();
        });
        if (core) {
          const coreR = size * (TELEPORT_CORE_BASE + Math.sin(t * 3) * TELEPORT_CORE_AMPLITUDE);
          const scale = coreR / maxCore;
          const extent = core.width * scale;
          ctx.drawImage(core, cx - extent / 2, cy - extent / 2, extent, extent);
        }
        const glyphKey = teleporterGlyphKey(ConfigRegistry.getTile(tileId));
        if (glyphKey) {
          this.drawColorGlyph(ctx, glyphKey, cx, cy, size * TELEPORT_GLYPH_RADIUS_TILE, pal.glyphInk);
        }
        break;
      }
    }
  }

  /** Neon force floor arrow (with its glow), centred in a tile at (x, y). */
  private paintForceArrow(ctx: CanvasRenderingContext2D, tileId: string, x: number, y: number, size: number): void {
    const pal = this.pal();
    ctx.save();
    ctx.strokeStyle = pal.modernForceNeon;
    ctx.fillStyle = pal.modernForceNeon;
    ctx.shadowColor = pal.modernForceNeon;
    ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    ctx.lineWidth = 2.5;

    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.24;
    ctx.beginPath();
    if (tileId === 'force_random') {
      ctx.arc(cx, cy, r, 0, FULL_TURN);
    } else if (tileId === 'force_n') {
      ctx.moveTo(cx - r, cy + r * 0.5);
      ctx.lineTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r, cy + r * 0.5);
    } else if (tileId === 'force_s') {
      ctx.moveTo(cx - r, cy - r * 0.5);
      ctx.lineTo(cx, cy + r * 0.6);
      ctx.lineTo(cx + r, cy - r * 0.5);
    } else if (tileId === 'force_e') {
      ctx.moveTo(cx - r * 0.5, cy - r);
      ctx.lineTo(cx + r * 0.6, cy);
      ctx.lineTo(cx - r * 0.5, cy + r);
    } else if (tileId === 'force_w') {
      ctx.moveTo(cx + r * 0.5, cy - r);
      ctx.lineTo(cx - r * 0.6, cy);
      ctx.lineTo(cx + r * 0.5, cy + r);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Bend geometry of a corner ice tile, read once per tile id from its definition; null for plain ice. */
  private iceBend(tileId: string): IceBendGeometry | null {
    const cached = this.iceBends.get(tileId);
    if (cached !== undefined) return cached;
    const bend = iceBendGeometry(ConfigRegistry.getTile(tileId));
    this.iceBends.set(tileId, bend);
    return bend;
  }

  /**
   * A corner ice tile drawn as a rounded bend: the walled corner of the cell stays solid, the open
   * quadrant is a quarter disc of ice reaching both open edges, and a band along the slide path
   * carries a specular streak. The optional rim lights the curved edge. `insetPx` shrinks the
   * whole bend by that many pixels on each side, matching a renderer that leaves a gutter around
   * its ice cells.
   */
  private drawIceBend(
    ctx: CanvasRenderingContext2D,
    bend: IceBendGeometry,
    cellX: number,
    cellY: number,
    cellSize: number,
    insetPx: number,
    paint: { wall: string; fill: string | CanvasGradient; band: string; streak: string; rim?: string }
  ): void {
    const x = cellX + insetPx;
    const y = cellY + insetPx;
    const size = cellSize - insetPx * 2;
    const cx = x + bend.cx * size;
    const cy = y + bend.cy * size;
    const endAngle = bend.startAngle + QUARTER_TURN;
    ctx.save();
    ctx.lineCap = 'butt';

    ctx.fillStyle = paint.wall;
    ctx.fillRect(x, y, size, size);

    // Open quadrant: the arc reaches the far corner of each open edge, so plain ice next door joins it.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size, bend.startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = paint.fill;
    ctx.fill();

    const radius = size * ICE_BEND_RADIUS_TILE;
    ctx.strokeStyle = paint.band;
    ctx.lineWidth = size * ICE_BEND_BAND_WIDTH_TILE;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, bend.startAngle, endAngle);
    ctx.stroke();

    ctx.strokeStyle = paint.streak;
    ctx.lineWidth = Math.max(1, size * ICE_BEND_STREAK_WIDTH_TILE);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, bend.startAngle, endAngle);
    ctx.stroke();

    if (paint.rim) {
      const rimWidth = Math.max(1, size * ICE_BEND_RIM_WIDTH_TILE);
      ctx.strokeStyle = paint.rim;
      ctx.lineWidth = rimWidth;
      ctx.beginPath();
      ctx.arc(cx, cy, size - rimWidth / 2, bend.startAngle, endAngle);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A glint travelling along the band of an ice bend. `progress` 0 puts it at the start of the
   * arc and 1 at its end; the glint is clipped to the open quadrant as it enters and leaves.
   */
  private drawIceBendGlint(
    ctx: CanvasRenderingContext2D,
    bend: IceBendGeometry,
    x: number,
    y: number,
    size: number,
    progress: number,
    alpha: number,
    color: string
  ): void {
    const cx = x + bend.cx * size;
    const cy = y + bend.cy * size;
    const endAngle = bend.startAngle + QUARTER_TURN;
    const from = bend.startAngle - ICE_BEND_GLINT_SPAN + progress * (QUARTER_TURN + ICE_BEND_GLINT_SPAN);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size, bend.startAngle, endAngle);
    ctx.closePath();
    ctx.clip();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = size * ICE_BEND_BAND_WIDTH_TILE;
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICE_BEND_RADIUS_TILE, from, from + ICE_BEND_GLINT_SPAN);
    ctx.stroke();
    ctx.restore();
  }

  private buttonColor(tileId: string): string {
    const pal = this.pal();
    return pal[BUTTON_COLOR_KEYS[tileId] ?? DEFAULT_COLOR_KEY] || pal[DEFAULT_COLOR_KEY];
  }

  /** Ring colour of a teleporter: its colour key when it has one, else the plain ring colour. */
  private teleportRingColor(tileId: string, plainColor: string): string {
    const pal = this.pal();
    const colorKey = ConfigRegistry.getTile(tileId).colorKey;
    return (colorKey && pal[colorKey]) || plainColor;
  }

  /** A small key (bow and bit) in the lower part of a tile, the key thief's badge. */
  private drawKeyGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + size * 0.38, y + size * 0.66, size * 0.08, 0, FULL_TURN);
    ctx.fill();
    ctx.fillRect(x + size * 0.44, y + size * 0.64, size * 0.26, size * 0.05);
    ctx.fillRect(x + size * 0.6, y + size * 0.69, size * 0.04, size * 0.07);
    ctx.fillRect(x + size * 0.66, y + size * 0.69, size * 0.04, size * 0.07);
  }

  /** The forbidden item's icon under a red crossed ring, on the floor already drawn. */
  private drawForbiddenItem(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isModern: boolean
  ): void {
    const pal = this.pal();
    const itemId = ConfigRegistry.getTile(tileId).forbiddenItem;
    const iconSize = size * FORBID_ICON_SCALE;
    const inset = (size - iconSize) / 2;
    if (itemId) this.paintItem(ctx, itemId, x + inset, y + inset, iconSize, isModern);
    ctx.save();
    ctx.strokeStyle = pal.forbidSign;
    ctx.lineWidth = Math.max(2, size * FORBID_LINE_WIDTH_TILE);
    if (isModern) {
      ctx.shadowColor = pal.forbidSign;
      ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    }
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * FORBID_RING_TILE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, FULL_TURN);
    ctx.stroke();
    const d = r * Math.SQRT1_2;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.stroke();
    ctx.restore();
  }

  /** Nozzle of a flame jet: a dark disc with a lighter rim, set into the cell. */
  private drawFlameJetNozzle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, isModern: boolean): void {
    const pal = this.pal();
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.strokeStyle = pal.flameJetRim;
    ctx.lineWidth = isModern ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, size * FLAME_JET_RIM_TILE, 0, FULL_TURN);
    ctx.stroke();
    ctx.fillStyle = pal.flameJetNozzle;
    ctx.beginPath();
    ctx.arc(cx, cy, size * FLAME_JET_NOZZLE_TILE, 0, FULL_TURN);
    ctx.fill();
  }

  /** A turtle seen from above, floating on the water drawn under it. */
  private drawTurtle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, isModern: boolean): void {
    const pal = this.pal();
    const cx = x + size * 0.46;
    const cy = y + size / 2;
    ctx.save();
    if (isModern) {
      ctx.shadowColor = pal.modernBlockShadow;
      ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    }
    ctx.fillStyle = pal.turtleSkin;
    ctx.beginPath();
    ctx.arc(x + size * TURTLE.headX, cy, size * TURTLE.headRadius, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = pal.turtleShell;
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * TURTLE.shellRx, size * TURTLE.shellRy, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = pal.turtleShellLight;
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * TURTLE.shellRx * 0.55, size * TURTLE.shellRy * 0.55, 0, 0, FULL_TURN);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * TURTLE.shellRx, cy);
    ctx.lineTo(cx + size * TURTLE.shellRx, cy);
    ctx.moveTo(cx, cy - size * TURTLE.shellRy);
    ctx.lineTo(cx, cy + size * TURTLE.shellRy);
    ctx.stroke();
  }

  /** A bonus pennant: pole, flag and the points (or multiplier) it is worth. */
  private paintBonusFlag(
    ctx: CanvasRenderingContext2D,
    def: TileDefinition,
    x: number,
    y: number,
    size: number,
    isModern: boolean
  ): void {
    const pal = this.pal();
    const flagColor = def.scoreMultiplier ? pal.bonusFlagMultiplier : pal.bonusFlag;
    const label = def.scoreMultiplier ? `${BONUS_MULTIPLIER_PREFIX}${def.scoreMultiplier}` : String(def.scoreBonus ?? 0);
    const poleX = x + size * BONUS_POLE_X_TILE;
    const top = y + size * BONUS_FLAG.top;
    ctx.save();
    if (isModern) {
      ctx.shadowColor = flagColor;
      ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    }
    ctx.fillStyle = pal.bonusPole;
    ctx.fillRect(poleX - 1, top, 2, size * 0.7);
    ctx.fillStyle = flagColor;
    ctx.beginPath();
    ctx.moveTo(poleX, top);
    ctx.lineTo(poleX + size * BONUS_FLAG.width, top + size * BONUS_FLAG.height * 0.5);
    ctx.lineTo(poleX, top + size * BONUS_FLAG.height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = pal.bonusText;
    const font = isModern ? this.getSettings().hintFontModern : this.getSettings().hintFontRetro;
    ctx.font = `${HINT_FONT_WEIGHT} ${Math.max(6, Math.floor(size * BONUS_FONT_SCALE))}px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, poleX + size * 0.05, top + size * BONUS_FLAG.height * 0.5, size * BONUS_FLAG.width * 0.72);
    ctx.restore();
  }

  /**
   * A stopwatch, with a plus or minus sign on its dial after what it does to the time. A tile that slows
   * the monsters gets a blue body and a pause mark (two bars) instead, so it never reads as a time bonus.
   */
  private paintStopwatch(
    ctx: CanvasRenderingContext2D,
    def: TileDefinition,
    x: number,
    y: number,
    size: number,
    isModern: boolean
  ): void {
    const pal = this.pal();
    const gain = (def.timeBonusSeconds ?? 0) >= 0;
    const slows = def.slowsMonsters !== undefined;
    const bodyColor = slows ? pal[SLOW_TIME_BODY_KEY] : pal.stopwatchBody;
    const signColor = slows ? bodyColor : gain ? pal.stopwatchPlus : pal.stopwatchMinus;
    const cx = x + size / 2;
    const cy = y + size * STOPWATCH.cy;
    const r = size * STOPWATCH.radius;
    ctx.save();
    if (isModern) {
      ctx.shadowColor = signColor;
      ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
    }
    ctx.fillStyle = pal.stopwatchCrown;
    ctx.fillRect(cx - size * STOPWATCH.crownWidth / 2, cy - r - size * STOPWATCH.crownHeight, size * STOPWATCH.crownWidth, size * STOPWATCH.crownHeight);
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, FULL_TURN);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = pal.stopwatchFace;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = signColor;
    if (slows) {
      const barWidth = size * SLOW_MARK.barWidth;
      const barHalfHeight = size * SLOW_MARK.barHalfHeight;
      const offset = size * SLOW_MARK.barOffset;
      ctx.fillRect(cx - offset - barWidth / 2, cy - barHalfHeight, barWidth, barHalfHeight * 2);
      ctx.fillRect(cx + offset - barWidth / 2, cy - barHalfHeight, barWidth, barHalfHeight * 2);
      return;
    }
    const half = size * STOPWATCH.signHalf;
    const thick = size * STOPWATCH.signThickness;
    ctx.fillRect(cx - half, cy - thick / 2, half * 2, thick);
    if (gain) ctx.fillRect(cx - thick / 2, cy - half, thick, half * 2);
  }

  private drawButtonGlyph(ctx: CanvasRenderingContext2D, tileId: string, x: number, y: number, size: number): void {
    this.drawColorGlyph(
      ctx,
      BUTTON_GLYPH_KEYS[tileId] ?? DEFAULT_COLOR_KEY,
      x + size / 2,
      y + size / 2,
      size * 0.09,
      this.pal().glyphInk
    );
  }

  private drawHintGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    fontScale: number,
    fontFamily: string,
    color: string
  ): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${HINT_FONT_WEIGHT} ${Math.floor(size * fontScale)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(HINT_GLYPH, x + size / 2, y + size / 2 + 1);
    ctx.restore();
  }

  public drawItem(
    ctx: CanvasRenderingContext2D,
    itemId: string,
    x: number,
    y: number,
    size: number
  ): void {
    if (isCc3dId(itemId)) {
      paintCc3dItem(ctx, itemId, x, y, size, this.cc3dTools(ctx));
      return;
    }
    if (!this.isHdVector() && this.retroSpritesReady()) {
      // Sprite items: no shadow, and a bob only in styles that ask for one (none do today).
      this.drawRetroLayers(ctx, retroItemLayers(itemId, ConfigRegistry.getTile(itemId)), x, y, size, 0, true);
      return;
    }
    const isModern = this.isHdVector();
    const bob = isModern && this.descriptor().itemBob && !this.reducedMotion ? Math.sin(this.timeTick * ITEM_BOB_SPEED) * ITEM_BOB_AMPLITUDE_TILE : 0;
    const bobOffset = bob * size;
    if (isModern) {
      // Bobbing up (negative offset) lifts the item off its shadow, which shrinks.
      const spread = 1 + bob * ITEM_SHADOW.shrinkPerTile;
      ctx.fillStyle = this.pal().modernItemShadow;
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size * ITEM_SHADOW.y, size * ITEM_SHADOW.rx * spread, size * ITEM_SHADOW.ry * spread, 0, 0, FULL_TURN);
      ctx.fill();
    }
    const pad = this.glowPad();
    const sprite = this.getSprite(`item|${this.style}|${itemId}|${size}`, size, size, pad, (sctx, o) =>
      this.paintItem(sctx, itemId, o, o, size, isModern)
    );
    if (sprite) {
      ctx.drawImage(sprite, x - pad, y + bobOffset - pad);
    } else {
      this.paintItem(ctx, itemId, x, y + bobOffset, size, isModern);
    }
  }

  private paintItem(
    ctx: CanvasRenderingContext2D,
    itemId: string,
    x: number,
    y: number,
    size: number,
    isModern: boolean
  ): void {
    const pal = this.pal();
    const glow = this.getSettings().glowBlurPx;

    switch (itemId) {
      case 'chip': {
        ctx.save();
        if (isModern) {
          ctx.shadowColor = pal.chipCore;
          ctx.shadowBlur = glow.medium;
        }
        ctx.fillStyle = pal.chipPins;
        for (let i = 0; i < 3; i++) {
          const py = y + Math.floor(size * (0.28 + i * 0.18));
          ctx.fillRect(x + Math.floor(size * 0.16), py, Math.floor(size * 0.68), 2.5);
        }
        ctx.fillStyle = pal.chipBody;
        this.roundRect(
          ctx,
          x + size * 0.25,
          y + size * 0.2,
          size * 0.5,
          size * 0.6,
          isModern ? 4 : 0
        );
        ctx.fill();

        ctx.fillStyle = pal.chipCore;
        this.roundRect(
          ctx,
          x + size * 0.38,
          y + size * 0.36,
          size * 0.24,
          size * 0.28,
          isModern ? 3 : 0
        );
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'key_red':
      case 'key_blue':
      case 'key_yellow':
      case 'key_green': {
        const def = ConfigRegistry.getTile(itemId);
        const cKey = def.colorKey || DEFAULT_COLOR_KEY;
        const color = pal[cKey] || pal[DEFAULT_COLOR_KEY];
        ctx.save();
        if (isModern) {
          ctx.shadowColor = color;
          ctx.shadowBlur = glow.medium;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + size * 0.34, y + size * 0.5, size * 0.16, 0, FULL_TURN);
        ctx.fill();
        ctx.fillRect(x + size * 0.45, y + size * 0.45, size * 0.36, size * 0.1);
        ctx.fillRect(x + size * 0.64, y + size * 0.55, size * 0.07, size * 0.14);
        ctx.fillRect(x + size * 0.74, y + size * 0.55, size * 0.07, size * 0.14);
        this.drawColorGlyph(ctx, cKey, x + size * 0.34, y + size * 0.5, size * 0.075, pal.glyphInk);
        ctx.restore();
        break;
      }

      case 'boots_water':
      case 'boots_fire':
      case 'boots_ice':
      case 'boots_force': {
        const c = pal[BOOT_COLOR_KEYS[itemId] ?? DEFAULT_BOOT_COLOR_KEY] || pal[DEFAULT_BOOT_COLOR_KEY];
        ctx.save();
        if (isModern) {
          ctx.shadowColor = c;
          ctx.shadowBlur = glow.soft;
        }
        ctx.fillStyle = c;
        this.roundRect(ctx, x + size * 0.25, y + size * 0.22, size * 0.26, size * 0.5, 3);
        ctx.fill();
        this.roundRect(ctx, x + size * 0.25, y + size * 0.54, size * 0.52, size * 0.24, 4);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'score_10':
      case 'score_100':
      case 'score_1000':
      case 'score_2x': {
        this.paintBonusFlag(ctx, ConfigRegistry.getTile(itemId), x, y, size, isModern);
        break;
      }

      case 'stopwatch_bonus':
      case 'stopwatch_penalty':
      case 'slow_time': {
        this.paintStopwatch(ctx, ConfigRegistry.getTile(itemId), x, y, size, isModern);
        break;
      }

      case 'bomb': {
        ctx.save();
        ctx.fillStyle = pal.bombBody;
        ctx.beginPath();
        ctx.arc(x + size * 0.5, y + size * 0.56, size * 0.27, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.bombSpark;
        if (isModern) {
          ctx.shadowColor = pal.bombSpark;
          ctx.shadowBlur = glow.medium;
        }
        ctx.beginPath();
        ctx.arc(x + size * 0.52, y + size * 0.24, size * 0.08, 0, FULL_TURN);
        ctx.fill();
        ctx.restore();
        break;
      }
    }
  }

  public drawEntity(
    ctx: CanvasRenderingContext2D,
    type: string,
    dir: Direction,
    x: number,
    y: number,
    size: number
  ): void {
    const painterId = EPOXY_TO_CC3D_PAINTER[type];
    if (painterId) {
      this.drawCc3dEntity(ctx, painterId, dir, x, y, size);
      return;
    }
    const epoxyVariant = EPOXY_MOB_BASES[type];
    if (epoxyVariant) {
      this.drawMobVariant(ctx, epoxyVariant, dir, x, y, size);
      return;
    }
    if (isCc3dId(type)) {
      this.drawCc3dEntity(ctx, type, dir, x, y, size);
      return;
    }
    const isBlock = BLOCK_TYPES.has(type) || ConfigRegistry.getEntityDef(type)?.mirrorAxis !== undefined;
    const frame = isBlock ? 0 : Math.floor(this.timeTick / MONSTER_FRAME_TICKS) % WALK_FRAMES;
    if (!this.isHdVector() && this.retroSpritesReady()) {
      const name = isBlock ? type : retroMonsterSprite(type, dir, frame);
      this.drawRetroLayers(ctx, [{ name }], x, y, size, 0, isBlock);
      return;
    }
    const pad = this.glowPad();
    const sprite = this.getSprite(`entity|${this.style}|${type}|${dir}|${frame}|${size}`, size, size, pad, (sctx, o) =>
      this.paintEntity(sctx, type, dir, o, o, size, frame)
    );
    if (sprite) {
      ctx.drawImage(sprite, x - pad, y - pad);
    } else {
      this.paintEntity(ctx, type, dir, x, y, size, frame);
    }
  }

  /** Outline drawn over a block that stands on a block target, so the covered target stays readable. */
  private drawBlockOnTargetOutline(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    if (!this.isHdVector() && this.retroSpritesReady()) {
      this.drawRetroLayers(ctx, [{ name: RETRO_SPRITE.blockOnTarget }], x, y, size);
      return;
    }
    const inset = size * BLOCK_ON_TARGET_OUTLINE.inset;
    ctx.save();
    ctx.strokeStyle = this.pal()[BLOCK_ON_TARGET_COLOR_KEY];
    ctx.lineWidth = Math.max(1, size * BLOCK_ON_TARGET_OUTLINE.width);
    this.roundRect(
      ctx,
      x + inset,
      y + inset,
      size - inset * 2,
      size - inset * 2,
      this.isHdVector() ? size * BLOCK_RADIUS_TILE : 0
    );
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A laser device from vector shapes (HD Neon, the Retro HD styles, the editor and the icons): an
   * emitter with its nozzle turned to the way it fires, a receiver with a lens in its group colour,
   * or a gate of the group colour, barred when closed and reduced to its posts when open.
   */
  private paintLaserTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isModern: boolean
  ): void {
    const pal = this.pal();
    const def = ConfigRegistry.getTile(tileId);
    const glow = this.getSettings().glowBlurPx;
    const inset = size * LASER_DEVICE.inset;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const radius = isModern ? size * BLOCK_RADIUS_TILE : 0;
    const group = def.laserReceiverGroup ?? def.laserGateGroup;
    const groupKey = group && pal[group] ? group : DEFAULT_COLOR_KEY;
    const groupColor = pal[groupKey];

    const housing = (): void => {
      ctx.fillStyle = pal.wallShadow;
      ctx.beginPath();
      ctx.roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, radius);
      ctx.fill();
      ctx.strokeStyle = pal.wallTop;
      ctx.lineWidth = Math.max(1, size * LASER_DEVICE.inset);
      ctx.stroke();
    };

    if (def.laserEmitter) {
      housing();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(LASER_EMITTER_ANGLE[def.laserEmitter]);
      const length = size * LASER_DEVICE.nozzleLength;
      const width = size * LASER_DEVICE.nozzleWidth;
      const top = -size / 2 + inset;
      const barrelWidth = size * LASER_DEVICE.barrelWidth;
      ctx.fillStyle = pal.wallTop;
      ctx.fillRect(-barrelWidth / 2, top, barrelWidth, size / 2 - top);
      ctx.strokeStyle = pal.wallBase;
      ctx.lineWidth = Math.max(1, size * LASER_DEVICE.inset);
      ctx.strokeRect(-barrelWidth / 2, top, barrelWidth, size / 2 - top);
      ctx.fillStyle = pal.laserBeam;
      if (isModern) {
        ctx.shadowColor = pal.laserBeam;
        ctx.shadowBlur = glow.medium;
      }
      ctx.fillRect(-width / 2, top, width, length);
      ctx.shadowBlur = 0;
      ctx.fillStyle = pal.laserBeamCore;
      const coreWidth = width * LASER_NOZZLE_CORE_RATIO;
      ctx.fillRect(-coreWidth / 2, top, coreWidth, length * LASER_NOZZLE_CORE_RATIO);
      ctx.restore();
      ctx.fillStyle = pal.wallBase;
      ctx.beginPath();
      ctx.arc(cx, cy, size * LASER_DEVICE.turretRadius, 0, FULL_TURN);
      ctx.fill();
      ctx.strokeStyle = pal.wallTop;
      ctx.stroke();
      ctx.fillStyle = pal.laserBeam;
      ctx.beginPath();
      ctx.arc(cx, cy, size * LASER_DEVICE.turretCoreRadius, 0, FULL_TURN);
      ctx.fill();
      return;
    }

    if (def.laserReceiverGroup !== undefined) {
      housing();
      ctx.fillStyle = groupColor;
      ctx.beginPath();
      ctx.arc(cx, cy, size * LASER_DEVICE.lensRadius, 0, FULL_TURN);
      ctx.fill();
      this.drawColorGlyph(ctx, groupKey, cx, cy, size * LASER_DEVICE.glyphRadius, pal.wallShadow);
      return;
    }

    // Gate: a barred field between two posts when closed, only the posts and faint guides when open.
    const post = size * LASER_DEVICE.postSize;
    ctx.fillStyle = pal.wallTop;
    for (const [px, py] of [
      [x, y],
      [x + size - post, y],
      [x, y + size - post],
      [x + size - post, y + size - post]
    ]) {
      ctx.fillRect(px, py, post, post);
    }
    const barWidth = size * LASER_DEVICE.barWidth;
    const barSpan = size - post * 2;
    ctx.save();
    if (def.laserGateOpen) {
      ctx.globalAlpha = LASER_DEVICE.openAlpha;
    } else {
      ctx.fillStyle = pal.wallShadow;
      const overlap = post * LASER_GATE_FIELD_OVERLAP_RATIO;
      ctx.fillRect(x + overlap, y + overlap, size - post, size - post);
      if (isModern) {
        ctx.shadowColor = groupColor;
        ctx.shadowBlur = glow.soft;
      }
    }
    ctx.fillStyle = groupColor;
    for (let i = 0; i < LASER_GATE_BAR_COUNT; i++) {
      const bx = x + post + (barSpan * (i + 1)) / (LASER_GATE_BAR_COUNT + 1) - barWidth / 2;
      ctx.fillRect(bx, y + post, barWidth, barSpan);
    }
    ctx.restore();
    if (!def.laserGateOpen) {
      this.drawColorGlyph(ctx, groupKey, cx, cy, size * LASER_DEVICE.glyphRadius, pal.laserBeamCore);
    }
  }

  /** A mirror block: a frame around a pane with the reflecting diagonal drawn across it. */
  private paintMirror(
    ctx: CanvasRenderingContext2D,
    axis: MirrorAxis,
    x: number,
    y: number,
    size: number
  ): void {
    const pal = this.pal();
    const isModern = this.isHdVector();
    const inset = size * MIRROR_BODY.inset;
    const pane = inset + size * MIRROR_BODY.glassInset;
    const radius = isModern ? size * BLOCK_RADIUS_TILE : 0;
    ctx.save();
    if (isModern) {
      ctx.fillStyle = pal.modernBlockShadow;
      ctx.beginPath();
      const shadowOffset = inset * MIRROR_BODY.shadowOffsetFactor;
      ctx.roundRect(x + shadowOffset, y + shadowOffset, size - inset * 2, size - inset * 2, radius);
      ctx.fill();
    }
    ctx.fillStyle = pal.mirrorFrame;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, size - inset * 2, size - inset * 2, radius);
    ctx.fill();
    ctx.fillStyle = pal.mirrorGlass;
    ctx.fillRect(x + pane, y + pane, size - pane * 2, size - pane * 2);
    ctx.strokeStyle = pal.mirrorSheen;
    ctx.lineWidth = Math.max(1, size * MIRROR_BODY.lineWidth);
    ctx.beginPath();
    if (axis === 'slash') {
      ctx.moveTo(x + pane, y + size - pane);
      ctx.lineTo(x + size - pane, y + pane);
    } else {
      ctx.moveTo(x + pane, y + pane);
      ctx.lineTo(x + size - pane, y + size - pane);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** The beams and lit receivers of the engine, painted as the game shows them. */
  private drawLaserBeams(
    ctx: CanvasRenderingContext2D,
    engine: PlayEngine,
    entities: readonly { type: string; kind: string; x: number; y: number }[],
    terrain: readonly (readonly string[])[],
    originX: number,
    originY: number,
    region: { x0: number; y0: number },
    unit: number,
    round: boolean
  ): void {
    const laser = engine as PlayEngine & { getLitReceivers?(): readonly GridPoint[] };
    const cells = laser.getBeamCells?.() ?? [];
    const litReceivers = laser.getLitReceivers?.() ?? [];
    this.drawBeamCells(ctx, {
      cells,
      emitterCells: laser.getEmitterBeamCells?.() ?? cells,
      litReceivers,
      entities,
      terrain,
      originX,
      originY,
      region,
      unit,
      round
    });
  }

  /**
   * Beam cells and the glow of the receivers they reach, over the terrain and under the entities. A
   * beam is drawn as rectangles (a halo and a bright core) so that in the pixel styles it stays on whole
   * sprite pixels; `round` marks the styles that draw a receiver glow as a disc. The game and the level
   * editor both draw through here. `emitterCells` are the cells emitter beams cross: the corners of a
   * mirror follow them only, a turret beam being drawn as plain lines.
   */
  public drawBeamCells(ctx: CanvasRenderingContext2D, draw: BeamCellsDraw): void {
    const { cells, emitterCells, litReceivers: lit, entities, terrain, originX, originY, region, unit, round } = draw;
    if (cells.length === 0 && lit.length === 0) return;
    const pal = this.pal();
    const glow = this.descriptor().glow ? this.getSettings().glowBlurPx : null;
    const cellAt = (cx: number, cy: number): { px: number; py: number } => ({
      px: originX + Math.floor((cx - region.x0) * unit),
      py: originY + Math.floor((cy - region.y0) * unit)
    });

    if (cells.length > 0) {
      const byCell = new Map<number, BeamCell>();
      const width = terrain[0]?.length ?? 0;
      // The corners of a mirror follow the emitter beams only: a turret beam never feeds a mirror, and
      // its cells are drawn as plain lines.
      for (const cell of emitterCells) byCell.set(cell.y * width + cell.x, cell);
      const mirrors = new Map<number, MirrorAxis>();
      const mirrorFronts = new Map<number, MirrorCorner>();
      for (const ent of entities) {
        const def = ent.kind === 'block' ? ConfigRegistry.getEntityDef(ent.type) : undefined;
        if (!def?.mirrorAxis) continue;
        mirrors.set(ent.y * width + ent.x, def.mirrorAxis);
        if (def.mirrorFrontCorner) mirrorFronts.set(ent.y * width + ent.x, def.mirrorFrontCorner);
      }
      const board: BeamBoard = {
        beamAt: (bx, by) => byCell.get(by * width + bx),
        mirrorAt: (bx, by) => mirrors.get(by * width + bx),
        mirrorFrontAt: (bx, by) => mirrorFronts.get(by * width + bx),
        emitterAt: (bx, by) => ConfigRegistry.getTile(terrain[by]?.[bx] ?? '').laserEmitter
      };
      const paintLayer = (thickness: number, color: string, blur: number): void => {
        ctx.save();
        ctx.fillStyle = color;
        if (blur > 0) {
          ctx.shadowColor = color;
          ctx.shadowBlur = blur;
        }
        for (const cell of cells) {
          const { px, py } = cellAt(cell.x, cell.y);
          for (const r of armRects(beamArms(cell, board), thickness)) {
            ctx.fillRect(
              px + Math.round(r.x * unit),
              py + Math.round(r.y * unit),
              Math.max(1, Math.round(r.w * unit)),
              Math.max(1, Math.round(r.h * unit))
            );
          }
        }
        ctx.restore();
      };
      paintLayer(BEAM_HALO_TILE, pal.laserBeam, glow ? glow.medium : 0);
      paintLayer(BEAM_CORE_TILE, pal.laserBeamCore, 0);
    }

    for (const receiver of lit) {
      const { px, py } = cellAt(receiver.x, receiver.y);
      const centreX = px + unit / 2;
      const centreY = py + unit / 2;
      ctx.save();
      ctx.fillStyle = pal.laserBeam;
      if (glow) {
        ctx.shadowColor = pal.laserBeam;
        ctx.shadowBlur = glow.medium;
      }
      const halo = unit * LASER_LIT_LENS.halo;
      const core = unit * LASER_LIT_LENS.core;
      if (round) {
        ctx.beginPath();
        ctx.arc(centreX, centreY, halo, 0, FULL_TURN);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = pal.laserBeamCore;
        ctx.beginPath();
        ctx.arc(centreX, centreY, core, 0, FULL_TURN);
        ctx.fill();
      } else {
        ctx.fillRect(Math.round(centreX - halo), Math.round(centreY - halo), Math.round(halo * 2), Math.round(halo * 2));
        ctx.shadowBlur = 0;
        ctx.fillStyle = pal.laserBeamCore;
        ctx.fillRect(Math.round(centreX - core), Math.round(centreY - core), Math.round(core * 2), Math.round(core * 2));
      }
      ctx.restore();
    }
  }

  /** A pushable block, with a top face and a darker front face like the walls. */
  private paintBlock(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number): void {
    const pal = this.pal();
    const isModern = this.isHdVector();
    const isIce = type === 'ice_block';
    const inset = Math.max(1, Math.round(size * BLOCK_INSET_TILE));
    const front = Math.round(size * this.getSettings().wallFrontDepthTile);
    const radius = isModern ? size * BLOCK_RADIUS_TILE : 0;
    const width = size - inset * 2;
    const topHeight = size - inset * 2 - front;
    const border = isIce ? pal.iceBlockBorder : pal.blockBorder;
    const face = isIce ? pal.iceBlockBase : pal.blockBase;

    ctx.save();
    if (isModern) {
      ctx.fillStyle = pal.modernBlockShadow;
      ctx.beginPath();
      ctx.roundRect(x + inset * 2, y + inset * 2, width, size - inset * 2, radius);
      ctx.fill();
    }
    // Front face.
    ctx.fillStyle = border;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, width, size - inset * 2, radius);
    ctx.fill();
    ctx.fillStyle = pal.modernWallFrontShade;
    ctx.fillRect(x + inset, y + inset + topHeight, width, front);
    // Top face with its rim.
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(x + inset * 2, y + inset * 2, width - inset * 2, topHeight - inset * 2, radius);
    ctx.fill();
    ctx.fillStyle = pal.monsterHighlight;
    ctx.fillRect(x + inset * 2, y + inset * 2, width - inset * 2, inset);
    ctx.restore();
  }

  /**
   * Monsters are drawn in a unit square centred on the tile: x and y run from -0.5 to
   * 0.5 and "forward" is -y. Monsters that travel head first are rotated to face their
   * direction; the others stay upright and look towards it.
   */
  private paintEntity(
    ctx: CanvasRenderingContext2D,
    type: string,
    dir: Direction,
    x: number,
    y: number,
    size: number,
    frame: number = 0
  ): void {
    if (BLOCK_TYPES.has(type)) {
      this.paintBlock(ctx, type, x, y, size);
      return;
    }
    const mirrorDef = ConfigRegistry.getEntityDef(type);
    const mirrorAxis = mirrorDef?.mirrorAxis;
    if (mirrorAxis) {
      this.paintMirror(ctx, mirrorAxis, x, y, size);
      return;
    }

    const pal = this.pal();
    const isModern = this.isHdVector();
    const bodyColor = pal[MONSTER_COLOR_KEYS[type] ?? DEFAULT_MONSTER_COLOR_KEY] || pal[DEFAULT_MONSTER_COLOR_KEY];
    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.save();
    if (isModern) {
      ctx.fillStyle = pal.modernEntityShadow;
      ctx.beginPath();
      ctx.ellipse(cx, y + size * 0.84, size * 0.3, size * 0.1, 0, 0, FULL_TURN);
      ctx.fill();
      if (GLOWING_MONSTERS.has(type)) {
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = this.getSettings().glowBlurPx.strong;
      }
    }

    ctx.translate(cx, cy);
    ctx.scale(size, size);
    if (HEAD_FIRST_MONSTERS.has(type)) ctx.rotate(DIRECTION_ANGLE[dir]);
    const radius = isModern ? 1 : 0;
    ctx.lineCap = isModern ? 'round' : 'butt';
    ctx.lineWidth = LIMB_WIDTH;
    // Dark limbs read on the light retro floor; on the dark modern floor they take the body colour.
    const limbColor = isModern ? bodyColor : pal.monsterLimb;
    ctx.strokeStyle = limbColor;
    const swing = frame === 0 ? 1 : -1;

    switch (type) {
      case 'bug': {
        // Alternating tripods of legs, body, head and antennae.
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ly = -0.08 + i * 0.14;
          const s = (i % 2 === 0 ? swing : -swing) * 0.06;
          ctx.moveTo(-0.12, ly);
          ctx.lineTo(-0.33, ly + s);
          ctx.moveTo(0.12, ly);
          ctx.lineTo(0.33, ly - s);
        }
        ctx.moveTo(-0.05, -0.3);
        ctx.lineTo(-0.14, -0.44 + swing * 0.02);
        ctx.moveTo(0.05, -0.3);
        ctx.lineTo(0.14, -0.44 - swing * 0.02);
        ctx.stroke();
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0.08, 0.2, 0.27, 0, 0, FULL_TURN);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -0.22, 0.12, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterLimb;
        ctx.fillRect(-0.01, -0.12, 0.02, 0.44);
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.ellipse(-0.09, 0.02, 0.05, 0.1, 0, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.25, 0.055, 0.035, null);
        break;
      }

      case 'paramecium': {
        // Cilia beating in two phases around an elongated cell.
        ctx.beginPath();
        for (let i = 0; i < PARAMECIUM_CILIA; i++) {
          const a = (FULL_TURN * i) / PARAMECIUM_CILIA;
          const bend = (i % 2 === frame ? 1 : -1) * 0.2;
          const ex = Math.cos(a) * 0.17;
          const ey = Math.sin(a) * 0.36;
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex * 1.45 + Math.cos(a + bend) * 0.02, ey * 1.18 + Math.sin(a + bend) * 0.02);
        }
        ctx.stroke();
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.18, 0.37, 0, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.ellipse(0, 0.06, 0.07, 0.11, 0, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.2, 0.06, 0.035, null);
        break;
      }

      case 'glider': {
        // Delta wing, the tips flexing between frames.
        const tip = frame === 0 ? 0.3 : 0.25;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(0, -0.4);
        ctx.lineTo(0.38, tip);
        ctx.lineTo(0, 0.15);
        ctx.lineTo(-0.38, tip);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.moveTo(0, -0.4);
        ctx.lineTo(0, 0.15);
        ctx.lineTo(-0.38, tip);
        ctx.closePath();
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.08, 0.06, 0.04, null);
        break;
      }

      case 'tank': {
        // Treads whose links scroll between frames, hull, turret and barrel.
        ctx.fillStyle = pal.tankHull;
        ctx.beginPath();
        ctx.roundRect(-0.38, -0.34, 0.17, 0.68, 0.04 * radius);
        ctx.roundRect(0.21, -0.34, 0.17, 0.68, 0.04 * radius);
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        for (let ty = -0.3 + (frame * TANK_LINK_PITCH) / 2; ty < 0.32; ty += TANK_LINK_PITCH) {
          ctx.fillRect(-0.37, ty, 0.15, 0.025);
          ctx.fillRect(0.22, ty, 0.15, 0.025);
        }
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.roundRect(-0.22, -0.28, 0.44, 0.58, 0.08 * radius);
        ctx.fill();
        ctx.fillStyle = pal.tankHull;
        ctx.fillRect(-0.045, -0.46, 0.09, 0.4);
        ctx.beginPath();
        ctx.arc(0, 0.04, 0.15, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.arc(-0.04, 0, 0.05, 0, FULL_TURN);
        ctx.fill();
        break;
      }

      case 'fireball': {
        // Flame tail streaming behind, flickering between frames.
        const tail = frame === 0 ? 0.48 : 0.4;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(-0.24, -0.02);
        ctx.quadraticCurveTo(-0.12, tail * 0.6, swing * 0.04, tail);
        ctx.quadraticCurveTo(0.12, tail * 0.6, 0.24, -0.02);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -0.06, 0.25, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterFlameCore;
        ctx.beginPath();
        ctx.arc(0, -0.09, 0.13, 0, FULL_TURN);
        ctx.fill();
        break;
      }

      case 'pink_ball': {
        // Bouncing ball, squashed on one frame.
        const ry = frame === 0 ? 0.31 : 0.27;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0.31 - ry, 0.3 + (0.31 - ry), ry, 0, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.arc(-0.1, -0.1, 0.08, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.02, 0.09, 0.055, dir);
        break;
      }

      case 'teeth': {
        // Chomping mouth below a pair of eyes.
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, 0.33, 0, FULL_TURN);
        ctx.fill();
        const open = frame === 0 ? 0.11 : 0.05;
        ctx.fillStyle = pal.monsterMouth;
        ctx.beginPath();
        ctx.ellipse(0, 0.13, 0.21, open, 0, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.eyeWhite;
        ctx.beginPath();
        for (let i = 0; i < TEETH_COUNT; i++) {
          const tx = -0.16 + (i * 0.32) / (TEETH_COUNT - 1);
          ctx.moveTo(tx - 0.035, 0.13 - open);
          ctx.lineTo(tx + 0.035, 0.13 - open);
          ctx.lineTo(tx, 0.13 - open + 0.07);
        }
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.12, 0.11, 0.06, dir);
        break;
      }

      case 'walker': {
        // Two legs stepping in turn under a round body.
        const lift = 0.06;
        ctx.fillStyle = limbColor;
        ctx.fillRect(-0.17, 0.12, 0.1, 0.3 - (frame === 0 ? lift : 0));
        ctx.fillRect(0.07, 0.12, 0.1, 0.3 - (frame === 1 ? lift : 0));
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, -0.04, 0.27, 0, FULL_TURN);
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.arc(-0.1, -0.14, 0.07, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, -0.06, 0.1, 0.06, dir);
        break;
      }

      case 'blob': {
        // Wobbling outline: alternate lobes swell between frames.
        const points: [number, number][] = [];
        for (let i = 0; i < BLOB_LOBES; i++) {
          const a = (FULL_TURN * i) / BLOB_LOBES;
          const r = 0.3 + (i % 2 === frame ? 0.04 : -0.02);
          points.push([Math.cos(a) * r, Math.sin(a) * r * 0.92 + 0.03]);
        }
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        for (let i = 0; i <= BLOB_LOBES; i++) {
          const [px, py] = points[i % BLOB_LOBES];
          const [nx, ny] = points[(i + 1) % BLOB_LOBES];
          const mx = (px + nx) / 2;
          const my = (py + ny) / 2;
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.quadraticCurveTo(px, py, mx, my);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.monsterHighlight;
        ctx.beginPath();
        ctx.ellipse(-0.1, -0.1, 0.08, 0.05, -0.5, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, 0, 0.1, 0.06, dir);
        break;
      }

      default: {
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, 0.33, 0, FULL_TURN);
        ctx.fill();
        this.paintEyePair(ctx, 0, 0, 0.1, 0.06, dir);
      }
    }
    ctx.restore();
  }

  /**
   * Two eyes centred on (cx, cy) in unit space, `spread` apart from the centre. With a
   * direction, eyes and pupils shift towards it; without one they stare forward (-y).
   */
  private paintEyePair(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    spread: number,
    r: number,
    lookDir: Direction | null
  ): void {
    const pal = this.pal();
    let lx = 0;
    let ly = -1;
    if (lookDir) {
      lx = lookDir === 'E' ? 1 : lookDir === 'W' ? -1 : 0;
      ly = lookDir === 'S' ? 1 : lookDir === 'N' ? -1 : 0;
    }
    const shift = lookDir ? r * EYE_LOOK_SHIFT : 0;
    ctx.save();
    ctx.shadowBlur = 0;
    for (const side of [-1, 1]) {
      const ex = cx + side * spread + lx * shift;
      const ey = cy + ly * shift;
      ctx.fillStyle = pal.eyeWhite;
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, FULL_TURN);
      ctx.fill();
      ctx.fillStyle = pal.eyePupil;
      ctx.beginPath();
      ctx.arc(ex + lx * r * EYE_PUPIL_SHIFT, ey + ly * r * EYE_PUPIL_SHIFT, r * EYE_PUPIL_RATIO, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draws the player. `frame` is 0 standing, 1 or 2 for the two strides; `hop` lifts
   * the sprite (in tiles) while its shadow stays on the ground.
   */
  public drawPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dir: Direction,
    inWater: boolean,
    alive: boolean,
    frame: number = 0,
    hop: number = 0
  ): void {
    if (!this.isHdVector() && this.retroSpritesReady()) {
      this.drawRetroLayers(ctx, [{ name: retroPlayerSprite(dir, inWater, alive, frame, this.playerSkin) }], x, y, size);
      return;
    }
    const pal = this.pal();
    if (this.isHdVector() && alive && !inWater) {
      const spread = 1 - hop * PLAYER_SHADOW_SHRINK;
      ctx.fillStyle = pal.modernPlayerShadow;
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size * 0.9, size * 0.26 * spread, size * 0.08 * spread, 0, 0, FULL_TURN);
      ctx.fill();
    }
    const lift = hop * size;
    const pad = this.glowPad();
    const sprite = this.getSprite(
      `player|${this.style}|${this.playerSkin}|${dir}|${inWater}|${alive}|${frame}|${size}`,
      size,
      size,
      pad,
      (sctx, o) => this.paintPlayer(sctx, o, o, size, dir, inWater, alive, frame)
    );
    if (sprite) {
      ctx.drawImage(sprite, x - pad, y - lift - pad);
    } else {
      this.paintPlayer(ctx, x, y - lift, size, dir, inWater, alive, frame);
    }
  }

  /** The player in unit space centred on the tile, seen from the front, back or side. */
  private paintPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dir: Direction,
    inWater: boolean,
    alive: boolean,
    frame: number = 0
  ): void {
    const pal = this.pal();
    const isModern = this.isHdVector();

    if (!alive) {
      ctx.fillStyle = pal.red;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, FULL_TURN);
      ctx.fill();
      return;
    }

    const side = dir === 'E' || dir === 'W';
    const stride = frame === 0 ? 0 : frame === 1 ? 1 : -1;
    const radius = isModern ? 1 : 0;
    const visor = isModern ? pal.modernPlayerVisor : pal.playerVisor;
    const glow = this.getSettings().glowBlurPx.soft;
    const julien = this.playerSkin === 'julien';
    const suitColor = julien ? pal.modernJulienShirt : pal.playerSuit;
    const suitShade = julien ? pal.modernJulienShirtShade : pal.playerSuitShade;

    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(size, size);
    if (dir === 'W') ctx.scale(-1, 1);

    if (!inWater) {
      // Legs and boots: one leg lifts (front and back views) or swings forward (side view).
      const legTop = 0.2;
      const legLen = 0.22;
      const legs: [number, number][] = side
        ? [
            [-0.1 + stride * PLAYER_STRIDE_SWING, legLen],
            [-0.01 - stride * PLAYER_STRIDE_SWING, legLen]
          ]
        : [
            [-0.15, legLen - (stride > 0 ? PLAYER_STRIDE_LIFT : 0)],
            [0.04, legLen - (stride < 0 ? PLAYER_STRIDE_LIFT : 0)]
          ];
      for (const [lx, len] of legs) {
        ctx.fillStyle = suitShade;
        ctx.fillRect(lx, legTop, 0.11, len);
        ctx.fillStyle = pal.playerBoot;
        ctx.beginPath();
        ctx.roundRect(lx - 0.01, legTop + len - 0.06, side ? 0.16 : 0.13, 0.07, 0.025 * radius);
        ctx.fill();
      }

      // Arms swing against the legs.
      ctx.fillStyle = suitShade;
      if (side) {
        ctx.beginPath();
        ctx.roundRect(-0.06 - stride * PLAYER_STRIDE_SWING, -0.02, 0.1, 0.24, 0.04 * radius);
        ctx.fill();
      } else {
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.roundRect(s > 0 ? 0.2 : -0.29, -0.02 + s * stride * PLAYER_ARM_SWING, 0.09, 0.22, 0.04 * radius);
          ctx.fill();
        }
      }

      // Torso, then a backpack seen from behind or the side, or a belt and chest light from the front.
      ctx.fillStyle = suitColor;
      ctx.beginPath();
      if (side) ctx.roundRect(-0.15, -0.06, 0.3, 0.3, 0.08 * radius);
      else ctx.roundRect(-0.21, -0.06, 0.42, 0.3, 0.08 * radius);
      ctx.fill();
      ctx.fillStyle = pal.playerHair;
      if (julien) {
        // No backpack or belt: a small sun on the chest seen from the front.
        if (dir === 'S') {
          ctx.fillStyle = pal.modernJulienSun;
          ctx.beginPath();
          ctx.arc(0, JULIEN_CHEST_SUN.y, JULIEN_CHEST_SUN.radius, 0, FULL_TURN);
          ctx.fill();
        }
      } else if (dir === 'N') {
        ctx.beginPath();
        ctx.roundRect(-0.14, -0.03, 0.28, 0.22, 0.05 * radius);
        ctx.fill();
      } else if (side) {
        ctx.beginPath();
        ctx.roundRect(-0.21, -0.02, 0.08, 0.2, 0.03 * radius);
        ctx.fill();
      } else {
        ctx.fillStyle = suitShade;
        ctx.fillRect(-0.21, 0.15, 0.42, 0.04);
        this.fillGlowRect(ctx, -0.04, 0.01, 0.08, 0.06, 0, visor, isModern ? glow : 0);
      }
    }

    // Head with hair seen from behind, or a cap and the visor on the side the player faces.
    const headY = -0.22;
    const headR = 0.19;
    if (julien) {
      this.paintJulienHead(ctx, pal, dir, headY, headR);
      ctx.restore();
      return;
    }
    ctx.fillStyle = dir === 'N' ? pal.playerHair : pal.playerSkin;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, FULL_TURN);
    ctx.fill();
    if (dir !== 'N') {
      ctx.fillStyle = pal.playerHair;
      ctx.beginPath();
      ctx.arc(0, headY, headR, Math.PI, FULL_TURN);
      ctx.closePath();
      ctx.fill();
      if (side) {
        ctx.fillRect(-headR, headY - 0.02, headR * 0.8, headR * 0.7);
        this.fillGlowRect(ctx, 0, headY - 0.03, 0.19, 0.09, 0.03 * radius, visor, isModern ? glow : 0);
      } else {
        this.fillGlowRect(ctx, -0.14, headY - 0.03, 0.28, 0.09, 0.03 * radius, visor, isModern ? glow : 0);
      }
    }
    ctx.restore();
  }

  /**
   * Head of the Julien skin in the already translated and scaled unit space (a west facing player
   * arrives mirrored): short dark hair with a small quiff, thin black glasses and a salt-and-pepper
   * beard from the front and the side, only hair and a hint of beard from behind.
   */
  private paintJulienHead(
    ctx: CanvasRenderingContext2D,
    pal: Record<string, string>,
    dir: Direction,
    headY: number,
    headR: number
  ): void {
    const side = dir === 'E' || dir === 'W';
    const hairAngle = Math.asin(JULIEN_HAIRLINE_DROP / headR);
    const beardAngle = Math.asin(JULIEN_BEARD_TOP / headR);
    const fillCircle = (color: string): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, FULL_TURN);
      ctx.fill();
    };
    if (dir === 'N') {
      fillCircle(pal.modernJulienHair);
      ctx.fillStyle = pal.modernJulienBeard;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * JULIEN_BEARD_SIDE.x, headY + JULIEN_BEARD_SIDE.y, JULIEN_BEARD_SIDE.rx, JULIEN_BEARD_SIDE.ry, 0, 0, FULL_TURN);
        ctx.fill();
      }
    } else {
      fillCircle(pal.playerSkin);
      ctx.fillStyle = pal.modernJulienHair;
      ctx.beginPath();
      ctx.arc(0, headY, headR, Math.PI + hairAngle, FULL_TURN - hairAngle);
      ctx.closePath();
      ctx.fill();
      // Beard over the lower face, lighter on the chin, with a darker moustache.
      ctx.fillStyle = pal.modernJulienBeard;
      ctx.beginPath();
      ctx.arc(0, headY, headR, beardAngle, Math.PI - beardAngle);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = pal.modernJulienBeardLight;
      ctx.beginPath();
      ctx.ellipse(side ? JULIEN_CHIN.sideShift : 0, headY + headR * JULIEN_CHIN.y, JULIEN_CHIN.rx, JULIEN_CHIN.ry, 0, 0, FULL_TURN);
      ctx.fill();
      ctx.fillStyle = pal.modernJulienMoustache;
      ctx.fillRect(side ? 0 : -JULIEN_MOUSTACHE.width / 2, headY + JULIEN_MOUSTACHE.y, side ? headR : JULIEN_MOUSTACHE.width, JULIEN_MOUSTACHE.height);
      // Thin rectangular glasses: two lenses and a bridge from the front, one lens and a temple from the side.
      ctx.strokeStyle = pal.modernJulienGlasses;
      ctx.lineWidth = JULIEN_LENS.line;
      const lensY = headY + JULIEN_GLASSES_Y;
      if (side) {
        ctx.strokeRect(JULIEN_SIDE_LENS_X, lensY, JULIEN_LENS.width, JULIEN_LENS.height);
        ctx.strokeStyle = pal.modernJulienGlassesAccent;
        ctx.beginPath();
        ctx.moveTo(JULIEN_SIDE_LENS_X, lensY + JULIEN_LENS.height / 2);
        ctx.lineTo(JULIEN_TEMPLE_START_X, lensY + JULIEN_LENS.height / 2);
        ctx.stroke();
        ctx.fillStyle = pal.modernJulienGlasses;
        ctx.beginPath();
        ctx.arc(JULIEN_TEMPLE_START_X, headY + JULIEN_BEARD_TOP / 2, JULIEN_EARBUD_RADIUS, 0, FULL_TURN);
        ctx.fill();
      } else {
        const leftX = -JULIEN_LENS.gap / 2 - JULIEN_LENS.width;
        const rightX = JULIEN_LENS.gap / 2;
        ctx.strokeRect(leftX, lensY, JULIEN_LENS.width, JULIEN_LENS.height);
        ctx.strokeRect(rightX, lensY, JULIEN_LENS.width, JULIEN_LENS.height);
        ctx.fillStyle = pal.modernJulienGlassesAccent;
        for (const lensX of [leftX, rightX]) {
          ctx.fillRect(lensX + JULIEN_GLINT.inset, lensY + JULIEN_GLINT.inset, JULIEN_GLINT.size, JULIEN_GLINT.size);
        }
        ctx.beginPath();
        ctx.moveTo(-JULIEN_LENS.gap / 2, lensY + JULIEN_LENS.height / 2);
        ctx.lineTo(JULIEN_LENS.gap / 2, lensY + JULIEN_LENS.height / 2);
        ctx.stroke();
      }
    }
    // Small raised quiff on top of the head.
    ctx.fillStyle = pal.modernJulienHair;
    ctx.beginPath();
    ctx.roundRect(
      JULIEN_QUIFF.x,
      headY - headR - JULIEN_QUIFF.lift,
      JULIEN_QUIFF.width,
      JULIEN_QUIFF.height,
      JULIEN_QUIFF.height / 2
    );
    ctx.fill();
  }

  /** Fills a rounded rectangle with an optional glow, leaving the context state as it was. */
  private fillGlowRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: string,
    blur: number
  ): void {
    ctx.save();
    if (blur > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  private getSettings(): RenderSettings {
    return resolveQualitySettings(ConfigRegistry.getGame().graphics, this.effectiveQuality, this.descriptor().glow);
  }

  /** Transparent margin kept around sprites so baked glows are not clipped. */
  private glowPad(): number {
    return Math.ceil(this.getSettings().glowBlurPx.strong * GLOW_PAD_FACTOR);
  }

  /**
   * Returns the sprite cached under `key`, painting it on first use. `paint` receives
   * the sprite context and the padding offset at which the shape's origin sits.
   * Returns null when no canvas can be created (non-DOM environment).
   */
  private getSprite(
    key: string,
    width: number,
    height: number,
    pad: number,
    paint: (sctx: CanvasRenderingContext2D, origin: number) => void
  ): HTMLCanvasElement | null {
    const cached = this.sprites.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null;
    if (this.sprites.size >= this.getSettings().spriteCacheMaxEntries) {
      // Sizes change continuously while zooming; start over rather than grow without bound.
      this.sprites.clear();
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width) + pad * 2;
    canvas.height = Math.ceil(height) + pad * 2;
    const sctx = canvas.getContext('2d');
    if (!sctx) return null;
    paint(sctx, pad);
    this.sprites.set(key, canvas);
    return canvas;
  }

  private drawColorGlyph(
    ctx: CanvasRenderingContext2D,
    colorKey: string,
    cx: number,
    cy: number,
    r: number,
    fillColor: string
  ): void {
    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = Math.max(1.5, r * 0.35);
    ctx.beginPath();
    if (colorKey === 'red') {
      // Diamond
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    } else if (colorKey === 'blue') {
      // Triangle
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.85);
      ctx.lineTo(cx - r, cy + r * 0.85);
      ctx.closePath();
      ctx.fill();
    } else if (colorKey === 'yellow') {
      // Plus / Cross
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
    } else if (colorKey === 'green') {
      // Ring
      ctx.arc(cx, cy, r * 0.78, 0, FULL_TURN);
      ctx.stroke();
    } else if (colorKey === 'orange') {
      // Saltire
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    if (r <= 0) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  public renderIconToDataUrl(kind: 'tile' | 'item' | 'entity' | 'player', id: string, dir: Direction = ICON_FACING): string {
    const iconSize = this.getSettings().iconPixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = iconSize;
    canvas.height = iconSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (kind === 'tile') {
      this.drawTile(ctx, id, 0, 0, iconSize, true, true);
    } else if (kind === 'item') {
      this.drawTile(ctx, FLOOR_TILE_ID, 0, 0, iconSize, true, true);
      this.drawItem(ctx, id, 0, 0, iconSize);
    } else if (kind === 'entity') {
      this.drawTile(ctx, FLOOR_TILE_ID, 0, 0, iconSize, true, true);
      this.drawEntity(ctx, id, dir, 0, 0, iconSize);
    } else if (kind === 'player') {
      this.drawTile(ctx, FLOOR_TILE_ID, 0, 0, iconSize, true, true);
      this.drawPlayer(ctx, 0, 0, iconSize, dir, false, true);
    }
    return canvas.toDataURL();
  }
}
