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

import { describe, expect, it, vi } from 'vitest';
import type { ConfigBundle } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import type { EndlessWorkerRequest, EndlessWorkerResponse } from '../workers/endlessProtocol';
import { EndlessGenerator, EndlessWorkerLike } from './endlessGenerator';

const fakeLevel = (number: number, tag = 'worker'): CompiledLevel => ({ id: `${tag}_${number}`, number }) as CompiledLevel;
const fakeBundle = { game: {} } as unknown as ConfigBundle;

class FakeWorker implements EndlessWorkerLike {
  public onmessage: ((event: { data: EndlessWorkerResponse }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onmessageerror: ((event: unknown) => void) | null = null;
  public readonly received: EndlessWorkerRequest[] = [];
  public terminated = false;

  public postMessage(message: EndlessWorkerRequest): void {
    this.received.push(message);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public answer(response: EndlessWorkerResponse): void {
    this.onmessage?.({ data: response });
  }
}

function makeGenerator(worker: FakeWorker | null, options: { throwOnCreate?: boolean } = {}) {
  const generateLocal = vi.fn((seed: number, levelNumber: number) => fakeLevel(levelNumber, `local${seed}`));
  const yieldToUi = vi.fn(() => Promise.resolve());
  const createWorker =
    worker === null
      ? null
      : () => {
          if (options.throwOnCreate) throw new Error('blocked');
          return worker;
        };
  const generator = new EndlessGenerator({ createWorker, getBundle: () => fakeBundle, generateLocal, yieldToUi });
  return { generator, generateLocal, yieldToUi };
}

/** A generator whose successive workers are the given fakes, in order. */
function makeGeneratorWithWorkers(workers: FakeWorker[]) {
  const generateLocal = vi.fn((seed: number, levelNumber: number) => fakeLevel(levelNumber, `local${seed}`));
  const yieldToUi = vi.fn(() => Promise.resolve());
  let created = 0;
  const createWorker = vi.fn(() => {
    const worker = workers[created++];
    if (!worker) throw new Error('no more workers');
    return worker;
  });
  const generator = new EndlessGenerator({ createWorker, getBundle: () => fakeBundle, generateLocal, yieldToUi });
  return { generator, generateLocal, createWorker };
}

const generateIds = (worker: FakeWorker): number[] =>
  worker.received.filter((m) => m.type === 'generate').map((m) => (m as { id: number }).id);

describe('EndlessGenerator with a worker', () => {
  it('posts the config bundle once, then one generate request per level', async () => {
    const worker = new FakeWorker();
    const { generator, generateLocal } = makeGenerator(worker);
    const first = generator.request(7, 3);
    const second = generator.request(7, 4);
    expect(worker.received[0]).toEqual({ type: 'init', bundle: fakeBundle });
    expect(worker.received.filter((m) => m.type === 'init')).toHaveLength(1);
    const ids = worker.received.filter((m) => m.type === 'generate').map((m) => (m as { id: number }).id);
    expect(ids).toHaveLength(2);
    worker.answer({ type: 'level', id: ids[1], level: fakeLevel(4) });
    worker.answer({ type: 'level', id: ids[0], level: fakeLevel(3) });
    expect((await first).number).toBe(3);
    expect((await second).number).toBe(4);
    expect(generateLocal).not.toHaveBeenCalled();
    expect(generator.usesWorker()).toBe(true);
  });

  it('shares one request between identical concurrent calls', () => {
    const worker = new FakeWorker();
    const { generator } = makeGenerator(worker);
    const a = generator.request(1, 2);
    const b = generator.request(1, 2);
    expect(a).toBe(b);
    expect(worker.received.filter((m) => m.type === 'generate')).toHaveLength(1);
  });

  it('rejects when the worker reports a generation error, without falling back', async () => {
    const worker = new FakeWorker();
    const { generator, generateLocal } = makeGenerator(worker);
    const pending = generator.request(1, 2);
    worker.answer({ type: 'error', id: 0, message: 'no level' });
    await expect(pending).rejects.toThrow('no level');
    expect(generateLocal).not.toHaveBeenCalled();
    expect(generator.usesWorker()).toBe(true);
  });

  it('serves unanswered requests and later ones on the main thread when the worker crashes', async () => {
    const worker = new FakeWorker();
    const { generator, generateLocal, yieldToUi } = makeGenerator(worker);
    const orphan = generator.request(9, 5);
    worker.onerror?.(new Error('boom'));
    expect((await orphan).id).toBe('local9_5');
    expect(worker.terminated).toBe(true);
    expect(generator.usesWorker()).toBe(false);
    expect((await generator.request(9, 6)).id).toBe('local9_6');
    expect(generateLocal).toHaveBeenCalledTimes(2);
    expect(yieldToUi).toHaveBeenCalledTimes(2);
  });

  it('rejects pending requests on dispose', async () => {
    const worker = new FakeWorker();
    const { generator } = makeGenerator(worker);
    const pending = generator.request(1, 1);
    generator.dispose();
    await expect(pending).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });
});

describe('EndlessGenerator without a worker', () => {
  it('generates on the main thread, pausing for the page first, when Worker is unavailable', async () => {
    const { generator, generateLocal, yieldToUi } = makeGenerator(null);
    const order: string[] = [];
    yieldToUi.mockImplementation(() => {
      order.push('yield');
      return Promise.resolve();
    });
    generateLocal.mockImplementation((seed, levelNumber) => {
      order.push('generate');
      return fakeLevel(levelNumber, `local${seed}`);
    });
    const level = await generator.request(4, 8);
    expect(level.id).toBe('local4_8');
    expect(order).toEqual(['yield', 'generate']);
    expect(generator.usesWorker()).toBe(false);
  });

  it('falls back when the worker cannot be created', async () => {
    const { generator } = makeGenerator(new FakeWorker(), { throwOnCreate: true });
    expect((await generator.request(2, 3)).id).toBe('local2_3');
    expect(generator.usesWorker()).toBe(false);
  });
});

describe('EndlessGenerator reset', () => {
  it('terminates the worker, rejects what is pending and serves the next request with a fresh worker', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { generator, generateLocal, createWorker } = makeGeneratorWithWorkers([first, second]);
    const abandoned = generator.request(3, 10);
    expect(generator.hasPending()).toBe(true);
    generator.reset();
    await expect(abandoned).rejects.toThrow();
    expect(first.terminated).toBe(true);
    expect(generator.hasPending()).toBe(false);
    expect(generator.usesWorker()).toBe(true);

    const next = generator.request(3, 10);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(second.received[0]).toEqual({ type: 'init', bundle: fakeBundle });
    const [id] = generateIds(second);
    second.answer({ type: 'level', id, level: fakeLevel(10) });
    expect((await next).number).toBe(10);
    expect(generateLocal).not.toHaveBeenCalled();
  });

  it('does not share the request abandoned by a reset with the identical one that follows', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { generator } = makeGeneratorWithWorkers([first, second]);
    const abandoned = generator.request(1, 1);
    abandoned.catch(() => undefined);
    generator.reset();
    const next = generator.request(1, 1);
    expect(next).not.toBe(abandoned);
    await abandoned.catch(() => undefined);
    // The abandoned call settling must not drop the key of the new one.
    expect(generator.request(1, 1)).toBe(next);
  });

  it('ignores a late crash event of the worker it replaced', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const { generator, generateLocal } = makeGeneratorWithWorkers([first, second]);
    generator.request(1, 1).catch(() => undefined);
    generator.reset();
    const next = generator.request(1, 2);
    first.onerror?.(new Error('late'));
    expect(second.terminated).toBe(false);
    expect(generator.usesWorker()).toBe(true);
    second.answer({ type: 'level', id: generateIds(second)[0], level: fakeLevel(2) });
    expect((await next).number).toBe(2);
    expect(generateLocal).not.toHaveBeenCalled();
  });

  it('reports nothing pending on an idle generator', () => {
    const { generator } = makeGeneratorWithWorkers([new FakeWorker()]);
    expect(generator.hasPending()).toBe(false);
  });
});
