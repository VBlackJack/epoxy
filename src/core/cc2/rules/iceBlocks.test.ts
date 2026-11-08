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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel } from '../../lynx/lynxTestMaps';
import { LynxRig } from '../../lynx/lynxTestRig';
import { LYNX_RULE_MODULES } from '../../lynx/rules';
import { Cc2Engine } from '../Cc2Engine';
import { ICE_BLOCK, iceBlockRules } from './iceBlocks';

beforeAll(() => {
  loadTestConfigs();
});

const MODULES = [...LYNX_RULE_MODULES, iceBlockRules];
const GLYPHS = { I: { entity: { type: ICE_BLOCK, dir: 'E' as const } } };
/** Ticks for Chip to push a block through a few cells and for the splash to settle. */
const PUSH_TICKS = 40;

function pushEast(row: string): LynxRig {
  const rig = new LynxRig(lynxLevel(['########', `#@${row}#`, '########'], { glyphs: GLYPHS }), { modules: MODULES });
  rig.hold('E');
  rig.tick(PUSH_TICKS);
  return rig;
}

describe('CC2 ice blocks', () => {
  it('places the ice block of the level and pushes it like a block', () => {
    const rig = new LynxRig(lynxLevel(['######', '#@I..#', '######'], { glyphs: GLYPHS }), { modules: MODULES });
    expect(rig.entities.map((e) => e.type)).toEqual([ICE_BLOCK]);
    rig.hold('E');
    rig.tick(4);
    rig.release();
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 1)?.type).toBe(ICE_BLOCK);
  });

  it('is not reported as unsupported by the CC2 engine', () => {
    const engine = new Cc2Engine({ effect: () => undefined, step: () => undefined });
    engine.loadLevel(lynxLevel(['######', '#@I..#', '######'], { glyphs: GLYPHS }));
    expect(engine.getUnsupportedTiles()).toEqual([]);
  });

  it('turns the water it is pushed into to ice and is used up', () => {
    const rig = pushEast('IW..');
    expect(rig.entities.filter((e) => e.type === ICE_BLOCK)).toHaveLength(0);
    expect(rig.engine.getTerrain()[1][3]).toBe('ice');
  });

  it('melts on fire: the block is gone and the fire is water', () => {
    const rig = pushEast('IF..');
    expect(rig.entities.filter((e) => e.type === ICE_BLOCK)).toHaveLength(0);
    expect(rig.engine.getTerrain()[1][3]).toBe('water');
  });

  it('leaves a dirt block alone: it still makes dirt of the water', () => {
    const rig = new LynxRig(lynxLevel(['########', '#@BW..#', '########']), { modules: MODULES });
    rig.hold('E');
    rig.tick(PUSH_TICKS);
    expect(rig.engine.getTerrain()[1][3]).toBe('floor');
  });
});
