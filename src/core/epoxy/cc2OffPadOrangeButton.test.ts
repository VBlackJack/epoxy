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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, SignalLink } from '../types';

const RED_OFF = 'teleport_red_cc2_off';
const RED_ON = 'teleport_red_cc2';
const PLATE = 'signal_plate';
const SWITCH_OFF = 'toggle_switch_off';
const ORANGE = 'button_orange_cc2';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 5;
const MONSTER_WAIT_TICKS = 120;
const TIME_LIMIT_SECONDS = 200;
const STILL_COOLDOWN_TICKS = 100000;
const START = { x: 2, y: 5 };
const PAD = { x: 5, y: 5 };
const OTHER_PAD = { x: 8, y: 3 };
const BUTTON = { x: 5, y: 8 };
const JET = { x: 9, y: 8 };

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[Cell, string]>;
  entities?: CompiledLevel['entities'];
  signalLinks?: SignalLink[];
}

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  return {
    id: 'cc2_off_pad_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks })
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

const where = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });
const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];
const tick = (engine: GameEngine, count: number): void => {
  for (let i = 0; i < count; i++) engine.tick();
};
const entityOf = (engine: GameEngine, type: string) => engine.getEntities().find((e) => e.type === type);

beforeEach(() => {
  loadTestConfigs();
});

describe('teleport_red_cc2_off: an unpowered red pad teleports its mover to itself', () => {
  const wallAfterPad: Array<[Cell, string]> = [[{ x: PAD.x + 1, y: PAD.y }, 'wall']];

  it('sends the player on one cell, out of the pad forward', () => {
    const engine = load(room({ terrain: [[PAD, RED_OFF]] }));
    step(engine, 'E');
    step(engine, 'E');
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: PAD.x + 1, y: PAD.y });
    expect(engine.getPlayer().dir).toBe('E');
  });

  it('keeps the player on the pad when the cell ahead is blocked', () => {
    const engine = load(room({ terrain: [[PAD, RED_OFF], ...wallAfterPad] }));
    step(engine, 'E');
    step(engine, 'E');
    step(engine, 'E');
    expect(where(engine)).toEqual(PAD);
  });

  it('sends a pushed block out of the pad forward', () => {
    const block = { x: PAD.x - 1, y: PAD.y };
    const engine = load(room({ terrain: [[PAD, RED_OFF]], entities: [{ type: 'dirt_block', x: block.x, y: block.y, dir: 'E' }] }));
    step(engine, 'E');
    step(engine, 'E');
    const pushed = entityOf(engine, 'dirt_block');
    expect(pushed && { x: pushed.x, y: pushed.y }).toEqual({ x: PAD.x + 1, y: PAD.y });
  });

  it('leaves a pushed block on the pad when the cell ahead is blocked', () => {
    const block = { x: PAD.x - 1, y: PAD.y };
    const engine = load(room({ terrain: [[PAD, RED_OFF], ...wallAfterPad], entities: [{ type: 'dirt_block', x: block.x, y: block.y, dir: 'E' }] }));
    step(engine, 'E');
    step(engine, 'E');
    const pushed = entityOf(engine, 'dirt_block');
    expect(pushed && { x: pushed.x, y: pushed.y }).toEqual(PAD);
  });

  it('sends a monster on one cell, out of the pad forward', () => {
    const start = { x: PAD.x - 1, y: PAD.y };
    const engine = load(room({ terrain: [[PAD, RED_OFF]], entities: [{ type: 'pink_ball', x: start.x, y: start.y, dir: 'E' }] }));
    let landed: Cell | undefined;
    for (let i = 0; i < MONSTER_WAIT_TICKS && landed === undefined; i++) {
      engine.tick();
      const ball = entityOf(engine, 'pink_ball');
      if (ball && ball.x !== start.x) landed = { x: ball.x, y: ball.y };
    }
    expect(landed).toEqual({ x: PAD.x + 1, y: PAD.y });
  });

  it('is an ordinary red ring again once a wire powers it', () => {
    const toggle = { x: 3, y: 5 };
    const engine = load(
      room({
        terrain: [[toggle, SWITCH_OFF], [PAD, RED_OFF], [OTHER_PAD, RED_OFF]],
        signalLinks: [link(toggle, PAD), link(toggle, OTHER_PAD)]
      })
    );
    step(engine, 'E');
    expect(tileAt(engine, PAD)).toBe(RED_ON);
    step(engine, 'E');
    step(engine, 'E');
    expect(where(engine)).toEqual({ x: OTHER_PAD.x + 1, y: OTHER_PAD.y });
  });
});

describe('button_orange_cc2: held by every actor on it', () => {
  const level = (button: string, entities: CompiledLevel['entities']): CompiledLevel =>
    room({ terrain: [[BUTTON, button], [JET, JET_OFF]], signalLinks: [link(BUTTON, JET)], entities });

  /** Loads the level with the actor off the button, lets the network settle, then puts the actor on the button. */
  const arrive = (button: string, type: string, sliding: boolean): GameEngine => {
    const away = { x: BUTTON.x, y: BUTTON.y + 1 };
    const engine = load(level(button, [{ type, x: away.x, y: away.y, dir: 'E' }]));
    const actor = engine.getEntities()[0];
    actor.cooldownTicks = STILL_COOLDOWN_TICKS;
    tick(engine, SETTLE_TICKS);
    actor.x = BUTTON.x;
    actor.y = BUTTON.y;
    actor.isSliding = sliding;
    tick(engine, SETTLE_TICKS);
    return engine;
  };

  it('is powered by a glider standing on it, which a plate ignores', () => {
    expect(tileAt(arrive(ORANGE, 'glider', false), JET)).toBe(JET_ON);
    expect(tileAt(arrive(PLATE, 'glider', false), JET)).toBe(JET_OFF);
  });

  it('is powered by a block sliding across it, which a plate ignores', () => {
    expect(tileAt(arrive(ORANGE, 'dirt_block', true), JET)).toBe(JET_ON);
    expect(tileAt(arrive(PLATE, 'dirt_block', true), JET)).toBe(JET_OFF);
  });

  it('still lets a resting block press a plate, as before', () => {
    expect(tileAt(arrive(PLATE, 'dirt_block', false), JET)).toBe(JET_ON);
  });
});
