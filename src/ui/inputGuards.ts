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

/** The parts of a keyboard event the shortcut guards read. */
export interface KeyChord {
  key: string;
  /** Physical key code; optional so callers without it keep the key-only match. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Key value of the letters the editor and play chords use, compared lower case. */
const UNDO_KEY = 'z';
const REDO_KEY = 'y';
const UNDO_CODE = 'KeyZ';
const REDO_CODE = 'KeyY';

const SINGLE_ASCII_LETTER = /^[a-z]$/i;

/**
 * True when the chord is the given letter. The produced character wins, which
 * keeps AZERTY working (key 'z' on code KeyW). A layout whose key is not an
 * ASCII letter (Cyrillic, Greek) falls back to the physical key code.
 */
function matchesLetter(chord: KeyChord, letter: string, code: string): boolean {
  if (chord.key.toLowerCase() === letter) return true;
  return !SINGLE_ASCII_LETTER.test(chord.key) && chord.code === code;
}

/**
 * True when Ctrl, Meta or Alt is held. Game shortcuts ignore such events so
 * browser and system chords (Ctrl+R, Alt+Left, Cmd+F) are never swallowed.
 */
export function hasCommandModifier(chord: KeyChord): boolean {
  return chord.ctrlKey || chord.metaKey || chord.altKey;
}

/**
 * Undo chord: Ctrl or Meta with the Z key. It matches the produced character
 * rather than the physical key, so it follows the keyboard layout (Z sits on
 * a different key on AZERTY and QWERTY); non-Latin layouts use the key code.
 * Shift is allowed.
 */
export function isUndoChord(chord: KeyChord): boolean {
  return (chord.ctrlKey || chord.metaKey) && matchesLetter(chord, UNDO_KEY, UNDO_CODE);
}

export type EditorChordAction = 'undo' | 'redo';

/**
 * Editor history chord: Ctrl/Meta+Z undoes, Ctrl/Meta+Shift+Z and Ctrl/Meta+Y
 * redo. Returns null for any other key.
 */
export function getEditorChordAction(chord: KeyChord): EditorChordAction | null {
  if (isUndoChord(chord)) return chord.shiftKey ? 'redo' : 'undo';
  if ((chord.ctrlKey || chord.metaKey) && matchesLetter(chord, REDO_KEY, REDO_CODE)) return 'redo';
  return null;
}
