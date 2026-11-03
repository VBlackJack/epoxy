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
import type { BlockPuzzleVerdict } from '../core/BlockPuzzleSolver';
import type { CompiledLevel } from '../core/types';
import type { BlockCheckWorkerRequest, BlockCheckWorkerResponse } from '../workers/blockCheckProtocol';
import { blockCheckApplies } from './blockCheck';

/** The subset of Worker the runner relies on; a fake implements it in tests. */
export interface BlockCheckWorkerLike {
  onmessage: ((event: { data: BlockCheckWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: BlockCheckWorkerRequest): void;
  terminate(): void;
}

export interface BlockCheckRunnerDeps {
  /** Starts the worker; null when workers are unavailable. May throw. */
  createWorker: (() => BlockCheckWorkerLike) | null;
  /** The config bundle the page loaded, posted with every check so a reused worker never searches with old configs. */
  getBundle: () => ConfigBundle;
  /** How long a check may run before it is abandoned as not checked. */
  timeoutMs: number;
}

interface Pending {
  id: number;
  resolve: (verdict: BlockPuzzleVerdict | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

const NOT_CHECKED: BlockPuzzleVerdict = { kind: 'not_checked' };

/**
 * Runs the block puzzle check off the main thread. One check runs at a time:
 * a new one terminates the worker of the previous one, which then answers
 * null (superseded). A worker that is missing, crashes or takes longer than
 * the timeout yields `not_checked`, never a verdict it did not prove.
 *
 * Why a worker: measured on the development machine (2026-11-03), an open
 * 50x50 room (2304 playable cells, under the 2500 cap) with 3 blocks and 3
 * distant targets took 1.05 s for 500 searched layouts and 7.8 s for 2000
 * (about 100 MB of heap), far past the 300 ms a main thread search may take,
 * and the 60000 layout budget would run for minutes. The timeout bounds it.
 */
export class BlockCheckRunner {
  private worker: BlockCheckWorkerLike | null = null;
  private pending: Pending | null = null;
  private nextId = 0;

  constructor(private readonly deps: BlockCheckRunnerDeps) {}

  /** The verdict for the level; null when the line does not apply or this check was superseded. */
  public check(level: CompiledLevel): Promise<BlockPuzzleVerdict | null> {
    if (!blockCheckApplies(level)) return Promise.resolve(null);
    this.cancel();
    const worker = this.startWorker();
    if (!worker) return Promise.resolve(NOT_CHECKED);
    const id = ++this.nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(id, NOT_CHECKED, true), this.deps.timeoutMs);
      this.pending = { id, resolve, timer };
      worker.postMessage({ type: 'check', id, level, bundle: this.deps.getBundle() });
    });
  }

  /** Abandons the check in progress, if any. */
  public cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    this.dropWorker();
    pending.resolve(null);
  }

  /** Abandons the check in progress and terminates the idle worker. */
  public dispose(): void {
    this.cancel();
    this.dropWorker();
  }

  private startWorker(): BlockCheckWorkerLike | null {
    if (this.worker) return this.worker;
    if (this.deps.createWorker === null) return null;
    try {
      const worker = this.deps.createWorker();
      worker.onmessage = (event) => {
        const response = event.data;
        this.finish(response.id, response.type === 'verdict' ? response.verdict : NOT_CHECKED, false);
      };
      worker.onerror = () => {
        const id = this.pending?.id;
        if (id !== undefined) this.finish(id, NOT_CHECKED, true);
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
  private finish(id: number, verdict: BlockPuzzleVerdict | null, dropWorker: boolean): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (dropWorker) this.dropWorker();
    pending.resolve(verdict);
  }
}
