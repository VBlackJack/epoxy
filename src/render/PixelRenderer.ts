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
import { GameEngine } from '../core/GameEngine';
import { Direction, GraphicsStyle, GridPoint, ThemePalette } from '../core/types';
import {
  BOOT_COLOR_KEYS,
  BUTTON_COLOR_KEYS,
  BUTTON_GLYPH_KEYS,
  DEFAULT_BOOT_COLOR_KEY,
  DEFAULT_COLOR_KEY,
  DEFAULT_MONSTER_COLOR_KEY,
  FX_COLOR_KEYS,
  MONSTER_COLOR_KEYS
} from './paletteKeys';
import { FrameBudgetGuard } from './frameBudget';
import {
  AUTO_QUALITY_ID,
  GraphicsQuality,
  QUALITY_LEVELS,
  RenderSettings,
  resolveFrameBudget,
  resolveQualitySettings,
  resolveTheme
} from './renderSettings';
import { frameScaleFromDelta, scaleDecay, scaleLerpFactor } from './renderTiming';
import {
  collectTerrainFeatures,
  EMPTY_TERRAIN_FEATURES,
  TerrainFeatures,
  TerrainSnapshot
} from './terrainState';
import { Light, LightingLayer } from './LightingLayer';
import { cellHash, hasAll, ISOLATED_TILE, NEIGHBOUR, TileNeighbours, tileNeighbours } from './tileNeighbours';

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
  'exit',
  'teleport',
  'ice',
  'ice_nw',
  'ice_ne',
  'ice_sw',
  'ice_se'
]);
const RETRO_ANIMATED_TILES: ReadonlySet<string> = new Set(['water', 'fire', 'exit', 'teleport']);
const ANY_ANIMATED_TILES: ReadonlySet<string> = new Set([...MODERN_ANIMATED_TILES, ...RETRO_ANIMATED_TILES]);

const FULL_TURN = Math.PI * 2;
const HINT_GLYPH = '?';
const HINT_FONT_WEIGHT = 'bold';
/** Sprite padding around a glowing shape, as a multiple of the strongest blur radius. */
const GLOW_PAD_FACTOR = 2;

/** Retro tiles flip animation phase every N engine ticks, over a cycle of N phases. */
const RETRO_PHASE_TICKS = 8;
const RETRO_PHASE_COUNT = 4;
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
const FLICKERING_LIGHTS: ReadonlySet<string> = new Set(['fire', 'fireball']);
const LIGHT_FLICKER_SPEED = 0.35;
const LIGHT_PHASE_X = 1.7;
const LIGHT_PHASE_Y = 2.3;
/** Width of the dark gap between LCD pixels, as a fraction of one retro dot. */
const LCD_GAP_RATIO = 0.25;
/** The iris starts as a small window on the player, this many tiles wide. */
const IRIS_MIN_RADIUS_TILE = 0.6;

const BLOCK_TYPES:ReadonlySet<string> = new Set(['dirt_block', 'ice_block']);
const GLOWING_MONSTERS: ReadonlySet<string> = new Set(['fireball', 'pink_ball', 'glider']);
/** Monsters drawn facing their direction of travel; the others stay upright and look towards it. */
const HEAD_FIRST_MONSTERS: ReadonlySet<string> = new Set(['bug', 'paramecium', 'glider', 'tank', 'fireball']);
const BLOCK_INSET_TILE = 0.05;
const BLOCK_RADIUS_TILE = 0.1;
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

/** Minimap objective blink: visible for `on` frames out of every `period`. */
const MINIMAP_BLINK = { period: 20, on: 14 } as const;

