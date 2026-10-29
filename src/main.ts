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
import { InvalidLevelError } from './config/ConfigValidation';
import { i18n, t } from './i18n/I18nManager';
import { GameEngine } from './core/GameEngine';
import { PixelRenderer } from './render/PixelRenderer';
import { LevelEditor } from './editor/LevelEditor';
import { AudioManager } from './audio/AudioManager';
import { DatCodec } from './formats/DatCodec';
import { Pathfinder } from './core/Pathfinder';
import { ProceduralGenerationError, ProceduralGenerator } from './core/ProceduralGenerator';
import {
  CompiledLevel,
  Direction,
  GridPoint,
  KeybindingsConfig,
  LevelBlueprint,
  LevelHighScore,
  LevelPack,
  TimedMove,
  UserSettings
} from './core/types';
import { closeDialog, isDialogOpen, openDialog } from './ui/dialog';
import { downloadBytes } from './ui/download';
import { showFatalErrorScreen } from './ui/fatalErrorScreen';
import { InventorySlotView } from './ui/inventorySlots';
import { getMedalTier, medalIconKey, medalLabelKey, MedalTier } from './ui/medals';
import { preferredScrollBehavior } from './ui/motion';
import { collectDueMoves, sanitizeTimedMoves } from './ui/replaySchedule';
import { cycleZoomPreset, getViewportPresets, stepZoomPreset } from './ui/viewportZoom';
import {
  CANVAS_RESIZE_TOLERANCE_PX,
  DEFAULT_GRAPHICS_STYLE,
  DEFAULT_THEME_ID,
  GAMEPAD_AXIS_THRESHOLD,
  GAMEPAD_AXIS_X,
  GAMEPAD_AXIS_Y,
  GAMEPAD_BUTTONS,
  GAMEPAD_INDEX,
  HUD_COUNTER_DIGITS,
  INFINITE_KEY_IDS,
  MAX_DEVICE_PIXEL_RATIO,
  MINIMAP_TILE_PX,
  MIN_VIEWPORT_SYNC_PX,
  SWIPE_ANCHOR_FOLLOW_RATIO,
  THEME_MUSIC_TRACKS,
  TIMING_DEFAULTS,
  TOAST_DURATION_MS,
  TOUCH_DEFAULTS
} from './ui/uiConstants';

/** High score as stored: legacy records only carry untimed replayMoves. */
type StoredHighScore = LevelHighScore & { replayTimedMoves?: TimedMove[] };

type OverlayState = 'none' | 'complete' | 'dead' | 'paused';
type ScoresFilter = 'all' | 'unsolved' | 'completed';

/** Displacement that marks a two-finger gesture so it never ends as a tap. */
const PINCH_SUPPRESSES_TAP = Number.POSITIVE_INFINITY;
const NO_WARNED_SECOND = -1;

