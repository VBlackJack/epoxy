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
 * CC2 wave 14, the monster half of the frame model: a monster on a force floor whose forced step was refused retries it in the
 * frame pre-pass (Lexy frames 0 and 1 make forced decisions, game.js:869-888 and 1702-1720; ftrace MAP137 t480-t484), and the
 * pre-pass runs inside the open entity pass (map045: a fireball cloned by a block that lands in frame 0 steps at t1545).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const FORCE_SOUTH = 'v';
const FORCED_X = 2;
const FORCED_Y = 1;
const BELOW_Y = 2;
const NEIGHBOUR_X = 1;

type Mode = 'cc2' | 'native';

interface Fixture {
  engine: GameEngine;
  w: EpoxyWorld;
}

/**
 * A paramecium on a force floor facing south with the cell below it free, and a fireball next to that cell heading into it.
 * The fireball is listed last, so the main pass decides it first: without the pre-pass it takes the cell.
 */
function load(mode: Mode): Fixture {
  const built = buildTestLevel(['#####', `#.${FORCE_SOUTH}..#`, '#...@#', '#####'], {
    entities: [
      { type: 'paramecium', x: FORCED_X, y: FORCED_Y, dir: 'S' as Direction },
      { type: 'fireball', x: NEIGHBOUR_X, y: BELOW_Y, dir: 'E' as Direction }
    ]
  });
  const level: CompiledLevel = mode === 'cc2' ? { ...built, cc2: CC2_RECORD } : built;
  const engine = new GameEngine();
  engine.loadLevel(level);
  return { engine, w: (engine as unknown as { w: EpoxyWorld }).w };
}

const find = (w: EpoxyWorld, type: string): RuntimeEntity => w.entities.find((e) => e.type === type) as RuntimeEntity;

describe('CC2 monster retry on a force floor in the frame pre-pass', () => {
  // MAP137 t480-t484: the paramecium enters in frame 0, before the neighbour's decision of frame 2.
  it('enters the freed cell before a neighbour decides in the main pass', () => {
    const { engine, w } = load('cc2');
    engine.tick();
    const para = find(w, 'paramecium');
    expect(para.x).toBe(FORCED_X);
    expect(para.y).toBe(BELOW_Y);
  });

  it('does not on a native level: the neighbour decides first and takes the cell', () => {
    const { engine, w } = load('native');
    engine.tick();
    expect(find(w, 'paramecium').y).toBe(FORCED_Y);
  });

  it('a monster that took its forced step in the pre-pass is not stepped again in the main pass', () => {
    const { engine, w } = load('cc2');
    engine.tick();
    expect(find(w, 'paramecium').cc2PrePassMoved).toBeUndefined();
    expect(find(w, 'paramecium').y).toBe(BELOW_Y);
  });

  it('a monster that just arrived on a force floor does not retry early', () => {
    const { engine, w } = load('cc2');
    const para = find(w, 'paramecium');
    // It stepped onto the floor in the pass that just ran: its first forced try is the decisions of the coming tick.
    para.stepEndedPass = w.ccMonsterClock;
    engine.tick();
    expect(find(w, 'paramecium').y).toBe(FORCED_Y);
  });
});

const BUTTON_X = 6;
const BUTTON_Y = 6;
const CLONER_X = 3;
const CLONER_Y = 9;
const PLAYER_START_X = 10;
/** Lexy releases the clone at t1541 frame 0 and steps it at t1545: the wait read in the open pass (ftrace map045). */
const OPEN_PASS_COOLDOWN = 3;

/** A dirt block whose held plain step ends in frame 0 of the coming tick, on a red button wired to a fireball cloner. */
function loadButtonBlock(mode: RoomMode): GameEngine {
  const level = room({
    mode,
    startX: PLAYER_START_X,
    terrain: { [`${BUTTON_X},${BUTTON_Y}`]: 'button_red', [`${CLONER_X},${CLONER_Y}`]: 'clone_machine' },
    entities: [
      { type: 'fireball', x: CLONER_X, y: CLONER_Y, dir: 'E' },
      { type: 'dirt_block', x: BUTTON_X, y: BUTTON_Y, dir: 'E' }
    ]
  });
  level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: BUTTON_Y, clonerX: CLONER_X, clonerY: CLONER_Y, templateType: 'fireball', templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  const block = engine.getEntities().find((e) => e.type === 'dirt_block') as RuntimeEntity;
  block.arrivalTicks = 1;
  block.cc2ArrivalWait = 1;
  block.cc2ArrivalFrame = 0;
  return engine;
}

const cloneOf = (engine: GameEngine): RuntimeEntity | undefined =>
  engine.getEntities().find((e) => e.type === 'fireball' && e.x === CLONER_X + 1 && e.y === CLONER_Y);

describe('the frame pre-pass runs inside the open entity pass (map045 shape)', () => {
  it('a fireball cloned by a block that lands in frame 0 on a red button gets the wait of the open pass', () => {
    const engine = loadButtonBlock('cc2');
    engine.tick();
    expect(cloneOf(engine)?.cooldownTicks).toBe(OPEN_PASS_COOLDOWN);
  });
});
