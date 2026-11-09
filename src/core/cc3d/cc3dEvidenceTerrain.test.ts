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
import { EPOXY_COVERAGE } from './epoxyCoverage';
import { expectAgree, expectDisagree } from './cc3dEvidenceAsserts';
import { device, playTimeline, room, withMob } from './cc3dEvidenceRig';
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

  it('differs for blocks: a CC3D block enters dirt and clears it, an Epoxy block is refused', () => {
    expectDisagree({ rows: room('@KD.'), moves: 'E' }, 'player', (pair) => {
      expect(pair.rig.player.x).toBe(2);
      expect(pair.rig.terrainAt(3, 1)).toBe(FLOOR);
    });
  });

  it('differs for the ice block: CC3D slides it over dirt without clearing it, Epoxy refuses it', () => {
    expectDisagree({ rows: room('@ZD.'), moves: 'E' }, 'player', (pair) => {
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

  it('differs for the player holding both the fire and the water orb: CC3D lets him through and cleans it, Epoxy kills him', () => {
    expectDisagree({ rows: room('@fwL.'), moves: 'EEE' }, 'alive', (pair) => {
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

  it('differs for blocks: pushing a block into it makes a wall in CC3D, and leaves it in Epoxy', () => {
    for (const block of ['K', 'Z']) {
      expectDisagree({ rows: room(`@${block}Q.`), moves: 'E' }, 'cells', (pair) => {
        expect(pair.rig.terrainAt(3, 1)).toBe(WALL);
        expect(pair.rig.player.x).toBe(1);
      });
    }
  });

  it('differs for monsters: a CC3D monster that tries to enter it makes a wall, an Epoxy one does not', () => {
    const t = playTimeline({ rows: bouncerInto('Q'), moves: '', glyphs: BOUNCER });
    expect(t.sameFinal).toBe(false);
    expect(t.cc3d.terrain).toHaveLength(2);
    expect(t.epoxy.terrain).toHaveLength(1);
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

  it('differs for the ice block: CC3D slides it over the gate, Epoxy refuses it', () => {
    expectDisagree({ rows: room('@ZN..'), moves: 'E' }, 'player', (pair) => {
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

  it('differs for the ice block: CC3D slides it over the gate, Epoxy refuses it', () => {
    expectDisagree({ rows: room('@Zn..'), moves: 'E' }, 'player', (pair) => {
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
  it('keeps the elements with a pinned difference approximate, and each reason cites this file', () => {
    for (const key of ['water', 'dirt', 'slime', 'appearing_wall', 'gate_tools', 'gate_keys', 'gravel_with_reflector']) {
      expect(EPOXY_COVERAGE[key].level, key).toBe('approx');
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
