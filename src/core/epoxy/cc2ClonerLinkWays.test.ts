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
 * CC2 clone machine, wave 13 (Lexy tiletypes.js:1703-1748): a linked cloner fires from its actual occupant and spawns nothing when
 * empty (:1704-1706); a wire-powered cloner searches clockwise for a free way from the occupant's way and the new template faces the
 * way taken (:1711-1712, :1716-1742, :1745-1748), while a red or gray button tries one way only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { fireClonerAt } from './epoxyDevices';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CLONER_X = 5;
const EAST_X = CLONER_X + 1;
const BUTTON_X = 8;
const BUTTON_Y = 8;
const TEMPLATE_TYPE = 'dirt_block';
const OTHER_TEMPLATE_TYPE = 'ice_block';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function machine(mode: RoomMode, walledEast: boolean, linked: boolean): GameEngine {
  const level = room({
    mode,
    startX: 2,
    terrain: {
      [`${CLONER_X},${ROOM_ROW}`]: 'clone_machine',
      [`${BUTTON_X},${BUTTON_Y}`]: 'button_red',
      ...(walledEast ? { [`${EAST_X},${ROOM_ROW}`]: 'wall' } : {})
    },
    entities: [{ type: TEMPLATE_TYPE, x: CLONER_X, y: ROOM_ROW, dir: 'E' }]
  });
  if (linked) {
    level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: BUTTON_Y, clonerX: CLONER_X, clonerY: ROOM_ROW, templateType: TEMPLATE_TYPE, templateDir: 'E' }];
  }
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const press = (engine: GameEngine): void => {
  ctxOf(engine).triggerButton(BUTTON_X, BUTTON_Y, 'trigger_cloner');
};
const at = (engine: GameEngine, x: number, y = ROOM_ROW): RuntimeEntity | undefined => world(engine).entities.find((e) => e.x === x && e.y === y);
const empty = (engine: GameEngine): void => {
  const w = world(engine);
  w.entities = w.entities.filter((e) => !(e.x === CLONER_X && e.y === ROOM_ROW));
};

describe('CC2 linked clone machine fires from its occupant (Lexy tiletypes.js:1704-1706)', () => {
  it('spawns nothing for a red button when the cloner is empty, then clones the template that enters', () => {
    const engine = machine('cc2', false, true);
    empty(engine);
    const count = world(engine).entities.length;
    press(engine);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, EAST_X)).toBeUndefined();
    const w = world(engine);
    w.entities.push({ uid: w.nextEntityUid++, type: OTHER_TEMPLATE_TYPE, kind: 'block', x: CLONER_X, y: ROOM_ROW, dir: 'E', cooldownTicks: 0, isSliding: false });
    press(engine);
    expect(at(engine, EAST_X)?.type).toBe(OTHER_TEMPLATE_TYPE);
  });

  // Fails without the clone machine check of triggerButton: the block standing on the plain floor would be cloned out of it.
  it('a link whose cell is no longer a clone machine fires nothing', () => {
    const engine = machine('cc2', false, true);
    world(engine).terrain[ROOM_ROW][CLONER_X] = 'floor';
    const count = world(engine).entities.length;
    press(engine);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, EAST_X)).toBeUndefined();
  });

  it('on a classic-rules level the link still names the template of an emptied cloner', () => {
    const engine = machine('cc', false, true);
    empty(engine);
    press(engine);
    expect(at(engine, EAST_X)?.type).toBe(TEMPLATE_TYPE);
  });
});

describe('CC2 wire-powered clone machine searches clockwise (Lexy tiletypes.js:1716-1748)', () => {
  it('releases south when east is blocked, and the new template faces south', () => {
    const engine = machine('cc2', true, false);
    const template = at(engine, CLONER_X)!;
    expect(fireClonerAt(ctxOf(engine), CLONER_X, ROOM_ROW, true)).toBe(true);
    expect(template.x).toBe(CLONER_X);
    expect(template.y).toBe(ROOM_ROW + 1);
    const fresh = at(engine, CLONER_X);
    expect(fresh?.type).toBe(TEMPLATE_TYPE);
    expect(fresh?.uid).not.toBe(template.uid);
    expect(fresh?.dir).toBe('S');
  });

  // Fails without the fromOccupant line: the link template way (east, walled) would be tried first and the clone would go south.
  it('starts from the occupant way of a linked cloner, not the link template way', () => {
    const engine = machine('cc2', true, true);
    at(engine, CLONER_X)!.dir = 'W';
    expect(fireClonerAt(ctxOf(engine), CLONER_X, ROOM_ROW, true)).toBe(true);
    expect(at(engine, CLONER_X - 1)?.type).toBe(TEMPLATE_TYPE);
    expect(at(engine, CLONER_X, ROOM_ROW + 1)).toBeUndefined();
    expect(at(engine, CLONER_X)?.dir).toBe('W');
  });

  // Fails without the fromOccupant line: the link template would be cloned out of the empty machine.
  it('a wire edge on an empty linked cloner spawns nothing', () => {
    const engine = machine('cc2', false, true);
    empty(engine);
    const count = world(engine).entities.length;
    expect(fireClonerAt(ctxOf(engine), CLONER_X, ROOM_ROW, true)).toBe(true);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, EAST_X)).toBeUndefined();
  });

  it('a red or gray button tries one way only: blocked east, nothing comes out', () => {
    const engine = machine('cc2', true, false);
    const count = world(engine).entities.length;
    expect(fireClonerAt(ctxOf(engine), CLONER_X, ROOM_ROW, false)).toBe(true);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, CLONER_X, ROOM_ROW + 1)).toBeUndefined();
    expect(at(engine, CLONER_X)?.dir).toBe('E');
  });

  it('a red button on a blocked linked cloner tries one way only', () => {
    const engine = machine('cc2', true, true);
    const count = world(engine).entities.length;
    press(engine);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, CLONER_X, ROOM_ROW + 1)).toBeUndefined();
  });

  it('on a classic-rules level a wire edge still tries one way only', () => {
    const engine = machine('cc', true, false);
    const count = world(engine).entities.length;
    fireClonerAt(ctxOf(engine), CLONER_X, ROOM_ROW, true);
    expect(world(engine).entities.length).toBe(count);
    expect(at(engine, CLONER_X, ROOM_ROW + 1)).toBeUndefined();
  });
});
