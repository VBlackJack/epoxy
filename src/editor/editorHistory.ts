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

import { cloneDocument, EditorDocument } from './editorDocument';

/** Fewest steps the history keeps, whatever limit it is given. */
const MIN_HISTORY_SIZE = 1;

/**
 * Bounded undo and redo history of whole editor documents (map and metadata),
 * so an undo also brings back the title, the win rule and the ruleset.
 * Every document is deep-copied on the way in and on the way out.
 */
export class EditorHistory {
  private readonly maxSize: number;
  private undoStack: EditorDocument[] = [];
  private redoStack: EditorDocument[] = [];

  /** @param maxSize Most undo steps kept; the oldest is dropped past it. */
  public constructor(maxSize: number) {
    this.maxSize = Number.isFinite(maxSize) ? Math.max(MIN_HISTORY_SIZE, Math.floor(maxSize)) : MIN_HISTORY_SIZE;
  }

  /** Records the document as it is BEFORE a change. Clears the redo steps. */
  public push(doc: EditorDocument): void {
    if (this.undoStack.length >= this.maxSize) this.undoStack.shift();
    this.undoStack.push(cloneDocument(doc));
    this.redoStack = [];
  }

  /** Steps back: returns the previous document and keeps `current` for redo, or null when there is none. */
  public undo(current: EditorDocument): EditorDocument | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(cloneDocument(current));
    return previous;
  }

  /** Steps forward: returns the document undone last and keeps `current` for undo, or null when there is none. */
  public redo(current: EditorDocument): EditorDocument | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneDocument(current));
    return next;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Forgets every step, for example when another level is loaded. */
  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
