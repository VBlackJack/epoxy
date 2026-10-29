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

import { ConfigRegistry } from './config/ConfigRegistry';
import { BUILTIN_PACK_IDS } from './config/constants';
import { i18n, t } from './i18n/I18nManager';
import { GameEngine } from './core/GameEngine';
import { PixelRenderer } from './render/PixelRenderer';
import { LevelEditor } from './editor/LevelEditor';
import { AudioManager } from './audio/AudioManager';
import { DatCodec } from './formats/DatCodec';
import { Pathfinder } from './core/Pathfinder';
import { ProceduralGenerator } from './core/ProceduralGenerator';
import {
  CompiledLevel,
  Direction,
  GridPoint,
  LevelBlueprint,
  LevelHighScore,
  UserSettings
} from './core/types';

class EpoxyApplication {
  private engine: GameEngine = new GameEngine();
  private renderer: PixelRenderer = new PixelRenderer();
  private editor!: LevelEditor;

  private gameCanvas!: HTMLCanvasElement;
  private gameCtx!: CanvasRenderingContext2D;
  private radarCtx: CanvasRenderingContext2D | null = null;
  private currentLevelIndex: number = 0;
  private activeMode: 'play' | 'editor' = 'play';
  private heldDirection: Direction | null = null;
  private highScores: Record<string, LevelHighScore> = {};
  private prevGamepadButtons: boolean[] = [];
  private customStatusMessage: string | null = null;
  private customStatusTimeout: number | null = null;
  private autoMoveQueue: Direction[] = [];
  private autoMovePoints: GridPoint[] = [];
  private replayMoves: Direction[] = [];
  private replayIndex: number = 0;
  private isReplaying: boolean = false;
  private lastWarnedSecond: number = -1;
  private scoresFilterMode: 'all' | 'unsolved' | 'completed' = 'all';
  private scoresSearchQuery: string = '';

  private keyIconCache: Record<string, string> = {};
  private bootIconCache: Record<string, string> = {};

  private readonly keyIds = ['key_red', 'key_blue', 'key_yellow', 'key_green'];
  private readonly bootIds = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'];

  public async init(): Promise<void> {
    await ConfigRegistry.loadAll();

    const gameCfg = ConfigRegistry.getGame();
    const savedSettings = this.loadUserSettings();
    const initialLocale =
      savedSettings.locale && gameCfg.locales.supported.includes(savedSettings.locale)
        ? savedSettings.locale
        : gameCfg.locales.default;
    this.setupLocaleSelector(gameCfg.locales.supported, initialLocale);

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    const editorCanvas = document.getElementById('editor-canvas') as HTMLCanvasElement | null;
    const radarCanvas = document.getElementById('radar-canvas') as HTMLCanvasElement | null;
    if (!canvas || !editorCanvas) {
      throw new Error('Required canvas elements missing');
    }

    this.gameCanvas = canvas;
    const canvasSize =
      gameCfg.grid.viewportCanvasSize ||
      gameCfg.grid.viewportWidth * gameCfg.grid.tilePixelSize;
    this.gameCanvas.width = canvasSize;
    this.gameCanvas.height = canvasSize;

    const presets = gameCfg.grid.viewportPresets || [9, 13, 17, 32];
    const initialFov =
      savedSettings.fov && presets.includes(savedSettings.fov)
        ? savedSettings.fov
        : gameCfg.grid.viewportWidth;
    this.renderer.setViewportTiles(initialFov);

    const defaultStyle =
      savedSettings.graphicsStyle || gameCfg.graphics?.defaultStyle || 'modern';
    this.renderer.setStyle(defaultStyle);

    const initialTheme =
      savedSettings.themeId && gameCfg.themes?.[savedSettings.themeId]
        ? savedSettings.themeId
        : gameCfg.graphics?.defaultTheme || 'cyber_neon';
    this.renderer.setThemeId(initialTheme);
    this.gameCanvas.classList.toggle('retro-pixels', defaultStyle === 'retro');

    const gfxBtn = document.getElementById('btn-graphics-toggle');
    if (gfxBtn) {
      const isModern = defaultStyle === 'modern';
      const i18nKey = isModern
        ? 'app.header.graphics_modern.action'
        : 'app.header.graphics_retro.action';
      gfxBtn.setAttribute('data-i18n', i18nKey);
      gfxBtn.classList.toggle('active', isModern);
    }

    if (savedSettings.shellEnabled) {
      document.getElementById('lynx-console')?.classList.add('enabled');
      document.getElementById('btn-shell-toggle')?.classList.add('active');
    }

    if (typeof savedSettings.sfxEnabled === 'boolean') {
      AudioManager.setSfxEnabled(savedSettings.sfxEnabled);
      document
        .getElementById('btn-sfx-toggle')
        ?.classList.toggle('active', savedSettings.sfxEnabled);
    }
    if (typeof savedSettings.musicEnabled === 'boolean') {
      AudioManager.setMusicEnabled(savedSettings.musicEnabled);
      document
        .getElementById('btn-music-toggle')
        ?.classList.toggle('active', savedSettings.musicEnabled);
    }

    this.setupFovSelector(presets, initialFov);
    this.setupThemeSelector();
    this.bindViewportResizeObserver();

    const ctx = this.gameCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    this.gameCtx = ctx;
    this.radarCtx = radarCanvas?.getContext('2d') || null;

    this.rebuildHudIcons();

    this.loadHighScores();
    this.engine.setOnWinCallback((levelId, timeRemaining, steps, score, moves) => {
      if (!this.isReplaying) {
        this.recordHighScore(levelId, timeRemaining, steps, score, moves);
      }
      this.stopAutoMoveAndReplay();
    });
    this.engine.setOnVisualEventCallback((kind, x, y, colorKey) => {
      this.renderer.triggerVisualEvent(kind, x, y, colorKey);
    });

    this.editor = new LevelEditor(
      editorCanvas,
      this.renderer,
      (testLevel: CompiledLevel) => {
        this.switchMode('play');
        this.engine.loadLevel(testLevel);
        this.updateHUD();
      },
      (savedIdx: number) => {
        this.refreshPackSelector();
        this.currentLevelIndex = savedIdx;
      }
    );
    this.editor.buildUI();

    this.refreshPackSelector();
    this.restoreSavedProgress();
    this.startLevelByIndex(this.currentLevelIndex);

    this.bindUIEvents();
    this.bindTouchGestures();
    this.bindDragAndDrop();
    this.bindKeyboardEvents();
    i18n.translateDOM();

    i18n.onChange(() => {
      this.refreshPackSelector();
      this.setupThemeSelector();
      this.updateHUD();
      this.editor.refreshTranslations();
    });

    window.setInterval(() => {
      if (this.activeMode !== 'play') return;
      this.pollGamepad();
      if (this.isReplaying) {
        if (this.replayIndex < this.replayMoves.length) {
          const nextDir = this.replayMoves[this.replayIndex];
          const moved = this.engine.attemptPlayerMove(nextDir);
          if (moved) {
            this.replayIndex++;
          }
        } else {
          this.isReplaying = false;
        }
      } else if (this.heldDirection) {
        this.clearAutoMove();
        this.engine.attemptPlayerMove(this.heldDirection);
      } else if (this.autoMoveQueue.length > 0) {
        const nextDir = this.autoMoveQueue[0];
        const moved = this.engine.attemptPlayerMove(nextDir);
        if (moved) {
          this.autoMoveQueue.shift();
          this.autoMovePoints.shift();
          this.renderer.setPlannedPath(this.autoMovePoints);
        } else if (!this.engine.getPlayer().isSliding && this.engine.getPlayer().moveCooldown === 0) {
          this.clearAutoMove();
        }
      }
      this.engine.tick();
      this.renderer.incrementFrame();
      this.updateHUD();
    }, gameCfg.timing.tickIntervalMs);

    const renderLoop = (): void => {
      if (this.activeMode === 'play') {
        this.renderer.renderViewport(this.gameCtx, this.engine);
        if (this.radarCtx) {
          this.renderer.renderMinimap(this.radarCtx, this.engine, 3);
        }
      }
      requestAnimationFrame(renderLoop);
    };
    requestAnimationFrame(renderLoop);
  }

