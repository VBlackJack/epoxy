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
}

/**
 * Just enough of IndexedDB for a store keyed by a field: put, get and delete, several requests per transaction, the
 * transaction completing after its requests. Used for the CC2 source sidecar (key path `sha256`).
 */
export class FakeKeyedIndexedDb {
  public records = new Map<string, unknown>();
  public abortWrites = false;

  public open(): { result?: unknown; error: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void } {
    const req: { result?: unknown; error: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = { error: null };
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

  private transaction(mode: string): { error: unknown; oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore: () => unknown } {
    const tx: { error: unknown; oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore: () => unknown } = {
      error: null,
      objectStore: () => store
    };
    let pending = 0;
    let finishing = false;
    const settle = (): void => {
      if (finishing || pending > 0) return;
      finishing = true;
      queueMicrotask(() => {
        if (mode === 'readwrite' && this.abortWrites) {
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
        pending--;
        settle();
      });
      return req;
    };
    const store = {
      put: (value: { sha256: string }) =>
        run(() => {
          if (!this.abortWrites) this.records.set(value.sha256, value);
          return value.sha256;
        }),
      get: (key: string) => run(() => this.records.get(key)),
      delete: (key: string) => run(() => this.records.delete(key))
    };
    return tx;
  }
}
