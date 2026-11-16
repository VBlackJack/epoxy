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
 * CC2 engine: a monster a bomb kills still presses the button under it (Lexy step_on_cell walks every layer, game.js:2316-2365; the
 * bomb kills in on_stand, tiletypes.js:1161-1180, and the terrain's on_arrive still runs). The press is a queued action arrival flagged
 * afterRemoval at the removal's due: it takes the normal action path (green toggles after the pass) and is never pressed inside the
 * removal branch nor on the input-time path. Partial: buttons only (yellow button, light switch or pulse, hold trap are not modelled).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { applyDueHazardRemovals } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const GLIDER_X = 4;
const BUTTON_X = GLIDER_X + 1;
const WALL_X = 9;
const WALL_Y = 3;
const SETTLE_TICKS = 30;
const GLIDER = 'glider';
const BOMB = 'bomb';
/** A button of a colour channel (Lexy gray button) and the wall it toggles, closed to start with. */
const CHANNEL_BUTTON = 'toggle_button_red';
const CHANNEL_WALL = 'toggle_wall_red_closed';
const CHANNEL_WALL_OPEN = 'toggle_wall_red_open';
const GREEN_BUTTON = 'button_green';
const GREEN_WALL = 'toggle_wall_closed';
const GREEN_WALL_OPEN = 'toggle_wall_open';
/** A red button (it fires the clone machine that holds a template) and the machine, with the cell its clone comes out in. */
const RED_BUTTON = 'button_red';
const CLONER = 'clone_machine';
const CLONER_CELL = { x: 7, y: 9 };
const CLONE_CELL = { x: 8, y: 9 };
const TEMPLATE = 'dirt_block';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const wallState = (engine: GameEngine): string => world(engine).terrain[WALL_Y][WALL_X];
const gliderGone = (engine: GameEngine): boolean => !world(engine).entities.some((e) => e.type === GLIDER);

/** A glider facing east, a bomb on the button in the next cell and a wall the button toggles. */
function load(mode: RoomMode, button: string, wall: string, withCloner = false): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: button, [`${WALL_X},${WALL_Y}`]: wall, ...(withCloner ? { [`${CLONER_CELL.x},${CLONER_CELL.y}`]: CLONER } : {}) },
      items: { [`${BUTTON_X},${ROOM_ROW}`]: BOMB },
      entities: [{ type: GLIDER, x: GLIDER_X, y: ROOM_ROW, dir: 'E' }, ...(withCloner ? [{ type: TEMPLATE, x: CLONER_CELL.x, y: CLONER_CELL.y, dir: 'E' as const }] : [])]
    })
  );
  return engine;
}

/** Ticks until the glider is gone; returns the tick count (SETTLE_TICKS when it never went). */
function untilGone(engine: GameEngine): number {
  let ticks = 0;
  while (!gliderGone(engine) && ticks < SETTLE_TICKS) {
    engine.tick();
    ticks++;
  }
  return ticks;
}

