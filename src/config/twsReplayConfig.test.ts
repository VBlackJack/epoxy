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
import { ConfigRegistry } from './ConfigRegistry';
import { ConfigLoadError, findTwsReplayConfigErrors } from './ConfigValidation';
import { createTestBundle } from '../test/loadTestConfigs';

describe('findTwsReplayConfigErrors', () => {
  const valid = { maxFileBytes: 1048576, maxSolutionTicks: 1000000, graceTicks: 600, maxSetNameChars: 64 };

  it('accepts the shipped section', () => {
    expect(findTwsReplayConfigErrors(createTestBundle().game.twsReplay)).toEqual([]);
    expect(createTestBundle().game.twsReplay.maxFileBytes).toBe(1048576);
  });

  it('requires the section: missing or not an object', () => {
    expect(findTwsReplayConfigErrors(undefined)).toEqual(['twsReplay: not an object']);
    expect(findTwsReplayConfigErrors('x')).toEqual(['twsReplay: not an object']);
    expect(findTwsReplayConfigErrors(null)).toEqual(['twsReplay: not an object']);
  });

  it('names each limit that is not a positive integer', () => {
    expect(findTwsReplayConfigErrors({ ...valid, maxFileBytes: 0 })).toEqual(['twsReplay.maxFileBytes: not a positive integer']);
    expect(findTwsReplayConfigErrors({ ...valid, graceTicks: 1.5, maxSetNameChars: -1 })).toEqual([
      'twsReplay.graceTicks: not a positive integer',
      'twsReplay.maxSetNameChars: not a positive integer'
    ]);
    expect(findTwsReplayConfigErrors({ maxFileBytes: 1 })).toEqual([
      'twsReplay.maxSolutionTicks: not a positive integer',
      'twsReplay.graceTicks: not a positive integer',
      'twsReplay.maxSetNameChars: not a positive integer'
    ]);
  });

  it('makes the config load fail when the section is absent, like the block puzzle section', () => {
    const bundle = createTestBundle();
    delete (bundle.game as unknown as Record<string, unknown>).twsReplay;
    expect(() => ConfigRegistry.applyConfigs(bundle)).toThrow(ConfigLoadError);
  });
});