  private bindViewportResizeObserver(): void {
    const wrapper = this.gameCanvas.parentElement;
    if (!wrapper) return;

    const syncCanvasSize = (): void => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width < 64 || rect.height < 64) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (
        Math.abs(this.gameCanvas.width - targetW) > 2 ||
        Math.abs(this.gameCanvas.height - targetH) > 2
      ) {
        this.gameCanvas.width = targetW;
        this.gameCanvas.height = targetH;
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        syncCanvasSize();
      });
      ro.observe(wrapper);
    } else {
      window.addEventListener('resize', syncCanvasSize);
    }
    requestAnimationFrame(syncCanvasSize);
  }

  private refreshPackSelector(): void {
    const select = document.getElementById('pack-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';

    const packs = ConfigRegistry.getAllPacks();
    const activeId = ConfigRegistry.getActivePackId();

    for (const pack of packs) {
      const opt = document.createElement('option');
      opt.value = pack.id;
      let displayName = pack.i18nKey ? t(pack.i18nKey) : pack.name;
      if (pack.id === BUILTIN_PACK_IDS.CAMPAIGN) {
        displayName = t('app.packs.campaign.label');
      } else if (pack.id === BUILTIN_PACK_IDS.CUSTOM) {
        displayName = t('app.packs.custom.label');
      } else if (pack.id === BUILTIN_PACK_IDS.PROCEDURAL) {
        displayName = t('app.packs.procedural.label');
      }
      opt.textContent = `${displayName} (${pack.levels.length})`;
      if (pack.id === activeId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  }

  private async handleImportedFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    const cleanName = file.name.replace(/\.[^.]+$/, '');

    try {
      if (lower.endsWith('.dat') || lower.endsWith('.ccl')) {
        const buffer = await file.arrayBuffer();
        const decodedLevels = DatCodec.decodeBuffer(buffer, cleanName);
        if (decodedLevels.length === 0) {
          throw new Error('Empty pack');
        }
        await ConfigRegistry.registerImportedPack(cleanName.toUpperCase(), decodedLevels);
        this.refreshPackSelector();
        this.editor.populatePresetDropdown();
        this.switchMode('play');
        this.startLevelByIndex(0);
        this.showTransientStatus(
          t('app.packs.imported_toast.label', {
            name: cleanName.toUpperCase(),
            count: decodedLevels.length
          })
        );
      } else if (lower.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const rawList: Array<LevelBlueprint & Partial<CompiledLevel>> = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.levels)
            ? parsed.levels
            : [parsed];
        const compiledList = rawList.map((item) =>
          ConfigRegistry.compileBlueprint({
            ...item,
            itemGrid:
              item.items && Array.isArray(item.items[0])
                ? (item.items as unknown as (string | null)[][])
                : item.itemGrid
          })
        );
        await ConfigRegistry.registerImportedPack(cleanName.toUpperCase(), compiledList);
        this.refreshPackSelector();
        this.editor.populatePresetDropdown();
        this.switchMode('play');
        this.startLevelByIndex(0);
        this.showTransientStatus(
          t('app.packs.imported_toast.label', {
            name: cleanName.toUpperCase(),
            count: compiledList.length
          })
        );
      } else {
        this.showTransientStatus(t('app.packs.import_error.label'));
      }
    } catch {
      this.showTransientStatus(t('app.packs.import_error.label'));
    }
  }

  private showTransientStatus(message: string): void {
    this.customStatusMessage = message;
    if (this.customStatusTimeout !== null) {
      clearTimeout(this.customStatusTimeout);
    }
    this.customStatusTimeout = window.setTimeout(() => {
      this.customStatusMessage = null;
      this.updateHUD();
    }, 4500);
    this.updateHUD();
  }

  private triggerHaptic(): void {
    const pulseMs = ConfigRegistry.getGame().touch?.hapticPulseMs ?? 10;
    if (pulseMs > 0 && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pulseMs);
      } catch {
        // Ignore vibration permission restrictions
      }
    }
  }

  private bindTouchGestures(): void {
    const touchCfg = ConfigRegistry.getGame().touch;
    const swipeDeadzone = touchCfg?.swipeDeadzonePx ?? 20;
    const tapMaxDist = touchCfg?.tapMaxDistancePx ?? 14;
    const tapMaxDuration = touchCfg?.tapMaxDurationMs ?? 280;
    const pinchStepPx = touchCfg?.pinchZoomStepPx ?? 42;

    let anchorX = 0;
    let anchorY = 0;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let maxDisplacement = 0;
    let pinchAnchorDist = 0;

    const getFingerDist = (t1: Touch, t2: Touch): number =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    this.gameCanvas.addEventListener(
      'touchstart',
      (e) => {
        if (this.activeMode !== 'play') return;
        if (e.touches.length === 2) {
          e.preventDefault();
          this.heldDirection = null;
          pinchAnchorDist = getFingerDist(e.touches[0], e.touches[1]);
          maxDisplacement = 999;
          return;
        }
        if (e.touches.length === 1) {
          const t0 = e.touches[0];
          anchorX = t0.clientX;
          anchorY = t0.clientY;
          startX = t0.clientX;
          startY = t0.clientY;
          startTime = Date.now();
          maxDisplacement = 0;
        }
      },
      { passive: false }
    );

    this.gameCanvas.addEventListener(
      'touchmove',
      (e) => {
        if (this.activeMode !== 'play') return;
        e.preventDefault();

        if (e.touches.length === 2) {
          this.heldDirection = null;
          const dist = getFingerDist(e.touches[0], e.touches[1]);
          if (pinchAnchorDist > 0 && Math.abs(dist - pinchAnchorDist) >= pinchStepPx) {
            const presets = ConfigRegistry.getGame().grid.viewportPresets || [9, 13, 17, 32];
            const curr = this.renderer.getViewportTiles();
            const idx = presets.indexOf(curr);
            const nextIdx =
              dist > pinchAnchorDist
                ? Math.max(0, (idx >= 0 ? idx : 1) - 1)
                : Math.min(presets.length - 1, (idx >= 0 ? idx : 1) + 1);
            const nextTiles = presets[nextIdx];
            if (nextTiles !== curr) {
              this.renderer.setViewportTiles(nextTiles);
              const select = document.getElementById('fov-select') as HTMLSelectElement | null;
              if (select) select.value = String(nextTiles);
              this.saveUserSettings();
              this.triggerHaptic();
            }
            pinchAnchorDist = dist;
          }
          return;
        }

        if (e.touches.length === 1) {
          const t0 = e.touches[0];
          const totalDist = Math.hypot(t0.clientX - startX, t0.clientY - startY);
          if (totalDist > maxDisplacement) {
            maxDisplacement = totalDist;
          }

          const dx = t0.clientX - anchorX;
          const dy = t0.clientY - anchorY;
          const dist = Math.hypot(dx, dy);

          if (dist >= swipeDeadzone) {
            const dir: Direction =
              Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
            this.clearAutoMove();
            if (this.heldDirection !== dir) {
              this.heldDirection = dir;
              this.triggerHaptic();
              this.engine.attemptPlayerMove(dir);
            }
            // Follow finger so turning 90 or 180 degrees mid-drag responds immediately
            anchorX = t0.clientX - Math.sign(dx) * (swipeDeadzone * 0.55);
            anchorY = t0.clientY - Math.sign(dy) * (swipeDeadzone * 0.55);
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e: TouchEvent): void => {
      if (this.activeMode !== 'play') return;
      if (e.touches.length === 0) {
        this.heldDirection = null;
        pinchAnchorDist = 0;

        const duration = Date.now() - startTime;
        const changed = e.changedTouches[0];
        if (changed && maxDisplacement <= tapMaxDist && duration <= tapMaxDuration) {
          e.preventDefault();
          if (this.isReplaying) {
            this.stopAutoMoveAndReplay();
            this.updateHUD();
            return;
          }
          if (
            !this.engine.getPlayer().alive ||
            this.engine.isLevelCompleted() ||
            this.engine.isPaused()
          ) {
            return;
          }
          const gridPt = this.renderer.screenToGrid(
            this.gameCanvas,
            changed.clientX,
            changed.clientY
          );
          if (!gridPt) return;
          this.renderer.setHoveredGridPoint(gridPt);
          this.updateInspectBadge(gridPt);
          const result = Pathfinder.findPath(this.engine, gridPt.x, gridPt.y);
          this.autoMoveQueue = result.moves;
          this.autoMovePoints = result.points;
          this.renderer.setPlannedPath(this.autoMovePoints);
        }
      }
    };

    this.gameCanvas.addEventListener('touchend', endTouch, { passive: false });
    this.gameCanvas.addEventListener('touchcancel', endTouch, { passive: false });
  }

  private bindDragAndDrop(): void {
    const dropOverlay = document.getElementById('drop-overlay');

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay?.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dropOverlay?.classList.add('hidden');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay?.classList.add('hidden');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        void this.handleImportedFile(file);
      }
    });
  }

  private pollGamepad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    const pad = pads[0];
    if (!pad) return;

    const threshold = 0.5;
    const axX = pad.axes[0] || 0;
    const axY = pad.axes[1] || 0;

    if (pad.buttons[12]?.pressed || axY < -threshold) {
      this.engine.attemptPlayerMove('N');
    } else if (pad.buttons[13]?.pressed || axY > threshold) {
      this.engine.attemptPlayerMove('S');
    } else if (pad.buttons[14]?.pressed || axX < -threshold) {
      this.engine.attemptPlayerMove('W');
    } else if (pad.buttons[15]?.pressed || axX > threshold) {
      this.engine.attemptPlayerMove('E');
    }

    const bPressed = Boolean(pad.buttons[1]?.pressed);
    if (bPressed && !this.prevGamepadButtons[1]) {
      this.engine.undo();
    }

    const startPressed = Boolean(pad.buttons[9]?.pressed);
    if (startPressed && !this.prevGamepadButtons[9]) {
      this.engine.togglePause();
    }

    this.prevGamepadButtons = pad.buttons.map((b) => b.pressed);
  }

  private setupFovSelector(presets: number[], defaultTiles: number): void {
    const select = document.getElementById('fov-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = `${p}x${p}`;
      if (p === defaultTiles) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const val = Number(select.value);
      if (val > 0) {
        this.renderer.setViewportTiles(val);
        this.saveUserSettings();
      }
    });
  }

  private cycleFovPreset(): void {
    const presets = ConfigRegistry.getGame().grid.viewportPresets || [9, 13, 17, 32];
    const current = this.renderer.getViewportTiles();
    const idx = presets.indexOf(current);
    const next = presets[(idx + 1) % presets.length];
    this.renderer.setViewportTiles(next);
    const select = document.getElementById('fov-select') as HTMLSelectElement | null;
    if (select) {
      select.value = String(next);
    }
    this.saveUserSettings();
  }

  private setupThemeSelector(): void {
    const select = document.getElementById('theme-select') as HTMLSelectElement | null;
    const themes = ConfigRegistry.getGame().themes;
    if (!select || !themes) return;
    select.innerHTML = '';
    for (const theme of Object.values(themes)) {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = t(theme.i18nKey);
      if (theme.id === this.renderer.getThemeId()) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    select.onchange = () => {
      this.applyTheme(select.value);
    };
  }

  private applyTheme(themeId: string): void {
    this.renderer.setThemeId(themeId);
    const select = document.getElementById('theme-select') as HTMLSelectElement | null;
    if (select) {
      select.value = themeId;
    }
    const trackMap: Record<string, string> = {
      cyber_neon: 'cyber_pulse',
      arctic_lab: 'arctic_synth',
      magma_core: 'magma_drive',
      lynx_lcd: 'cyber_pulse'
    };
    if (trackMap[themeId]) {
      AudioManager.setTrackById(trackMap[themeId]);
    }
    this.saveUserSettings();
  }

  private clearAutoMove(): void {
    this.autoMoveQueue = [];
    this.autoMovePoints = [];
    this.renderer.setPlannedPath([]);
    this.renderer.setObjectivePoint(null);
  }

  private triggerObjectiveAndLinks(): void {
    const active = this.renderer.toggleMechanismLinks();
    document.getElementById('hud-btn-objective')?.classList.toggle('active', active);
    document.getElementById('mobile-btn-objective')?.classList.toggle('active', active);

    if (active) {
      const target = Pathfinder.findNextObjective(this.engine);
      this.renderer.setObjectivePoint(target);
      if (target) {
        this.showTransientStatus(
          t('hud.messages.objective_found.label', { x: target.x, y: target.y })
        );
      }
    } else {
      this.renderer.setObjectivePoint(null);
    }
  }

  private getMedalLabel(timeRemaining: number, timeLimit: number): string {
    if (timeLimit <= 0) return t('hud.messages.medal_gold.label');
    const timing = ConfigRegistry.getGame().timing;
    const ratio = timeRemaining / timeLimit;
    if (ratio >= (timing.goldTimeRatio ?? 0.5)) {
      return t('hud.messages.medal_gold.label');
    }
    if (ratio >= (timing.silverTimeRatio ?? 0.25)) {
      return t('hud.messages.medal_silver.label');
    }
    return t('hud.messages.medal_bronze.label');
  }

  private stopAutoMoveAndReplay(): void {
    this.clearAutoMove();
    this.isReplaying = false;
    this.replayMoves = [];
    this.replayIndex = 0;
  }

  private startReplay(moves: Direction[]): void {
    if (!moves || moves.length === 0) return;
    this.stopAutoMoveAndReplay();
    this.engine.loadLevel(this.engine.getLevel());
    this.replayMoves = [...moves];
    this.replayIndex = 0;
    this.isReplaying = true;
    this.updateHUD();
  }

  private generateProceduralPack(): void {
    const levels = ProceduralGenerator.generatePack();
    ConfigRegistry.setProceduralLevels(levels);
    this.refreshPackSelector();
    this.editor.populatePresetDropdown();
    this.switchMode('play');
    this.startLevelByIndex(0);
    this.showTransientStatus(
      t('app.packs.procedural_toast.label', { count: levels.length })
    );
  }

  private setupLocaleSelector(supported: string[], defaultLocale: string): void {
    const select = document.getElementById('locale-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';
    for (const loc of supported) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc.toUpperCase();
      select.appendChild(opt);
    }
    const initial = supported.includes(i18n.getLocale()) ? i18n.getLocale() : defaultLocale;
    select.value = initial;
    i18n.setLocale(initial);

    select.addEventListener('change', () => {
      i18n.setLocale(select.value);
      this.saveUserSettings();
    });
  }

  private startLevelByIndex(index: number): void {
    const levels = ConfigRegistry.getLevels();
    if (levels.length === 0) return;
    this.stopAutoMoveAndReplay();
    this.lastWarnedSecond = -1;
    this.currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
    const level = levels[this.currentLevelIndex];
    this.engine.loadLevel(level);
    this.saveProgress();
    this.updateHUD();
  }

  private switchMode(mode: 'play' | 'editor'): void {
    this.activeMode = mode;
    const playView = document.getElementById('play-view');
    const editorView = document.getElementById('editor-view');
    const playBtn = document.getElementById('btn-mode-play');
    const editorBtn = document.getElementById('btn-mode-editor');

    if (mode === 'play') {
      playView?.classList.remove('hidden');
      editorView?.classList.add('hidden');
      playBtn?.classList.add('active');
      editorBtn?.classList.remove('active');
    } else {
      playView?.classList.add('hidden');
      editorView?.classList.remove('hidden');
      playBtn?.classList.remove('active');
      editorBtn?.classList.add('active');
      this.editor.populatePresetDropdown();
      this.editor.loadCompiledLevel(this.engine.getLevel());
    }
  }

  private bindUIEvents(): void {
    const packSelect = document.getElementById('pack-select') as HTMLSelectElement | null;
    packSelect?.addEventListener('change', () => {
      ConfigRegistry.setActivePackId(packSelect.value);
      this.editor.populatePresetDropdown();
      this.startLevelByIndex(0);
    });

    const packFileInput = document.getElementById('pack-file-input') as HTMLInputElement | null;
    document.getElementById('btn-import-pack')?.addEventListener('click', () => {
      packFileInput?.click();
    });

    document.getElementById('btn-procedural-pack')?.addEventListener('click', () => {
      this.generateProceduralPack();
    });

    this.gameCanvas.addEventListener('click', (e) => {
      if (this.activeMode !== 'play') return;
      if (this.isReplaying) {
        this.stopAutoMoveAndReplay();
        this.updateHUD();
        return;
      }
      if (!this.engine.getPlayer().alive || this.engine.isLevelCompleted() || this.engine.isPaused()) {
        return;
      }
      const gridPt = this.renderer.screenToGrid(this.gameCanvas, e.clientX, e.clientY);
      if (!gridPt) return;
      const result = Pathfinder.findPath(this.engine, gridPt.x, gridPt.y);
      this.autoMoveQueue = result.moves;
      this.autoMovePoints = result.points;
      this.renderer.setPlannedPath(this.autoMovePoints);
    });

    this.gameCanvas.addEventListener('mousemove', (e) => {
      if (this.activeMode !== 'play') return;
      const gridPt = this.renderer.screenToGrid(this.gameCanvas, e.clientX, e.clientY);
      this.renderer.setHoveredGridPoint(gridPt);
      this.updateInspectBadge(gridPt);
    });

    this.gameCanvas.addEventListener('mouseleave', () => {
      this.renderer.setHoveredGridPoint(null);
      this.updateInspectBadge(null);
    });

    this.gameCanvas.addEventListener(
      'wheel',
      (e) => {
        if (this.activeMode !== 'play') return;
        e.preventDefault();
        const presets = ConfigRegistry.getGame().grid.viewportPresets || [9, 13, 17, 32];
        const curr = this.renderer.getViewportTiles();
        const idx = presets.indexOf(curr);
        const nextIdx =
          e.deltaY > 0
            ? Math.min(presets.length - 1, (idx >= 0 ? idx : 1) + 1)
            : Math.max(0, (idx >= 0 ? idx : 1) - 1);
        const nextTiles = presets[nextIdx];
        this.renderer.setViewportTiles(nextTiles);
        const select = document.getElementById('fov-select') as HTMLSelectElement | null;
        if (select) select.value = String(nextTiles);
        this.saveUserSettings();
      },
      { passive: false }
    );

    packFileInput?.addEventListener('change', () => {
      const file = packFileInput.files?.[0];
      if (file) {
        void this.handleImportedFile(file);
      }
      packFileInput.value = '';
    });

    document.getElementById('btn-mode-play')?.addEventListener('click', () => {
      this.switchMode('play');
    });

    document.getElementById('btn-mode-editor')?.addEventListener('click', () => {
      this.switchMode('editor');
    });

    const scoresModal = document.getElementById('scores-modal');
    const scoresSearchInput = document.getElementById(
      'scores-search-input'
    ) as HTMLInputElement | null;
    document.getElementById('btn-levels-modal')?.addEventListener('click', () => {
      scoresModal?.classList.remove('hidden');
      this.populateScoresTable(true);
      scoresSearchInput?.focus();
    });

    document.getElementById('scores-close-btn')?.addEventListener('click', () => {
      scoresModal?.classList.add('hidden');
    });

    scoresModal?.addEventListener('click', (e) => {
      if (e.target === scoresModal) {
        scoresModal.classList.add('hidden');
      }
    });

    scoresSearchInput?.addEventListener('input', () => {
      this.scoresSearchQuery = scoresSearchInput.value.trim().toLowerCase();
      this.populateScoresTable(false);
    });

    const filterBtns = document.querySelectorAll<HTMLButtonElement>('.scores-filter-pills button');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as 'all' | 'unsolved' | 'completed' | null;
        if (!filter) return;
        this.scoresFilterMode = filter;
        filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
        this.populateScoresTable(false);
      });
    });

    const optionsBtn = document.getElementById('btn-options-menu');
    const optionsDrawer = document.getElementById('options-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');

    const setDrawerOpen = (open: boolean): void => {
      optionsDrawer?.classList.toggle('hidden', !open);
      drawerBackdrop?.classList.toggle('hidden', !open);
      optionsBtn?.classList.toggle('active', open);
      optionsBtn?.setAttribute('aria-expanded', String(open));
    };

    optionsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = Boolean(optionsDrawer?.classList.contains('hidden'));
      setDrawerOpen(isHidden);
    });

    document.getElementById('hud-btn-options-drawer')?.addEventListener('click', () => {
      this.triggerHaptic();
      setDrawerOpen(true);
    });

    document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
      setDrawerOpen(false);
    });

    drawerBackdrop?.addEventListener('click', () => {
      setDrawerOpen(false);
    });

    document.getElementById('btn-drawer-levels')?.addEventListener('click', () => {
      setDrawerOpen(false);
      scoresModal?.classList.remove('hidden');
      this.populateScoresTable(true);
      scoresSearchInput?.focus();
    });

    document.getElementById('btn-drawer-procedural')?.addEventListener('click', () => {
      setDrawerOpen(false);
      this.generateProceduralPack();
    });

    document.getElementById('btn-drawer-import')?.addEventListener('click', () => {
      setDrawerOpen(false);
      packFileInput?.click();
    });

    const helpModal = document.getElementById('help-modal');
    document.getElementById('btn-help-modal')?.addEventListener('click', () => {
      setDrawerOpen(false);
      helpModal?.classList.remove('hidden');
    });

    document.getElementById('help-close-btn')?.addEventListener('click', () => {
      helpModal?.classList.add('hidden');
    });

    helpModal?.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.add('hidden');
      }
    });

    document.getElementById('btn-export-pack-ccl')?.addEventListener('click', () => {
      const levels = ConfigRegistry.getLevels();
      const bytes = DatCodec.encodeLevels(levels);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ConfigRegistry.getActivePackId()}.ccl`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('btn-delete-pack')?.addEventListener('click', async () => {
      const activeId = ConfigRegistry.getActivePackId();
      if (activeId !== BUILTIN_PACK_IDS.CAMPAIGN && activeId !== BUILTIN_PACK_IDS.CUSTOM) {
        await ConfigRegistry.deleteImportedPack(activeId);
        this.refreshPackSelector();
        this.editor.populatePresetDropdown();
        this.startLevelByIndex(0);
        this.populateScoresTable();
      }
    });

    const gfxBtn = document.getElementById('btn-graphics-toggle');
    gfxBtn?.addEventListener('click', () => {
      this.toggleGraphicsStyle();
    });

    const shellBtn = document.getElementById('btn-shell-toggle');
    const lynxConsole = document.getElementById('lynx-console');
    shellBtn?.addEventListener('click', () => {
      lynxConsole?.classList.toggle('enabled');
      shellBtn.classList.toggle('active');
      this.saveUserSettings();
    });

    const toggleFullscreenHandler = (): void => {
      this.triggerHaptic();
      this.toggleFullscreen();
    };
    document.getElementById('btn-fullscreen-toggle')?.addEventListener('click', toggleFullscreenHandler);
    document.getElementById('btn-mobile-fullscreen')?.addEventListener('click', toggleFullscreenHandler);
    document.getElementById('mobile-btn-fullscreen')?.addEventListener('click', toggleFullscreenHandler);
    document.getElementById('btn-exit-fullscreen')?.addEventListener('click', toggleFullscreenHandler);

    document.addEventListener('fullscreenchange', () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      document.body.classList.toggle('fullscreen-mode', isNativeFs);
      this.syncFullscreenButtons(isNativeFs);
    });

    const sfxBtn = document.getElementById('btn-sfx-toggle');
    sfxBtn?.addEventListener('click', () => {
      const enabled = AudioManager.toggleSfx();
      sfxBtn.classList.toggle('active', enabled);
      this.saveUserSettings();
    });

    const musicBtn = document.getElementById('btn-music-toggle');
    musicBtn?.addEventListener('click', () => {
      const enabled = AudioManager.toggleMusic();
      musicBtn.classList.toggle('active', enabled);
      this.saveUserSettings();
    });

    const dpadBtns = document.querySelectorAll<HTMLButtonElement>('.dpad-btn');
    dpadBtns.forEach((btn) => {
      const dir = btn.getAttribute('data-dir') as Direction | null;
      if (!dir) return;

      const startMove = (e: Event): void => {
        e.preventDefault();
        this.clearAutoMove();
        this.heldDirection = dir;
        this.triggerHaptic();
        this.engine.attemptPlayerMove(dir);
      };
      const stopMove = (): void => {
        if (this.heldDirection === dir) {
          this.heldDirection = null;
        }
      };

      btn.addEventListener('mousedown', startMove);
      btn.addEventListener('touchstart', startMove, { passive: false });
      btn.addEventListener('mouseup', stopMove);
      btn.addEventListener('mouseleave', stopMove);
      btn.addEventListener('touchend', stopMove);
      btn.addEventListener('touchcancel', stopMove);
    });

    const dpadContainers = document.querySelectorAll<HTMLElement>('.dpad-container');
    dpadContainers.forEach((container) => {
      container.addEventListener(
        'touchmove',
        (e) => {
          const touch = e.touches[0];
          if (!touch) return;
          e.preventDefault();
          const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
          const btn = targetEl?.closest('.dpad-btn') as HTMLElement | null;
          const dir = btn?.getAttribute('data-dir') as Direction | null;
          if (dir && dir !== this.heldDirection) {
            this.clearAutoMove();
            this.heldDirection = dir;
            this.triggerHaptic();
            this.engine.attemptPlayerMove(dir);
          }
        },
        { passive: false }
      );
      container.addEventListener('touchend', () => {
        this.heldDirection = null;
      });
      container.addEventListener('touchcancel', () => {
        this.heldDirection = null;
      });
    });

    const mobileMenuBtn = document.getElementById('btn-mobile-menu');
    const topControlsDrawer = document.getElementById('top-controls-drawer');
    mobileMenuBtn?.addEventListener('click', () => {
      topControlsDrawer?.classList.toggle('open');
      mobileMenuBtn.classList.toggle('active', topControlsDrawer?.classList.contains('open'));
    });

    document.getElementById('mobile-btn-undo')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.clearAutoMove();
      this.engine.undo();
      this.updateHUD();
    });

    document.getElementById('mobile-btn-objective')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.triggerObjectiveAndLinks();
    });

    document.getElementById('mobile-btn-restart')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.clearAutoMove();
      this.engine.loadLevel(this.engine.getLevel());
      this.updateHUD();
    });

    document.getElementById('mobile-btn-zoom')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.cycleFovPreset();
    });

    document.getElementById('lynx-btn-b')?.addEventListener('click', () => {
      this.engine.undo();
      this.updateHUD();
    });

    document.getElementById('lynx-btn-a')?.addEventListener('click', () => {
      if (this.engine.isLevelCompleted()) {
        this.startLevelByIndex(this.currentLevelIndex + 1);
      } else if (!this.engine.getPlayer().alive) {
        this.engine.loadLevel(this.engine.getLevel());
      } else {
        this.engine.attemptPlayerMove(this.engine.getPlayer().dir);
      }
      this.updateHUD();
    });

    document.getElementById('lynx-opt1')?.addEventListener('click', () => {
      this.engine.loadLevel(this.engine.getLevel());
      this.updateHUD();
    });

    document.getElementById('lynx-opt2')?.addEventListener('click', () => {
      const enabled = AudioManager.toggleSfx();
      sfxBtn?.classList.toggle('active', enabled);
      this.saveUserSettings();
    });

    document.getElementById('lynx-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
      this.updateHUD();
    });

    document.getElementById('overlay-btn-resume')?.addEventListener('click', () => {
      this.engine.setPaused(false);
      this.updateHUD();
    });

    document.getElementById('hud-btn-undo')?.addEventListener('click', () => {
      this.clearAutoMove();
      this.engine.undo();
      this.updateHUD();
    });

    document.getElementById('hud-btn-objective')?.addEventListener('click', () => {
      this.triggerObjectiveAndLinks();
    });

    document.getElementById('hud-btn-restart')?.addEventListener('click', () => {
      this.engine.loadLevel(this.engine.getLevel());
      this.updateHUD();
    });

    document.getElementById('hud-btn-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
      this.updateHUD();
    });

    document.getElementById('hud-btn-prev')?.addEventListener('click', () => {
      this.startLevelByIndex(this.currentLevelIndex - 1);
    });

    document.getElementById('hud-btn-next')?.addEventListener('click', () => {
      this.startLevelByIndex(this.currentLevelIndex + 1);
    });

    document.getElementById('overlay-btn-next')?.addEventListener('click', () => {
      this.startLevelByIndex(this.currentLevelIndex + 1);
    });

    document.getElementById('overlay-btn-replay')?.addEventListener('click', () => {
      const lvlId = this.engine.getLevel().id;
      const moves =
        this.engine.getMoveHistory().length > 0
          ? this.engine.getMoveHistory()
          : this.highScores[lvlId]?.replayMoves || [];
      this.startReplay(moves);
    });

    document.getElementById('overlay-btn-undo')?.addEventListener('click', () => {
      this.stopAutoMoveAndReplay();
      this.engine.undo();
      this.updateHUD();
    });

    document.getElementById('overlay-btn-retry')?.addEventListener('click', () => {
      this.stopAutoMoveAndReplay();
      this.engine.loadLevel(this.engine.getLevel());
      this.updateHUD();
    });

    const passModal = document.getElementById('password-modal');
    const passInput = document.getElementById('password-input') as HTMLInputElement | null;
    const passError = document.getElementById('password-error');

    const openPasswordModal = (): void => {
      passError?.classList.add('hidden');
      if (passInput) passInput.value = '';
      passModal?.classList.remove('hidden');
      passInput?.focus();
    };

    document.getElementById('hud-btn-password')?.addEventListener('click', openPasswordModal);
    document.getElementById('btn-drawer-password')?.addEventListener('click', () => {
      document.getElementById('options-drawer')?.classList.add('hidden');
      document.getElementById('drawer-backdrop')?.classList.add('hidden');
      document.getElementById('btn-options-menu')?.classList.remove('active');
      openPasswordModal();
    });
    document.querySelector('.hud-password-badge')?.addEventListener('click', openPasswordModal);

    document.getElementById('password-cancel-btn')?.addEventListener('click', () => {
      passModal?.classList.add('hidden');
    });

    passModal?.addEventListener('click', (e) => {
      if (e.target === passModal) {
        passModal.classList.add('hidden');
      }
    });

    const submitPassword = (): void => {
      const code = (passInput?.value || '').trim().toUpperCase();
      const idx = ConfigRegistry.getLevels().findIndex((l) => l.password.toUpperCase() === code);
      if (idx >= 0) {
        passModal?.classList.add('hidden');
        this.startLevelByIndex(idx);
      } else {
        passError?.classList.remove('hidden');
      }
    };

    document.getElementById('password-submit-btn')?.addEventListener('click', submitPassword);
    passInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPassword();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        passModal?.classList.add('hidden');
      }
    });
  }

  private populateScoresTable(scrollToActive: boolean = false): void {
    const tbody = document.getElementById('scores-table-body');
    const scoresModal = document.getElementById('scores-modal');
    const deletePackBtn = document.getElementById('btn-delete-pack');
    const progressEl = document.getElementById('scores-progress-summary');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activeId = ConfigRegistry.getActivePackId();
    const isRemovablePack =
      activeId !== BUILTIN_PACK_IDS.CAMPAIGN && activeId !== BUILTIN_PACK_IDS.CUSTOM;
    deletePackBtn?.classList.toggle('hidden', !isRemovablePack);

    const levels = ConfigRegistry.getLevels();
    const completedCount = levels.filter((lvl) => Boolean(this.highScores[lvl.id])).length;
    if (progressEl) {
      progressEl.textContent = t('hud.scores_modal.progress.label', {
        completed: completedCount,
        total: levels.length
      });
    }

    let activeRowEl: HTMLTableRowElement | null = null;

    levels.forEach((lvl, idx) => {
      const rec = this.highScores[lvl.id];
      if (this.scoresFilterMode === 'unsolved' && rec) return;
      if (this.scoresFilterMode === 'completed' && !rec) return;

      const title =
        lvl.customTitle || (lvl.titleKey ? t(lvl.titleKey, { number: lvl.number }) : lvl.id);

      if (this.scoresSearchQuery) {
        const hay = `${lvl.number} ${title} ${lvl.password}`.toLowerCase();
        if (!hay.includes(this.scoresSearchQuery)) return;
      }

      const tr = document.createElement('tr');
      if (idx === this.currentLevelIndex) {
        tr.classList.add('current-level-row');
        activeRowEl = tr;
      }

      const tdNum = document.createElement('td');
      tdNum.textContent = String(lvl.number);

      const tdTitle = document.createElement('td');
      tdTitle.textContent = title;

      const tdCode = document.createElement('td');
      tdCode.className = 'code-cell';
      tdCode.textContent = lvl.password;

      const tdTime = document.createElement('td');
      if (rec) {
        const medal = this.getMedalLabel(rec.bestTimeRemaining, lvl.timeLimitSeconds).split(' ')[0];
        tdTime.textContent = `${medal} ${rec.bestTimeRemaining}s`;
      } else {
        tdTime.textContent = '-';
      }

      const tdSteps = document.createElement('td');
      tdSteps.textContent = rec ? String(rec.minSteps) : '-';

      const tdScore = document.createElement('td');
      tdScore.textContent = rec ? String(rec.bestScore) : '-';

      const tdAction = document.createElement('td');
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'hud-btn small primary';
      playBtn.textContent = t('hud.scores_modal.play_btn.action');
      playBtn.addEventListener('click', () => {
        scoresModal?.classList.add('hidden');
        this.switchMode('play');
        this.startLevelByIndex(idx);
      });
      tdAction.appendChild(playBtn);

      if (rec?.replayMoves && rec.replayMoves.length > 0) {
        const replayBtn = document.createElement('button');
        replayBtn.type = 'button';
        replayBtn.className = 'hud-btn small';
        replayBtn.style.marginLeft = '4px';
        replayBtn.textContent = t('hud.scores_modal.replay_btn.action');
        replayBtn.addEventListener('click', () => {
          scoresModal?.classList.add('hidden');
          this.switchMode('play');
          this.startLevelByIndex(idx);
          this.startReplay(rec.replayMoves!);
        });
        tdAction.appendChild(replayBtn);
      }

      tr.append(tdNum, tdTitle, tdCode, tdTime, tdSteps, tdScore, tdAction);
      tbody.appendChild(tr);
    });

    if (scrollToActive && activeRowEl) {
      requestAnimationFrame(() => {
        (activeRowEl as HTMLTableRowElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  private isAnyModalOpen(): boolean {
    const scoresOpen = !document.getElementById('scores-modal')?.classList.contains('hidden');
    const passOpen = !document.getElementById('password-modal')?.classList.contains('hidden');
    const helpOpen = !document.getElementById('help-modal')?.classList.contains('hidden');
    const drawerOpen = !document.getElementById('options-drawer')?.classList.contains('hidden');
    return Boolean(scoresOpen || passOpen || helpOpen || drawerOpen);
  }

  private bindKeyboardEvents(): void {
    const kb = ConfigRegistry.getGame().keybindings;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const scoresModal = document.getElementById('scores-modal');
        const passModal = document.getElementById('password-modal');
        const helpModal = document.getElementById('help-modal');
        const optionsDrawer = document.getElementById('options-drawer');
        const drawerBackdrop = document.getElementById('drawer-backdrop');
        if (scoresModal && !scoresModal.classList.contains('hidden')) {
          scoresModal.classList.add('hidden');
          return;
        }
        if (passModal && !passModal.classList.contains('hidden')) {
          passModal.classList.add('hidden');
          return;
        }
        if (helpModal && !helpModal.classList.contains('hidden')) {
          helpModal.classList.add('hidden');
          return;
        }
        if (optionsDrawer && !optionsDrawer.classList.contains('hidden')) {
          optionsDrawer.classList.add('hidden');
          drawerBackdrop?.classList.add('hidden');
          document.getElementById('btn-options-menu')?.classList.remove('active');
          return;
        }
      }

      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
        return;
      }

      if (this.isAnyModalOpen()) {
        return;
      }

      if (this.activeMode === 'editor') {
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyW')) {
          e.preventDefault();
          if (e.shiftKey) {
            this.editor.redo();
          } else {
            this.editor.undo();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
          e.preventDefault();
          this.editor.redo();
        }
        return;
      }

      if (this.activeMode !== 'play') return;

      if (this.isReplaying) {
        this.stopAutoMoveAndReplay();
        this.updateHUD();
        return;
      }

      if (
        kb.undo.includes(e.code) ||
        ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyW'))
      ) {
        e.preventDefault();
        this.clearAutoMove();
        this.engine.undo();
      } else if (kb.moveUp.includes(e.code)) {
        e.preventDefault();
        this.clearAutoMove();
        this.heldDirection = 'N';
        this.engine.attemptPlayerMove('N');
      } else if (kb.moveDown.includes(e.code)) {
        e.preventDefault();
        this.clearAutoMove();
        this.heldDirection = 'S';
        this.engine.attemptPlayerMove('S');
      } else if (kb.moveLeft.includes(e.code)) {
        e.preventDefault();
        this.clearAutoMove();
        this.heldDirection = 'W';
        this.engine.attemptPlayerMove('W');
      } else if (kb.moveRight.includes(e.code)) {
        e.preventDefault();
        this.clearAutoMove();
        this.heldDirection = 'E';
        this.engine.attemptPlayerMove('E');
      } else if (kb.restart.includes(e.code)) {
        e.preventDefault();
        this.stopAutoMoveAndReplay();
        this.engine.loadLevel(this.engine.getLevel());
      } else if (kb.pause.includes(e.code)) {
        e.preventDefault();
        this.engine.togglePause();
      } else if (kb.nextLevel.includes(e.code)) {
        e.preventDefault();
        this.startLevelByIndex(this.currentLevelIndex + 1);
      } else if (kb.prevLevel.includes(e.code)) {
        e.preventDefault();
        this.startLevelByIndex(this.currentLevelIndex - 1);
      } else if (kb.toggleShell.includes(e.code)) {
        e.preventDefault();
        document.getElementById('btn-shell-toggle')?.click();
      } else if (kb.toggleFullscreen?.includes(e.code)) {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (kb.toggleMute.includes(e.code)) {
        e.preventDefault();
        document.getElementById('btn-sfx-toggle')?.click();
      } else if (kb.cycleFov?.includes(e.code)) {
        e.preventDefault();
        this.cycleFovPreset();
      } else if (kb.toggleGraphics?.includes(e.code)) {
        e.preventDefault();
        this.toggleGraphicsStyle();
      } else if (kb.cycleTheme?.includes(e.code)) {
        e.preventDefault();
        const nextTheme = this.renderer.cycleTheme();
        this.applyTheme(nextTheme);
      } else if (kb.generateProcedural?.includes(e.code)) {
        e.preventDefault();
        this.generateProceduralPack();
      } else if (kb.showObjective?.includes(e.code)) {
        e.preventDefault();
        this.triggerObjectiveAndLinks();
      } else if (kb.toggleHelp?.includes(e.code) || e.key === '?') {
        e.preventDefault();
        document.getElementById('help-modal')?.classList.remove('hidden');
      } else if (e.code === 'Enter' && this.engine.isLevelCompleted()) {
        e.preventDefault();
        this.startLevelByIndex(this.currentLevelIndex + 1);
      }

      this.updateHUD();
    });

    window.addEventListener('keyup', (e) => {
      if (
        (this.heldDirection === 'N' && kb.moveUp.includes(e.code)) ||
        (this.heldDirection === 'S' && kb.moveDown.includes(e.code)) ||
        (this.heldDirection === 'W' && kb.moveLeft.includes(e.code)) ||
        (this.heldDirection === 'E' && kb.moveRight.includes(e.code))
      ) {
        this.heldDirection = null;
      }
    });
  }

  private toggleFullscreen(): void {
    const isCurrentlyFs =
      Boolean(document.fullscreenElement) || document.body.classList.contains('fullscreen-mode');

    if (isCurrentlyFs) {
      document.body.classList.remove('fullscreen-mode');
      this.syncFullscreenButtons(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {
          // Ignore browser exitFullscreen errors
        });
      }
    } else {
      document.body.classList.add('fullscreen-mode');
      this.syncFullscreenButtons(true);
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        void docEl.requestFullscreen().catch(() => {
          // Keep CSS fullscreen-mode active on iOS Safari where Fullscreen API is restricted
        });
      }
    }
  }

  private syncFullscreenButtons(active: boolean): void {
    document.getElementById('btn-fullscreen-toggle')?.classList.toggle('active', active);
    document.getElementById('btn-mobile-fullscreen')?.classList.toggle('active', active);
    document.getElementById('btn-exit-fullscreen')?.classList.toggle('hidden', !active);

    const mobileFsBtn = document.getElementById('mobile-btn-fullscreen');
    if (mobileFsBtn) {
      const i18nKey = active
        ? 'hud.mobile.exit_fullscreen.action'
        : 'hud.mobile.fullscreen.action';
      mobileFsBtn.setAttribute('data-i18n', i18nKey);
      mobileFsBtn.textContent = t(i18nKey);
      mobileFsBtn.classList.toggle('active', active);
    }
  }

  private rebuildHudIcons(): void {
    for (const k of this.keyIds) {
      this.keyIconCache[k] = this.renderer.renderIconToDataUrl('item', k);
    }
    for (const b of this.bootIds) {
      this.bootIconCache[b] = this.renderer.renderIconToDataUrl('item', b);
    }
  }

  private toggleGraphicsStyle(): void {
    const nextStyle = this.renderer.toggleStyle();
    const isModern = nextStyle === 'modern';
    this.gameCanvas.classList.toggle('retro-pixels', !isModern);
    const gfxBtn = document.getElementById('btn-graphics-toggle');
    if (gfxBtn) {
      const i18nKey = isModern
        ? 'app.header.graphics_modern.action'
        : 'app.header.graphics_retro.action';
      gfxBtn.setAttribute('data-i18n', i18nKey);
      gfxBtn.textContent = t(i18nKey);
      gfxBtn.classList.toggle('active', isModern);
    }
    this.rebuildHudIcons();
    this.saveUserSettings();
    this.updateHUD();
    if (this.activeMode === 'editor') {
      this.editor.buildUI();
      this.editor.render();
    }
  }

  private updateInspectBadge(pt: GridPoint | null): void {
    const inspectEl = document.getElementById('inspect-pill');
    if (!inspectEl) return;
    if (!pt || this.activeMode !== 'play') {
      inspectEl.classList.add('hidden');
      return;
    }

    const terrain = this.engine.getTerrain();
    const items = this.engine.getItems();
    const entities = this.engine.getEntities();
    const tileId = terrain[pt.y]?.[pt.x];
    if (!tileId) {
      inspectEl.classList.add('hidden');
      return;
    }

    const parts: string[] = [];
    const ent = entities.find((e) => e.x === pt.x && e.y === pt.y);
    if (ent) {
      const entDef = ConfigRegistry.getEntityDef(ent.type);
      if (entDef) parts.push(t(entDef.i18nKey));
    }

    const itemId = items[pt.y]?.[pt.x];
    if (itemId) {
      const itemDef = ConfigRegistry.getTile(itemId);
      parts.push(t(itemDef.i18nKey));
    }

    // Mask secret illusions (blue_wall_fake or invisible/appearing walls) as standard appearance
    let displayTileId = tileId;
    if (tileId === 'blue_wall_fake') displayTileId = 'blue_wall_real';
    else if (tileId === 'invisible_wall' || tileId === 'appearing_wall') displayTileId = 'floor';

    const tileDef = ConfigRegistry.getTile(displayTileId);
    if (parts.length === 0 || displayTileId !== 'floor') {
      parts.push(t(tileDef.i18nKey));
    }

    inspectEl.textContent = t('hud.messages.inspect_format.label', {
      x: pt.x,
      y: pt.y,
      details: parts.join(' + ')
    });
    inspectEl.classList.remove('hidden');
  }

  private updateHUD(): void {
    const lvl = this.engine.getLevel();
    const player = this.engine.getPlayer();

    const numEl = document.getElementById('hud-level-num');
    const passEl = document.getElementById('hud-level-pass');
    const titleEl = document.getElementById('hud-level-title');
    const chipsEl = document.getElementById('hud-chips-left');
    const timeEl = document.getElementById('hud-time-left');
    const scoreEl = document.getElementById('hud-score');
    const stepsEl = document.getElementById('hud-steps');

    if (numEl) numEl.textContent = String(lvl.number);
    if (passEl) passEl.textContent = lvl.password;
    if (titleEl) {
      titleEl.textContent =
        lvl.customTitle || (lvl.titleKey ? t(lvl.titleKey, { number: lvl.number }) : lvl.id);
    }
    if (chipsEl) {
      chipsEl.textContent = String(this.engine.getChipsRemaining()).padStart(3, '0');
    }
    if (timeEl) {
      const remSec = this.engine.getTimeRemainingSeconds();
      timeEl.textContent = String(remSec).padStart(3, '0');
      const warnThreshold = ConfigRegistry.getGame().timing.lowTimeWarningSeconds ?? 10;
      const isLowTime =
        lvl.timeLimitSeconds > 0 &&
        remSec > 0 &&
        remSec <= warnThreshold &&
        player.alive &&
        !this.engine.isLevelCompleted();
      timeEl.classList.toggle('led-danger', isLowTime);
      timeEl.classList.toggle('led-amber', !isLowTime);

      if (isLowTime && !this.engine.isPaused() && remSec !== this.lastWarnedSecond) {
        this.lastWarnedSecond = remSec;
        AudioManager.playSfx('timer_warn');
      }
    }
    if (scoreEl) scoreEl.textContent = String(this.engine.getTotalScore());
    if (stepsEl) stepsEl.textContent = String(this.engine.getStepsCount());

    const keysGrid = document.getElementById('hud-keys-grid');
    if (keysGrid) {
      keysGrid.innerHTML = '';
      for (const kId of this.keyIds) {
        const count = player.keys[kId] || 0;
        const slot = document.createElement('div');
        slot.className = `inv-slot ${count > 0 ? 'owned' : ''}`;
        slot.title = t(ConfigRegistry.getTile(kId).i18nKey);

        const img = document.createElement('img');
        img.src = this.keyIconCache[kId];
        img.alt = kId;
        slot.appendChild(img);

        if (count > 0) {
          const badge = document.createElement('span');
          badge.className = 'inv-count';
          badge.textContent = kId === 'key_green' ? '∞' : `x${count}`;
          slot.appendChild(badge);
        }
        keysGrid.appendChild(slot);
      }
    }

    const bootsGrid = document.getElementById('hud-boots-grid');
    if (bootsGrid) {
      bootsGrid.innerHTML = '';
      for (const bId of this.bootIds) {
        const hasBoot = player.boots.has(bId);
        const slot = document.createElement('div');
        slot.className = `inv-slot ${hasBoot ? 'owned' : ''}`;
        slot.title = t(ConfigRegistry.getTile(bId).i18nKey);

        const img = document.createElement('img');
        img.src = this.bootIconCache[bId];
        img.alt = bId;
        slot.appendChild(img);
        bootsGrid.appendChild(slot);
      }
    }

    const hintBanner = document.getElementById('hint-banner');
    const hintText = document.getElementById('hint-text');
    if (hintBanner && hintText) {
      if (this.engine.isPlayerOnHint()) {
        const resolvedHint = lvl.customHint || (lvl.hintKey ? t(lvl.hintKey) : '');
        hintText.textContent = resolvedHint;
        hintBanner.classList.remove('hidden');
      } else {
        hintBanner.classList.add('hidden');
      }
    }

    const statusToast = document.getElementById('status-toast');
    const bannerKey = this.engine.getStatusBannerKey();
    if (statusToast) {
      if (this.isReplaying) {
        statusToast.textContent = t('hud.messages.replaying_banner.label', {
          step: this.replayIndex,
          total: this.replayMoves.length
        });
        statusToast.classList.remove('hidden');
      } else if (this.customStatusMessage) {
        statusToast.textContent = this.customStatusMessage;
        statusToast.classList.remove('hidden');
      } else if (bannerKey) {
        statusToast.textContent = t(bannerKey);
        statusToast.classList.remove('hidden');
      } else {
        statusToast.classList.add('hidden');
      }
    }

    const overlay = document.getElementById('viewport-overlay');
    const ovTitle = document.getElementById('overlay-title');
    const ovSub = document.getElementById('overlay-subtitle');
    const ovExtra = document.getElementById('overlay-extra');
    const ovResumeBtn = document.getElementById('overlay-btn-resume');
    const ovNextBtn = document.getElementById('overlay-btn-next');
    const ovReplayBtn = document.getElementById('overlay-btn-replay');
    const ovUndoBtn = document.getElementById('overlay-btn-undo');
    const ovRetryBtn = document.getElementById('overlay-btn-retry');

    if (!overlay || !ovTitle || !ovSub || !ovExtra || !ovNextBtn || !ovUndoBtn) return;

    if (this.renderer.isShowingMechanismLinks() && player.alive && !this.engine.isLevelCompleted()) {
      this.renderer.setObjectivePoint(Pathfinder.findNextObjective(this.engine));
    }

    if (this.engine.isLevelCompleted()) {
      overlay.classList.remove('hidden');
      ovTitle.textContent = t('hud.messages.level_complete.label');
      ovSub.textContent = t('hud.messages.time_bonus.label', {
        bonus: this.engine.getLastTimeBonus()
      });
      ovExtra.textContent = t('hud.messages.level_score.label', {
        score: this.engine.getLastLevelScore(),
        medal: this.getMedalLabel(this.engine.getTimeRemainingSeconds(), lvl.timeLimitSeconds)
      });
      ovResumeBtn?.classList.add('hidden');
      ovNextBtn.classList.remove('hidden');
      ovReplayBtn?.classList.remove('hidden');
      ovUndoBtn.classList.add('hidden');
      ovRetryBtn?.classList.remove('hidden');
    } else if (!player.alive) {
      overlay.classList.remove('hidden');
      ovTitle.textContent = 'EPOXY';
      ovSub.textContent = player.deathReasonKey ? t(player.deathReasonKey) : '';
      ovExtra.textContent = '';
      ovResumeBtn?.classList.add('hidden');
      ovNextBtn.classList.add('hidden');
      ovReplayBtn?.classList.add('hidden');
      ovUndoBtn.classList.toggle('hidden', !this.engine.canUndo());
      ovRetryBtn?.classList.remove('hidden');
    } else if (this.engine.isPaused()) {
      overlay.classList.remove('hidden');
      ovTitle.textContent = t('hud.messages.paused.label');
      ovSub.textContent = t('hud.messages.press_resume.label');
      ovExtra.textContent = '';
      ovResumeBtn?.classList.remove('hidden');
      ovNextBtn.classList.add('hidden');
      ovReplayBtn?.classList.add('hidden');
      ovUndoBtn.classList.add('hidden');
      ovRetryBtn?.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  private recordHighScore(
    levelId: string,
    timeRemaining: number,
    steps: number,
    score: number,
    moves: Direction[]
  ): void {
    const existing = this.highScores[levelId];
    const isBetterOrFirst = !existing || steps <= existing.minSteps || score >= existing.bestScore;
    this.highScores[levelId] = {
      bestTimeRemaining: existing ? Math.max(existing.bestTimeRemaining, timeRemaining) : timeRemaining,
      minSteps: existing ? Math.min(existing.minSteps, steps) : steps,
      bestScore: existing ? Math.max(existing.bestScore, score) : score,
      replayMoves: isBetterOrFirst ? moves : existing.replayMoves || moves
    };
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.highScoresKey);
      localStorage.setItem(key, JSON.stringify(this.highScores));
    } catch {
      // Storage unavailable
    }
  }

  private loadHighScores(): void {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.highScoresKey);
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, LevelHighScore>;
      if (parsed && typeof parsed === 'object') {
        this.highScores = parsed;
      }
    } catch {
      // Ignore corrupt high scores
    }
  }

  private saveProgress(): void {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.saveSlotKey);
      localStorage.setItem(
        key,
        JSON.stringify({
          packId: ConfigRegistry.getActivePackId(),
          levelIndex: this.currentLevelIndex,
          totalScore: this.engine.getTotalScore()
        })
      );
    } catch {
      // Storage unavailable
    }
  }

  private saveUserSettings(): void {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.settingsKey);
      const settings: UserSettings = {
        locale: i18n.getLocale(),
        fov: this.renderer.getViewportTiles(),
        themeId: this.renderer.getThemeId(),
        graphicsStyle: this.renderer.getStyle(),
        shellEnabled: Boolean(document.getElementById('lynx-console')?.classList.contains('enabled')),
        sfxEnabled: AudioManager.isSfxEnabled(),
        musicEnabled: AudioManager.isMusicEnabled()
      };
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      // Storage unavailable
    }
  }

  private loadUserSettings(): UserSettings {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.settingsKey);
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as UserSettings;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private restoreSavedProgress(): void {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.saveSlotKey);
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { packId?: string; levelIndex?: number };
      if (parsed.packId === ConfigRegistry.getActivePackId() && typeof parsed.levelIndex === 'number') {
        this.currentLevelIndex = Math.max(0, parsed.levelIndex);
      }
    } catch {
      // Ignore corrupt save
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new EpoxyApplication();
  app.init().catch((err) => {
    console.error('Initialization failed:', err);
  });
});
