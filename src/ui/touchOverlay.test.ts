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
  DEFAULT_TOUCH_CONTROL,
  DRAWER_STRIP_SELECTORS,
  MAX_CAMERA_INSET,
  OVERLAY_STRIP_SELECTORS,
  NO_CAMERA_INSETS,
  TOUCH_OVERLAY_MAX_SHORT_SIDE_PX,
  computeCameraInsets,
  getOverlayStripSelectors,
  parseDpadSide,
  parseHapticsEnabled,
  parseTouchControl,
  resolveTouchLayoutModes,
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
    expect(computeCameraInsets({ active: false, landscape: true, side: 'right', canvas, rects: [pad], tilePx: 40 })).toEqual(
      NO_CAMERA_INSETS
    );
  });

  it('insets the right side by the pad width plus half a tile in landscape', () => {
    const pad = { left: 620, right: 788, top: 220, bottom: 388 };
    const insets = computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, rects: [pad], tilePx: 40 });
    expect(insets).toEqual({ left: 0, right: (800 - 620 + 20) / 800, top: 0, bottom: 0 });
  });

  it('insets the left side when the pad is on the left', () => {
    const pad = { left: 12, right: 180, top: 220, bottom: 388 };
    const insets = computeCameraInsets({ active: true, landscape: true, side: 'left', canvas, rects: [pad], tilePx: 40 });
    expect(insets).toEqual({ left: (180 + 20) / 800, right: 0, top: 0, bottom: 0 });
  });

  it('insets the bottom in portrait whichever side the pad is on', () => {
    const portraitCanvas = { left: 0, right: 400, top: 0, bottom: 800 };
    const pad = { left: 220, right: 388, top: 620, bottom: 788 };
    for (const side of ['left', 'right'] as const) {
      const insets = computeCameraInsets({ active: true, landscape: false, side, canvas: portraitCanvas, rects: [pad], tilePx: 40 });
      expect(insets).toEqual({ left: 0, right: 0, top: 0, bottom: (800 - 620 + 20) / 800 });
    }
  });

  it('never goes beyond the renderer limit and ignores unusable boxes', () => {
    const huge = { left: 0, right: 800, top: 0, bottom: 400 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, rects: [huge], tilePx: 40 }).right
    ).toBe(MAX_CAMERA_INSET);
    const empty = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'right', canvas: empty, rects: [empty], tilePx: 0 })
    ).toEqual(NO_CAMERA_INSETS);
  });

  it('uses the extreme extent of the pad, the button cluster and the HUD, ignoring empty boxes', () => {
    const pad = { left: 620, right: 788, top: 220, bottom: 388 };
    const controls = { left: 640, right: 788, top: 170, bottom: 214 };
    const hud = { left: 630, right: 788, top: 12, bottom: 70 };
    const hidden = { left: 0, right: 0, top: 0, bottom: 0 };
    const right = computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, rects: [pad, controls, hud, hidden], tilePx: 40 });
    expect(right.right).toBe((800 - 620 + 20) / 800);
    const wide = { ...hud, left: 600 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, rects: [pad, controls, wide], tilePx: 40 }).right
    ).toBe((800 - 600 + 20) / 800);
    const leftPad = { left: 12, right: 180, top: 220, bottom: 388 };
    const leftHud = { left: 12, right: 200, top: 12, bottom: 70 };
    expect(
      computeCameraInsets({ active: true, landscape: true, side: 'left', canvas, rects: [leftPad, leftHud], tilePx: 40 }).left
    ).toBe((200 + 20) / 800);
  });

  it('reaches up to the highest box in portrait, and equals the pad alone when the strip fits in the pad height', () => {
    const portraitCanvas = { left: 0, right: 400, top: 0, bottom: 800 };
    const pad = { left: 220, right: 388, top: 620, bottom: 788 };
    const hud = { left: 12, right: 150, top: 640, bottom: 730 };
    const controls = { left: 12, right: 150, top: 744, bottom: 788 };
    const alone = computeCameraInsets({ active: true, landscape: false, side: 'right', canvas: portraitCanvas, rects: [pad], tilePx: 40 });
    const strip = computeCameraInsets({ active: true, landscape: false, side: 'right', canvas: portraitCanvas, rects: [pad, controls, hud], tilePx: 40 });
    expect(strip).toEqual(alone);
    const tall = { ...hud, top: 560 };
    expect(
      computeCameraInsets({ active: true, landscape: false, side: 'right', canvas: portraitCanvas, rects: [pad, controls, tall], tilePx: 40 }).bottom
    ).toBe((800 - 560 + 20) / 800);
  });

  it('is zero when every box is empty', () => {
    const empty = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(computeCameraInsets({ active: true, landscape: true, side: 'right', canvas, rects: [empty], tilePx: 40 })).toEqual(NO_CAMERA_INSETS);
  });
});

