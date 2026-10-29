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
  TrapLink
} from '../core/types';

type BrushKind = 'terrain' | 'item' | 'entity' | 'player_start' | 'eraser' | 'wire_trap' | 'wire_cloner';

interface ActiveBrush {
  kind: BrushKind;
  id: string;
}

export class LevelEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: PixelRenderer;
  private onTestPlay: (level: CompiledLevel) => void;
  private onLevelSaved: (levelIndex: number) => void;

  private terrain: string[][] = [];
  private items: (string | null)[][] = [];
  private entities: EntityPlacement[] = [];
  private trapLinks: TrapLink[] = [];
  private cloneLinks: CloneLink[] = [];
  private playerStart: { x: number; y: number; dir: Direction } = { x: 15, y: 15, dir: 'S' };

  private currentLevelId: string = 'custom_1';
  private customTitle: string = 'Custom Puzzle';
  private customHint: string = '';
  private password: string = 'EDIT';
  private timeLimitSeconds: number = 180;
  private chipsRequired: number = 4;

  private activeCategory: string = 'terrain';
  private activeBrush: ActiveBrush = { kind: 'terrain', id: 'wall' };
  private fillMode: boolean = false;
  private activeDir: Direction = 'S';
  private isPainting: boolean = false;
  private pendingWireSource: { x: number; y: number } | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    renderer: PixelRenderer,
    onTestPlay: (level: CompiledLevel) => void,
    onLevelSaved: (levelIndex: number) => void
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

    this.initBlankMap();
    this.bindCanvasEvents();
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
    this.currentLevelId = `custom_${Date.now()}`;
    this.syncMetadataInputs();
    this.render();
  }

  public loadCompiledLevel(level: CompiledLevel): void {
    this.currentLevelId = level.id;
    this.customTitle = level.customTitle || (level.titleKey ? t(level.titleKey) : level.id);
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
    this.syncMetadataInputs();
    this.render();
  }

  public buildUI(): void {
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.populatePresetDropdown();
    this.bindToolbarEvents();
    this.syncMetadataInputs();
    this.render();
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
      const title = lvl.customTitle || (lvl.titleKey ? t(lvl.titleKey) : lvl.id);
      opt.textContent = `#${lvl.number} - ${title}`;
      if (lvl.id === this.currentLevelId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
  }

  private bindToolbarEvents(): void {
    document.getElementById('editor-new-btn')?.addEventListener('click', () => {
      this.initBlankMap();
    });

    document.getElementById('editor-test-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled);
      if (!report.valid && report.issues.length > 0) {
        const firstIssue = report.issues[0];
        this.setStatusText(t(firstIssue.i18nKey, firstIssue.params));
      }
      this.onTestPlay(compiled);
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
        const messages = report.issues
          .map((iss) => t(iss.i18nKey, iss.params))
          .join(' | ');
        this.setStatusText(messages);
      }
    });

    document.getElementById('editor-save-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const idx = ConfigRegistry.addOrUpdateCustomLevel(compiled);
      this.populatePresetDropdown();
      this.setStatusText(t('editor.palette.status.saved'));
      this.onLevelSaved(idx);
    });

    document.getElementById('editor-export-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const blob = new Blob([JSON.stringify(compiled, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${compiled.id || 'epoxy_level'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('editor-export-ccl-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const bytes = DatCodec.encodeLevels([compiled]);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${compiled.id || 'epoxy_level'}.ccl`;
      a.click();
      URL.revokeObjectURL(url);
    });

    const importInput = document.getElementById('editor-import-input') as HTMLInputElement | null;
    document.getElementById('editor-import-btn')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (!file) return;
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
          } catch {
            this.setStatusText(t('editor.palette.status.import_error'));
          }
        };
        reader.readAsText(file);
      }
      importInput.value = '';
    });

    const presetSelect = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
    presetSelect?.addEventListener('change', () => {
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
      this.chipsRequired = count;
      const chipsInput = document.getElementById('editor-meta-chips') as HTMLInputElement | null;
      if (chipsInput) chipsInput.value = String(count);
    });

    const dirSelect = document.getElementById('editor-meta-dir') as HTMLSelectElement | null;
    dirSelect?.addEventListener('change', () => {
      this.activeDir = (dirSelect.value as Direction) || 'S';
    });
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
    if (passEl && passEl.value.trim()) this.password = passEl.value.trim().toUpperCase().slice(0, 4);
    if (timeEl) this.timeLimitSeconds = Math.max(0, Number(timeEl.value) || 180);
    if (chipsEl) this.chipsRequired = Math.max(0, Number(chipsEl.value) || 0);
  }

  private bindCanvasEvents(): void {
    const getCoords = (ev: MouseEvent): { x: number; y: number } | null => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const { editorTilePixelSize, mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
      const x = Math.floor(((ev.clientX - rect.left) * scaleX) / editorTilePixelSize);
      const y = Math.floor(((ev.clientY - rect.top) * scaleY) / editorTilePixelSize);
      if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return null;
      return { x, y };
    };

    this.canvas.addEventListener('mousedown', (ev) => {
      const coords = getCoords(ev);
      if (!coords) return;
      this.isPainting = true;
      this.applyBrushAt(coords.x, coords.y);
    });

    this.canvas.addEventListener('mousemove', (ev) => {
      const coords = getCoords(ev);
      if (!coords) return;
      this.setStatusText(t('editor.palette.status.coords', { x: coords.x, y: coords.y }));
      if (
        this.isPainting &&
        !this.fillMode &&
        this.activeBrush.kind !== 'wire_trap' &&
        this.activeBrush.kind !== 'wire_cloner'
      ) {
        this.applyBrushAt(coords.x, coords.y);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPainting = false;
    });
  }

  private applyBrushAt(x: number, y: number): void {
    const brush = this.activeBrush;

    if (this.fillMode && brush.kind === 'terrain') {
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
        this.cloneLinks.push({
          buttonX: this.pendingWireSource.x,
          buttonY: this.pendingWireSource.y,
          clonerX: x,
          clonerY: y,
          templateType: 'dirt_block',
          templateDir: this.activeDir
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

    this.ctx.lineWidth = 2;
    for (const link of this.trapLinks) {
      this.ctx.strokeStyle = '#ffb300';
      this.ctx.beginPath();
      this.ctx.moveTo((link.buttonX + 0.5) * s, (link.buttonY + 0.5) * s);
      this.ctx.lineTo((link.trapX + 0.5) * s, (link.trapY + 0.5) * s);
      this.ctx.stroke();
    }

    for (const link of this.cloneLinks) {
      this.ctx.strokeStyle = '#ff1744';
      this.ctx.beginPath();
      this.ctx.moveTo((link.buttonX + 0.5) * s, (link.buttonY + 0.5) * s);
      this.ctx.lineTo((link.clonerX + 0.5) * s, (link.clonerY + 0.5) * s);
      this.ctx.stroke();
    }
  }

  public exportCompiledLevel(): CompiledLevel {
    return {
      id: this.currentLevelId.startsWith('custom_') ? this.currentLevelId : `custom_${Date.now()}`,
      number: ConfigRegistry.getLevels().length + 1,
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

  private setStatusText(msg: string): void {
    const el = document.getElementById('editor-status-bar');
    if (el) el.textContent = msg;
  }
}
