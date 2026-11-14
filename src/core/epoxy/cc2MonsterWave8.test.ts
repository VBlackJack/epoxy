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
 * CC2 wave 8, monsters: a monster works a brown button when its step onto it ends (MB), every actor works a light switch when
 * its step ends, a flyer included (FP, FP2), a hint bars the monsters but the ghost (HT), lit dynamite bars every monster (LD),
 * and a ghost stops at the cells the import lists (GC2). Every rule is off on classic and native levels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const BALL = 'pink_ball';
const BROWN_BUTTON = 'button_brown';
const TRAP = 'trap';
const BUTTON_X = 5;
const TRAP_X = 9;
const TRAP_Y = 3;
const PRESSER_START_X = 4;
const STEP_TICKS = 4;

const ballWhere = (engine: GameEngine, pick: (e: RuntimeEntity) => boolean): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === BALL && pick(e));
  if (found === undefined) throw new Error('the room has the ball');
  return found;
};

/** A pink ball walks east onto a brown button; a second one sits in the linked trap facing south. Returns the trapped ball's row after each tick. */
function trappedRows(mode: RoomMode, trappedFirst: boolean, ticks: number): { rows: number[]; closed: boolean[] } {
  const presser = { type: BALL, x: PRESSER_START_X, y: ROOM_ROW, dir: 'E' as const };
  const trapped = { type: BALL, x: TRAP_X, y: TRAP_Y, dir: 'S' as const };
  const level = room({
    mode,
    startX: 1,
    terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BROWN_BUTTON, [`${TRAP_X},${TRAP_Y}`]: TRAP },
    entities: trappedFirst ? [trapped, presser] : [presser, trapped]
  });
  level.trapLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  const rows: number[] = [];
  const closed: boolean[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    rows.push(ballWhere(engine, (e) => e.x === TRAP_X).y);
    closed.push(engine.isCellClosedTrap(TRAP_X, TRAP_Y));
  }
  return { rows, closed };
}

describe('CC2 engine: a monster works a brown button when its step onto it ends (MB)', () => {
  for (const trappedFirst of [true, false]) {
    it(`frees the trapped monster in the pass after the presser's step end although the presser walks on (trapped listed ${trappedFirst ? 'first' : 'last'})`, () => {
      const { rows } = trappedRows('cc2', trappedFirst, STEP_TICKS + 1);
      // The trap stays shut while the step onto the button runs; the monster leaves in the pass after the step ended.
      expect(rows.slice(0, STEP_TICKS)).toEqual(Array(STEP_TICKS).fill(TRAP_Y));
      expect(rows[STEP_TICKS]).toBe(TRAP_Y + 1);
    });
  }

  it('pins the late-entry case as a known gap: Lexy frees the trapped monster when the presser arrives, Epoxy only after its step ends', () => {
    const { closed } = trappedRows('cc2', true, STEP_TICKS);
    // Lexy: add_press on arrival frees the trapped actor out of turn. Epoxy approximates it from the pass after the step end.
    expect(closed.slice(0, STEP_TICKS - 1)).toEqual(Array(STEP_TICKS - 1).fill(true));
  });

  it('holds the button for the whole pass after the step end, then lets the trap shut when the presser has left', () => {
    const { closed } = trappedRows('cc2', true, STEP_TICKS + 1);
    expect(closed[STEP_TICKS - 1]).toBe(false);
    expect(closed[STEP_TICKS]).toBe(true);
  });

  it('leaves the classic pace unchanged: the monster is freed as soon as the presser stands on the button', () => {
    const { rows, closed } = trappedRows('cc', true, STEP_TICKS);
    expect(closed[0]).toBe(false);
    expect(rows[1]).toBe(TRAP_Y + 1);
  });

  it('leaves a native level unchanged', () => {
    const { closed } = trappedRows('native', true, STEP_TICKS + 4);
    // The native timeline, measured before the wave 8 rule: shut for five ticks, then open (no step-end record on a native level).
    expect(closed).toEqual([true, true, true, true, true, false, false, false]);
  });
});

const SWITCH_OFF = 'toggle_switch_off';
const SWITCH_ON = 'toggle_switch_on';
const SWITCH_X = 5;
const FIREBALL_START_X = 8;

/** A fireball flies west onto a light switch. Returns the tick it stands on the switch and the tick the switch flips (-1: never). */
function fireballOnSwitch(mode: RoomMode): { arrived: number; flipped: number } {
  const level = room({
    mode,
    startX: 1,
    terrain: { [`${SWITCH_X},${ROOM_ROW}`]: SWITCH_OFF },
    entities: [{ type: 'fireball', x: FIREBALL_START_X, y: ROOM_ROW, dir: 'W' }]
  });
  const engine = new GameEngine();
  engine.loadLevel(level);
  const grid = (engine as unknown as { w: { terrain: string[][] } }).w.terrain;
  let arrived = -1;
  let flipped = -1;
  for (let t = 1; t <= 30 && flipped < 0; t++) {
    engine.tick();
    const ball = engine.getEntities().find((e) => e.type === 'fireball');
    if (arrived < 0 && ball?.x === SWITCH_X) arrived = t;
    if (grid[ROOM_ROW][SWITCH_X] === SWITCH_ON) flipped = t;
  }
  return { arrived, flipped };
}

describe('CC2 engine: any actor works a light switch when its step ends (FP, FP2)', () => {
  it('a fireball toggles a light switch, and only after its step has ended', () => {
    const { arrived, flipped } = fireballOnSwitch('cc2');
    expect(arrived).toBeGreaterThan(0);
    expect(flipped).toBeGreaterThan(arrived);
  });

  it('a classic level keeps its flyer away from the switch: it never flips', () => {
    expect(fireballOnSwitch('cc').flipped).toBe(-1);
  });
});

const HINT_X = 5;
const WALK_TICKS = 40;

/** A monster of `type` walks west along the row toward a cell holding `terrain` or `item`. Returns the smallest x it reached. */
function westmostX(mode: RoomMode, type: string, cell: { terrain?: string; item?: string }): number {
  const key = `${HINT_X},${ROOM_ROW}`;
  const level = room({
    mode,
    startX: 1,
    terrain: cell.terrain === undefined ? {} : { [key]: cell.terrain },
    items: cell.item === undefined ? {} : { [key]: cell.item },
    entities: [{ type, x: FIREBALL_START_X, y: ROOM_ROW, dir: 'W' }]
  });
  const engine = new GameEngine();
  engine.loadLevel(level);
  let min = FIREBALL_START_X;
  for (let t = 0; t < WALK_TICKS; t++) {
    engine.tick();
    const mover = engine.getEntities().find((e) => e.type === type);
    if (mover !== undefined) min = Math.min(min, mover.x);
  }
  return min;
}

describe('CC2 engine: a hint bars the monsters but the ghost (HT)', () => {
  it('stops a pink ball short of the hint', () => {
    expect(westmostX('cc2', BALL, { terrain: 'hint' })).toBe(HINT_X + 1);
  });

  it('lets a ghost walk over the hint', () => {
    expect(westmostX('cc2', 'ghost', { terrain: 'hint' })).toBeLessThan(HINT_X);
  });

  it('leaves a classic level unchanged: the pink ball walks over the hint', () => {
    expect(westmostX('cc', BALL, { terrain: 'hint' })).toBeLessThan(HINT_X + 1);
  });
});
