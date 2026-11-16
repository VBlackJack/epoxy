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
 * CC2 engine, review fixes of wave 13: a block or monster that enters a clone machine runs the step that brought it in out
 * (Lexy attempt_step returns false while movement_cooldown > 0, game.js:2153-2156), so the machine cannot clone it mid-step and a
 * later release finds it at rest; a block that slides into an occupied machine is refused and the template stays (fire_ice shape,
 * tiletypes.js:1700-1702).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement } from '../types';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
const SLIDE_TICKS = 40;
const PLAYER_X = 2;
const BLOCK_X = 3;
const CLONER_X = 4;
const BEYOND_X = 5;
/** The slide leaves the four ice cells at BEYOND_X..BEYOND_X+3 and stops on the floor after them. */
const ICE_END_X = BEYOND_X + 4;
const ICE_BLOCK = 'ice_block';
const CLONER = 'clone_machine';
const ICE = 'ice';
const RED_BUTTON = 'button_red';
const BUTTON_CELL = { x: 9, y: 9 };

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const press = (engine: GameEngine): void => {
  (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_CELL.x, BUTTON_CELL.y, 'trigger_cloner');
};
const blocksAt = (engine: GameEngine, x: number) => engine.getEntities().filter((e) => e.kind === 'block' && e.x === x && e.y === ROOM_ROW);

function waitForMove(engine: GameEngine): void {
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
}

/** The player pushes the block at BLOCK_X east into the clone machine at CLONER_X; `iceBeyond` lays ice on the exit cells. */
function pushIntoCloner(iceBeyond: boolean, extra: EntityPlacement[] = []): GameEngine {
  const terrain: Record<string, string> = { [`${CLONER_X},${ROOM_ROW}`]: CLONER, [`${BUTTON_CELL.x},${BUTTON_CELL.y}`]: RED_BUTTON };
  if (iceBeyond) for (let x = BEYOND_X; x < BEYOND_X + 4; x++) terrain[`${x},${ROOM_ROW}`] = ICE;
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode: 'cc2', startX: PLAYER_X, terrain, entities: [{ type: ICE_BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }, ...extra] })
  );
  waitForMove(engine);
  engine.attemptPlayerMove('E');
  return engine;
}

describe('CC2 engine: the step of a block that entered a clone machine runs out', () => {
  // Fails without the finishClonerOccupantStep line: the pushed block keeps arrivalTicks for good and the machine never fires.
  it('a block pushed in loses its arrival step, then the machine clones it', () => {
    const engine = pushIntoCloner(false);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    const template = engine.getEntities().find((e) => e.x === CLONER_X && e.y === ROOM_ROW);
    expect(template?.arrivalTicks).toBeUndefined();
    press(engine);
    expect(blocksAt(engine, BEYOND_X)).toHaveLength(1);
  });

  // Fails without the refusal in spawnFromClonerOneWay (Lexy attempt_step, game.js:2153-2156).
  it('a press in the middle of that step clones nothing', () => {
    const engine = pushIntoCloner(false);
    let seen = false;
    for (let i = 0; i < SETTLE_TICKS && !seen; i++) {
      const occupant = engine.getEntities().find((e) => e.x === CLONER_X && e.y === ROOM_ROW);
      if (occupant?.arrivalTicks !== undefined || (occupant !== undefined && occupant.cooldownTicks > 0)) seen = true;
      else engine.tick();
    }
    expect(seen).toBe(true);
    press(engine);
    expect(blocksAt(engine, BEYOND_X)).toHaveLength(0);
    expect(world(engine).entities.filter((e) => e.kind === 'block')).toHaveLength(1);
  });

  it('an ice block pushed in and released onto ice slides on, and settles once', () => {
    const engine = pushIntoCloner(true);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    press(engine);
    for (let i = 0; i < SLIDE_TICKS; i++) engine.tick();
    const blocks = engine.getEntities().filter((e) => e.kind === 'block');
    expect(blocks.map((e) => e.x).sort((a, b) => a - b)).toEqual([CLONER_X, ICE_END_X]);
    expect(blocks.every((e) => e.arrivalTicks === undefined)).toBe(true);
  });
});

describe('CC2 engine: a block that slides into an occupied clone machine', () => {
  // Lexy: the machine holds its template against the block (tiletypes.js:1700-1702); fire_ice shape (an ice template), the slide path
  // (slidePushesAhead). Fails without the clone machine line of canBeShoved: the slide would shove the template out onto the cell beyond.
  it('is refused, and the template stays', () => {
    const terrain = { [`${CLONER_X},${ROOM_ROW}`]: CLONER, [`${BLOCK_X},${ROOM_ROW}`]: ICE };
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: 1,
        terrain,
        entities: [
          { type: ICE_BLOCK, x: CLONER_X, y: ROOM_ROW, dir: 'E' },
          { type: ICE_BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }
        ]
      })
    );
    const templateUid = blocksAt(engine, CLONER_X)[0].uid;
    const slider = blocksAt(engine, BLOCK_X)[0];
    slider.isSliding = true;
    slider.dir = 'E';
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(blocksAt(engine, CLONER_X)).toHaveLength(1);
    expect(blocksAt(engine, CLONER_X)[0].uid).toBe(templateUid);
    expect(engine.getEntities().filter((e) => e.kind === 'block')).toHaveLength(2);
    expect(blocksAt(engine, BEYOND_X)).toHaveLength(0);
  });
});
