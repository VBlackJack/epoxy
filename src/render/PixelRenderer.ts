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
import { RenderSettings, resolveRenderSettings, resolveTheme } from './renderSettings';
import { frameScaleFromDelta, scaleDecay, scaleLerpFactor } from './renderTiming';
import {
  collectTerrainFeatures,
  EMPTY_TERRAIN_FEATURES,
  TerrainFeatures,
  TerrainSnapshot
} from './terrainState';

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

const MODERN_ANIMATED_TILES: ReadonlySet<string> = new Set([
  'water',
  'fire',
  'force_n',
  'force_e',
  'force_s',
  'force_w',
  'force_random',
  'exit',
  'teleport'
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
/** Force floor arrows scroll over this span (tile fraction) at this speed (tile fraction per frame). */
const FORCE_SCROLL_SPAN_TILE = 0.15;
const FORCE_SCROLL_SPEED_TILE = 0.015;
const EXIT_PULSE_BASE = 0.34;
const EXIT_PULSE_AMPLITUDE = 0.05;
const TELEPORT_CORE_BASE = 0.14;
const TELEPORT_CORE_AMPLITUDE = 0.03;

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
    if (gx < 0 || gx >= gridCfg.mapWidth || gy < 0 || gy >= gridCfg.mapHeight) return null;
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
    const settings = resolveRenderSettings(gameCfg.graphics);

    const fxKey = FX_COLOR_KEYS[kind];
    const primaryColor = fxKey ? pal[fxKey] : (colorKey && pal[colorKey]) || pal.yellow;

    if (kind === 'explosion') {
      this.shakeIntensity = settings.screenShakeExplosion;
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
    const gameCfg = ConfigRegistry.getGame();
    const settings = resolveRenderSettings(gameCfg.graphics);
    const frameScale = this.advanceClock(settings);
    const gridCfg = gameCfg.grid;
    const { mapWidth, mapHeight } = gridCfg;
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
    for (const cell of this.terrainFeatures.animatedCells) {
      if (cell.x < startTileX || cell.x > endTileX || cell.y < startTileY || cell.y > endTileY) continue;
      if (!animatedTiles.has(cell.tileId)) continue;
      const px = originX + Math.floor((cell.x - region.x0) * tilePixelSize);
      const py = originY + Math.floor((cell.y - region.y0) * tilePixelSize);
      this.drawTile(ctx, cell.tileId, px, py, drawSize, false, false, 'animated');
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
    this.drawPlayer(
      ctx,
      playerPx,
      playerPy,
      tilePixelSize,
      player.dir,
      player.inWater,
      player.alive
    );

    this.drawMechanismLinksAndObjective(ctx, engine, camX, camY, tilePixelSize);

    if (isModern) {
      this.updateAndDrawEffects(ctx, camX, camY, tilePixelSize, frameScale, settings);
    }

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
    const terrainChanged = this.terrainSnapshot.update(terrain);
    if (terrainChanged) {
      this.terrainFeatures = collectTerrainFeatures(terrain, ANY_ANIMATED_TILES);
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
        this.drawTile(cacheCtx, tileId, px, py, drawSize, false, isClosedTrap, 'static');
      }
    }
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

  public renderMinimap(ctx: CanvasRenderingContext2D, engine: GameEngine, cellPx: number = 3): void {
    const gridCfg = ConfigRegistry.getGame().grid;
    const { mapWidth, mapHeight } = gridCfg;
    const viewportWidth = this.lastViewportWidth || this.currentViewportTiles || gridCfg.viewportWidth;
    const viewportHeight = this.lastViewportHeight || this.currentViewportTiles || gridCfg.viewportHeight;
    const pal = ConfigRegistry.getGame().palette;
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const entities = engine.getEntities();
    const player = engine.getPlayer();

    ctx.clearRect(0, 0, mapWidth * cellPx, mapHeight * cellPx);

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
    pass: TilePass = 'all'
  ): void {
    if (this.style === 'modern' && !isEditor) {
      const theme = this.getActiveTheme();
      // Modern tiles are themed; without any theme configured the retro look is used.
      if (theme) {
        this.drawModernTile(ctx, tileId, x, y, size, isClosedTrap, theme, pass);
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
        break;

      case 'invisible_wall':
      case 'appearing_wall':
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

      case 'wall': {
        ctx.fillStyle = pal.wallShadow;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = pal.wallBase;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.fillStyle = pal.wallTop;
        ctx.fillRect(x + 3, y + 3, size - 8, size - 8);
        ctx.fillStyle = pal.wallShadow;
        ctx.fillRect(x + 2, y + Math.floor(size * 0.5), size - 4, 2);
        ctx.fillRect(x + Math.floor(size * 0.5), y + 2, 2, Math.floor(size * 0.5));
        ctx.fillRect(
          x + Math.floor(size * 0.25),
          y + Math.floor(size * 0.5),
          2,
          Math.floor(size * 0.45)
        );
        break;
      }

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

    if (pass === 'all' && RETRO_ANIMATED_TILES.has(tileId)) {
      this.drawRetroAnimatedOverlay(ctx, tileId, x, y, size);
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
    pass: TilePass
  ): void {
    if (pass === 'animated') {
      if (MODERN_ANIMATED_TILES.has(tileId)) this.drawModernAnimatedOverlay(ctx, tileId, x, y, size);
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
        break;

      case 'wall': {
        const wGrad = ctx.createLinearGradient(x, y, x, y + size);
        wGrad.addColorStop(0, theme.wallTop);
        wGrad.addColorStop(1, theme.wallBottom);
        ctx.fillStyle = pal.modernWallBase;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = wGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 5, 5);
        ctx.fill();

        // Inner bevel panel
        ctx.strokeStyle = theme.wallBevel;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 12, 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }

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

    if (pass === 'all' && MODERN_ANIMATED_TILES.has(tileId)) {
      this.drawModernAnimatedOverlay(ctx, tileId, x, y, size);
    }
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
    size: number
  ): void {
    const pal = ConfigRegistry.getGame().palette;
    const t = this.timeTick * MODERN_ANIM_SPEED;
    const cx = x + size / 2;
    const cy = y + size / 2;

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
        break;
      }

      case 'fire': {
        // Animated flame tongues
        const sway = Math.sin(t * 2.2) * (size * 0.08);
        ctx.fillStyle = pal.modernFireTongue;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.2, y + size * 0.85);
        ctx.quadraticCurveTo(x + size * 0.35 + sway, y + size * 0.15, x + size * 0.5, y + size * 0.6);
        ctx.quadraticCurveTo(x + size * 0.68 - sway, y + size * 0.12, x + size * 0.8, y + size * 0.85);
        ctx.closePath();
        ctx.fill();
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
    const bobOffset = isModern ? Math.sin(this.timeTick * ITEM_BOB_SPEED) * (size * ITEM_BOB_AMPLITUDE_TILE) : 0;
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
    const pad = this.glowPad();
    const sprite = this.getSprite(`entity|${this.style}|${type}|${dir}|${size}`, size, size, pad, (sctx, o) =>
      this.paintEntity(sctx, type, dir, o, o, size)
    );
    if (sprite) {
      ctx.drawImage(sprite, x - pad, y - pad);
    } else {
      this.paintEntity(ctx, type, dir, x, y, size);
    }
  }

  private paintEntity(
    ctx: CanvasRenderingContext2D,
    type: string,
    dir: Direction,
    x: number,
    y: number,
    size: number
  ): void {
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';

    if (type === 'dirt_block' || type === 'ice_block') {
      const isIce = type === 'ice_block';
      ctx.save();
      if (isModern) {
        ctx.fillStyle = pal.modernBlockShadow;
        this.roundRect(ctx, x + 4, y + 5, size - 6, size - 6, 6);
        ctx.fill();
      }
      ctx.fillStyle = isIce ? pal.iceBlockBorder : pal.blockBorder;
      this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, isModern ? 6 : 0);
      ctx.fill();
      ctx.fillStyle = isIce ? pal.iceBlockBase : pal.blockBase;
      this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, isModern ? 4 : 0);
      ctx.fill();
      ctx.restore();
      return;
    }

    const bodyColor = pal[MONSTER_COLOR_KEYS[type] ?? DEFAULT_MONSTER_COLOR_KEY] || pal[DEFAULT_MONSTER_COLOR_KEY];
    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.save();
    if (isModern) {
      ctx.fillStyle = pal.modernEntityShadow;
      ctx.beginPath();
      ctx.ellipse(cx, y + size * 0.82, size * 0.28, size * 0.1, 0, 0, FULL_TURN);
      ctx.fill();

      if (type === 'fireball' || type === 'pink_ball' || type === 'glider') {
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = this.getSettings().glowBlurPx.strong;
      }
    }

    if (type === 'tank') {
      ctx.fillStyle = pal.tankHull;
      this.roundRect(ctx, x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7, isModern ? 5 : 0);
      ctx.fill();
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, x + size * 0.24, y + size * 0.24, size * 0.52, size * 0.52, isModern ? 4 : 0);
      ctx.fill();
    } else {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.33, 0, FULL_TURN);
      ctx.fill();
    }

    ctx.fillStyle = pal.eyeWhite;
    let ex = cx;
    let ey = cy;
    const offset = size * 0.15;
    if (dir === 'N') ey -= offset;
    if (dir === 'S') ey += offset;
    if (dir === 'E') ex += offset;
    if (dir === 'W') ex -= offset;

    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.1, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = pal.eyePupil;
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.05, 0, FULL_TURN);
    ctx.fill();
    ctx.restore();
  }

  public drawPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dir: Direction,
    inWater: boolean,
    alive: boolean
  ): void {
    const pad = this.glowPad();
    const sprite = this.getSprite(
      `player|${this.style}|${dir}|${inWater}|${alive}|${size}`,
      size,
      size,
      pad,
      (sctx, o) => this.paintPlayer(sctx, o, o, size, dir, inWater, alive)
    );
    if (sprite) {
      ctx.drawImage(sprite, x - pad, y - pad);
    } else {
      this.paintPlayer(ctx, x, y, size, dir, inWater, alive);
    }
  }

  private paintPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    dir: Direction,
    inWater: boolean,
    alive: boolean
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

    ctx.save();
    if (isModern) {
      // Drop shadow under player
      ctx.fillStyle = pal.modernPlayerShadow;
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size * 0.86, size * 0.28, size * 0.1, 0, 0, FULL_TURN);
      ctx.fill();
    }

    if (!inWater) {
      ctx.fillStyle = pal.playerSuit;
      this.roundRect(ctx, x + size * 0.27, y + size * 0.44, size * 0.46, size * 0.38, isModern ? 6 : 0);
      ctx.fill();

      ctx.fillStyle = pal.playerHair;
      ctx.fillRect(x + size * 0.28, y + size * 0.78, size * 0.18, size * 0.12);
      ctx.fillRect(x + size * 0.54, y + size * 0.78, size * 0.18, size * 0.12);
    }

    ctx.fillStyle = pal.playerSkin;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.34, size * 0.21, 0, FULL_TURN);
    ctx.fill();

    ctx.fillStyle = pal.playerHair;
    this.roundRect(ctx, x + size * 0.28, y + size * 0.13, size * 0.44, size * 0.12, isModern ? 4 : 0);
    ctx.fill();

    ctx.fillStyle = pal.playerVisor;
    if (isModern) {
      ctx.shadowColor = pal.modernPlayerVisor;
      ctx.shadowBlur = this.getSettings().glowBlurPx.soft;
      ctx.fillStyle = pal.modernPlayerVisor;
    }
    let vx = x + size * 0.36;
    let vy = y + size * 0.3;
    if (dir === 'E') vx = x + size * 0.46;
    if (dir === 'W') vx = x + size * 0.26;
    if (dir === 'N') vy = y + size * 0.22;
    if (dir === 'S') vy = y + size * 0.34;
    this.roundRect(ctx, vx, vy, size * 0.28, size * 0.1, isModern ? 3 : 0);
    ctx.fill();
    ctx.restore();
  }

  private getSettings(): RenderSettings {
    return resolveRenderSettings(ConfigRegistry.getGame().graphics);
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
