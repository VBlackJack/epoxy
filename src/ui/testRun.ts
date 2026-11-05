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

/** What the end-of-run overlay shows. */
export type OverlayState = 'none' | 'complete' | 'dead' | 'paused';

/** Which overlay action buttons are visible. */
export interface OverlayButtons {
  resume: boolean;
  next: boolean;
  replay: boolean;
  undo: boolean;
  retry: boolean;
  backToEditor: boolean;
}

/**
 * The overlay buttons for a state. A test run of an editor draft has no next level and no stored
 * replay: it offers the way back to the editor instead. Retry stays on death (it restarts the same
 * test level) and Undo stays as in normal play. In the phone full screen overlay layout the way back
 * also shows while the run is paused: the pause card is the only place left that offers it.
 */
export function overlayButtons(
  state: OverlayState,
  testPlaying: boolean,
  canUndo: boolean,
  touchOverlay = false
): OverlayButtons {
  const ended = state === 'complete' || state === 'dead';
  return {
    resume: state === 'paused',
    next: state === 'complete' && !testPlaying,
    replay: state === 'complete' && !testPlaying,
    undo: state === 'dead' && canUndo,
    retry: state !== 'none',
    backToEditor: testPlaying && (ended || (touchOverlay && state === 'paused'))
  };
}

/** The locale key and parameters of the line the editor shows after a test run, null when the run did not end. */
export interface TestRunStatus {
  key: string;
  params: Record<string, string | number>;
}

export function testRunStatus(
  state: OverlayState,
  moves: number,
  deathReason: string | null
): TestRunStatus | null {
  if (state === 'complete') {
    return moves > 0
      ? { key: 'editor.test_run.won_moves.label', params: { moves } }
      : { key: 'editor.test_run.won.label', params: {} };
  }
  if (state === 'dead') {
    return deathReason
      ? { key: 'editor.test_run.lost_reason.label', params: { reason: deathReason } }
      : { key: 'editor.test_run.lost.label', params: {} };
  }
  return null;
}

/** Escape returns a finished test run (won or lost) to the editor. */
export function testRunKeyReturns(key: string, state: OverlayState, testPlaying: boolean): boolean {
  return key === 'Escape' && testPlaying && (state === 'complete' || state === 'dead');
}

/** A won test run has no next level: the next-level action goes back to the editor. */
export function nextLevelGoesToEditor(testPlaying: boolean, completed: boolean): boolean {
  return testPlaying && completed;
}

/** Mid-run, a test play stays on its level: level navigation does nothing. */
export function levelNavigationBlocked(testPlaying: boolean, completed: boolean): boolean {
  return testPlaying && !completed;
}

const BACK_TO_EDITOR_BUTTON_ID = 'overlay-btn-back-to-editor';

/**
 * The overlay button that takes focus when the overlay opens: the first visible one. Back to editor
 * leads only after a win; on a loss the usual default (Undo, else Retry) keeps the focus.
 */
export function firstVisibleOverlayAction(overlay: ParentNode, state: OverlayState): HTMLButtonElement | null {
  const visible = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.overlay-actions button')).filter(
    (btn) => !btn.classList.contains('hidden')
  );
  return visible.find((btn) => state === 'complete' || btn.id !== BACK_TO_EDITOR_BUTTON_ID) ?? null;
}
