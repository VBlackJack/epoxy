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

import { describe, expect, it } from 'vitest';
import type { ConfigBundle } from '../config/ConfigRegistry';
import type { CompiledLevel } from '../core/types';
import { ProceduralGenerator } from '../core/ProceduralGenerator';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { createEndlessWorkerCore } from './endlessWorkerCore';
import type { EndlessWorkerResponse } from './endlessProtocol';

const bundle = {} as ConfigBundle;

function makeCore(generate: (seed: number, levelNumber: number) => CompiledLevel) {
  const replies: EndlessWorkerResponse[] = [];
  const applied: ConfigBundle[] = [];
  const handle = createEndlessWorkerCore(
    { applyConfigs: (b) => applied.push(b), generate },
    (r) => replies.push(r)
  );
  return { handle, replies, applied };
}

describe('createEndlessWorkerCore', () => {
  it('installs the configs on init and answers generate requests', () => {
    const { handle, replies, applied } = makeCore((seed, n) => ({ id: `${seed}_${n}`, number: n }) as CompiledLevel);
    handle({ type: 'init', bundle });
    handle({ type: 'generate', id: 4, seed: 11, levelNumber: 6 });
    expect(applied).toEqual([bundle]);
    expect(replies).toEqual([{ type: 'level', id: 4, level: { id: '11_6', number: 6 } }]);
  });

  it('refuses to generate before the configs arrived', () => {
    const { handle, replies } = makeCore(() => {
      throw new Error('must not run');
    });
    handle({ type: 'generate', id: 1, seed: 1, levelNumber: 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'error', id: 1 });
  });

  it('turns a generator exception into an error response', () => {
    const { handle, replies } = makeCore(() => {
      throw new Error('could not build');
    });
    handle({ type: 'init', bundle });
    handle({ type: 'generate', id: 2, seed: 1, levelNumber: 1 });
    expect(replies).toEqual([{ type: 'error', id: 2, message: 'could not build' }]);
  });

  it('returns a level that survives structured cloning, as the worker will post it', () => {
    loadTestConfigs();
    const { handle, replies } = makeCore((seed, n) => ProceduralGenerator.generateEndlessLevel(n, seed).level);
    handle({ type: 'init', bundle });
    handle({ type: 'generate', id: 0, seed: 12345, levelNumber: 1 });
    const reply = replies[0];
    expect(reply.type).toBe('level');
    if (reply.type === 'level') {
      expect(() => structuredClone(reply.level)).not.toThrow();
      expect(reply.level.number).toBe(1);
    }
  }, 60000);
});
