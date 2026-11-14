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
 * CC2 clone machine (Lexy tiletypes.js:1703-1731, game.js:3100-3123): the template itself goes out and a fresh template at the
 * end of the actor list takes its place.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement } from '../types';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CLONER_X = 5;
const SPAWN_X = CLONER_X + 1;
const BUTTON_X = 8;
const BUTTON_Y = 8;
const FIRST_X = 3;
const LAST_X = 9;
const OTHER_ROW = ROOM_ROW + 2;
const TEMPLATE_TYPE = 'dirt_block';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

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

describe('CC2 clone machine identity', () => {
  it('lets the template itself out, keeping uid, list place and ordinal, and appends a fresh template', () => {
    const engine = machine('cc2');
    const before = world(engine).entities.map((e) => e.uid);
    const template = at(engine, CLONER_X);
    expect(template).toBeDefined();
    const place = before.indexOf(template!.uid);
    const ordinal = template!.listOrdinal;
    expect(ordinal).toBeDefined();
    press(engine);
    const list = world(engine).entities;
    expect(list[place]).toBe(template);
    expect(template!.x).toBe(SPAWN_X);
    expect(template!.listOrdinal).toBe(ordinal);
    const fresh = list[list.length - 1];
    expect(list.length).toBe(before.length + 1);
    expect(fresh.x).toBe(CLONER_X);
    expect(fresh.type).toBe(TEMPLATE_TYPE);
    expect(fresh.uid).not.toBe(template!.uid);
    expect(fresh.listOrdinal).toBeUndefined();
  });

  it('on a classic-rules level a new creature comes out and the template stays', () => {
    const engine = machine('cc');
    const template = at(engine, CLONER_X);
    press(engine);
    expect(at(engine, CLONER_X)).toBe(template);
    expect(at(engine, SPAWN_X)?.uid).not.toBe(template!.uid);
  });

  it('keeps the template that went out out of the rest of a running pass', () => {
    const engine = machine('cc2');
    const template = at(engine, CLONER_X);
    world(engine).ccPassOpen = true;
    press(engine);
    expect(world(engine).cc2SkipTurn?.has(template!.uid)).toBe(true);
  });

  it("keeps the template that went out out of the rest of the tick when it is fired during the player's turn", () => {
    const engine = machine('cc2');
    const template = at(engine, CLONER_X);
    world(engine).inTick = true;
    world(engine).cc2TurnSeen = new Set<number>();
    press(engine);
    expect(world(engine).cc2SkipTurn?.has(template!.uid)).toBe(true);
  });

  it('marks nothing to skip outside a pass, and on a level that is not CC2', () => {
    const idle = machine('cc2');
    press(idle);
    expect(world(idle).cc2SkipTurn).toBeUndefined();
    const classic = machine('cc');
    world(classic).ccPassOpen = true;
    press(classic);
    expect(world(classic).cc2SkipTurn).toBeUndefined();
  });

  it('never rebuilds the actor list from the classic slots on a CC2 level', () => {
    const engine = machine('cc2');
    world(engine).ccSlots = [];
    press(engine);
    const types = world(engine).entities.map((e) => e.type);
    expect(types.filter((t) => t === TEMPLATE_TYPE).length).toBe(4);
  });
});
