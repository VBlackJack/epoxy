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

/** The CC2 transmogrifier draws a blob's new kind from the walker byte (Lexy tiletypes.js:1819, 1838). */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { drawWalkerByte, newCcGenerators } from './ccGenerators';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const CELL_X = 6;
const SEED = 77;
const POOL = ['glider', 'paramecium', 'fireball', 'bug', 'walker', 'pink_ball', 'teeth', 'tank', 'timid_teeth'];

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

beforeEach(() => {
  loadTestConfigs();
});

function blobOnTransmogrifier(mode: RoomMode): { engine: GameEngine; type: () => string } {
  const level = room({
    mode,
    startX: 11,
    entities: [{ type: 'blob', x: CELL_X, y: ROOM_ROW, dir: 'E' }],
    terrain: { [`${CELL_X},${ROOM_ROW}`]: 'transmogrifier_cc2' }
  });
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  const entity = engine.getEntities()[0];
  resolveMonsterArrival(contextOf(engine), entity, false);
  return { engine, type: () => entity.type };
}

describe('CC2 transmogrifier draw', () => {
  it('lists nine kinds in the order of the Lexy table', () => {
    expect(ConfigRegistry.getEntityDef('blob')?.transmogrifiesToCc2Pool).toEqual(POOL);
  });

  it('turns a blob into the pool entry the walker byte picks', () => {
    const shadow = newCcGenerators(SEED);
    const probe = new GameEngine();
    probe.loadLevel(room({ mode: 'cc2', startX: 11 }), SEED);
    Object.assign(shadow, structuredClone(worldOf(probe).ccGenerators));
    const expected = POOL[drawWalkerByte(shadow) % POOL.length];
    expect(blobOnTransmogrifier('cc2').type()).toBe(expected);
  });

  it('still draws from the level random stream on a native level', () => {
    const native = blobOnTransmogrifier('native');
    expect(worldOf(native.engine).ccGenerators).toBeNull();
    expect(POOL).toContain(native.type());
  });
});