const MODAL_IDS = {
  SCORES: 'scores-modal',
  HELP: 'help-modal',
  PASSWORD: 'password-modal'
} as const;

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Writes text only when it changed: avoids DOM churn and repeated live region announcements. */
function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

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
  private highScores: Record<string, StoredHighScore> = {};
  private prevGamepadButtons: boolean[] = [];
  private customStatusMessage: string | null = null;
  private customStatusTimeout: number | null = null;
  private autoMoveQueue: Direction[] = [];
  private autoMovePoints: GridPoint[] = [];
  private replayMoves: TimedMove[] = [];
  private replayIndex: number = 0;
  private isReplaying: boolean = false;
  private lastWarnedSecond: number = NO_WARNED_SECOND;
  private scoresFilterMode: ScoresFilter = 'all';
  private scoresSearchQuery: string = '';
  private overlayState: OverlayState = 'none';
  /** Engine level the editor content was last synced with. */
  private editorSourceLevel: CompiledLevel | null = null;
  private generatingPack = false;

  private keyIconCache: Record<string, string> = {};
  private bootIconCache: Record<string, string> = {};
  private keySlots: InventorySlotView[] = [];
  private bootSlots: InventorySlotView[] = [];
  private inventoryLabels: Record<string, string> = {};
  private inventoryLabelsLocale: string = '';

  private readonly keyIds = ['key_red', 'key_blue', 'key_yellow', 'key_green'];
  private readonly bootIds = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'];

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------

  public async init(): Promise<void> {
    await ConfigRegistry.loadAll();

    const gameCfg = ConfigRegistry.getGame();
    const savedSettings = this.loadUserSettings();
    const initialLocale =
      savedSettings.locale && gameCfg.locales.supported.includes(savedSettings.locale)
        ? savedSettings.locale
        : gameCfg.locales.default;
    this.setupLocaleSelector(gameCfg.locales.supported, initialLocale);

    const editorCanvas = this.setupGameCanvas();
    this.applyDisplaySettings(savedSettings);
    this.applyAudioSettings(savedSettings);
    this.setupThemeSelector();
    this.bindViewportResizeObserver();

    this.rebuildHudIcons();
    this.buildInventorySlots();

    this.loadHighScores();
    this.bindEngineCallbacks();
    this.createEditor(editorCanvas);

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

    this.startGameLoop();
    this.startRenderLoop();
  }

  /** Sizes the play canvas and grabs its contexts; returns the editor canvas. */
  private setupGameCanvas(): HTMLCanvasElement {
    const gameCfg = ConfigRegistry.getGame();
    const canvas = byId<HTMLCanvasElement>('game-canvas');
    const editorCanvas = byId<HTMLCanvasElement>('editor-canvas');
    if (!canvas || !editorCanvas) {
      throw new Error('Required canvas elements missing');
    }

    this.gameCanvas = canvas;
    const canvasSize =
      gameCfg.grid.viewportCanvasSize || gameCfg.grid.viewportWidth * gameCfg.grid.tilePixelSize;
    this.gameCanvas.width = canvasSize;
    this.gameCanvas.height = canvasSize;

    const ctx = this.gameCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D context unavailable');
    }
    this.gameCtx = ctx;
    this.radarCtx = byId<HTMLCanvasElement>('radar-canvas')?.getContext('2d') || null;
    return editorCanvas;
  }

  private applyDisplaySettings(savedSettings: UserSettings): void {
    const gameCfg = ConfigRegistry.getGame();
    const presets = getViewportPresets(gameCfg);
    const initialFov =
      savedSettings.fov && presets.includes(savedSettings.fov)
        ? savedSettings.fov
        : gameCfg.grid.viewportWidth;
    this.renderer.setViewportTiles(initialFov);

    const defaultStyle =
      savedSettings.graphicsStyle || gameCfg.graphics?.defaultStyle || DEFAULT_GRAPHICS_STYLE;
    this.renderer.setStyle(defaultStyle);

    const initialTheme =
      savedSettings.themeId && gameCfg.themes?.[savedSettings.themeId]
        ? savedSettings.themeId
        : gameCfg.graphics?.defaultTheme || DEFAULT_THEME_ID;
    this.renderer.setThemeId(initialTheme);
    this.gameCanvas.classList.toggle('retro-pixels', defaultStyle === 'retro');
    this.syncGraphicsButton(defaultStyle === 'modern');

    if (savedSettings.shellEnabled) {
      byId('lynx-console')?.classList.add('enabled');
      byId('btn-shell-toggle')?.classList.add('active');
    }

    this.setupFovSelector(presets, initialFov);
  }

  private applyAudioSettings(savedSettings: UserSettings): void {
    if (typeof savedSettings.sfxEnabled === 'boolean') {
      AudioManager.setSfxEnabled(savedSettings.sfxEnabled);
      byId('btn-sfx-toggle')?.classList.toggle('active', savedSettings.sfxEnabled);
    }
    if (typeof savedSettings.musicEnabled === 'boolean') {
      AudioManager.setMusicEnabled(savedSettings.musicEnabled);
      byId('btn-music-toggle')?.classList.toggle('active', savedSettings.musicEnabled);
    }
  }

  private bindEngineCallbacks(): void {
    this.engine.setOnWinCallback((levelId, timeRemaining, steps, score, moves) => {
      if (!this.isReplaying) {
        this.recordHighScore(levelId, timeRemaining, steps, score, moves, this.engine.getTimedMoveHistory());
      }
      this.stopAutoMoveAndReplay();
    });
    this.engine.setOnVisualEventCallback((kind, x, y, colorKey) => {
      this.renderer.triggerVisualEvent(kind, x, y, colorKey);
    });
  }

  private createEditor(editorCanvas: HTMLCanvasElement): void {
    this.editor = new LevelEditor(
      editorCanvas,
      this.renderer,
      (testLevel: CompiledLevel) => {
        this.switchMode('play');
        this.stopAutoMoveAndReplay();
        this.lastWarnedSecond = NO_WARNED_SECOND;
        this.engine.loadLevel(testLevel);
        // The editor already holds this content: do not reload it on return.
        this.editorSourceLevel = testLevel;
        this.updateHUD();
      },
      (savedIdx: number) => {
        // Saving makes the custom pack active: play the saved level from it.
        this.refreshPackSelector();
        this.startLevelByIndex(savedIdx);
        this.editorSourceLevel = this.engine.getLevel();
      },
      (message: string) => {
        this.showTransientStatus(message);
      }
    );
    this.editor.buildUI();
  }

  private startGameLoop(): void {
    window.setInterval(() => {
      this.runGameTick();
    }, ConfigRegistry.getGame().timing.tickIntervalMs);
  }

  private runGameTick(): void {
    if (this.activeMode !== 'play') return;
    this.pollGamepad();
    if (this.isReplaying) {
      this.advanceReplay();
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
  }

  /** Applies every recorded move due at the current engine tick; failed moves are skipped. */
  private advanceReplay(): void {
    const { due, nextIndex } = collectDueMoves(this.replayMoves, this.replayIndex, this.engine.getTick());
    for (const move of due) {
      this.engine.attemptPlayerMove(move.dir);
    }
    this.replayIndex = nextIndex;
    if (this.replayIndex >= this.replayMoves.length) {
      this.isReplaying = false;
    }
  }

  private startRenderLoop(): void {
    const renderLoop = (): void => {
      if (this.activeMode === 'play') {
        this.renderer.renderViewport(this.gameCtx, this.engine);
        if (this.radarCtx) {
          this.renderer.renderMinimap(this.radarCtx, this.engine, MINIMAP_TILE_PX);
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
      if (rect.width < MIN_VIEWPORT_SYNC_PX || rect.height < MIN_VIEWPORT_SYNC_PX) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (
        Math.abs(this.gameCanvas.width - targetW) > CANVAS_RESIZE_TOLERANCE_PX ||
        Math.abs(this.gameCanvas.height - targetH) > CANVAS_RESIZE_TOLERANCE_PX
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

  // ---------------------------------------------------------------------------
  // Packs, import and export
  // ---------------------------------------------------------------------------

  private getPackDisplayName(pack: LevelPack): string {
    return pack.i18nKey ? t(pack.i18nKey) : pack.name;
  }

  private refreshPackSelector(): void {
    const select = byId<HTMLSelectElement>('pack-select');
    if (!select) return;
    select.innerHTML = '';

    const activeId = ConfigRegistry.getActivePackId();
    for (const pack of ConfigRegistry.getAllPacks()) {
      const opt = document.createElement('option');
      opt.value = pack.id;
      opt.textContent = t('app.packs.selector_option.label', {
        name: this.getPackDisplayName(pack),
        count: pack.levels.length
      });
      if (pack.id === activeId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  }

  private async handleImportedFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    const packName = file.name.replace(/\.[^.]+$/, '').toUpperCase();

    try {
      let levels: CompiledLevel[];
      if (lower.endsWith('.dat') || lower.endsWith('.ccl')) {
        levels = DatCodec.decodeBuffer(await file.arrayBuffer(), packName);
        if (levels.length === 0) {
          throw new Error('Empty pack');
        }
      } else if (lower.endsWith('.json')) {
        levels = this.compileJsonLevels(JSON.parse(await file.text()));
      } else {
        this.showTransientStatus(t('app.packs.import_error.label'));
        return;
      }
      await ConfigRegistry.registerImportedPack(packName, levels);
      this.refreshPackSelector();
      this.editor.populatePresetDropdown();
      this.switchMode('play');
      this.startLevelByIndex(0);
      this.showTransientStatus(
        t('app.packs.imported_toast.label', { name: packName, count: levels.length })
      );
    } catch (err) {
      this.showTransientStatus(
        err instanceof InvalidLevelError
          ? t('app.packs.invalid_level_error.label', { id: err.levelId })
          : t('app.packs.import_error.label')
      );
    }
  }

  /** Compiles every level of a JSON import; throws before anything is registered. */
  private compileJsonLevels(parsed: unknown): CompiledLevel[] {
    const container = parsed as { levels?: unknown };
    const rawList = (
      Array.isArray(parsed) ? parsed : Array.isArray(container?.levels) ? container.levels : [parsed]
    ) as LevelBlueprint[];
    return rawList.map((item) => ConfigRegistry.compileBlueprint(item));
  }

  /** Builds a pack level by level, showing progress; ignores requests while one is running. */
  private async generateProceduralPack(): Promise<void> {
    if (this.generatingPack) return;
    this.generatingPack = true;
    let levels: CompiledLevel[];
    try {
      levels = await ProceduralGenerator.generatePackAsync(
        undefined,
        ProceduralGenerator.createSeed(),
        (done, total) =>
          this.showTransientStatus(t('app.packs.procedural_progress.label', { done, total }))
      );
    } catch (err) {
      if (!(err instanceof ProceduralGenerationError)) throw err;
      this.showTransientStatus(t('app.packs.procedural_error.label'));
      return;
    } finally {
      this.generatingPack = false;
    }
    ConfigRegistry.setProceduralLevels(levels);
    this.refreshPackSelector();
    this.editor.populatePresetDropdown();
    this.switchMode('play');
    this.startLevelByIndex(0);
    this.showTransientStatus(t('app.packs.procedural_toast.label', { count: levels.length }));
  }

  private exportActivePack(): void {
    downloadBytes(
      DatCodec.encodeLevels(ConfigRegistry.getLevels()),
      `${ConfigRegistry.getActivePackId()}.ccl`
    );
  }

  private isRemovablePack(packId: string): boolean {
    return packId !== BUILTIN_PACK_IDS.CAMPAIGN && packId !== BUILTIN_PACK_IDS.CUSTOM;
  }

  private async deleteActivePack(): Promise<void> {
    const activeId = ConfigRegistry.getActivePackId();
    if (!this.isRemovablePack(activeId)) return;
    const pack = ConfigRegistry.getAllPacks().find((p) => p.id === activeId);
    const name = pack ? this.getPackDisplayName(pack) : activeId;
    if (!window.confirm(t('app.packs.delete_confirm.label', { name }))) return;

    await ConfigRegistry.deleteImportedPack(activeId);
    this.refreshPackSelector();
    this.editor.populatePresetDropdown();
    this.startLevelByIndex(0);
    this.populateScoresTable();
  }

  // ---------------------------------------------------------------------------
  // Status, haptics, input helpers
  // ---------------------------------------------------------------------------

  private showTransientStatus(message: string): void {
    this.customStatusMessage = message;
    if (this.customStatusTimeout !== null) {
      clearTimeout(this.customStatusTimeout);
    }
    this.customStatusTimeout = window.setTimeout(() => {
      this.customStatusMessage = null;
      this.updateHUD();
    }, TOAST_DURATION_MS);
    this.updateHUD();
  }

  private triggerHaptic(): void {
    const pulseMs = ConfigRegistry.getGame().touch?.hapticPulseMs ?? TOUCH_DEFAULTS.hapticPulseMs;
    if (pulseMs > 0 && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pulseMs);
      } catch {
        // Ignore vibration permission restrictions
      }
    }
  }

  /** Starts a held move from any input source (keys, d-pad, swipe). */
  private beginHeldMove(dir: Direction): void {
    this.clearAutoMove();
    this.heldDirection = dir;
    this.engine.attemptPlayerMove(dir);
  }

  /** Click or tap on the board: stop a replay, or plan a path to the tile. */
  private handleBoardPointer(clientX: number, clientY: number, inspect: boolean): void {
    if (this.isReplaying) {
      this.stopAutoMoveAndReplay();
      this.updateHUD();
      return;
    }
    if (!this.engine.getPlayer().alive || this.engine.isLevelCompleted() || this.engine.isPaused()) {
      return;
    }
    const gridPt = this.renderer.screenToGrid(this.gameCanvas, clientX, clientY);
    if (!gridPt) return;
    if (inspect) {
      this.renderer.setHoveredGridPoint(gridPt);
      this.updateInspectBadge(gridPt);
    }
    const result = Pathfinder.findPath(this.engine, gridPt.x, gridPt.y);    this.autoMoveQueue = result.moves;
    this.autoMovePoints = result.points;
    this.renderer.setPlannedPath(this.autoMovePoints);
  }

  private bindTouchGestures(): void {
    const touchCfg = { ...TOUCH_DEFAULTS, ...ConfigRegistry.getGame().touch };
    const swipeDeadzone = touchCfg.swipeDeadzonePx;
    const tapMaxDist = touchCfg.tapMaxDistancePx;
    const tapMaxDuration = touchCfg.tapMaxDurationMs;
    const pinchStepPx = touchCfg.pinchZoomStepPx;
    const anchorTrail = swipeDeadzone * SWIPE_ANCHOR_FOLLOW_RATIO;

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
          maxDisplacement = PINCH_SUPPRESSES_TAP;
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
            if (this.stepZoom(dist > pinchAnchorDist ? -1 : 1)) {
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
          if (Math.hypot(dx, dy) >= swipeDeadzone) {
            const dir: Direction =
              Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
            this.clearAutoMove();
            if (this.heldDirection !== dir) {
              this.triggerHaptic();
              this.beginHeldMove(dir);
            }
            // Follow finger so turning 90 or 180 degrees mid-drag responds immediately
            anchorX = t0.clientX - Math.sign(dx) * anchorTrail;
            anchorY = t0.clientY - Math.sign(dy) * anchorTrail;
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
          this.handleBoardPointer(changed.clientX, changed.clientY, true);
        }
      }
    };

    this.gameCanvas.addEventListener('touchend', endTouch, { passive: false });
    this.gameCanvas.addEventListener('touchcancel', endTouch, { passive: false });
  }

  private bindDragAndDrop(): void {
    const dropOverlay = byId('drop-overlay');

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
    const pad = navigator.getGamepads()[GAMEPAD_INDEX];
    if (!pad) return;

    const axX = pad.axes[GAMEPAD_AXIS_X] || 0;
    const axY = pad.axes[GAMEPAD_AXIS_Y] || 0;
    const pressed = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);
    const justPressed = (idx: number): boolean => pressed(idx) && !this.prevGamepadButtons[idx];

    if (pressed(GAMEPAD_BUTTONS.DPAD_UP) || axY < -GAMEPAD_AXIS_THRESHOLD) {
      this.engine.attemptPlayerMove('N');
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_DOWN) || axY > GAMEPAD_AXIS_THRESHOLD) {
      this.engine.attemptPlayerMove('S');
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_LEFT) || axX < -GAMEPAD_AXIS_THRESHOLD) {
      this.engine.attemptPlayerMove('W');
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_RIGHT) || axX > GAMEPAD_AXIS_THRESHOLD) {
      this.engine.attemptPlayerMove('E');
    }

    if (justPressed(GAMEPAD_BUTTONS.B)) {
      this.undoMove();
    }
    if (justPressed(GAMEPAD_BUTTONS.START)) {
      this.engine.togglePause();
    }

    this.prevGamepadButtons = pad.buttons.map((b) => b.pressed);
  }

  // ---------------------------------------------------------------------------
  // Viewport, theme, locale selectors
  // ---------------------------------------------------------------------------

  private setupFovSelector(presets: number[], defaultTiles: number): void {
    const select = byId<HTMLSelectElement>('fov-select');
    if (!select) return;
    select.innerHTML = '';
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = t('app.header.fov_option.label', { size: p });
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

  private applyViewportTiles(tiles: number): void {
    this.renderer.setViewportTiles(tiles);
    const select = byId<HTMLSelectElement>('fov-select');
    if (select) select.value = String(tiles);
    this.saveUserSettings();
  }

  /** Zooms one preset in (-1) or out (1); returns whether the view changed. */
  private stepZoom(step: 1 | -1): boolean {
    const game = ConfigRegistry.getGame();
    const curr = this.renderer.getViewportTiles();
    const next = stepZoomPreset(getViewportPresets(game), curr, step, game.grid.viewportWidth);
    if (next === curr) return false;
    this.applyViewportTiles(next);
    return true;
  }

  private cycleFovPreset(): void {
    const presets = getViewportPresets(ConfigRegistry.getGame());
    this.applyViewportTiles(cycleZoomPreset(presets, this.renderer.getViewportTiles()));
  }

  private setupThemeSelector(): void {
    const select = byId<HTMLSelectElement>('theme-select');
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
    const select = byId<HTMLSelectElement>('theme-select');
    if (select) {
      select.value = themeId;
    }
    const track = THEME_MUSIC_TRACKS[themeId];
    if (track) {
      AudioManager.setTrackById(track);
    }
    this.saveUserSettings();
  }

  private setupLocaleSelector(supported: string[], defaultLocale: string): void {
    const select = byId<HTMLSelectElement>('locale-select');
    if (!select) return;
    select.innerHTML = '';
    for (const loc of supported) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = t(`app.languages.${loc}.label`);
      opt.lang = loc;
      select.appendChild(opt);
    }
    select.value = defaultLocale;
    i18n.setLocale(defaultLocale);

    select.addEventListener('change', () => {
      i18n.setLocale(select.value);
      this.saveUserSettings();
    });
  }

  // ---------------------------------------------------------------------------
  // Level flow, replay, auto move
  // ---------------------------------------------------------------------------

  private clearAutoMove(): void {
    this.autoMoveQueue = [];
    this.autoMovePoints = [];
    this.renderer.setPlannedPath([]);
    this.renderer.setObjectivePoint(null);
  }

  private stopAutoMoveAndReplay(): void {
    this.clearAutoMove();
    this.isReplaying = false;
    this.replayMoves = [];
    this.replayIndex = 0;
  }

  /** Single entry point for every restart control. */
  private restartLevel(): void {
    this.stopAutoMoveAndReplay();
    this.heldDirection = null;
    this.lastWarnedSecond = NO_WARNED_SECOND;
    this.engine.loadLevel(this.engine.getLevel());
    this.updateHUD();
  }

  /** Single entry point for every undo control. */
  private undoMove(): void {
    this.stopAutoMoveAndReplay();
    this.engine.undo();
    this.updateHUD();
  }

  private startReplay(moves: TimedMove[]): void {
    if (!moves || moves.length === 0) return;
    this.stopAutoMoveAndReplay();
    this.engine.loadLevel(this.engine.getLevel());
    this.replayMoves = [...moves];
    this.replayIndex = 0;
    this.isReplaying = true;
    this.updateHUD();
  }

  private triggerObjectiveAndLinks(): void {
    const active = this.renderer.toggleMechanismLinks();
    byId('hud-btn-objective')?.classList.toggle('active', active);
    byId('mobile-btn-objective')?.classList.toggle('active', active);

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

  private getMedalTierFor(timeRemaining: number, timeLimit: number): MedalTier {
    const timing = ConfigRegistry.getGame().timing;
    return getMedalTier(
      timeRemaining,
      timeLimit,
      timing.goldTimeRatio ?? TIMING_DEFAULTS.goldTimeRatio,
      timing.silverTimeRatio ?? TIMING_DEFAULTS.silverTimeRatio
    );
  }

  private startLevelByIndex(index: number): void {
    const levels = ConfigRegistry.getLevels();
    if (levels.length === 0) return;
    this.stopAutoMoveAndReplay();
    this.lastWarnedSecond = NO_WARNED_SECOND;
    this.currentLevelIndex = ((index % levels.length) + levels.length) % levels.length;
    this.engine.loadLevel(levels[this.currentLevelIndex]);
    this.saveProgress();
    this.updateHUD();
  }

  private isPackFullyCompleted(levels: CompiledLevel[]): boolean {
    return levels.length > 0 && levels.every((lvl) => Boolean(this.highScores[lvl.id]));
  }

  private isOnLastLevel(): boolean {
    return this.currentLevelIndex >= ConfigRegistry.getLevels().length - 1;
  }

  /** Next level; past the last one the pack restarts at level 1 with a message. */
  private advanceToNextLevel(): void {
    const levels = ConfigRegistry.getLevels();
    const wraps = this.isOnLastLevel();
    this.startLevelByIndex(this.currentLevelIndex + 1);
    if (wraps && levels.length > 0) {
      this.showTransientStatus(
        t(
          this.isPackFullyCompleted(levels)
            ? 'hud.messages.all_levels_won.label'
            : 'hud.messages.pack_wrapped.label'
        )
      );
    }
  }

  private switchMode(mode: 'play' | 'editor'): void {
    this.activeMode = mode;
    const isPlay = mode === 'play';
    byId('play-view')?.classList.toggle('hidden', !isPlay);
    byId('editor-view')?.classList.toggle('hidden', isPlay);
    byId('btn-mode-play')?.classList.toggle('active', isPlay);
    byId('btn-mode-editor')?.classList.toggle('active', !isPlay);

    if (!isPlay) {
      this.syncEditorWithEngineLevel();
      this.editor.populatePresetDropdown();
    }
  }

  /**
   * Loads the engine level into the editor only when it changed since the
   * editor last saw it, and asks before replacing unsaved editor work.
   */
  private syncEditorWithEngineLevel(): void {
    const level = this.engine.getLevel();
    if (level === this.editorSourceLevel) return;
    this.editorSourceLevel = level;
    if (this.editor.hasUnsavedChanges() && !window.confirm(t('editor.toolbar.confirm_reload.label'))) {
      return;
    }
    this.editor.loadCompiledLevel(level);
  }

  // ---------------------------------------------------------------------------
  // UI event binding
  // ---------------------------------------------------------------------------

  private bindUIEvents(): void {
    this.bindPackControls();
    this.bindBoardPointer();
    this.bindModeSwitch();
    this.bindDrawer();
    this.bindScoresModal();
    this.bindHelpModal();
    this.bindPasswordModal();
    this.bindDisplayToggles();
    this.bindAudioToggles();
    this.bindDpad();
    this.bindMobileControls();
    this.bindLynxControls();
    this.bindHudControls();
    this.bindOverlayControls();
  }

  private openPackFilePicker(): void {
    byId<HTMLInputElement>('pack-file-input')?.click();
  }

  private bindPackControls(): void {
    const packSelect = byId<HTMLSelectElement>('pack-select');
    packSelect?.addEventListener('change', () => {
      ConfigRegistry.setActivePackId(packSelect.value);
      this.editor.populatePresetDropdown();
      this.startLevelByIndex(0);
    });

    byId('btn-import-pack')?.addEventListener('click', () => {
      this.openPackFilePicker();
    });

    byId('btn-procedural-pack')?.addEventListener('click', () => {
      void this.generateProceduralPack();
    });

    const packFileInput = byId<HTMLInputElement>('pack-file-input');
    packFileInput?.addEventListener('change', () => {
      const file = packFileInput.files?.[0];
      if (file) {
        void this.handleImportedFile(file);
      }
      packFileInput.value = '';
    });

    byId('btn-export-pack-ccl')?.addEventListener('click', () => {
      this.exportActivePack();
    });

    byId('btn-delete-pack')?.addEventListener('click', () => {
      void this.deleteActivePack();
    });
  }

  private bindBoardPointer(): void {
    this.gameCanvas.addEventListener('click', (e) => {
      if (this.activeMode !== 'play') return;
      this.handleBoardPointer(e.clientX, e.clientY, false);
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
        this.stepZoom(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
  }

  private bindModeSwitch(): void {
    byId('btn-mode-play')?.addEventListener('click', () => {
      this.switchMode('play');
    });
    byId('btn-mode-editor')?.addEventListener('click', () => {
      this.switchMode('editor');
    });
  }

  // -- Options drawer --------------------------------------------------------

  private syncDrawerChrome(open: boolean): void {
    byId('drawer-backdrop')?.classList.toggle('hidden', !open);
    const optionsBtn = byId('btn-options-menu');
    optionsBtn?.classList.toggle('active', open);
    optionsBtn?.setAttribute('aria-expanded', String(open));
  }

  /** The only way the drawer opens or closes, so its chrome never desyncs. */
  private setDrawerOpen(open: boolean, opener?: HTMLElement | null): void {
    const drawer = byId('options-drawer');
    if (!drawer) return;
    if (!open) {
      closeDialog(drawer);
      this.syncDrawerChrome(false);
      return;
    }
    if (isDialogOpen(drawer)) return;
    this.syncDrawerChrome(true);
    openDialog(drawer, opener ?? (document.activeElement as HTMLElement | null), {
      onClose: () => this.syncDrawerChrome(false)
    });
  }

  private bindDrawer(): void {
    const optionsBtn = byId('btn-options-menu');
    optionsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setDrawerOpen(!isDialogOpen(byId('options-drawer')), optionsBtn);
    });

    const hudOptionsBtn = byId('hud-btn-options-drawer');
    hudOptionsBtn?.addEventListener('click', () => {
      this.triggerHaptic();
      this.setDrawerOpen(true, hudOptionsBtn);
    });

    byId('btn-close-drawer')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
    });

    byId('drawer-backdrop')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
    });

    byId('btn-drawer-levels')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      this.openScoresModal();
    });

    byId('btn-drawer-procedural')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      void this.generateProceduralPack();
    });

    byId('btn-drawer-import')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      this.openPackFilePicker();
    });

    byId('btn-drawer-password')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      this.openPasswordModal();
    });

    byId('btn-help-modal')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      this.openHelpModal();
    });
  }

  // -- Modals ------------------------------------------------------------------

  private openModal(id: string, initialFocus?: HTMLElement | null): void {
    const modal = byId(id);
    if (!modal) return;
    openDialog(modal, document.activeElement as HTMLElement | null, { initialFocus });
  }

  private closeModal(id: string): void {
    closeDialog(byId(id));
  }

  /** A click on the dimmed backdrop (outside the card) closes the modal. */
  private bindBackdropClose(id: string): void {
    const modal = byId(id);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeDialog(modal);
      }
    });
  }

  private openScoresModal(): void {
    this.populateScoresTable(true);
    this.openModal(MODAL_IDS.SCORES, byId('scores-search-input'));
  }

  private openHelpModal(): void {
    this.openModal(MODAL_IDS.HELP);
  }

  private openPasswordModal(): void {
    const passInput = byId<HTMLInputElement>('password-input');
    byId('password-error')?.classList.add('hidden');
    if (passInput) passInput.value = '';
    this.openModal(MODAL_IDS.PASSWORD, passInput);
  }

  private bindScoresModal(): void {
    byId('btn-levels-modal')?.addEventListener('click', () => {
      this.openScoresModal();
    });
    byId('scores-close-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.SCORES);
    });
    this.bindBackdropClose(MODAL_IDS.SCORES);

    const scoresSearchInput = byId<HTMLInputElement>('scores-search-input');
    scoresSearchInput?.addEventListener('input', () => {
      this.scoresSearchQuery = scoresSearchInput.value.trim().toLowerCase();
      this.populateScoresTable(false);
    });

    const filterBtns = document.querySelectorAll<HTMLButtonElement>('.scores-filter-pills button');
    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter') as ScoresFilter | null;
        if (!filter) return;
        this.scoresFilterMode = filter;
        filterBtns.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        this.populateScoresTable(false);
      });
    });
  }

  private bindHelpModal(): void {
    byId('help-close-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.HELP);
    });
    this.bindBackdropClose(MODAL_IDS.HELP);
  }

  private bindPasswordModal(): void {
    const passInput = byId<HTMLInputElement>('password-input');

    byId('hud-btn-password')?.addEventListener('click', () => {
      this.openPasswordModal();
    });
    byId('hud-password-badge')?.addEventListener('click', () => {
      this.openPasswordModal();
    });
    byId('password-cancel-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.PASSWORD);
    });
    this.bindBackdropClose(MODAL_IDS.PASSWORD);

    const submitPassword = (): void => {
      const code = (passInput?.value || '').trim().toUpperCase();
      const idx = ConfigRegistry.getLevels().findIndex((l) => l.password.toUpperCase() === code);
      if (idx >= 0) {
        this.closeModal(MODAL_IDS.PASSWORD);
        this.startLevelByIndex(idx);
      } else {
        byId('password-error')?.classList.remove('hidden');
      }
    };

    byId('password-submit-btn')?.addEventListener('click', submitPassword);
    passInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPassword();
      }
    });
  }

  // -- Toggles -----------------------------------------------------------------

  private bindDisplayToggles(): void {
    byId('btn-graphics-toggle')?.addEventListener('click', () => {
      this.toggleGraphicsStyle();
    });

    const shellBtn = byId('btn-shell-toggle');
    shellBtn?.addEventListener('click', () => {
      byId('lynx-console')?.classList.toggle('enabled');
      shellBtn.classList.toggle('active');
      this.saveUserSettings();
    });

    const toggleFullscreenHandler = (): void => {
      this.triggerHaptic();
      this.toggleFullscreen();
    };
    for (const id of ['btn-fullscreen-toggle', 'btn-mobile-fullscreen', 'mobile-btn-fullscreen', 'btn-exit-fullscreen']) {
      byId(id)?.addEventListener('click', toggleFullscreenHandler);
    }

    document.addEventListener('fullscreenchange', () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      document.body.classList.toggle('fullscreen-mode', isNativeFs);
      this.syncFullscreenButtons(isNativeFs);
    });
  }

  private toggleSfx(): void {
    const enabled = AudioManager.toggleSfx();
    byId('btn-sfx-toggle')?.classList.toggle('active', enabled);
    this.saveUserSettings();
  }

  private bindAudioToggles(): void {
    byId('btn-sfx-toggle')?.addEventListener('click', () => {
      this.toggleSfx();
    });

    const musicBtn = byId('btn-music-toggle');
    musicBtn?.addEventListener('click', () => {
      const enabled = AudioManager.toggleMusic();
      musicBtn.classList.toggle('active', enabled);
      this.saveUserSettings();
    });
  }

  // -- Mobile and handheld controls -------------------------------------------

  private bindDpad(): void {
    document.querySelectorAll<HTMLButtonElement>('.dpad-btn').forEach((btn) => {
      const dir = btn.getAttribute('data-dir') as Direction | null;
      if (!dir) return;

      const startMove = (e: Event): void => {
        e.preventDefault();
        this.triggerHaptic();
        this.beginHeldMove(dir);
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

    document.querySelectorAll<HTMLElement>('.dpad-container').forEach((container) => {
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
            this.triggerHaptic();
            this.beginHeldMove(dir);
          }
        },
        { passive: false }
      );
      const release = (): void => {
        this.heldDirection = null;
      };
      container.addEventListener('touchend', release);
      container.addEventListener('touchcancel', release);
    });
  }

  private bindMobileControls(): void {
    const mobileMenuBtn = byId('btn-mobile-menu');
    const topControlsDrawer = byId('top-controls-drawer');
    mobileMenuBtn?.addEventListener('click', () => {
      topControlsDrawer?.classList.toggle('open');
      const isOpen = Boolean(topControlsDrawer?.classList.contains('open'));
      mobileMenuBtn.classList.toggle('active', isOpen);
      mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
    });

    byId('mobile-btn-undo')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.undoMove();
    });

    byId('mobile-btn-objective')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.triggerObjectiveAndLinks();
    });

    byId('mobile-btn-restart')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.restartLevel();
    });

    byId('mobile-btn-zoom')?.addEventListener('click', () => {
      this.triggerHaptic();
      this.cycleFovPreset();
    });
  }

  private bindLynxControls(): void {
    byId('lynx-btn-b')?.addEventListener('click', () => {
      this.undoMove();
    });

    byId('lynx-btn-a')?.addEventListener('click', () => {
      if (this.engine.isLevelCompleted()) {
        this.advanceToNextLevel();
      } else if (!this.engine.getPlayer().alive) {
        this.restartLevel();
      } else {
        this.engine.attemptPlayerMove(this.engine.getPlayer().dir);
        this.updateHUD();
      }
    });

    byId('lynx-opt1')?.addEventListener('click', () => {
      this.restartLevel();
    });

    byId('lynx-opt2')?.addEventListener('click', () => {
      this.toggleSfx();
    });

    byId('lynx-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
      this.updateHUD();
    });
  }

  private bindHudControls(): void {
    byId('hud-btn-undo')?.addEventListener('click', () => {
      this.undoMove();
    });
    byId('hud-btn-objective')?.addEventListener('click', () => {
      this.triggerObjectiveAndLinks();
    });
    byId('hud-btn-restart')?.addEventListener('click', () => {
      this.restartLevel();
    });
    byId('hud-btn-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
      this.updateHUD();
    });
    byId('hud-btn-prev')?.addEventListener('click', () => {
      this.startLevelByIndex(this.currentLevelIndex - 1);
    });
    byId('hud-btn-next')?.addEventListener('click', () => {
      this.advanceToNextLevel();
    });
  }

  private bindOverlayControls(): void {
    byId('overlay-btn-resume')?.addEventListener('click', () => {
      this.engine.setPaused(false);
      this.updateHUD();
    });

    byId('overlay-btn-next')?.addEventListener('click', () => {
      this.advanceToNextLevel();
    });

    byId('overlay-btn-replay')?.addEventListener('click', () => {
      const current = this.engine.getTimedMoveHistory();
      const moves =
        current.length > 0
          ? current
          : this.highScores[this.engine.getLevel().id]?.replayTimedMoves || [];
      this.startReplay(moves);
    });

    byId('overlay-btn-undo')?.addEventListener('click', () => {
      this.undoMove();
    });

    byId('overlay-btn-retry')?.addEventListener('click', () => {
      this.restartLevel();
    });
  }

  // ---------------------------------------------------------------------------
  // Scores table
  // ---------------------------------------------------------------------------

  private populateScoresTable(scrollToActive: boolean = false): void {
    const tbody = byId('scores-table-body');
    const progressEl = byId('scores-progress-summary');
    if (!tbody) return;
    tbody.innerHTML = '';

    byId('btn-delete-pack')?.classList.toggle(
      'hidden',
      !this.isRemovablePack(ConfigRegistry.getActivePackId())
    );

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

      const title = this.resolveLevelTitle(lvl);
      if (this.scoresSearchQuery) {
        const hay = `${lvl.number} ${title} ${lvl.password}`.toLowerCase();
        if (!hay.includes(this.scoresSearchQuery)) return;
      }

      const tr = document.createElement('tr');
      if (idx === this.currentLevelIndex) {
        tr.classList.add('current-level-row');
        tr.setAttribute('aria-current', 'true');
        activeRowEl = tr;
      }

      const cell = (text: string, className?: string): HTMLTableCellElement => {
        const td = document.createElement('td');
        td.textContent = text;
        if (className) td.className = className;
        return td;
      };
      const noRecord = '-';

      const timeText = rec
        ? t('hud.scores_modal.best_time_cell.label', {
            medal: t(medalIconKey(this.getMedalTierFor(rec.bestTimeRemaining, lvl.timeLimitSeconds))),
            seconds: rec.bestTimeRemaining
          })
        : noRecord;

      const tdAction = document.createElement('td');
      tdAction.appendChild(
        this.createScoresButton('hud-btn small primary', 'hud.scores_modal.play_btn.action', () => {
          this.closeModal(MODAL_IDS.SCORES);
          this.switchMode('play');
          this.startLevelByIndex(idx);
        })
      );

      const replay = rec?.replayTimedMoves;
      if (replay && replay.length > 0) {
        tdAction.appendChild(
          this.createScoresButton('hud-btn small scores-replay-btn', 'hud.scores_modal.replay_btn.action', () => {
            this.closeModal(MODAL_IDS.SCORES);
            this.switchMode('play');
            this.startLevelByIndex(idx);
            this.startReplay(replay);
          })
        );
      }

      tr.append(
        cell(String(lvl.number)),
        cell(title),
        cell(lvl.password, 'code-cell'),
        cell(timeText),
        cell(rec ? String(rec.minSteps) : noRecord),
        cell(rec ? String(rec.bestScore) : noRecord),
        tdAction
      );
      tbody.appendChild(tr);
    });

    if (scrollToActive && activeRowEl) {
      requestAnimationFrame(() => {
        (activeRowEl as HTMLTableRowElement).scrollIntoView({
          block: 'center',
          behavior: preferredScrollBehavior()
        });
      });
    }
  }

  private createScoresButton(className: string, labelKey: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = t(labelKey);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private bindKeyboardEvents(): void {
    const kb = ConfigRegistry.getGame().keybindings;

    window.addEventListener('keydown', (e) => {
      // Escape and Tab inside dialogs are handled by the dialog helper.
      const active = document.activeElement;
      const activeTag = active?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
        return;
      }
      // Let a focused button handle its own activation keys (no double action).
      if (active instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) {
        return;
      }
      if (isDialogOpen()) {
        return;
      }

      if (this.activeMode === 'editor') {
        this.handleEditorShortcut(e);
        return;
      }

      if (this.activeMode !== 'play') return;

      if (this.isReplaying) {
        this.stopAutoMoveAndReplay();
        this.updateHUD();
        return;
      }

      this.handlePlayShortcut(e, kb);
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

  private handleEditorShortcut(e: KeyboardEvent): void {
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
  }

  private handlePlayShortcut(e: KeyboardEvent, kb: KeybindingsConfig): void {
    const run = (action: () => void): void => {
      e.preventDefault();
      action();
    };

    if (kb.undo.includes(e.code) || ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyW'))) {
      run(() => this.undoMove());
    } else if (kb.moveUp.includes(e.code)) {
      run(() => this.beginHeldMove('N'));
    } else if (kb.moveDown.includes(e.code)) {
      run(() => this.beginHeldMove('S'));
    } else if (kb.moveLeft.includes(e.code)) {
      run(() => this.beginHeldMove('W'));
    } else if (kb.moveRight.includes(e.code)) {
      run(() => this.beginHeldMove('E'));
    } else if (kb.restart.includes(e.code)) {
      run(() => this.restartLevel());
    } else if (kb.pause.includes(e.code)) {
      run(() => this.engine.togglePause());
    } else if (kb.nextLevel.includes(e.code)) {
      run(() => this.advanceToNextLevel());
    } else if (kb.prevLevel.includes(e.code)) {
      run(() => this.startLevelByIndex(this.currentLevelIndex - 1));
    } else if (kb.toggleShell.includes(e.code)) {
      run(() => byId('btn-shell-toggle')?.click());
    } else if (kb.toggleFullscreen?.includes(e.code)) {
      run(() => this.toggleFullscreen());
    } else if (kb.toggleMute.includes(e.code)) {
      run(() => this.toggleSfx());
    } else if (kb.cycleFov?.includes(e.code)) {
      run(() => this.cycleFovPreset());
    } else if (kb.toggleGraphics?.includes(e.code)) {
      run(() => this.toggleGraphicsStyle());
    } else if (kb.cycleTheme?.includes(e.code)) {
      run(() => this.applyTheme(this.renderer.cycleTheme()));
    } else if (kb.generateProcedural?.includes(e.code)) {
      run(() => void this.generateProceduralPack());
    } else if (kb.showObjective?.includes(e.code)) {
      run(() => this.triggerObjectiveAndLinks());
    } else if (kb.toggleHelp?.includes(e.code) || e.key === '?') {
      run(() => this.openHelpModal());
    } else if (e.code === 'Enter' && this.engine.isLevelCompleted()) {
      run(() => this.advanceToNextLevel());
    }
  }

  // ---------------------------------------------------------------------------
  // Fullscreen and graphics
  // ---------------------------------------------------------------------------

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
    byId('btn-fullscreen-toggle')?.classList.toggle('active', active);
    byId('btn-mobile-fullscreen')?.classList.toggle('active', active);
    byId('btn-exit-fullscreen')?.classList.toggle('hidden', !active);

    const mobileFsBtn = byId('mobile-btn-fullscreen');
    if (mobileFsBtn) {
      const i18nKey = active ? 'hud.mobile.exit_fullscreen.action' : 'hud.mobile.fullscreen.action';
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

  private syncGraphicsButton(isModern: boolean): void {
    const gfxBtn = byId('btn-graphics-toggle');
    if (!gfxBtn) return;
    const i18nKey = isModern ? 'app.header.graphics_modern.action' : 'app.header.graphics_retro.action';
    gfxBtn.setAttribute('data-i18n', i18nKey);
    gfxBtn.textContent = t(i18nKey);
    gfxBtn.classList.toggle('active', isModern);
  }

  private toggleGraphicsStyle(): void {
    const isModern = this.renderer.toggleStyle() === 'modern';
    this.gameCanvas.classList.toggle('retro-pixels', !isModern);
    this.syncGraphicsButton(isModern);
    this.rebuildHudIcons();
    this.saveUserSettings();
    this.updateHUD();
    if (this.activeMode === 'editor') {
      this.editor.buildUI();
      this.editor.render();
    }
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private resolveLevelTitle(lvl: CompiledLevel): string {
    return lvl.customTitle || (lvl.titleKey ? t(lvl.titleKey, { number: lvl.number }) : lvl.id);
  }

  private updateInspectBadge(pt: GridPoint | null): void {
    const inspectEl = byId('inspect-pill');
    if (!inspectEl) return;
    if (!pt || this.activeMode !== 'play') {
      inspectEl.classList.add('hidden');
      return;
    }

    const tileId = this.engine.getTerrain()[pt.y]?.[pt.x];
    if (!tileId) {
      inspectEl.classList.add('hidden');
      return;
    }

    const parts: string[] = [];
    const ent = this.engine.getEntities().find((e) => e.x === pt.x && e.y === pt.y);
    if (ent) {
      const entDef = ConfigRegistry.getEntityDef(ent.type);
      if (entDef) parts.push(t(entDef.i18nKey));
    }

    const itemId = this.engine.getItems()[pt.y]?.[pt.x];
    if (itemId) {
      parts.push(t(ConfigRegistry.getTile(itemId).i18nKey));
    }

    // Mask secret illusions (blue_wall_fake or invisible/appearing walls) as standard appearance
    let displayTileId = tileId;
    if (tileId === 'blue_wall_fake') displayTileId = 'blue_wall_real';
    else if (tileId === 'invisible_wall' || tileId === 'appearing_wall') displayTileId = 'floor';

    if (parts.length === 0 || displayTileId !== 'floor') {
      parts.push(t(ConfigRegistry.getTile(displayTileId).i18nKey));
    }

    setText(
      inspectEl,
      t('hud.messages.inspect_format.label', {
        x: pt.x,
        y: pt.y,
        details: parts.join(t('hud.messages.inspect_separator.label'))
      })
    );
    inspectEl.classList.remove('hidden');
  }

  private buildInventorySlots(): void {
    const keysGrid = byId('hud-keys-grid');
    const bootsGrid = byId('hud-boots-grid');
    if (keysGrid) {
      keysGrid.innerHTML = '';
      this.keySlots = this.keyIds.map(() => new InventorySlotView(keysGrid));
    }
    if (bootsGrid) {
      bootsGrid.innerHTML = '';
      this.bootSlots = this.bootIds.map(() => new InventorySlotView(bootsGrid));
    }
  }

  /** Translated item names, recomputed only when the locale changes. */
  private getInventoryLabel(itemId: string): string {
    const locale = i18n.getLocale();
    if (locale !== this.inventoryLabelsLocale) {
      this.inventoryLabels = {};
      for (const id of [...this.keyIds, ...this.bootIds]) {
        this.inventoryLabels[id] = t(ConfigRegistry.getTile(id).i18nKey);
      }
      this.inventoryLabelsLocale = locale;
    }
    return this.inventoryLabels[itemId] ?? itemId;
  }

  private updateInventory(): void {
    const player = this.engine.getPlayer();
    this.keyIds.forEach((kId, i) => {
      const count = player.keys[kId] || 0;
      let badge = '';
      if (count > 0) {
        badge = INFINITE_KEY_IDS.has(kId)
          ? t('hud.inventory.infinite.label')
          : t('hud.inventory.count.label', { count });
      }
      this.keySlots[i]?.update({
        owned: count > 0,
        badge,
        label: this.getInventoryLabel(kId),
        iconUrl: this.keyIconCache[kId]
      });
    });
    this.bootIds.forEach((bId, i) => {
      this.bootSlots[i]?.update({
        owned: player.boots.has(bId),
        badge: '',
        label: this.getInventoryLabel(bId),
        iconUrl: this.bootIconCache[bId]
      });
    });
  }

  private updateHUD(): void {
    const lvl = this.engine.getLevel();
    const player = this.engine.getPlayer();

    setText(byId('hud-level-num'), String(lvl.number));
    setText(byId('hud-level-pass'), lvl.password);
    setText(byId('hud-level-title'), this.resolveLevelTitle(lvl));
    setText(
      byId('hud-chips-left'),
      String(this.engine.getChipsRemaining()).padStart(HUD_COUNTER_DIGITS, '0')
    );
    this.updateTimer();
    setText(byId('hud-score'), String(this.engine.getTotalScore()));
    setText(byId('hud-steps'), String(this.engine.getStepsCount()));

    this.updateInventory();
    this.updateHintBanner();
    this.updateStatusToast();

    if (this.renderer.isShowingMechanismLinks() && player.alive && !this.engine.isLevelCompleted()) {
      this.renderer.setObjectivePoint(Pathfinder.findNextObjective(this.engine));
    }
    this.updateOverlay();
  }

  private updateTimer(): void {
    const timeEl = byId('hud-time-left');
    if (!timeEl) return;
    const lvl = this.engine.getLevel();
    const remSec = this.engine.getTimeRemainingSeconds();
    // A level without a time limit shows a sign, not a counter stuck at zero.
    setText(
      timeEl,
      lvl.timeLimitSeconds > 0
        ? String(remSec).padStart(HUD_COUNTER_DIGITS, '0')
        : t('hud.stats.time_unlimited.label')
    );
    const warnThreshold =
      ConfigRegistry.getGame().timing.lowTimeWarningSeconds ?? TIMING_DEFAULTS.lowTimeWarningSeconds;
    const isLowTime =
      lvl.timeLimitSeconds > 0 &&
      remSec > 0 &&
      remSec <= warnThreshold &&
      this.engine.getPlayer().alive &&
      !this.engine.isLevelCompleted();
    timeEl.classList.toggle('led-danger', isLowTime);
    timeEl.classList.toggle('led-amber', !isLowTime);

    if (isLowTime && !this.engine.isPaused() && remSec !== this.lastWarnedSecond) {
      this.lastWarnedSecond = remSec;
      AudioManager.playSfx('timer_warn');
    }
  }

  private updateHintBanner(): void {
    const hintBanner = byId('hint-banner');
    const hintText = byId('hint-text');
    if (!hintBanner || !hintText) return;
    if (this.engine.isPlayerOnHint()) {
      const lvl = this.engine.getLevel();
      setText(hintText, lvl.customHint || (lvl.hintKey ? t(lvl.hintKey) : ''));
      hintBanner.classList.remove('hidden');
    } else {
      hintBanner.classList.add('hidden');
    }
  }

  private updateStatusToast(): void {
    const statusToast = byId('status-toast');
    if (!statusToast) return;
    const bannerKey = this.engine.getStatusBannerKey();
    let message: string | null = null;
    if (this.isReplaying) {
      message = t('hud.messages.replaying_banner.label', {
        step: this.replayIndex,
        total: this.replayMoves.length
      });
    } else if (this.customStatusMessage) {
      message = this.customStatusMessage;
    } else if (bannerKey) {
      message = t(bannerKey);
    }
    if (message !== null) {
      setText(statusToast, message);
    }
    statusToast.classList.toggle('hidden', message === null);
  }

  private computeOverlayState(): OverlayState {
    if (this.engine.isLevelCompleted()) return 'complete';
    if (!this.engine.getPlayer().alive) return 'dead';
    if (this.engine.isPaused()) return 'paused';
    return 'none';
  }

  private updateOverlay(): void {
    const overlay = byId('viewport-overlay');
    const ovTitle = byId('overlay-title');
    const ovSub = byId('overlay-subtitle');
    const ovExtra = byId('overlay-extra');
    const ovResumeBtn = byId('overlay-btn-resume');
    const ovNextBtn = byId('overlay-btn-next');
    const ovReplayBtn = byId('overlay-btn-replay');
    const ovUndoBtn = byId('overlay-btn-undo');
    const ovRetryBtn = byId('overlay-btn-retry');
    if (!overlay || !ovTitle || !ovSub || !ovExtra || !ovNextBtn || !ovUndoBtn) return;

    const state = this.computeOverlayState();
    const lvl = this.engine.getLevel();

    if (state === 'complete') {
      const levels = ConfigRegistry.getLevels();
      const finalWin = this.isOnLastLevel() && this.isPackFullyCompleted(levels);
      setText(
        ovTitle,
        t(finalWin ? 'hud.messages.all_levels_won.label' : 'hud.messages.level_complete.label')
      );
      setText(ovSub, t('hud.messages.time_bonus.label', { bonus: this.engine.getLastTimeBonus() }));
      setText(
        ovExtra,
        t('hud.messages.level_score.label', {
          score: this.engine.getLastLevelScore(),
          medal: t(medalLabelKey(this.getMedalTierFor(this.engine.getTimeRemainingSeconds(), lvl.timeLimitSeconds)))
        })
      );
    } else if (state === 'dead') {
      const player = this.engine.getPlayer();
      setText(ovTitle, t('app.header.title.label'));
      setText(ovSub, player.deathReasonKey ? t(player.deathReasonKey) : '');
      setText(ovExtra, '');
    } else if (state === 'paused') {
      setText(ovTitle, t('hud.messages.paused.label'));
      setText(ovSub, t('hud.messages.press_resume.label'));
      setText(ovExtra, '');
    }

    overlay.classList.toggle('hidden', state === 'none');
    ovResumeBtn?.classList.toggle('hidden', state !== 'paused');
    ovNextBtn.classList.toggle('hidden', state !== 'complete');
    ovReplayBtn?.classList.toggle('hidden', state !== 'complete');
    ovUndoBtn.classList.toggle('hidden', !(state === 'dead' && this.engine.canUndo()));
    ovRetryBtn?.classList.toggle('hidden', state === 'none');

    if (state !== this.overlayState) {
      this.overlayState = state;
      if (state !== 'none' && this.activeMode === 'play' && !isDialogOpen()) {
        this.focusFirstOverlayAction(overlay);
      }
    }
  }

  private focusFirstOverlayAction(overlay: HTMLElement): void {
    const first = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.overlay-actions button')).find(
      (btn) => !btn.classList.contains('hidden')
    );
    first?.focus();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private recordHighScore(
    levelId: string,
    timeRemaining: number,
    steps: number,
    score: number,
    moves: Direction[],
    timedMoves: TimedMove[]
  ): void {
    const existing = this.highScores[levelId];
    const isBetterOrFirst = !existing || steps <= existing.minSteps || score >= existing.bestScore;
    this.highScores[levelId] = {
      bestTimeRemaining: existing ? Math.max(existing.bestTimeRemaining, timeRemaining) : timeRemaining,
      minSteps: existing ? Math.min(existing.minSteps, steps) : steps,
      bestScore: existing ? Math.max(existing.bestScore, score) : score,
      replayMoves: isBetterOrFirst ? moves : existing.replayMoves || moves,
      replayTimedMoves: isBetterOrFirst ? timedMoves : existing.replayTimedMoves || timedMoves
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
      const parsed = JSON.parse(raw) as Record<string, StoredHighScore>;
      if (parsed && typeof parsed === 'object') {
        for (const rec of Object.values(parsed)) {
          // Legacy records (untimed replayMoves only) keep their scores but
          // lose the replay button: untimed moves cannot replay faithfully.
          rec.replayTimedMoves = sanitizeTimedMoves(rec.replayTimedMoves);
        }
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
        shellEnabled: Boolean(byId('lynx-console')?.classList.contains('enabled')),
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
      const levelCount = ConfigRegistry.getLevels().length;
      // A pack can shrink between releases: a stale index restarts the pack.
      if (
        parsed.packId === ConfigRegistry.getActivePackId() &&
        typeof parsed.levelIndex === 'number' &&
        parsed.levelIndex >= 0 &&
        parsed.levelIndex < levelCount
      ) {
        this.currentLevelIndex = parsed.levelIndex;
      }
    } catch {
      // Ignore corrupt save
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new EpoxyApplication();
  app.init().catch((err: unknown) => {
    console.error('Initialization failed:', err);
    showFatalErrorScreen(err);
  });
});
