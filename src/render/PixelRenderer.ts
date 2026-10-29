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
import { Direction, GraphicsStyle, GridPoint } from '../core/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
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

export class PixelRenderer {
  private animFrame: number = 0;
  private timeTick: number = 0;
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
  private lastLevelId: string = '';

  private particles: Particle[] = [];
  private shockwaves: ShockwaveRing[] = [];

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
    const pal = ConfigRegistry.getGame().palette;
    const gfx = ConfigRegistry.getGame().graphics;
    const maxParticles = gfx?.maxParticles || 200;
    const burstCount = gfx?.particleBurstCount || 18;

    const colorMap: Record<string, string> = {
      red: pal.red,
      blue: pal.blue,
      yellow: pal.yellow,
      green: pal.green
    };

    let primaryColor = colorKey ? colorMap[colorKey] || pal.yellow : pal.yellow;
    if (kind === 'chip') primaryColor = '#00e676';
    else if (kind === 'splash') primaryColor = '#4fc3f7';
    else if (kind === 'explosion') primaryColor = '#ff6d00';
    else if (kind === 'teleport') primaryColor = '#ea80fc';
    else if (kind === 'win') primaryColor = '#69f0ae';

    if (kind === 'explosion') {
      this.shakeIntensity = gfx?.screenShakeExplosion ?? 9;
    }

    if (kind === 'teleport' || kind === 'unlock' || kind === 'win' || kind === 'explosion') {
      this.shockwaves.push({
        x: gridX + 0.5,
        y: gridY + 0.5,
        radius: 0.1,
        maxRadius: kind === 'win' ? 1.8 : 1.1,
        color: primaryColor,
        alpha: 1
      });
    }

