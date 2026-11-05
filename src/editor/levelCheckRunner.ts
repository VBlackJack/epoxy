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
import type { ValidateOptions } from '../core/LevelValidator';
import type { CompiledLevel, LevelValidationReport } from '../core/types';
import type { LevelCheckWorkerRequest, LevelCheckWorkerResponse } from '../workers/levelCheckProtocol';

/** The subset of Worker the runner relies on; a fake implements it in tests. */
export interface LevelCheckWorkerLike {
  onmessage: ((event: { data: LevelCheckWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: LevelCheckWorkerRequest): void;
  terminate(): void;
}

export interface LevelCheckRunnerDeps {
  /** Starts the worker; null when workers are unavailable. May throw. */
  createWorker: (() => LevelCheckWorkerLike) | null;
  /** The config bundle the page loaded, posted with every check so a reused worker never validates with old configs. */
  getBundle: () => ConfigBundle;
  /** The page language, posted with every check. */
  getLocale: () => string;
  /** The validation itself, run inline when no worker can be used. */
  validate: (level: CompiledLevel, options?: ValidateOptions) => LevelValidationReport;
}

/**
 * How a check ended. A check that is superseded or cancelled answers `cancelled`; one that outlasts its
 * timeout answers `timeout`; a crash or an error reply answers `error`. Only `report` carries a verdict.
 */
export type LevelCheckResult =
  | { kind: 'report'; report: LevelValidationReport }
  | { kind: 'cancelled' }
  | { kind: 'timeout' }
  | { kind: 'error' };

interface Listener {
  onDone: (result: LevelCheckResult) => void;
  /** The own timeout of a listener that joined a running check; the starter's timeout is the check's. */
  timer: ReturnType<typeof setTimeout> | null;
}

interface Pending {
  id: number;
  level: CompiledLevel;
  options: ValidateOptions | undefined;
  /** The caller that started the check first, then those that joined it. */
  listeners: Listener[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Runs the level validation off the main thread: measured on the development machine (2026-11-04), it takes
 * 1.6 s on a large level and from 39 s to minutes on a medium block puzzle with targets. One check runs at a
 * time: a new one terminates the worker of the previous one, which then answers `cancelled`; a caller that wants the
 * check already running can `join` it instead. Without a usable worker the report is computed inline and `onDone` is
 * called before `run` returns. A worker that fails before it announced it is ready (a blocked script, a broken
 * bundle) is given up for good: the checks then run inline, as without workers. A crash after `ready` is a plain
 * `error`: the heavy level is not run again inline, and the next check starts a new worker.
 */
export class LevelCheckRunner {
  private worker: LevelCheckWorkerLike | null = null;
  private pending: Pending | null = null;
  private nextId = 0;
  /** True once any worker announced it is ready: from then on a crash is an error of that check, not of the worker setup. */
  private workerAnswered = false;
  /** True once a worker failed before ever answering: no worker is started again. */
  private workersUnusable = false;

  constructor(private readonly deps: LevelCheckRunnerDeps) {}

  /** Whether a check is in progress in the worker. */
  public isRunning(): boolean {
    return this.pending !== null;
  }

  /** Starts the check of `level`; `onDone` is called exactly once, whatever the outcome. */
  public run(
    level: CompiledLevel,
    timeoutMs: number,
    onDone: (result: LevelCheckResult) => void,
    options?: ValidateOptions
  ): void {
    this.cancel();
    const worker = this.startWorker();
    if (!worker) {
      onDone(this.validateInline(level, options));
      return;
    }
    const id = ++this.nextId;
    const timer = setTimeout(() => this.finish(id, { kind: 'timeout' }, true), timeoutMs);
    this.pending = { id, level, options, listeners: [{ onDone, timer: null }], timer };
    worker.postMessage({ type: 'check', id, level, bundle: this.deps.getBundle(), locale: this.deps.getLocale(), options });
  }

  /**
   * Waits for the check in progress instead of starting another: `onDone` gets its outcome, or `timeout` once
   * `timeoutMs` have passed since this call (the check itself goes on). False when no check is in progress.
   */
  public join(timeoutMs: number, onDone: (result: LevelCheckResult) => void): boolean {
    const pending = this.pending;
    if (!pending) return false;
    const listener: Listener = { onDone, timer: null };
    listener.timer = setTimeout(() => {
      listener.timer = null;
      const index = pending.listeners.indexOf(listener);
      if (index >= 0) pending.listeners.splice(index, 1);
      onDone({ kind: 'timeout' });
    }, timeoutMs);
    pending.listeners.push(listener);
    return true;
  }

  /** Abandons the check in progress, if any. */
  public cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    this.dropWorker();
    this.notify(pending, { kind: 'cancelled' });
  }

  /** Abandons the check in progress and terminates the idle worker. */
  public dispose(): void {
    this.cancel();
    this.dropWorker();
  }

  private validateInline(level: CompiledLevel, options?: ValidateOptions): LevelCheckResult {
    try {
      return { kind: 'report', report: this.deps.validate(level, options) };
    } catch (err) {
      console.error('Level check failed:', err);
      return { kind: 'error' };
    }
  }

  private startWorker(): LevelCheckWorkerLike | null {
    if (this.worker) return this.worker;
    if (this.deps.createWorker === null || this.workersUnusable) return null;
    try {
      const worker = this.deps.createWorker();
      worker.onmessage = (event) => {
        // A worker that was replaced, timed out or cancelled has nothing to say any more.
        if (this.worker !== worker) return;
        const response = event.data;
        if (response.type === 'ready') {
          this.workerAnswered = true;
          return;
        }
        this.finish(
          response.id,
          response.type === 'report' ? { kind: 'report', report: response.report } : { kind: 'error' },
          false
        );
      };
      worker.onerror = () => {
        if (this.worker !== worker) return;
        const pending = this.pending;
        if (!this.workerAnswered) {
          // The worker never worked: stop using workers, and check this level inline.
          this.workersUnusable = true;
          if (pending) this.finish(pending.id, this.validateInline(pending.level, pending.options), true);
          else this.dropWorker();
          return;
        }
        if (pending) this.finish(pending.id, { kind: 'error' }, true);
      };
      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Settles the check `id`; a worker that timed out or crashed is replaced at the next check. */
  private finish(id: number, result: LevelCheckResult, dropWorker: boolean): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (dropWorker) this.dropWorker();
    this.notify(pending, result);
  }

  /** Tells every caller of the check how it ended, and stops the timeouts of those that joined. */
  private notify(pending: Pending, result: LevelCheckResult): void {
    const listeners = pending.listeners.splice(0);
    for (const listener of listeners) {
      if (listener.timer !== null) clearTimeout(listener.timer);
    }
    for (const listener of listeners) listener.onDone(result);
  }
}
