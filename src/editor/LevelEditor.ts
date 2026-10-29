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
import { BUILTIN_PACK_IDS } from '../config/constants';
import { InvalidLevelError } from '../config/ConfigValidation';
import { t } from '../i18n/I18nManager';
import { PixelRenderer } from '../render/PixelRenderer';
import { DatCodec } from '../formats/DatCodec';
import { LevelValidator } from '../core/LevelValidator';
import {
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  LevelBlueprint,
  TrapLink,
  ValidationIssue
} from '../core/types';
import { downloadBytes, downloadJson } from '../ui/download';
import {
  CUSTOM_LEVEL_ID_PREFIX,
  EDITOR_CLONE_LINK_COLOR,
  EDITOR_DEFAULT_CHIPS_REQUIRED,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_DEFAULT_PASSWORD,
  EDITOR_DEFAULT_TIME_LIMIT_SECONDS,
  EDITOR_LINK_LINE_WIDTH,
  EDITOR_PASSWORD_LENGTH,
  EDITOR_TILE_CENTER_OFFSET,
  EDITOR_TRAP_LINK_COLOR,
  TIMING_DEFAULTS
} from '../ui/uiConstants';

const EXPORT_FALLBACK_FILE_NAME = 'epoxy_level';
const METADATA_INPUT_IDS = [
  'editor-meta-title',
  'editor-meta-hint',
  'editor-meta-password',
  'editor-meta-time',
  'editor-meta-chips'
] as const;

type BrushKind = 'terrain' | 'item' | 'entity' | 'player_start' | 'eraser' | 'wire_trap' | 'wire_cloner';

interface ActiveBrush {
  kind: BrushKind;
  id: string;
}

interface EditorSnapshot {
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  playerStart: { x: number; y: number; dir: Direction };
}

