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

import { describe, expect, it } from 'vitest';
import { KeyChord } from '../ui/inputGuards';
import { EDITOR_ONE_COLUMN_BELOW_WIDTH, EDITOR_TWO_COLUMN_BELOW_WIDTH } from '../ui/uiConstants';
import { summarizeValidation } from './checkSummary';
import { getCanvasKeyAction, getEditorKeyAction, getSelectionKeyAction, moveCursor, rotateClockwise } from './editorKeyboard';
import { layoutModeForWidth } from './editorLayout';
import { DEFAULT_SECTION_STATE, parseSectionState, serializeSectionState } from './inspectorSections';
import { MetadataEditCoalescer } from './metadataCoalescer';
import { ResizeResult } from './mapEdits';
import { describeResize } from './resizeReport';

function chord(key: string, extra: Partial<KeyChord> = {}): KeyChord {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
}

describe('getEditorKeyAction', () => {
  it('maps the tool letters, case-insensitively', () => {
    expect(getEditorKeyAction(chord('b'))).toEqual({ kind: 'tool', tool: 'brush' });
    expect(getEditorKeyAction(chord('F'))).toEqual({ kind: 'tool', tool: 'fill' });
    expect(getEditorKeyAction(chord('e'))).toEqual({ kind: 'tool', tool: 'eraser' });
    expect(getEditorKeyAction(chord('i'))).toEqual({ kind: 'tool', tool: 'picker' });
    expect(getEditorKeyAction(chord('S'))).toEqual({ kind: 'tool', tool: 'select' });
  });

  it('maps rotate, zoom and cancel', () => {
    expect(getEditorKeyAction(chord('r'))).toEqual({ kind: 'rotate' });
    expect(getEditorKeyAction(chord('+'))).toEqual({ kind: 'zoom_in' });
    expect(getEditorKeyAction(chord('='))).toEqual({ kind: 'zoom_in' });
    expect(getEditorKeyAction(chord('-'))).toEqual({ kind: 'zoom_out' });
    expect(getEditorKeyAction(chord('0'))).toEqual({ kind: 'zoom_fit' });
    expect(getEditorKeyAction(chord('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('falls back to the key code on a layout without Latin letters', () => {
    expect(getEditorKeyAction(chord('и',{ code: 'KeyB' }))).toEqual({ kind: 'tool', tool: 'brush' });
  });

  it('leaves command chords and unrelated keys alone', () => {
    expect(getEditorKeyAction(chord('b', { ctrlKey: true }))).toBeNull();
    expect(getEditorKeyAction(chord('r', { metaKey: true }))).toBeNull();
    expect(getEditorKeyAction(chord('+', { altKey: true }))).toBeNull();
    expect(getEditorKeyAction(chord('x'))).toBeNull();
  });
});

describe('rotateClockwise', () => {
  it('turns N to E to S to W and back', () => {
    expect(rotateClockwise('N')).toBe('E');
    expect(rotateClockwise('E')).toBe('S');
    expect(rotateClockwise('S')).toBe('W');
    expect(rotateClockwise('W')).toBe('N');
  });
});

describe('canvas keyboard', () => {
  it('moves with the arrows and paints with Space or Enter', () => {
    expect(getCanvasKeyAction(chord('ArrowLeft'))).toEqual({ kind: 'move', dx: -1, dy: 0 });
    expect(getCanvasKeyAction(chord('ArrowDown'))).toEqual({ kind: 'move', dx: 0, dy: 1 });
    expect(getCanvasKeyAction(chord(' '))).toEqual({ kind: 'paint' });
    expect(getCanvasKeyAction(chord('Enter'))).toEqual({ kind: 'paint' });
    expect(getCanvasKeyAction(chord('ArrowUp', { ctrlKey: true }))).toBeNull();
    expect(getCanvasKeyAction(chord('a'))).toBeNull();
  });

  it('keeps the cursor inside the grid', () => {
    expect(moveCursor({ x: 0, y: 0 }, -1, -1, 5, 4)).toEqual({ x: 0, y: 0 });
    expect(moveCursor({ x: 4, y: 3 }, 1, 1, 5, 4)).toEqual({ x: 4, y: 3 });
    expect(moveCursor({ x: 2, y: 2 }, 1, -1, 5, 4)).toEqual({ x: 3, y: 1 });
  });
});

describe('layoutModeForWidth', () => {
  it('switches at the two breakpoints', () => {
    expect(layoutModeForWidth(EDITOR_TWO_COLUMN_BELOW_WIDTH)).toBe('three');
    expect(layoutModeForWidth(EDITOR_TWO_COLUMN_BELOW_WIDTH - 1)).toBe('two');
    expect(layoutModeForWidth(EDITOR_ONE_COLUMN_BELOW_WIDTH)).toBe('two');
    expect(layoutModeForWidth(EDITOR_ONE_COLUMN_BELOW_WIDTH - 1)).toBe('one');
    expect(layoutModeForWidth(Number.NaN)).toBe('one');
  });
});

describe('summarizeValidation', () => {
  const issue = (severity: 'error' | 'warning') => ({ severity, i18nKey: 'k' });

  it('is valid without issues', () => {
    expect(summarizeValidation({ issues: [] })).toEqual({ state: 'valid', count: 0 });
  });

  it('counts warnings when there are no errors', () => {
    expect(summarizeValidation({ issues: [issue('warning'), issue('warning')] })).toEqual({ state: 'warnings', count: 2 });
  });

  it('lets errors win and counts only them', () => {
    expect(summarizeValidation({ issues: [issue('warning'), issue('error')] })).toEqual({ state: 'errors', count: 1 });
  });
});

describe('MetadataEditCoalescer', () => {
  it('records the first edit of a field and folds the following ones', () => {
    const coalescer = new MetadataEditCoalescer();
    expect(coalescer.shouldRecord('title')).toBe(true);
    expect(coalescer.shouldRecord('title')).toBe(false);
    expect(coalescer.shouldRecord('hint')).toBe(true);
    expect(coalescer.shouldRecord('title')).toBe(true);
  });

  it('opens a new step after a reset', () => {
    const coalescer = new MetadataEditCoalescer();
    coalescer.shouldRecord('title');
    coalescer.reset();
    expect(coalescer.shouldRecord('title')).toBe(true);
  });

  it('records every edit of a one-gesture field and closes the open one', () => {
    const coalescer = new MetadataEditCoalescer();
    coalescer.shouldRecord('title');
    expect(coalescer.shouldRecord('ruleset', false)).toBe(true);
    expect(coalescer.shouldRecord('ruleset', false)).toBe(true);
    expect(coalescer.shouldRecord('title')).toBe(true);
  });
});

describe('describeResize', () => {
  const base: ResizeResult = {
    map: { terrain: [], items: [], entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 0, y: 0, dir: 'S' } },
    width: 10,
    height: 8,
    changed: true,
    report: { droppedEntities: 0, droppedTrapLinks: 0, droppedCloneLinks: 0, droppedEdges: 0, playerStartMoved: false, borderKept: false }
  };

  it('reports an unchanged size on its own', () => {
    expect(describeResize({ ...base, changed: false })).toEqual([
      { key: 'editor.layout.size.unchanged', params: { width: 10, height: 8 } }
    ]);
  });

  it('lists only what happened', () => {
    expect(describeResize(base)).toEqual([{ key: 'editor.layout.size.resized', params: { width: 10, height: 8 } }]);
    const notes = describeResize({
      ...base,
      report: { droppedEntities: 2, droppedTrapLinks: 1, droppedCloneLinks: 2, droppedEdges: 0, playerStartMoved: true, borderKept: true }
    });
    expect(notes.map((note) => note.key)).toEqual([
      'editor.layout.size.resized',
      'editor.layout.size.dropped_entities',
      'editor.layout.size.dropped_links',
      'editor.layout.size.start_moved',
      'editor.layout.size.border_kept'
    ]);
    expect(notes[2].params).toEqual({ count: 3 });
  });
});

describe('inspector section state', () => {
  it('starts with the generator closed', () => {
    expect(parseSectionState(null)).toEqual(DEFAULT_SECTION_STATE);
    expect(DEFAULT_SECTION_STATE.generate).toBe(false);
  });

  it('round-trips and ignores damaged values', () => {
    const state = { ...DEFAULT_SECTION_STATE, level: false, generate: true };
    expect(parseSectionState(serializeSectionState(state))).toEqual(state);
    expect(parseSectionState('not json')).toEqual(DEFAULT_SECTION_STATE);
    expect(parseSectionState('[1]')).toEqual(DEFAULT_SECTION_STATE);
    expect(parseSectionState('{"level":"no","rules":false}')).toEqual({ ...DEFAULT_SECTION_STATE, rules: false });
  });
});

describe('getSelectionKeyAction', () => {
  it('maps Ctrl and Meta with C, X and V', () => {
    expect(getSelectionKeyAction(chord('c', { ctrlKey: true }))).toEqual({ kind: 'copy' });
    expect(getSelectionKeyAction(chord('X', { ctrlKey: true }))).toEqual({ kind: 'cut' });
    expect(getSelectionKeyAction(chord('v', { metaKey: true }))).toEqual({ kind: 'paste' });
    expect(getSelectionKeyAction(chord('с', { ctrlKey: true, code: 'KeyC' }))).toEqual({ kind: 'copy' });
  });

  it('leaves the save, undo and redo chords and the bare letters alone', () => {
    expect(getSelectionKeyAction(chord('s', { ctrlKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('z', { ctrlKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('y', { ctrlKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('c'))).toBeNull();
    expect(getSelectionKeyAction(chord('c', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('c', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('maps Delete and Backspace to clear', () => {
    expect(getSelectionKeyAction(chord('Delete'))).toEqual({ kind: 'clear' });
    expect(getSelectionKeyAction(chord('Backspace'))).toEqual({ kind: 'clear' });
    expect(getSelectionKeyAction(chord('Delete', { ctrlKey: true }))).toBeNull();
  });

  it('maps Shift+F to the selection fill, checking the Shift key and not the case of the letter', () => {
    expect(getSelectionKeyAction(chord('F', { shiftKey: true }))).toEqual({ kind: 'fill' });
    expect(getSelectionKeyAction(chord('f', { shiftKey: true }))).toEqual({ kind: 'fill' });
    // Caps Lock gives a capital F with no Shift: that is still the fill tool.
    expect(getSelectionKeyAction(chord('F'))).toBeNull();
    expect(getEditorKeyAction(chord('F'))).toEqual({ kind: 'tool', tool: 'fill' });
    expect(getSelectionKeyAction(chord('f'))).toBeNull();
    expect(getEditorKeyAction(chord('f'))).toEqual({ kind: 'tool', tool: 'fill' });
  });

  it('leaves the command chords of F alone and falls back to the key code on other layouts', () => {
    expect(getSelectionKeyAction(chord('F', { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('F', { shiftKey: true, metaKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('F', { shiftKey: true, altKey: true }))).toBeNull();
    expect(getEditorKeyAction(chord('F', { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('А', { shiftKey: true, code: 'KeyF' }))).toEqual({ kind: 'fill' });
  });

  it('maps Alt with an arrow to a move, and leaves Shift and plain arrows to the cursor', () => {
    expect(getSelectionKeyAction(chord('ArrowLeft', { altKey: true }))).toEqual({ kind: 'move', dx: -1, dy: 0 });
    expect(getSelectionKeyAction(chord('ArrowDown', { altKey: true }))).toEqual({ kind: 'move', dx: 0, dy: 1 });
    expect(getSelectionKeyAction(chord('ArrowUp'))).toBeNull();
    expect(getSelectionKeyAction(chord('ArrowUp', { shiftKey: true }))).toBeNull();
    expect(getSelectionKeyAction(chord('ArrowUp', { altKey: true, shiftKey: true }))).toBeNull();
  });
});
