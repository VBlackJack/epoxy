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

type Handler = () => void;

/** Stands in for window and AudioContext: records listeners and lets a test pick the resume outcome. */
class FakeEnvironment {
  public readonly listeners = new Map<string, Set<Handler>>();
  public contexts: FakeAudioContext[] = [];
  /** State the next resume() call settles into. */
  public stateAfterResume = 'running';
  public readonly window = {
    addEventListener: (type: string, handler: Handler): void => {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)?.add(handler);
    },
    removeEventListener: (type: string, handler: Handler): void => {
      this.listeners.get(type)?.delete(handler);
    },
    AudioContext: class {} as unknown
  };

  constructor() {
    const env = this;
    this.window.AudioContext = class extends FakeAudioContext {
      constructor() {
        super(env);
        env.contexts.push(this);
      }
    };
  }

  public listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  public fire(type: string): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler();
  }
}

class FakeAudioContext {
  public state = 'suspended';
  public resumeCalls = 0;
  constructor(private readonly env: FakeEnvironment) {}
  public resume(): Promise<void> {
    this.resumeCalls++;
    this.state = this.env.stateAfterResume;
    return Promise.resolve();
  }
}

async function loadManager(env: FakeEnvironment): Promise<void> {
  vi.resetModules();
  vi.stubGlobal('window', env.window);
  await import('./AudioManager');
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AudioManager gesture unlock', () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listens to touchend and click as well as the original gestures', async () => {
    await loadManager(env);
    expect([...env.listeners.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'touchend', 'touchstart']);
  });

  it('creates and resumes the context on the first gesture, then releases the listeners', async () => {
    await loadManager(env);
    env.fire('pointerdown');
    await flushPromises();
    expect(env.contexts).toHaveLength(1);
    expect(env.contexts[0].resumeCalls).toBe(1);
    expect(env.listenerCount()).toBe(0);
  });

  it('keeps listening while the context stays interrupted, and resumes on the next gesture', async () => {
    env.stateAfterResume = 'interrupted';
    await loadManager(env);
    env.fire('touchstart');
    await flushPromises();
    expect(env.contexts[0].state).toBe('interrupted');
    expect(env.listenerCount()).toBeGreaterThan(0);

    env.stateAfterResume = 'running';
    env.fire('touchend');
    await flushPromises();
    expect(env.contexts[0].resumeCalls).toBe(2);
    expect(env.contexts[0].state).toBe('running');
    expect(env.listenerCount()).toBe(0);
  });

  it('never resumes a closed context', async () => {
    env.stateAfterResume = 'closed';
    await loadManager(env);
    env.fire('click');
    await flushPromises();
    env.fire('click');
    await flushPromises();
    expect(env.contexts[0].state).toBe('closed');
    expect(env.contexts[0].resumeCalls).toBe(1);
  });
});
