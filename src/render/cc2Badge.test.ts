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

import { describe, expect, it, vi } from 'vitest';
import { drawsMark, isImportedLevel, paintCc2Mark } from './cc2Variants';
import type { MarkColours } from './cc2Marks';
import type { Cc2Mark } from './cc2Variants';

const LOOK_ALIKES: readonly Cc2Mark[] = ['cc2', '3d', 'off', 'random', 'barrier', 'helmet'];
const COLOURS: MarkColours = { fill: '#888', edge: '#222', ink: '#eee' };

function fakeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '',
    textBaseline: ''
  };
}

describe('isImportedLevel', () => {
  it('is true for a CC2 record, CC3D data or a kept CC3D source, false for a native level', () => {
    expect(isImportedLevel({ cc2: {} })).toBe(true);
    expect(isImportedLevel({ cc3d: {} })).toBe(true);
    expect(isImportedLevel({ cc3dSource: {} })).toBe(true);
    expect(isImportedLevel({})).toBe(false);
  });

  it('leaves the look-alike marks out for a converted CC3D level', () => {
    const importedLevel = isImportedLevel({ cc3dSource: {} });
    for (const mark of LOOK_ALIKES) expect(drawsMark(mark, { isEditor: false, importedLevel }), mark).toBe(false);
  });
});

describe('drawsMark', () => {
  it('leaves the look-alike marks out in play on an imported level', () => {
    for (const mark of LOOK_ALIKES) expect(drawsMark(mark, { isEditor: false, importedLevel: true }), mark).toBe(false);
  });

  it('keeps the look-alike marks in the editor, imported level or not', () => {
    for (const mark of LOOK_ALIKES) {
      expect(drawsMark(mark, { isEditor: true, importedLevel: true }), mark).toBe(true);
      expect(drawsMark(mark, { isEditor: true, importedLevel: false }), mark).toBe(true);
    }
  });

  it('keeps the look-alike marks in play on a native level', () => {
    for (const mark of LOOK_ALIKES) expect(drawsMark(mark, { isEditor: false, importedLevel: false }), mark).toBe(true);
  });

  it('always draws the real signs and the no-sign', () => {
    for (const mark of ['sign_chip', 'sign_melinda', 'no_sign'] as const) {
      expect(drawsMark(mark, { isEditor: false, importedLevel: true }), mark).toBe(true);
    }
  });
});

describe('look-alike corner badge', () => {
  it('stays in the lower right quarter of the tile, a small plate and not the centred sign', () => {
    for (const mark of LOOK_ALIKES) {
      const ctx = fakeContext();
      paintCc2Mark(ctx as unknown as CanvasRenderingContext2D, mark, 100, 200, 64, COLOURS);
      expect(ctx.roundRect, mark).toHaveBeenCalledTimes(1);
      const [px, py, width, height] = ctx.roundRect.mock.calls[0] as number[];
      expect(px, mark).toBeGreaterThanOrEqual(100 + 32);
      expect(py, mark).toBeGreaterThanOrEqual(200 + 32);
      expect(px + width, mark).toBeLessThanOrEqual(100 + 64);
      expect(py + height, mark).toBeLessThanOrEqual(200 + 64);
      expect(width, mark).toBeLessThanOrEqual(64 / 2);
      expect(ctx.fillText, mark).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the big centred plate for the real signs', () => {
    const ctx = fakeContext();
    paintCc2Mark(ctx as unknown as CanvasRenderingContext2D, 'sign_chip', 0, 0, 64, COLOURS);
    const [px, , width] = ctx.roundRect.mock.calls[0] as number[];
    expect(px + width / 2).toBeCloseTo(32);
    expect(width).toBeGreaterThan(64 / 2);
  });
});
