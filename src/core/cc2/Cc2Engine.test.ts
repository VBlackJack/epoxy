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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel } from '../lynx/lynxTestMaps';
import { Cc2Engine } from './Cc2Engine';
import { CC2_RULE_MODULES } from './rules';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
const SETTLE_TICKS = 12;

describe('Cc2Engine', () => {
  it('builds its rule book without a second rule for any id', () => {
    const engine = new Cc2Engine(SILENT);
    expect(() => engine.loadLevel(lynxLevel(['###', '#@#', '###']))).not.toThrow();
    expect(new Set(CC2_RULE_MODULES.map((m) => m.name)).size).toBe(CC2_RULE_MODULES.length);
  });

  it('refuses undo', () => {
    const engine = new Cc2Engine(SILENT);
    engine.loadLevel(lynxLevel(['####', '#@.#', '####']));
    engine.holdPlayerDirection('E');
    engine.tick();
    expect(engine.canUndo()).toBe(false);
    expect(engine.undo()).toBe(false);
  });

  it('does not press a green button for an ice block that starts on it', () => {
    const level = lynxLevel(['#######', '#@.G.c#', '#######'], {
      glyphs: {
        G: { terrain: 'button_green', entity: { type: 'ice_block', dir: 'E' } },
        c: { item: 'green_chip' }
      }
    });
    const engine = new Cc2Engine(SILENT);
    engine.loadLevel(level);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.getItems()[1][5]).toBe('green_chip');
    expect(engine.getUnsupportedTiles()).toEqual([]);
  });
});
