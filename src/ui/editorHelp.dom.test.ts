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

// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR_HELP_HEADING_ID, isEditorHelpKey, isTextEntryTarget, revealEditorHelp } from './editorHelp';

function mountShippedPage(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
}

describe('revealEditorHelp on the shipped page', () => {
  beforeEach(mountShippedPage);

  it('expands the More section and focuses the editor heading', () => {
    const modal = document.getElementById('help-modal') as HTMLElement;
    const more = modal.querySelector('details.help-more') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(revealEditorHelp(modal)).not.toBeNull();
    expect(more.open).toBe(true);
    expect(document.activeElement?.id).toBe(EDITOR_HELP_HEADING_ID);
  });

  it('restores the earlier open state of More, closed or open', () => {
    const modal = document.getElementById('help-modal') as HTMLElement;
    const more = modal.querySelector('details.help-more') as HTMLDetailsElement;
    revealEditorHelp(modal)?.();
    expect(more.open).toBe(false);
    more.open = true;
    revealEditorHelp(modal)?.();
    expect(more.open).toBe(true);
  });

  it('returns null for a modal without the editor section', () => {
    const empty = document.createElement('div');
    expect(revealEditorHelp(empty)).toBeNull();
  });

  it('ships the toolbar Shortcuts button and the overlay Back to editor button', () => {
    expect(document.getElementById('editor-shortcuts-btn')).not.toBeNull();
    const back = document.getElementById('overlay-btn-back-to-editor');
    expect(back?.classList.contains('hidden')).toBe(true);
    expect(back?.closest('.overlay-actions')).not.toBeNull();
  });
});

describe('isEditorHelpKey', () => {
  const base = { key: '?', ctrlKey: false, metaKey: false, altKey: false, target: null as EventTarget | null };

  it('accepts the produced ? character, AZERTY included', () => {
    expect(isEditorHelpKey(base)).toBe(true);
    expect(isEditorHelpKey({ ...base, key: '?', code: 'KeyM', shiftKey: true } as typeof base)).toBe(true);
  });

  it('refuses other keys and command modifiers', () => {
    expect(isEditorHelpKey({ ...base, key: '/' })).toBe(false);
    expect(isEditorHelpKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isEditorHelpKey({ ...base, altKey: true })).toBe(false);
    expect(isEditorHelpKey({ ...base, metaKey: true })).toBe(false);
  });

  it('refuses inputs and contenteditable targets', () => {
    expect(isEditorHelpKey({ ...base, target: document.createElement('input') })).toBe(false);
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isEditorHelpKey({ ...base, target: editable })).toBe(false);
    expect(isEditorHelpKey({ ...base, target: document.createElement('button') })).toBe(true);
  });
});

describe('isTextEntryTarget', () => {
  it('is true for fields where the user types', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTextEntryTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('is false for buttons, the body and a missing target', () => {
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
