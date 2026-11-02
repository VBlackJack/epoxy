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

import { ORDERED_DIRECTIONS } from '../config/constants';
import { Direction } from '../core/types';
import { hasCommandModifier, KeyChord, matchesLetter } from '../ui/inputGuards';
import { EditorTool } from './editorTools';

export type EditorKeyAction =
  | { kind: 'tool'; tool: EditorTool }
  | { kind: 'rotate' }
  | { kind: 'zoom_in' }
  | { kind: 'zoom_out' }
  | { kind: 'zoom_fit' }
  | { kind: 'cancel' };

const TOOL_LETTERS: ReadonlyArray<{ letter: string; code: string; tool: EditorTool }> = [
  { letter: 'b', code: 'KeyB', tool: 'brush' },
  { letter: 'f', code: 'KeyF', tool: 'fill' },
  { letter: 'e', code: 'KeyE', tool: 'eraser' },
  { letter: 'i', code: 'KeyI', tool: 'picker' }
];
const ROTATE_LETTER = 'r';
const ROTATE_CODE = 'KeyR';
const ZOOM_IN_KEYS: readonly string[] = ['+', '='];
const ZOOM_OUT_KEYS: readonly string[] = ['-', '_'];
const ZOOM_FIT_KEY = '0';
const CANCEL_KEY = 'Escape';

/**
 * The editor action a plain key press stands for, or null. Chords with Ctrl,
 * Meta or Alt belong to the browser and to the history and save chords. The
 * produced character wins over the physical key, so AZERTY works.
 */
export function getEditorKeyAction(chord: KeyChord): EditorKeyAction | null {
  if (hasCommandModifier(chord)) return null;
  if (chord.key === CANCEL_KEY) return { kind: 'cancel' };
  if (ZOOM_IN_KEYS.includes(chord.key)) return { kind: 'zoom_in' };
  if (ZOOM_OUT_KEYS.includes(chord.key)) return { kind: 'zoom_out' };
  if (chord.key === ZOOM_FIT_KEY) return { kind: 'zoom_fit' };
  if (matchesLetter(chord, ROTATE_LETTER, ROTATE_CODE)) return { kind: 'rotate' };
  for (const entry of TOOL_LETTERS) {
    if (matchesLetter(chord, entry.letter, entry.code)) return { kind: 'tool', tool: entry.tool };
  }
  return null;
}

/** The facing after a quarter turn clockwise. */
export function rotateClockwise(dir: Direction): Direction {
  const index = ORDERED_DIRECTIONS.indexOf(dir);
  return ORDERED_DIRECTIONS[(index + 1) % ORDERED_DIRECTIONS.length];
}

export type CanvasKeyAction = { kind: 'move'; dx: number; dy: number } | { kind: 'paint' };

const ARROW_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 }
};
const PAINT_KEYS: readonly string[] = [' ', 'Enter'];

/** What a key does while the canvas has the focus: move the keyboard cursor, or paint at it. */
export function getCanvasKeyAction(chord: KeyChord): CanvasKeyAction | null {
  if (hasCommandModifier(chord)) return null;
  const step = ARROW_STEPS[chord.key];
  if (step) return { kind: 'move', ...step };
  if (PAINT_KEYS.includes(chord.key)) return { kind: 'paint' };
  return null;
}

/** Moves the keyboard cursor, staying inside the grid. */
export function moveCursor(
  cursor: { x: number; y: number },
  dx: number,
  dy: number,
  width: number,
  height: number
): { x: number; y: number } {
  const clamp = (value: number, size: number): number => Math.min(Math.max(0, size - 1), Math.max(0, value));
  return { x: clamp(cursor.x + dx, width), y: clamp(cursor.y + dy, height) };
}
