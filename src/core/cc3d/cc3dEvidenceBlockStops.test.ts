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
import { device, playTimeline, room, withMob } from './cc3dEvidenceRig';
import { cc3dModel, terrain } from './cc3dTestMaps';
import { classifyLevel, EPOXY_COVERAGE } from './epoxyCoverage';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * The CC3D dirt, ice and colour blocks stop where they are when a slide on ice meets something that refuses them
 * (stopsAtWall on dirt_block_3d, ice_block_3d and color_block_3d_<colour>). Each obstacle is played on the CC3D engine and
 * on its conversion, one press pushing the block onto the ice, and the two timelines must be the same.
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
  R: { mob: { kind: 'block_color', color: 'red' } },
  // A monster held in a trap with no control: it cannot move out of the way.
  M: withMob(device('trap'), { kind: 'bouncer', dir: 'W' }),
  // A block against the wall behind it, which the sliding block cannot push.
  D: { mob: { kind: 'block_dirt' } },
  d: device('door', { color: 'red' }),
  // The last ice cell has a thin wall on its east side.
  T: { stack: [{ kind: 'ice' }], panels: ['E'] },
  c: terrain('ice_corner', { corner: ['S', 'E'] }),
  e: terrain('ice_corner', { corner: ['N', 'W'] })
};

const OBSTACLES: Array<[string, string]> = [
  ['a wall', '@xIII#.'],
  ['a block it cannot push', '@xIIID#'],
  ['a closed door', '@xIIId.'],
  ['a thin wall', '@xIIT..'],
  ['an ice corner closed on its east side', '@xIIIc.'],
  ['an ice corner open on its east side', '@xIIIe.']
];

const MONSTER_KINDS = [
  'walker', 'limpa', 'limpy', 'bouncer', 'golem_blue', 'golem_yellow', 'blinky', 'baby_blinky', 'screamer', 'baby_screamer',
  'snappy', 'nibble', 'legs_green', 'legs_red', 'omni'
] as const;

describe('a CC3D block that slides into a monster', () => {
  for (const [blockName, glyph] of BLOCKS) {
    for (const floor of ['III', '>>>']) {
      for (const kind of MONSTER_KINDS) {
        // The ice block is refused by the screamers in both engines for another reason: they melt it (their own key).
        if (glyph === 'Z' && (kind === 'screamer' || kind === 'baby_screamer')) continue;
        it(`${blockName} on ${floor} crushes a ${kind}, as in CC3D`, () => {
          const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, M: withMob(device('trap'), { kind, dir: 'W' }) };
          const t = playTimeline({ rows: room(`@${glyph}${floor}M.`), moves: '', glyphs }, 'E');
          expect(t.sameSequence, `${blockName} on ${floor} into ${kind}`).toBe(true);
          expect(t.sameFinal).toBe(true);
        });
      }
    }
  }

  it('a block pushed straight into a monster is refused by both engines', () => {
    for (const [blockName, glyph] of BLOCKS) {
      const t = playTimeline({ rows: room(`@${glyph}M..`), moves: '', glyphs: GLYPHS }, 'E');
      expect(t.sameSequence, blockName).toBe(true);
      expect(t.sameFinal, blockName).toBe(true);
    }
  });

  it('a chain pushed by a slide, or by the ice block, into a monster plays the same in both engines', () => {
    const rows = ['@KDIIM.', '@ZKIIM.', '@ZDIIM.', '@KDDIM.', '@RDIIM.', '@KKIIM.', '@ZKKIM.', '@K>D>M.', '@KI>>DM.'];
    for (const row of rows) {
      for (const kind of ['bouncer', 'walker'] as const) {
        const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, D: { mob: { kind: 'block_dirt' } }, M: withMob(device('trap'), { kind, dir: 'W' }) };
        const t = playTimeline({ rows: room(row), moves: '', glyphs }, 'E');
        expect(t.sameSequence, `${row} ${kind}`).toBe(true);
        expect(t.sameFinal, `${row} ${kind}`).toBe(true);
      }
    }
  });

  it('a free walking monster that steps toward a sliding block: the dirt and colour blocks are off the CC3D timeline exactly as the ice block is', () => {
    // The walking monsters keep their own step phase in Epoxy (their coverage keys), so a free monster never matches the
    // CC3D timeline, ice block included. What the crush rule must not add is a difference of its own: the verdicts are the same.
    const verdict = (glyph: string, row: string, kind: 'bouncer' | 'walker' | 'limpa'): [boolean, boolean] => {
      const glyphs: Record<string, GlyphMeaning> = { ...GLYPHS, b: { mob: { kind, dir: 'W' } } };
      const t = playTimeline({ rows: room(row.replace('x', glyph)), moves: '', glyphs }, 'E');
      return [t.sameSequence, t.sameFinal];
    };
    for (const floor of ['III', '>>>']) {
      for (const row of [`@x${floor}b.`, `@x${floor}.b`, `@x${floor}.b.`]) {
        for (const kind of ['bouncer', 'walker', 'limpa'] as const) {
          const ice = verdict('Z', row, kind);
          // The timeline is the same kind of difference for all three blocks; the last state differs only because the ice
          // block is not crushed in either engine while the others are, so the last state is compared between dirt and colour.
          expect(verdict('K', row, kind)[0], `dirt ${row} ${kind}`).toBe(ice[0]);
          expect(verdict('R', row, kind), `colour ${row} ${kind}`).toEqual(verdict('K', row, kind));
        }
      }
    }
  });

  it('the coverage no longer names the case', () => {
    expect(EPOXY_COVERAGE).not.toHaveProperty('block_slides_into_monster');
    const level = cc3dModel(room('@KIIIb.'), { b: { mob: { kind: 'bouncer', dir: 'W' } } });
    expect(classifyLevel(level).approx).not.toContain('block_slides_into_monster');
  });
});

describe('a CC3D block sliding on ice stops against what refuses it, as in CC3D', () => {
  for (const [blockName, glyph] of BLOCKS) {
    for (const [obstacleName, pattern] of OBSTACLES) {
      it(`${blockName} against ${obstacleName}`, () => {
        const rows = room(pattern.replace('x', glyph));
        const t = playTimeline({ rows, moves: '', glyphs: GLYPHS }, 'E');
        expect(t.sameSequence, `${blockName} ${obstacleName}`).toBe(true);
        expect(t.sameFinal).toBe(true);
      });
    }
  }
});