describe('a monster killed by a bomb on a button', () => {
  it('presses a button of a colour channel (Lexy game.js:2316-2365)', () => {
    const engine = load('cc2', CHANNEL_BUTTON, CHANNEL_WALL);
    expect(untilGone(engine)).toBeLessThan(SETTLE_TICKS);
    engine.tick();
    expect(wallState(engine)).toBe(CHANNEL_WALL_OPEN);
  });

  it('toggles a green button after the pass, not before the monster is gone', () => {
    const engine = load('cc2', GREEN_BUTTON, GREEN_WALL);
    let ticks = 0;
    while (!gliderGone(engine) && ticks < SETTLE_TICKS) {
      // While the monster stands on the bomb cell its step has not ended: the wall is still closed.
      expect(wallState(engine)).toBe(GREEN_WALL);
      engine.tick();
      ticks++;
    }
    expect(ticks).toBeLessThan(SETTLE_TICKS);
    // The toggle belongs to the same pass as the removal (the green toggle is applied after it), never earlier.
    expect(wallState(engine)).toBe(GREEN_WALL_OPEN);
  });

  // The red button works the clone machine: the template is cloned out once the removal is applied and the press has run.
  it('presses a red button, which clones the template of a machine (Lexy game.js:2316-2365)', () => {
    const engine = load('cc2', RED_BUTTON, CHANNEL_WALL, true);
    const cloned = (): boolean => world(engine).entities.some((e) => e.type === TEMPLATE && e.x === CLONE_CELL.x && e.y === CLONE_CELL.y);
    expect(cloned()).toBe(false);
    expect(untilGone(engine)).toBeLessThan(SETTLE_TICKS);
    engine.tick();
    expect(cloned()).toBe(true);
  });

  // The green button toggles after the pass: with the removal applied at the start of the pass, the wall is still closed, and it opens
  // only when the pass has run (game.js:2316-2365, the green toggle is applied after the pass).
  it('toggles a green button only after the pass that applied the removal', () => {
    const engine = load('cc2', GREEN_BUTTON, GREEN_WALL);
    const w = world(engine);
    let ticks = 0;
    while (!w.ccArrivals.some((a) => a.afterRemoval === true) && ticks < SETTLE_TICKS) {
      engine.tick();
      ticks++;
    }
    for (const arrival of w.ccArrivals) arrival.due = w.ccMonsterClock;
    applyDueHazardRemovals((engine as unknown as { ctx: EpoxyContext }).ctx);
    expect(gliderGone(engine)).toBe(true);
    expect(wallState(engine)).toBe(GREEN_WALL);
    engine.tick();
    expect(wallState(engine)).toBe(GREEN_WALL_OPEN);
  });

  // Fails without the applied-removal record: a monster that still stands (its removal void) must not press the button under it.
  it('presses nothing when the monster still stands after the removal came due', () => {
    const engine = load('cc2', CHANNEL_BUTTON, CHANNEL_WALL);
    const w = world(engine);
    let ticks = 0;
    while (!w.ccArrivals.some((a) => a.afterRemoval === true) && ticks < SETTLE_TICKS) {
      engine.tick();
      ticks++;
    }
    // The removal is lost (the monster left the cell it was due in): only the queued press remains.
    w.ccArrivals = w.ccArrivals.filter((a) => a.removal === undefined);
    for (const arrival of w.ccArrivals) arrival.due = w.ccMonsterClock;
    engine.tick();
    expect(wallState(engine)).toBe(CHANNEL_WALL);
  });

  it('is not pressed at input time, when only the due removals are applied', () => {
    const engine = load('cc2', CHANNEL_BUTTON, CHANNEL_WALL);
    const w = world(engine);
    let ticks = 0;
    while (!w.ccArrivals.some((a) => a.afterRemoval === true) && ticks < SETTLE_TICKS) {
      engine.tick();
      ticks++;
    }
    expect(w.ccArrivals.some((a) => a.afterRemoval === true)).toBe(true);
    for (const arrival of w.ccArrivals) arrival.due = w.ccMonsterClock;
    applyDueHazardRemovals((engine as unknown as { ctx: EpoxyContext }).ctx);
    expect(gliderGone(engine)).toBe(true);
    expect(wallState(engine)).toBe(CHANNEL_WALL);
    expect(w.ccArrivals.some((a) => a.afterRemoval === true)).toBe(true);
  });

  it('presses nothing on a classic-rules level or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, CHANNEL_BUTTON, CHANNEL_WALL);
      untilGone(engine);
      expect(world(engine).ccArrivals.some((a) => a.afterRemoval === true)).toBe(false);
    }
  });

  it('sets the flag on the queued press only', () => {
    const engine = load('cc2', CHANNEL_BUTTON, CHANNEL_WALL);
    const w = world(engine);
    let ticks = 0;
    while (!w.ccArrivals.some((a) => a.removal === 'bomb') && ticks < SETTLE_TICKS) {
      engine.tick();
      ticks++;
    }
    const removal = w.ccArrivals.find((a) => a.removal === 'bomb');
    expect(removal).toBeDefined();
    expect('afterRemoval' in (removal as object)).toBe(false);
  });
});
