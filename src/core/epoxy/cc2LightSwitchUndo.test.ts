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
 * CC2 engine, actor order: an input given after the player's step onto a light switch has ended flips the switch (the step end
 * is flushed by the input), but the wires settled before the pass of that tick still read the switch as it was when the last
 * tick ended. A snapshot taken at that input (the undo of the stored input, or any captureState) has to keep that form of the
 * switch: rebuilt from the terrain, it reads the flipped switch, and the wired purple wall opens a tick early.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const SWITCH_OFF = 'toggle_switch_off';
const SWITCH_ON = 'toggle_switch_on';
const PURPLE_WALL = 'purple_wall';
const WALL_X = 3;
const SWITCH_X = 4;
const START_X = 5;
const MAX_TICKS = 40;
const FOLLOW_TICKS = 12;

function level(): CompiledLevel {
  const base = room({
    mode: 'cc2',
    startX: START_X,
    dir: 'W',
    terrain: { [`${WALL_X},${ROOM_ROW}`]: PURPLE_WALL, [`${SWITCH_X},${ROOM_ROW}`]: SWITCH_OFF }
  });
  return { ...base, signalLinks: [{ fromX: SWITCH_X, fromY: ROOM_ROW, toX: WALL_X, toY: ROOM_ROW }] };
}

function load(): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level());
  return engine;
}

function waitOut(engine: GameEngine): void {
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
}

/** Steps onto the switch, waits the step out, then gives the input that flushes the step end (the switch flips). */
function standOnSwitchAndPress(engine: GameEngine, dir: Direction): void {
  engine.attemptPlayerMove('W');
  engine.tick();
  waitOut(engine);
  expect(engine.getPlayer().x).toBe(SWITCH_X);
  expect(engine.attemptPlayerMove(dir)).toBe(true);
}

/** What the next ticks show: the player's cell and the wall cell after each. */
function follow(engine: GameEngine): string[] {
  const seen: string[] = [];
  for (let t = 0; t < FOLLOW_TICKS; t++) {
    engine.tick();
    seen.push(`${engine.getPlayer().x},${engine.getPlayer().y} ${engine.getTerrain()[ROOM_ROW][WALL_X]}`);
  }
  return seen;
}

describe('CC2 engine: a snapshot keeps the light switches as the last tick ended', () => {
  it('the input flips the switch, and the snapshot taken then still holds its form of the tick end', () => {
    const engine = load();
    standOnSwitchAndPress(engine, 'W');
    expect(engine.getTerrain()[ROOM_ROW][SWITCH_X]).toBe(SWITCH_ON);
    expect(engine.captureState().lightSwitchBase).toEqual([[ROOM_ROW * engine.getTerrain()[0].length + SWITCH_X, SWITCH_OFF]]);
  });

  it('a capture and restore right after that input changes nothing of the ticks that follow', () => {
    const straight = load();
    standOnSwitchAndPress(straight, 'W');
    const roundTrip = load();
    standOnSwitchAndPress(roundTrip, 'W');
    roundTrip.restoreState(roundTrip.captureState());
    expect(follow(roundTrip)).toEqual(follow(straight));
  });

  it('undoing that input and giving it again reaches the state a straight run reaches', () => {
    const straight = load();
    standOnSwitchAndPress(straight, 'W');
    const redone = load();
    standOnSwitchAndPress(redone, 'W');
    expect(redone.undo()).toBe(true);
    expect(redone.attemptPlayerMove('W')).toBe(true);
    expect(follow(redone)).toEqual(follow(straight));
  });
});
