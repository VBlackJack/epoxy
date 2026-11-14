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
 * CC2 wave 9, monsters: the two call sites of the player's decision and turn in the entity pass (with the per-pass sets), a
 * monster's press that lands when its step ends (MP), and a lit flame jet that burns a ghost when its step ends (FJG).
 * Every rule is off on classic and native levels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

const BALL = 'pink_ball';
const GHOST = 'ghost';
const ORANGE_BUTTON = 'button_orange';
const GREEN_BUTTON = 'button_green';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const CLASSIC_JET_OFF = 'flame_jet_off';
const WALL_CLOSED = 'toggle_wall_closed';
const FIRE_BOOTS = 'boots_fire';
const WATCHED_X = 9;
const WATCHED_Y = 3;
const BUTTON_X = 5;
const WALKER_START_X = 4;
const WATCH_TICKS = 14;
/** The 1-based tick on which the pink ball's press of a plain button lands on a classic level (two passes after the step). */
const CLASSIC_PRESS_TICK = 4;
/** The 1-based tick on which it lands on the CC2 engine: the pass after the step ended. */
const CC2_STEP_END_PRESS_TICK = 5;
const PLAYER_ORDINAL = 1;

/** The tick (1-based) on which the watched cell first differs from its start, after a pink ball walks east onto a button. */
function pressTick(mode: RoomMode, button: string, watchedStart: string): number {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: button, [`${WATCHED_X},${WATCHED_Y}`]: watchedStart },
      entities: [{ type: BALL, x: WALKER_START_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  for (let t = 1; t <= WATCH_TICKS; t++) {
    engine.tick();
    if (engine.getTerrain()[WATCHED_Y][WATCHED_X] !== watchedStart) return t;
  }
  return -1;
}

describe('CC2 engine: a monster press lands when its step ends (MP)', () => {
  it('works the orange button in the pass after the step ended', () => {
    expect(pressTick('cc2', ORANGE_BUTTON, CLASSIC_JET_OFF)).toBe(CC2_STEP_END_PRESS_TICK);
  });

  it('keeps the timing of the classic rules on a classic level', () => {
    expect(pressTick('cc', ORANGE_BUTTON, CLASSIC_JET_OFF)).toBe(CLASSIC_PRESS_TICK);
  });

  it('leaves the green button on its own timing (Lexy pending_green_toggle, after the actor pass)', () => {
    expect(pressTick('cc2', GREEN_BUTTON, WALL_CLOSED)).toBe(pressTick('cc', GREEN_BUTTON, WALL_CLOSED));
  });
});

describe('CC2 engine: a lit flame jet burns a ghost when its step ends (FJG)', () => {
  const JET_X = 5;
  const GHOST_START_X = 4;
  const STEP_TICKS = 6;

  function ghostOnJet(mode: RoomMode, jet: string, boots: boolean): { engine: GameEngine; ghost: () => RuntimeEntity | undefined } {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, startX: 1, terrain: { [`${JET_X},${ROOM_ROW}`]: jet }, entities: [{ type: GHOST, x: GHOST_START_X, y: ROOM_ROW, dir: 'E' }] }));
    const ghost = (): RuntimeEntity | undefined => engine.getEntities().find((e) => e.type === GHOST);
    if (boots) {
      const held = ghost();
      if (held === undefined) throw new Error('the room has the ghost');
      held.heldTools = [FIRE_BOOTS];
    }
    return { engine, ghost };
  }

  it('burns the ghost at its step end, not on the first tick of the step', () => {
    const { engine, ghost } = ghostOnJet('cc2', JET_ON, false);
    engine.tick();
    expect(ghost()).toBeDefined();
    for (let t = 1; t < STEP_TICKS + 2; t++) engine.tick();
    expect(ghost()).toBeUndefined();
  });

  it('spares a ghost that holds fire boots', () => {
    const { engine, ghost } = ghostOnJet('cc2', JET_ON, true);
    for (let t = 0; t < STEP_TICKS + 2; t++) engine.tick();
    expect(ghost()).toBeDefined();
  });

  it('spares a ghost on a jet that is off', () => {
    const { engine, ghost } = ghostOnJet('cc2', JET_OFF, false);
    for (let t = 0; t < STEP_TICKS + 2; t++) engine.tick();
    expect(ghost()).toBeDefined();
  });

  it('leaves the ghost alone on a classic level', () => {
    const { engine, ghost } = ghostOnJet('cc', JET_ON, false);
    for (let t = 0; t < STEP_TICKS + 2; t++) engine.tick();
    expect(ghost()).toBeDefined();
  });
});

