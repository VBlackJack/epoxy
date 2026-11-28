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
 * A joystick diagonal is the same engine input as the same two keys held on the keyboard. The harness follows the page's
 * order of calls (src/main.ts): joystick moves arrive between ticks like key presses, through the TouchKeySteer class the
 * page runs (TouchPage.run only executes its actions, as the page's executeTouchAction does); each tick the hold engines
 * hear heldSetForTick and the others are sent the held move again (sendHeldMove). The joystick is read with the same pure
 * steps FloatingJoystick runs (resolveJoystick, then joystickKeys).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { CclpEngine } from '../core/cclp/CclpEngine';
import { GameEngine } from '../core/GameEngine';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import type { PlayEngine } from '../core/PlayEngine';
import type { CompiledLevel, Direction, TimedMove } from '../core/types';
import { room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { HeldKeys, supportsHeldMove } from './heldKeys';
import { joystickOptionsFromTouchConfig, resolveJoystick } from './joystick';
import { heldSetForTick } from './padDirections';
import { applyTimedMove, collectDueMoves } from './replaySchedule';
import { joystickKeys, OPEN_TOUCH_GATE, sameKeys, TouchKeySteer, type TouchAction, type TouchGate } from './touchDirections';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
const TICKS = 48;
/** Finger distance from the base: past the dead zone, inside the base follow, so the base stays put. */
const REACH_PX = 20;
const KEY_CODE: Record<Direction, string> = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft' };
const OPTIONS = joystickOptionsFromTouchConfig();

type KeyScript = { tick: number; down?: Direction; up?: Direction }[];
/** Finger events: at tick t, before the tick, the finger goes to an angle (east 0, counterclockwise on screen) or lifts (null). */
type FingerScript = { tick: number; degrees: number | null }[];

function sendHeld(engine: PlayEngine, dirs: readonly Direction[]): void {
  if (supportsHeldMove(engine)) engine.attemptPlayerMoveHeld(dirs);
  else engine.attemptPlayerMove(dirs[0]);
}

function playKeyboard(engine: PlayEngine, script: KeyScript, ticks = TICKS): void {
  const held = new HeldKeys();
  for (let t = 0; t < ticks; t++) {
    for (const ev of script.filter((e) => e.tick === t)) {
      if (ev.up) held.release(KEY_CODE[ev.up]);
      if (ev.down) {
        held.press(KEY_CODE[ev.down], ev.down);
        sendHeld(engine, held.directions());
      }
    }
    if (engine.holdPlayerDirections) engine.holdPlayerDirections(heldSetForTick(held.directions(), null, [], false));
    else if (held.current() !== null) sendHeld(engine, held.directions());
    engine.tick();
  }
}

/** The page state the joystick touches: heldDirection, the TouchKeySteer, and the joystick's own reading. */
class TouchPage {
  readonly steer = new TouchKeySteer();
  private dir: Direction | null = null;
  private keys: Direction[] = [];
  heldDirection: Direction | null = null;

  /** FloatingJoystick.movePairs with the base at the origin, then the page's steerWithTouchKeys on a change. */
  finger(engine: PlayEngine, degrees: number | null, gate: TouchGate = OPEN_TOUCH_GATE): void {
    let now: Direction[] = [];
    if (degrees !== null) {
      const rad = (degrees * Math.PI) / 180;
      const point = { x: REACH_PX * Math.cos(rad), y: -REACH_PX * Math.sin(rad) };
      const resolved = resolveJoystick({ x: 0, y: 0 }, this.dir, point, OPTIONS.config);
      this.dir = resolved.dir;
      now = joystickKeys(resolved.dir, point.x - resolved.origin.x, point.y - resolved.origin.y, this.keys, OPTIONS.diagonal);
    } else {
      this.dir = null;
    }
    if (sameKeys(now, this.keys)) return;
    this.keys = now;
    this.run(engine, this.steer.update(now, gate), gate);
  }

  /** The page's executeTouchAction (and beginHeldMove, admitPress) for the cases a test reaches. */
  private run(engine: PlayEngine, action: TouchAction, gate: TouchGate): void {
    switch (action.kind) {
      case 'single':
        this.steer.forgetKeys();
        if (gate.takeover) return;
        this.heldDirection = action.dir;
        engine.attemptPlayerMove(action.dir);
        return;
      case 'press':
        // No takeover guard here: TouchKeySteer is the only defence a test has against a pair press during a solution.
        this.heldDirection = action.keys[0];
        if (supportsHeldMove(engine)) engine.attemptPlayerMoveHeld(action.keys);
        return;
      case 'hold':
        this.heldDirection = action.keys[0];
        return;
      case 'release':
        this.heldDirection = null;
        return;
      case 'none':
        return;
    }
  }

  /** runGameTick: holdDirectionsForTick, then the held move re-sent on an engine without holds (sendHeldMove). */
  tick(engine: PlayEngine): void {
    if (engine.holdPlayerDirections) engine.holdPlayerDirections(heldSetForTick([], this.steer.holdFor(this.heldDirection), [], false));
    if (this.heldDirection && !engine.holdPlayerDirection) {
      const touch = this.steer.holdFor(this.heldDirection);
      if (Array.isArray(touch) && supportsHeldMove(engine)) engine.attemptPlayerMoveHeld(touch);
      else engine.attemptPlayerMove(this.heldDirection);
    }
    engine.tick();
  }
}

function playTouch(engine: PlayEngine, script: FingerScript, ticks = TICKS): void {
  const page = new TouchPage();
  for (let t = 0; t < ticks; t++) {
    for (const ev of script.filter((e) => e.tick === t)) page.finger(engine, ev.degrees);
    page.tick(engine);
  }
}

function endState(engine: PlayEngine): unknown {
  const p = engine.getPlayer();
  return { at: [p.x, p.y, p.dir], alive: p.alive, entities: engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`) };
}

function outcome(engine: PlayEngine): unknown {
  return { end: endState(engine), timed: engine.getTimedMoveHistory() };
}

function playReplay(engine: PlayEngine, moves: readonly TimedMove[], ticks = TICKS): void {
  let index = 0;
  for (let t = 0; t < ticks; t++) {
    if (engine.holdPlayerDirections) engine.holdPlayerDirections(heldSetForTick([], null, [], true));
    const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
    for (const move of due) applyTimedMove(engine, move);
    index = nextIndex;
    engine.tick();
  }
}

const CCLP_ROOM = ['###########', '#.........#', '#.@.B.....#', '#....B....#', '#.........#', '#.........#', '#.........#', '###########'];
const CCLP_ROOM_FRESH = (): CompiledLevel => lynxLevel(CCLP_ROOM);
const CC2_ROOM_FRESH = (): CompiledLevel =>
  room({ mode: 'cc2', startX: 3, entities: [{ type: 'dirt_block', x: 6, y: 6, dir: 'N' }] });

const RIGS = [
  {
    name: 'CclpEngine (Lynx two-key rules)',
    make: (): PlayEngine => {
      const e = new CclpEngine(SILENT);
      e.loadLevel(CCLP_ROOM_FRESH());
      return e;
    }
  },
  {
    name: 'GameEngine on a CC2-engine level (CC2 two-key rules)',
    make: (): PlayEngine => {
      const e = new GameEngine();
      e.loadLevel(CC2_ROOM_FRESH());
      return e;
    }
  }
];

describe.each(RIGS)('$name', ({ make }) => {
  it('east then south-east: the joystick records the same replay as the same two keyboard keys', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'E' },
      { tick: 3, down: 'S' },
      { tick: 20, up: 'E' },
      { tick: 26, up: 'S' }
    ]);
    const touch = make();
    playTouch(touch, [
      { tick: 0, degrees: 0 },
      { tick: 3, degrees: 315 },
      { tick: 20, degrees: 270 },
      { tick: 26, degrees: null }
    ]);
    expect(kb.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(outcome(touch)).toEqual(outcome(kb));
  });

  it('south then south-east: the joystick records the same replay as the keyboard', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'S' },
      { tick: 3, down: 'E' },
      { tick: 20, up: 'S' },
      { tick: 26, up: 'E' }
    ]);
    const touch = make();
    playTouch(touch, [
      { tick: 0, degrees: 270 },
      { tick: 3, degrees: 315 },
      { tick: 20, degrees: 0 },
      { tick: 26, degrees: null }
    ]);
    expect(kb.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(outcome(touch)).toEqual(outcome(kb));
  });

  it('a press that lands between two ticks and a finger that lifts before the next hold: the press order is in the timed moves', () => {
    // The hold of a tick never hears the diagonal, so only the press (most recent key first) decides what the engine records.
    const eastThenSouthEast = (): { kb: PlayEngine; touch: PlayEngine } => {
      const kb = make();
      playKeyboard(kb, [
        { tick: 0, down: 'E' },
        { tick: 8, down: 'S' },
        { tick: 8, up: 'E' },
        { tick: 8, up: 'S' }
      ]);
      const touch = make();
      playTouch(touch, [
        { tick: 0, degrees: 0 },
        { tick: 8, degrees: 315 },
        { tick: 8, degrees: null }
      ]);
      return { kb, touch };
    };
    const forward = eastThenSouthEast();
    expect(outcome(forward.touch)).toEqual(outcome(forward.kb));

    const southThenSouthEast = (): { kb: PlayEngine; touch: PlayEngine } => {
      const kb = make();
      playKeyboard(kb, [
        { tick: 0, down: 'S' },
        { tick: 8, down: 'E' },
        { tick: 8, up: 'S' },
        { tick: 8, up: 'E' }
      ]);
      const touch = make();
      playTouch(touch, [
        { tick: 0, degrees: 270 },
        { tick: 8, degrees: 315 },
        { tick: 8, degrees: null }
      ]);
      return { kb, touch };
    };
    const reverse = southThenSouthEast();
    expect(outcome(reverse.touch)).toEqual(outcome(reverse.kb));
    // The two orders really differ in what the engine recorded, or this test would prove nothing about the order.
    expect(outcome(forward.kb)).not.toEqual(outcome(reverse.kb));
  });

  it('a slightly off-axis drag (20 degrees) stays one key: the same replay as east alone', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'E' },
      { tick: 20, up: 'E' }
    ]);
    const touch = make();
    playTouch(touch, [
      { tick: 0, degrees: 340 },
      { tick: 20, degrees: null }
    ]);
    expect(outcome(touch)).toEqual(outcome(kb));
  });

  it('the moves the joystick recorded, played back through the replay, end in the same state', () => {
    const touch = make();
    playTouch(touch, [
      { tick: 0, degrees: 0 },
      { tick: 3, degrees: 315 },
      { tick: 20, degrees: 270 },
      { tick: 26, degrees: null }
    ]);
    const moves = touch.getTimedMoveHistory();
    expect(moves.some((m) => m.alt !== undefined)).toBe(true);
    const replayed = make();
    playReplay(replayed, moves);
    expect(endState(replayed)).toEqual(endState(touch));
    expect(replayed.getTimedMoveHistory()).toEqual(moves);
  });

  it('a Tile World solution playing: a 45 degree first reading injects no pair move, and nothing is held afterwards', () => {
    const engine = make();
    const pairs = vi.spyOn(engine as { attemptPlayerMoveHeld: (dirs: readonly Direction[]) => void }, 'attemptPlayerMoveHeld');
    const single = vi.spyOn(engine, 'attemptPlayerMove');
    const page = new TouchPage();
    const takeover: TouchGate = { ...OPEN_TOUCH_GATE, takeover: true, replaying: true };
    page.finger(engine, 315, takeover);
    page.finger(engine, null, takeover);
    expect(pairs).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
    expect(page.heldDirection).toBeNull();
  });
});

describe('CC2 two-key rules: west and north', () => {
  it('the joystick records the same alt as the keyboard for west then north-west', () => {
    const make = (): PlayEngine => {
      const e = new GameEngine();
      e.loadLevel(CC2_ROOM_FRESH());
      return e;
    };
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'W' },
      { tick: 3, down: 'N' },
      { tick: 12, up: 'W' },
      { tick: 18, up: 'N' }
    ]);
    const touch = make();
    playTouch(touch, [
      { tick: 0, degrees: 180 },
      { tick: 3, degrees: 135 },
      { tick: 12, degrees: 90 },
      { tick: 18, degrees: null }
    ]);
    expect(kb.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(outcome(touch)).toEqual(outcome(kb));
  });
});
