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
 * The "Cell" section of the editor inspector: a place where the mechanism on the picked cell shows the settings that the
 * palette cannot carry (the tracks of a track cell, for one). A panel draws itself for a cell and hands every edit to the
 * editor as a whole new map, which the editor puts in the document as one history step.
 */

import type { EditorDocument, EditorMap } from './editorDocument';

/** A grid position. */
export interface CellPosition {
  x: number;
  y: number;
}

/** What a panel gets from the editor: the way to commit an edit through the editor history. */
export interface CellPanelHost {
  /** Puts a map made by an edit in the document as one history step; false when it changed nothing. */
  commit(map: EditorMap, messages?: Array<{ key: string; params?: Record<string, string | number> }>): boolean;
}

/** One kind of cell settings. */
export interface CellPanel {
  /** The content for the cell, or null when the panel has nothing to say about it. */
  render(doc: EditorDocument, x: number, y: number): HTMLElement | null;
}

/** Attribute of the control that takes the focus when the focused one is gone after a redraw. */
export const CELL_FOCUS_FALLBACK_ATTRIBUTE = 'data-focus-fallback';

/** Attribute that names an element a rebuild of the section must give the focus back to. */
export const CELL_FOCUS_ATTRIBUTE = 'data-focus-key';

/**
 * Keeps the Cell section in line with the picked cell. The section is hidden while no panel has content. It is redrawn
 * only when the document, the cell or the language changed, and while the focus or the pointer is inside it the cell it
 * shows stays the same, so a control does not move under the click.
 */
export class CellSection {
  private shown: CellPosition | null = null;
  private key = '';
  private pointerInside = false;
  private drawing = false;
  private readonly controller = new AbortController();

  constructor(
    private readonly section: HTMLElement,
    private readonly body: HTMLElement,
    private readonly panels: readonly CellPanel[],
    /** Called when the pointer leaves the section, so the editor hands it back to the picked cell. */
    private readonly onRelease: () => void
  ) {
    const options = { signal: this.controller.signal };
    section.addEventListener('pointerenter', () => (this.pointerInside = true), options);
    section.addEventListener(
      'pointerleave',
      () => {
        this.pointerInside = false;
        this.onRelease();
      },
      options
    );
    section.addEventListener(
      'focusout',
      (ev) => {
        // A rebuild drops and gives back the focus itself: that is not the focus leaving.
        if (this.drawing) return;
        const next = ev.relatedTarget;
        if (!(next instanceof Node && section.contains(next))) this.onRelease();
      },
      options
    );
  }

  /** Forgets the listeners; the section is not drawn again. */
  public dispose(): void {
    this.controller.abort();
    this.body.replaceChildren();
  }

  /**
   * Redraws the section when `revision` (anything that changes what a panel shows besides the cell) or the cell changed.
   * `picked` is the cell the editor points at; it is ignored while the focus or the pointer is inside the section.
   */
  public update(doc: EditorDocument, picked: CellPosition | null, revision: string): void {
    const inside = this.body.contains(document.activeElement) || this.pointerInside;
    const cell = inside && this.shown ? this.shown : picked;
    const key = `${revision}:${cell?.x ?? ''}:${cell?.y ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    this.shown = cell;
    this.draw(doc, cell);
  }

  private draw(doc: EditorDocument, cell: CellPosition | null): void {
    const focusKey = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement)
      ? document.activeElement.getAttribute(CELL_FOCUS_ATTRIBUTE)
      : null;
    this.drawing = true;
    try {
      this.body.replaceChildren();
      if (cell) {
        for (const panel of this.panels) {
          const content = panel.render(doc, cell.x, cell.y);
          if (content) this.body.appendChild(content);
        }
      }
      this.section.classList.toggle('hidden', this.body.childElementCount === 0);
      if (focusKey !== null) {
        const again = Array.from(this.body.querySelectorAll<HTMLElement>(`[${CELL_FOCUS_ATTRIBUTE}]`)).find(
          (el) => el.getAttribute(CELL_FOCUS_ATTRIBUTE) === focusKey
        );
        // A control that is gone (the radio of a switch that went) hands the focus to the segments instead of dropping it.
        (again ?? this.body.querySelector<HTMLElement>(`[${CELL_FOCUS_FALLBACK_ATTRIBUTE}]`))?.focus();
      }
    } finally {
      this.drawing = false;
    }
  }
}
