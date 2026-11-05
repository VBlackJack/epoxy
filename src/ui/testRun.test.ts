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
import { levelNavigationBlocked, nextLevelGoesToEditor, overlayButtons, testRunKeyReturns, testRunStatus } from './testRun';

describe('overlayButtons', () => {
  it('shows Next and Replay on a normal win and no way back to the editor', () => {
    const b = overlayButtons('complete', false, false);
    expect(b).toMatchObject({ next: true, replay: true, backToEditor: false, retry: true });
  });

  it('hides Next and Replay on a won test run and offers the way back', () => {
    const b = overlayButtons('complete', true, false);
    expect(b).toMatchObject({ next: false, replay: false, backToEditor: true });
  });

  it('keeps Retry and Undo on a lost test run and offers the way back', () => {
    const b = overlayButtons('dead', true, true);
    expect(b).toMatchObject({ backToEditor: true, retry: true, undo: true, next: false });
  });

  it('does not offer the way back on a normal death or pause, nor while playing', () => {
    expect(overlayButtons('dead', false, true).backToEditor).toBe(false);
    expect(overlayButtons('paused', false, false).backToEditor).toBe(false);
    expect(overlayButtons('none', true, true)).toMatchObject({ backToEditor: false, retry: false, undo: false });
  });

  it('keeps the classic layout as it was: no way back while a test run is paused', () => {
    expect(overlayButtons('paused', true, false)).toMatchObject({ backToEditor: false, resume: true });
  });

  it('offers the way back while a test run is paused in the phone overlay layout, next to Resume', () => {
    expect(overlayButtons('paused', true, false, true)).toMatchObject({ backToEditor: true, resume: true });
    expect(overlayButtons('paused', false, false, true).backToEditor).toBe(false);
  });
});

describe('test run key seams', () => {
  it('Escape returns only a finished test run', () => {
    expect(testRunKeyReturns('Escape', 'complete', true)).toBe(true);
    expect(testRunKeyReturns('Escape', 'dead', true)).toBe(true);
    expect(testRunKeyReturns('Escape', 'none', true)).toBe(false);
    expect(testRunKeyReturns('Escape', 'paused', true)).toBe(false);
    expect(testRunKeyReturns('Escape', 'complete', false)).toBe(false);
    expect(testRunKeyReturns('Enter', 'complete', true)).toBe(false);
  });

  it('next goes to the editor only for a completed test run', () => {
    expect(nextLevelGoesToEditor(true, true)).toBe(true);
    expect(nextLevelGoesToEditor(true, false)).toBe(false);
    expect(nextLevelGoesToEditor(false, true)).toBe(false);
  });

  it('level navigation is blocked only mid test run', () => {
    expect(levelNavigationBlocked(true, false)).toBe(true);
    expect(levelNavigationBlocked(true, true)).toBe(false);
    expect(levelNavigationBlocked(false, false)).toBe(false);
  });
});

describe('testRunStatus', () => {
  it('names the moves of a win when they are known', () => {
    expect(testRunStatus('complete', 12, null)).toEqual({
      key: 'editor.test_run.won_moves.label',
      params: { moves: 12 }
    });
  });

  it('falls back to a plain win without moves', () => {
    expect(testRunStatus('complete', 0, null)?.key).toBe('editor.test_run.won.label');
  });

  it('carries the death reason of a loss', () => {
    expect(testRunStatus('dead', 3, 'Burnt')).toEqual({
      key: 'editor.test_run.lost_reason.label',
      params: { reason: 'Burnt' }
    });
    expect(testRunStatus('dead', 3, null)?.key).toBe('editor.test_run.lost.label');
  });

  it('says nothing when the run did not end', () => {
    expect(testRunStatus('none', 5, null)).toBeNull();
    expect(testRunStatus('paused', 5, null)).toBeNull();
  });
});
