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
import type { CompiledLevel, LevelValidationReport } from '../core/types';
import type { LevelCheckWorkerRequest, LevelCheckWorkerResponse } from '../workers/levelCheckProtocol';
import { createLevelCheckWorkerCore } from '../workers/levelCheckWorkerCore';
import { LevelCheckResult, LevelCheckRunner, LevelCheckWorkerLike } from './levelCheckRunner';

const TIMEOUT_MS = 1000;
const LOCALE = 'fr';
const bundle = {} as ConfigBundle;

const REPORT: LevelValidationReport = {
  valid: true,
  issues: [],
  stats: { chipsPlaced: 0, chipsRequired: 0, exitCount: 1, reachableChips: 0, reachableExit: true, targetCount: 0 }
};

function level(id = 'runner'): CompiledLevel {
  return { id } as CompiledLevel;
}

class FakeWorker implements LevelCheckWorkerLike {
  public onmessage: LevelCheckWorkerLike['onmessage'] = null;
  public onerror: LevelCheckWorkerLike['onerror'] = null;
  public readonly requests: LevelCheckWorkerRequest[] = [];
  public terminated = false;
  public postMessage(message: LevelCheckWorkerRequest): void {
    this.requests.push(message);
  }
  public terminate(): void {
    this.terminated = true;
  }
  public reply(response: LevelCheckWorkerResponse): void {
    this.onmessage?.({ data: response });
  }
}

describe('LevelCheckRunner', () => {
  let workers: FakeWorker[];
  let validate: ReturnType<typeof vi.fn<(level: CompiledLevel) => LevelValidationReport>>;
  let results: LevelCheckResult[];
  let runner: LevelCheckRunner;
  const onDone = (result: LevelCheckResult): void => void results.push(result);

  const makeRunner = (createWorker: (() => LevelCheckWorkerLike) | null): LevelCheckRunner =>
    new LevelCheckRunner({ createWorker, getBundle: () => bundle, getLocale: () => LOCALE, validate });

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    results = [];
    validate = vi.fn(() => REPORT);
    runner = makeRunner(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the level with its configs and locale and reports what the worker answers', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    expect(runner.isRunning()).toBe(true);
    expect(workers[0].requests).toEqual([expect.objectContaining({ type: 'check', id: 1, bundle, locale: LOCALE })]);
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(runner.isRunning()).toBe(false);
    expect(validate).not.toHaveBeenCalled();
  });

  it('forwards the options to the worker, and to the inline validation', () => {
    runner.run(level(), TIMEOUT_MS, onDone, { doorOrderSearch: 'deep' });
    expect(workers[0].requests[0].options).toEqual({ doorOrderSearch: 'deep' });
    const inline = new LevelCheckRunner({ createWorker: null, getBundle: () => bundle, getLocale: () => LOCALE, validate });
    inline.run(level(), TIMEOUT_MS, onDone, { doorOrderSearch: 'deep' });
    expect(validate).toHaveBeenCalledWith(expect.anything(), { doorOrderSearch: 'deep' });
  });

  it('reuses its worker for the next check', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    runner.run(level(), TIMEOUT_MS, onDone);
    expect(workers).toHaveLength(1);
    expect(workers[0].requests).toHaveLength(2);
  });

  it('abandons the running check, and its worker, when a newer one starts', () => {
    runner.run(level('first'), TIMEOUT_MS, onDone);
    runner.run(level('second'), TIMEOUT_MS, onDone);
    expect(results).toEqual([{ kind: 'cancelled' }]);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    // A late answer of the abandoned worker is ignored.
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    expect(results).toHaveLength(1);
    workers[1].reply({ type: 'report', id: 2, report: REPORT });
    expect(results[1]).toEqual({ kind: 'report', report: REPORT });
  });

  it('reports a timeout when the check outlasts its time, and drops the worker', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    vi.advanceTimersByTime(TIMEOUT_MS);
    expect(results).toEqual([{ kind: 'timeout' }]);
    expect(workers[0].terminated).toBe(true);
  });

  it('lets a caller join the running check, and tells both the same report', () => {
    const joined: LevelCheckResult[] = [];
    expect(runner.join(TIMEOUT_MS, (result) => joined.push(result))).toBe(false);
    runner.run(level(), TIMEOUT_MS, onDone);
    expect(runner.join(TIMEOUT_MS, (result) => joined.push(result))).toBe(true);
    expect(workers[0].requests).toHaveLength(1);
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(joined).toEqual([{ kind: 'report', report: REPORT }]);
  });

  it('gives a joined caller its own timeout while the check goes on', () => {
    const joined: LevelCheckResult[] = [];
    runner.run(level(), TIMEOUT_MS, onDone);
    vi.advanceTimersByTime(TIMEOUT_MS / 2);
    runner.join(TIMEOUT_MS / 4, (result) => joined.push(result));
    vi.advanceTimersByTime(TIMEOUT_MS / 4);
    expect(joined).toEqual([{ kind: 'timeout' }]);
    expect(results).toEqual([]);
    expect(runner.isRunning()).toBe(true);
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(joined).toHaveLength(1);
  });

  it('tells a joined caller when the check is cancelled', () => {
    const joined: LevelCheckResult[] = [];
    runner.run(level(), TIMEOUT_MS, onDone);
    runner.join(TIMEOUT_MS, (result) => joined.push(result));
    runner.cancel();
    expect(joined).toEqual([{ kind: 'cancelled' }]);
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(joined).toHaveLength(1);
  });

  it('gives up on workers when one fails before it is ready, and checks inline from then on', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    workers[0].onerror?.({});
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(validate).toHaveBeenCalledTimes(1);
    runner.run(level(), TIMEOUT_MS, onDone);
    expect(workers).toHaveLength(1);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('reports an error when the worker crashes after it answered, or answers an error', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    workers[0].reply({ type: 'ready' });
    workers[0].reply({ type: 'report', id: 1, report: REPORT });
    runner.run(level(), TIMEOUT_MS, onDone);
    workers[0].onerror?.({});
    expect(results[1]).toEqual({ kind: 'error' });
    expect(workers[0].terminated).toBe(true);
    // A crash after a first answer is not a setup problem: the next check starts a new worker.
    runner.run(level(), TIMEOUT_MS, onDone);
    expect(workers).toHaveLength(2);
    workers[1].reply({ type: 'error', id: 3, message: 'boom' });
    expect(results[2]).toEqual({ kind: 'error' });
    expect(workers[1].terminated).toBe(false);
    expect(validate).not.toHaveBeenCalled();
  });

  it('validates inline from then on when a worker fails before it ever answered', () => {
    runner.run(level('first'), TIMEOUT_MS, onDone);
    workers[0].onerror?.({});
    // The check that was running is validated inline, not reported as an error.
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(workers[0].terminated).toBe(true);
    runner.run(level('second'), TIMEOUT_MS, onDone);
    expect(workers).toHaveLength(1);
    expect(results).toHaveLength(2);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(runner.isRunning()).toBe(false);
  });

  it('forwards the options to the inline fallback when the worker never worked', () => {
    runner.run(level('first'), TIMEOUT_MS, onDone, { doorOrderSearch: 'deep' });
    workers[0].onerror?.({});
    expect(validate).toHaveBeenCalledWith(expect.anything(), { doorOrderSearch: 'deep' });
  });

  it('cancels the check in progress and terminates the idle worker when disposed', () => {
    runner.run(level(), TIMEOUT_MS, onDone);
    runner.dispose();
    expect(results).toEqual([{ kind: 'cancelled' }]);
    expect(workers[0].terminated).toBe(true);
    runner.dispose();
    expect(results).toHaveLength(1);
  });

  it('validates inline, before run returns, when workers are unavailable', () => {
    const inline = makeRunner(null);
    inline.run(level(), TIMEOUT_MS, onDone);
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(inline.isRunning()).toBe(false);
  });

  it('validates inline when the worker cannot be created', () => {
    const inline = makeRunner(() => {
      throw new Error('no worker');
    });
    inline.run(level(), TIMEOUT_MS, onDone);
    expect(results).toEqual([{ kind: 'report', report: REPORT }]);
  });

  it('reports an error when the inline validation throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    validate.mockImplementation(() => {
      throw new Error('boom');
    });
    makeRunner(null).run(level(), TIMEOUT_MS, onDone);
    expect(results).toEqual([{ kind: 'error' }]);
    error.mockRestore();
  });
});

