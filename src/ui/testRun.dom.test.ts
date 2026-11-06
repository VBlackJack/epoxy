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
import { firstVisibleOverlayAction, focusAfterRating, overlayButtons } from './testRun';
import type { OverlayState } from './testRun';

const BUTTON_IDS: Record<keyof ReturnType<typeof overlayButtons>, string> = {
  resume: 'overlay-btn-resume',
  next: 'overlay-btn-next',
  replay: 'overlay-btn-replay',
  undo: 'overlay-btn-undo',
  retry: 'overlay-btn-retry',
  backToEditor: 'overlay-btn-back-to-editor',
  rate: 'overlay-btn-rate'
};

function focusedIdFor(
  state: OverlayState,
  testPlaying: boolean,
  canUndo: boolean,
  touchOverlay = false,
  canRate = false
): string | undefined {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  const shown = overlayButtons(state, testPlaying, canUndo, touchOverlay, canRate);
  for (const [key, id] of Object.entries(BUTTON_IDS)) {
    document.getElementById(id)?.classList.toggle('hidden', !shown[key as keyof typeof shown]);
  }
  const overlay = document.getElementById('viewport-overlay') as HTMLElement;
  return firstVisibleOverlayAction(overlay, state)?.id;
}

describe('firstVisibleOverlayAction on the shipped overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('puts Back to editor first after a won test run', () => {
    expect(focusedIdFor('complete', true, false)).toBe('overlay-btn-back-to-editor');
  });

  it('keeps Undo first after a lost test run when undo is available', () => {
    expect(focusedIdFor('dead', true, true)).toBe('overlay-btn-undo');
  });

  it('falls back to Retry after a lost test run without undo', () => {
    expect(focusedIdFor('dead', true, false)).toBe('overlay-btn-retry');
  });

  it('keeps Resume first while a test run is paused, with the way back available', () => {
    expect(focusedIdFor('paused', true, false, true)).toBe('overlay-btn-resume');
    const html = document.getElementById('overlay-btn-back-to-editor');
    expect(html?.classList.contains('hidden')).toBe(false);
  });

  it('puts Next first after a normal win', () => {
    expect(focusedIdFor('complete', false, false)).toBe('overlay-btn-next');
  });

  it('shows the rating button right after Next, only when a rating can be given', () => {
    expect(focusedIdFor('complete', false, false, false, true)).toBe('overlay-btn-next');
    const next = document.getElementById('overlay-btn-next') as HTMLElement;
    const rate = document.getElementById('overlay-btn-rate') as HTMLElement;
    expect(rate.classList.contains('hidden')).toBe(false);
    expect(next.nextElementSibling).toBe(rate);
    focusedIdFor('complete', false, false, false, false);
    expect(document.getElementById('overlay-btn-rate')?.classList.contains('hidden')).toBe(true);
  });
});

describe('focus after the rating form closes', () => {
  it.each(['submit', 'skip'])('lands on Next after %s, once the rating button is hidden', () => {
    focusedIdFor('complete', false, false, false, true);
    const rate = document.getElementById('overlay-btn-rate') as HTMLButtonElement;
    rate.focus();
    expect(document.activeElement).toBe(rate);
    focusedIdFor('complete', false, false, false, false);
    rate.focus();
    focusAfterRating(document.getElementById('viewport-overlay') as HTMLElement);
    expect(document.activeElement?.id).toBe('overlay-btn-next');
  });
});
