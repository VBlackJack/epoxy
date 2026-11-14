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
 * CC2 engine, wave 10 (NRJ): the cell the player steps into is judged once, before the push (Lexy attempt_step, game.js:2020-2036,
 * steam-strict emulate_spring_mining, defs.js:294-297). A popup wall the block leaves turns into a wall, and he still walks in.
 * Levels outside the CC2 engine keep the re-judge after the push.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { idleTicks, playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const START_X = 1;
const FIRST_BLOCK_X = 5;
const POPUP_WALL = 'popup_wall_cc2';
const WALL = 'wall';
const BLOCK = 'ice_block';
const SETTLE_TICKS = 12;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, entities: { type: string; x: number }[], popupX: number): GameEngine {
  const terrain: Record<string, string> = { [`${popupX},${ROOM_ROW}`]: POPUP_WALL };
  // The player slides in over ice: the decision push is skipped while he slides, so the step itself pushes the block.
  for (let x = START_X + 1; x < FIRST_BLOCK_X; x++) terrain[`${x},${ROOM_ROW}`] = 'ice';
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: START_X,
      terrain,
      entities: entities.map((e) => ({ type: e.type, x: e.x, y: ROOM_ROW, dir: 'E' as const }))
    })
  );
  return engine;
}

function slideIn(engine: GameEngine): void {
  expect(playMove(engine, 'E').accepted).toBe(true);
  idleTicks(engine, SETTLE_TICKS);
}

describe('the cell stepped into is judged once on the CC2 engine', () => {
  it('walks into a popup wall cell the pushed block left (springs t406 shape)', () => {
    const engine = load('cc2', [{ type: BLOCK, x: FIRST_BLOCK_X }], FIRST_BLOCK_X);
    slideIn(engine);
    expect(engine.getPlayer().x).toBe(FIRST_BLOCK_X);
    expect(world(engine).terrain[ROOM_ROW][FIRST_BLOCK_X]).toBe(WALL);
  });

  it('keeps the re-judge after the push outside the CC2 engine (the popup wall bars him)', () => {
    const engine = load('cc', [{ type: BLOCK, x: FIRST_BLOCK_X }], FIRST_BLOCK_X);
    slideIn(engine);
    expect(engine.getPlayer().x).toBeLessThan(FIRST_BLOCK_X);
  });

  it('keeps the re-check of a block in a push chain (the second block of the chain leaves a popup wall)', () => {
    const engine = load('cc2', [{ type: BLOCK, x: FIRST_BLOCK_X }, { type: BLOCK, x: FIRST_BLOCK_X + 1 }], FIRST_BLOCK_X + 1);
    slideIn(engine);
    // The first block is not carried into the cell the second left as a wall, so it stays and the player stays behind it.
    const first = world(engine).entities.filter((e) => e.kind === 'block').map((e) => e.x).sort((a, b) => a - b)[0];
    expect(first).toBe(FIRST_BLOCK_X);
    expect(engine.getPlayer().x).toBeLessThan(FIRST_BLOCK_X);
  });
});
