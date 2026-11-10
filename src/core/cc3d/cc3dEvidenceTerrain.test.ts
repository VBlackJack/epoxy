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
import { classifyLevel, EPOXY_COVERAGE } from './epoxyCoverage';
import { expectAgree, expectDisagree } from './cc3dEvidenceAsserts';
import { device, playTimeline, room, withMob } from './cc3dEvidenceRig';
import { cc3dModel } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';

/**
 * Coverage evidence for the terrain elements: water, bomb, turtle, dirt, slime, appearing wall, the two security
 * gates and gravel. Each case plays a tiny CC3D map on the CC3D engine and on its conversion and compares the two
 * after every move (see cc3dEvidenceRig). An agreeing case also reads the CC3D side, so that it proves the rule
 * was exercised; a disagreeing case pins the difference that the coverage reason of the element names.
 */

beforeEach(() => {
  loadTestConfigs();
});

/** A bouncer walking east: it goes straight on and turns round when blocked, so it is the plainest monster. */
const BOUNCER: Record<string, GlyphMeaning> = { b: withMob(device('floor'), { kind: 'bouncer', dir: 'E' }) };
/** The player sealed in a corner cell, so that only the monster moves. */
const SEALED_START = '@#######';
const BOUNCER_ROW_START = '##.b.';
const BOUNCER_ROW_END = '..#';
const FLOOR = 'floor';
const WALL = 'wall';
/** The ids under which the CC3D engine lists the keys the player holds. */
const KEY_RED = 'key_red';
const KEY_GREEN = 'key_green';
const KEY_BLUE = 'key_blue';

/** A corridor with a bouncer going east into the given terrain glyph. */
function bouncerInto(glyph: string): string[] {
  return room(SEALED_START, `${BOUNCER_ROW_START}${glyph}${BOUNCER_ROW_END}`);
}

