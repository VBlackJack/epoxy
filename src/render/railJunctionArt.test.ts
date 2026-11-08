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

/**
 * Track cell drawing: every segment a cell holds is drawn, a cell with a switch draws its active segment in full and the
 * others faded, and a cell without a switch draws all of them in full.
 */

import { describe, expect, it } from 'vitest';
import { RAIL_TRACK_COUNT } from '../core/coreConstants';
import { createRecordedContext } from '../test/runewardTestContext';
import { JUNCTION_NO_SWITCH, JUNCTION_SAMPLE_MASK, RAIL_OTHER_FORM_ALPHA, paintRailJunction, type RailColours } from './railArt';

const TILE = 48;
const COLOURS: RailColours = { outline: '#000001', sleeper: '#000002', rail: '#000003', buffer: '#000004' };

function paint(mask: number, active: number = JUNCTION_NO_SWITCH): string[] {
  const { ctx, lines } = createRecordedContext();
  paintRailJunction(ctx, 0, 0, TILE, mask, active, COLOURS);
  return lines;
}

function alphaLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith('globalAlpha = '));
}

describe('track cell art', () => {
  it('gives each single segment its own drawing', () => {
    const drawings = new Set<string>();
    for (let track = 0; track < RAIL_TRACK_COUNT; track++) drawings.add(paint(1 << track).join('\n'));
    expect(drawings.size).toBe(RAIL_TRACK_COUNT);
  });

  it('draws more when the cell holds more segments, all in full without a switch', () => {
    expect(paint(0b110011).length).toBeGreaterThan(paint(0b000001).length);
    expect(alphaLines(paint(0b110011))).toEqual([]);
    expect(paint(JUNCTION_SAMPLE_MASK).length).toBeGreaterThan(paint(1).length);
  });

  it('draws the segments a switch is not on faded, and the active one in full', () => {
    const switched = paint(0b110000, 5);
    expect(alphaLines(switched)).toEqual([`globalAlpha = ${RAIL_OTHER_FORM_ALPHA}`, 'globalAlpha = 1']);
    // Which segment is active changes the picture.
    expect(paint(0b110000, 5).join('\n')).not.toBe(paint(0b110000, 4).join('\n'));
  });

  it('draws nothing faded when the switch is on the only segment, and draws the active one even if the cell lacks it', () => {
    expect(alphaLines(paint(0b100000, 5))).toEqual([]);
    expect(paint(0, 4).length).toBeGreaterThan(paint(0).length);
  });
});
