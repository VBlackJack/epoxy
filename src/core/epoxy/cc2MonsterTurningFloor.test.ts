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
 * CC2 engine, wave 16 (MRF, MSF, MSFR): a monster refused on a turning force floor steps on the cell again at the move, which turns
 * the floor, and tries the new way at once (Lexy _possibly_bonk in the action phase, game.js:1050-1063 and 1127-1162; MAP120 t424);
 * a monster that took a slide step in pre-pass frame f keeps f for its next slide steps while a fixed or turning force floor or ice
 * carries it (game.js:869-888; MAP120 t849-t857, a paramecium forced in frame 0 keeps frame 0). Every rule is off on a level that is
 * not on the CC2 engine.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { FORCE_CYCLE_ORDER } from '../../config/constants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { cc2HiddenStateKey } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FORCE_CYCLE = 'force_cycle';
const FORCE_EAST = 'force_e';
const PARAMECIUM = 'paramecium';
const FIREBALL = 'fireball';
const DIRT_BLOCK = 'dirt_block';
const WALL = 'wall';
const PLAYER_START_X = 2;
const FLOOR_X = 5;
const AHEAD_X = FLOOR_X + 1;
const BELOW_Y = ROOM_ROW + 1;
/** Index in FORCE_CYCLE_ORDER of the south turn: the next arrival on a turning floor sends an actor south. */
const SOUTH_TURN = FORCE_CYCLE_ORDER.indexOf('S');
/** The frame the monster of the MAP120 shape takes its forced steps in. */
const FRAME_0 = 0;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const monsterOf = (engine: GameEngine, type: string): RuntimeEntity => engine.getEntities().find((e) => e.type === type) as RuntimeEntity;

interface Setup {
  terrain?: Record<string, string>;
  entities: { type: string; x: number; y: number; dir: 'E' | 'S' | 'W' | 'N' }[];
}

/** A turning force floor under a paramecium that just arrived on it (its pre-pass retry waits: the first try is the main pass). */
function load(mode: RoomMode, setup: Setup, justArrived = true): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: PLAYER_START_X, terrain: { [`${FLOOR_X},${ROOM_ROW}`]: FORCE_CYCLE, ...setup.terrain }, entities: setup.entities }));
  worldOf(engine).forceCycleTurn = SOUTH_TURN;
  const para = monsterOf(engine, PARAMECIUM);
  if (justArrived) para.stepEndedPass = worldOf(engine).ccMonsterClock;
  return engine;
}

const paramecium = (dir: 'E' | 'S' | 'W' | 'N' = 'E') => ({ type: PARAMECIUM, x: FLOOR_X, y: ROOM_ROW, dir });

describe('CC2 engine: a monster refused on a turning force floor turns it at the move (MAP120 t424)', () => {
  it('turns the floor once and goes the new way in the same tick when a wall refuses its way', () => {
    const engine = load('cc2', { terrain: { [`${AHEAD_X},${ROOM_ROW}`]: WALL }, entities: [paramecium()] });
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect([para.x, para.y]).toEqual([FLOOR_X, BELOW_Y]);
    expect(para.dir).toBe('S');
    expect(worldOf(engine).forceCycleTurn).toBe(SOUTH_TURN + 1);
  });

  it('turns the floor once and goes the new way when a block that stays refuses its way', () => {
    const engine = load('cc2', { entities: [paramecium(), { type: DIRT_BLOCK, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }] });
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect([para.x, para.y]).toEqual([FLOOR_X, BELOW_Y]);
    expect(worldOf(engine).forceCycleTurn).toBe(SOUTH_TURN + 1);
  });

  it('is two monsters, the blocker listed to move first: the second goes the floor way, no bonk (Lexy bonks at the move)', () => {
    // The fireball is listed last, so the pass moves it first: it has left the cell when the paramecium tries it.
    const engine = load('cc2', { entities: [paramecium(), { type: FIREBALL, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }] });
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect([para.x, para.y]).toEqual([AHEAD_X, ROOM_ROW]);
    expect(worldOf(engine).forceCycleTurn).toBe(SOUTH_TURN);
  });

  it('is two monsters, the blocker listed to move last: the first is refused and the floor turns it', () => {
    const engine = load('cc2', { entities: [{ type: FIREBALL, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }, paramecium()] });
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect([para.x, para.y]).toEqual([FLOOR_X, BELOW_Y]);
    expect(worldOf(engine).forceCycleTurn).toBe(SOUTH_TURN + 1);
  });

  it('does nothing on a classic-rules or a native level: the monster stays', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, { terrain: { [`${AHEAD_X},${ROOM_ROW}`]: WALL }, entities: [paramecium()] });
      engine.tick();
      const para = monsterOf(engine, PARAMECIUM);
      expect([para.x, para.y], mode).toEqual([FLOOR_X, ROOM_ROW]);
    }
  });
});

