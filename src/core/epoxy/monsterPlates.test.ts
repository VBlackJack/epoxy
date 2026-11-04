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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement } from '../types';
import { entityPressesPlate, isButtonPressed } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

const PLATE_COLOR = 'red';
const PLATE_X = 3;
const ROW_Y = 1;
const DOOR_X = 4;
const OPEN_DOOR = 'hold_door_red_open';
const CLOSED_DOOR = 'hold_door_red_closed';
const SETTLE_TICKS = 20;
const PRESSING_MONSTERS: readonly string[] = ['tank', 'walker', 'bug', 'paramecium', 'pink_ball', 'blob', 'teeth', 'skitter', 'puppet'];
const FLYING_MONSTERS: readonly string[] = ['glider', 'fireball'];

function levelWith(entity: string): CompiledLevel {
  const row = ['wall', 'floor', 'floor', 'pressure_plate_red', CLOSED_DOOR, 'wall'];
  const wall = row.map(() => 'wall');
  const terrain = [wall, row, wall];
  const entities: EntityPlacement[] = [{ type: entity, x: PLATE_X, y: ROW_Y, dir: 'S' }];
  return {
    id: 'monster_plates',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: ROW_Y, dir: 'E' },
    terrain,
    items: terrain.map((r) => r.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function doorAfterLoad(entity: string): string {
  const engine = new GameEngine();
  engine.loadLevel(levelWith(entity));
  return engine.getTerrain()[ROW_Y][DOOR_X];
}

function doorAfterTicks(entity: string): string {
  const engine = new GameEngine();
  engine.loadLevel(levelWith(entity));
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine.getTerrain()[ROW_Y][DOOR_X];
}

describe('monsters on colour plates', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each(PRESSING_MONSTERS)('a %s holds a hold door open at load', (monster) => {
    expect(doorAfterLoad(monster)).toBe(OPEN_DOOR);
  });

  it.each(['tank', 'walker', 'bug'])('a %s that stays on the plate keeps the door open', (monster) => {
    const def = ConfigRegistry.getEntityDef(monster);
    if (!def) throw new Error(`${monster} is not defined`);
    // Pin the monster in place so it stays on the plate while the ticks run.
    def.moveIntervalTicks = SETTLE_TICKS * SETTLE_TICKS;
    expect(doorAfterTicks(monster)).toBe(OPEN_DOOR);
  });

  it.each(FLYING_MONSTERS)('a %s flies over the plate and does not press it', (monster) => {
    expect(ConfigRegistry.getEntityDef(monster)?.flying).toBe(true);
    expect(doorAfterLoad(monster)).toBe(CLOSED_DOOR);
  });

  it('lets an explicit pressesPlates false win over the default', () => {
    const def = ConfigRegistry.getEntityDef('tank');
    if (!def) throw new Error('tank is not defined');
    def.pressesPlates = false;
    expect(doorAfterLoad('tank')).toBe(CLOSED_DOOR);
  });

  it('lets an explicit pressesPlates true win over flying', () => {
    const def = ConfigRegistry.getEntityDef('glider');
    if (!def) throw new Error('glider is not defined');
    def.pressesPlates = true;
    expect(doorAfterLoad('glider')).toBe(OPEN_DOOR);
  });

  it('keeps the block rule: every block presses, a colour block only its own colour', () => {
    expect(entityPressesPlate('dirt_block', 'block', PLATE_COLOR)).toBe(true);
    expect(entityPressesPlate('color_block_red', 'block', PLATE_COLOR)).toBe(true);
    expect(entityPressesPlate('color_block_blue', 'block', PLATE_COLOR)).toBe(false);
  });

  it('leaves a brown button pressed by any occupant, flying or not', () => {
    const worldWith = (type: string): EpoxyWorld =>
      ({ player: { x: 0, y: 0 }, entities: [{ type, x: PLATE_X, y: ROW_Y }] }) as unknown as EpoxyWorld;
    for (const type of [...PRESSING_MONSTERS, ...FLYING_MONSTERS]) {
      expect(isButtonPressed(worldWith(type), PLATE_X, ROW_Y)).toBe(true);
    }
  });
});
