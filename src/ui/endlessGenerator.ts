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

import type { ConfigBundle } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import type { EndlessWorkerRequest, EndlessWorkerResponse } from '../workers/endlessProtocol';

/** The subset of Worker the client relies on; a fake implements it in tests. */
export interface EndlessWorkerLike {
  onmessage: ((event: { data: EndlessWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: EndlessWorkerRequest): void;
  terminate(): void;
}

export interface EndlessGeneratorDeps {
  /** Starts the worker; null when workers are unavailable. May throw. */
  createWorker: (() => EndlessWorkerLike) | null;
  /** The config bundle the page loaded, posted once to the worker. */
  getBundle: () => ConfigBundle;
  /** Main thread generation used when the worker is missing or dies. */
  generateLocal: (seed: number, levelNumber: number) => CompiledLevel;
  /** Lets the page paint between two main thread generations. */
  yieldToUi: () => Promise<void>;
}

interface PendingRequest {
  seed: number;
  levelNumber: number;
  resolve: (level: CompiledLevel) => void;
  reject: (reason: Error) => void;
}

const DISPOSED_MESSAGE = 'Endless generator disposed';

const requestKey = (seed: number, levelNumber: number): string => `${seed}:${levelNumber}`;

/**
 * Generates endless levels off the main thread. Falls back to the main thread
 * (with a pause before the work so the page can paint) when no worker can be
 * started or the worker crashes; a generation error reported by a healthy
 * worker is not retried because it would fail the same way.
 */
export class EndlessGenerator {
  private worker: EndlessWorkerLike | null = null;
  private workerFailed: boolean;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly inFlight = new Map<string, Promise<CompiledLevel>>();

  constructor(private readonly deps: EndlessGeneratorDeps) {
    this.workerFailed = deps.createWorker === null;
  }

  /** True while requests are served by a worker rather than the main thread. */
  public usesWorker(): boolean {
    return !this.workerFailed;
  }

  /** Level `levelNumber` of the endless run `seed`; concurrent identical calls share one request. */
  public request(seed: number, levelNumber: number): Promise<CompiledLevel> {
    const key = requestKey(seed, levelNumber);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.dispatch(seed, levelNumber).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerFailed = true;
    for (const request of this.pending.values()) request.reject(new Error(DISPOSED_MESSAGE));
    this.pending.clear();
  }

  private dispatch(seed: number, levelNumber: number): Promise<CompiledLevel> {
    if (!this.workerFailed && this.ensureWorker()) {
      return new Promise<CompiledLevel>((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { seed, levelNumber, resolve, reject });
        this.worker?.postMessage({ type: 'generate', id, seed, levelNumber });
      });
    }
    return this.generateOnMainThread(seed, levelNumber);
  }

  private async generateOnMainThread(seed: number, levelNumber: number): Promise<CompiledLevel> {
    await this.deps.yieldToUi();
    return this.deps.generateLocal(seed, levelNumber);
  }

  private ensureWorker(): boolean {
    if (this.worker) return true;
    try {
      const worker = this.deps.createWorker?.();
      if (!worker) throw new Error('No worker available');
      worker.onmessage = (event) => this.onResponse(event.data);
      worker.onerror = () => this.onWorkerCrash();
      worker.onmessageerror = () => this.onWorkerCrash();
      worker.postMessage({ type: 'init', bundle: this.deps.getBundle() });
      this.worker = worker;
      return true;
    } catch {
      // Worker construction or the config transfer failed: stay on the main thread.
      this.workerFailed = true;
      return false;
    }
  }

  private onResponse(response: EndlessWorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    if (response.type === 'level') request.resolve(response.level);
    else request.reject(new Error(response.message));
  }

  /** The worker is unusable: serve what it still owed, and everything after, on the main thread. */
  private onWorkerCrash(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerFailed = true;
    const orphans = [...this.pending.values()];
    this.pending.clear();
    for (const request of orphans) {
      this.generateOnMainThread(request.seed, request.levelNumber).then(request.resolve, request.reject);
    }
  }
}