describe('createLevelCheckWorkerCore', () => {
  it('installs the configs and the locale of each check, then answers the report', () => {
    const replies: LevelCheckWorkerResponse[] = [];
    const applied: ConfigBundle[] = [];
    const locales: string[] = [];
    const handle = createLevelCheckWorkerCore(
      {
        applyConfigs: (b) => applied.push(b),
        setLocale: (locale) => locales.push(locale),
        validate: () => REPORT,
        solutionWins: () => true
      },
      (response) => replies.push(response)
    );
    handle({ type: 'check', id: 4, level: level(), bundle, locale: LOCALE });
    expect(applied).toEqual([bundle]);
    expect(locales).toEqual([LOCALE]);
    expect(replies).toEqual([{ type: 'ready' }, { type: 'report', id: 4, report: REPORT }]);
  });

  it('validates with the locale already installed, so colour names come out in the page language', () => {
    const order: string[] = [];
    const handle = createLevelCheckWorkerCore(
      {
        applyConfigs: () => order.push('configs'),
        setLocale: () => order.push('locale'),
        validate: () => {
          order.push('validate');
          return REPORT;
        },
        solutionWins: () => true
      },
      () => undefined
    );
    handle({ type: 'check', id: 1, level: level(), bundle, locale: LOCALE });
    expect(order).toEqual(['configs', 'locale', 'validate']);
  });

  it('hands the stored solution check to the validation', () => {
    const solutionWins = vi.fn(() => true);
    const validate = vi.fn((_level: CompiledLevel, _wins: unknown) => REPORT);
    const handle = createLevelCheckWorkerCore({ applyConfigs: () => undefined, setLocale: () => undefined, validate, solutionWins }, () => undefined);
    const checked = level('solved');
    handle({ type: 'check', id: 6, level: checked, bundle, locale: LOCALE });
    expect(validate).toHaveBeenCalledWith(checked, solutionWins, undefined);
  });

  it('passes the options of the request to the validation', () => {
    const validate = vi.fn((_level: CompiledLevel, _wins: unknown, _options: unknown) => REPORT);
    const handle = createLevelCheckWorkerCore(
      { applyConfigs: () => undefined, setLocale: () => undefined, validate, solutionWins: () => true },
      () => undefined
    );
    handle({ type: 'check', id: 7, level: level('deep'), bundle, locale: LOCALE, options: { doorOrderSearch: 'deep' } });
    expect(validate.mock.calls[0][2]).toEqual({ doorOrderSearch: 'deep' });
  });

  it('turns an error into a reply', () => {
    const replies: LevelCheckWorkerResponse[] = [];
    const handle = createLevelCheckWorkerCore(
      {
        applyConfigs: () => undefined,
        setLocale: () => undefined,
        validate: () => {
          throw new Error('boom');
        },
        solutionWins: () => true
      },
      (response) => replies.push(response)
    );
    handle({ type: 'check', id: 5, level: level(), bundle, locale: LOCALE });
    expect(replies).toEqual([{ type: 'ready' }, { type: 'error', id: 5, message: 'boom' }]);
  });
});
