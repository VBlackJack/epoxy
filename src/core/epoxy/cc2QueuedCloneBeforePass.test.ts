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
 * CC2 engine: a clone button pressed by a monster whose queued arrival is applied at the start of the entity pass closes the
 * previous tick, so the clone it lets out waits one tick longer. Other levels keep the wait they always had.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const PLAYER_X = 10;
const BUTTON_X = 3;
const CLONER_X = 7;
const CLONER_Y = 8;
const SPAWN_X = CLONER_X + 1;
const PRESSER_TYPE = 'bug';
const CLONE_TYPE = 'bouncer';
/** The cooldown of the presser: it stays on the button for the whole run. */
const PRESSER_COOLDOWN = 50;
/** The extra wait of a clone let out by a press applied at the start of the pass. */
const BEFORE_PASS_TICKS = 1;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A monster stands on a clone button with its press already due: the next tick applies it at the start of its pass. */
function wait(mode: RoomMode): number {
  const level = room({
    mode,
    startX: PLAYER_X,
    terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_red', [`${CLONER_X},${CLONER_Y}`]: 'clone_machine' },
    entities: [
      { type: CLONE_TYPE, x: CLONER_X, y: CLONER_Y, dir: 'E' },
      { type: PRESSER_TYPE, x: BUTTON_X, y: ROOM_ROW, dir: 'E' }
    ]
  });
  level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, clonerX: CLONER_X, clonerY: CLONER_Y, templateType: CLONE_TYPE, templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = world(engine);
  const presser = w.entities.find((e) => e.type === PRESSER_TYPE);
  if (presser === undefined) throw new Error('presser missing');
  presser.cooldownTicks = PRESSER_COOLDOWN;
  w.ccArrivals.push({ uid: presser.uid, x: BUTTON_X, y: ROOM_ROW, action: 'trigger_cloner', due: w.ccMonsterClock });
  engine.tick();
  const clone = engine.getEntities().find((e) => e.type === CLONE_TYPE && e.x === SPAWN_X && e.y === CLONER_Y);
  expect(clone).toBeDefined();
  expect(w.cc2BeforePass).toBeUndefined();
  return clone?.cooldownTicks ?? Number.NaN;
}

describe('CC2 engine: a clone let out by a queued press at the start of the pass', () => {
  it('waits one tick longer than the same clone on a classic level', () => {
    expect(wait('cc2')).toBe(wait('cc') + BEFORE_PASS_TICKS);
  });

  it('leaves a classic level with the plain wait of a clone made outside the pass', () => {
    expect(wait('cc')).toBeGreaterThan(0);
  });
});
