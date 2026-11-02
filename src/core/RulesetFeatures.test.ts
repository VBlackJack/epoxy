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
import { featuresFor } from './RulesetFeatures';

describe('featuresFor rulesets', () => {
  it('turns every Epoxy play aid off for a cc3d level, even with a win rule', () => {
    for (const level of [{ ruleset: 'cc3d' as const }, { ruleset: 'cc3d' as const, winRule: 'receivers' as const }]) {
      const f = featuresFor(level);
      expect(f.tapToPath).toBe(false);
      expect(f.objectiveMarker).toBe(false);
      expect(f.blockHint).toBe(false);
      expect(f.deadEndWatch).toBe(false);
      expect(f.solutionReplay).toBe(false);
      expect(f.itemDrop).toBe(false);
    }
  });

  it('matches the lynx aids for cc3d and keeps the Epoxy aids otherwise', () => {
    expect(featuresFor({ ruleset: 'cc3d' })).toEqual(featuresFor({ ruleset: 'lynx' }));
    expect(featuresFor({ ruleset: 'epoxy' }).tapToPath).toBe(true);
    expect(featuresFor(undefined).deadEndWatch).toBe(true);
  });
});
