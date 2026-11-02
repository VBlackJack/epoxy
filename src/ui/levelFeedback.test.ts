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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  hasStoredSolution,
  isSokobanSkinApplicable,
  isTimedLevel,
  combineStatusMessages,
  objectiveMessageKey,
  receiversProgress,
  shouldAnnounceObjective,
  showsReceiversCounter,
  showsTargetsCounter,
  stuckMessageKey
} from './levelFeedback';

beforeAll(() => {
  loadTestConfigs();
});

describe('stuckMessageKey', () => {
  it('names targets on a targets level and buttons otherwise', () => {
    expect(stuckMessageKey('targets')).toBe('hud.messages.blocks_stuck_targets.label');
    expect(stuckMessageKey('exit')).toBe('hud.messages.blocks_stuck.label');
    expect(stuckMessageKey(undefined)).toBe('hud.messages.blocks_stuck.label');
  });
});

describe('isSokobanSkinApplicable', () => {
  it('is true only for the targets rule', () => {
    expect(isSokobanSkinApplicable('targets')).toBe(true);
    expect(isSokobanSkinApplicable('exit')).toBe(false);
    expect(isSokobanSkinApplicable(undefined)).toBe(false);
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

describe('receivers level feedback', () => {
  it('counts receivers on a receivers level only', () => {
    expect(showsReceiversCounter('receivers')).toBe(true);
    expect(showsReceiversCounter('targets')).toBe(false);
    expect(showsReceiversCounter(undefined)).toBe(false);
    expect(showsTargetsCounter('receivers')).toBe(false);
  });

  it('announces the goal of a receivers level with its own message', () => {
    expect(objectiveMessageKey('receivers')).toBe('hud.messages.objective_receivers.label');
    expect(objectiveMessageKey('targets')).toBe('hud.messages.objective_targets.label');
    expect(objectiveMessageKey('exit')).toBeNull();
    expect(shouldAnnounceObjective('receivers')).toBe(true);
  });

  it('reports the lit receivers over all the receivers of the terrain', () => {
    const terrain = [
      ['wall', 'laser_receiver_red', 'floor'],
      ['floor', 'laser_receiver_blue', 'laser_receiver_red']
    ];
    expect(receiversProgress(terrain, [{ x: 1, y: 0 }])).toEqual({ lit: 1, total: 3 });
    expect(receiversProgress([['floor']], [])).toEqual({ lit: 0, total: 0 });
  });
});
