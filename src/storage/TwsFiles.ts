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

import { parseTwsIndex, TwsErrorCode, TwsIndex, TwsLimits, TwsParseError } from '../formats/TwsCodec';
import { TwsStorage } from './TwsStorage';

/** What the page knows about the solution file of one pack. */
export type TwsFileState =
  | { kind: 'loading' }
  | { kind: 'none' }
  /** A file that parsed: `persisted` is false while it lives in this page only (not stored yet, or storing failed). */
  | { kind: 'ready'; fileName: string; index: TwsIndex; persisted: boolean }
  /** A stored file the reader now refuses (the limits can change between sessions). */
  | { kind: 'error'; fileName: string; code: TwsErrorCode };

/**
 * The solution file of each pack, parsed once and kept in memory by pack id. The page asks it by `peek` (never parses, never
 * touches storage), and starts the one read of a pack with `ensure`. A load, a forget or a pack deletion bumps the pack's
 * generation, so a read that was in flight when it happened never overwrites what came after it.
 */
class TwsFilesService {
  private readonly states = new Map<string, TwsFileState>();
  private readonly generations = new Map<string, number>();
  private readonly reads = new Map<string, Promise<TwsFileState>>();
  private readonly listeners = new Set<() => void>();

  /** The state held for a pack, or undefined when nothing was asked yet. */
  public peek(packId: string): TwsFileState | undefined {
    return this.states.get(packId);
  }

  /** Calls `listener` after every change of any pack's state; returns the function that stops it. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Reads the stored file of a pack once (state `loading` meanwhile); later calls return the state held. */
  public ensure(packId: string, limits: TwsLimits): Promise<TwsFileState> {
    const held = this.states.get(packId);
    if (held !== undefined && held.kind !== 'loading') return Promise.resolve(held);
    const reading = this.reads.get(packId);
    if (reading) return reading;
    const generation = this.generationOf(packId);
    this.states.set(packId, { kind: 'loading' });
    const read = this.read(packId, limits, generation).finally(() => {
      if (this.reads.get(packId) === read) this.reads.delete(packId);
    });
    this.reads.set(packId, read);
    // No notification for the loading state itself: the caller that asked already knows, and may be drawing right now.
    return read;
  }

  private async read(packId: string, limits: TwsLimits, generation: number): Promise<TwsFileState> {
    const row = await TwsStorage.get(packId);
    // A load, a forget or a deletion came in while the store was read: what it set stands.
    if (this.generationOf(packId) !== generation) return this.states.get(packId) ?? { kind: 'none' };
    const state: TwsFileState = row === null ? { kind: 'none' } : this.parsed(row.fileName, new Uint8Array(row.bytes), limits, true);
    this.states.set(packId, state);
    this.changed();
    return state;
  }

  private parsed(fileName: string, bytes: Uint8Array, limits: TwsLimits, persisted: boolean): TwsFileState {
    try {
      return { kind: 'ready', fileName, index: parseTwsIndex(bytes, limits), persisted };
    } catch (e) {
      return { kind: 'error', fileName, code: e instanceof TwsParseError ? e.code : 'truncated' };
    }
  }

  /**
   * Makes a parsed file the one of the pack: it plays at once from memory, then is stored. Returns true when the store
   * kept it; on false the file plays until the page is left (a stale stored file of that pack is removed so it cannot
   * come back instead).
   */
  public async adopt(packId: string, fileName: string, bytes: Uint8Array, index: TwsIndex): Promise<boolean> {
    const generation = this.bump(packId);
    this.states.set(packId, { kind: 'ready', fileName, index, persisted: false });
    this.changed();
    const stored = await TwsStorage.put({
      packId,
      fileName,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      loadedAt: Date.now()
    });
    if (!stored) await TwsStorage.delete(packId);
    if (stored && this.generationOf(packId) === generation) {
      this.states.set(packId, { kind: 'ready', fileName, index, persisted: true });
      this.changed();
    }
    return stored;
  }

  /** Forgets the file of a pack, in memory and in the store. True when the store no longer holds one. */
  public async forget(packId: string): Promise<boolean> {
    this.bump(packId);
    this.states.set(packId, { kind: 'none' });
    this.changed();
    return TwsStorage.delete(packId);
  }

  private generationOf(packId: string): number {
    return this.generations.get(packId) ?? 0;
  }

  private bump(packId: string): number {
    const next = this.generationOf(packId) + 1;
    this.generations.set(packId, next);
    return next;
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Test seam: forgets everything held in memory (the store is untouched). */
  public resetForTests(): void {
    this.states.clear();
    this.generations.clear();
    this.reads.clear();
    this.listeners.clear();
  }
}

export const TwsFiles = new TwsFilesService();
