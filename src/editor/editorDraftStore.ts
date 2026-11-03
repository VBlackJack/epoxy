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

import { type EditorDraft, parseDraft, serializeDraft } from './editorDraft';

/** What reading a draft key found. */
export type DraftRead =
  | { kind: 'none' }
  | { kind: 'draft'; draft: EditorDraft; raw: string }
  /** Something is stored but it is not a draft at all (damaged text or the wrong shape). */
  | { kind: 'invalid'; raw: string }
  /** A draft of another version, or above the size cap: not this page's to read, delete or offer. */
  | { kind: 'unsupported'; reason: 'version' | 'too_large' }
  /** The storage could not be read at all. */
  | { kind: 'unavailable' };

export type DraftWrite = 'written' | 'too_large' | 'failed';

/**
 * Draft storage, addressed by key (every page has its own). Every storage access is guarded: a blocked or full
 * storage never throws into the editor, it is reported to the caller.
 */
export class EditorDraftStore {
  public constructor(private readonly maxChars: number) {}

  public read(key: string): DraftRead {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return { kind: 'unavailable' };
    }
    if (raw === null) return { kind: 'none' };
    const parsed = parseDraft(raw, this.maxChars);
    if (parsed.ok) return { kind: 'draft', draft: parsed.draft, raw };
    if (parsed.reason === 'version' || parsed.reason === 'too_large') return { kind: 'unsupported', reason: parsed.reason };
    return { kind: 'invalid', raw };
  }

  public write(key: string, draft: EditorDraft): DraftWrite {
    const serialized = serializeDraft(draft, this.maxChars);
    if (!serialized.ok) return 'too_large';
    try {
      localStorage.setItem(key, serialized.text);
      return 'written';
    } catch {
      return 'failed';
    }
  }

  /** Deletes a key unconditionally: only for the page's own key, which no other page writes. */
  public remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: there is nothing to delete.
    }
  }

  /** Deletes the key only while it still holds exactly `raw`: a text that changed meanwhile stays. */
  public removeIfRaw(key: string, raw: string): void {
    try {
      if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
    } catch {
      // Storage blocked: there is nothing to delete.
    }
  }

  /** Every key that starts with `prefix`, collected before the caller changes anything; empty when the storage cannot be listed. */
  public listKeys(prefix: string): string[] {
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(prefix)) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys;
  }
}
