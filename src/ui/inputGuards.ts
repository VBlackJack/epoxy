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
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Key value of the letters the editor and play chords use, compared lower case. */
const UNDO_KEY = 'z';
const REDO_KEY = 'y';

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
 * a different key on AZERTY and QWERTY). Shift is allowed.
 */
export function isUndoChord(chord: KeyChord): boolean {
  return (chord.ctrlKey || chord.metaKey) && chord.key.toLowerCase() === UNDO_KEY;
}

export type EditorChordAction = 'undo' | 'redo';

/**
 * Editor history chord: Ctrl/Meta+Z undoes, Ctrl/Meta+Shift+Z and Ctrl/Meta+Y
 * redo. Returns null for any other key.
 */
export function getEditorChordAction(chord: KeyChord): EditorChordAction | null {
  if (isUndoChord(chord)) return chord.shiftKey ? 'redo' : 'undo';
  if ((chord.ctrlKey || chord.metaKey) && chord.key.toLowerCase() === REDO_KEY) return 'redo';
  return null;
}