describe('CC2 engine, actor order: the call sites of the player turn in the entity pass', () => {
  const FIRST = 0;
  const SECOND = 2;
  const THIRD = 3;

  function ordered(mode: RoomMode): { engine: GameEngine; uids: number[] } {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode,
        startX: 1,
        entities: [
          { type: BALL, x: 8, y: 2, dir: 'N' },
          { type: BALL, x: 8, y: 4, dir: 'N' },
          { type: BALL, x: 8, y: 6, dir: 'N' }
        ]
      })
    );
    const w = world(engine);
    [FIRST, SECOND, THIRD].forEach((ordinal, i) => {
      w.entities[i].listOrdinal = ordinal;
    });
    w.player.listOrdinal = PLAYER_ORDINAL;
    return { engine, uids: w.entities.map((e) => e.uid) };
  }

  it('decides and acts once per pass, at the player place: after the actors listed after him, before the ones listed before him', () => {
    const { engine, uids } = ordered('cc2');
    const w = world(engine);
    const calls: string[] = [];
    let seenAtTurn: number[] = [];
    contextOf(engine).cc2PlayerDecides = () => calls.push('decides');
    contextOf(engine).cc2PlayerActs = () => {
      calls.push('acts');
      seenAtTurn = [...(w.cc2TurnSeen ?? [])];
    };
    engine.tick();
    expect(calls).toEqual(['decides', 'acts']);
    // The pass walks the list from its end: the two actors listed after the player ran, the one before him did not yet.
    expect(seenAtTurn).toEqual([uids[2], uids[1]]);
  });

  it('calls both hooks once on a list the player heads, after the last actor', () => {
    const { engine } = ordered('cc2');
    const w = world(engine);
    w.player.listOrdinal = -1;
    const calls: string[] = [];
    contextOf(engine).cc2PlayerDecides = () => calls.push('decides');
    contextOf(engine).cc2PlayerActs = () => calls.push('acts');
    engine.tick();
    expect(calls).toEqual(['decides', 'acts']);
  });

  it('does not call the hooks on a classic level', () => {
    const { engine } = ordered('cc');
    const calls: string[] = [];
    contextOf(engine).cc2PlayerDecides = () => calls.push('decides');
    contextOf(engine).cc2PlayerActs = () => calls.push('acts');
    for (let t = 0; t < 3; t++) engine.tick();
    expect(calls).toEqual([]);
  });

  it('clears the per-pass sets when the pass ends', () => {
    const { engine } = ordered('cc2');
    engine.tick();
    expect(world(engine).cc2TurnSeen).toBeUndefined();
    expect(world(engine).cc2SkipTurn).toBeUndefined();
  });

  it('skips the entities of cc2SkipTurn for the rest of the pass', () => {
    const control = ordered('cc2');
    const skipping = ordered('cc2');
    const ticks = 6;
    for (let t = 0; t < ticks; t++) control.engine.tick();
    // The set is for one pass and the tick clears it as it opens: it is put in from inside the pass, at the player's decision.
    contextOf(skipping.engine).cc2PlayerDecides = () => {
      world(skipping.engine).cc2SkipTurn = new Set<number>(skipping.uids);
    };
    for (let t = 0; t < ticks; t++) skipping.engine.tick();
    const cells = (engine: GameEngine): string[] => engine.getEntities().map((e) => `${e.x},${e.y}`);
    expect(cells(control.engine)).not.toEqual(cells(skipping.engine));
    expect(cells(skipping.engine)).toEqual(['8,2', '8,4', '8,6']);
  });
});