export class PixelRenderer {
  private animFrame: number = 0;
  /** Animation clock in reference frames (fractional), advanced from real elapsed time. */
  private timeTick: number = 0;
  private lastFrameTimeMs: number | null = null;
  private currentViewportTiles: number = 13;
  private visualViewportTiles: number = 13;
  private lastViewportWidth: number = 13;
  private lastViewportHeight: number = 13;
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
    this.style = style;
  }

  public toggleStyle(): GraphicsStyle {
    this.style = this.style === 'modern' ? 'retro' : 'modern';
    return this.style;
  }

  public getThemeId(): string {
    return this.themeId;
  }

  public setThemeId(id: string): void {
    this.themeId = id;
  }

  /** Accent colour of the active theme, for the HUD to follow the biome. */
  public getThemeAccent(): string | undefined {
    return this.getActiveTheme()?.accentGlow;
  }

  public isLcdEnabled(): boolean {
    return this.lcdEnabled;
  }

  public setLcdEnabled(enabled: boolean): void {
    this.lcdEnabled = enabled;
  }

  /** With reduced motion, the opening iris, the hops, the bobbing and the screen shake are skipped. */
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

  /** In automatic mode, steps quality down one level when frames keep exceeding the budget. */
  private watchFrameBudget(frameMs: number): void {
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
    if (!this.visualCameraPos) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null;
    const gridCfg = ConfigRegistry.getGame().grid;
    const vw = this.lastViewportWidth || this.visualViewportTiles || gridCfg.viewportWidth;
    const vh = this.lastViewportHeight || this.visualViewportTiles || gridCfg.viewportHeight;
    const gx = Math.floor(this.visualCameraPos.x + normX * vw);
    const gy = Math.floor(this.visualCameraPos.y + normY * vh);
    const mapWidth = this.lastMapWidth || gridCfg.mapWidth;
    const mapHeight = this.lastMapHeight || gridCfg.mapHeight;
    if (gx < 0 || gx >= mapWidth || gy < 0 || gy >= mapHeight) return null;
    return { x: gx, y: gy };
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
    const gameCfg = ConfigRegistry.getGame();
    const pal = gameCfg.palette;
    const settings = this.getSettings();

    const fxKey = FX_COLOR_KEYS[kind];
    const primaryColor = fxKey ? pal[fxKey] : (colorKey && pal[colorKey]) || pal.yellow;

    if (kind === 'explosion') {
      this.shakeIntensity = this.reducedMotion ? 0 : settings.screenShakeExplosion;
    }

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

  private getActiveTheme(): ThemePalette | undefined {
    const gameCfg = ConfigRegistry.getGame();
    return resolveTheme(gameCfg.themes, this.themeId, gameCfg.graphics?.defaultTheme);
  }

  public renderViewport(ctx: CanvasRenderingContext2D, engine: GameEngine): void {
    const startMs = performance.now();
    this.renderScene(ctx, engine);
    this.watchFrameBudget(performance.now() - startMs);
  }

  private renderScene(ctx: CanvasRenderingContext2D, engine: GameEngine): void {
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
    const isModern = this.style === 'modern';
    const camLerp = isModern ? scaleLerpFactor(settings.cameraLerpFactor, frameScale) : 1;

    if (
      !this.visualViewportTiles ||
      !isModern ||
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
    const viewportWidth = Math.min(mapWidth, canvasWidth / tilePixelSize);
    const viewportHeight = Math.min(mapHeight, canvasHeight / tilePixelSize);
    this.lastViewportWidth = viewportWidth;
    this.lastViewportHeight = viewportHeight;
    const player = engine.getPlayer();

    // Reset interpolation caches on level change or undo/restart
    if (this.lastLevelId !== engine.getLevel().id || engine.getStepsCount() === 0) {
      this.lastLevelId = engine.getLevel().id;
      this.visualPlayerPos = { x: player.x, y: player.y };
    }

    const entityLerp = isModern ? scaleLerpFactor(settings.entityLerpFactor, frameScale) : 1;
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
    const targetCamX = Math.max(0, Math.min(mapWidth - viewportWidth, this.visualPlayerPos.x - halfW));
    const targetCamY = Math.max(0, Math.min(mapHeight - viewportHeight, this.visualPlayerPos.y - halfH));

    if (!this.visualCameraPos || !isModern) {
      this.visualCameraPos = {
        x: Math.max(0, Math.min(mapWidth - viewportWidth, player.x - Math.floor(viewportWidth / 2))),
        y: Math.max(0, Math.min(mapHeight - viewportHeight, player.y - Math.floor(viewportHeight / 2)))
      };
    } else {
      this.visualCameraPos.x += (targetCamX - this.visualCameraPos.x) * camLerp;
      this.visualCameraPos.y += (targetCamY - this.visualCameraPos.y) * camLerp;
    }

    const camX = this.visualCameraPos.x;
    const camY = this.visualCameraPos.y;

    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const entities = engine.getEntities();

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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

    this.syncTerrainCache(engine, terrain, tilePixelSize, startTileX, endTileX, startTileY, endTileY, settings);

    // Every tile is placed relative to the cache origin so overlays line up with it.
    const region = this.cacheRegion;
    const originX = Math.round((region.x0 - camX) * tilePixelSize);
    const originY = Math.round((region.y0 - camY) * tilePixelSize);
    const drawSize = Math.ceil(tilePixelSize);
    if (this.terrainCache) {
      ctx.drawImage(this.terrainCache, originX, originY);
    }

    const animatedTiles = isModern ? MODERN_ANIMATED_TILES : RETRO_ANIMATED_TILES;
    const animNeighbours = this.animNeighbours;
    for (const cell of this.terrainFeatures.animatedCells) {
      if (cell.x < startTileX || cell.x > endTileX || cell.y < startTileY || cell.y > endTileY) continue;
      if (!animatedTiles.has(cell.tileId)) continue;
      const px = originX + Math.floor((cell.x - region.x0) * tilePixelSize);
      const py = originY + Math.floor((cell.y - region.y0) * tilePixelSize);
      animNeighbours.hash = cellHash(cell.x, cell.y);
      this.drawTile(ctx, cell.tileId, px, py, drawSize, false, false, 'animated', animNeighbours);
    }

    // Lights are gathered while the scene is drawn and applied once it is complete.
    const lit = isModern && settings.lightingEnabled;
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
        this.addLight(cell.tileId, cell.x - camX, cell.y - camY, tilePixelSize, settings);
      }
    }

    for (let my = startTileY; my <= endTileY; my++) {
      const itemRow = items[my];
      if (!itemRow) continue;
      for (let mx = startTileX; mx <= endTileX; mx++) {
        const itemId = itemRow[mx];
        if (itemId) {
          const px = originX + Math.floor((mx - region.x0) * tilePixelSize);
          const py = originY + Math.floor((my - region.y0) * tilePixelSize);
          this.drawItem(ctx, itemId, px, py, drawSize);
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
        const px = (vPos.x - camX) * tilePixelSize;
        const py = (vPos.y - camY) * tilePixelSize;
        this.drawEntity(ctx, ent.type, ent.dir, px, py, tilePixelSize);
        if (lit) this.addLight(ent.type, vPos.x - camX, vPos.y - camY, tilePixelSize, settings);
      }
    }

    for (const uid of this.visualEntityPos.keys()) {
      if (!activeUids.has(uid)) {
        this.visualEntityPos.delete(uid);
      }
    }

    // Render A* Click-to-Move planned path waypoints
    if (this.plannedPath.length > 0) {
      ctx.save();
      const theme = this.getActiveTheme();
      const pathColor = theme ? theme.accentGlow : gameCfg.palette.pathLine;
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

    const playerPx = (this.visualPlayerPos.x - camX) * tilePixelSize;
    const playerPy = (this.visualPlayerPos.y - camY) * tilePixelSize;
    // Modern: stride and hop while gliding between cells. Retro snaps to cells, so the
    // stride alternates with each step taken instead.
    const steps = engine.getStepsCount();
    const remaining = Math.hypot(player.x - this.visualPlayerPos.x, player.y - this.visualPlayerPos.y);
    let walkFrame = 0;
    let hop = 0;
    if (isModern) {
      if (remaining > MOVING_EPSILON_TILES) {
        walkFrame = 1 + (steps % WALK_FRAMES);
        if (!this.reducedMotion) hop = Math.sin(Math.min(1, remaining) * Math.PI) * settings.playerHopTile;
      }
    } else if (steps > 0) {
      walkFrame = 1 + (steps % WALK_FRAMES);
    }
    this.drawPlayer(
      ctx,
      playerPx,
      playerPy,
      tilePixelSize,
      player.dir,
      player.inWater,
      player.alive,
      walkFrame,
      hop
    );

    if (lit) {
      this.addLight('player', this.visualPlayerPos.x - camX, this.visualPlayerPos.y - camY - hop, tilePixelSize, settings);
      const pal = gameCfg.palette;
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
    } else if (!isModern && this.lcdEnabled) {
      this.drawLcdGrid(ctx, originX, originY, tilePixelSize, settings);
    }

    this.drawMechanismLinksAndObjective(ctx, engine, camX, camY, tilePixelSize);

    if (isModern) {
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
    const color = ConfigRegistry.getGame().palette[source.colorKey];
    if (!color) return;
    let radius = source.radiusTile * tilePixelSize;
    if (FLICKERING_LIGHTS.has(id)) {
      // Each light flickers on its own phase, taken from where it is.
      const phase = this.timeTick * LIGHT_FLICKER_SPEED + gx * LIGHT_PHASE_X + gy * LIGHT_PHASE_Y;
      radius *= 1 + Math.sin(phase) * settings.lightingFlicker;
    }
    this.lights.push({ x: (gx + 0.5) * tilePixelSize, y: (gy + 0.5) * tilePixelSize, radius, color });
  }

  /**
   * Retro LCD look: dark gaps between screen pixels, one screen pixel being a retro dot.
   * The grid is anchored on the terrain so it scrolls with the map, not with the screen.
   */
  private drawLcdGrid(
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    tilePixelSize: number,
    settings: RenderSettings
  ): void {
    const pattern = this.getLcdPattern(ctx, this.retroDot(tilePixelSize));
    if (!pattern) return;
    ctx.save();
    ctx.globalAlpha = settings.lcdGridAlpha;
    ctx.translate(originX, originY);
    ctx.fillStyle = pattern;
    ctx.fillRect(-originX, -originY, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  private getLcdPattern(ctx: CanvasRenderingContext2D, dot: number): CanvasPattern | null {
    const key = 'lcd|' + dot;
    const cached = this.ditherPatterns.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null;
    const cell = document.createElement('canvas');
    cell.width = dot;
    cell.height = dot;
    const cctx = cell.getContext('2d');
    if (!cctx) return null;
    const gap = Math.max(1, Math.round(dot * LCD_GAP_RATIO));
    cctx.fillStyle = ConfigRegistry.getGame().palette.lcdGrid;
    cctx.fillRect(0, dot - gap, dot, gap);
    cctx.fillRect(dot - gap, 0, gap, dot - gap);
    const pattern = ctx.createPattern(cell, 'repeat');
    if (pattern) this.ditherPatterns.set(key, pattern);
    return pattern;
  }

  /**
   * Iris opening on the player when a level starts or restarts. Drawn outside the
   * screen shake, skipped with reduced motion.
   */
  private drawIris(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
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
    ctx.fillStyle = ConfigRegistry.getGame().palette.irisShade;
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
    engine: GameEngine,
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
      this.terrainFeatures = collectTerrainFeatures(terrain, ANY_ANIMATED_TILES, this.litTiles);
    }

    let trapKey = '';
    for (const trap of this.terrainFeatures.traps) {
      trapKey += engine.isCellClosedTrap(trap.x, trap.y) ? '1' : '0';
    }

    const cacheKey = `${this.style}|${this.themeId}|${tilePixelSize}`;
    const region = this.cacheRegion;
    const covered =
      this.terrainCache !== null &&
      startTileX >= region.x0 &&
      endTileX <= region.x1 &&
      startTileY >= region.y0 &&
      endTileY <= region.y1;
    if (!terrainChanged && covered && trapKey === this.trapStateKey && cacheKey === this.terrainCacheKey) {
      return;
    }
    this.trapStateKey = trapKey;
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
        const tileId = terrain[my]?.[mx] || 'floor';
        const isClosedTrap = tileId === 'trap' ? engine.isCellClosedTrap(mx, my) : false;
        const neighbours = tileNeighbours(terrain, mx, my, this.wallJoinTiles, this.shadowCasterTiles);
        this.drawTile(cacheCtx, tileId, px, py, drawSize, false, isClosedTrap, 'static', neighbours);
      }
    }
  }

  private syncTileSets(settings: RenderSettings): void {
    if (this.tileSetsSource === settings) return;
    this.tileSetsSource = settings;
    this.wallJoinTiles = new Set(settings.wallJoinTiles);
    this.shadowCasterTiles = new Set(settings.shadowCasterTiles);
    this.litTiles = new Set(Object.keys(settings.lightSources));
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
    ctx.beginPath();
    ctx.moveTo((ax + 0.5 - camX) * tilePixelSize, (ay + 0.5 - camY) * tilePixelSize);
    ctx.lineTo((bx + 0.5 - camX) * tilePixelSize, (by + 0.5 - camY) * tilePixelSize);
    ctx.stroke();
  }

  private drawMechanismLinksAndObjective(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    const pal = ConfigRegistry.getGame().palette;
    const terrain = engine.getTerrain();
    const hov = this.hoveredGridPoint;
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

    // 3. Green Button <-> Toggle Walls & Teleporter pairs (lists cached on terrain change)
    const { greenButtons, toggleWalls, teleporters } = this.terrainFeatures;
    if (showAll || hovTile === 'button_green') {
      ctx.strokeStyle = pal.linkToggle;
      ctx.globalAlpha = LINK_STYLE.toggleAlpha;
      for (const gb of greenButtons) {
        for (const tw of toggleWalls) {
          this.strokeGridLink(ctx, gb.x, gb.y, tw.x, tw.y, camX, camY, tilePixelSize);
        }
      }
    }

    if ((showAll || hovTile === 'teleport') && teleporters.length >= 2) {
      ctx.strokeStyle = pal.linkTeleport;
      ctx.globalAlpha = LINK_STYLE.teleportAlpha;
      for (let i = 0; i < teleporters.length; i++) {
        const a = teleporters[i];
        const b = teleporters[(i + 1) % teleporters.length];
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

  /**
   * Draws the whole level on the radar canvas, scaled so the level fills the
   * canvas whatever its size; `cellPx` is only used when the canvas has no size.
   */
  public renderMinimap(ctx: CanvasRenderingContext2D, engine: GameEngine, cellPx: number = 3): void {
    const gridCfg = ConfigRegistry.getGame().grid;
    const mapWidth = engine.getMapWidth() || gridCfg.mapWidth;
    const mapHeight = engine.getMapHeight() || gridCfg.mapHeight;
    const viewportWidth = this.lastViewportWidth || this.currentViewportTiles || gridCfg.viewportWidth;
    const viewportHeight = this.lastViewportHeight || this.currentViewportTiles || gridCfg.viewportHeight;
    const pal = ConfigRegistry.getGame().palette;
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const entities = engine.getEntities();
    const player = engine.getPlayer();

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const fitCellPx = Math.min(ctx.canvas.width / mapWidth, ctx.canvas.height / mapHeight);
    if (fitCellPx > 0) cellPx = fitCellPx;

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const tId = terrain[y][x];
        let color = pal.minimapFloor;
        if (tId === 'wall' || tId === 'toggle_wall_closed') color = pal.wallBase;
        else if (tId === 'water') color = pal.waterDeep;
        else if (tId === 'fire') color = pal.fireBase;
        else if (tId.startsWith('ice')) color = pal.iceBase;
        else if (tId.startsWith('force')) color = pal.forceBase;
        else if (tId === 'socket') color = pal.yellow;
        else if (tId === 'exit') color = pal.exitBase;
        else if (tId.startsWith('door_')) color = pal.blue;

        const item = items[y][x];
        if (item === 'chip') color = pal.chipCore;
        else if (item?.startsWith('key_')) color = pal.yellow;

        ctx.fillStyle = color;
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }

    for (const ent of entities) {
      ctx.fillStyle = ent.kind === 'block' ? pal.blockBase : pal.red;
      ctx.fillRect(ent.x * cellPx, ent.y * cellPx, cellPx, cellPx);
    }

    ctx.fillStyle = pal.minimapPlayer;
    ctx.fillRect(player.x * cellPx, player.y * cellPx, cellPx, cellPx);

    if (this.objectivePoint && this.timeTick % MINIMAP_BLINK.period < MINIMAP_BLINK.on) {
      ctx.strokeStyle = pal.minimapObjective;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        this.objectivePoint.x * cellPx - 1,
        this.objectivePoint.y * cellPx - 1,
        cellPx + 2,
        cellPx + 2
      );
    }

    // Show the frame the main view actually displays; compute it only before the first render.
    const camX =
      this.visualCameraPos?.x ??
      Math.max(0, Math.min(mapWidth - viewportWidth, player.x - Math.floor(viewportWidth / 2)));
    const camY =
      this.visualCameraPos?.y ??
      Math.max(0, Math.min(mapHeight - viewportHeight, player.y - Math.floor(viewportHeight / 2)));
    ctx.strokeStyle = pal.minimapViewport;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      camX * cellPx + 0.5,
      camY * cellPx + 0.5,
      viewportWidth * cellPx - 1,
      viewportHeight * cellPx - 1
    );
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
    if (this.style === 'modern' && !isEditor) {
      const theme = this.getActiveTheme();
      // Modern tiles are themed; without any theme configured the retro look is used.
      if (theme) {
        this.drawModernTile(ctx, tileId, x, y, size, isClosedTrap, theme, pass, neighbours);
        return;
      }
    }

    if (pass === 'animated') {
      if (RETRO_ANIMATED_TILES.has(tileId)) this.drawRetroAnimatedOverlay(ctx, tileId, x, y, size);
      return;
    }

    const pal = ConfigRegistry.getGame().palette;

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

      case 'thin_wall_n':
      case 'thin_wall_e':
      case 'thin_wall_s':
      case 'thin_wall_w':
      case 'thin_wall_se': {
        const def = ConfigRegistry.getTile(tileId);
        const edges = def.blockedEdges || [];
        const bar = Math.max(4, Math.floor(size * 0.14));
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

      case 'fire': {
        ctx.fillStyle = pal.fireBase;
        ctx.fillRect(x, y, size, size);
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        ctx.fillStyle = pal.iceBase;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.strokeStyle = pal.iceShine;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.2, y + size * 0.8);
        ctx.lineTo(x + size * 0.8, y + size * 0.2);
        ctx.stroke();
        this.fillIceCorner(ctx, tileId, x, y, size, pal.iceCornerWall);
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
      case 'button_red': {
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

      case 'teleport': {
        ctx.strokeStyle = pal.teleportRing;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.34, 0, FULL_TURN);
        ctx.stroke();
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
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

      case 'fire': {
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

      case 'teleport': {
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

    const pal = ConfigRegistry.getGame().palette;
    const glow = this.getSettings().glowBlurPx;

    // Modern sleek biome-themed floor with subtle gradient
    const floorGrad = ctx.createLinearGradient(x, y, x + size, y + size);
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
        const bGrad = ctx.createLinearGradient(x, y, x + size, y + size);
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

      case 'thin_wall_n':
      case 'thin_wall_e':
      case 'thin_wall_s':
      case 'thin_wall_w':
      case 'thin_wall_se': {
        const def = ConfigRegistry.getTile(tileId);
        const edges = def.blockedEdges || [];
        const bar = Math.max(5, Math.floor(size * 0.14));
        ctx.save();
        ctx.fillStyle = pal.modernThinWall;
        ctx.shadowColor = pal.modernThinWall;
        ctx.shadowBlur = glow.soft;
        if (edges.includes('N')) ctx.fillRect(x, y, size, bar);
        if (edges.includes('S')) ctx.fillRect(x, y + size - bar, size, bar);
        if (edges.includes('W')) ctx.fillRect(x, y, bar, size);
        if (edges.includes('E')) ctx.fillRect(x + size - bar, y, bar, size);
        ctx.restore();
        break;
      }

      case 'dirt': {
        const dGrad = ctx.createRadialGradient(
          x + size / 2,
          y + size / 2,
          size * 0.1,
          x + size / 2,
          y + size / 2,
          size * 0.7
        );
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
        const wGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        wGrad.addColorStop(0, pal.modernWaterTop);
        wGrad.addColorStop(1, pal.modernWaterBottom);
        ctx.fillStyle = wGrad;
        ctx.fillRect(x, y, size, size);
        break;
      }

      case 'fire': {
        const fGrad = ctx.createRadialGradient(
          x + size / 2,
          y + size * 0.65,
          2,
          x + size / 2,
          y + size / 2,
          size * 0.65
        );
        fGrad.addColorStop(0, pal.modernFireCore);
        fGrad.addColorStop(0.55, pal.modernFireMid);
        fGrad.addColorStop(1, pal.modernFireEdge);
        ctx.fillStyle = fGrad;
        ctx.fillRect(x, y, size, size);
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        const iGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        iGrad.addColorStop(0, pal.modernIceTop);
        iGrad.addColorStop(0.5, pal.modernIceMid);
        iGrad.addColorStop(1, pal.modernIceBottom);
        ctx.fillStyle = iGrad;
        ctx.fillRect(x, y, size, size);

        // Glossy diagonal specular streak
        ctx.strokeStyle = pal.modernIceStreak;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.18, y + size * 0.78);
        ctx.lineTo(x + size * 0.78, y + size * 0.18);
        ctx.stroke();

        this.fillIceCorner(ctx, tileId, x, y, size, pal.modernIceCornerWall);
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
      case 'button_red': {
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

  /** Soft shadow thrown by casters north and west of a cell, fading away from them. */
  private drawModernFloorShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mask: number): void {
    if (!(mask & (NEIGHBOUR.N | NEIGHBOUR.W | NEIGHBOUR.NW))) return;
    const parts: ShadowPart[] = [];
    if (mask & NEIGHBOUR.N) parts.push('north');
    if (mask & NEIGHBOUR.W) parts.push('west');
    else if (mask & NEIGHBOUR.NW && !(mask & NEIGHBOUR.N)) parts.push('corner');
    for (const part of parts) {
      const sprite = this.getSprite(`shadow|${part}|${size}`, size, size, 0, (sctx) =>
        this.paintFloorShadow(sctx, part, size)
      );
      if (sprite) ctx.drawImage(sprite, x, y);
      else this.paintFloorShadow(ctx, part, size, x, y);
    }
  }

  /** One part of a floor shadow, as a gradient fading away from the caster. */
  private paintFloorShadow(ctx: CanvasRenderingContext2D, part: ShadowPart, size: number, x = 0, y = 0): void {
    const pal = ConfigRegistry.getGame().palette;
    const depth = size * this.getSettings().floorShadowDepthTile;
    const side = depth * SIDE_SHADOW_RATIO;
    let grad: CanvasGradient;
    if (part === 'north') {
      grad = ctx.createLinearGradient(0, y, 0, y + depth);
    } else if (part === 'west') {
      grad = ctx.createLinearGradient(x, 0, x + side, 0);
    } else {
      grad = ctx.createRadialGradient(x, y, 0, x, y, depth);
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
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

      case 'fire': {
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
        // Now and then, a glint sweeps diagonally across the ice.
        const cycle = ((t * ICE_GLINT_SPEED + phase) % FULL_TURN) / FULL_TURN;
        if (cycle > ICE_GLINT_WINDOW) break;
        const sweep = cycle / ICE_GLINT_WINDOW;
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
        const sprite = this.getSprite(`force|${tileId}|${size}`, size, size, pad, (sctx, o) =>
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
        const disc = this.getSprite(`exitDisc|${size}`, maxR * 2, maxR * 2, 0, (sctx) => {
          const grad = sctx.createRadialGradient(maxR, maxR, 2, maxR, maxR, maxR);
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

      case 'teleport': {
        const glow = this.getSettings().glowBlurPx;
        const pad = this.glowPad();
        const ring = this.getSprite(`teleRing|${size}`, size, size, pad, (sctx, o) => {
          sctx.strokeStyle = pal.modernTeleportRing;
          sctx.shadowColor = pal.modernTeleportRing;
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
        const core = this.getSprite(`teleCore|${size}`, maxCore * 2, maxCore * 2, pad, (sctx, o) => {
          sctx.fillStyle = pal.teleportCore;
          sctx.shadowColor = pal.modernTeleportRing;
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
        break;
      }
    }
  }

  /** Neon force floor arrow (with its glow), centred in a tile at (x, y). */
  private paintForceArrow(ctx: CanvasRenderingContext2D, tileId: string, x: number, y: number, size: number): void {
    const pal = ConfigRegistry.getGame().palette;
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

  /** Dark wedge filling the walled half of a corner ice tile. */
  private fillIceCorner(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    color: string
  ): void {
    const right = x + size;
    const bottom = y + size;
    ctx.beginPath();
    if (tileId === 'ice_nw') {
      ctx.moveTo(x, y);
      ctx.lineTo(right, y);
      ctx.lineTo(x, bottom);
    } else if (tileId === 'ice_ne') {
      ctx.moveTo(x, y);
      ctx.lineTo(right, y);
      ctx.lineTo(right, bottom);
    } else if (tileId === 'ice_sw') {
      ctx.moveTo(x, y);
      ctx.lineTo(x, bottom);
      ctx.lineTo(right, bottom);
    } else if (tileId === 'ice_se') {
      ctx.moveTo(right, y);
      ctx.lineTo(right, bottom);
      ctx.lineTo(x, bottom);
    } else {
      return;
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private buttonColor(tileId: string): string {
    const pal = ConfigRegistry.getGame().palette;
    return pal[BUTTON_COLOR_KEYS[tileId] ?? DEFAULT_COLOR_KEY] || pal[DEFAULT_COLOR_KEY];
  }

  private drawButtonGlyph(ctx: CanvasRenderingContext2D, tileId: string, x: number, y: number, size: number): void {
    this.drawColorGlyph(
      ctx,
      BUTTON_GLYPH_KEYS[tileId] ?? DEFAULT_COLOR_KEY,
      x + size / 2,
      y + size / 2,
      size * 0.09,
      ConfigRegistry.getGame().palette.glyphInk
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
    const isModern = this.style === 'modern';
    const bob = isModern && !this.reducedMotion ? Math.sin(this.timeTick * ITEM_BOB_SPEED) * ITEM_BOB_AMPLITUDE_TILE : 0;
    const bobOffset = bob * size;
    if (isModern) {
      // Bobbing up (negative offset) lifts the item off its shadow, which shrinks.
      const spread = 1 + bob * ITEM_SHADOW.shrinkPerTile;
      ctx.fillStyle = ConfigRegistry.getGame().palette.modernItemShadow;
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
    const pal = ConfigRegistry.getGame().palette;
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
    const isBlock = BLOCK_TYPES.has(type);
    const frame = isBlock ? 0 : Math.floor(this.timeTick / MONSTER_FRAME_TICKS) % WALK_FRAMES;
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

  /** A pushable block, with a top face and a darker front face like the walls. */
  private paintBlock(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number): void {
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';
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

    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';
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
    const pal = ConfigRegistry.getGame().palette;
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
    const pal = ConfigRegistry.getGame().palette;
    if (this.style === 'modern' && alive && !inWater) {
      const spread = 1 - hop * PLAYER_SHADOW_SHRINK;
      ctx.fillStyle = pal.modernPlayerShadow;
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size * 0.9, size * 0.26 * spread, size * 0.08 * spread, 0, 0, FULL_TURN);
      ctx.fill();
    }
    const lift = hop * size;
    const pad = this.glowPad();
    const sprite = this.getSprite(
      `player|${this.style}|${dir}|${inWater}|${alive}|${frame}|${size}`,
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
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';

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
        ctx.fillStyle = pal.playerSuitShade;
        ctx.fillRect(lx, legTop, 0.11, len);
        ctx.fillStyle = pal.playerBoot;
        ctx.beginPath();
        ctx.roundRect(lx - 0.01, legTop + len - 0.06, side ? 0.16 : 0.13, 0.07, 0.025 * radius);
        ctx.fill();
      }

      // Arms swing against the legs.
      ctx.fillStyle = pal.playerSuitShade;
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
      ctx.fillStyle = pal.playerSuit;
      ctx.beginPath();
      if (side) ctx.roundRect(-0.15, -0.06, 0.3, 0.3, 0.08 * radius);
      else ctx.roundRect(-0.21, -0.06, 0.42, 0.3, 0.08 * radius);
      ctx.fill();
      ctx.fillStyle = pal.playerHair;
      if (dir === 'N') {
        ctx.beginPath();
        ctx.roundRect(-0.14, -0.03, 0.28, 0.22, 0.05 * radius);
        ctx.fill();
      } else if (side) {
        ctx.beginPath();
        ctx.roundRect(-0.21, -0.02, 0.08, 0.2, 0.03 * radius);
        ctx.fill();
      } else {
        ctx.fillStyle = pal.playerSuitShade;
        ctx.fillRect(-0.21, 0.15, 0.42, 0.04);
        this.fillGlowRect(ctx, -0.04, 0.01, 0.08, 0.06, 0, visor, isModern ? glow : 0);
      }
    }

    // Head with hair seen from behind, or a cap and the visor on the side the player faces.
    const headY = -0.22;
    const headR = 0.19;
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
    return resolveQualitySettings(ConfigRegistry.getGame().graphics, this.effectiveQuality);
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

  public renderIconToDataUrl(kind: 'tile' | 'item' | 'entity', id: string): string {
    const iconSize = this.getSettings().iconPixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = iconSize;
    canvas.height = iconSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (kind === 'tile') {
      this.drawTile(ctx, id, 0, 0, iconSize, true, true);
    } else if (kind === 'item') {
      this.drawTile(ctx, 'floor', 0, 0, iconSize, true, true);
      this.drawItem(ctx, id, 0, 0, iconSize);
    } else if (kind === 'entity') {
      this.drawTile(ctx, 'floor', 0, 0, iconSize, true, true);
      this.drawEntity(ctx, id, 'S', 0, 0, iconSize);
    }
    return canvas.toDataURL();
  }
}
