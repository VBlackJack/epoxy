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
  key: string;
  seed: number;
  levelNumber: number;
  resolve: (level: CompiledLevel) => void;
  reject: (reason: Error) => void;
}

const DISPOSED_MESSAGE = 'Endless generator disposed';
const RESET_MESSAGE = 'Endless generator reset';
const CRASH_MESSAGE = 'Endless generator worker crashed twice';

const requestKey = (seed: number, levelNumber: number): string => `${seed}:${levelNumber}`;

/**
 * Generates endless levels off the main thread. Falls back to the main thread
 * (with a pause before the work so the page can paint) when no worker can be
 * started or when the worker crashed before it ever answered, which means it
 * cannot run here at all (script failed to load, blocked by a policy). A
 * worker that did answer and then died, on a level too heavy for it for
 * instance, is replaced once and its requests are posted again; if the
 * replacement dies too, those requests are rejected rather than frozen into a
 * main thread run. A generation error reported by a healthy worker is not
 * retried because it would fail the same way.
 */
export class EndlessGenerator {
  private worker: EndlessWorkerLike | null = null;
  private workerFailed: boolean;
  /** Whether any worker has answered a request: proof that workers run here. */
  private everAnswered = false;
  /** Whether the worker in use replaced one that crashed and has not answered since. */
  private respawned = false;
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
      // A reset may have cleared the map and a newer call may own the key by now.
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** True while a request is waiting for its level. */
  public hasPending(): boolean {
    return this.pending.size > 0 || this.inFlight.size > 0;
  }

  /**
   * Abandons every request in progress: the worker is terminated, so it stops
   * working on levels nobody wants, and the waiting callers are rejected. The
   * next request starts a fresh worker. Main thread generations cannot be
   * stopped, so their shared requests stay and a repeated call reuses them.
   */
  public reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.respawned = false;
    const abandoned = [...this.pending.values()];
    this.pending.clear();
    for (const request of abandoned) this.inFlight.delete(request.key);
    for (const request of abandoned) request.reject(new Error(RESET_MESSAGE));
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
        this.pending.set(id, { key: requestKey(seed, levelNumber), seed, levelNumber, resolve, reject });
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
    let worker: EndlessWorkerLike | undefined;
    try {
      worker = this.deps.createWorker?.();
      if (!worker) throw new Error('No worker available');
      // A worker replaced by a reset may still deliver a last event: only the current one counts.
      worker.onmessage = (event) => {
        if (this.worker === worker) this.onResponse(event.data);
      };
      worker.onerror = () => {
        if (this.worker === worker) this.onWorkerCrash();
      };
      worker.onmessageerror = worker.onerror;
      this.worker = worker;
      worker.postMessage({ type: 'init', bundle: this.deps.getBundle() });
      return true;
    } catch {
      // Worker construction or the config transfer failed: stay on the main thread.
      worker?.terminate();
      this.worker = null;
      this.workerFailed = true;
      return false;
    }
  }

  private onResponse(response: EndlessWorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.everAnswered = true;
    this.respawned = false;
    this.pending.delete(response.id);
    if (response.type === 'level') request.resolve(response.level);
    else request.reject(new Error(response.message));
  }

  /**
   * The worker died. One that never answered cannot run here: everything goes to
   * the main thread from now on. One that did is replaced once and its orphans are
   * posted again; when the replacement dies as well, the orphans are rejected.
   */
  private onWorkerCrash(): void {
    this.worker?.terminate();
    this.worker = null;
    const orphans = [...this.pending.entries()];
    // An idle worker died: nothing to re-post, so the retry is kept for a real failure.
    if (orphans.length === 0) return;
    this.pending.clear();
    if (!this.everAnswered) {
      this.workerFailed = true;
      this.serveOnMainThread(orphans.map(([, request]) => request));
      return;
    }
    if (this.respawned) {
      this.respawned = false;
      for (const [, request] of orphans) request.reject(new Error(CRASH_MESSAGE));
      return;
    }
    this.respawned = true;
    if (!this.ensureWorker()) {
      this.serveOnMainThread(orphans.map(([, request]) => request));
      return;
    }
    const replacement = this.worker as EndlessWorkerLike | null;
    for (const [id, request] of orphans) {
      this.pending.set(id, request);
      replacement?.postMessage({ type: 'generate', id, seed: request.seed, levelNumber: request.levelNumber });
    }
  }

  private serveOnMainThread(requests: PendingRequest[]): void {
    for (const request of requests) {
      this.generateOnMainThread(request.seed, request.levelNumber).then(request.resolve, request.reject);
    }
  }
}
