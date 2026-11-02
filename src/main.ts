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

import { ConfigBundle, ConfigRegistry } from './config/ConfigRegistry';
import { BUILTIN_PACK_IDS, DIRECTION_VECTORS, IMPORTED_PACK_RULESET } from './config/constants';
import { InvalidLevelError } from './config/ConfigValidation';
import { i18n, t } from './i18n/I18nManager';
import { GameEngine } from './core/GameEngine';
import { EngineSelector } from './core/EngineSelector';
import { PlayEngine } from './core/PlayEngine';
import { featuresFor } from './core/RulesetFeatures';
import { PixelRenderer } from './render/PixelRenderer';
import { AUTO_QUALITY_ID, parseQuality, QUALITY_LEVELS } from './render/renderSettings';
import { LevelEditor } from './editor/LevelEditor';
import { AudioManager } from './audio/AudioManager';
import { customIdsForStorage, isMusicMode, MUSIC_MODES } from './audio/musicSelection';
import { VOLUME_PERCENT_MAX, VOLUME_PERCENT_MIN, VOLUME_PERCENT_STEP } from './audio/volumeSettings';
import { DatCodec, datRefusalReason } from './formats/DatCodec';
import { decodeXsbCollection, XSB_EXTENSIONS } from './formats/XsbCodec';
import { BlockPuzzleSolver, requestedSearchBudget } from './core/BlockPuzzleSolver';
import { timedSolution } from './generator/SolutionReplay';
import { Pathfinder } from './core/Pathfinder';
import { ProceduralGenerator } from './core/ProceduralGenerator';
import {
  CompiledLevel,
  Direction,
  GraphicsStyle,
  GridPoint,
  KeybindingsConfig,
  LevelBlueprint,
  LevelPack,
  TimedMove,
  UserSettings,
  WinRule
} from './core/types';
import { confirmDialog } from './ui/confirmDialog';
import { closeDialog, isDialogOpen, openDialog } from './ui/dialog';
import { EndlessGenerator, EndlessWorkerLike } from './ui/endlessGenerator';
import {
  copyTextToClipboard,
  EndlessProgress,
  parseSeedInput,
  parseStartLevelInput,
  readStoredEndlessProgress,
  readStoredSeed,
  recordReachedLevel,
  SEED_MAX_VALUE,
  suggestStartLevel
} from './ui/proceduralPack';
import { downloadBytes } from './ui/download';
import { showFatalErrorScreen } from './ui/fatalErrorScreen';
import { InventorySlotView } from './ui/inventorySlots';
import { getMedalTier, medalIconKey, medalLabelKey, MedalTier } from './ui/medals';
import { preferredScrollBehavior, prefersReducedMotion, replayAnimation, watchReducedMotion } from './ui/motion';
import { getEditorChordAction, hasCommandModifier, isUndoChord } from './ui/inputGuards';
import { bindButtonPointerBlur, bindSelectPointerBlur } from './ui/focusHandoff';
import { setToggleState } from './ui/toggleState';
import { SokobanSkinLoader } from './render/sokobanSkin';
import {
  buildGraphicsStyleOptions,
  canvasClassesToRemove,
  isLcdAvailable,
  resolveInitialGraphicsStyle
} from './ui/graphicsStyleControl';
import { getRenderStyle, parseRenderStyleId } from './render/styles/renderStyles';
import { resolveSokobanSkin } from './render/renderSettings';
import { PLAYER_SKIN_IDS, parsePlayerSkin, playerSkinLabelKey } from './render/playerSkin';
import { watchDevicePixelRatio } from './ui/displayWatchers';
import { collectDueMoves } from './ui/replaySchedule';
import { formatMegabytes, isImportSizeAllowed } from './ui/importLimits';
import {
  parseGraphicsStyle,
  resolveSavedLevelIndex,
  sanitizeHighScores,
  StoredHighScore
} from './storage/persistedState';
import { lossyExportNotice } from './ui/exportNotice';
import {
  hasStoredSolution,
  isSokobanSkinApplicable,
  isTimedLevel,
  combineStatusMessages,
  objectiveMessageKey,
  receiversProgress,
  shouldAnnounceObjective,
  showsReceiversCounter,
  showsTargetsCounter,
  stuckMessageKey
} from './ui/levelFeedback';
import { shouldShowOnboarding } from './ui/onboarding';
import { packUsesPasswords } from './ui/packPasswords';
import { getViewportPresets } from './ui/viewportZoom';
import {
  BIOME_ACCENT_CSS_VAR,
  CANVAS_RESIZE_TOLERANCE_PX,
  AUTO_THEME_ID,
  DRAWER_ADVANCED_CLOSED_VALUE,
  DRAWER_ADVANCED_OPEN_VALUE,
  DRAWER_ADVANCED_STORAGE_SUFFIX,
  DEFAULT_THEME_ID,
  GAMEPAD_AXIS_THRESHOLD,
  GAMEPAD_AXIS_X,
  GAMEPAD_AXIS_Y,
  GAMEPAD_BUTTONS,
  GAMEPAD_INDEX,
  HUD_BUMP_CLASS,
  HUD_COUNTER_DIGITS,
  INFINITE_KEY_IDS,
  MAX_DEVICE_PIXEL_RATIO,
  MIN_VIEWPORT_SYNC_PX,
  SWIPE_ANCHOR_FOLLOW_RATIO,
  TIMING_DEFAULTS,
  TOAST_DURATION_MS,
  TOUCH_DEFAULTS
} from './ui/uiConstants';

type OverlayState = 'none' | 'complete' | 'dead' | 'paused';
type ScoresFilter = 'all' | 'unsolved' | 'completed';

/** Displacement that marks a two-finger gesture so it never ends as a tap. */
const MULTI_TOUCH_SUPPRESSES_TAP = Number.POSITIVE_INFINITY;
const NO_WARNED_SECOND = -1;
/** Value stored once the first-launch dialog was shown. */
const ONBOARDING_SEEN_VALUE = '1';
/** Where the seen flag lives, most durable first. */
const ONBOARDING_STORES: ReadonlyArray<() => Storage> = [() => localStorage, () => sessionStorage];
/** The Play and Editor mode buttons: the header ones and their drawer copies. */
const PLAY_MODE_BUTTON_IDS = ['btn-mode-play', 'btn-drawer-mode-play'] as const;
const EDITOR_MODE_BUTTON_IDS = ['btn-mode-editor', 'btn-drawer-mode-editor'] as const;
/** Id prefixes of the procedural seed boxes: the header one and its drawer copy. */
const SEED_BOX_ID_PREFIXES = ['procedural', 'drawer'] as const;
const SEED_COPY_BUTTON_IDS: Record<(typeof SEED_BOX_ID_PREFIXES)[number], string> = {
  procedural: 'btn-copy-seed',
  drawer: 'btn-drawer-copy-seed'
};
/** Controls that only make sense in a pack with real level codes. */
const PASSWORD_CONTROL_IDS = ['hud-password-badge'] as const;