export class LevelEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: PixelRenderer;
  private onTestPlay: (level: CompiledLevel) => void;
  private onLevelSaved: (levelIndex: number) => void;
  private onNotify: (message: string) => void;

  private terrain: string[][] = [];
  private items: (string | null)[][] = [];
  private entities: EntityPlacement[] = [];
  private trapLinks: TrapLink[] = [];
  private cloneLinks: CloneLink[] = [];
  private playerStart: { x: number; y: number; dir: Direction } = { x: 0, y: 0, dir: 'S' };

  private currentLevelId: string = '';
  /** Custom id given to a non-custom level on its first save, stable afterwards. */
  private draftCustomId: string | null = null;
  private customTitle: string = '';
  private customHint: string = '';
  private password: string = EDITOR_DEFAULT_PASSWORD;
  private timeLimitSeconds: number = EDITOR_DEFAULT_TIME_LIMIT_SECONDS;
  private chipsRequired: number = EDITOR_DEFAULT_CHIPS_REQUIRED;

  private activeCategory: string = 'terrain';
  private activeBrush: ActiveBrush = { kind: 'terrain', id: 'wall' };
  private fillMode: boolean = false;
  private activeDir: Direction = 'S';
  private isPainting: boolean = false;
  private isRightErasing: boolean = false;
  private isDirty: boolean = false;
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private pendingWireSource: { x: number; y: number } | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    renderer: PixelRenderer,
    onTestPlay: (level: CompiledLevel) => void,
    onLevelSaved: (levelIndex: number) => void,
    onNotify: (message: string) => void
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = context;
    this.renderer = renderer;
    this.onTestPlay = onTestPlay;
    this.onLevelSaved = onLevelSaved;
    this.onNotify = onNotify;

    this.initBlankMap();
    this.bindCanvasEvents();
    // Bound once: buildUI() runs again on graphics style changes and must
    // not stack toolbar listeners.
    this.bindToolbarEvents();
    this.bindMetadataEvents();
  }

  /** True when the map or its metadata changed since the last load or save. */
  public hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  public initBlankMap(): void {
    const { mapWidth, mapHeight, editorTilePixelSize } = ConfigRegistry.getGame().grid;
    this.canvas.width = mapWidth * editorTilePixelSize;
    this.canvas.height = mapHeight * editorTilePixelSize;

    this.terrain = Array.from({ length: mapHeight }, (_, y) =>
      Array.from({ length: mapWidth }, (__, x) =>
        x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'
      )
    );
    this.items = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => null)
    );
    this.entities = [];
    this.trapLinks = [];
    this.cloneLinks = [];
    this.playerStart = { x: Math.floor(mapWidth / 2), y: Math.floor(mapHeight / 2), dir: 'S' };
    this.currentLevelId = `${CUSTOM_LEVEL_ID_PREFIX}${Date.now()}`;
    this.draftCustomId = null;
    this.customTitle = t('editor.metadata.default_title.label');
    this.customHint = '';
    this.password = EDITOR_DEFAULT_PASSWORD;
    this.timeLimitSeconds = EDITOR_DEFAULT_TIME_LIMIT_SECONDS;
    this.chipsRequired = EDITOR_DEFAULT_CHIPS_REQUIRED;
    this.isDirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.render();
  }

  public loadCompiledLevel(level: CompiledLevel): void {
    this.currentLevelId = level.id;
    this.draftCustomId = null;
    this.customTitle = this.resolveLevelTitle(level);
    this.customHint = level.customHint || (level.hintKey ? t(level.hintKey) : '');
    this.password = level.password;
    this.timeLimitSeconds = level.timeLimitSeconds;
    this.chipsRequired = level.chipsRequired;
    this.playerStart = { ...level.playerStart };
    this.terrain = level.terrain.map((r) => [...r]);
    this.items = level.items.map((r) => [...r]);
    this.entities = level.entities.map((e) => ({ ...e }));
    this.trapLinks = level.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
    this.isDirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.render();
  }

  public buildUI(): void {
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.populatePresetDropdown();
    this.syncMetadataInputs();
    this.render();
  }

  private resolveLevelTitle(level: CompiledLevel): string {
    return level.customTitle || (level.titleKey ? t(level.titleKey, { number: level.number }) : level.id);
  }

  /** Localized validator issue; a key id parameter is shown by its tile name. */
  private formatIssue(issue: ValidationIssue): string {
    const params = { ...(issue.params || {}) };
    if (typeof params.key === 'string' && ConfigRegistry.getTiles().tiles[params.key]) {
      params.key = t(ConfigRegistry.getTile(params.key).i18nKey);
    }
    return t(issue.i18nKey, params);
  }

  private formatIssues(issues: ValidationIssue[]): string {
    return issues.map((iss) => this.formatIssue(iss)).join(t('validator.status.issue_separator.label'));
  }

  public refreshTranslations(): void {
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.populatePresetDropdown();
  }

  private renderCategoryTabs(): void {
    const container = document.getElementById('editor-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    const categories = ConfigRegistry.getTiles().categories;
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editor-tab-btn ${this.activeCategory === cat.id ? 'active' : ''}`;
      btn.textContent = t(cat.i18nKey);
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id;
        this.renderCategoryTabs();
        this.renderPaletteItems();
      });
      container.appendChild(btn);
    }
  }

  private renderPaletteItems(): void {
    const container = document.getElementById('editor-palette-grid');
    if (!container) return;
    container.innerHTML = '';

    const tiles = Object.values(ConfigRegistry.getTiles().tiles).filter(
      (tile) => tile.category === this.activeCategory
    );

    for (const tile of tiles) {
      const kind: BrushKind = tile.layer === 'item' ? 'item' : 'terrain';
      const isSelected = this.activeBrush.kind === kind && this.activeBrush.id === tile.id;
      const btn = this.createPaletteButton(
        t(tile.i18nKey),
        this.renderer.renderIconToDataUrl(tile.layer === 'item' ? 'item' : 'tile', tile.id),
        isSelected,
        () => {
          this.activeBrush = { kind, id: tile.id };
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(btn);
    }

    const entities = Object.values(ConfigRegistry.getMonsters().entities).filter(
      (ent) => ent.category === this.activeCategory
    );

    for (const ent of entities) {
      const isSelected = this.activeBrush.kind === 'entity' && this.activeBrush.id === ent.id;
      const btn = this.createPaletteButton(
        t(ent.i18nKey),
        this.renderer.renderIconToDataUrl('entity', ent.id),
        isSelected,
        () => {
          this.activeBrush = { kind: 'entity', id: ent.id };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(btn);
    }

    if (this.activeCategory === 'entities') {
      const isPlayerSelected = this.activeBrush.kind === 'player_start';
      const playerBtn = this.createPaletteButton(
        t('editor.palette.tools.player_start'),
        '',
        isPlayerSelected,
        () => {
          this.activeBrush = { kind: 'player_start', id: 'player_start' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(playerBtn);
    }

    if (this.activeCategory === 'mechanisms') {
      const wireTrapBtn = this.createPaletteButton(
        t('editor.palette.tools.wire_trap'),
        '',
        this.activeBrush.kind === 'wire_trap',
        () => {
          this.activeBrush = { kind: 'wire_trap', id: 'wire_trap' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.setStatusText(t('editor.palette.status.wire_select_source'));
          this.renderPaletteItems();
        }
      );
      container.appendChild(wireTrapBtn);

      const wireClonerBtn = this.createPaletteButton(
        t('editor.palette.tools.wire_cloner'),
        '',
        this.activeBrush.kind === 'wire_cloner',
        () => {
          this.activeBrush = { kind: 'wire_cloner', id: 'wire_cloner' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.setStatusText(t('editor.palette.status.wire_select_source'));
          this.renderPaletteItems();
        }
      );
      container.appendChild(wireClonerBtn);
    }

    const fillBtn = this.createPaletteButton(
      t('editor.palette.tools.fill'),
      '',
      this.fillMode,
      () => {
        this.fillMode = !this.fillMode;
        this.renderPaletteItems();
      }
    );
    container.appendChild(fillBtn);

    const eraserBtn = this.createPaletteButton(
      t('editor.palette.tools.eraser'),
      this.renderer.renderIconToDataUrl('tile', 'floor'),
      this.activeBrush.kind === 'eraser',
      () => {
        this.activeBrush = { kind: 'eraser', id: 'eraser' };
        this.fillMode = false;
        this.pendingWireSource = null;
        this.renderPaletteItems();
      }
    );
    container.appendChild(eraserBtn);
  }

  private createPaletteButton(
    label: string,
    iconUrl: string,
    active: boolean,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-item-btn ${active ? 'active' : ''}`;
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = label;
      img.className = 'palette-item-icon';
      btn.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', onClick);
    return btn;
  }

  public populatePresetDropdown(): void {
    const select = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';

    const levels = ConfigRegistry.getLevels();
    for (const lvl of levels) {
      const opt = document.createElement('option');
      opt.value = lvl.id;
      opt.textContent = t('editor.toolbar.preset_option.label', {
        number: lvl.number,
        title: this.resolveLevelTitle(lvl)
      });
      if (lvl.id === this.currentLevelId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  }

  private bindToolbarEvents(): void {
    document.getElementById('editor-new-btn')?.addEventListener('click', () => {
      if (this.isDirty && !window.confirm(t('editor.toolbar.confirm_discard.label'))) {
        return;
      }
      this.initBlankMap();
    });

    document.getElementById('editor-undo-btn')?.addEventListener('click', () => {
      this.undo();
    });

    document.getElementById('editor-redo-btn')?.addEventListener('click', () => {
      this.redo();
    });

    document.getElementById('editor-test-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled);
      let issuesText = '';
      if (!report.valid && report.issues.length > 0) {
        issuesText = this.formatIssues(report.issues);
        this.setStatusText(issuesText);
        if (!window.confirm(t('editor.toolbar.confirm_test_invalid.label', { issues: issuesText }))) {
          return;
        }
      }
      this.onTestPlay(compiled);
      if (issuesText) {
        // The editor view is hidden during test play: surface the issues there.
        this.onNotify(issuesText);
      }
    });

    document.getElementById('editor-validate-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled);
      if (report.valid) {
        this.setStatusText(
          t('validator.status.valid.label', {
            chips: report.stats.reachableChips,
            required: report.stats.chipsRequired
          })
        );
      } else {
        this.setStatusText(this.formatIssues(report.issues));
      }
    });

    document.getElementById('editor-save-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      // From now on this editor session updates the saved custom level.
      this.currentLevelId = compiled.id;
      this.draftCustomId = null;
      const idx = ConfigRegistry.addOrUpdateCustomLevel(compiled);
      this.isDirty = false;
      this.populatePresetDropdown();
      this.setStatusText(t('editor.palette.status.saved'));
      this.onLevelSaved(idx);
    });

    document.getElementById('editor-export-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      downloadJson(compiled, `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.json`);
    });

    document.getElementById('editor-export-ccl-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      downloadBytes(
        DatCodec.encodeLevels([compiled]),
        `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.ccl`
      );
    });

    const importInput = document.getElementById('editor-import-input') as HTMLInputElement | null;
    document.getElementById('editor-import-btn')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (!file) return;
      if (this.isDirty && !window.confirm(t('editor.toolbar.confirm_discard.label'))) {
        importInput.value = '';
        return;
      }
      const lower = file.name.toLowerCase();

      if (lower.endsWith('.dat') || lower.endsWith('.ccl')) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const buffer = reader.result as ArrayBuffer;
            const decoded = DatCodec.decodeBuffer(buffer, file.name.replace(/\.[^.]+$/, ''));
            if (decoded.length > 0) {
              this.loadCompiledLevel(decoded[0]);
              this.setStatusText(t('editor.palette.status.imported'));
            }
          } catch {
            this.setStatusText(t('editor.palette.status.import_error'));
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result)) as LevelBlueprint & Partial<CompiledLevel>;
            const compiled = ConfigRegistry.compileBlueprint({
              ...parsed,
              itemGrid:
                parsed.items && Array.isArray(parsed.items[0])
                  ? (parsed.items as unknown as (string | null)[][])
                  : parsed.itemGrid
            });
            this.loadCompiledLevel(compiled);
            this.setStatusText(t('editor.palette.status.imported'));
          } catch (err) {
            const message =
              err instanceof InvalidLevelError
                ? t('editor.palette.status.invalid_level.label', { id: err.levelId })
                : t('editor.palette.status.import_error');
            this.setStatusText(message);
            this.onNotify(message);
          }
        };
        reader.readAsText(file);
      }
      importInput.value = '';
    });

    const presetSelect = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
    presetSelect?.addEventListener('change', () => {
      if (this.isDirty && !window.confirm(t('editor.toolbar.confirm_discard.label'))) {
        presetSelect.value = this.currentLevelId;
        return;
      }
      const found = ConfigRegistry.getLevels().find((l) => l.id === presetSelect.value);
      if (found) {
        this.loadCompiledLevel(found);
      }
    });

    document.getElementById('editor-autocount-btn')?.addEventListener('click', () => {
      let count = 0;
      for (const row of this.items) {
        for (const cell of row) {
          if (cell === 'chip') count++;
        }
      }
      if (count !== this.chipsRequired) {
        this.isDirty = true;
      }
      this.chipsRequired = count;
      const chipsInput = document.getElementById('editor-meta-chips') as HTMLInputElement | null;
      if (chipsInput) chipsInput.value = String(count);
    });

    const dirSelect = document.getElementById('editor-meta-dir') as HTMLSelectElement | null;
    dirSelect?.addEventListener('change', () => {
      this.activeDir = (dirSelect.value as Direction) || 'S';
    });
  }

  private bindMetadataEvents(): void {
    for (const id of METADATA_INPUT_IDS) {
      document.getElementById(id)?.addEventListener('input', () => {
        this.isDirty = true;
      });
    }
  }

  private syncMetadataInputs(): void {
    const titleEl = document.getElementById('editor-meta-title') as HTMLInputElement | null;
    const hintEl = document.getElementById('editor-meta-hint') as HTMLInputElement | null;
    const passEl = document.getElementById('editor-meta-password') as HTMLInputElement | null;
    const timeEl = document.getElementById('editor-meta-time') as HTMLInputElement | null;
    const chipsEl = document.getElementById('editor-meta-chips') as HTMLInputElement | null;

    if (titleEl) titleEl.value = this.customTitle;
    if (hintEl) hintEl.value = this.customHint;
    if (passEl) passEl.value = this.password;
    if (timeEl) timeEl.value = String(this.timeLimitSeconds);
    if (chipsEl) chipsEl.value = String(this.chipsRequired);
  }

  private readMetadataInputs(): void {
    const titleEl = document.getElementById('editor-meta-title') as HTMLInputElement | null;
    const hintEl = document.getElementById('editor-meta-hint') as HTMLInputElement | null;
    const passEl = document.getElementById('editor-meta-password') as HTMLInputElement | null;
    const timeEl = document.getElementById('editor-meta-time') as HTMLInputElement | null;
    const chipsEl = document.getElementById('editor-meta-chips') as HTMLInputElement | null;

    if (titleEl && titleEl.value.trim()) this.customTitle = titleEl.value.trim();
    if (hintEl) this.customHint = hintEl.value.trim();
    if (passEl && passEl.value.trim()) {
      this.password = passEl.value.trim().toUpperCase().slice(0, EDITOR_PASSWORD_LENGTH);
    }
    if (timeEl) this.timeLimitSeconds = Math.max(0, Number(timeEl.value) || EDITOR_DEFAULT_TIME_LIMIT_SECONDS);
    if (chipsEl) this.chipsRequired = Math.max(0, Number(chipsEl.value) || 0);
  }

  private createSnapshot(): EditorSnapshot {
    return {
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      trapLinks: this.trapLinks.map((l) => ({ ...l })),
      cloneLinks: this.cloneLinks.map((l) => ({ ...l })),
      playerStart: { ...this.playerStart }
    };
  }

  private restoreSnapshot(snap: EditorSnapshot): void {
    this.terrain = snap.terrain.map((r) => [...r]);
    this.items = snap.items.map((r) => [...r]);
    this.entities = snap.entities.map((e) => ({ ...e }));
    this.trapLinks = snap.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = snap.cloneLinks.map((l) => ({ ...l }));
    this.playerStart = { ...snap.playerStart };
    this.render();
  }

  private pushUndoState(): void {
    const maxUndo = ConfigRegistry.getGame().timing.maxUndoSnapshots || TIMING_DEFAULTS.maxUndoSnapshots;
    if (this.undoStack.length >= maxUndo) {
      this.undoStack.shift();
    }
    this.undoStack.push(this.createSnapshot());
    this.redoStack = [];
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  public undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.createSnapshot());
    this.restoreSnapshot(prev);
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.createSnapshot());
    this.restoreSnapshot(next);
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = document.getElementById('editor-undo-btn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('editor-redo-btn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  private pickBrushAt(x: number, y: number): void {
    const ent = this.entities.find((e) => e.x === x && e.y === y);
    if (ent) {
      const def = ConfigRegistry.getEntityDef(ent.type);
      this.activeCategory = def?.category || 'entities';
      this.activeBrush = { kind: 'entity', id: ent.type };
      this.activeDir = ent.dir;
      const dirSelect = document.getElementById('editor-meta-dir') as HTMLSelectElement | null;
      if (dirSelect) dirSelect.value = ent.dir;
      this.renderCategoryTabs();
      this.renderPaletteItems();
      this.setStatusText(
        t('editor.palette.status.picked.label', {
          name: def ? t(def.i18nKey) : ent.type
        })
      );
      return;
    }

    const item = this.items[y]?.[x];
    if (item) {
      const tileDef = ConfigRegistry.getTile(item);
      this.activeCategory = tileDef.category;
      this.activeBrush = { kind: 'item', id: item };
      this.renderCategoryTabs();
      this.renderPaletteItems();
      this.setStatusText(
        t('editor.palette.status.picked.label', { name: t(tileDef.i18nKey) })
      );
      return;
    }

    const terr = this.terrain[y]?.[x] || 'floor';
    const tileDef = ConfigRegistry.getTile(terr);
    this.activeCategory = tileDef.category;
    this.activeBrush = { kind: 'terrain', id: terr };
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.setStatusText(
      t('editor.palette.status.picked.label', { name: t(tileDef.i18nKey) })
    );
  }

  private bindCanvasEvents(): void {
    const getCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const { editorTilePixelSize, mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
      const x = Math.floor(((clientX - rect.left) * scaleX) / editorTilePixelSize);
      const y = Math.floor(((clientY - rect.top) * scaleY) / editorTilePixelSize);
      if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return null;
      return { x, y };
    };

    this.canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
    });

    this.canvas.addEventListener('pointerdown', (ev) => {
      const coords = getCoords(ev.clientX, ev.clientY);
      if (!coords) return;
      ev.preventDefault();
      this.canvas.setPointerCapture(ev.pointerId);

      if (ev.altKey || ev.button === 1) {
        this.pickBrushAt(coords.x, coords.y);
        return;
      }

      this.pushUndoState();
      this.isPainting = true;
      this.isRightErasing = ev.button === 2;
      this.applyBrushAt(coords.x, coords.y, this.isRightErasing);
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      const coords = getCoords(ev.clientX, ev.clientY);
      if (!coords) return;
      this.setCoordsText(t('editor.palette.status.coords', { x: coords.x, y: coords.y }));
      if (
        this.isPainting &&
        !this.fillMode &&
        this.activeBrush.kind !== 'wire_trap' &&
        this.activeBrush.kind !== 'wire_cloner'
      ) {
        this.applyBrushAt(coords.x, coords.y, this.isRightErasing);
      }
    });

    const stopPainting = (): void => {
      this.isPainting = false;
      this.isRightErasing = false;
    };

    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);
  }

  private applyBrushAt(x: number, y: number, forceEraser: boolean = false): void {
    const brush: ActiveBrush = forceEraser ? { kind: 'eraser', id: 'eraser' } : this.activeBrush;

    if (!forceEraser && this.fillMode && brush.kind === 'terrain') {
      this.floodFillTerrain(x, y, this.terrain[y][x], brush.id);
      this.render();
      return;
    }

    if (brush.kind === 'wire_trap') {
      if (!this.pendingWireSource) {
        this.terrain[y][x] = 'button_brown';
        this.pendingWireSource = { x, y };
        this.setStatusText(t('editor.palette.status.wire_select_target'));
      } else {
        this.terrain[y][x] = 'trap';
        this.trapLinks.push({
          buttonX: this.pendingWireSource.x,
          buttonY: this.pendingWireSource.y,
          trapX: x,
          trapY: y
        });
        this.pendingWireSource = null;
        this.setStatusText(t('editor.palette.status.wire_linked'));
      }
      this.render();
      return;
    }

    if (brush.kind === 'wire_cloner') {
      if (!this.pendingWireSource) {
        this.terrain[y][x] = 'button_red';
        this.pendingWireSource = { x, y };
        this.setStatusText(t('editor.palette.status.wire_select_target'));
      } else {
        this.terrain[y][x] = 'clone_machine';
        const existingEnt = this.entities.find((e) => e.x === x && e.y === y);
        this.cloneLinks.push({
          buttonX: this.pendingWireSource.x,
          buttonY: this.pendingWireSource.y,
          clonerX: x,
          clonerY: y,
          templateType: existingEnt?.type || EDITOR_DEFAULT_CLONE_TEMPLATE,
          templateDir: existingEnt?.dir || this.activeDir
        });
        this.pendingWireSource = null;
        this.setStatusText(t('editor.palette.status.wire_linked'));
      }
      this.render();
      return;
    }

    if (brush.kind === 'eraser') {
      this.terrain[y][x] = 'floor';
      this.items[y][x] = null;
      this.entities = this.entities.filter((e) => !(e.x === x && e.y === y));
      this.trapLinks = this.trapLinks.filter(
        (l) => !(l.buttonX === x && l.buttonY === y) && !(l.trapX === x && l.trapY === y)
      );
      this.cloneLinks = this.cloneLinks.filter(
        (l) => !(l.buttonX === x && l.buttonY === y) && !(l.clonerX === x && l.clonerY === y)
      );
    } else if (brush.kind === 'terrain') {
      this.terrain[y][x] = brush.id;
    } else if (brush.kind === 'item') {
      this.items[y][x] = brush.id;
    } else if (brush.kind === 'entity') {
      this.entities = this.entities.filter((e) => !(e.x === x && e.y === y));
      this.entities.push({ x, y, type: brush.id, dir: this.activeDir });
    } else if (brush.kind === 'player_start') {
      this.playerStart = { x, y, dir: this.activeDir };
    }

    this.render();
  }

  private floodFillTerrain(startX: number, startY: number, targetId: string, replacementId: string): void {
    if (targetId === replacementId) return;
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const key = `${curr.x},${curr.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (curr.x < 0 || curr.x >= mapWidth || curr.y < 0 || curr.y >= mapHeight) continue;
      if (this.terrain[curr.y][curr.x] !== targetId) continue;

      this.terrain[curr.y][curr.x] = replacementId;
      queue.push(
        { x: curr.x + 1, y: curr.y },
        { x: curr.x - 1, y: curr.y },
        { x: curr.x, y: curr.y + 1 },
        { x: curr.x, y: curr.y - 1 }
      );
    }
  }

  public render(): void {
    const { mapWidth, mapHeight, editorTilePixelSize } = ConfigRegistry.getGame().grid;
    const s = editorTilePixelSize;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        this.renderer.drawTile(this.ctx, this.terrain[y][x], x * s, y * s, s, true, true);
        const item = this.items[y][x];
        if (item) {
          this.renderer.drawItem(this.ctx, item, x * s, y * s, s);
        }
      }
    }

    for (const ent of this.entities) {
      this.renderer.drawEntity(this.ctx, ent.type, ent.dir, ent.x * s, ent.y * s, s);
    }

    this.renderer.drawPlayer(
      this.ctx,
      this.playerStart.x * s,
      this.playerStart.y * s,
      s,
      this.playerStart.dir,
      false,
      true
    );

    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    for (const link of this.trapLinks) {
      this.drawLinkLine(EDITOR_TRAP_LINK_COLOR, link.buttonX, link.buttonY, link.trapX, link.trapY, s);
    }
    for (const link of this.cloneLinks) {
      this.drawLinkLine(EDITOR_CLONE_LINK_COLOR, link.buttonX, link.buttonY, link.clonerX, link.clonerY, s);
    }
  }

  private drawLinkLine(color: string, fromX: number, fromY: number, toX: number, toY: number, s: number): void {
    const c = EDITOR_TILE_CENTER_OFFSET;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo((fromX + c) * s, (fromY + c) * s);
    this.ctx.lineTo((toX + c) * s, (toY + c) * s);
    this.ctx.stroke();
  }

  /**
   * Id under which this map is saved. A custom level keeps its id; any other
   * level gets one custom id, generated on first use and reused afterwards,
   * so saving twice updates one copy instead of creating two.
   */
  private resolveCustomLevelId(): string {
    if (this.currentLevelId.startsWith(CUSTOM_LEVEL_ID_PREFIX)) {
      return this.currentLevelId;
    }
    if (!this.draftCustomId) {
      this.draftCustomId = `${CUSTOM_LEVEL_ID_PREFIX}${Date.now()}`;
    }
    return this.draftCustomId;
  }

  public exportCompiledLevel(): CompiledLevel {
    const id = this.resolveCustomLevelId();
    const existing = ConfigRegistry.getAllPacks()
      .find((p) => p.id === BUILTIN_PACK_IDS.CUSTOM)
      ?.levels.find((l) => l.id === id);
    return {
      id,
      number: existing ? existing.number : ConfigRegistry.getLevels().length + 1,
      customTitle: this.customTitle,
      customHint: this.customHint,
      password: this.password,
      timeLimitSeconds: this.timeLimitSeconds,
      chipsRequired: this.chipsRequired,
      playerStart: { ...this.playerStart },
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      trapLinks: this.trapLinks.map((l) => ({ ...l })),
      cloneLinks: this.cloneLinks.map((l) => ({ ...l }))
    };
  }

  private setCoordsText(msg: string): void {
    const el = document.getElementById('editor-coords-badge');
    if (el) el.textContent = msg;
  }

  private setStatusText(msg: string): void {
    const el = document.getElementById('editor-status-bar');
    if (el) el.textContent = msg;
  }
}
