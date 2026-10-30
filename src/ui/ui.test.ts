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
import { TimedMove } from '../core/types';
import { computeTrapFocusIndex } from './dialog';
import { slotStateChanged } from './inventorySlots';
import { getMedalTier, medalIconKey, medalLabelKey } from './medals';
import { collectDueMoves, sanitizeTimedMoves } from './replaySchedule';
import { cycleZoomPreset, stepZoomPreset } from './viewportZoom';

describe('computeTrapFocusIndex', () => {
  it('wraps forward and backward', () => {
    expect(computeTrapFocusIndex(2, 3, false)).toBe(0);
    expect(computeTrapFocusIndex(0, 3, true)).toBe(2);
    expect(computeTrapFocusIndex(1, 3, false)).toBe(2);
  });

  it('enters the trap at an end when focus is outside', () => {
    expect(computeTrapFocusIndex(-1, 4, false)).toBe(0);
    expect(computeTrapFocusIndex(-1, 4, true)).toBe(3);
  });

  it('returns -1 when nothing is focusable', () => {
    expect(computeTrapFocusIndex(0, 0, false)).toBe(-1);
  });
});

describe('replay scheduling', () => {
  const moves: TimedMove[] = [
    { tick: 0, dir: 'E' },
    { tick: 4, dir: 'E' },
    { tick: 4, dir: 'S' },
    { tick: 9, dir: 'N' }
  ];

  it('returns nothing before the next move tick', () => {
    expect(collectDueMoves(moves, 1, 3)).toEqual({ due: [], nextIndex: 1 });
  });

  it('returns every move sharing the current tick, in order', () => {
    expect(collectDueMoves(moves, 1, 4)).toEqual({ due: [moves[1], moves[2]], nextIndex: 3 });
  });

  it('returns late moves once so a failed move is skipped, not retried', () => {
    const first = collectDueMoves(moves, 0, 10);
    expect(first.due).toHaveLength(4);
    expect(collectDueMoves(moves, first.nextIndex, 11).due).toEqual([]);
  });

  it('sanitizes stored timed moves', () => {
    expect(sanitizeTimedMoves(moves)).toEqual(moves);
    expect(sanitizeTimedMoves(undefined)).toBeUndefined();
    expect(sanitizeTimedMoves([{ tick: 1, dir: 'X' }])).toBeUndefined();
    expect(sanitizeTimedMoves([{ tick: 5, dir: 'N' }, { tick: 2, dir: 'S' }])).toBeUndefined();
  });
});

describe('zoom presets', () => {
  const presets = [9, 13, 17, 32];

  it('steps and clamps', () => {
    expect(stepZoomPreset(presets, 13, 1, 13)).toBe(17);
    expect(stepZoomPreset(presets, 13, -1, 13)).toBe(9);
    expect(stepZoomPreset(presets, 9, -1, 13)).toBe(9);
    expect(stepZoomPreset(presets, 32, 1, 13)).toBe(32);
  });

  it('starts from the fallback when the current value is not a preset', () => {
    expect(stepZoomPreset(presets, 11, 1, 13)).toBe(17);
  });

  it('cycles with wrap-around', () => {
    expect(cycleZoomPreset(presets, 32)).toBe(9);
    expect(cycleZoomPreset(presets, 9)).toBe(13);
  });
});

describe('medals', () => {
  it('picks the tier from the remaining time ratio', () => {
    expect(getMedalTier(60, 100, 0.5, 0.25)).toBe('gold');
    expect(getMedalTier(30, 100, 0.5, 0.25)).toBe('silver');
    expect(getMedalTier(10, 100, 0.5, 0.25)).toBe('bronze');
    expect(getMedalTier(0, 0, 0.5, 0.25)).toBeNull();
    expect(getMedalTier(500, 0, 0.5, 0.25)).toBeNull();
  });

  it('maps tiers to dedicated label and icon keys', () => {
    expect(medalLabelKey('silver')).toBe('hud.messages.medal_silver.label');
    expect(medalIconKey('bronze')).toBe('hud.messages.medal_bronze_icon.label');
  });
});

describe('inventory slot change detection', () => {
  const base = { owned: false, badge: '', label: 'Red Key', iconUrl: 'data:a' };

  it('detects first render and real changes only', () => {
    expect(slotStateChanged(null, base)).toBe(true);
    expect(slotStateChanged(base, { ...base })).toBe(false);
    expect(slotStateChanged(base, { ...base, owned: true })).toBe(true);
    expect(slotStateChanged(base, { ...base, label: 'Clé Rouge' })).toBe(true);
  });
});
