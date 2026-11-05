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
  DEFAULT_DPAD_SIDE,
  MAX_CAMERA_INSET,
  NO_CAMERA_INSETS,
  TOUCH_OVERLAY_MAX_SHORT_SIDE_PX,
  computeCameraInsets,
  parseDpadSide,
  resolveTouchOverlay
} from './touchOverlay';
import type { TouchOverlayInput } from './touchOverlay';

const PHONE: TouchOverlayInput = {
  fullscreenClass: true,
  standalone: false,
  coarse: true,
  shortSide: 390,
  mode: 'play'
};

describe('resolveTouchOverlay', () => {
  it('is on for a touch phone in full screen in the play view', () => {
    expect(resolveTouchOverlay(PHONE)).toBe(true);
  });

  it('is off on a desktop: fine pointer, wide window', () => {
    expect(resolveTouchOverlay({ ...PHONE, coarse: false, shortSide: 900 })).toBe(false);
    expect(resolveTouchOverlay({ ...PHONE, fullscreenClass: false, coarse: false, shortSide: 900 })).toBe(false);
  });

  it('is off on a desktop in full screen with a fine pointer even in a small window', () => {
    expect(resolveTouchOverlay({ ...PHONE, coarse: false })).toBe(false);
  });

  it('is off for a touch phone that is not in full screen', () => {
    expect(resolveTouchOverlay({ ...PHONE, fullscreenClass: false })).toBe(false);
  });

  it('is off for a tablet: the short side is above the phone limit', () => {
    expect(resolveTouchOverlay({ ...PHONE, shortSide: TOUCH_OVERLAY_MAX_SHORT_SIDE_PX + 1 })).toBe(false);
    expect(resolveTouchOverlay({ ...PHONE, shortSide: 768 })).toBe(false);
  });

  it('keeps the phone limit itself', () => {
    expect(resolveTouchOverlay({ ...PHONE, shortSide: TOUCH_OVERLAY_MAX_SHORT_SIDE_PX })).toBe(true);
  });

  it('is on for an installed app in standalone display mode without the full screen class', () => {
    expect(resolveTouchOverlay({ ...PHONE, fullscreenClass: false, standalone: true })).toBe(true);
  });

  it('is off outside the play view', () => {
    expect(resolveTouchOverlay({ ...PHONE, mode: 'editor' })).toBe(false);
  });

  it('is on in landscape: the short side is the height', () => {
    expect(resolveTouchOverlay({ ...PHONE, shortSide: 360 })).toBe(true);
  });
});

describe('parseDpadSide', () => {
  it('keeps a valid side', () => {
    expect(parseDpadSide('left')).toBe('left');
    expect(parseDpadSide('right')).toBe('right');
  });

  it('falls back to the right for anything else', () => {
    for (const value of [undefined, null, '', 'LEFT', 'center', 0, {}, ['left']]) {
      expect(parseDpadSide(value)).toBe(DEFAULT_DPAD_SIDE);
    }
    expect(DEFAULT_DPAD_SIDE).toBe('right');
  });
});

describe('computeCameraInsets', () => {
  const canvas = { left: 0, right: 800, top: 0, bottom: 400 };

  it('is zero outside the overlay layout', () => {
    const pad = { left: 600, right: 780, top: 220, bottom: 388 };
    expect(computeCameraInsets({ active: false, landscape: true, side: 'right', canvas, pad, tilePx: 40 })).toEqual(
      NO_CAMERA_INSETS
    );
  });

  it('insets the right side by the pad width plus half a tile in landscape', () => {
    const pad = { left: 620, right: 788, top: 220, bottom: 388 };
    const insets = computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, pad, tilePx: 40 });
    expect(insets).toEqual({ left: 0, right: (800 - 620 + 20) / 800, top: 0, bottom: 0 });
  });

  it('insets the left side when the pad is on the left', () => {
    const pad = { left: 12, right: 180, top: 220, bottom: 388 };
    const insets = computeCameraInsets({ active: true, landscape: true, side: 'left', canvas, pad, tilePx: 40 });
    expect(insets).toEqual({ left: (180 + 20) / 800, right: 0, top: 0, bottom: 0 });
  });

  it('insets the bottom in portrait whichever side the pad is on', () => {
    const portraitCanvas = { left: 0, right: 400, top: 0, bottom: 800 };
    const pad = { left: 220, right: 388, top: 620, bottom: 788 };
    for (const side of ['left', 'right'] as const) {
      const insets = computeCameraInsets({ active: true, landscape: false, side, canvas: portraitCanvas, pad, tilePx: 40 });
      expect(insets).toEqual({ left: 0, right: 0, top: 0, bottom: (800 - 620 + 20) / 800 });
    }
  });

  it('never goes beyond the renderer limit and ignores unusable boxes', () => {
    const huge = { left: 0, right: 800, top: 0, bottom: 400 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, pad: huge, tilePx: 40 }).right
    ).toBe(MAX_CAMERA_INSET);
    const empty = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'right', canvas: empty, pad: empty, tilePx: 0 })
    ).toEqual(NO_CAMERA_INSETS);
  });
});
