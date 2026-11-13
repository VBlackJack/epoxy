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
 * CC2: a ghost holding fire boots that arrives on fire turns it into floor (Lexy fire.on_arrive); every other case leaves the fire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { GameEngine } from '../GameEngine';
import { FLOOR_TILE_ID } from '../coreConstants';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const CELL_X = 6;
const START_X = 11;
const SEED = 77;
const FIRE = 'fire';
const FIRE_BOOTS = 'boots_fire';
const FLIPPERS = 'boots_water';

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

beforeEach(() => {
  loadTestConfigs();
});

/** An engine with a ghost on a fire cell, holding the given tools; the arrival is resolved and the terrain read back. */
function arriveOnFire(mode: RoomMode, held: string[] | undefined): { engine: GameEngine; terrain: () => string } {
  const level = room({
    mode,
    startX: START_X,
    entities: [{ type: 'ghost', x: CELL_X, y: ROOM_ROW, dir: 'E' }],
    terrain: { [`${CELL_X},${ROOM_ROW}`]: FIRE }
  });
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  const entity = engine.getEntities()[0];
  if (held !== undefined) entity.heldTools = held;
  resolveMonsterArrival(contextOf(engine), entity, false);
  return { engine, terrain: () => worldOf(engine).terrain[ROOM_ROW][CELL_X] };
}

const floorOnCc2 = (): string => ConfigRegistry.getTile(FLOOR_TILE_ID).cc2Twin || FLOOR_TILE_ID;

describe('a ghost with fire boots on fire', () => {
  it('turns the fire into floor on the CC2 engine', () => {
    expect(arriveOnFire('cc2', [FIRE_BOOTS]).terrain()).toBe(floorOnCc2());
  });

  it('leaves the fire when the ghost holds no fire boots', () => {
    expect(arriveOnFire('cc2', undefined).terrain()).toBe(FIRE);
    expect(arriveOnFire('cc2', [FLIPPERS]).terrain()).toBe(FIRE);
  });

  it('leaves the fire off the CC2 engine', () => {
    expect(arriveOnFire('cc', [FIRE_BOOTS]).terrain()).toBe(FIRE);
    expect(arriveOnFire('native', [FIRE_BOOTS]).terrain()).toBe(FIRE);
  });

  it('brings the fire back when the state is restored', () => {
    const level = room({
      mode: 'cc2',
      startX: START_X,
      entities: [{ type: 'ghost', x: CELL_X, y: ROOM_ROW, dir: 'E' }],
      terrain: { [`${CELL_X},${ROOM_ROW}`]: FIRE }
    });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    engine.getEntities()[0].heldTools = [FIRE_BOOTS];
    const before = engine.captureState();
    resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
    expect(worldOf(engine).terrain[ROOM_ROW][CELL_X]).toBe(floorOnCc2());
    engine.restoreState(before);
    expect(worldOf(engine).terrain[ROOM_ROW][CELL_X]).toBe(FIRE);
  });
});
