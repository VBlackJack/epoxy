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

interface FakeRequest {
  result?: unknown;
  error: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
}

interface FakeTransaction {
  error: unknown;
  oncomplete?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  objectStore: () => unknown;
}

/** Just enough of IndexedDB for the storage service: one store, async callbacks. */
export class FakeIndexedDb {
  public records = new Map<string, unknown>();
  public opens = 0;
  public abortWrites = false;
  /** Makes every read transaction abort, like a database that cannot be read. */
  public abortReads = false;

  public open(): FakeRequest {
    this.opens++;
    const req: FakeRequest = { error: null };
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: (_name: string, mode: string) => this.transaction(mode),
      close: () => undefined
    };
    queueMicrotask(() => {
      req.result = db;
      req.onsuccess?.();
    });
    return req;
  }

  private transaction(mode: string): FakeTransaction {
    const tx: FakeTransaction = { error: null, objectStore: () => store };
    // Like IndexedDB, the transaction settles once no request is pending: a request made in a success handler joins it.
    let pending = 0;
    let settled = false;
    const settle = (): void => {
      queueMicrotask(() => {
        if (pending > 0 || settled) return;
        settled = true;
        if ((mode === 'readwrite' && this.abortWrites) || (mode === 'readonly' && this.abortReads)) {
          tx.error = new Error('AbortError');
          tx.onabort?.();
        } else {
          tx.oncomplete?.();
        }
      });
    };
    const run = (work: () => unknown): FakeRequest => {
      const req: FakeRequest = { error: null };
      pending++;
      queueMicrotask(() => {
        req.result = work();
        req.onsuccess?.();
        pending--;
        settle();
      });
      return req;
    };
    const store = {
      getAll: () => run(() => [...this.records.values()]),
      get: (key: string) => run(() => this.records.get(key)),
      put: (value: { id: string }) =>
        run(() => {
          if (!this.abortWrites) this.records.set(value.id, value);
          return value.id;
        }),
      delete: (key: string) => run(() => this.records.delete(key))
    };
    return tx;
  }
}
