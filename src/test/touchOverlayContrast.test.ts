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

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Worst-case contrast of the floating controls: a translucent panel over a white scene lets the most
 * light through. The colors are read from the stylesheet tokens so the test follows the real values.
 */

const CSS = readFileSync(resolve(__dirname, '../style.css'), 'utf8');

/** WCAG minimum for normal text. */
const TEXT_MIN_RATIO = 4.5;
/** WCAG minimum for a user interface component or a graphic. */
const GRAPHIC_MIN_RATIO = 3;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function parseColor(value: string): Rgba {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`Unsupported color: ${value}`);
}

/** The color seen when `top` is painted over an opaque `under`. */
function composite(top: Rgba, under: Rgba): Rgba {
  const mix = (t: number, u: number): number => top.a * t + (1 - top.a) * u;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

function luminance(c: Rgba): number {
  const lin = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Custom properties declared by the first rule whose selector line is `head`, searched from `from`. */
function tokens(head: string, from = 0): Record<string, string> {
  const start = CSS.indexOf(head, from);
  if (start < 0) throw new Error(`Rule not found: ${head}`);
  const end = CSS.indexOf('}', start);
  const result: Record<string, string> = {};
  for (const m of CSS.slice(start, end).matchAll(/(--overlay-[\w-]+):\s*([^;]+);/g)) result[m[1]] = m[2];
  return result;
}

const DEFAULTS = tokens('body.touch-overlay {');
const OPAQUE_QUERY_AT = CSS.indexOf('@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)');
const OPAQUE = { ...DEFAULTS, ...tokens('body.touch-overlay {', OPAQUE_QUERY_AT) };

function colorOf(map: Record<string, string>, name: string): Rgba {
  const value = map[name];
  if (value === undefined) throw new Error(`Token missing: ${name}`);
  return parseColor(value);
}

describe('overlay contrast, worst case over a white scene', () => {
  it('reads the stylesheet tokens', () => {
    expect(OPAQUE_QUERY_AT).toBeGreaterThan(0);
    expect(Object.keys(DEFAULTS)).toContain('--overlay-panel-bg');
    expect(OPAQUE['--overlay-panel-bg']).not.toBe(DEFAULTS['--overlay-panel-bg']);
  });

  it('keeps HUD and button text readable on the translucent panel', () => {
    const panel = composite(colorOf(DEFAULTS, '--overlay-panel-bg'), WHITE);
    for (const name of ['--overlay-text', '--overlay-led-green', '--overlay-led-amber', '--overlay-led-danger']) {
      expect(contrast(colorOf(DEFAULTS, name), panel), name).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    }
  });

  it('keeps the chevrons readable through their outline, and on a pressed cell', () => {
    const chevron = colorOf(DEFAULTS, '--overlay-chevron');
    expect(contrast(chevron, colorOf(DEFAULTS, '--overlay-chevron-outline'))).toBeGreaterThanOrEqual(GRAPHIC_MIN_RATIO);
    const pressed = composite(colorOf(DEFAULTS, '--overlay-pad-fill-pressed'), WHITE);
    expect(contrast(chevron, pressed)).toBeGreaterThanOrEqual(GRAPHIC_MIN_RATIO);
  });

  it('keeps the panel and cell borders visible against a white scene', () => {
    for (const name of ['--overlay-panel-border', '--overlay-pad-border']) {
      const border = composite(colorOf(DEFAULTS, name), WHITE);
      expect(contrast(border, WHITE), name).toBeGreaterThanOrEqual(GRAPHIC_MIN_RATIO);
    }
  });

  it('turns opaque with reduced transparency or more contrast, with text above 4.5:1', () => {
    expect(colorOf(OPAQUE, '--overlay-panel-bg').a).toBeGreaterThanOrEqual(0.95);
    expect(colorOf(OPAQUE, '--overlay-pad-fill').a).toBeGreaterThanOrEqual(0.95);
    expect(OPAQUE['--overlay-border-width']).toBe('2px');
    const panel = composite(colorOf(OPAQUE, '--overlay-panel-bg'), WHITE);
    for (const name of ['--overlay-text', '--overlay-led-green', '--overlay-led-amber', '--overlay-led-danger']) {
      expect(contrast(colorOf(OPAQUE, name), panel), name).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    }
  });

  it('keeps borders and chevrons distinct from the opaque panel and cells', () => {
    const panel = composite(colorOf(OPAQUE, '--overlay-panel-bg'), WHITE);
    const cell = composite(colorOf(OPAQUE, '--overlay-pad-fill'), WHITE);
    expect(contrast(colorOf(OPAQUE, '--overlay-panel-border'), panel)).toBeGreaterThanOrEqual(GRAPHIC_MIN_RATIO);
    expect(contrast(colorOf(OPAQUE, '--overlay-pad-border'), cell)).toBeGreaterThanOrEqual(GRAPHIC_MIN_RATIO);
    expect(contrast(colorOf(OPAQUE, '--overlay-chevron'), cell)).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    const pressed = composite(colorOf(OPAQUE, '--overlay-pad-fill-pressed'), WHITE);
    expect(contrast(colorOf(OPAQUE, '--overlay-chevron'), pressed)).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
  });
});