const MODAL_IDS = {
  SCORES: 'scores-modal',
  HELP: 'help-modal',
  PASSWORD: 'password-modal',
  PROCEDURAL: 'procedural-modal',
  ONBOARDING: 'onboarding-modal'
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
  /** Holds the engine of each ruleset; a level is played by the one its ruleset asks for. */
  private readonly engineSelector = new EngineSelector();
  private renderer: PixelRenderer = new PixelRenderer();
  private editor!: LevelEditor;

  /** The engine of the level on screen. */
  private get engine(): PlayEngine {
    return this.engineSelector.current;
  }

  private gameCanvas!: HTMLCanvasElement;
  private gameCtx!: CanvasRenderingContext2D;
  private currentLevelIndex: number = 0;
  private activeMode: 'play' | 'editor' = 'play';
  private heldDirection: Direction | null = null;
  private highScores: Record<string, StoredHighScore> = {};
  private prevGamepadButtons: boolean[] = [];
  /** The direction the gamepad holds now; a change to a new direction is a press. */
  private gamepadDirection: Direction | null = null;
  private customStatusMessage: string | null = null;
  private customStatusTimeout: number | null = null;
  private autoMoveQueue: Direction[] = [];
  private autoMovePoints: GridPoint[] = [];
  private replayMoves: TimedMove[] = [];
  private replayIndex: number = 0;
  private isReplaying: boolean = false;
  private lastWarnedSecond: number = NO_WARNED_SECOND;
  /** Chip counter last shown, to pop the HUD counter when a chip is picked up. */
  private hudChipsLeft: number = 0;
  private hudChipsLevelId: string = '';
  /** The "How to play" dialog was shown this session (storage can be unavailable). */
  private onboardingShownThisSession = false;
  private scoresFilterMode: ScoresFilter = 'all';
  private scoresSearchQuery: string = '';
  private overlayState: OverlayState = 'none';
  /** Engine level the editor content was last synced with. */
  private editorSourceLevel: CompiledLevel | null = null;
  private generatingPack = false;
  /** Seed of the procedural pack currently loaded, null before any generation. */
  private proceduralSeed: number | null = null;
  /** Last seed used this session, mirrored to localStorage. */
  private lastProceduralSeed: number | null = null;
  /** Levels generated so far for the endless run, in play order; the procedural pack grows with it. */
  private endlessLevels: CompiledLevel[] = [];
  /** Seed and highest level reached of the last endless run, mirrored to localStorage. */
  private endlessProgress: EndlessProgress | null = null;
  private endlessGenerator: EndlessGenerator | null = null;
  /** Bumped by every new run so late answers of an earlier run are dropped. */
  private endlessRun = 0;
  /** Number of the level being prefetched, null when none is. */
  private endlessFetching: number | null = null;
  /** The player asked for a level that is not built yet and waits for it. */
  private endlessWaiting = false;
  /** The player edited the start level field by hand, so a seed change no longer overwrites it. */
  private startLevelTouched = false;
  /** The theme follows each level instead of the player's pick. */
  private autoTheme = true;
  /** Block positions last checked for a dead end. */
  private lastBlockLayout = '';

  private keyIconCache: Record<string, string> = {};
  private bootIconCache: Record<string, string> = {};
  private keySlots: InventorySlotView[] = [];
  private bootSlots: InventorySlotView[] = [];
  private inventoryLabels: Record<string, string> = {};
  private inventoryLabelsLocale: string = '';

  private readonly keyIds = ['key_red', 'key_blue', 'key_yellow', 'key_green'];
  private readonly bootIds = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'];
  /** Held item the drop key puts down; null until the player holds something. */
  private selectedItemId: string | null = null;

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
    this.setupMusicControls();
    this.setupThemeSelector();
    this.setupQualitySelector();
    this.setupPlayerSkinSelector();
    this.setupGraphicsStyleSelector();
    this.bindViewportResizeObserver();

    this.rebuildHudIcons();
    this.buildInventorySlots();

    this.loadHighScores();
    this.bindEngineCallbacks();
    this.createEditor(editorCanvas);

    this.refreshPackSelector();
    // Read before the first level starts: starting a level writes the save slot.
    const hadSavedProgress = this.hasSavedProgress();
    this.restoreSavedProgress();
    this.startLevelByIndex(this.currentLevelIndex);

    this.bindUIEvents();
    this.bindTouchGestures();
    this.bindDragAndDrop();
    this.bindKeyboardEvents();
    this.bindFocusHandoff();
    i18n.translateDOM();

    i18n.onChange(() => {
      this.refreshPackSelector();
      this.setupThemeSelector();
      this.setupQualitySelector();
      this.setupPlayerSkinSelector();
      this.setupGraphicsStyleSelector();
      this.setupMusicControls();
      this.syncSoundControls();
      this.updateHUD();
      this.editor.refreshTranslations();
      // translateDOM resets the seed placeholder to its generic text.
      const seedInput = byId<HTMLInputElement>('procedural-seed-input');
      if (seedInput && this.lastProceduralSeed !== null) seedInput.placeholder = this.proceduralSeedPlaceholder();
    });

    this.startGameLoop();
    this.startRenderLoop();
    this.maybeShowOnboarding(hadSavedProgress);
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

    const defaultStyle = resolveInitialGraphicsStyle(savedSettings.graphicsStyle, gameCfg.graphics?.defaultStyle);
    this.renderer.setStyle(defaultStyle);

    // Each level shows its own theme unless the player picked one.
    this.autoTheme = !savedSettings.themeId || savedSettings.themeId === AUTO_THEME_ID;
    const initialTheme =
      !this.autoTheme && savedSettings.themeId && gameCfg.themes?.[savedSettings.themeId]
        ? savedSettings.themeId
        : gameCfg.graphics?.defaultTheme || DEFAULT_THEME_ID;
    this.renderer.setThemeId(initialTheme);
    this.renderer.setLcdEnabled(Boolean(savedSettings.lcdEnabled));
    this.renderer.setSokobanSkinEnabled(savedSettings.sokobanSkinEnabled !== false);
    this.renderer.setPlayerSkin(parsePlayerSkin(savedSettings.playerSkin));
    // No level is loaded yet: the toggle stays hidden until the first level starts.
    this.syncSokobanSkinControl(undefined);
    const skinLoader = new SokobanSkinLoader(resolveSokobanSkin(gameCfg.graphics));
    this.renderer.setSkinLoader(skinLoader);
    void skinLoader.load();
    this.syncGraphicsControls(defaultStyle);
    this.renderer.setReducedMotion(prefersReducedMotion());
    // The preference can change while the page is open.
    watchReducedMotion((reduced) => this.renderer.setReducedMotion(reduced));
    this.renderer.setQuality(parseQuality(savedSettings.graphicsQuality));
    this.renderer.setOnQualityLowered((quality) => {
      this.showTransientStatus(
        t('hud.messages.quality_lowered.label', { quality: t(`app.graphics_quality.${quality}.label`) })
      );
    });
    this.syncThemeAccent();

    this.setupFovSelector(presets, initialFov);
  }

  private applyAudioSettings(savedSettings: UserSettings): void {
    if (typeof savedSettings.sfxEnabled === 'boolean') {
      AudioManager.setSfxEnabled(savedSettings.sfxEnabled);
    }
    // Invalid stored values are replaced in memory only; saveUserSettings writes from this state.
    AudioManager.setSfxVolumePercent(savedSettings.sfxVolumePercent);
    AudioManager.setMusicVolumePercent(savedSettings.musicVolumePercent);
    AudioManager.configureMusic(savedSettings.musicMode, savedSettings.musicCustomTracks);
    AudioManager.setThemeTrack(this.currentThemeTrackId());
    if (typeof savedSettings.musicEnabled === 'boolean') {
      AudioManager.setMusicEnabled(savedSettings.musicEnabled);
    }
    this.syncSoundControls();
  }

  /**
   * Brings the sound toggles in line with the audio state: the .active class and aria-pressed
   * through setToggleState, the on/off wording in the label, and the music mode row, which
   * only matters while the music plays.
   */
  private syncSoundControls(): void {
    const sfxBtn = byId('btn-sfx-toggle');
    const sfxOn = AudioManager.isSfxEnabled();
    setToggleState(sfxBtn, sfxOn);
    if (sfxBtn) {
      sfxBtn.textContent = sfxOn ? t('app.header.audio_toggle.action_on') : t('app.header.audio_toggle.action_off');
    }
    const musicBtn = byId('btn-music-toggle');
    const musicOn = AudioManager.isMusicEnabled();
    setToggleState(musicBtn, musicOn);
    if (musicBtn) {
      musicBtn.textContent = musicOn ? t('app.header.music_toggle.action_on') : t('app.header.music_toggle.action_off');
    }
    byId('music-mode-row')?.classList.toggle('hidden', !musicOn);
    this.syncVolumeRow('sfx', sfxOn, AudioManager.getSfxVolumePercent());
    this.syncVolumeRow('music', musicOn, AudioManager.getMusicVolumePercent());
  }

  /** Shows a volume slider only while its toggle is on, and brings its value, text and aria-valuetext up to date. */
  private syncVolumeRow(kind: 'sfx' | 'music', visible: boolean, percent: number): void {
    byId(`${kind}-volume-row`)?.classList.toggle('hidden', !visible);
    const slider = byId<HTMLInputElement>(`${kind}-volume-slider`);
    if (slider) {
      slider.min = String(VOLUME_PERCENT_MIN);
      slider.max = String(VOLUME_PERCENT_MAX);
      slider.step = String(VOLUME_PERCENT_STEP);
      slider.value = String(percent);
    }
    this.showVolumeText(kind, percent);
  }

  private showVolumeText(kind: 'sfx' | 'music', percent: number): void {
    const text = t('app.header.volume_value.label', { percent });
    const output = byId(`${kind}-volume-output`);
    if (output) output.textContent = text;
    byId<HTMLInputElement>(`${kind}-volume-slider`)?.setAttribute('aria-valuetext', text);
  }

  private bindEngineCallbacks(): void {
    this.engineSelector.setOnWinCallback((levelId, timeRemaining, steps, score) => {
      if (!this.isReplaying) {
        this.recordHighScore(levelId, timeRemaining, steps, score, this.engine.getTimedMoveHistory());
      }
      this.stopAutoMoveAndReplay();
    });
    this.engineSelector.setOnVisualEventCallback((kind, x, y, colorKey) => {
      this.renderer.triggerVisualEvent(kind, x, y, colorKey);
    });
  }

  private createEditor(editorCanvas: HTMLCanvasElement): void {
    this.editor = new LevelEditor(
      editorCanvas,
      this.renderer,
      (testLevel: CompiledLevel) => {
        this.cancelEndlessPrefetch();
        this.switchMode('play');
        this.stopAutoMoveAndReplay();
        this.lastWarnedSecond = NO_WARNED_SECOND;
        this.loadPlayLevel(testLevel);
        AudioManager.onLevelLoaded(testLevel.id);
        this.showLevelTheme(testLevel);
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
    // A modal or the drawer owns the keyboard: skip the tick, the game is not paused.
    if (isDialogOpen()) {
      this.refreshGamepadSnapshot();
      return;
    }
    if (this.activeMode !== 'play') return;
    this.pollGamepad();
    // An engine that tells presses from holds hears the held direction (or its release) once per tick.
    this.engine.holdPlayerDirection?.(this.isReplaying ? null : (this.heldDirection ?? this.gamepadDirection));
    if (this.isReplaying) {
      this.advanceReplay();
    } else if (this.heldDirection) {
      this.clearAutoMove();
      // An engine without holds is told again every tick, as it always was.
      if (!this.engine.holdPlayerDirection) this.engine.attemptPlayerMove(this.heldDirection);
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
    this.watchBlockPuzzles();
  }

  /**
   * After blocks move, checks off the main loop whether the block puzzles
   * have become a dead end, and says so once per layout. The check only
   * speaks when the dead end is proven.
   */
  private watchBlockPuzzles(): void {
    if (this.isReplaying) return;
    const engine = this.epoxyEngine();
    if (!engine || !featuresFor(engine.getLevel()).deadEndWatch) return;
    // The exact search runs on the main thread: a large level is left to the hint button.
    const terrain = engine.getTerrain();
    const cells = terrain.length * (terrain[0]?.length ?? 0);
    if (cells > ConfigRegistry.getGame().blockPuzzle.watchMaxCells) return;
    // Only blocks matter; monsters move every few ticks.
    const layout = engine
      .getEntities()
      .filter((e) => e.kind === 'block')
      .map((e) => `${e.x},${e.y}`)
      .join(';');
    if (layout === this.lastBlockLayout) return;
    this.lastBlockLayout = layout;
    window.setTimeout(() => {
      if (layout !== this.lastBlockLayout || !engine.getPlayer().alive) return;
      if (BlockPuzzleSolver.isStuck(engine)) {
        this.showTransientStatus(t(stuckMessageKey(engine.getLevel().winRule)));
      }
    }, 0);
  }

  /** Applies every recorded move due at the current engine tick; failed moves are skipped. */
  private advanceReplay(): void {
    const { due, nextIndex } = collectDueMoves(this.replayMoves, this.replayIndex, this.engine.getTick());
    for (const move of due) {
      if (move.drop) {
        this.engine.dropItem(move.drop);
      } else {
        this.engine.attemptPlayerMove(move.dir);
      }
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
    // Browser zoom or another screen changes the pixel ratio without resizing the box.
    watchDevicePixelRatio(syncCanvasSize);
  }

  // ---------------------------------------------------------------------------
  // Packs, import and export
  // ---------------------------------------------------------------------------

  private getPackDisplayName(pack: LevelPack): string {
    return pack.i18nKey ? t(pack.i18nKey) : pack.name;
  }

  /** Display name of the pack being played. */
  private activePackName(): string {
    const activeId = ConfigRegistry.getActivePackId();
    const pack = ConfigRegistry.getAllPacks().find((p) => p.id === activeId);
    return pack ? this.getPackDisplayName(pack) : activeId;
  }

  /** Every pack select (header and drawer) carries data-pack-select and is filled here. */
  private packSelects(): HTMLSelectElement[] {
    return Array.from(document.querySelectorAll<HTMLSelectElement>('select[data-pack-select]'));
  }

  private refreshPackSelector(): void {
    const activeId = ConfigRegistry.getActivePackId();
    for (const select of this.packSelects()) {
      select.innerHTML = '';
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
    this.updateProceduralSeedBox();
  }

  /** Switches to a pack from any pack select, keeps the others in step and closes the drawer. */
  private choosePack(packId: string): void {
    ConfigRegistry.setActivePackId(packId);
    for (const select of this.packSelects()) {
      select.value = packId;
    }
    this.updateProceduralSeedBox();
    this.editor.populatePresetDropdown();
    this.startLevelByIndex(0);
    this.setDrawerOpen(false);
  }

  private async handleImportedFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    const packName = file.name.replace(/\.[^.]+$/, '');

    const maxBytes = ConfigRegistry.getGame().import.maxFileBytes;
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      this.showTransientStatus(t('app.packs.import_too_large.label', { max: formatMegabytes(maxBytes) }));
      return;
    }

    try {
      let levels: CompiledLevel[];
      let skippedCount = 0;
      if (lower.endsWith('.dat') || lower.endsWith('.ccl')) {
        levels = DatCodec.decodeBuffer(await file.arrayBuffer(), packName, IMPORTED_PACK_RULESET);
        if (levels.length === 0) {
          throw new Error('Empty pack');
        }
      } else if (lower.endsWith('.json')) {
        levels = this.compileJsonLevels(JSON.parse(await file.text()));
      } else if (XSB_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        const decoded = decodeXsbCollection(await file.text(), packName);
        levels = decoded.levels;
        skippedCount = decoded.skipped.length;
        if (levels.length === 0) {
          throw new Error('Empty pack');
        }
      } else {
        this.showTransientStatus(this.importErrorMessage());
        return;
      }
      const { persisted } = await ConfigRegistry.registerImportedPack(packName, levels);
      this.refreshPackSelector();
      this.editor.populatePresetDropdown();
      this.switchMode('play');
      this.startLevelByIndex(0, false);
      const importedKey =
        skippedCount > 0 ? 'app.packs.imported_skipped_toast.label' : 'app.packs.imported_toast.label';
      this.showTransientStatus(
        combineStatusMessages(
          persisted
            ? t(importedKey, { name: packName, count: levels.length, skipped: skippedCount })
            : t('app.packs.imported_session_only_toast.label', { name: packName }),
          this.objectiveMessage()
        )
      );
    } catch (err) {
      this.showTransientStatus(
        err instanceof InvalidLevelError
          ? t('app.packs.invalid_level_error.label', { id: err.levelId })
          : this.importErrorMessage()
      );
    }
  }

  /** Import failure in player terms, followed by the accepted file types. */
  private importErrorMessage(): string {
    return combineStatusMessages(t('app.packs.import_error.label'), t('app.packs.import_formats.label'));
  }

  /** Objective of the level on screen, or null when it needs no announcement. */
  private objectiveMessage(): string | null {
    const key = objectiveMessageKey(this.engine.getLevel().winRule);
    return key && shouldAnnounceObjective(this.engine.getLevel().winRule) ? t(key) : null;
  }

  /** Compiles every level of a JSON import; throws before anything is registered. */
  private compileJsonLevels(parsed: unknown): CompiledLevel[] {
    const container = parsed as { levels?: unknown };
    const rawList = (
      Array.isArray(parsed) ? parsed : Array.isArray(container?.levels) ? container.levels : [parsed]
    ) as LevelBlueprint[];
    return rawList.map((item) => ConfigRegistry.compileBlueprint(item));
  }

  private loadLastProceduralSeed(): number | null {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.lastProceduralSeedKey);
      return readStoredSeed(localStorage.getItem(key));
    } catch {
      // Storage blocked: the in-memory value still works for this session.
      return null;
    }
  }

  private rememberProceduralSeed(seed: number): void {
    this.lastProceduralSeed = seed;
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.lastProceduralSeedKey);
      localStorage.setItem(key, String(seed));
    } catch {
      // Storage blocked: keep the in-memory value only.
    }
  }

  /** Seed field placeholder: mentions the last seed used when there is one. */
  private proceduralSeedPlaceholder(): string {
    return this.lastProceduralSeed === null
      ? t('app.packs.procedural_dialog.seed_placeholder.label')
      : t('app.packs.procedural_dialog.seed_placeholder_last.label', { seed: this.lastProceduralSeed });
  }

  private loadEndlessProgress(): EndlessProgress | null {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.lastEndlessKey);
      return readStoredEndlessProgress(localStorage.getItem(key));
    } catch {
      // Storage blocked: no run to resume.
      return null;
    }
  }

  private saveEndlessProgress(progress: EndlessProgress): void {
    this.endlessProgress = progress;
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.lastEndlessKey);
      localStorage.setItem(key, JSON.stringify(progress));
    } catch {
      // Storage blocked: keep the in-memory value only.
    }
  }

  /** Highest start level the endless dialog accepts (validated when the configs are installed). */
  private endlessMaxStartLevel(): number {
    return ConfigRegistry.getGame().endlessUi.maxStartLevel;
  }

  /** Opens the endless dialog: the last run proposed again (seed and reached level), or random from level 1. */
  private openProceduralModal(): void {
    if (this.generatingPack) return;
    const seedInput = byId<HTMLInputElement>('procedural-seed-input');
    const startInput = byId<HTMLInputElement>('procedural-start-input');
    this.lastProceduralSeed ??= this.loadLastProceduralSeed();
    this.endlessProgress ??= this.loadEndlessProgress();
    this.startLevelTouched = false;
    if (seedInput) {
      seedInput.value = this.endlessProgress ? String(this.endlessProgress.seed) : '';
      seedInput.setAttribute('aria-invalid', 'false');
      seedInput.placeholder = this.proceduralSeedPlaceholder();
    }
    byId('procedural-seed-error')?.classList.add('hidden');
    byId('procedural-start-error')?.classList.add('hidden');
    startInput?.setAttribute('aria-invalid', 'false');
    const maxStartLevel = this.endlessMaxStartLevel();
    const startHint = byId('procedural-start-hint');
    if (startHint) startHint.textContent = t('app.packs.procedural_dialog.start_level_hint.label', { max: maxStartLevel });
    if (startInput) {
      startInput.max = String(maxStartLevel);
      startInput.value = String(suggestStartLevel(this.endlessProgress, seedInput?.value ?? '', maxStartLevel));
    }
    this.openModal(MODAL_IDS.PROCEDURAL, seedInput);
  }

  /** Validates the dialog, then generates; an invalid seed or level keeps the dialog open. */
  private submitProceduralModal(): void {
    const seedInput = byId<HTMLInputElement>('procedural-seed-input');
    const startInput = byId<HTMLInputElement>('procedural-start-input');
    const errorEl = byId('procedural-seed-error');
    const startErrorEl = byId('procedural-start-error');
    const parsed = parseSeedInput(seedInput?.value ?? '');
    const startLevel = parseStartLevelInput(startInput?.value ?? '', this.endlessMaxStartLevel());
    errorEl?.classList.toggle('hidden', parsed.valid);
    startErrorEl?.classList.toggle('hidden', startLevel.valid);
    seedInput?.setAttribute('aria-invalid', String(!parsed.valid));
    startInput?.setAttribute('aria-invalid', String(!startLevel.valid));
    if (!startLevel.valid && startErrorEl) {
      startErrorEl.textContent = t('app.packs.procedural_dialog.start_level_invalid.label', { max: this.endlessMaxStartLevel() });
    }
    if (!parsed.valid) {
      if (errorEl) errorEl.textContent = t('app.packs.procedural_dialog.seed_invalid.label', { max: SEED_MAX_VALUE });
      seedInput?.focus();
      return;
    }
    if (!startLevel.valid) {
      startInput?.focus();
      return;
    }
    this.closeModal(MODAL_IDS.PROCEDURAL);
    void this.startEndlessRun(parsed.seed ?? ProceduralGenerator.createSeed(), startLevel.level);
  }

  private getEndlessGenerator(): EndlessGenerator {
    this.endlessGenerator ??= new EndlessGenerator({
      createWorker:
        typeof Worker === 'undefined'
          ? null
          : () =>
              new Worker(new URL('./workers/generator.worker.ts', import.meta.url), {
                type: 'module'
              }) as unknown as EndlessWorkerLike,
      getBundle: () => this.captureConfigBundle(),
      generateLocal: (seed, levelNumber) => ProceduralGenerator.generateEndlessLevel(levelNumber, seed).level,
      yieldToUi: () =>
        new Promise<void>((resolve) =>
          setTimeout(resolve, ConfigRegistry.getGame().endlessUi?.fallbackYieldMs ?? 0)
        )
    });
    return this.endlessGenerator;
  }

  /**
   * The configs the page loaded, for the generator worker. The campaign
   * blueprints are left out (the generator never reads them); the merged piece
   * legend stands in for the levels legend.
   */
  private captureConfigBundle(): ConfigBundle {
    return {
      game: ConfigRegistry.getGame(),
      tiles: ConfigRegistry.getTiles(),
      monsters: ConfigRegistry.getMonsters(),
      audio: ConfigRegistry.getAudio(),
      levels: { legend: ConfigRegistry.getPieceLegend(), levels: [] },
      datFormat: ConfigRegistry.getDatFormat(),
      motifs: ConfigRegistry.getMotifs(),
      motifAnnotations: ConfigRegistry.getMotifAnnotations()
    };
  }

  /** True while the endless run is the pack being played. */
  private isEndlessActive(): boolean {
    return (
      this.proceduralSeed !== null &&
      this.endlessLevels.length > 0 &&
      ConfigRegistry.getActivePackId() === BUILTIN_PACK_IDS.PROCEDURAL
    );
  }

  /** Cancels any pending endless level prefetch or waiting state. */
  private cancelEndlessPrefetch(): void {
    this.endlessRun++;
    this.endlessFetching = null;
    this.endlessWaiting = false;
    if (this.endlessGenerator?.hasPending()) this.endlessGenerator.reset();
  }

  /** Builds only the start level, plays it, and prefetches the next ones as the player advances. */
  private async startEndlessRun(seed: number, startLevel: number): Promise<void> {
    if (this.generatingPack) return;
    this.generatingPack = true;
    // Prefetches of the run being left would keep the worker busy: drop them.
    this.cancelEndlessPrefetch();
    const run = this.endlessRun;
    this.showTransientStatus(t('app.packs.procedural_progress.label', { level: startLevel }));
    const generator = this.getEndlessGenerator();
    let first: CompiledLevel;
    try {
      first = await generator.request(seed, startLevel);
    } catch (err) {
      // A run left on purpose (editor test, level picker) rejects its pending request: not an error.
      if (run !== this.endlessRun) return;
      console.error('Endless generation failed:', err);
      this.showTransientStatus(t('app.packs.procedural_error.label'));
      return;
    } finally {
      this.generatingPack = false;
    }
    if (run !== this.endlessRun) return;
    this.proceduralSeed = seed;
    this.rememberProceduralSeed(seed);
    this.endlessLevels = [first];
    ConfigRegistry.setProceduralLevels(this.endlessLevels);
    this.refreshPackSelector();
    this.editor.populatePresetDropdown();
    this.switchMode('play');
    this.startLevelByIndex(0);
    this.showTransientStatus(t('app.packs.procedural_toast.label', { seed, level: startLevel }));
  }

  /** Requests the level after the last built one, once the player stands on that last level. */
  private prefetchNextEndlessLevel(): void {
    if (!this.isEndlessActive() || this.proceduralSeed === null) return;
    if (this.currentLevelIndex !== this.endlessLevels.length - 1) return;
    const levelNumber = this.endlessLevels[this.endlessLevels.length - 1].number + 1;
    if (this.endlessFetching === levelNumber) return;
    this.endlessFetching = levelNumber;
    const run = this.endlessRun;
    this.getEndlessGenerator()
      .request(this.proceduralSeed, levelNumber)
      .then(
        (level) => {
          if (run !== this.endlessRun) return;
          this.endlessFetching = null;
          this.appendEndlessLevel(level);
        },
        (err: unknown) => {
          if (run !== this.endlessRun) return;
          console.error('Endless prefetch failed:', err);
          this.endlessFetching = null;
          if (this.endlessWaiting) {
            this.endlessWaiting = false;
            this.showTransientStatus(t('app.packs.procedural_error.label'));
          }
        }
      );
  }

  /** Adds a prefetched level to the pack without changing which pack is active. */
  private appendEndlessLevel(level: CompiledLevel): void {
    this.endlessLevels = [...this.endlessLevels, level];
    const activePackId = ConfigRegistry.getActivePackId();
    ConfigRegistry.setProceduralLevels(this.endlessLevels);
    if (activePackId !== BUILTIN_PACK_IDS.PROCEDURAL) ConfigRegistry.setActivePackId(activePackId);
    this.refreshPackSelector();
    if (this.endlessWaiting && this.isEndlessActive() && this.currentLevelIndex === this.endlessLevels.length - 2) {
      this.startLevelByIndex(this.currentLevelIndex + 1);
    }
  }

  /** The player reached the end of what is built: wait for the prefetched level, with a progress message. */
  private waitForNextEndlessLevel(): void {
    const nextNumber = this.endlessLevels[this.endlessLevels.length - 1].number + 1;
    this.endlessWaiting = true;
    this.showTransientStatus(t('app.packs.procedural_progress.label', { level: nextNumber }));
    this.prefetchNextEndlessLevel();
  }

  /** Keeps the resume point: highest level number reached in this endless run. */
  private noteEndlessLevelReached(level: CompiledLevel): void {
    if (!this.isEndlessActive() || this.proceduralSeed === null) return;
    const next = recordReachedLevel(this.endlessProgress, this.proceduralSeed, level.number);
    if (next.seed !== this.endlessProgress?.seed || next.reachedLevel !== this.endlessProgress.reachedLevel) {
      this.saveEndlessProgress(next);
    }
  }

  /** Shows the seed and its copy button only while the procedural pack is the active one. */
  private updateProceduralSeedBox(): void {
    const seed = this.proceduralSeed;
    const visible = seed !== null && ConfigRegistry.getActivePackId() === BUILTIN_PACK_IDS.PROCEDURAL;
    // The header box and its drawer copy (reachable on phones and in fullscreen) show the same seed.
    for (const prefix of SEED_BOX_ID_PREFIXES) {
      const box = byId(`${prefix}-seed-box`);
      box?.classList.toggle('hidden', !visible);
      if (!visible) continue;
      const label = byId(`${prefix}-seed-label`);
      if (label) label.textContent = t('app.packs.procedural_seed.label', { seed });
      byId(SEED_COPY_BUTTON_IDS[prefix])?.setAttribute(
        'aria-label',
        t('app.packs.procedural_seed_copy_aria.label', { seed })
      );
    }
  }

  private async copyProceduralSeed(): Promise<void> {
    if (this.proceduralSeed === null) return;
    const seed = this.proceduralSeed;
    const copied = await copyTextToClipboard(String(seed));
    this.showTransientStatus(
      t(copied ? 'app.packs.procedural_seed_copied.label' : 'app.packs.procedural_seed_copy_failed.label', { seed })
    );
  }

  private exportActivePack(): void {
    const encoded = DatCodec.encodeLevelsWithReport(ConfigRegistry.getLevels());
    if (encoded.levelCount > 0) {
      downloadBytes(encoded.bytes, `${ConfigRegistry.getActivePackId()}.ccl`);
    }
    const notice = lossyExportNotice(encoded);
    if (notice) this.showTransientStatus(notice);
  }

  private isRemovablePack(packId: string): boolean {
    return packId !== BUILTIN_PACK_IDS.CAMPAIGN && packId !== BUILTIN_PACK_IDS.CUSTOM;
  }

  private async deleteActivePack(): Promise<void> {
    const activeId = ConfigRegistry.getActivePackId();
    if (!this.isRemovablePack(activeId)) return;
    const pack = ConfigRegistry.getAllPacks().find((p) => p.id === activeId);
    const name = pack ? this.getPackDisplayName(pack) : activeId;
    const confirmed = await confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('app.packs.delete_confirm.label', { name }),
      confirmLabel: t('app.confirm.delete.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
    if (!confirmed) return;

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
    const engine = this.epoxyEngine();
    if (!engine || !featuresFor(engine.getLevel()).tapToPath) return;
    const result = Pathfinder.findPath(engine, gridPt.x, gridPt.y);
    this.autoMoveQueue = result.moves;
    this.autoMovePoints = result.points;
    this.renderer.setPlannedPath(this.autoMovePoints);
  }

  private bindTouchGestures(): void {
    const touchCfg = { ...TOUCH_DEFAULTS, ...ConfigRegistry.getGame().touch };
    const swipeDeadzone = touchCfg.swipeDeadzonePx;
    const tapMaxDist = touchCfg.tapMaxDistancePx;
    const tapMaxDuration = touchCfg.tapMaxDurationMs;
    const anchorTrail = swipeDeadzone * SWIPE_ANCHOR_FOLLOW_RATIO;

    let anchorX = 0;
    let anchorY = 0;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let maxDisplacement = 0;

    this.gameCanvas.addEventListener(
      'touchstart',
      (e) => {
        if (this.activeMode !== 'play') return;
        if (e.touches.length === 2) {
          e.preventDefault();
          this.heldDirection = null;
          maxDisplacement = MULTI_TOUCH_SUPPRESSES_TAP;
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

  /**
   * An engine that tells presses from holds gets a press when the pad turns
   * to a new direction and the hold through runGameTick; any other engine is
   * sent the direction every tick, as it always was.
   */
  private steerWithGamepad(direction: Direction | null): void {
    if (this.engine.holdPlayerDirection) {
      if (direction !== null && direction !== this.gamepadDirection) this.engine.attemptPlayerMove(direction);
      this.gamepadDirection = direction;
    } else if (direction !== null) {
      this.engine.attemptPlayerMove(direction);
    }
  }

  /** Records the held buttons without acting, so a hold across a dialog close is not a new press. */
  private refreshGamepadSnapshot(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pad = navigator.getGamepads()[GAMEPAD_INDEX];
    if (pad) this.prevGamepadButtons = pad.buttons.map((b) => b.pressed);
  }

  private pollGamepad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pad = navigator.getGamepads()[GAMEPAD_INDEX];
    if (!pad) {
      this.gamepadDirection = null;
      return;
    }

    const axX = pad.axes[GAMEPAD_AXIS_X] || 0;
    const axY = pad.axes[GAMEPAD_AXIS_Y] || 0;
    const pressed = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);
    const justPressed = (idx: number): boolean => pressed(idx) && !this.prevGamepadButtons[idx];

    let padDirection: Direction | null = null;
    if (pressed(GAMEPAD_BUTTONS.DPAD_UP) || axY < -GAMEPAD_AXIS_THRESHOLD) {
      padDirection = 'N';
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_DOWN) || axY > GAMEPAD_AXIS_THRESHOLD) {
      padDirection = 'S';
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_LEFT) || axX < -GAMEPAD_AXIS_THRESHOLD) {
      padDirection = 'W';
    } else if (pressed(GAMEPAD_BUTTONS.DPAD_RIGHT) || axX > GAMEPAD_AXIS_THRESHOLD) {
      padDirection = 'E';
    }
    this.steerWithGamepad(padDirection);

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

  private setupThemeSelector(): void {
    const select = byId<HTMLSelectElement>('theme-select');
    const themes = ConfigRegistry.getGame().themes;
    if (!select || !themes) return;
    select.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = AUTO_THEME_ID;
    auto.textContent = t('app.themes.auto.label');
    auto.selected = this.autoTheme;
    select.appendChild(auto);
    for (const theme of Object.values(themes)) {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = t(theme.i18nKey);
      if (!this.autoTheme && theme.id === this.renderer.getThemeId()) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    select.onchange = () => {
      this.applyTheme(select.value);
    };
  }

  private setupQualitySelector(): void {
    const select = byId<HTMLSelectElement>('quality-select');
    if (!select) return;
    select.innerHTML = '';
    for (const quality of [AUTO_QUALITY_ID, ...QUALITY_LEVELS]) {
      const opt = document.createElement('option');
      opt.value = quality;
      opt.textContent = t(`app.graphics_quality.${quality}.label`);
      opt.selected = quality === this.renderer.getQuality();
      select.appendChild(opt);
    }
    select.onchange = () => {
      this.renderer.setQuality(parseQuality(select.value));
      this.saveUserSettings();
    };
  }

  /** Fills the character selector; called again when the language changes. */
  private setupPlayerSkinSelector(): void {
    const select = byId<HTMLSelectElement>('player-skin-select');
    if (!select) return;
    select.innerHTML = '';
    for (const skin of PLAYER_SKIN_IDS) {
      const opt = document.createElement('option');
      opt.value = skin;
      opt.textContent = t(playerSkinLabelKey(skin));
      opt.selected = skin === this.renderer.getPlayerSkin();
      select.appendChild(opt);
    }
    select.onchange = () => {
      this.renderer.setPlayerSkin(parsePlayerSkin(select.value));
      this.saveUserSettings();
      if (this.activeMode === 'editor') this.editor.render();
    };
  }

  private applyTheme(themeId: string): void {
    this.autoTheme = themeId === AUTO_THEME_ID;
    const select = byId<HTMLSelectElement>('theme-select');
    if (select) {
      select.value = themeId;
    }
    if (this.autoTheme) {
      this.showLevelTheme(this.engine.getLevel());
    } else {
      this.showTheme(themeId);
    }
    if (getRenderStyle(this.renderer.getStyle()).sprite) this.updateHUD();
    this.saveUserSettings();
  }

  private showTheme(themeId: string): void {
    this.renderer.setThemeId(themeId);
    this.syncThemeAccent();
    this.refreshRetroIcons();
    AudioManager.setThemeTrack(this.currentThemeTrackId());
  }

  /** Music track of the biome on screen; it plays in the Default music mode only. */
  private currentThemeTrackId(): string | undefined {
    return ConfigRegistry.getGame().themes?.[this.renderer.getThemeId()]?.musicTrackId;
  }

  /** Sprite-style icons (16-Bit and 32-Bit Retro) are drawn with the palette of the theme, so they are redrawn when it changes. */
  private refreshRetroIcons(): void {
    if (!getRenderStyle(this.renderer.getStyle()).sprite) return;
    this.rebuildHudIcons();
    if (this.activeMode === 'editor') {
      this.editor.buildUI();
      this.editor.render();
    }
  }

  /** Lets the HUD follow the biome: its accent colour becomes a CSS variable. */
  private syncThemeAccent(): void {
    const accent = this.renderer.getThemeAccent();
    if (accent) document.documentElement.style.setProperty(BIOME_ACCENT_CSS_VAR, accent);
  }

  /** In automatic mode, shows the level's own theme, or the default one. */
  private showLevelTheme(level: CompiledLevel): void {
    if (!this.autoTheme) return;
    const gameCfg = ConfigRegistry.getGame();
    const themeId =
      level.theme && gameCfg.themes?.[level.theme]
        ? level.theme
        : gameCfg.graphics?.defaultTheme || DEFAULT_THEME_ID;
    if (themeId !== this.renderer.getThemeId()) this.showTheme(themeId);
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

  /** Loads a level into the engine its ruleset asks for. */
  private loadPlayLevel(level: CompiledLevel): void {
    this.engineSelector.forLevel(level).loadLevel(level);
    this.syncSokobanSkinControl(level.winRule);
  }

  /**
   * The skin only changes Sokoban levels: the toggle is hidden elsewhere (display none, so it
   * leaves the tab order). The stored preference is kept and shown again when it applies.
   */
  private syncSokobanSkinControl(winRule: WinRule | undefined): void {
    const skinBtn = byId<HTMLButtonElement>('btn-sokoban-skin-toggle');
    if (!skinBtn) return;
    const applicable = isSokobanSkinApplicable(winRule);
    skinBtn.classList.toggle('hidden', !applicable);
    setToggleState(skinBtn, this.renderer.isSokobanSkinEnabled());
  }

  /**
   * The Epoxy engine while it plays the level on screen. The play aids that
   * search the level (paths, objectives, block puzzles) are built on it and
   * stay off under other rulesets.
   */
  private epoxyEngine(): GameEngine | null {
    return this.engine instanceof GameEngine ? this.engine : null;
  }

  /** Next goal to show, when the level's ruleset has the objective marker. */
  private nextObjective(): GridPoint | null {
    const engine = this.epoxyEngine();
    if (!engine || !featuresFor(engine.getLevel()).objectiveMarker) return null;
    return Pathfinder.findNextObjective(engine);
  }

  /** Single entry point for every restart control. */
  private restartLevel(): void {
    this.stopAutoMoveAndReplay();
    this.heldDirection = null;
    this.lastWarnedSecond = NO_WARNED_SECOND;
    this.loadPlayLevel(this.engine.getLevel());
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
    this.loadPlayLevel(this.engine.getLevel());
    this.replayMoves = [...moves];
    this.replayIndex = 0;
    this.isReplaying = true;
    this.updateHUD();
  }

  private triggerObjectiveAndLinks(): void {
    if (this.playBlockHint()) return;
    const active = this.renderer.toggleMechanismLinks();
    byId('hud-btn-objective')?.classList.toggle('active', active);
    byId('mobile-btn-objective')?.classList.toggle('active', active);

    if (active) {
      const target = this.nextObjective();
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

  /**
   * Restarts the level and plays its proven solution, after a confirmation
   * since progress in the level is lost. Levels without a stored solution
   * (imported packs) say so.
   */
  private async showSolution(): Promise<void> {
    const level = this.engine.getLevel();
    const moves = featuresFor(level).solutionReplay ? timedSolution(level) : null;
    if (!moves) {
      this.showTransientStatus(t('hud.messages.no_solution.label'));
      return;
    }
    const confirmed = await confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('hud.messages.solution_confirm.label'),
      confirmLabel: t('app.confirm.solution.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
    if (!confirmed) return;
    this.startReplay(moves);
    this.showTransientStatus(t('hud.messages.solution_playing.label'));
  }

  /**
   * In a block puzzle, plays the next push of a solution from where the
   * player stands, walking there first. Returns false when no block puzzle
   * is open, so the usual objective help runs instead.
   */
  private playBlockHint(): boolean {
    const engine = this.epoxyEngine();
    if (!engine || !featuresFor(engine.getLevel()).blockHint) return false;
    if (this.isReplaying || !engine.getPlayer().alive) return false;
    if (BlockPuzzleSolver.isStuck(engine, requestedSearchBudget())) {
      this.showTransientStatus(t(stuckMessageKey(engine.getLevel().winRule)));
      return true;
    }
    const moves = BlockPuzzleSolver.hint(engine);
    if (!moves) return false;
    const player = engine.getPlayer();
    let x = player.x;
    let y = player.y;
    this.autoMoveQueue = moves;
    this.autoMovePoints = moves.map((dir) => {
      x += DIRECTION_VECTORS[dir].dx;
      y += DIRECTION_VECTORS[dir].dy;
      return { x, y };
    });
    this.renderer.setPlannedPath(this.autoMovePoints);
    this.showTransientStatus(t('hud.messages.block_hint.label'));
    return true;
  }

  private getMedalTierFor(timeRemaining: number, timeLimit: number): MedalTier | null {
    const timing = ConfigRegistry.getGame().timing;
    return getMedalTier(
      timeRemaining,
      timeLimit,
      timing.goldTimeRatio ?? TIMING_DEFAULTS.goldTimeRatio,
      timing.silverTimeRatio ?? TIMING_DEFAULTS.silverTimeRatio
    );
  }

  /** Translated medal text, empty when the level is untimed and earns no medal. */
  private medalText(tier: MedalTier | null, keyOf: (tier: MedalTier) => string): string {
    return tier ? t(keyOf(tier)) : '';
  }

  /** Starts a level; `announce` is false when a replay is about to play it. */
  private startLevelByIndex(index: number, announce: boolean = true): void {
    const levels = ConfigRegistry.getLevels();
    if (levels.length === 0) return;
    this.stopAutoMoveAndReplay();
    this.lastWarnedSecond = NO_WARNED_SECOND;
    if (this.isEndlessActive()) {
      this.endlessWaiting = false;
    } else {
      this.cancelEndlessPrefetch();
    }
    // An endless run has no wrap-around: it stops at its first built level and at its last.
    this.currentLevelIndex = this.isEndlessActive()
      ? Math.min(Math.max(index, 0), levels.length - 1)
      : ((index % levels.length) + levels.length) % levels.length;
    this.loadPlayLevel(levels[this.currentLevelIndex]);
    AudioManager.setEndlessTracks(this.isEndlessActive() ? ConfigRegistry.getGame().endlessUi.musicTrackIds ?? [] : null);
    AudioManager.onLevelLoaded(levels[this.currentLevelIndex].id);
    this.showLevelTheme(levels[this.currentLevelIndex]);
    this.saveProgress();
    this.updateHUD();
    const objective = this.objectiveMessage();
    if (announce && objective) this.showTransientStatus(objective);
    this.noteEndlessLevelReached(levels[this.currentLevelIndex]);
    this.prefetchNextEndlessLevel();
  }

  private isPackFullyCompleted(levels: CompiledLevel[]): boolean {
    return levels.length > 0 && levels.every((lvl) => Boolean(this.highScores[lvl.id]));
  }

  private isOnLastLevel(): boolean {
    return this.currentLevelIndex >= ConfigRegistry.getLevels().length - 1;
  }

  /** Previous level; an endless run has no wrap-around before its first built level. */
  private goToPreviousLevel(): void {
    const canGoPrev = this.isEndlessActive()
      ? this.currentLevelIndex > 0
      : ConfigRegistry.getLevels().length > 1;
    if (!canGoPrev) return;
    this.startLevelByIndex(this.currentLevelIndex - 1);
  }

  /** Next level; past the last one the pack restarts at level 1 with a message (an endless run waits for its next level instead). */
  private advanceToNextLevel(): void {
    if (this.isEndlessActive() && this.isOnLastLevel()) {
      this.waitForNextEndlessLevel();
      return;
    }
    const levels = ConfigRegistry.getLevels();
    const wraps = this.isOnLastLevel();
    const wrapped = wraps && levels.length > 0;
    this.startLevelByIndex(this.currentLevelIndex + 1, !wrapped);
    if (wrapped) {
      this.showTransientStatus(
        combineStatusMessages(
          this.isPackFullyCompleted(levels)
            ? t('hud.messages.all_levels_won.label', { name: this.activePackName() })
            : t('hud.messages.pack_wrapped.label'),
          this.objectiveMessage()
        )
      );
    }
  }

  private switchMode(mode: 'play' | 'editor'): void {
    this.activeMode = mode;
    const isPlay = mode === 'play';
    byId('play-view')?.classList.toggle('hidden', !isPlay);
    byId('editor-view')?.classList.toggle('hidden', isPlay);
    for (const id of PLAY_MODE_BUTTON_IDS) setToggleState(byId(id), isPlay);
    for (const id of EDITOR_MODE_BUTTON_IDS) setToggleState(byId(id), !isPlay);

    if (!isPlay) {
      void this.syncEditorWithEngineLevel().then(() => this.editor.populatePresetDropdown());
    }
  }

  /**
   * Loads the engine level into the editor only when it changed since the
   * editor last saw it, and asks before replacing unsaved editor work.
   */
  private async syncEditorWithEngineLevel(): Promise<void> {
    const level = this.engine.getLevel();
    if (level === this.editorSourceLevel) return;
    this.editorSourceLevel = level;
    if (
      this.editor.hasUnsavedChanges() &&
      !(await confirmDialog({
        title: t('app.confirm.title.label'),
        message: t('editor.toolbar.confirm_reload.label'),
        confirmLabel: t('app.confirm.replace.action'),
        cancelLabel: t('app.confirm.cancel.action')
      }))
    ) {
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
    this.bindOnboardingModal();
    this.bindPasswordModal();
    this.bindDisplayToggles();
    this.bindAudioToggles();
    this.bindDpad();
    this.bindMobileControls();
    this.bindHudControls();
    this.bindOverlayControls();
  }

  private openPackFilePicker(): void {
    byId<HTMLInputElement>('pack-file-input')?.click();
  }

  private bindPackControls(): void {
    for (const select of this.packSelects()) {
      select.addEventListener('change', () => this.choosePack(select.value));
    }

    byId('btn-import-pack')?.addEventListener('click', () => {
      this.openPackFilePicker();
    });

    byId('btn-procedural-pack')?.addEventListener('click', () => {
      this.openProceduralModal();
    });
    for (const id of Object.values(SEED_COPY_BUTTON_IDS)) {
      byId(id)?.addEventListener('click', () => {
        void this.copyProceduralSeed();
      });
    }
    this.bindProceduralModal();

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
  }

  private bindModeSwitch(): void {
    for (const id of PLAY_MODE_BUTTON_IDS) setToggleState(byId(id), this.activeMode === 'play');
    for (const id of EDITOR_MODE_BUTTON_IDS) setToggleState(byId(id), this.activeMode === 'editor');
    const bindMode = (ids: readonly string[], mode: 'play' | 'editor'): void => {
      for (const id of ids) {
        byId(id)?.addEventListener('click', () => {
          this.switchMode(mode);
          // The drawer copies live inside the open drawer: leave it to show the chosen mode.
          this.setDrawerOpen(false);
        });
      }
    };
    bindMode(PLAY_MODE_BUTTON_IDS, 'play');
    bindMode(EDITOR_MODE_BUTTON_IDS, 'editor');
  }

  // -- Options drawer --------------------------------------------------------

  private syncDrawerChrome(open: boolean): void {
    byId('drawer-backdrop')?.classList.toggle('hidden', !open);
    const optionsBtn = byId('btn-options-menu');
    optionsBtn?.classList.toggle('active', open);
    optionsBtn?.setAttribute('aria-expanded', String(open));
    const mobileMenuBtn = byId('btn-mobile-menu');
    mobileMenuBtn?.classList.toggle('active', open);
    mobileMenuBtn?.setAttribute('aria-expanded', String(open));
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

  /** Restores and remembers whether the drawer's Advanced section is open; storage failures are ignored. */
  private bindAdvancedSection(): void {
    const details = byId<HTMLDetailsElement>('drawer-advanced');
    if (!details) return;
    const key = ConfigRegistry.getStorageKey(DRAWER_ADVANCED_STORAGE_SUFFIX);
    try {
      details.open = localStorage.getItem(key) === DRAWER_ADVANCED_OPEN_VALUE;
    } catch {
      // Storage blocked: stay folded.
    }
    details.addEventListener('toggle', () => {
      try {
        localStorage.setItem(key, details.open ? DRAWER_ADVANCED_OPEN_VALUE : DRAWER_ADVANCED_CLOSED_VALUE);
      } catch {
        // Storage blocked: the choice only lasts for this page.
      }
    });
  }

  private bindDrawer(): void {
    this.bindAdvancedSection();
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
      this.openProceduralModal();
    });

    byId('btn-drawer-import')?.addEventListener('click', () => {
      this.setDrawerOpen(false);
      this.openPackFilePicker();
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

  private bindProceduralModal(): void {
    const seedInput = byId<HTMLInputElement>('procedural-seed-input');
    const startInput = byId<HTMLInputElement>('procedural-start-input');
    seedInput?.addEventListener('input', () => {
      byId('procedural-seed-error')?.classList.add('hidden');
      seedInput.setAttribute('aria-invalid', 'false');
      // The last run's seed brings back its reached level; any other seed starts at level 1.
      if (startInput && !this.startLevelTouched) {
        startInput.value = String(suggestStartLevel(this.endlessProgress, seedInput.value, this.endlessMaxStartLevel()));
      }
    });
    startInput?.addEventListener('input', () => {
      this.startLevelTouched = true;
      byId('procedural-start-error')?.classList.add('hidden');
      startInput.setAttribute('aria-invalid', 'false');
    });
    const submitOnEnter = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.submitProceduralModal();
    };
    seedInput?.addEventListener('keydown', submitOnEnter);
    startInput?.addEventListener('keydown', submitOnEnter);
    byId('procedural-submit-btn')?.addEventListener('click', () => {
      this.submitProceduralModal();
    });
    byId('procedural-cancel-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.PROCEDURAL);
    });
    this.bindBackdropClose(MODAL_IDS.PROCEDURAL);
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
    byId('btn-help-top')?.addEventListener('click', () => {
      this.openHelpModal();
    });
    byId('help-onboarding-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.HELP);
      this.openOnboardingModal();
    });
  }

  private bindOnboardingModal(): void {
    byId('onboarding-close-btn')?.addEventListener('click', () => {
      this.closeModal(MODAL_IDS.ONBOARDING);
    });
    this.bindBackdropClose(MODAL_IDS.ONBOARDING);
  }

  private openOnboardingModal(): void {
    this.openModal(MODAL_IDS.ONBOARDING, byId('onboarding-close-btn'));
  }

  /** Opens the "How to play" dialog once, on a genuine first launch. */
  private maybeShowOnboarding(hadSavedProgress: boolean): void {
    const show = shouldShowOnboarding({
      flagSeen: this.onboardingShownThisSession || this.readOnboardingSeen(),
      hasSave: hadSavedProgress,
      hasScores: Object.keys(this.highScores).length > 0,
      endless: this.isEndlessActive(),
      mode: this.activeMode,
      dialogOpen: isDialogOpen()
    });
    if (!show) return;
    this.markOnboardingSeen();
    this.openOnboardingModal();
  }

  private bindPasswordModal(): void {
    const passInput = byId<HTMLInputElement>('password-input');

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
    byId<HTMLSelectElement>('select-graphics-style')?.addEventListener('change', (e) => {
      const style = parseRenderStyleId((e.target as HTMLSelectElement).value);
      if (style) this.applyGraphicsStyle(style);
    });

    const lcdBtn = byId('btn-lcd-toggle');
    lcdBtn?.addEventListener('click', () => {
      if (!isLcdAvailable(this.renderer.getStyle())) return;
      this.renderer.setLcdEnabled(!this.renderer.isLcdEnabled());
      setToggleState(lcdBtn, this.renderer.isLcdEnabled());
      this.saveUserSettings();
    });

    const skinBtn = byId('btn-sokoban-skin-toggle');
    skinBtn?.addEventListener('click', () => {
      if (!isSokobanSkinApplicable(this.engine.getLevel().winRule)) return;
      this.renderer.setSokobanSkinEnabled(!this.renderer.isSokobanSkinEnabled());
      setToggleState(skinBtn, this.renderer.isSokobanSkinEnabled());
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
    AudioManager.toggleSfx();
    this.syncSoundControls();
    this.saveUserSettings();
  }

  /** Builds the music mode select and the custom track list; rebuilt when the language changes. */
  private setupMusicControls(): void {
    const select = byId<HTMLSelectElement>('music-mode-select');
    const fieldset = byId<HTMLFieldSetElement>('music-custom-tracks');
    if (!select || !fieldset) return;

    select.innerHTML = '';
    for (const mode of MUSIC_MODES) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = t(`app.music.mode_${mode}.label`);
      opt.selected = mode === AudioManager.getMusicMode();
      select.appendChild(opt);
    }
    select.onchange = () => {
      if (!isMusicMode(select.value)) return;
      AudioManager.setMusicMode(select.value);
      fieldset.hidden = select.value !== 'custom';
      this.saveUserSettings();
    };

    fieldset.hidden = AudioManager.getMusicMode() !== 'custom';
    const list = fieldset.querySelector<HTMLElement>('.music-track-list');
    if (!list) return;
    list.innerHTML = '';
    const ticked = new Set(AudioManager.getCustomTrackIds());
    const boxes: HTMLInputElement[] = [];
    for (const track of AudioManager.getTrackOptions()) {
      const label = document.createElement('label');
      label.className = 'music-track-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = track.id;
      box.checked = ticked.has(track.id);
      box.addEventListener('change', () => {
        const chosen = boxes.filter((b) => b.checked).map((b) => b.value);
        if (chosen.length === 0) {
          // At least one track must stay ticked.
          box.checked = true;
          this.showTransientStatus(t('app.music.custom_min_one.label'));
          return;
        }
        AudioManager.setCustomTracks(chosen);
        this.saveUserSettings();
      });
      boxes.push(box);
      const text = document.createElement('span');
      text.textContent = t(track.i18nKey);
      label.append(box, text);
      list.appendChild(label);
    }
  }

  /** Applies a slider while it moves ('input') and saves the setting once it is released ('change'). */
  private bindVolumeSliders(): void {
    const bind = (kind: 'sfx' | 'music', apply: (percent: number) => void, read: () => number): void => {
      const slider = byId<HTMLInputElement>(`${kind}-volume-slider`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        apply(Number(slider.value));
        this.showVolumeText(kind, read());
      });
      slider.addEventListener('change', () => this.saveUserSettings());
    };
    bind('sfx', (p) => AudioManager.setSfxVolumePercent(p), () => AudioManager.getSfxVolumePercent());
    bind('music', (p) => AudioManager.setMusicVolumePercent(p), () => AudioManager.getMusicVolumePercent());
  }

  private bindAudioToggles(): void {
    this.bindVolumeSliders();
    byId('btn-sfx-toggle')?.addEventListener('click', () => {
      this.toggleSfx();
    });

    byId('btn-music-toggle')?.addEventListener('click', () => {
      AudioManager.toggleMusic();
      this.syncSoundControls();
      this.saveUserSettings();
    });
  }

  // -- Mobile touch controls -------------------------------------------

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
    mobileMenuBtn?.addEventListener('click', () => {
      this.setDrawerOpen(true, mobileMenuBtn);
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
  }

  private bindHudControls(): void {
    byId('hud-btn-undo')?.addEventListener('click', () => {
      this.undoMove();
    });
    byId('hud-btn-objective')?.addEventListener('click', () => {
      this.triggerObjectiveAndLinks();
    });
    byId('hud-btn-solution')?.addEventListener('click', () => {
      void this.showSolution();
    });
    byId('mobile-btn-solution')?.addEventListener('click', () => {
      this.triggerHaptic();
      void this.showSolution();
    });
    byId('hud-btn-restart')?.addEventListener('click', () => {
      this.restartLevel();
    });
    byId('hud-btn-pause')?.addEventListener('click', () => {
      this.engine.togglePause();
      this.updateHUD();
    });
    byId('hud-btn-prev')?.addEventListener('click', () => {
      this.goToPreviousLevel();
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
    const showCodes = packUsesPasswords(levels);
    byId('scores-col-code')?.classList.toggle('hidden', !showCodes);
    // A pack with no timed level has no best time to show.
    const showTimes = levels.some((lvl) => isTimedLevel(lvl.timeLimitSeconds));
    byId('scores-col-time')?.classList.toggle('hidden', !showTimes);
    const exportBtn = byId<HTMLButtonElement>('btn-export-pack-ccl');
    if (exportBtn) {
      const exportable = levels.some((lvl) => datRefusalReason(lvl) === null);
      exportBtn.disabled = !exportable;
      if (exportable) exportBtn.removeAttribute('title');
      else exportBtn.title = t('app.export.none_exportable.label');
    }
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
        const hay = `${lvl.number} ${title} ${showCodes ? lvl.password : ''}`.toLowerCase();
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

      const timeText =
        rec && isTimedLevel(lvl.timeLimitSeconds)
          ? t('hud.scores_modal.best_time_cell.label', {
              medal: this.medalText(this.getMedalTierFor(rec.bestTimeRemaining, lvl.timeLimitSeconds), medalIconKey),
              seconds: rec.bestTimeRemaining
            }).trim()
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
            this.startLevelByIndex(idx, false);
            this.startReplay(replay);
          })
        );
      }

      const codeCell = cell(lvl.password, 'code-cell');
      codeCell.classList.toggle('hidden', !showCodes);
      const timeCell = cell(timeText);
      timeCell.classList.toggle('hidden', !showTimes);
      tr.append(
        cell(String(lvl.number)),
        cell(title),
        codeCell,
        timeCell,
        cell(rec ? String(rec.minSteps) : noRecord),
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

    // A key released while the window had no focus never reaches keyup.
    window.addEventListener('blur', () => {
      this.heldDirection = null;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.heldDirection = null;
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

  /** Gives keyboard focus back to the game after a mouse or touch interaction only. */
  private bindFocusHandoff(): void {
    for (const id of ['play-view', 'top-controls-drawer']) {
      const container = byId(id);
      if (container) bindButtonPointerBlur(container);
    }
    // The fov, theme and locale selects, and the drawer copy of the pack select, live in a
    // modal dialog: blurring them would send focus outside it. Only the header pack select
    // sits outside any dialog.
    bindSelectPointerBlur(byId<HTMLSelectElement>('pack-select'));
  }

  private handleEditorShortcut(e: KeyboardEvent): void {
    const action = getEditorChordAction(e);
    if (!action) return;
    e.preventDefault();
    if (action === 'redo') {
      this.editor.redo();
    } else {
      this.editor.undo();
    }
  }

  private handlePlayShortcut(e: KeyboardEvent, kb: KeybindingsConfig): void {
    const run = (action: () => void): void => {
      e.preventDefault();
      action();
    };

    if (isUndoChord(e)) {
      run(() => this.undoMove());
      return;
    }
    // Other Ctrl, Meta or Alt chords belong to the browser and the system.
    if (hasCommandModifier(e)) return;

    // '?' is a Shift chord on a key whose code is bound elsewhere on some layouts (AZERTY).
    if (e.key === '?') {
      run(() => this.openHelpModal());
      return;
    }

    if (kb.undo.includes(e.code)) {
      run(() => this.undoMove());
    } else if (kb.moveUp.includes(e.code)) {
      run(() => this.beginHeldMove('N'));
    } else if (kb.moveDown.includes(e.code)) {
      run(() => this.beginHeldMove('S'));
    } else if (kb.moveLeft.includes(e.code)) {
      run(() => this.beginHeldMove('W'));
    } else if (kb.moveRight.includes(e.code)) {
      run(() => this.beginHeldMove('E'));
    } else if (kb.dropItem?.includes(e.code)) {
      run(() => this.dropSelectedItem());
    } else if (kb.cycleItem?.includes(e.code)) {
      run(() => this.cycleSelectedItem());
    } else if (kb.restart.includes(e.code)) {
      run(() => this.restartLevel());
    } else if (kb.pause.includes(e.code)) {
      run(() => this.engine.togglePause());
    } else if (kb.nextLevel.includes(e.code)) {
      run(() => this.advanceToNextLevel());
    } else if (kb.prevLevel.includes(e.code)) {
      run(() => this.goToPreviousLevel());
    } else if (kb.toggleFullscreen?.includes(e.code)) {
      run(() => this.toggleFullscreen());
    } else if (kb.toggleMute.includes(e.code)) {
      run(() => this.toggleSfx());
    } else if (kb.toggleGraphics?.includes(e.code)) {
      run(() => this.applyGraphicsStyle(this.renderer.toggleStyle()));
    } else if (kb.cycleTheme?.includes(e.code)) {
      run(() => this.applyTheme(this.renderer.cycleTheme()));
    } else if (kb.generateProcedural?.includes(e.code)) {
      run(() => this.openProceduralModal());
    } else if (kb.showObjective?.includes(e.code)) {
      run(() => this.triggerObjectiveAndLinks());
    } else if (kb.showSolution?.includes(e.code)) {
      run(() => void this.showSolution());
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

  /** Fills the render style selector from the registry; called again when the language changes. */
  private setupGraphicsStyleSelector(): void {
    const select = byId<HTMLSelectElement>('select-graphics-style');
    if (!select) return;
    select.innerHTML = '';
    for (const option of buildGraphicsStyleOptions()) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = t(option.labelKey);
      select.appendChild(opt);
    }
    select.value = this.renderer.getStyle();
  }

  /** Brings the selector, the canvas class and the LCD toggle in line with `style`. */
  private syncGraphicsControls(style: GraphicsStyle): void {
    const descriptor = getRenderStyle(style);
    for (const cls of canvasClassesToRemove(style)) this.gameCanvas.classList.remove(cls);
    if (descriptor.canvasClass) this.gameCanvas.classList.add(descriptor.canvasClass);
    const select = byId<HTMLSelectElement>('select-graphics-style');
    if (select) select.value = style;
    // The LCD grid only renders where the style allows it: shown off and disabled elsewhere,
    // the stored preference is restored when the style allows it again.
    const lcdBtn = byId<HTMLButtonElement>('btn-lcd-toggle');
    if (lcdBtn) {
      lcdBtn.disabled = !descriptor.lcdAllowed;
      setToggleState(lcdBtn, descriptor.lcdAllowed && this.renderer.getLcdPreference());
    }
    // The reason is shown as text because the title tooltip never appears on touch.
    byId('lcd-toggle-reason')?.classList.toggle('hidden', descriptor.lcdAllowed);
  }

  private applyGraphicsStyle(style: GraphicsStyle): void {
    if (this.renderer.getStyle() !== style) this.renderer.setStyle(style);
    this.syncGraphicsControls(style);
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
    const cellEntities = this.engine.getEntities().filter((e) => e.x === pt.x && e.y === pt.y);
    const ent = cellEntities.find((e) => e.kind === 'block') ?? cellEntities[0];
    if (ent) {
      const entDef = ConfigRegistry.getEntityDef(ent.type);
      if (entDef) parts.push(t(entDef.i18nKey));
    }

    // A block hides the item and the terrain under it, so only its name is shown.
    if (ent?.kind === 'block') {
      this.showInspectBadge(inspectEl, pt, parts);
      return;
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

    this.showInspectBadge(inspectEl, pt, parts);
  }

  private showInspectBadge(inspectEl: HTMLElement, pt: GridPoint, parts: readonly string[]): void {
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
      this.keySlots = this.keyIds.map((id) => new InventorySlotView(keysGrid, () => this.dropHudItem(id)));
    }
    if (bootsGrid) {
      bootsGrid.innerHTML = '';
      this.bootSlots = this.bootIds.map((id) => new InventorySlotView(bootsGrid, () => this.dropHudItem(id)));
    }
  }

  /** The selected item, moved to the first held one when it is no longer held. */
  private resolveSelectedItem(): string | null {
    if (this.selectedItemId && this.engine.holdsItem(this.selectedItemId)) return this.selectedItemId;
    this.selectedItemId = null;
    for (const id of this.keyIds) {
      if (this.engine.holdsItem(id)) return (this.selectedItemId = id);
    }
    for (const id of this.bootIds) {
      if (this.engine.holdsItem(id)) return (this.selectedItemId = id);
    }
    return null;
  }

  /** Selects the next held item, in inventory order (keys, then boots). */
  private cycleSelectedItem(): void {
    const current = this.resolveSelectedItem();
    if (current === null) return;
    const order = [...this.keyIds, ...this.bootIds];
    const from = order.indexOf(current);
    for (let step = 1; step <= order.length; step++) {
      const id = order[(from + step) % order.length];
      if (this.engine.holdsItem(id)) {
        this.selectedItemId = id;
        return;
      }
    }
  }

  /** Drops the selected item on the player's cell. */
  private dropSelectedItem(): void {
    if (!featuresFor(this.engine.getLevel()).itemDrop) return;
    this.clearAutoMove();
    this.engine.dropItem(this.resolveSelectedItem());
  }

  /** Drops the item of a clicked inventory slot, which becomes the selected one. */
  private dropHudItem(itemId: string): void {
    if (this.activeMode !== 'play') return;
    if (this.isReplaying) {
      this.stopAutoMoveAndReplay();
      this.updateHUD();
      return;
    }
    if (!featuresFor(this.engine.getLevel()).itemDrop) return;
    this.clearAutoMove();
    this.selectedItemId = itemId;
    this.engine.dropItem(itemId);
    this.updateHUD();
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

  /** Slot tooltip: the item's name, with the drop hint once it is held. */
  private slotLabel(itemId: string, owned: boolean): string {
    const name = this.getInventoryLabel(itemId);
    return owned ? t('hud.inventory.slot_drop.label', { name }) : name;
  }

  private updateInventory(): void {
    const player = this.engine.getPlayer();
    const selected = this.resolveSelectedItem();
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
        label: this.slotLabel(kId, count > 0),
        iconUrl: this.keyIconCache[kId],
        selected: selected === kId
      });
    });
    this.bootIds.forEach((bId, i) => {
      const owned = player.boots.has(bId);
      this.bootSlots[i]?.update({
        owned,
        badge: '',
        label: this.slotLabel(bId, owned),
        iconUrl: this.bootIconCache[bId],
        selected: selected === bId
      });
    });
  }

  private updateHUD(): void {
    const lvl = this.engine.getLevel();
    const player = this.engine.getPlayer();

    setText(byId('hud-level-num'), String(lvl.number));
    setText(byId('hud-level-pass'), lvl.password);
    this.updatePasswordControls();
    const prevBtn = byId<HTMLButtonElement>('hud-btn-prev');
    if (prevBtn) {
      prevBtn.disabled = this.isEndlessActive()
        ? this.currentLevelIndex <= 0
        : ConfigRegistry.getLevels().length <= 1;
    }
    const levelTitle = this.resolveLevelTitle(lvl);
    const levelAuthor = lvl.author?.trim() ?? '';
    const authorLabel = levelAuthor ? t('hud.level.author.label', { author: levelAuthor }) : '';
    setText(byId('hud-level-name'), levelTitle);
    setText(byId('hud-level-author'), authorLabel);
    byId('hud-level-author')?.classList.toggle('hidden', !levelAuthor);
    const titleBox = byId('hud-level-name')?.parentElement;
    const fullTitle = authorLabel ? `${levelTitle} ${authorLabel}` : levelTitle;
    if (titleBox && titleBox.title !== fullTitle) {
      titleBox.title = fullTitle;
    }
    const targetsMode = showsTargetsCounter(lvl.winRule);
    const receiversMode = showsReceiversCounter(lvl.winRule);
    const progressMode = targetsMode || receiversMode;
    byId('hud-chips-label')?.classList.toggle('hidden', progressMode);
    byId('hud-targets-label')?.classList.toggle('hidden', !targetsMode);
    byId('hud-receivers-label')?.classList.toggle('hidden', !receiversMode);
    const progress = this.engine.getTargetsProgress();
    const receivers = receiversMode
      ? receiversProgress(this.engine.getTerrain(), this.epoxyEngine()?.getLitReceivers() ?? [])
      : null;
    const counter = receivers ? receivers.lit : targetsMode ? progress.covered : this.engine.getChipsRemaining();
    const chipsEl = byId('hud-chips-left');
    setText(
      chipsEl,
      receivers
        ? t('hud.stats.receivers_value.label', { lit: receivers.lit, total: receivers.total })
        : targetsMode
          ? t('hud.stats.targets_value.label', { covered: progress.covered, total: progress.total })
          : String(counter).padStart(HUD_COUNTER_DIGITS, '0')
    );
    // Same level and a better count: a chip was picked up, a target covered or a receiver lit.
    const improved = progressMode ? counter > this.hudChipsLeft : counter < this.hudChipsLeft;
    if (chipsEl && lvl.id === this.hudChipsLevelId && improved) {
      replayAnimation(chipsEl, HUD_BUMP_CLASS);
    }
    this.hudChipsLevelId = lvl.id;
    this.hudChipsLeft = counter;
    this.updateSolutionControls(lvl);
    this.updateTimer();
    setText(byId('hud-score'), String(this.engine.getTotalScore()));
    setText(byId('hud-steps'), String(this.engine.getStepsCount()));

    this.updateInventory();
    this.updateHintBanner();
    this.updateStatusToast();

    if (this.renderer.isShowingMechanismLinks() && player.alive && !this.engine.isLevelCompleted()) {
      this.renderer.setObjectivePoint(this.nextObjective());
    }
    this.updateOverlay();
  }

  /** Hides every way to see or enter a level code when the pack has no real codes. */
  private updatePasswordControls(): void {
    const hidden = !packUsesPasswords(ConfigRegistry.getLevels());
    for (const id of PASSWORD_CONTROL_IDS) {
      byId(id)?.classList.toggle('hidden', hidden);
    }
  }

  /** Disables the solution button of a level that stores none (hidden on the touch bar). */
  private updateSolutionControls(lvl: CompiledLevel): void {
    const available = hasStoredSolution(lvl);
    const desktopBtn = byId<HTMLButtonElement>('hud-btn-solution');
    if (desktopBtn) {
      desktopBtn.disabled = !available;
      desktopBtn.title = available ? t('hud.controls.solution.hint') : t('hud.controls.solution_unavailable.label');
    }
    byId('mobile-btn-solution')?.classList.toggle('hidden', !available);
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
      const finalWin = !this.isEndlessActive() && this.isOnLastLevel() && this.isPackFullyCompleted(levels);
      setText(
        ovTitle,
        finalWin
          ? t('hud.messages.all_levels_won.label', { name: this.activePackName() })
          : t('hud.messages.level_complete.label')
      );
      setText(
        ovSub,
        isTimedLevel(lvl.timeLimitSeconds)
          ? t('hud.messages.time_bonus.label', { bonus: this.engine.getLastTimeBonus() })
          : ''
      );
      const medalTier = this.getMedalTierFor(this.engine.getTimeRemainingSeconds(), lvl.timeLimitSeconds);
      setText(
        ovExtra,
        medalTier
          ? t('hud.messages.level_score.label', {
              score: this.engine.getLastLevelScore(),
              medal: t(medalLabelKey(medalTier))
            })
          : t('hud.messages.level_score_untimed.label', { score: this.engine.getLastLevelScore() })
      );
    } else if (state === 'dead') {
      const player = this.engine.getPlayer();
      setText(ovTitle, t('hud.messages.level_lost.label'));
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
    timedMoves: TimedMove[]
  ): void {
    const existing = this.highScores[levelId];
    const isBetterOrFirst = !existing || steps <= existing.minSteps || score >= existing.bestScore;
    this.highScores[levelId] = {
      // Legacy fields of an older record stay as they were.
      ...existing,
      bestTimeRemaining: existing ? Math.max(existing.bestTimeRemaining, timeRemaining) : timeRemaining,
      minSteps: existing ? Math.min(existing.minSteps, steps) : steps,
      bestScore: existing ? Math.max(existing.bestScore, score) : score,
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
      // Legacy records (untimed replayMoves only) keep their scores but lose
      // the replay button: untimed moves cannot replay faithfully.
      this.highScores = sanitizeHighScores(JSON.parse(raw));
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
        themeId: this.autoTheme ? AUTO_THEME_ID : this.renderer.getThemeId(),
        graphicsStyle: this.renderer.getStyle(),
        lcdEnabled: this.renderer.getLcdPreference(),
        sokobanSkinEnabled: this.renderer.isSokobanSkinEnabled(),
        playerSkin: this.renderer.getPlayerSkin(),
        graphicsQuality: this.renderer.getQuality(),
        sfxEnabled: AudioManager.isSfxEnabled(),
        musicEnabled: AudioManager.isMusicEnabled(),
        sfxVolumePercent: AudioManager.getSfxVolumePercent(),
        musicVolumePercent: AudioManager.getMusicVolumePercent(),
        musicMode: AudioManager.getMusicMode(),
        musicCustomTracks: customIdsForStorage(
          AudioManager.getCustomTrackIds(),
          AudioManager.getTrackOptions().map((track) => track.id)
        )
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
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const settings = parsed as UserSettings;
      return {
        ...settings,
        graphicsStyle: parseGraphicsStyle(settings.graphicsStyle),
        playerSkin: parsePlayerSkin(settings.playerSkin)
      };
    } catch {
      return {};
    }
  }

  private hasSavedProgress(): boolean {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.saveSlotKey);
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  /** True when the seen flag is in persistent storage, or in session storage when that refuses writes. */
  private readOnboardingSeen(): boolean {
    const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.onboardingSeenKey);
    for (const store of ONBOARDING_STORES) {
      try {
        if (store().getItem(key) !== null) return true;
      } catch {
        // Storage blocked: try the next one
      }
    }
    return false;
  }

  /** Remembers the first showing; strict private modes fall back to session storage. */
  private markOnboardingSeen(): void {
    this.onboardingShownThisSession = true;
    const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.onboardingSeenKey);
    for (const store of ONBOARDING_STORES) {
      try {
        store().setItem(key, ONBOARDING_SEEN_VALUE);
        return;
      } catch {
        // Storage blocked: try the next one
      }
    }
  }

  private restoreSavedProgress(): void {
    try {
      const key = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.saveSlotKey);
      const raw = localStorage.getItem(key);
      if (!raw) return;
      // A pack can shrink between releases: a stale index restarts the pack.
      const index = resolveSavedLevelIndex(
        JSON.parse(raw),
        ConfigRegistry.getActivePackId(),
        ConfigRegistry.getLevels().length
      );
      if (index !== null) this.currentLevelIndex = index;
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
