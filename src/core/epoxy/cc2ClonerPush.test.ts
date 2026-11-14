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

/**
 * CC2 clone machine (Lexy tiletypes.js:1716-1731): a cloned block pushes the block in the exit out of the way first, by its pushes table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement } from '../types';
import type { EpoxyContext } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CLONER_X = 5;
const SPAWN_X = CLONER_X + 1;
const BEYOND_X = SPAWN_X + 1;
const BUTTON_X = 8;
const BUTTON_Y = 8;
const FIRST_X = 3;
const LAST_X = 9;
const OTHER_ROW = ROOM_ROW + 2;
const TEMPLATE_TYPE = 'dirt_block';

function machine(mode: RoomMode, extra: EntityPlacement[] = [], template = TEMPLATE_TYPE): GameEngine {
  const level = room({
    mode,
    startX: 2,
    terrain: { [`${CLONER_X},${ROOM_ROW}`]: 'clone_machine', [`${BUTTON_X},${BUTTON_Y}`]: 'button_red' },
    entities: [
      { type: 'dirt_block', x: FIRST_X, y: OTHER_ROW, dir: 'E' },
      { type: template, x: CLONER_X, y: ROOM_ROW, dir: 'E' },
      { type: 'dirt_block', x: LAST_X, y: OTHER_ROW, dir: 'E' },
      ...extra
    ]
  });
  level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: BUTTON_Y, clonerX: CLONER_X, clonerY: ROOM_ROW, templateType: template, templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const press = (engine: GameEngine): void => {
  (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_X, BUTTON_Y, 'trigger_cloner');
};
const at = (engine: GameEngine, x: number) => engine.getEntities().find((e) => e.x === x && e.y === ROOM_ROW);

describe('CC2 cloned block in a blocked exit', () => {
  it('an ice block cloned pushes the ice block in its exit out of the way and comes out', () => {
    const engine = machine('cc2', [{ type: 'ice_block', x: SPAWN_X, y: ROOM_ROW, dir: 'E' }], 'ice_block');
    press(engine);
    expect(at(engine, BEYOND_X)?.type).toBe('ice_block');
    expect(at(engine, SPAWN_X)?.type).toBe('ice_block');
  });

  it('a dirt block cloned does not push: the exit stays blocked and nothing comes out', () => {
    const engine = machine('cc2', [{ type: 'dirt_block', x: SPAWN_X, y: ROOM_ROW, dir: 'E' }]);
    const count = engine.getEntities().length;
    press(engine);
    expect(engine.getEntities().length).toBe(count);
    expect(at(engine, BEYOND_X)).toBeUndefined();
  });

  it('a classic-rules level does not push either', () => {
    const engine = machine('cc', [{ type: 'ice_block', x: SPAWN_X, y: ROOM_ROW, dir: 'E' }], 'ice_block');
    press(engine);
    expect(at(engine, BEYOND_X)).toBeUndefined();
  });
});
