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

import { TWS_DB_NAME, TWS_DB_VERSION, TWS_STORE_NAME } from '../config/constants';

/** The Tile World solution file a player loaded for one pack: its raw bytes, kept so a reader fix applies to it later. */
export interface TwsStoredFile {
  packId: string;
  fileName: string;
  bytes: ArrayBuffer;
  loadedAt: number;
}

/**
 * Local store of the .tws file of each pack, in its own database (the pack library stays small, and nothing here ever
 * leaves the browser). One file per pack; loading another replaces it.
 */
class TwsStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(TWS_DB_NAME, TWS_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TWS_STORE_NAME)) {
          db.createObjectStore(TWS_STORE_NAME, { keyPath: 'packId' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
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
    opening.catch(() => {
      if (this.dbPromise === opening) this.dbPromise = null;
    });
    return opening;
  }

  /** Runs one request in its own transaction; resolves with its result once the transaction commits. */
  private async run<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(TWS_STORE_NAME, mode);
      const request = makeRequest(tx.objectStore(TWS_STORE_NAME));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Stores the file of a pack (replacing the one held). True when committed; false on a full quota or an unavailable store. */
  public async put(file: TwsStoredFile): Promise<boolean> {
    try {
      await this.run('readwrite', (store) => store.put(file));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The file stored for a pack, or null when there is none or the store cannot be read. A row that is not a well formed
   * file of this pack is deleted and counted as none.
   */
  public async get(packId: string): Promise<TwsStoredFile | null> {
    let row: unknown;
    try {
      row = await this.run<unknown>('readonly', (store) => store.get(packId));
    } catch {
      return null;
    }
    if (row === undefined) return null;
    if (isStoredFile(row, packId)) return row;
    await this.delete(packId);
    return null;
  }

  /** Removes the file of a pack. True when committed. */
  public async delete(packId: string): Promise<boolean> {
    try {
      await this.run('readwrite', (store) => store.delete(packId));
      return true;
    } catch {
      return false;
    }
  }
}

/** True for a stored row that is a usable file of `packId`: bytes, a name and the right key. */
export function isStoredFile(row: unknown, packId: string): row is TwsStoredFile {
  if (typeof row !== 'object' || row === null) return false;
  const candidate = row as Partial<TwsStoredFile>;
  return candidate.packId === packId && typeof candidate.fileName === 'string' && candidate.bytes instanceof ArrayBuffer;
}

export const TwsStorage = new TwsStorageService();
