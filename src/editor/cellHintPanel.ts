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
 * The Cell section panel of a hint tile: a text box for the text that single tile shows, in place of the level hint
 * (left empty, the tile shows the level hint), and a button that clears it. Every edit goes through editorCellHints and
 * the editor history.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { t } from '../i18n/I18nManager';
import { CELL_FOCUS_ATTRIBUTE, CELL_FOCUS_FALLBACK_ATTRIBUTE, type CellPanel, type CellPanelHost } from './cellPanel';
import { cellHintAt, setCellHint } from './editorCellHints';
import { cloneMap, type EditorDocument, type EditorMap } from './editorDocument';

const HEADING_KEY = 'editor.cell_hint.heading';
const TEXT_LABEL_KEY = 'editor.cell_hint.text.label';
const EMPTY_KEY = 'editor.cell_hint.empty.note';
const CLEAR_KEY = 'editor.cell_hint.clear.action';
const STATUS_SET_KEY = 'editor.cell_hint.status.set.label';
const STATUS_CLEARED_KEY = 'editor.cell_hint.status.cleared.label';

/** Class names of the panel parts (styled in style.css). */
const PANEL_CLASS = 'editor-cell-hint-panel';
const HEADING_CLASS = 'editor-cell-hint-heading';
const TEXT_CLASS = 'editor-cell-hint-text';

/** Rows of the text box. */
const TEXT_ROWS = 4;

/** The map with the hint text of the tile at (x, y) set, or null when the cell is no hint tile or nothing changed. */
export function withCellHint(map: EditorMap, x: number, y: number, text: string): EditorMap | null {
  if (map.cc3d) return null;
  const result = cloneMap(map);
  return setCellHint(result, x, y, text) ? result : null;
}

export class CellHintPanel implements CellPanel {
  constructor(private readonly host: CellPanelHost, private readonly getDoc: () => EditorDocument) {}

  public render(doc: EditorDocument, x: number, y: number): HTMLElement | null {
    const topId = doc.terrain[y]?.[x];
    if (doc.cc3d || topId === undefined || !ConfigRegistry.isTerrainTile(topId) || ConfigRegistry.getTile(topId).showsHint !== true) return null;
    const text = cellHintAt(doc, x, y) ?? '';
    const root = document.createElement('div');
    root.className = PANEL_CLASS;

    const heading = document.createElement('h4');
    heading.className = HEADING_CLASS;
    heading.textContent = t(HEADING_KEY, { x, y });
    root.appendChild(heading);

    const label = document.createElement('label');
    label.textContent = t(TEXT_LABEL_KEY);
    const area = document.createElement('textarea');
    area.className = TEXT_CLASS;
    area.rows = TEXT_ROWS;
    area.maxLength = ConfigRegistry.getLevelTextLimits().hintMaxLength;
    area.value = text;
    area.setAttribute(CELL_FOCUS_ATTRIBUTE, 'text');
    area.setAttribute(CELL_FOCUS_FALLBACK_ATTRIBUTE, '');
    // The text is committed when the box loses the focus or the value is confirmed, not at every key.
    area.addEventListener('change', () => this.apply(x, y, area.value));
    label.appendChild(area);
    root.appendChild(label);

    if (text === '') {
      const empty = document.createElement('p');
      empty.className = 'hint-text';
      empty.textContent = t(EMPTY_KEY);
      root.appendChild(empty);
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'hud-btn small';
    clear.dataset.action = 'clear';
    clear.setAttribute(CELL_FOCUS_ATTRIBUTE, 'clear');
    clear.disabled = text === '';
    clear.textContent = t(CLEAR_KEY);
    clear.addEventListener('click', () => this.apply(x, y, ''));
    root.appendChild(clear);
    return root;
  }

  private apply(x: number, y: number, text: string): void {
    const map = withCellHint(this.getDoc(), x, y, text);
    if (map) this.host.commit(map, [{ key: text.trim() === '' ? STATUS_CLEARED_KEY : STATUS_SET_KEY, params: { x, y } }]);
  }
}
