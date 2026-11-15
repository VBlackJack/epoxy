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
 * CC2 engine: an empty clone machine bars only the real player, the dirt block and the typical monsters (Lexy cloner blocks_collision,
 * tiletypes.js:1693; monster_typical, defs.js:104-107): a rolling ball or a rover enters it and becomes its template. An occupied
 * machine is judged by its occupant: the ball kills it and blows up.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { canMonsterEnter } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BALL_X = 4;
const CLONER_X = BALL_X + 1;
const SPAWN_X = CLONER_X + 1;
const BUTTON_X = 9;
const BUTTON_Y = 8;
const ROLL_TICKS = 30;
const BALL = 'rolling_ball';
const ROVER = 'rover';
const TEMPLATE = 'bug';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A monster of `type` facing east next to a clone machine, with `extra` placed on the machine itself. */
function load(mode: RoomMode, type: string, onCloner: string[] = []): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${CLONER_X},${ROOM_ROW}`]: 'clone_machine', [`${BUTTON_X},${BUTTON_Y}`]: 'button_red' },
      entities: [{ type, x: BALL_X, y: ROOM_ROW, dir: 'E' }, ...onCloner.map((t) => ({ type: t, x: CLONER_X, y: ROOM_ROW, dir: 'E' as const }))]
    })
  );
  return engine;
}

const onCloner = (engine: GameEngine) => world(engine).entities.filter((e) => e.x === CLONER_X && e.y === ROOM_ROW);

describe('an empty clone machine', () => {
  it('admits a rolling ball and a rover, which become its template (tiletypes.js:1693, defs.js:104-107)', () => {
    for (const type of [BALL, ROVER]) {
      const engine = load('cc2', type);
      const mover = world(engine).entities.find((e) => e.type === type);
      expect(canMonsterEnter(world(engine), mover!, 'E')).toBe(true);
    }
  });

  it('bars a typical monster, as before', () => {
    const engine = load('cc2', 'bug');
    const bug = world(engine).entities.find((e) => e.type === 'bug');
    expect(canMonsterEnter(world(engine), bug!, 'E')).toBe(false);
  });

  it('a rolling ball that rolls into it stays there and is cloned by the red button', () => {
    const engine = load('cc2', BALL);
    for (let i = 0; i < ROLL_TICKS && onCloner(engine).length === 0; i++) engine.tick();
    const template = onCloner(engine)[0];
    expect(template?.type).toBe(BALL);
    (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_X, BUTTON_Y, 'trigger_cloner');
    expect(world(engine).entities.some((e) => e.type === BALL && e.x === SPAWN_X)).toBe(true);
    expect(onCloner(engine).some((e) => e.type === BALL)).toBe(true);
  });

  it('is not entered by a ball on a classic-rules level', () => {
    const engine = load('cc', BALL);
    const ball = world(engine).entities.find((e) => e.type === BALL);
    expect(canMonsterEnter(world(engine), ball!, 'E')).toBe(false);
  });
});

describe('an occupied clone machine', () => {
  it('has its template killed and gone when a ball rolls in, and the ball blows up', () => {
    const engine = load('cc2', BALL, [TEMPLATE]);
    for (let i = 0; i < ROLL_TICKS && world(engine).entities.some((e) => e.type === BALL); i++) engine.tick();
    expect(world(engine).entities.some((e) => e.type === BALL)).toBe(false);
    expect(world(engine).entities.some((e) => e.type === TEMPLATE)).toBe(false);
    expect(onCloner(engine)).toHaveLength(0);
  });
});
