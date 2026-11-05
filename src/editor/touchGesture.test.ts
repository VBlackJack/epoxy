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
import { EDITOR_TOUCH_PINCH_START_PX, EDITOR_TOUCH_PINCH_STEP_RATIO } from '../ui/uiConstants';
import { distance, midpoint, pinchStep, startsPinch } from './touchGesture';

describe('touch gesture geometry', () => {
  it('finds the midpoint and the distance of two fingers', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('starts a pinch only past the threshold, either way', () => {
    expect(startsPinch(100 + EDITOR_TOUCH_PINCH_START_PX, 100, EDITOR_TOUCH_PINCH_START_PX)).toBe(false);
    expect(startsPinch(100 + EDITOR_TOUCH_PINCH_START_PX + 1, 100, EDITOR_TOUCH_PINCH_START_PX)).toBe(true);
    expect(startsPinch(100 - EDITOR_TOUCH_PINCH_START_PX - 1, 100, EDITOR_TOUCH_PINCH_START_PX)).toBe(true);
  });

  it('steps in or out when the distance crosses the ratio, and not before', () => {
    const ratio = EDITOR_TOUCH_PINCH_STEP_RATIO;
    expect(pinchStep(100 * ratio, 100, ratio)).toBe('in');
    expect(pinchStep(100 * ratio - 1, 100, ratio)).toBeNull();
    expect(pinchStep(100 / ratio, 100, ratio)).toBe('out');
    expect(pinchStep(100 / ratio + 1, 100, ratio)).toBeNull();
  });

  it('never steps on a zero reference or a ratio of one or less', () => {
    expect(pinchStep(50, 0, EDITOR_TOUCH_PINCH_STEP_RATIO)).toBeNull();
    expect(pinchStep(50, 100, 1)).toBeNull();
  });
});