describe('CC2 engine: a monster keeps the frame of its slide steps (MAP120 t849-t857)', () => {
  /** A paramecium on a row of fixed force floors east, its first forced step free in the pre-pass of the first tick. */
  function forceRow(mode: RoomMode, extra: Setup['entities'] = []): GameEngine {
    const terrain: Record<string, string> = {};
    for (let x = FLOOR_X; x <= FLOOR_X + 5; x++) terrain[`${x},${ROOM_ROW}`] = FORCE_EAST;
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, startX: PLAYER_START_X, terrain, entities: [paramecium(), ...extra] }));
    return engine;
  }

  it('tags frame 0 after a pre-pass step, and keeps it through the following force-floor steps', () => {
    const engine = forceRow('cc2');
    const seen: (number | undefined)[] = [];
    for (let tick = 1; tick <= 6; tick++) {
      engine.tick();
      seen.push(monsterOf(engine, PARAMECIUM).cc2SlideFrame);
    }
    expect(seen).toEqual(Array(seen.length).fill(FRAME_0));
    expect(monsterOf(engine, PARAMECIUM).x).toBeGreaterThan(AHEAD_X);
  });

  it('a monster deciding at frame 2 sees the cell the tagged one left in frame 0', () => {
    // The fireball waits two ticks, then decides north into the cell the paramecium (step ended last pass, frame 0 tag) leaves.
    const engine = forceRow('cc2', [{ type: FIREBALL, x: AHEAD_X, y: BELOW_Y, dir: 'N' }]);
    monsterOf(engine, FIREBALL).cooldownTicks = 2;
    engine.tick();
    engine.tick();
    expect(monsterOf(engine, PARAMECIUM).x).toBe(AHEAD_X);
    engine.tick();
    expect(monsterOf(engine, PARAMECIUM).x).toBe(AHEAD_X + 1);
    expect(monsterOf(engine, FIREBALL).y).toBe(ROOM_ROW);
    expect(monsterOf(engine, FIREBALL).x).toBe(AHEAD_X);
  });

  it('drops the tag when the monster is no longer carried by a slide', () => {
    const engine = forceRow('cc2');
    monsterOf(engine, PARAMECIUM).cc2SlideFrame = FRAME_0;
    monsterOf(engine, PARAMECIUM).y = ROOM_ROW + 3;
    engine.tick();
    expect(monsterOf(engine, PARAMECIUM).cc2SlideFrame).toBeUndefined();
  });

  it('leaves a native level untagged', () => {
    const engine = forceRow('native');
    for (let tick = 1; tick <= 4; tick++) engine.tick();
    expect(monsterOf(engine, PARAMECIUM).cc2SlideFrame).toBeUndefined();
  });

  it('a main-pass move ends the tag', () => {
    // The fireball on the plain cell ahead (listed last: it moves first in the main pass) refuses both pre-pass frames, then leaves.
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: PLAYER_START_X,
        terrain: { [`${FLOOR_X},${ROOM_ROW}`]: FORCE_EAST },
        entities: [paramecium(), { type: FIREBALL, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }]
      })
    );
    const para = monsterOf(engine, PARAMECIUM);
    para.cc2SlideFrame = FRAME_0;
    engine.tick();
    expect(para.x).toBe(AHEAD_X);
    expect(para.cc2SlideFrame).toBeUndefined();
  });
});

