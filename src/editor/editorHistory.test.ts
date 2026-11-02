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
import { EditorDocument } from './editorDocument';
import { EditorHistory } from './editorHistory';

function doc(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    terrain: [
      ['wall', 'wall'],
      ['wall', 'floor']
    ],
    items: [
      [null, null],
      [null, null]
    ],
    entities: [{ x: 1, y: 1, type: 'dirt_block', dir: 'S' }],
    trapLinks: [{ buttonX: 0, buttonY: 0, trapX: 1, trapY: 1 }],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' },
    title: 'A',
    hint: '',
    author: '',
    password: 'EDIT',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    winRule: 'exit',
    ruleset: undefined,
    ...overrides
  };
}

describe('EditorHistory', () => {
  it('returns null when there is nothing to undo or redo', () => {
    const history = new EditorHistory(5);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(doc())).toBeNull();
    expect(history.redo(doc())).toBeNull();
  });

  it('restores the ruleset when a laser stroke on a Lynx level is undone', () => {
    const history = new EditorHistory(5);
    const before = doc({ ruleset: 'lynx' });
    history.push(before);
    const after = doc({ ruleset: undefined, terrain: [['laser_emitter_n', 'wall'], ['wall', 'floor']] });
    const restored = history.undo(after);
    expect(restored?.ruleset).toBe('lynx');
    expect(restored?.terrain[0][0]).toBe('wall');
  });

  it('restores metadata and brings it back on redo', () => {
    const history = new EditorHistory(5);
    const before = doc({ title: 'Old', winRule: 'exit', chipsRequired: 2 });
    const after = doc({ title: 'New', winRule: 'targets', chipsRequired: 0 });
    history.push(before);
    const undone = history.undo(after);
    expect(undone).toMatchObject({ title: 'Old', winRule: 'exit', chipsRequired: 2 });
    const redone = history.redo(undone as EditorDocument);
    expect(redone).toMatchObject({ title: 'New', winRule: 'targets', chipsRequired: 0 });
    expect(history.canRedo()).toBe(false);
    expect(history.canUndo()).toBe(true);
  });

  it('clears the redo steps on a new push', () => {
    const history = new EditorHistory(5);
    history.push(doc({ title: '1' }));
    history.undo(doc({ title: '2' }));
    expect(history.canRedo()).toBe(true);
    history.push(doc({ title: '3' }));
    expect(history.canRedo()).toBe(false);
  });

  it('drops the oldest step past the limit', () => {
    const history = new EditorHistory(2);
    history.push(doc({ title: '1' }));
    history.push(doc({ title: '2' }));
    history.push(doc({ title: '3' }));
    expect(history.undo(doc())?.title).toBe('3');
    expect(history.undo(doc())?.title).toBe('2');
    expect(history.undo(doc())).toBeNull();
  });

  it('keeps at least one step whatever the limit', () => {
    const history = new EditorHistory(0);
    history.push(doc({ title: '1' }));
    history.push(doc({ title: '2' }));
    expect(history.undo(doc())?.title).toBe('2');
    expect(history.canUndo()).toBe(false);
  });

  it('deep-copies what it stores and what it returns', () => {
    const history = new EditorHistory(5);
    const source = doc();
    history.push(source);
    source.terrain[0][0] = 'floor';
    source.entities[0].x = 0;
    source.trapLinks[0].trapX = 0;
    const restored = history.undo(doc()) as EditorDocument;
    expect(restored.terrain[0][0]).toBe('wall');
    expect(restored.entities[0].x).toBe(1);
    expect(restored.trapLinks[0].trapX).toBe(1);
    const current = doc();
    history.push(doc());
    history.undo(current);
    current.terrain[0][0] = 'floor';
    const redone = history.redo(doc()) as EditorDocument;
    expect(redone.terrain[0][0]).toBe('wall');
  });

  it('forgets everything on clear', () => {
    const history = new EditorHistory(5);
    history.push(doc());
    history.undo(doc());
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
