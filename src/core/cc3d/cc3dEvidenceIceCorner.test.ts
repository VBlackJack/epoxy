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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playTimeline, room } from './cc3dEvidenceRig';
import { terrain } from './cc3dTestMaps';
import { EPOXY_COVERAGE } from './epoxyCoverage';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * A slider that finds the exit of a CC3D ice corner blocked is sent straight back opposite to the exit, without the
 * corner deflecting that bounce. The bounce crosses a closed side of the corner, so the slider stops on the corner
 * (ice_corner_3d_<sides>); the native corner turns the bounce and sends the slider back the way it came. Each case is
 * played on the CC3D engine and on its conversion, and the two timelines must be the same.
 */

beforeEach(() => {
  loadTestConfigs();
});

const GLYPHS: Record<string, GlyphMeaning> = {
  // Closed on its south and east sides: a slide going east enters through the west side and leaves north.
  c: terrain('ice_corner', { corner: ['S', 'E'] }),
  // Closed on its north and west sides: a slide going west enters through the east side and leaves south.
  n: terrain('ice_corner', { corner: ['N', 'W'] }),
  Z: { mob: { kind: 'block_ice' } },
  K: { mob: { kind: 'block_dirt' } },
  R: { mob: { kind: 'block_color', color: 'red' } }
};

const SLIDERS: Array<[string, string]> = [
  ['the player', '@'],
  ['an ice block', 'Z'],
  ['a dirt block', 'K'],
  ['a colour block', 'R']
];

describe('CC3D ice corner with a blocked exit', () => {
  for (const [name, glyph] of SLIDERS) {
    it(`${name} stops on the corner when the exit is a wall`, () => {
      // The row is the top row of the room, so the corner's north exit is the wall.
      const rows = glyph === '@' ? room('@IIc.') : room(`@${glyph}IIc.`);
      const t = playTimeline({ rows, moves: '', glyphs: GLYPHS }, 'E');
      expect(t.sameSequence, name).toBe(true);
      expect(t.sameFinal, name).toBe(true);
    });

    it(`${name} goes on through the corner when the exit is free`, () => {
      const rows = glyph === '@' ? room('.....', '@IIc.') : room('.....', `@${glyph}IIc.`);
      const t = playTimeline({ rows, moves: '', glyphs: GLYPHS }, 'E');
      expect(t.sameSequence, name).toBe(true);
      expect(t.sameFinal, name).toBe(true);
    });
  }

  it('the player stops on the corner when a block stands at the exit', () => {
    const rows = room('..K..', '@IIc.');
    const t = playTimeline({ rows, moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameSequence).toBe(true);
    expect(t.sameFinal).toBe(true);
  });

  it('the player entering the other way stops on the corner too', () => {
    const rows = room('@IIn.', '....#');
    const t = playTimeline({ rows, moves: '', glyphs: GLYPHS }, 'E');
    expect(t.sameSequence).toBe(true);
    expect(t.sameFinal).toBe(true);
  });

  it('a monster that slides into the corner with a blocked or a free exit is played as CC3D plays it', () => {
    // The other walking monsters keep their own step phase in Epoxy (their coverage keys), so only the monsters
    // whose timeline is exact are compared here.
    for (const kind of ['bouncer', 'golem_blue', 'nibble'] as const) {
      const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, b: { mob: { kind, dir: 'E' } } };
      const blocked = playTimeline({ rows: room('@####', 'bIIc.'), moves: '', glyphs }, '');
      expect(blocked.sameSequence, `${kind} blocked`).toBe(true);
      expect(blocked.sameFinal, `${kind} blocked`).toBe(true);
    }
    for (const kind of ['golem_blue', 'nibble'] as const) {
      const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, b: { mob: { kind, dir: 'E' } } };
      const free = playTimeline({ rows: room('@....', 'bIIc.'), moves: '', glyphs }, '');
      expect(free.sameSequence, `${kind} free`).toBe(true);
      expect(free.sameFinal, `${kind} free`).toBe(true);
    }
  });

  it('the coverage keeps the ice corner exact', () => {
    expect(EPOXY_COVERAGE.ice_corner.level).toBe('exact');
  });

  it('defines the four corners as the native ones with the CC3D bounce, and leaves the native corners alone', () => {
    for (const sides of ['nw', 'ne', 'sw', 'se']) {
      const native = ConfigRegistry.getTile(`ice_${sides}`);
      const cc3d = ConfigRegistry.getTile(`ice_corner_3d_${sides}`);
      expect(native.cc3dCornerBounce).toBeUndefined();
      expect(cc3d.cc3dCornerBounce).toBe(true);
      expect(cc3d.deflectionMap).toEqual(native.deflectionMap);
      expect(cc3d.blockedEntryDirections).toEqual(native.blockedEntryDirections);
      expect(cc3d.slideType).toBe(native.slideType);
    }
  });
});