describe('CC2 engine: a turning force floor carries the slide frame too (MSFR)', () => {
  it('tags the frame of a step onto a turning floor', () => {
    const engine = new GameEngine();
    const terrain = { [`${FLOOR_X},${ROOM_ROW}`]: FORCE_EAST, [`${AHEAD_X},${ROOM_ROW}`]: FORCE_CYCLE };
    engine.loadLevel(room({ mode: 'cc2', startX: PLAYER_START_X, terrain, entities: [paramecium()] }));
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect(para.x).toBe(AHEAD_X);
    expect(para.cc2SlideFrame).toBe(FRAME_0);
  });
});

describe('CC2 engine: a monster tagged with a slide frame on a turning floor still bonks in that frame', () => {
  it('turns the floor in its tagged frame 0 and goes the new way, before a blocker listed to move first in the main pass leaves', () => {
    // Lexy _possibly_bonk (game.js:1127-1162) runs in the frame of the refused step: the fireball (listed last, so first in the main
    // pass) is still ahead in frame 0, so the floor turns the paramecium south there; without the bonk it would go east.
    const engine = load('cc2', { entities: [paramecium(), { type: FIREBALL, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }] }, false);
    monsterOf(engine, PARAMECIUM).cc2SlideFrame = FRAME_0;
    engine.tick();
    const para = monsterOf(engine, PARAMECIUM);
    expect([para.x, para.y]).toEqual([FLOOR_X, BELOW_Y]);
    expect(worldOf(engine).forceCycleTurn).toBe(SOUTH_TURN + 1);
  });
});

describe('CC2 engine: a retry step off a turning floor onto a force row keeps frame 0', () => {
  it('stays tagged frame 0 over the steps along the row (MAP120 t849-t857 shape)', () => {
    const terrain: Record<string, string> = { [`${FLOOR_X},${ROOM_ROW}`]: FORCE_CYCLE };
    for (let x = AHEAD_X; x <= AHEAD_X + 5; x++) terrain[`${x},${ROOM_ROW}`] = FORCE_EAST;
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: PLAYER_START_X, terrain, entities: [paramecium()] }));
    const seen: (number | undefined)[] = [];
    for (let tick = 1; tick <= 3; tick++) {
      engine.tick();
      seen.push(monsterOf(engine, PARAMECIUM).cc2SlideFrame);
    }
    expect(monsterOf(engine, PARAMECIUM).x).toBeGreaterThan(AHEAD_X);
    expect(seen).toEqual(Array(seen.length).fill(FRAME_0));
  });
});

describe('CC2 engine: the monster slide frame is state', () => {
  it('the hidden state key differs with and without the tag', () => {
    const engine = load('cc2', { entities: [paramecium()] }, false);
    const bare = cc2HiddenStateKey(worldOf(engine));
    monsterOf(engine, PARAMECIUM).cc2SlideFrame = FRAME_0;
    const tagged = cc2HiddenStateKey(worldOf(engine));
    monsterOf(engine, PARAMECIUM).cc2SlideFrame = 1;
    const tagged1 = cc2HiddenStateKey(worldOf(engine));
    expect(new Set([bare, tagged, tagged1]).size).toBe(3);
  });

  it('an undo round trip across a frame-0 monster step replays identically', () => {
    const terrain: Record<string, string> = {};
    for (let x = FLOOR_X; x <= FLOOR_X + 5; x++) terrain[`${x},${ROOM_ROW}`] = FORCE_EAST;
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: PLAYER_START_X, terrain, entities: [paramecium()] }));
    engine.tick();
    expect(monsterOf(engine, PARAMECIUM).cc2SlideFrame).toBe(FRAME_0);
    const snap = engine.captureState();
    const key = cc2HiddenStateKey(worldOf(engine));
    const trace = (): string[] => {
      const out: string[] = [];
      for (let i = 0; i < 6; i++) {
        engine.tick();
        const m = monsterOf(engine, PARAMECIUM);
        out.push(`${m.x},${m.y},${m.cooldownTicks},${m.cc2SlideFrame ?? '-'}`);
      }
      return out;
    };
    const first = trace();
    engine.restoreState(snap);
    expect(monsterOf(engine, PARAMECIUM).cc2SlideFrame).toBe(FRAME_0);
    expect(cc2HiddenStateKey(worldOf(engine))).toBe(key);
    expect(trace()).toEqual(first);
  });
});
