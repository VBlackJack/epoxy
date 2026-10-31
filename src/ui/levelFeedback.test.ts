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
import {
  hasStoredSolution,
  isTimedLevel,
  combineStatusMessages,
  shouldAnnounceObjective,
  showsTargetsCounter,
  stuckMessageKey
} from './levelFeedback';

describe('stuckMessageKey', () => {
  it('names targets on a targets level and buttons otherwise', () => {
    expect(stuckMessageKey('targets')).toBe('hud.messages.blocks_stuck_targets.label');
    expect(stuckMessageKey('exit')).toBe('hud.messages.blocks_stuck.label');
    expect(stuckMessageKey(undefined)).toBe('hud.messages.blocks_stuck.label');
  });
});

describe('showsTargetsCounter', () => {
  it('is true only for the targets rule', () => {
    expect(showsTargetsCounter('targets')).toBe(true);
    expect(showsTargetsCounter('exit')).toBe(false);
    expect(showsTargetsCounter(undefined)).toBe(false);
  });
});

describe('isTimedLevel', () => {
  it('needs a positive time limit', () => {
    expect(isTimedLevel(120)).toBe(true);
    expect(isTimedLevel(0)).toBe(false);
  });
});

describe('hasStoredSolution', () => {
  it('is false for a missing or empty solution', () => {
    expect(hasStoredSolution({ solution: 'NESW' })).toBe(true);
    expect(hasStoredSolution({ solution: '' })).toBe(false);
    expect(hasStoredSolution({})).toBe(false);
  });
});

describe('shouldAnnounceObjective', () => {
  it('announces a targets level that starts outside a replay', () => {
    expect(shouldAnnounceObjective('targets')).toBe(true);
    expect(shouldAnnounceObjective('exit')).toBe(false);
    expect(shouldAnnounceObjective(undefined)).toBe(false);
  });
});

describe('combineStatusMessages', () => {
  it('joins the parts that exist into one message', () => {
    expect(combineStatusMessages('Imported.', 'Goal: cover every target.')).toBe(
      'Imported. Goal: cover every target.'
    );
  });

  it('skips missing and empty parts', () => {
    expect(combineStatusMessages('Imported.', null, undefined, '')).toBe('Imported.');
    expect(combineStatusMessages(null)).toBe('');
  });
});
