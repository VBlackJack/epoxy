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
import { EPOXY_COVERAGE } from './epoxyCoverage';
import { holdDoor, plate, room } from './cc3dEvidenceRig';
import type { EvidenceScenario } from './cc3dEvidenceRig';
import type { GlyphMeaning } from './cc3dTestMaps';
import { CC3D_COLORS } from './model';
import type { Cc3dColor } from './model';

/**
 * Coverage evidence for the three kinds of block: the colour blocks (one set of cases per colour), the dirt block
 * and the ice block. Each case plays a tiny CC3D map on the CC3D engine and on its conversion and compares the two
 * after every move, blocks included (see cc3dEvidenceRig).
 */

beforeEach(() => {
  loadTestConfigs();
});

/** The glyph of a colour block of each colour: the blue one is the base glyph of the test maps. */
const COLOR_BLOCK_GLYPH: Record<Cc3dColor, string> = { red: 'R', blue: 'C', yellow: 'Y', green: 'U' };
/** Plate and hold door glyphs, one pair per colour. */
const PLATE_GLYPH: Record<Cc3dColor, string> = { red: '=', blue: '+', yellow: '~', green: '$' };
const DOOR_GLYPH: Record<Cc3dColor, string> = { red: 'd', blue: 'b', yellow: 'c', green: 'h' };
const GLYPHS: Record<string, GlyphMeaning> = {
  R: { mob: { kind: 'block_color', color: 'red' } },
  Y: { mob: { kind: 'block_color', color: 'yellow' } },
  U: { mob: { kind: 'block_color', color: 'green' } },
  ...Object.fromEntries(CC3D_COLORS.flatMap((color) => [[PLATE_GLYPH[color], plate(color)], [DOOR_GLYPH[color], holdDoor(color)]]))
};
const FLOOR = 'floor';
const DOOR_OPEN = (color: Cc3dColor): string => `cc3d_hold_door_${color}_open`;
const DOOR_CLOSED = (color: Cc3dColor): string => `cc3d_hold_door_${color}_closed`;

function scenario(row: string, moves: string): EvidenceScenario {
  return { rows: room(row), moves, glyphs: GLYPHS };
}

