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
import { flipWiredCellAt } from './epoxyDevices';
import type { EpoxyContext } from './epoxyWorld';

const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const OLD_JET_OFF = 'flame_jet_off';
const OLD_JET_ON = 'flame_jet_on';
const PLATE = 'signal_plate';
const ORANGE = 'button_orange';
const GRAY_AREA = 'button_gray_area';
const SIZE = 13;
const MAX_WAIT_TICKS = 40;
const TIME_LIMIT_SECONDS = 200;
const STILL_COOLDOWN_TICKS = 100000;
const MONSTER_WAIT_TICKS = 80;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
const JET = { x: 6, y: 5 };

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[Cell, string]>;
  entities?: CompiledLevel['entities'];
  player?: Cell;
  signalLinks?: SignalLink[];
}

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  return {
    id: 'flame_jets_cc2_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? START), dir: 'E' },
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

const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;
const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];

beforeEach(() => {
  loadTestConfigs();
});

describe('flame jets of Chip\'s Challenge 2: wired toggling', () => {
  const wired = (extra: Setup = {}): CompiledLevel =>
    room({ terrain: [[SOURCE, PLATE], [JET, JET_OFF]], signalLinks: [link(SOURCE, JET)], ...extra });

  it('toggles on a press and again on a release of a held source', () => {
    const engine = load(wired());
    expect(tileAt(engine, JET)).toBe(JET_OFF);
    step(engine, 'E');
    expect(tileAt(engine, JET)).toBe(JET_ON);
    step(engine, 'W');
    expect(tileAt(engine, JET)).toBe(JET_OFF);
    step(engine, 'E');
    expect(tileAt(engine, JET)).toBe(JET_ON);
  });

  it('is not touched by the global flame toggle, which still flips the classic jets', () => {
    const classic = { x: 6, y: 8 };
    const level = room({
      terrain: [
        [SOURCE, ORANGE],
        [JET, JET_OFF],
        [{ x: 6, y: 6 }, JET_ON],
        [classic, OLD_JET_OFF]
      ]
    });
    const engine = load(level);
    step(engine, 'E');
    expect(tileAt(engine, classic)).toBe(OLD_JET_ON);
    expect(tileAt(engine, JET)).toBe(JET_OFF);
    expect(tileAt(engine, { x: 6, y: 6 })).toBe(JET_ON);
  });

  it('burns a monster standing on it when it lights', () => {
    const engine = load(wired({ entities: [{ type: 'pink_ball', x: JET.x, y: JET.y, dir: 'E' }] }));
    for (const entity of engine.getEntities()) entity.cooldownTicks = STILL_COOLDOWN_TICKS;
    step(engine, 'E');
    expect(tileAt(engine, JET)).toBe(JET_ON);
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('burns the player standing on it when it lights, unless the fire boots are worn', () => {
    const bare = load(wired({ player: JET }));
    flipWiredCellAt(contextOf(bare), JET.x, JET.y);
    expect(tileAt(bare, JET)).toBe(JET_ON);
    expect(bare.getPlayer().alive).toBe(false);
    const shod = load(wired({ player: JET }));
    shod.getPlayer().boots.add('boots_fire');
    flipWiredCellAt(contextOf(shod), JET.x, JET.y);
    expect(shod.getPlayer().alive).toBe(true);
  });

  it('kills a monster that walks into a lit jet', () => {
    const level = room({
      terrain: [[JET, JET_ON]],
      entities: [{ type: 'pink_ball', x: JET.x - 2, y: JET.y, dir: 'E' }],
      player: { x: 1, y: 1 }
    });
    const engine = load(level);
    for (let i = 0; i < MONSTER_WAIT_TICKS && engine.getEntities().length > 0; i++) engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('kills a player who walks into a lit jet, and spares one in fire boots', () => {
    const level = room({ terrain: [[{ x: START.x + 1, y: START.y }, JET_ON]] });
    const engine = load(level);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
    const shod = load(level);
    shod.getPlayer().boots.add('boots_fire');
    step(shod, 'E');
    expect(shod.getPlayer().alive).toBe(true);
  });
});

describe('flame jets of Chip\'s Challenge 2: the gray area button', () => {
  const BUTTON = { x: 3, y: 5 };
  /** Within the 5 by 5 square of the button. */
  const NEAR = { x: 5, y: 5 };
  const NEAR_LIT = { x: 5, y: 6 };

  it('flips an unwired jet within reach and burns what stands on it', () => {
    const engine = load(
      room({
        terrain: [[BUTTON, GRAY_AREA], [NEAR, JET_OFF], [NEAR_LIT, JET_ON]],
        entities: [{ type: 'pink_ball', x: NEAR.x, y: NEAR.y, dir: 'E' }]
      })
    );
    for (const entity of engine.getEntities()) entity.cooldownTicks = STILL_COOLDOWN_TICKS;
    step(engine, 'E');
    expect(tileAt(engine, NEAR)).toBe(JET_ON);
    expect(tileAt(engine, NEAR_LIT)).toBe(JET_OFF);
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('flips a wired jet once, and the wire follows the next change', () => {
    const idle = { x: 11, y: 11 };
    const engine = load(
      room({ terrain: [[BUTTON, GRAY_AREA], [idle, PLATE], [NEAR, JET_OFF]], signalLinks: [link(idle, NEAR)] })
    );
    step(engine, 'E');
    expect(tileAt(engine, NEAR)).toBe(JET_ON);
    step(engine, 'E');
    step(engine, 'W');
    expect(tileAt(engine, NEAR)).toBe(JET_OFF);
  });
});
