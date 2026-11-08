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

import { CC2_SOURCE_DB_NAME, CC2_SOURCE_DB_VERSION, CC2_SOURCE_STORE_NAME } from '../config/constants';

/** One stored source file: its bytes under the SHA-256 (hex) of those bytes. */
export interface Cc2SourceRecord {
  sha256: string;
  bytes: Uint8Array;
}

/**
 * Local sidecar of the raw bytes of the CC2 files an imported pack was made from. It is its own database, so the pack
 * library stays small; a pack file or a share link never reads from it unless the player opts in to include it.
 */
class Cc2SourceStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(CC2_SOURCE_DB_NAME, CC2_SOURCE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CC2_SOURCE_STORE_NAME)) {
          db.createObjectStore(CC2_SOURCE_STORE_NAME, { keyPath: 'sha256' });
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

  /** Runs several requests in one transaction; resolves when it commits. */
  private async run<T>(
    mode: IDBTransactionMode,
    makeRequests: (store: IDBObjectStore) => Array<IDBRequest<T>>
  ): Promise<T[]> {
    const db = await this.openDb();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(CC2_SOURCE_STORE_NAME, mode);
      const requests = makeRequests(tx.objectStore(CC2_SOURCE_STORE_NAME));
      tx.oncomplete = () => resolve(requests.map((req) => req.result));
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Stores the records (a file already stored under the same hash is overwritten by identical bytes). True when committed. */
  public async putAll(records: readonly Cc2SourceRecord[]): Promise<boolean> {
    if (records.length === 0) return true;
    try {
      await this.run('readwrite', (store) => records.map((record) => store.put({ sha256: record.sha256, bytes: record.bytes })));
      return true;
    } catch {
      return false;
    }
  }

  /** The stored sources among these hashes (those not held are left out); null when the store cannot be read. */
  public async getMany(hashes: readonly string[]): Promise<Cc2SourceRecord[] | null> {
    if (hashes.length === 0) return [];
    try {
      const rows = await this.run<unknown>('readonly', (store) => hashes.map((hash) => store.get(hash)));
      const found: Cc2SourceRecord[] = [];
      rows.forEach((row, index) => {
        const bytes = (row as { bytes?: unknown } | undefined)?.bytes;
        if (bytes instanceof Uint8Array) found.push({ sha256: hashes[index], bytes });
      });
      return found;
    } catch {
      return null;
    }
  }

  /** Removes the sources under these hashes. True when committed. */
  public async deleteMany(hashes: readonly string[]): Promise<boolean> {
    if (hashes.length === 0) return true;
    try {
      await this.run('readwrite', (store) => hashes.map((hash) => store.delete(hash)));
      return true;
    } catch {
      return false;
    }
  }
}

export const Cc2SourceStorage = new Cc2SourceStorageService();
