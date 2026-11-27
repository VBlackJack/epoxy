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
 * A gamepad diagonal is the same engine input as the same two keys held on the keyboard. The harnesses follow the page's
 * order of calls (src/main.ts): keyboard presses arrive between ticks and are sent at once; the pad is polled at the start
 * of a tick, through the same pure steering (padSteer) the page calls.
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
import { gamepadConfigFrom, heldSetForTick, PadKeyOrder, padKeys, padSteer, PadSnapshot } from './padDirections';
import { applyTimedMove, collectDueMoves } from './replaySchedule';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
const TICKS = 48;
const BUTTON_COUNT = 17;
const KEY_CODE: Record<Direction, string> = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft' };

/** Keyboard events: at tick t, before the tick, keys go down or up (in the order written). */
type KeyScript = { tick: number; down?: Direction; up?: Direction }[];
/** Stick angle per tick range (east 0, counterclockwise), null for a stick at rest. Full throw. */
type StickScript = { from: number; to: number; degrees: number | null }[];

function stickAt(script: StickScript, tick: number): PadSnapshot {
  const seg = script.find((s) => tick >= s.from && tick < s.to);
  const axes: [number, number] =
    seg && seg.degrees !== null ? [Math.cos((seg.degrees * Math.PI) / 180), -Math.sin((seg.degrees * Math.PI) / 180)] : [0, 0];
  return { axes, buttons: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false })) };
}

function sendHeld(engine: PlayEngine, dirs: readonly Direction[]): void {
  if (supportsHeldMove(engine)) engine.attemptPlayerMoveHeld(dirs);
  else engine.attemptPlayerMove(dirs[0]);
}

/** The page with the keyboard: pressMoveKey, keyup, then runGameTick (holds, or the held move re-sent each tick). */
function playKeyboard(engine: PlayEngine, script: KeyScript, ticks = TICKS): HeldKeys {
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
  return held;
}

/** The pad state of a page: what pollGamepad keeps between polls. */
class PadHarness {
  private readonly order = new PadKeyOrder();
  private stick: Direction[] = [];
  private readonly config = gamepadConfigFrom(undefined);
  /** The pad's hold for the tick (what the page keeps in gamepadKeys). */
  hold: Direction[] = [];

  /** pollGamepad then steerWithGamepadKeys; `keyboardDown` is a key held on the keyboard. */
  poll(engine: PlayEngine, pad: PadSnapshot, keyboardDown = false): void {
    const read = padKeys(pad, this.stick, this.config);
    this.stick = read.stick;
    const { keys, added } = this.order.update(read.keys);
    const steer = padSteer({ keys, added, keyboardDown, engineKind: engine.holdPlayerDirection ? 'hold' : 'resend' });
    if (steer.press) sendHeld(engine, steer.press);
    this.hold = steer.hold;
  }

  clear(): void {
    this.order.clear();
    this.stick = [];
    this.hold = [];
  }
}

/** The page with the gamepad: pollGamepad at the start of runGameTick, then the holds. */
function playPad(engine: PlayEngine, script: StickScript, ticks = TICKS): void {
  const pad = new PadHarness();
  for (let t = 0; t < ticks; t++) {
    pad.poll(engine, stickAt(script, t));
    if (engine.holdPlayerDirections) engine.holdPlayerDirections(heldSetForTick([], null, pad.hold, false));
    engine.tick();
  }
}

