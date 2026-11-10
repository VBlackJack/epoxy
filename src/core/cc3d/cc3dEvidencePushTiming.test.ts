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
import { device, playSettled, playTimeline, room, stack, withMob } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * The timing of a block the player pushes, played on the CC3D engine and on its conversion. In CC3D the block takes its
 * four ticks to reach the next cell while the player follows it in at once: the cell the block leaves acts on it when
 * the step starts and the player enters it whatever it has become, the cell the block reaches acts on it when the step
 * ends, and a block still in motion cannot be pushed again.
 */

beforeEach(() => {
  loadTestConfigs();
});

const BLOCKS: Array<[string, 'block_dirt' | 'block_ice']> = [
  ['dirt block', 'block_dirt'],
  ['ice block', 'block_ice']
];

function glyphsOf(kind: 'block_dirt' | 'block_ice'): Record<string, GlyphMeaning> {
  return {
    // A block standing on an open toggle door, on a recessed wall, and on plain floor.
    B: withMob(stack({ kind: 'floor' }, { kind: 'toggle_door', color: 'green', open: true }), { kind }),
    R: withMob(stack({ kind: 'floor' }, { kind: 'push_up_wall' }), { kind }),
    K: { mob: { kind } },
    c: device('toggle_control', { color: 'green' })
  };
}

describe('a pushed block acts on its cells as CC3D does, in the order CC3D does', () => {
  for (const [name, kind] of BLOCKS) {
    it(`${name}: onto a toggle control, the player enters the door cell before the door closes`, () => {
      const t = playTimeline({ rows: room('@', 'B', 'c'), moves: '', glyphs: glyphsOf(kind) }, 'S');
      expect(t.sameSequence).toBe(true);
      expect(t.sameFinal).toBe(true);
      // The player followed the block into the cell the door then closed on.
      expect(t.pair.epoxy.getPlayer().y).toBe(2);
      expect(t.pair.rig.player.y).toBe(2);
    });

    it(`${name}: off a recessed wall, the player enters the cell before the wall rises`, () => {
      const t = playTimeline({ rows: room('@', 'R', '.'), moves: '', glyphs: glyphsOf(kind) }, 'S');
      expect(t.sameSequence).toBe(true);
      expect(t.sameFinal).toBe(true);
      expect(t.pair.epoxy.getPlayer().y).toBe(2);
      expect(t.pair.rig.player.y).toBe(2);
    });

    it(`${name}: the same state after the press, tick for tick over the four ticks`, () => {
      const t = playSettled({ rows: room('@', 'B', 'c'), moves: '', glyphs: glyphsOf(kind) }, 'S', 4);
      expect(t.same).toBe(true);
    });
  }

  for (const [name, kind] of BLOCKS) {
    it(`${name}: a block still in motion is not pushed again by a player sliding on, as in CC3D`, () => {
      // The block stands on ice; the player slides from the ice below into its cell and meets it one step on.
      const glyphs = { ...glyphsOf(kind), Y: withMob(stack({ kind: 'ice' }), { kind }) };
      const t = playTimeline({ rows: room('.', '.', '.', '.', 'Y', 'I', '@'), moves: '', glyphs }, 'N');
      expect(t.sameSequence).toBe(true);
      expect(t.sameFinal).toBe(true);
    });
  }
});