/** The cases every kind of block shares; `glyph` is the block. */
function sharedCases(label: string, glyph: string): void {
  it(`${label}: is spent with the slime it is pushed into, and with the bomb`, () => {
    for (const hazard of ['L', 'O']) {
      expectAgree(scenario(`@${glyph}${hazard}.`, 'EEE'), (pair) => {
        expect(pair.rig.entities).toHaveLength(0);
        expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
        expect(pair.rig.player.x).toBe(4);
      });
    }
  });

  it(`${label}: is refused by the exit and by a block behind it`, () => {
    expectAgree(scenario(`@${glyph}X.`, 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
    // The ice block pushes a chain in CC3D: its own cases name that difference.
    if (glyph === 'Z') return;
    expectAgree(scenario(`@${glyph}K.`, 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(1);
      expect(pair.rig.entities).toHaveLength(2);
    });
  });

  it(`${label}: enters gravel and sand`, () => {
    for (const ground of ['G', 'A']) {
      expectAgree(scenario(`@${glyph}${ground}.`, 'EE'), (pair) => {
        expect(pair.rig.player.x).toBe(3);
        expect(pair.rig.entities.map((e) => e.x)).toEqual([4]);
      });
    }
  });

  it(`${label}: is carried one cell on by a force floor or by ice, and no further`, () => {
    for (const ground of ['>', 'I']) {
      expectAgree(scenario(`@${glyph}${ground}..`, 'E'), (pair) => {
        expect(pair.rig.player.x).toBe(2);
        expect(pair.rig.entities.map((e) => e.x)).toEqual([4]);
      });
    }
  });

  it(`${label}: is refused by both security gates`, () => {
    for (const gate of ['N', 'n']) {
      // The ordinary blocks only: the ice block passes the gates in CC3D (see its own cases).
      if (glyph === 'Z') continue;
      expectAgree(scenario(`@${glyph}${gate}.`, 'E'), (pair) => {
        expect(pair.rig.player.x).toBe(1);
      });
    }
  });
}

describe.each(CC3D_COLORS)('colour block %s', (color) => {
  const glyph = COLOR_BLOCK_GLYPH[color];
  const own = PLATE_GLYPH[color];
  const door = DOOR_GLYPH[color];
  const otherColor = CC3D_COLORS.find((c) => c !== color) as Cc3dColor;
  const otherPlate = PLATE_GLYPH[otherColor];
  const otherDoor = DOOR_GLYPH[otherColor];

  sharedCases(`colour block ${color}`, glyph);

  it('presses the plate of its own colour only while it rests on it', () => {
    const rows = room(`@${glyph}${own}...`, `.....${door}`);
    expectAgree({ rows, moves: 'E', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.terrainAt(6, 2)).toBe(DOOR_OPEN(color));
    });
    expectAgree({ rows, moves: 'EEE', glyphs: GLYPHS }, (pair) => {
      expect(pair.rig.entities.map((e) => e.x)).toEqual([5]);
      expect(pair.rig.terrainAt(6, 2)).toBe(DOOR_CLOSED(color));
    });
  });

  it('does not press the plate of another colour', () => {
    expectAgree(scenario(`@${glyph}${otherPlate}.${otherDoor}.`, 'E'), (pair) => {
      expect(pair.rig.entities.map((e) => e.x)).toEqual([3]);
      expect(pair.rig.terrainAt(5, 1)).toBe(DOOR_CLOSED(otherColor));
    });
  });

  it('floats in water as a bridge the player walks over', () => {
    expectAgree(scenario(`@${glyph}W.`, 'EEE'), (pair) => {
      expect(pair.rig.player.x).toBe(4);
      expect(pair.rig.player.alive).toBe(true);
    });
  });

  it('is refused by fire, as in CC3D', () => {
    expectAgree(scenario(`@${glyph}F.`, 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(1);
      expect(pair.rig.entities.map((e) => e.x)).toEqual([2]);
    });
  });

  it('is refused by any item, as in CC3D', () => {
    for (const item of ['i', 'e', 'r', 'u', 'f', 'w', 'a', 'o', 's']) {
      expectAgree(scenario(`@${glyph}${item}.`, 'E'), (pair) => {
        expect(pair.rig.player.x, item).toBe(1);
        expect(pair.rig.entities.map((e) => e.x), item).toEqual([2]);
      });
    }
  });

  it('enters dirt and clears it, as the Epoxy block does over dirt_3d', () => {
    expectAgree(scenario(`@${glyph}D.`, 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('enters an open blue gate and clears it, as the Epoxy fish gate does', () => {
    expectAgree(scenario(`@${glyph}S.`, 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });
});

describe('dirt block', () => {
  sharedCases('dirt block', 'K');

  it('enters an open blue gate and clears it, as the Epoxy fish gate does', () => {
    expectAgree(scenario('@KS.', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('presses a plate of any colour', () => {
    for (const color of ['red', 'blue'] as const) {
      expectAgree(scenario(`@K${PLATE_GLYPH[color]}.${DOOR_GLYPH[color]}.`, 'E'), (pair) => {
        expect(pair.rig.terrainAt(5, 1)).toBe(DOOR_OPEN(color));
      });
    }
  });

  it('fills water with dirt, which the player clears', () => {
    expectAgree(scenario('@KW.', 'E'), (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('dirt');
      expect(pair.rig.entities).toHaveLength(0);
      // Remaining difference: the water Epoxy fills is the plain dirt tile, not dirt_3d (the comparison reads them as one).
      expect(pair.epoxy.getTerrain()[1][3]).toBe('dirt');
    });
  });

  it('differs at fire: CC3D refuses the block, Epoxy lets it in', () => {
    expectDisagree(scenario('@KF.', 'E'), 'player', (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('differs at an item: CC3D refuses the block, Epoxy lets it onto the item', () => {
    expectDisagree(scenario('@Ki.', 'E'), 'player', (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('enters dirt and clears it, as the Epoxy block does over dirt_3d', () => {
    expectAgree(scenario('@KD.', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });
});

describe('ice block', () => {
  sharedCases('ice block', 'Z');

  it('presses a plate of any colour', () => {
    for (const color of ['red', 'blue'] as const) {
      expectAgree(scenario(`@Z${PLATE_GLYPH[color]}.${DOOR_GLYPH[color]}.`, 'E'), (pair) => {
        expect(pair.rig.terrainAt(5, 1)).toBe(DOOR_OPEN(color));
      });
    }
  });

  it('melts in fire into water, and freezes water into ice', () => {
    expectAgree(scenario('@ZF.', 'E'), (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('water');
      expect(pair.rig.entities).toHaveLength(0);
    });
    expectAgree(scenario('@ZW.', 'E'), (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('ice');
      expect(pair.rig.entities).toHaveLength(0);
    });
  });

  it('is pushed onto an item and over a teleport the same way', () => {
    expectAgree(scenario('@Z.i..', 'EE'), (pair) => {
      expect(pair.rig.entities.map((e) => e.x)).toEqual([4]);
    });
  });

  it('enters an open blue gate and clears it, as the Epoxy fish gate does', () => {
    expectAgree(scenario('@ZS..', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('is refused by a closed blue gate', () => {
    expectAgree(scenario('@ZS..i', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('slides over dirt without clearing it, as ice_block_3d does', () => {
    expectAgree(scenario('@ZD.', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe('dirt');
    });
  });

  it('pushes a chain of blocks along, as ice_block_3d does', () => {
    expectAgree(scenario('@ZKK.', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 4, 5]);
    });
  });

  it('pushes a chain of ice blocks along, as the Epoxy ice block does', () => {
    for (const row of ['@ZZ..', '@ZZZ.']) {
      expectAgree(scenario(row, 'E'), (pair) => {
        expect(pair.rig.player.x).toBe(2);
      });
    }
  });

  it('pushes a chain that holds a colour block along, as ice_block_3d does', () => {
    expectAgree(scenario('@ZC..', 'E'), (pair) => {
      expect(pair.rig.player.x).toBe(2);
    });
  });

  it('slides over the security gates, as ice_block_3d does', () => {
    for (const gate of ['N', 'n']) {
      expectAgree(scenario(`@Z${gate}..`, 'E'), (pair) => {
        expect(pair.rig.player.x).toBe(2);
      });
    }
  });
});

describe('coverage verdicts that rest on this evidence', () => {
  it('keeps the dirt block approximate (fire, items and the plain dirt of water), its reason citing this file', () => {
    expect(EPOXY_COVERAGE.block_dirt.level).toBe('approx');
    expect(EPOXY_COVERAGE.block_dirt.reason).toContain('cc3dEvidenceBlocks.test.ts');
  });

  it('plays the ice block and the colour blocks as CC3D does, each reason citing this file', () => {
    for (const key of ['block_ice', ...CC3D_COLORS.map((color) => `block_color_${color}`)]) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceBlocks.test.ts');
    }
  });
});