function endState(engine: PlayEngine): unknown {
  const p = engine.getPlayer();
  return { at: [p.x, p.y, p.dir], alive: p.alive, entities: engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`) };
}

function outcome(engine: PlayEngine): unknown {
  return { end: endState(engine), timed: engine.getTimedMoveHistory() };
}

/** The page's replay: the held set is empty, due moves are applied, then the tick (advanceReplay, runGameTick). */
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

/** A room with blocks east and south of Chip's path, so the two-key rules (slap, facing) decide. */
const CCLP_ROOM = ['###########', '#.........#', '#.@.B.....#', '#....B....#', '#.........#', '#.........#', '#.........#', '###########'];
const CCLP_ROOM_FRESH = (): CompiledLevel => lynxLevel(CCLP_ROOM);
const CC2_ROOM_FRESH = (): CompiledLevel =>
  room({ mode: 'cc2', startX: 3, entities: [{ type: 'dirt_block', x: 6, y: 6, dir: 'N' }] });

interface Rig {
  name: string;
  make: () => PlayEngine;
}

const RIGS: Rig[] = [
  {
    name: 'CclpEngine (Lynx two-key rules)',
    make: () => {
      const e = new CclpEngine(SILENT);
      e.loadLevel(CCLP_ROOM_FRESH());
      return e;
    }
  },
  {
    name: 'GameEngine on a CC2-engine level (CC2 two-key rules)',
    make: () => {
      const e = new GameEngine();
      e.loadLevel(CC2_ROOM_FRESH());
      return e;
    }
  }
];

describe.each(RIGS)('$name', ({ make }) => {
  it('east then south: the stick records the same replay as the same two keyboard keys', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'E' },
      { tick: 3, down: 'S' },
      { tick: 20, up: 'E' },
      { tick: 26, up: 'S' }
    ]);
    const pad = make();
    playPad(pad, [
      { from: 0, to: 3, degrees: 0 },
      { from: 3, to: 20, degrees: 315 },
      { from: 20, to: 26, degrees: 270 },
      { from: 26, to: TICKS, degrees: null }
    ]);
    expect(kb.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(outcome(pad)).toEqual(outcome(kb));
  });

  it('south then east: the stick records the same replay as the keyboard', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 0, down: 'S' },
      { tick: 3, down: 'E' },
      { tick: 20, up: 'S' },
      { tick: 26, up: 'E' }
    ]);
    const pad = make();
    playPad(pad, [
      { from: 0, to: 3, degrees: 270 },
      { from: 3, to: 20, degrees: 315 },
      { from: 20, to: 26, degrees: 0 },
      { from: 26, to: TICKS, degrees: null }
    ]);
    expect(kb.getTimedMoveHistory().some((m) => m.alt !== undefined)).toBe(true);
    expect(outcome(pad)).toEqual(outcome(kb));
  });

  it('from rest straight into south-east ends where east and south pressed in one tick end', () => {
    const kb = make();
    playKeyboard(kb, [
      { tick: 2, down: 'E' },
      { tick: 2, down: 'S' },
      { tick: 24, up: 'E' },
      { tick: 24, up: 'S' }
    ]);
    const pad = make();
    playPad(pad, [
      { from: 0, to: 2, degrees: null },
      { from: 2, to: 24, degrees: 315 },
      { from: 24, to: TICKS, degrees: null }
    ]);
    expect(endState(pad)).toEqual(endState(kb));
  });

  it('pushing against a block on both axes: the slap is the same as the keyboard on each axis', () => {
    // Chip walks east to the block, then pushes into the corner: east is the block, south the second block.
    const keys: KeyScript = [
      { tick: 0, down: 'E' },
      { tick: 6, down: 'S' },
      { tick: 30, up: 'E' },
      { tick: 30, up: 'S' }
    ];
    const kb = make();
    playKeyboard(kb, keys);
    const pad = make();
    playPad(pad, [
      { from: 0, to: 6, degrees: 0 },
      { from: 6, to: 30, degrees: 315 },
      { from: 30, to: TICKS, degrees: null }
    ]);
    expect(outcome(pad)).toEqual(outcome(kb));
  });

  it('the moves the pad recorded, played back through the replay, end in the same state', () => {
    const pad = make();
    playPad(pad, [
      { from: 0, to: 3, degrees: 0 },
      { from: 3, to: 20, degrees: 315 },
      { from: 20, to: 26, degrees: 270 },
      { from: 26, to: TICKS, degrees: null }
    ]);
    const moves = pad.getTimedMoveHistory();
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.alt !== undefined)).toBe(true);
    const replayed = make();
    playReplay(replayed, moves);
    expect(endState(replayed)).toEqual(endState(pad));
    expect(replayed.getTimedMoveHistory()).toEqual(moves);
  });
});

describe('a pad press that is no move', () => {
  it('while paused: nothing moves and nothing is recorded, on both engines', () => {
    for (const { make } of RIGS) {
      const engine = make();
      engine.togglePause();
      expect(engine.isPaused()).toBe(true);
      const before = endState(engine);
      playPad(engine, [{ from: 0, to: TICKS, degrees: 315 }], 10);
      expect(endState(engine)).toEqual(before);
      expect(engine.getTimedMoveHistory()).toEqual([]);
    }
  });

  it('after death: the pad moves nothing and records nothing more', () => {
    const lethalCclp = (): PlayEngine => {
      const e = new CclpEngine(SILENT);
      e.loadLevel(lynxLevel(['#####', '#@W.#', '#...#', '#####']));
      return e;
    };
    const lethalCc2 = (): PlayEngine => {
      const e = new GameEngine();
      e.loadLevel(room({ mode: 'cc2', startX: 3, terrain: { '4,5': 'water' } }));
      return e;
    };
    for (const make of [lethalCclp, lethalCc2]) {
      const engine = make();
      playPad(engine, [{ from: 0, to: TICKS, degrees: 0 }], 20);
      expect(engine.getPlayer().alive).toBe(false);
      const recorded = engine.getTimedMoveHistory().length;
      const before = endState(engine);
      playPad(engine, [{ from: 0, to: TICKS, degrees: 315 }], 10);
      expect(engine.getTimedMoveHistory().length).toBe(recorded);
      expect(endState(engine)).toEqual(before);
    }
  });
});

describe('the keyboard and the pad together on an engine that is sent the keys every tick', () => {
  it('make one move attempt per tick: the keyboard wins and the pad adds nothing', () => {
    const kbOnly = new GameEngine();
    kbOnly.loadLevel(CC2_ROOM_FRESH());
    playKeyboard(kbOnly, [{ tick: 0, down: 'E' }]);

    const both = new GameEngine();
    both.loadLevel(CC2_ROOM_FRESH());
    const attempts: (readonly Direction[])[] = [];
    const original = both.attemptPlayerMoveHeld.bind(both);
    both.attemptPlayerMoveHeld = (dirs: readonly Direction[], blocked?: readonly Direction[]): boolean => {
      attempts.push([...dirs]);
      return original(dirs, blocked);
    };
    const held = new HeldKeys();
    const pad = new PadHarness();
    const south = stickAt([{ from: 0, to: TICKS, degrees: 270 }], 0);
    for (let t = 0; t < TICKS; t++) {
      if (t === 0) {
        held.press(KEY_CODE.E, 'E');
        sendHeld(both, held.directions());
      }
      attempts.length = 0;
      pad.poll(both, south, held.current() !== null);
      // The page re-sends the keyboard's held move once per tick on an engine without holds.
      if (held.current() !== null) sendHeld(both, held.directions());
      expect(attempts).toEqual([['E']]);
      both.tick();
    }
    expect(endState(both)).toEqual(endState(kbOnly));
  });
});
