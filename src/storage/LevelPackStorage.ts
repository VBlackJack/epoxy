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
import { isRecord, sanitizeStoredLevels } from '../config/ConfigValidation';
import { LevelPack } from '../core/types';
import { clampPackMetadata } from '../packs/packMetadata';
import { isSourceHash } from '../packs/shareLink';

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

  /** Drops the shared connection so the next call opens a new one. */
  public async closeConnection(): Promise<void> {
    const opening = this.dbPromise;
    this.dbPromise = null;
    if (!opening) return;
    try {
      (await opening).close();
    } catch {
      // The connection never opened
    }
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

  /**
   * Returns the stored packs, dropping any record that is not a well-formed pack.
   * An empty list means the library is empty; null means it could not be read.
   */
  public async loadAllPacks(): Promise<LevelPack[] | null> {
    try {
      const raw = await this.runRequest<unknown[]>('readonly', (store) => store.getAll());
      return this.sanitizePacks(raw);
    } catch {
      // IndexedDB unavailable or the read failed: the library is unknown, not empty
      return null;
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
    const metadataLimits = ConfigRegistry.getPackMetadataLimits();
    const textLimits = ConfigRegistry.getLevelTextLimits();
    const packs: LevelPack[] = [];
    for (const entry of raw) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
      if (!Array.isArray(entry.levels)) continue;
      const levels = sanitizeStoredLevels(entry.levels, bounds, textLimits);
      const userCreated = entry.userCreated === true;
      // A pack the player created stays even when it holds no level yet.
      if (levels.length === 0 && !userCreated) continue;
      packs.push({
        id: entry.id,
        name: entry.name,
        i18nKey: typeof entry.i18nKey === 'string' ? entry.i18nKey : undefined,
        builtIn: false,
        ...(userCreated ? { userCreated } : {}),
        ...clampPackMetadata(entry, metadataLimits),
        ...(typeof entry.sourceHash === 'string' && isSourceHash(entry.sourceHash) ? { sourceHash: entry.sourceHash } : {}),
        levels
      });
    }
    return packs;
  }
}

export const LevelPackStorage = new LevelPackStorageService();