    for (let i = 0; i < burstCount; i++) {
      if (this.particles.length >= maxParticles) {
        this.particles.shift();
      }
      const angle = (Math.PI * 2 * i) / burstCount + (Math.random() - 0.5) * 0.4;
      const speed = 0.03 + Math.random() * 0.09;
      this.particles.push({
        x: gridX + 0.5,
        y: gridY + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3,
        color: i % 3 === 0 ? '#ffffff' : primaryColor,
        alpha: 1,
        decay: 0.025 + Math.random() * 0.02
      });
    }
  }

  public renderViewport(ctx: CanvasRenderingContext2D, engine: GameEngine): void {
    this.timeTick++;
    const gameCfg = ConfigRegistry.getGame();
    const gridCfg = gameCfg.grid;
    const gfxCfg = gameCfg.graphics;
    const { mapWidth, mapHeight } = gridCfg;
    const targetTiles = this.currentViewportTiles || gridCfg.viewportWidth;
    const isModern = this.style === 'modern';
    const camLerp = isModern ? (gfxCfg?.cameraLerpFactor ?? 0.22) : 1;

    if (!this.visualViewportTiles || !isModern || Math.abs(targetTiles - this.visualViewportTiles) < 0.04) {
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

    const entityLerp = isModern ? (gfxCfg?.entityLerpFactor ?? 0.32) : 1;
    const snapDist = gfxCfg?.teleportSnapDistance ?? 1.8;

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
    if (this.shakeIntensity > 0.25) {
      const sx = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      const sy = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      ctx.translate(sx, sy);
      this.shakeIntensity *= gfxCfg?.screenShakeDecay ?? 0.85;
    } else {
      this.shakeIntensity = 0;
    }

    const startTileX = Math.max(0, Math.floor(camX));
    const endTileX = Math.min(mapWidth - 1, Math.ceil(camX + viewportWidth));
    const startTileY = Math.max(0, Math.floor(camY));
    const endTileY = Math.min(mapHeight - 1, Math.ceil(camY + viewportHeight));

    for (let my = startTileY; my <= endTileY; my++) {
      for (let mx = startTileX; mx <= endTileX; mx++) {
        const px = Math.floor((mx - camX) * tilePixelSize);
        const py = Math.floor((my - camY) * tilePixelSize);
        const drawSize = Math.ceil(tilePixelSize);

        const tileId = terrain[my]?.[mx] || 'floor';
        const isClosedTrap = tileId === 'trap' ? engine.isCellClosedTrap(mx, my) : false;
        this.drawTile(ctx, tileId, px, py, drawSize, false, isClosedTrap);

        const itemId = items[my]?.[mx];
        if (itemId) {
          this.drawItem(ctx, itemId, px, py, drawSize);
        }
      }
    }

    // Update & render entities with smooth interpolation
    const activeUids = new Set<number>();
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
      const theme = gameCfg.themes?.[this.themeId];
      const pathColor = theme?.accentGlow || '#00e5ff';
      ctx.strokeStyle = pathColor;
      ctx.fillStyle = pathColor;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.65;
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
      ctx.arc(tx, ty, tilePixelSize * 0.22, 0, Math.PI * 2);
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
      this.updateAndDrawEffects(ctx, camX, camY, tilePixelSize);
    }

    ctx.restore();
  }

  private drawMechanismLinksAndObjective(
    ctx: CanvasRenderingContext2D,
    engine: GameEngine,
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    const terrain = engine.getTerrain();
    const hov = this.hoveredGridPoint;
    const hovTile = hov ? terrain[hov.y]?.[hov.x] : null;
    const showAll = this.showMechanismLinks;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(this.timeTick * 0.6);
    ctx.lineWidth = Math.max(2, tilePixelSize * 0.07);

    // 1. Brown Button <-> Bear Trap wires
    for (const link of engine.getTrapLinks()) {
      const isHovered =
        hov &&
        ((hov.x === link.buttonX && hov.y === link.buttonY) ||
          (hov.x === link.trapX && hov.y === link.trapY));
      if (!showAll && !isHovered) continue;

      ctx.strokeStyle = '#ffb300';
      ctx.globalAlpha = isHovered ? 0.95 : 0.72;
      ctx.beginPath();
      ctx.moveTo((link.buttonX + 0.5 - camX) * tilePixelSize, (link.buttonY + 0.5 - camY) * tilePixelSize);
      ctx.lineTo((link.trapX + 0.5 - camX) * tilePixelSize, (link.trapY + 0.5 - camY) * tilePixelSize);
      ctx.stroke();
    }

    // 2. Red Button <-> Clone Machine wires
    for (const link of engine.getCloneLinks()) {
      const isHovered =
        hov &&
        ((hov.x === link.buttonX && hov.y === link.buttonY) ||
          (hov.x === link.clonerX && hov.y === link.clonerY));
      if (!showAll && !isHovered) continue;

      ctx.strokeStyle = '#ff1744';
      ctx.globalAlpha = isHovered ? 0.95 : 0.75;
      ctx.beginPath();
      ctx.moveTo((link.buttonX + 0.5 - camX) * tilePixelSize, (link.buttonY + 0.5 - camY) * tilePixelSize);
      ctx.lineTo((link.clonerX + 0.5 - camX) * tilePixelSize, (link.clonerY + 0.5 - camY) * tilePixelSize);
      ctx.stroke();
    }

    // 3. Green Button <-> Toggle Walls & Teleporter pairs
    if (showAll || hovTile === 'button_green' || hovTile === 'teleport') {
      const greenButtons: GridPoint[] = [];
      const toggleWalls: GridPoint[] = [];
      const teleporters: GridPoint[] = [];

      for (let y = 0; y < terrain.length; y++) {
        for (let x = 0; x < terrain[y].length; x++) {
          const t = terrain[y][x];
          if (t === 'button_green') greenButtons.push({ x, y });
          else if (t === 'toggle_wall_closed' || t === 'toggle_wall_open') toggleWalls.push({ x, y });
          else if (t === 'teleport') teleporters.push({ x, y });
        }
      }

      if (showAll || hovTile === 'button_green') {
        ctx.strokeStyle = '#00e676';
        ctx.globalAlpha = 0.65;
        for (const gb of greenButtons) {
          for (const tw of toggleWalls) {
            ctx.beginPath();
            ctx.moveTo((gb.x + 0.5 - camX) * tilePixelSize, (gb.y + 0.5 - camY) * tilePixelSize);
            ctx.lineTo((tw.x + 0.5 - camX) * tilePixelSize, (tw.y + 0.5 - camY) * tilePixelSize);
            ctx.stroke();
          }
        }
      }

      if ((showAll || hovTile === 'teleport') && teleporters.length >= 2) {
        ctx.strokeStyle = '#ea80fc';
        ctx.globalAlpha = 0.72;
        for (let i = 0; i < teleporters.length; i++) {
          const a = teleporters[i];
          const b = teleporters[(i + 1) % teleporters.length];
          ctx.beginPath();
          ctx.moveTo((a.x + 0.5 - camX) * tilePixelSize, (a.y + 0.5 - camY) * tilePixelSize);
          ctx.lineTo((b.x + 0.5 - camX) * tilePixelSize, (b.y + 0.5 - camY) * tilePixelSize);
          ctx.stroke();
        }
      }
    }

    // 4. Objective Beacon Reticle
    if (this.objectivePoint) {
      ctx.setLineDash([]);
      const pulse = 0.36 + 0.12 * Math.sin(this.timeTick * 0.16);
      const ox = (this.objectivePoint.x + 0.5 - camX) * tilePixelSize;
      const oy = (this.objectivePoint.y + 0.5 - camY) * tilePixelSize;

      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(ox, oy, tilePixelSize * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox, oy, tilePixelSize * (pulse + 0.14), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private updateAndDrawEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tilePixelSize: number
  ): void {
    ctx.save();
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += 0.06;
      sw.alpha -= 0.045;
      if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const sx = (sw.x - camX) * tilePixelSize;
      const sy = (sw.y - camY) * tilePixelSize;
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, sw.radius * tilePixelSize, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const px = (p.x - camX) * tilePixelSize;
      const py = (p.y - camY) * tilePixelSize;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(px, py, p.radius, 0, Math.PI * 2);
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
        let color = '#1e222b';
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

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(player.x * cellPx, player.y * cellPx, cellPx, cellPx);

    if (this.objectivePoint && this.timeTick % 20 < 14) {
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        this.objectivePoint.x * cellPx - 1,
        this.objectivePoint.y * cellPx - 1,
        cellPx + 2,
        cellPx + 2
      );
    }

    const halfW = Math.floor(viewportWidth / 2);
    const halfH = Math.floor(viewportHeight / 2);
    const camX = Math.max(0, Math.min(mapWidth - viewportWidth, player.x - halfW));
    const camY = Math.max(0, Math.min(mapHeight - viewportHeight, player.y - halfH));
    ctx.strokeStyle = 'rgba(255, 214, 0, 0.75)';
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
    isClosedTrap: boolean = true
  ): void {
    if (this.style === 'modern' && !isEditor) {
      this.drawModernTile(ctx, tileId, x, y, size, isClosedTrap);
      return;
    }

    const pal = ConfigRegistry.getGame().palette;
    const phase = Math.floor(this.animFrame / 8) % 4;

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
        ctx.fillStyle = pal.fireBase;
        ctx.fillRect(x, y, size, size);
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

        ctx.fillStyle = pal.iceCornerWall;
        if (tileId === 'ice_nw') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_ne') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x + size, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_sw') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + size);
          ctx.lineTo(x + size, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_se') {
          ctx.beginPath();
          ctx.moveTo(x + size, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.fill();
        }
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
          ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
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

      case 'hint': {
        ctx.fillStyle = pal.hintSign;
        ctx.fillRect(x + size * 0.2, y + size * 0.15, size * 0.6, size * 0.7);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.floor(size * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + size / 2, y + size / 2 + 1);
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
        const cKey = def.colorKey || 'red';
        const color = pal[cKey] || pal.red;
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
        const colorMap: Record<string, string> = {
          button_green: pal.green,
          button_blue: pal.blue,
          button_brown: pal.brown,
          button_red: pal.red
        };
        const glyphMap: Record<string, string> = {
          button_green: 'green',
          button_blue: 'blue',
          button_brown: 'yellow',
          button_red: 'red'
        };
        ctx.fillStyle = pal.wallShadow;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorMap[tileId] || pal.red;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.22, 0, Math.PI * 2);
        ctx.fill();
        this.drawColorGlyph(
          ctx,
          glyphMap[tileId] || 'red',
          x + size / 2,
          y + size / 2,
          size * 0.09,
          '#11151c'
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

      case 'teleport': {
        ctx.strokeStyle = pal.teleportRing;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = pal.teleportCore;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * (0.14 + (phase % 2) * 0.04), 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'trap': {
        ctx.fillStyle = pal.trapBorder;
        ctx.fillRect(x + 4, y + 4, size - 8, size - 8);
        ctx.fillStyle = isClosedTrap ? pal.trapInner : pal.floorBase;
        ctx.fillRect(x + 8, y + 8, size - 16, size - 16);
        if (isClosedTrap) {
          ctx.fillStyle = '#cfd8dc';
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
  }

  private drawModernTile(
    ctx: CanvasRenderingContext2D,
    tileId: string,
    x: number,
    y: number,
    size: number,
    isClosedTrap: boolean
  ): void {
    const gameCfg = ConfigRegistry.getGame();
    const pal = gameCfg.palette;
    const theme = gameCfg.themes?.[this.themeId];
    const t = this.timeTick * 0.08;

    // Modern sleek biome-themed floor with subtle gradient
    const floorGrad = ctx.createLinearGradient(x, y, x + size, y + size);
    floorGrad.addColorStop(0, theme?.floorTop || pal.modernFloorTop || '#232a38');
    floorGrad.addColorStop(1, theme?.floorBottom || pal.modernFloorBottom || '#1b212d');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = theme?.floorGrid || pal.modernFloorGrid || '#2e3748';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    // Subtle corner tech rivets on floor
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x + 3, y + 3, 2, 2);
    ctx.fillRect(x + size - 5, y + size - 5, 2, 2);

    switch (tileId) {
      case 'floor':
      case 'invisible_wall':
      case 'appearing_wall':
        break;

      case 'wall': {
        const wGrad = ctx.createLinearGradient(x, y, x, y + size);
        wGrad.addColorStop(0, theme?.wallTop || pal.modernWallTop || '#4b5975');
        wGrad.addColorStop(1, theme?.wallBottom || pal.modernWallSide || '#2b3446');
        ctx.fillStyle = '#141821';
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = wGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 5, 5);
        ctx.fill();

        // Inner bevel panel
        ctx.strokeStyle = theme?.wallBevel || 'rgba(100, 181, 246, 0.35)';
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 12, 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }

      case 'recessed_wall': {
        ctx.fillStyle = 'rgba(75, 89, 117, 0.45)';
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.fill();
        ctx.strokeStyle = '#64b5f6';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }

      case 'blue_wall_real':
      case 'blue_wall_fake': {
        const bGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        bGrad.addColorStop(0, '#2979ff');
        bGrad.addColorStop(1, '#0d47a1');
        ctx.fillStyle = bGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 5);
        ctx.fill();
        ctx.strokeStyle = '#82b1ff';
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
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;
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
        dGrad.addColorStop(0, '#8d6e63');
        dGrad.addColorStop(1, '#4e342e');
        ctx.fillStyle = dGrad;
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 4);
        ctx.fill();
        break;
      }

      case 'gravel': {
        ctx.fillStyle = '#455a64';
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 4);
        ctx.fill();
        ctx.fillStyle = '#90a4ae';
        for (let i = 0; i < 5; i++) {
          const gx = x + ((i * 17 + 7) % (size - 12)) + 5;
          const gy = y + ((i * 23 + 9) % (size - 12)) + 5;
          ctx.beginPath();
          ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'water': {
        const wGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        wGrad.addColorStop(0, pal.modernWaterTop || '#0077c2');
        wGrad.addColorStop(1, pal.modernWaterBottom || '#004ba0');
        ctx.fillStyle = wGrad;
        ctx.fillRect(x, y, size, size);

        // Animated glowing caustic waves
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
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
        const fGrad = ctx.createRadialGradient(
          x + size / 2,
          y + size * 0.65,
          2,
          x + size / 2,
          y + size / 2,
          size * 0.65
        );
        fGrad.addColorStop(0, '#ffee58');
        fGrad.addColorStop(0.55, '#ff6d00');
        fGrad.addColorStop(1, '#b71c1c');
        ctx.fillStyle = fGrad;
        ctx.fillRect(x, y, size, size);

        // Animated flame tongues
        const sway = Math.sin(t * 2.2) * (size * 0.08);
        ctx.fillStyle = 'rgba(255, 238, 88, 0.85)';
        ctx.beginPath();
        ctx.moveTo(x + size * 0.2, y + size * 0.85);
        ctx.quadraticCurveTo(x + size * 0.35 + sway, y + size * 0.15, x + size * 0.5, y + size * 0.6);
        ctx.quadraticCurveTo(x + size * 0.68 - sway, y + size * 0.12, x + size * 0.8, y + size * 0.85);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'ice':
      case 'ice_nw':
      case 'ice_ne':
      case 'ice_sw':
      case 'ice_se': {
        const iGrad = ctx.createLinearGradient(x, y, x + size, y + size);
        iGrad.addColorStop(0, pal.modernIceTop || '#80d8ff');
        iGrad.addColorStop(0.5, '#e1f5fe');
        iGrad.addColorStop(1, pal.modernIceBottom || '#40c4ff');
        ctx.fillStyle = iGrad;
        ctx.fillRect(x, y, size, size);

        // Glossy diagonal specular streak
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.18, y + size * 0.78);
        ctx.lineTo(x + size * 0.78, y + size * 0.18);
        ctx.stroke();

        ctx.fillStyle = '#263238';
        if (tileId === 'ice_nw') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_ne') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x + size, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_sw') {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + size);
          ctx.lineTo(x + size, y + size);
          ctx.closePath();
          ctx.fill();
        } else if (tileId === 'ice_se') {
          ctx.beginPath();
          ctx.moveTo(x + size, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + size);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'force_n':
      case 'force_e':
      case 'force_s':
      case 'force_w':
      case 'force_random': {
        ctx.fillStyle = pal.modernForceBg || '#102830';
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.save();
        ctx.strokeStyle = pal.modernForceNeon || '#00ffc8';
        ctx.fillStyle = pal.modernForceNeon || '#00ffc8';
        ctx.shadowColor = pal.modernForceNeon || '#00ffc8';
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2.5;

        const cx = x + size / 2;
        const cy = y + size / 2;
        const r = size * 0.24;
        const shift = ((this.timeTick * 0.8) % 8) - 4;

        if (tileId === 'force_random') {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          if (tileId === 'force_n') {
            ctx.moveTo(cx - r, cy + r * 0.5 - shift);
            ctx.lineTo(cx, cy - r * 0.6 - shift);
            ctx.lineTo(cx + r, cy + r * 0.5 - shift);
          } else if (tileId === 'force_s') {
            ctx.moveTo(cx - r, cy - r * 0.5 + shift);
            ctx.lineTo(cx, cy + r * 0.6 + shift);
            ctx.lineTo(cx + r, cy - r * 0.5 + shift);
          } else if (tileId === 'force_e') {
            ctx.moveTo(cx - r * 0.5 + shift, cy - r);
            ctx.lineTo(cx + r * 0.6 + shift, cy);
            ctx.lineTo(cx - r * 0.5 + shift, cy + r);
          } else if (tileId === 'force_w') {
            ctx.moveTo(cx + r * 0.5 - shift, cy - r);
            ctx.lineTo(cx - r * 0.6 - shift, cy);
            ctx.lineTo(cx + r * 0.5 - shift, cy + r);
          }
          ctx.stroke();
        }
        ctx.restore();
        break;
      }

      case 'socket': {
        ctx.fillStyle = '#263238';
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 6);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = '#ffd600';
        ctx.shadowColor = '#ffd600';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2.5;
        this.roundRect(ctx, x + size * 0.24, y + size * 0.24, size * 0.52, size * 0.52, 4);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'exit': {
        ctx.save();
        const cx = x + size / 2;
        const cy = y + size / 2;
        const pulseR = size * (0.34 + Math.sin(t * 2) * 0.05);
        const eGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, pulseR);
        eGrad.addColorStop(0, '#ffffff');
        eGrad.addColorStop(0.45, '#00e676');
        eGrad.addColorStop(1, 'rgba(0, 230, 118, 0)');
        ctx.fillStyle = eGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#69f0ae';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.3, t, t + Math.PI * 1.4);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'hint': {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 176, 255, 0.2)';
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 6);
        ctx.fill();
        ctx.strokeStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.floor(size * 0.52)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + size / 2, y + size / 2 + 1);
        ctx.restore();
        break;
      }

      case 'thief': {
        ctx.fillStyle = '#311b92';
        this.roundRect(ctx, x + size * 0.18, y + size * 0.16, size * 0.64, size * 0.68, 8);
        ctx.fill();
        ctx.fillStyle = '#ffd600';
        ctx.fillRect(x + size * 0.26, y + size * 0.34, size * 0.48, size * 0.14);
        break;
      }

      case 'door_red':
      case 'door_blue':
      case 'door_yellow':
      case 'door_green': {
        const def = ConfigRegistry.getTile(tileId);
        const cKey = def.colorKey || 'red';
        const color = pal[cKey] || pal.red;
        ctx.fillStyle = '#12161f';
        this.roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 6);
        ctx.fill();

        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.fill();
        ctx.restore();

        this.drawColorGlyph(ctx, cKey, x + size / 2, y + size * 0.44, size * 0.15, '#12161f');
        ctx.fillStyle = '#12161f';
        ctx.fillRect(x + size * 0.46, y + size * 0.56, size * 0.08, size * 0.16);
        break;
      }

      case 'button_green':
      case 'button_blue':
      case 'button_brown':
      case 'button_red': {
        const colorMap: Record<string, string> = {
          button_green: pal.green,
          button_blue: pal.blue,
          button_brown: pal.brown,
          button_red: pal.red
        };
        const glyphMap: Record<string, string> = {
          button_green: 'green',
          button_blue: 'blue',
          button_brown: 'yellow',
          button_red: 'red'
        };
        const c = colorMap[tileId] || pal.red;
        ctx.fillStyle = '#11151c';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.21, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        this.drawColorGlyph(
          ctx,
          glyphMap[tileId] || 'red',
          x + size / 2,
          y + size / 2,
          size * 0.09,
          '#11151c'
        );
        break;
      }

      case 'toggle_wall_closed': {
        ctx.fillStyle = '#1e2430';
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 5);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = '#00e676';
        ctx.shadowColor = '#00e676';
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2.5;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'toggle_wall_open': {
        ctx.strokeStyle = 'rgba(0, 230, 118, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }

      case 'teleport': {
        ctx.save();
        const cx = x + size / 2;
        const cy = y + size / 2;
        ctx.strokeStyle = '#d500f9';
        ctx.shadowColor = '#d500f9';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.34, t, t + Math.PI * 1.5);
        ctx.stroke();

        ctx.fillStyle = '#ea80fc';
        ctx.beginPath();
        ctx.arc(cx, cy, size * (0.14 + Math.sin(t * 3) * 0.03), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'trap': {
        ctx.strokeStyle = '#ff6d00';
        ctx.lineWidth = 2;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        if (isClosedTrap) {
          ctx.fillStyle = 'rgba(191, 54, 12, 0.55)';
          this.roundRect(ctx, x + 7, y + 7, size - 14, size - 14, 3);
          ctx.fill();
        }
        break;
      }

      case 'clone_machine': {
        ctx.fillStyle = '#311b92';
        this.roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 5);
        ctx.fill();
        ctx.strokeStyle = '#ff1744';
        ctx.lineWidth = 2;
        this.roundRect(ctx, x + 5, y + 5, size - 10, size - 10, 4);
        ctx.stroke();
        break;
      }
    }
  }

  public drawItem(
    ctx: CanvasRenderingContext2D,
    itemId: string,
    x: number,
    y: number,
    size: number
  ): void {
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';
    const bobOffset = isModern ? Math.sin(this.timeTick * 0.1) * (size * 0.04) : 0;
    const dy = y + bobOffset;

    switch (itemId) {
      case 'chip': {
        ctx.save();
        if (isModern) {
          ctx.shadowColor = '#00e676';
          ctx.shadowBlur = 8;
        }
        ctx.fillStyle = pal.chipPins;
        for (let i = 0; i < 3; i++) {
          const py = dy + Math.floor(size * (0.28 + i * 0.18));
          ctx.fillRect(x + Math.floor(size * 0.16), py, Math.floor(size * 0.68), 2.5);
        }
        ctx.fillStyle = '#1a2228';
        this.roundRect(
          ctx,
          x + size * 0.25,
          dy + size * 0.2,
          size * 0.5,
          size * 0.6,
          isModern ? 4 : 0
        );
        ctx.fill();

        ctx.fillStyle = pal.chipCore;
        this.roundRect(
          ctx,
          x + size * 0.38,
          dy + size * 0.36,
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
        const cKey = def.colorKey || 'red';
        const color = pal[cKey] || pal.red;
        ctx.save();
        if (isModern) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + size * 0.34, dy + size * 0.5, size * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x + size * 0.45, dy + size * 0.45, size * 0.36, size * 0.1);
        ctx.fillRect(x + size * 0.64, dy + size * 0.55, size * 0.07, size * 0.14);
        ctx.fillRect(x + size * 0.74, dy + size * 0.55, size * 0.07, size * 0.14);
        this.drawColorGlyph(ctx, cKey, x + size * 0.34, dy + size * 0.5, size * 0.075, '#11151c');
        ctx.restore();
        break;
      }

      case 'boots_water':
      case 'boots_fire':
      case 'boots_ice':
      case 'boots_force': {
        const bootColorMap: Record<string, string> = {
          boots_water: pal.waterWave,
          boots_fire: pal.fireMid,
          boots_ice: pal.iceShine,
          boots_force: pal.yellow
        };
        const c = bootColorMap[itemId] || pal.blue;
        ctx.save();
        if (isModern) {
          ctx.shadowColor = c;
          ctx.shadowBlur = 6;
        }
        ctx.fillStyle = c;
        this.roundRect(ctx, x + size * 0.25, dy + size * 0.22, size * 0.26, size * 0.5, 3);
        ctx.fill();
        this.roundRect(ctx, x + size * 0.25, dy + size * 0.54, size * 0.52, size * 0.24, 4);
        ctx.fill();
        ctx.restore();
        break;
      }

      case 'bomb': {
        ctx.save();
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.arc(x + size * 0.5, dy + size * 0.56, size * 0.27, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff3d00';
        if (isModern) {
          ctx.shadowColor = '#ff3d00';
          ctx.shadowBlur = 8;
        }
        ctx.beginPath();
        ctx.arc(x + size * 0.52, dy + size * 0.24, size * 0.08, 0, Math.PI * 2);
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
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';

    if (type === 'dirt_block' || type === 'ice_block') {
      const isIce = type === 'ice_block';
      ctx.save();
      if (isModern) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
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

    const monsterColors: Record<string, string> = {
      bug: pal.monsterBug,
      paramecium: pal.monsterParamecium,
      pink_ball: pal.monsterPinkBall,
      walker: pal.monsterWalker,
      teeth: pal.monsterTeeth,
      glider: pal.monsterGlider,
      fireball: pal.monsterFireball,
      tank: pal.monsterTank,
      blob: pal.monsterBlob
    };

    const bodyColor = monsterColors[type] || pal.monsterBug;
    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.save();
    if (isModern) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(cx, y + size * 0.82, size * 0.28, size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();

      if (type === 'fireball' || type === 'pink_ball' || type === 'glider') {
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = 10;
      }
    }

    if (type === 'tank') {
      ctx.fillStyle = '#263238';
      this.roundRect(ctx, x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7, isModern ? 5 : 0);
      ctx.fill();
      ctx.fillStyle = bodyColor;
      this.roundRect(ctx, x + size * 0.24, y + size * 0.24, size * 0.52, size * 0.52, isModern ? 4 : 0);
      ctx.fill();
    } else {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.33, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    let ex = cx;
    let ey = cy;
    const offset = size * 0.15;
    if (dir === 'N') ey -= offset;
    if (dir === 'S') ey += offset;
    if (dir === 'E') ex += offset;
    if (dir === 'W') ex -= offset;

    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.05, 0, Math.PI * 2);
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
    const pal = ConfigRegistry.getGame().palette;
    const isModern = this.style === 'modern';

    if (!alive) {
      ctx.fillStyle = pal.red;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.save();
    if (isModern) {
      // Drop shadow under player
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size * 0.86, size * 0.28, size * 0.1, 0, 0, Math.PI * 2);
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
    ctx.arc(x + size / 2, y + size * 0.34, size * 0.21, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal.playerHair;
    this.roundRect(ctx, x + size * 0.28, y + size * 0.13, size * 0.44, size * 0.12, isModern ? 4 : 0);
    ctx.fill();

    ctx.fillStyle = pal.playerVisor;
    if (isModern) {
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#00e5ff';
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
      ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
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
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (kind === 'tile') {
      this.drawTile(ctx, id, 0, 0, 32, true, true);
    } else if (kind === 'item') {
      this.drawTile(ctx, 'floor', 0, 0, 32, true, true);
      this.drawItem(ctx, id, 0, 0, 32);
    } else if (kind === 'entity') {
      this.drawTile(ctx, 'floor', 0, 0, 32, true, true);
      this.drawEntity(ctx, id, 'S', 0, 0, 32);
    }
    return canvas.toDataURL();
  }
}
