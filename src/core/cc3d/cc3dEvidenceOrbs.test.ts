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
import { expectAgree, expectDisagree } from './cc3dEvidenceAsserts';
import { classifyLevel, EPOXY_COVERAGE } from './epoxyCoverage';
import { room } from './cc3dEvidenceRig';
import { cc3dModel } from './cc3dTestMaps';

/**
 * Coverage evidence for the four orbs (ice, force, fire, water), which Epoxy plays as boots. Each case plays a
 * tiny CC3D map on the CC3D engine and on its conversion and compares the two after every move (see
 * cc3dEvidenceRig).
 */

beforeEach(() => {
  loadTestConfigs();
});

/** The orbs a CC3D player may hold at once; a fifth tool drops the oldest on the cell. */
const TOOL_LIMIT = 4;
/** Orb glyphs of the test maps, and the item each leaves on the ground when it is dropped. */
const ORB_ITEM: Record<string, string> = { a: 'boots_ice', o: 'boots_force', f: 'boots_fire', w: 'boots_water' };
/** The speed orb is the glyph that fills the fifth place: it is held like the others. */
const FIFTH_TOOL = 's';

describe('ice orb', () => {
  it('stops the player sliding on ice, which carries him to the first cell past it without it', () => {
    expectAgree({ rows: room('@III..'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(5);
    });
    expectAgree({ rows: room('@aIII..'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
      expect(pair.rig.terrainAt(3, 1)).toBe('ice');
    });
  });
});

describe('force orb', () => {
  it('stops a force floor carrying the player, which pushes him to the first cell past it without it', () => {
    expectAgree({ rows: room('@>>>..'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(5);
    });
    expectAgree({ rows: room('@o>>>..'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
  });
});

describe('fire orb', () => {
  it('lets the player cross fire, which kills him without it', () => {
    expectAgree({ rows: room('@fF.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.player.x).toBe(4);
    });
    expectAgree({ rows: room('@F.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('does not protect from water', () => {
    expectAgree({ rows: room('@fW.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });
});

describe('water orb', () => {
  it('lets the player cross water, which kills him without it', () => {
    expectAgree({ rows: room('@wW.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.player.x).toBe(4);
    });
    expectAgree({ rows: room('@W.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('does not protect from fire', () => {
    expectAgree({ rows: room('@wF.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });
});

describe('the four orbs together', () => {
  it('are all kept, and each still works', () => {
    expectAgree({ rows: room('@afwo.'), moves: 'EEEEE' }, (pair) => {
      expect(pair.rig.player.boots.size).toBe(TOOL_LIMIT);
    });
  });

  it('differ when a fifth tool is picked up: CC3D drops the oldest on the cell, Epoxy keeps every pair of boots', () => {
    const orders = ['afwo', 'fwoa', 'woaf', 'oafw'];
    for (const order of orders) {
      expectDisagree({ rows: room(`@${order}${FIFTH_TOOL}.`), moves: 'EEEEE' }, 'items', (pair) => {
        expect(pair.rig.engine.getItems()[1][2 + TOOL_LIMIT]).toBe(ORB_ITEM[order[0]]);
      });
    }
  });

  it('clean slime when the fire and the water orb are held together, as the Epoxy slime_3d does', () => {
    expectAgree({ rows: room('@fwL.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.terrainAt(4, 1)).toBe('floor');
    });
  });
});

describe('coverage verdicts that rest on this evidence', () => {
  it('plays the orbs exactly up to the cap, each reason citing this file', () => {
    for (const key of ['orb_ice', 'orb_force', 'orb_fire', 'orb_water']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceOrbs.test.ts');
    }
  });

  it('puts the cap boundary where the engines part: four orb items agree above, a fifth is orbs_over_cap', () => {
    // 'afwo' agrees move by move (see above), and the map is exact.
    expect(classifyLevel(cc3dModel(room('@afwo.')))).toEqual({ verdict: 'exact', lost: [], approx: [] });
    // Three orbs and the speed orb are four items: no fifth tool can be picked up, and only the speed orb itself is approximate.
    expect(classifyLevel(cc3dModel(room('@afws.'))).approx).toEqual(['orb_speed']);
    // A fifth item is the disagreement pinned above, in every order.
    for (const order of ['afwo', 'fwoa', 'woaf', 'oafw']) {
      const result = classifyLevel(cc3dModel(room(`@${order}${FIFTH_TOOL}.`)));
      expect(result.approx, order).toContain('orbs_over_cap');
    }
    expect(classifyLevel(cc3dModel(room('@afwoa.'))).approx).toEqual(['orbs_over_cap']);
    expect(EPOXY_COVERAGE.orbs_over_cap.level).toBe('approx');
    expect(EPOXY_COVERAGE.orbs_over_cap.reason).toContain('cc3dEvidenceOrbs.test.ts');
  });
});
