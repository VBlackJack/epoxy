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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigBundle } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import type { BlockCheckWorkerRequest } from '../workers/blockCheckProtocol';
import { createBlockCheckWorkerCore } from '../workers/blockCheckWorkerCore';
import { BlockCheckRunner, BlockCheckWorkerLike } from './blockCheckRunner';

const TIMEOUT_MS = 1000;
const bundle = {} as ConfigBundle;

function level(ruleset?: 'lynx'): CompiledLevel {
  return { id: 'runner', ...(ruleset ? { ruleset } : {}) } as CompiledLevel;
}

class FakeWorker implements BlockCheckWorkerLike {
  public onmessage: BlockCheckWorkerLike['onmessage'] = null;
  public onerror: BlockCheckWorkerLike['onerror'] = null;
  public readonly requests: BlockCheckWorkerRequest[] = [];
  public terminated = false;
  public postMessage(message: BlockCheckWorkerRequest): void {
    this.requests.push(message);
  }
  public terminate(): void {
    this.terminated = true;
  }
  public answer(id: number, verdict: { kind: 'solved'; pushes: number } | null): void {
    this.onmessage?.({ data: { type: 'verdict', id, verdict } });
  }
}

describe('BlockCheckRunner', () => {
  let workers: FakeWorker[];
  let runner: BlockCheckRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    runner = new BlockCheckRunner({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      getBundle: () => bundle,
      timeoutMs: TIMEOUT_MS
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises the worker, posts the level and resolves with the verdict', async () => {
    const promise = runner.check(level());
    expect(workers[0].requests.map((r) => r.type)).toEqual(['init', 'check']);
    workers[0].answer(1, { kind: 'solved', pushes: 2 });
    await expect(promise).resolves.toEqual({ kind: 'solved', pushes: 2 });
  });

  it('does not start a worker for a level the line does not apply to', async () => {
    await expect(runner.check(level('lynx'))).resolves.toBeNull();
    expect(workers).toHaveLength(0);
  });

  it('abandons the running check when a new one starts', async () => {
    const first = runner.check(level());
    const second = runner.check(level());
    await expect(first).resolves.toBeNull();
    expect(workers[0].terminated).toBe(true);
    workers[1].answer(2, { kind: 'solved', pushes: 1 });
    await expect(second).resolves.toEqual({ kind: 'solved', pushes: 1 });
  });

  it('reports not checked when the search outlasts the timeout, and drops the worker', async () => {
    const promise = runner.check(level());
    vi.advanceTimersByTime(TIMEOUT_MS);
    await expect(promise).resolves.toEqual({ kind: 'not_checked' });
    expect(workers[0].terminated).toBe(true);
  });

  it('reports not checked when the worker crashes or cannot start', async () => {
    const crashed = runner.check(level());
    workers[0].onerror?.({});
    await expect(crashed).resolves.toEqual({ kind: 'not_checked' });
    const noWorker = new BlockCheckRunner({ createWorker: null, getBundle: () => bundle, timeoutMs: TIMEOUT_MS });
    await expect(noWorker.check(level())).resolves.toEqual({ kind: 'not_checked' });
  });
});

describe('createBlockCheckWorkerCore', () => {
  it('answers a check only after its configuration, and turns an error into a reply', () => {
    const replies: unknown[] = [];
    const applied: ConfigBundle[] = [];
    const handle = createBlockCheckWorkerCore(
      {
        applyConfigs: (b) => applied.push(b),
        check: (l) => {
          if (l.id === 'boom') throw new Error('boom');
          return { kind: 'unsolvable' };
        }
      },
      (response) => replies.push(response)
    );
    handle({ type: 'check', id: 1, level: level() });
    handle({ type: 'init', bundle });
    handle({ type: 'check', id: 2, level: level() });
    handle({ type: 'check', id: 3, level: { id: 'boom' } as CompiledLevel });
    expect(applied).toEqual([bundle]);
    expect(replies).toEqual([
      expect.objectContaining({ type: 'error', id: 1 }),
      { type: 'verdict', id: 2, verdict: { kind: 'unsolvable' } },
      { type: 'error', id: 3, message: 'boom' }
    ]);
  });
});