describe('water', () => {
  it('drowns the player', () => {
    expectAgree({ rows: room('@W.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('spares the player holding the water orb, and not the one holding the fire orb', () => {
    expectAgree({ rows: room('@wW.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.player.x).toBe(4);
    });
    expectAgree({ rows: room('@fW.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('turns water into dirt under a dirt block, which the player then clears', () => {
    expectAgree({ rows: room('@KW.'), moves: 'E' }, (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('dirt');
      expect(pair.rig.entities).toHaveLength(0);
      expect(pair.epoxy.getTerrain()[1][3]).toBe('dirt_3d');
    });
    expectAgree({ rows: room('@KW.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
      expect(pair.rig.player.x).toBe(3);
    });
  });

  it('turns water into ice under an ice block, and the player slides on it', () => {
    expectAgree({ rows: room('@ZW.'), moves: 'E' }, (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('ice');
    });
    expectAgree({ rows: room('@ZW.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(4);
    });
  });

  it('floats a colour block as a bridge the player walks over, and which is not pushed again', () => {
    expectAgree({ rows: room('@CW..'), moves: 'E' }, (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe('water');
      expect(pair.rig.entities.map((e) => [e.x, e.y])).toEqual([[3, 1]]);
    });
    expectAgree({ rows: room('@CW..'), moves: 'EEEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(5);
      expect(pair.rig.entities.map((e) => [e.x, e.y])).toEqual([[3, 1]]);
    });
  });

  it('refuses a second block onto a floating colour block, as CC3D does', () => {
    const rows = room('@CW.', '..K.', '....');
    expectAgree({ rows, moves: 'ESSEN' }, (pair) => {
      expect(pair.rig.player.y).toBe(3);
      expect(pair.rig.entities.map((e) => `${e.type}@${e.x},${e.y}`).sort()).toEqual(['cc3d_block_blue@3,1', 'dirt_block@3,2']);
    });
  });

  it('is refused by a monster without water immunity, in CC3D and by the Epoxy bouncer alike', () => {
    const t = playTimeline({ rows: bouncerInto('W'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('bouncer');
    expect(t.cc3d.final).toContain('water');
    expect(t.epoxy.final).toContain('bouncer');
    expect(t.epoxy.final).toContain('water');
  });
});

describe('bomb', () => {
  it('kills the player who steps on it, with or without boots', () => {
    expectAgree({ rows: room('@O.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
    expectAgree({ rows: room('@fwO.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('is spent with any block that enters it, and the player pushing it stays alive', () => {
    for (const block of ['K', 'Z', 'C']) {
      expectAgree({ rows: room(`@${block}O.`), moves: 'EE' }, (pair) => {
        expect(pair.rig.entities).toHaveLength(0);
        expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
        expect(pair.rig.player.alive).toBe(true);
        expect(pair.rig.player.x).toBe(3);
      });
    }
  });

  it('is spent with the monster that enters it', () => {
    const t = playTimeline({ rows: bouncerInto('O'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).not.toContain('bouncer');
    expect(t.cc3d.final).not.toContain('bomb');
  });
});

describe('turtle', () => {
  it('sinks behind the player who leaves it, one turtle after the other', () => {
    expectAgree({ rows: room('@TTT.'), moves: 'EEEE' }, (pair) => {
      expect([2, 3, 4].map((x) => pair.rig.terrainAt(x, 1))).toEqual(['water', 'water', 'water']);
      expect(pair.rig.player.x).toBe(5);
      expect(pair.rig.player.alive).toBe(true);
    });
  });

  it('drowns the player who steps back onto a sunk turtle', () => {
    expectAgree({ rows: room('@T.'), moves: 'EEW' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('sinks behind a block pushed off it', () => {
    for (const block of ['K', 'C']) {
      expectAgree({ rows: room(`@${block}T.`), moves: 'EEE' }, (pair) => {
        expect(pair.rig.terrainAt(3, 1)).toBe('water');
        expect(pair.rig.player.alive).toBe(false);
      });
    }
  });

  it('lets the player with the water orb cross sunk turtles', () => {
    expectAgree({ rows: room('@wTT.'), moves: 'EEEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.player.x).toBe(5);
    });
  });

  it('is crossed by a monster, which sinks it behind it, in CC3D and in Epoxy alike', () => {
    const t = playTimeline({ rows: bouncerInto('T'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('water');
    expect(t.epoxy.final).toContain('water');
    expect(t.epoxy.final).not.toContain('turtle');
  });
});

describe('dirt', () => {
  it('is cleared by the player who walks into it, from any side', () => {
    expectAgree({ rows: room('@D.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.terrainAt(2, 1)).toBe(FLOOR);
      expect(pair.rig.player.x).toBe(3);
    });
    expectAgree({ rows: room('@', 'D', '.'), moves: 'SS' }, (pair) => {
      expect(pair.rig.terrainAt(1, 2)).toBe(FLOOR);
      expect(pair.rig.player.y).toBe(3);
    });
  });

  it('is cleared whatever the player holds', () => {
    expectAgree({ rows: room('@fD.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
      expect(pair.rig.player.x).toBe(4);
    });
  });

  it('stops the monsters', () => {
    const t = playTimeline({ rows: bouncerInto('D'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('dirt');
    expect(t.cc3d.final).toContain('bouncer');
  });

  it('is entered and cleared by blocks, as the Epoxy dirt_3d is', () => {
    expectAgree({ rows: room('@KD.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('is slid over by the ice block without being cleared, as the Epoxy dirt_3d is', () => {
    expectAgree({ rows: room('@ZD.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe('dirt');
    });
  });
});

describe('slime', () => {
  it('kills the player, who is not saved by one orb', () => {
    expectAgree({ rows: room('@L.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
    expectAgree({ rows: room('@fL.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('is cleaned away, with the block, by any block that enters it', () => {
    for (const block of ['K', 'Z', 'C']) {
      expectAgree({ rows: room(`@${block}L.`), moves: 'EEE' }, (pair) => {
        expect(pair.rig.entities).toHaveLength(0);
        expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
        expect(pair.rig.player.x).toBe(4);
      });
    }
  });

  it('lets the player holding both the fire and the water orb through and is cleaned, as the Epoxy slime_3d is', () => {
    expectAgree({ rows: room('@fwL.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(true);
      expect(pair.rig.terrainAt(4, 1)).toBe(FLOOR);
    });
  });

  it('is refused by a monster, in CC3D and by the Epoxy bouncer alike', () => {
    const t = playTimeline({ rows: bouncerInto('L'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('bouncer');
    expect(t.epoxy.final).toContain('bouncer');
  });
});

describe('appearing wall', () => {
  it('turns into a wall when the player bumps it, from any side', () => {
    expectAgree({ rows: room('@Q.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.terrainAt(2, 1)).toBe(WALL);
      expect(pair.rig.player.x).toBe(1);
    });
    expectAgree({ rows: room('@', 'Q', '.'), moves: 'SS' }, (pair) => {
      expect(pair.rig.terrainAt(1, 2)).toBe(WALL);
      expect(pair.rig.player.y).toBe(1);
    });
    expectAgree({ rows: room('@Q.', '...'), moves: 'ESE' }, (pair) => {
      expect(pair.rig.terrainAt(2, 1)).toBe(WALL);
      expect(pair.rig.player).toMatchObject({ x: 2, y: 2 });
    });
  });

  it('becomes a wall when a block is pushed into it, as the Epoxy appearing_wall_any does', () => {
    for (const block of ['K', 'Z']) {
      expectAgree({ rows: room(`@${block}Q.`), moves: 'E' }, (pair) => {
        expect(pair.rig.terrainAt(3, 1)).toBe(WALL);
        expect(pair.rig.player.x).toBe(1);
      });
    }
  });

  it('becomes a wall when the player slides into it over ice or a force floor, as in Epoxy', () => {
    for (const rows of [room('@IIIQ.'), room('@>>>Q.')]) {
      expectAgree({ rows, moves: 'EE' }, (pair) => {
        expect(pair.rig.terrainAt(5, 1)).toBe(WALL);
      });
    }
  });

  it('becomes a wall when a dirt or ice block slides into it over ice or a force floor, and the block stops against it', () => {
    // The two engines first parted here: the Epoxy block bounced back off the wall it had just shown (and crushed the
    // player), where the CC3D block stops. The CC3D dirt and ice blocks now stop at what refuses them (stopsAtWall).
    for (const rows of [room('@KIIIQ.'), room('@ZIIIQ.'), room('@K>>>Q.')]) {
      const t = playTimeline({ rows, moves: '' }, 'EE');
      expect(t.sameSequence, rows[1]).toBe(true);
      expect(t.sameFinal, rows[1]).toBe(true);
      expect(t.cc3d.terrain.length, rows[1]).toBe(2);
      expect(t.pair.rig.terrainAt(6, 1), rows[1]).toBe(WALL);
      expect(t.pair.epoxy.getTerrain()[1][6], rows[1]).toBe(WALL);
    }
    // Without a colour block the level raises nothing for it.
    expect(classifyLevel(cc3dModel(room('@KIIIQ.'))).verdict).toBe('exact');
    expect(classifyLevel(cc3dModel(room('@K>>>Q.'))).verdict).toBe('exact');
  });

  it('stops a colour block that slides on ice against a wall, as color_block_3d_<colour> does; the native colour block bounces back', () => {
    const glyphs: Record<string, GlyphMeaning> = { R: { mob: { kind: 'block_color', color: 'red' } } };
    for (const rows of [room('@RIII#.'), room('@RIIIQ.'), room('@R>>>#.')]) {
      const t = playTimeline({ rows, moves: '', glyphs }, 'EE');
      expect(t.sameSequence, rows[1]).toBe(true);
      expect(t.sameFinal, rows[1]).toBe(true);
    }
    // No key is raised for it any more: the level stays exact.
    expect(classifyLevel(cc3dModel(room('@RIII#.'), glyphs)).verdict).toBe('exact');
    expect(EPOXY_COVERAGE.color_block_on_ice).toBeUndefined();
  });

  it('becomes a wall when a monster tries to enter it, as the Epoxy appearing_wall_any does; the monster walk is then a step out of phase', () => {
    const t = playTimeline({ rows: bouncerInto('Q'), moves: '', glyphs: BOUNCER });
    // Both engines reveal the wall, and the terrain goes through the same two states ...
    expect(t.cc3d.terrain).toHaveLength(2);
    expect(t.epoxy.terrain).toEqual(t.cc3d.terrain);
    // ... but the bouncer turns round a step apart from CC3D afterwards (a timing difference of the monster, not of the wall).
    expect(t.sameSequence).toBe(false);
    expect(t.sameFinal).toBe(false);
  });
});

describe('tools gate', () => {
  it('takes every tool the player holds', () => {
    expectAgree({ rows: room('@wN.W.'), moves: 'EEEEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
      expect(pair.rig.player.x).toBe(5);
    });
    expectAgree({ rows: room('@fN.F.'), moves: 'EEEE' }, (pair) => {
      expect(pair.rig.player.alive).toBe(false);
    });
  });

  it('takes nothing from an empty-handed player, and not what he picks up after it, twice over', () => {
    expectAgree({ rows: room('@N.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
    expectAgree({ rows: room('@aNa.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(4);
    });
    expectAgree({ rows: room('@aN.N.'), moves: 'EEEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(5);
    });
  });

  it('refuses an ordinary block and a monster', () => {
    expectAgree({ rows: room('@KN.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
      expect(pair.rig.entities.map((e) => e.x)).toEqual([2]);
    });
    const t = playTimeline({ rows: bouncerInto('N'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('thief');
  });

  it('is slid over by the ice block, as the Epoxy ice_block_3d does', () => {
    expectAgree({ rows: room('@ZN..'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.entities.map((e) => e.x)).toEqual([3]);
    });
  });
});

describe('keys gate', () => {
  it('takes every key, the green one included, so that the doors stay shut', () => {
    expectAgree({ rows: room('@rn1.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
      expect(pair.rig.player.keys[KEY_RED]).toBeUndefined();
    });
    expectAgree({ rows: room('@gn4.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
      expect(pair.rig.player.keys[KEY_GREEN]).toBeUndefined();
    });
  });

  it('leaves the key picked up after it', () => {
    expectAgree({ rows: room('@nu.'), moves: 'EEE' }, (pair) => {
      expect(pair.rig.player.keys[KEY_BLUE]).toBe(1);
    });
  });

  it('refuses an ordinary block', () => {
    expectAgree({ rows: room('@Kn.'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('is slid over by the ice block, as the Epoxy ice_block_3d does', () => {
    expectAgree({ rows: room('@Zn..'), moves: 'E' }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
    });
  });
});

describe('gravel', () => {
  it('lets the player and every block in, and stops the monsters', () => {
    expectAgree({ rows: room('@G.'), moves: 'EE' }, (pair) => {
      expect(pair.rig.player.x).toBe(3);
    });
    for (const block of ['K', 'Z', 'C']) {
      expectAgree({ rows: room(`@${block}G.`), moves: 'E' }, (pair) => {
        expect(pair.rig.entities.map((e) => e.x)).toEqual([3]);
        expect(pair.rig.player.x).toBe(2);
      });
    }
    const t = playTimeline({ rows: bouncerInto('G'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(true);
    expect(t.cc3d.final).toContain('bouncer');
  });

  it('differs for a reflector: CC3D refuses it, Epoxy admits the mirror', () => {
    const glyphs = { r: { mob: { kind: 'reflector', mirror: 'LU' } } } as const;
    expectDisagree({ rows: room('@rG.'), moves: 'E', glyphs }, 'player', (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });

  it('lets a reflector into sand and refuses it dirt, in both engines', () => {
    const glyphs = { r: { mob: { kind: 'reflector', mirror: 'LU' } } } as const;
    expectAgree({ rows: room('@rA.'), moves: 'E', glyphs }, (pair) => {
      expect(pair.rig.player.x).toBe(2);
    });
    expectAgree({ rows: room('@rD.'), moves: 'E', glyphs }, (pair) => {
      expect(pair.rig.player.x).toBe(1);
    });
  });
});

describe('coverage verdicts that rest on this evidence', () => {
  it('keeps gravel beside a reflector approximate, its reason citing this file', () => {
    expect(EPOXY_COVERAGE.gravel_with_reflector.level).toBe('approx');
    expect(EPOXY_COVERAGE.gravel_with_reflector.reason).toContain('cc3dEvidenceTerrain.test.ts');
  });

  it('plays the appearing wall as CC3D does when no walking monster is on the map: the player and a pushed block agree above', () => {
    expect(EPOXY_COVERAGE.appearing_wall.level).toBe('exact');
    expect(EPOXY_COVERAGE.appearing_wall.reason).toContain('cc3dEvidenceTerrain.test.ts');
    for (const block of ['K', 'Z']) {
      expect(classifyLevel(cc3dModel(room(`@${block}Q.`)))).toEqual({ verdict: 'exact', lost: [], approx: [] });
    }
    // The same wall with a walking monster is the key whose reason names the step-apart turn (pinned by the bouncer timeline above).
    const withBouncer = classifyLevel(cc3dModel(bouncerInto('Q'), BOUNCER));
    expect(withBouncer.verdict).toBe('approx');
    expect(withBouncer.approx).toEqual(['appearing_wall_with_monster']);
    expect(EPOXY_COVERAGE.appearing_wall_with_monster.level).toBe('approx');
    expect(EPOXY_COVERAGE.appearing_wall_with_monster.reason).toContain('cc3dEvidenceTerrain.test.ts');
  });

  it('plays water as CC3D does now that a dirt block fills it with dirt_3d, its reason citing this file', () => {
    expect(EPOXY_COVERAGE.water.level).toBe('exact');
    expect(EPOXY_COVERAGE.water.reason).toContain('cc3dEvidenceTerrain.test.ts');
  });

  it('plays dirt, slime and the two security gates as CC3D does (the format 15 twins), each reason citing this file', () => {
    for (const key of ['dirt', 'slime', 'gate_tools', 'gate_keys']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceTerrain.test.ts');
    }
  });

  it('plays the bomb, the turtle and the plain gravel as CC3D does', () => {
    for (const key of ['bomb', 'turtle', 'gravel']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('exact');
      expect(EPOXY_COVERAGE[key].reason, key).toContain('cc3dEvidenceTerrain.test.ts');
    }
  });
});