describe('parseTouchControl and parseHapticsEnabled', () => {
  it('keeps a valid control and falls back to floating for anything else', () => {
    expect(parseTouchControl('fixed')).toBe('fixed');
    expect(parseTouchControl('floating')).toBe('floating');
    for (const bad of [undefined, null, 'pad', 3, {}]) expect(parseTouchControl(bad)).toBe(DEFAULT_TOUCH_CONTROL);
    expect(DEFAULT_TOUCH_CONTROL).toBe('floating');
  });

  it('keeps haptics on unless the stored value is exactly false', () => {
    expect(parseHapticsEnabled(false)).toBe(false);
    for (const other of [undefined, null, true, 0, 'false']) expect(parseHapticsEnabled(other)).toBe(true);
  });
});

describe('resolveTouchLayoutModes', () => {
  it('turns the drawers and the joystick on together for the floating control on a phone', () => {
    expect(resolveTouchLayoutModes(true, 'floating')).toEqual({ drawers: true, floating: true });
  });

  it('turns both off for the fixed pad and when the overlay is off', () => {
    expect(resolveTouchLayoutModes(true, 'fixed')).toEqual({ drawers: false, floating: false });
    expect(resolveTouchLayoutModes(false, 'floating')).toEqual({ drawers: false, floating: false });
  });
});

describe('getOverlayStripSelectors', () => {
  it('keeps the pad, cluster and HUD selectors when the drawers are off', () => {
    expect(getOverlayStripSelectors(false)).toBe(OVERLAY_STRIP_SELECTORS);
  });

  it('reads the top strip and the bottom cluster when the drawers are on, and never a drawer or the HUD', () => {
    expect(getOverlayStripSelectors(true)).toEqual(['#touch-strip', '#touch-overlay-controls']);
    expect(getOverlayStripSelectors(true)).toBe(DRAWER_STRIP_SELECTORS);
    expect(DRAWER_STRIP_SELECTORS).not.toContain('.hud-panel');
    expect(DRAWER_STRIP_SELECTORS.join(' ')).not.toContain('drawer');
  });
});

describe('computeCameraInsets top mode', () => {
  const canvas = { left: 0, right: 400, top: 0, bottom: 800 };
  const strip = { left: 0, right: 400, top: 4, bottom: 48 };
  const cluster = { left: 12, right: 150, top: 700, bottom: 788 };

  it('reserves the strip height plus half a tile at the top', () => {
    const insets = computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [], topRects: [strip], tilePx: 40 });
    expect(insets).toEqual({ left: 0, right: 0, top: (48 + 20) / 800, bottom: 0 });
  });

  it('adds the bottom cluster inset in portrait and the side inset in landscape', () => {
    const portrait = computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [cluster], topRects: [strip], tilePx: 40 });
    expect(portrait.top).toBe((48 + 20) / 800);
    expect(portrait.bottom).toBe((800 - 700 + 20) / 800);
    const landscape = computeCameraInsets({ active: true, landscape: true, side: 'left', canvas, rects: [cluster], topRects: [strip], tilePx: 40 });
    expect(landscape.top).toBe((48 + 20) / 800);
    expect(landscape.left).toBe((150 + 20) / 400);
    expect(landscape.right).toBe(0);
  });

  it('reads the lowest bottom edge, ignores empty boxes and caps at the renderer limit', () => {
    const empty = { left: 0, right: 0, top: 0, bottom: 0 };
    const low = { ...strip, bottom: 60 };
    expect(computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [], topRects: [strip, low, empty], tilePx: 0 }).top).toBe(60 / 800);
    const huge = { ...strip, bottom: 2000 };
    expect(computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [], topRects: [huge], tilePx: 0 }).top).toBe(MAX_CAMERA_INSET);
  });

  it('is zero outside the overlay layout or when the strip is empty', () => {
    expect(computeCameraInsets({ active: false, landscape: false, side: 'right', canvas, rects: [], topRects: [strip], tilePx: 40 })).toEqual(NO_CAMERA_INSETS);
    expect(computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [], topRects: [{ left: 0, right: 0, top: 0, bottom: 0 }], tilePx: 40 })).toEqual(NO_CAMERA_INSETS);
  });

  it('leaves the classic result untouched when no top boxes are given', () => {
    const pad = { left: 220, right: 388, top: 620, bottom: 788 };
    const classic = computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [pad], tilePx: 40 });
    expect(classic).toEqual({ left: 0, right: 0, top: 0, bottom: (800 - 620 + 20) / 800 });
    expect(computeCameraInsets({ active: true, landscape: false, side: 'right', canvas, rects: [pad], topRects: [], tilePx: 40 })).toEqual(classic);
  });
});
