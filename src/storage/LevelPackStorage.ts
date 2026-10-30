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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, isRecord } from '../config/ConfigValidation';
import { LevelPack } from '../core/types';

/** IndexedDB schema version of the level pack store. */
const LEVEL_PACK_DB_VERSION = 1;

class LevelPackStorageService {
  /** One shared connection, opened on first use and dropped when the browser closes it. */
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const { levelPacksDbName, levelPacksStoreName } = ConfigRegistry.getGame().storage;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(levelPacksDbName, LEVEL_PACK_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(levelPacksStoreName)) {
          db.createObjectStore(levelPacksStoreName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema, or the browser closing the
        // connection: forget it so the next call reopens.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    this.dbPromise = opening;
    // A failed open must not stay cached
    opening.catch(() => {
      if (this.dbPromise === opening) this.dbPromise = null;
    });
    return opening;
  }

  /**
   * Runs one request in its own transaction. Resolves only when the
   * transaction commits: a request can succeed and its transaction still
   * abort afterwards (quota exceeded), which must be reported as a failure.
   */
  private async runRequest<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.openDb();
    const { levelPacksStoreName } = ConfigRegistry.getGame().storage;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(levelPacksStoreName, mode);
      const req = makeRequest(tx.objectStore(levelPacksStoreName));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? req.error);
      tx.onerror = () => reject(tx.error ?? req.error);
    });
  }

  /** Returns the stored packs, dropping any record that is not a well-formed pack. */
  public async loadAllPacks(): Promise<LevelPack[]> {
    try {
      const raw = await this.runRequest<unknown[]>('readonly', (store) => store.getAll());
      return this.sanitizePacks(raw);
    } catch {
      // IndexedDB unavailable or the read failed: no imported packs
      return [];
    }
  }

  /** Persists a pack. Resolves to false when it could not be stored. */
  public async savePack(pack: LevelPack): Promise<boolean> {
    try {
      await this.runRequest('readwrite', (store) => store.put(pack));
      return true;
    } catch {
      return false;
    }
  }

  /** Removes a pack. Resolves to false when the deletion did not commit. */
  public async deletePack(packId: string): Promise<boolean> {
    try {
      await this.runRequest('readwrite', (store) => store.delete(packId));
      return true;
    } catch {
      return false;
    }
  }

  private sanitizePacks(raw: unknown): LevelPack[] {
    if (!Array.isArray(raw)) return [];
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const packs: LevelPack[] = [];
    for (const entry of raw) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
      if (!Array.isArray(entry.levels)) continue;
      const levels = entry.levels.filter((lvl) => isCompiledLevelShape(lvl, bounds));
      if (levels.length === 0) continue;
      packs.push({
        id: entry.id,
        name: entry.name,
        i18nKey: typeof entry.i18nKey === 'string' ? entry.i18nKey : undefined,
        builtIn: false,
        levels
      });
    }
    return packs;
  }
}

export const LevelPackStorage = new LevelPackStorageService();
