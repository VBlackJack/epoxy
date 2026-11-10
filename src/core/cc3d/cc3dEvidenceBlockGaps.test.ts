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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playTimeline, room } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * Two points of the CC3D blocks (dirt_block_3d, ice_block_3d, color_block_3d_<colour>), played on the CC3D engine and on
 * its conversion: a block that a force floor carries into the player stops in front of him instead of crushing him, and
 * a block that arrives on slime is used up with the slime. The slide on ice against the player is played on the Epoxy
 * engine alone (cc3dBlockStopsAtPlayer.test.ts), as no CC3D map sends a block back along its own ice lane.
 */

beforeEach(() => {
  loadTestConfigs();
});

const BLOCKS: Array<[string, string]> = [
  ['dirt block', 'K'],
  ['ice block', 'Z'],
  ['colour block', 'R']
];

const GLYPHS: Record<string, GlyphMeaning> = {
  R: { mob: { kind: 'block_color', color: 'red' } }
};

/** The row of each case (x is the block) and the presses played, one per 16 ticks. */
const FORCE_CASES: Array<[string, string, string]> = [
  ['the player stands as the block is pushed onto the force floor', '@x<<.', 'E'],
  ['the player stands next to a single force cell', '@x<.', 'E'],
  ['the player steps into the lane first', '@.x<.', 'EE'],
  ['the player walks back out of the lane', '@.x<<.', 'EEW'],
  ['the player is carried back by the force floor', '@.x<<.', 'EEE']
];

describe('a CC3D block that a force floor carries into the player stops in front of him, as in CC3D', () => {
  for (const [blockName, glyph] of BLOCKS) {
    for (const [caseName, pattern, presses] of FORCE_CASES) {
      it(`${blockName}: ${caseName}`, () => {
        const t = playTimeline({ rows: room(pattern.replace('x', glyph)), moves: '', glyphs: GLYPHS }, presses);
        expect(t.sameSequence, `${blockName} ${pattern} ${presses}`).toBe(true);
        expect(t.sameFinal, `${blockName} ${pattern} ${presses}`).toBe(true);
        expect(t.epoxy.final).not.toMatch(/P\d+,\d+x/);
      });
    }
  }
});

describe('a CC3D block that arrives on slime is used up with it, as in CC3D', () => {
  const LANES = [
    ['a force floor', '@x>>L.'],
    ['ice', '@xIIL.'],
    ['ice after a random force floor', '@xII?IIL.'],
    ['a chain pushed by the ice block', '@ZxL.']
  ];
  for (const [blockName, glyph] of BLOCKS) {
    for (const [laneName, pattern] of LANES) {
      it(`${blockName} over ${laneName}`, () => {
        const t = playTimeline({ rows: room(pattern.replace('x', glyph)), moves: '', glyphs: GLYPHS }, 'E');
        // CC3D shows the block on the slime for one tick before it is used up and Epoxy does not, so the last state and
        // the terrain it ends on are what is compared.
        expect(t.sameFinal, `${blockName} ${pattern}`).toBe(true);
        expect(t.cc3d.terrain.at(-1), pattern).not.toContain('slime');
        expect(t.epoxy.terrain.at(-1), pattern).not.toContain('slime');
      });
    }
  }
});
