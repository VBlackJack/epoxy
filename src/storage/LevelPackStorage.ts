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
import { LevelPack } from '../core/types';

class LevelPackStorageService {
  private openDb(): Promise<IDBDatabase> {
    const { levelPacksDbName, levelPacksStoreName } = ConfigRegistry.getGame().storage;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(levelPacksDbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(levelPacksStoreName)) {
          db.createObjectStore(levelPacksStoreName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async loadAllPacks(): Promise<LevelPack[]> {
    try {
      const db = await this.openDb();
      const { levelPacksStoreName } = ConfigRegistry.getGame().storage;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(levelPacksStoreName, 'readonly');
        const store = tx.objectStore(levelPacksStoreName);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as LevelPack[]) || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async savePack(pack: LevelPack): Promise<void> {
    try {
      const db = await this.openDb();
      const { levelPacksStoreName } = ConfigRegistry.getGame().storage;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(levelPacksStoreName, 'readwrite');
        const store = tx.objectStore(levelPacksStoreName);
        const req = store.put(pack);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // IndexedDB unavailable
    }
  }

  public async deletePack(packId: string): Promise<void> {
    try {
      const db = await this.openDb();
      const { levelPacksStoreName } = ConfigRegistry.getGame().storage;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(levelPacksStoreName, 'readwrite');
        const store = tx.objectStore(levelPacksStoreName);
        const req = store.delete(packId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Ignore error
    }
  }
}

export const LevelPackStorage = new LevelPackStorageService();
