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

import { beforeEach, describe, expect, it } from 'vitest';
import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

/** A force floor lane going east with open floor on both sides, the player on the floor west of it. */
const FORCE_LANE = ['###############', '#.............#', '#.@>>>>>>>>>..#', '#.............#', '###############'];
const BLOCK_LANE = ['###############', '#.............#', '#.@.IIIIIIII..#', '#.............#', '###############'];
/** Ticks per cell of a slide over ice on a level without the classic rules. */
const NATIVE_ICE_GAP = 3;
const ICE_LANE = ['###############', '#.............#', '#.@IIIIIIII...#', '#.............#', '###############'];

function level(rows: string[], flavor: boolean, extra: Parameters<typeof buildTestLevel>[1] = {}): CompiledLevel {
  const built = buildTestLevel(rows, extra);
  return flavor ? { ...built, rulesFlavor: 'cc' } : built;
}

interface TestWorld {
  player: { x: number; y: number; forcePermission?: boolean };
  entities: { kind: string; x: number; y: number }[];
}

function start(rows: string[], flavor: boolean, extra: Parameters<typeof buildTestLevel>[1] = {}): { engine: GameEngine; w: TestWorld } {
  const engine = new GameEngine();
  engine.loadLevel(level(rows, flavor, extra));
  return { engine, w: (engine as unknown as { w: TestWorld }).w };
}

/** Ticks until the cooldown after a step has run out, so the next move is not refused for it. */
function settleCooldown(engine: GameEngine): void {
  for (let i = 0; i < 8 && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
}

describe('classic force floor permission', () => {
  it('refuses a direction choice right after a voluntary step onto a force floor', () => {
    const { engine, w } = start(FORCE_LANE, true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.player.x).toBe(3);
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(false);
    expect(w.player.y).toBe(2);
  });

  it('allows the choice after a step the floor carried the player', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    expect(w.player.x).toBeGreaterThanOrEqual(5);
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(w.player.y).toBe(3);
  });

  it('takes the permission away again with the player own step', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    expect(w.player.forcePermission).toBe(true);
    settleCooldown(engine);
    engine.attemptPlayerMove('S');
    expect(w.player.forcePermission).toBe(false);
  });

  it('keeps the permission through a move, undo and move', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
    settleCooldown(engine);
    const x = w.player.x;
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(w.player.x).toBe(x);
    expect(w.player.y).toBe(2);
    expect(w.player.forcePermission).toBe(true);
    expect(engine.attemptPlayerMove('S')).toBe(true);
  });

  it('leaves a level without the classic rules unchanged', () => {
    const { engine, w } = start(FORCE_LANE, false);
    engine.attemptPlayerMove('E');
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(w.player.forcePermission).toBeUndefined();
  });
});

/** Ticks between the successive cells of a slide, from the first cell change on. */
function cellGaps(engine: GameEngine, w: TestWorld, ticks: number): number[] {
  const gaps: number[] = [];
  let lastX = w.player.x;
  let since = 0;
  for (let t = 0; t < ticks; t++) {
    engine.tick();
    since++;
    if (w.player.x !== lastX) {
      gaps.push(since);
      since = 0;
      lastX = w.player.x;
    }
  }
  return gaps;
}

describe('classic slide speed', () => {
  it('carries the player over a force floor one cell every two ticks', () => {
    const { engine, w } = start(FORCE_LANE, true);
    engine.attemptPlayerMove('E');
    const gaps = cellGaps(engine, w, 24).slice(1, 5);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((g) => g === 2)).toBe(true);
  });

  it('keeps the native force floor pace on a level without the classic rules', () => {
    const { engine, w } = start(FORCE_LANE, false);
    engine.attemptPlayerMove('E');
    const gaps = cellGaps(engine, w, 40).slice(1, 5);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((g) => g === 4)).toBe(true);
  });

  it('carries the player over ice one cell every two ticks, and at the native pace without the classic rules', () => {
    const classic = start(ICE_LANE, true);
    const native = start(ICE_LANE, false);
    classic.engine.attemptPlayerMove('E');
    native.engine.attemptPlayerMove('E');
    const fast = cellGaps(classic.engine, classic.w, 24).slice(1, 5);
    expect(fast.length).toBeGreaterThanOrEqual(3);
    expect(fast.every((g) => g === 2)).toBe(true);
    const slow = cellGaps(native.engine, native.w, 40).slice(1, 5);
    expect(slow.length).toBeGreaterThanOrEqual(3);
    expect(slow.every((g) => g === NATIVE_ICE_GAP)).toBe(true);
  });

  it('slides a block over ice one cell every two ticks, and at the native pace without the classic rules', () => {
    const slide = (flavor: boolean): number[] => {
      const { engine, w } = start(BLOCK_LANE, flavor, { entities: [{ type: 'dirt_block', x: 3, y: 2, dir: 'S' }] });
      engine.attemptPlayerMove('E');
      const gaps: number[] = [];
      let lastX = -1;
      let since = 0;
      for (let t = 0; t < 40; t++) {
        engine.tick();
        since++;
        const block = w.entities.find((e) => e.kind === 'block');
        if (block && block.x !== lastX) {
          if (lastX >= 0) gaps.push(since);
          since = 0;
          lastX = block.x;
        }
      }
      return gaps.slice(1, 5);
    };
    const classic = slide(true);
    const native = slide(false);
    expect(classic.length).toBeGreaterThanOrEqual(3);
    expect(classic.every((g) => g === 2)).toBe(true);
    expect(native.every((g) => g === 3)).toBe(true);
  });
});

describe('classic force floor softlock', () => {
  const WALL_LANE = ['#######', '#.@>>>##', '#......#', '#######'];

  it('lets a player pushed against a wall choose again after a blocked press', () => {
    const { engine, w } = start(WALL_LANE, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 12; i++) engine.tick();
    expect(w.player.x).toBe(5);
    settleCooldown(engine);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    for (let i = 0; i < 3; i++) engine.tick();
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(w.player.y).toBe(2);
  });

  it('lets a player who starts on a force floor be carried and then choose', () => {
    const built = level(['#######', '#.>>>..#', '#......#', '#######'], true);
    const engine = new GameEngine();
    engine.loadLevel({ ...built, playerStart: { x: 2, y: 1, dir: 'S' } });
    const w = (engine as unknown as { w: TestWorld }).w;
    engine.tick();
    engine.tick();
    expect(w.player.x).toBeGreaterThan(2);
    for (let i = 0; i < 12; i++) engine.tick();
    expect(engine.attemptPlayerMove('S')).toBe(true);
  });

  it('lets a player who starts against a wall on a force floor choose', () => {
    const built = level(['#####', '#.>##', '#...#', '#####'], true);
    const engine = new GameEngine();
    engine.loadLevel({ ...built, playerStart: { x: 2, y: 1, dir: 'S' } });
    for (let i = 0; i < 3; i++) engine.tick();
    expect(engine.attemptPlayerMove('S')).toBe(true);
  });

  it('plays a recorded blocked press the same live and in replay', () => {
    const script = (engine: GameEngine, w: TestWorld, moves: { tick: number; dir: 'N' | 'E' | 'S' | 'W' }[]): string => {
      let next = 0;
      for (let t = 0; t < 40; t++) {
        while (next < moves.length && moves[next].tick === engine.getTick()) engine.attemptPlayerMove(moves[next++].dir);
        engine.tick();
      }
      return `${w.player.x},${w.player.y},${w.player.forcePermission}`;
    };
    const live = start(WALL_LANE, true);
    const presses: Record<number, ('N' | 'E' | 'S' | 'W')[]> = { 0: ['E'], 20: ['E', 'S'] };
    for (let t = 0; t < 40; t++) {
      for (const dir of presses[t] ?? []) live.engine.attemptPlayerMove(dir);
      live.engine.tick();
    }
    const state = `${live.w.player.x},${live.w.player.y},${live.w.player.forcePermission}`;
    const history = live.engine.getTimedMoveHistory().map((m) => ({ tick: m.tick, dir: m.dir as 'N' | 'E' | 'S' | 'W' }));
    const replay = start(WALL_LANE, true);
    expect(script(replay.engine, replay.w, history)).toBe(state);
    // The blocked press at tick 20 is in the history, so the replay replays it.
    expect(history.some((m) => m.tick === 20 && m.dir === 'E')).toBe(true);
  });

  it('lets a player blocked on a random or cycling force floor choose', () => {
    for (const floor of ['force_random', 'force_cycle']) {
      const built = level(['#####', '#.>##', '#...#', '#####'], true);
      const engine = new GameEngine();
      engine.loadLevel({ ...built, playerStart: { x: 2, y: 1, dir: 'S' } });
      const w = (engine as unknown as { w: TestWorld & { terrain: string[][] } }).w;
      w.terrain[1][2] = floor;
      let chose = false;
      for (let i = 0; i < 20 && !chose; i++) {
        engine.tick();
        chose = w.player.forcePermission === true;
      }
      expect(chose, floor).toBe(true);
    }
  });
});

describe('classic walk wait after a slide', () => {
  /** Runs the ice lane until the player stands on the floor east of it, and returns the engine right then. */
  function leaveIce(flavor: boolean, haste = false): { engine: GameEngine; w: TestWorld } {
    const ctx = start(ICE_LANE, flavor);
    if (haste) ctx.engine.getPlayer().boots.add('boots_speed');
    ctx.engine.attemptPlayerMove('E');
    for (let i = 0; i < 60 && ctx.w.player.x < 11; i++) ctx.engine.tick();
    expect(ctx.w.player.x).toBe(11);
    return ctx;
  }

  /** Ticks a held east key needs, from the tick the slide ended, to move the player again. */
  function waitTicks(engine: GameEngine, w: TestWorld): number {
    const x = w.player.x;
    for (let t = 0; t < 20; t++) {
      if (engine.attemptPlayerMove('E') && w.player.x !== x) return t;
      engine.tick();
    }
    return -1;
  }

  it('makes a held key wait the walking cooldown once the slide ends on floor', () => {
    const { engine, w } = leaveIce(true);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThanOrEqual(3);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(waitTicks(engine, w)).toBeGreaterThanOrEqual(3);
  });

  it('shortens that wait with speed boots', () => {
    const plain = leaveIce(true);
    const hasted = leaveIce(true, true);
    expect(hasted.engine.getPlayer().moveCooldown).toBeLessThan(plain.engine.getPlayer().moveCooldown);
    expect(waitTicks(hasted.engine, hasted.w)).toBeLessThan(waitTicks(plain.engine, plain.w));
  });

  it('adds no wait on a level without the classic rules', () => {
    const { engine } = leaveIce(false);
    expect(engine.getPlayer().moveCooldown).toBe(0);
  });

  it('gives the walk wait to a force slide that ends on plain floor too', () => {
    const rows = ['###############', '#.............#', '#.@>>>>>>>>>..#', '#.............#', '###############'];
    const { engine, w } = start(rows, true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 60 && w.player.x < 12; i++) engine.tick();
    expect(w.player.x).toBe(12);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThanOrEqual(3);
  });

  it('leaves the next player free to move when the sliding one leaves through an exit', () => {
    const built = buildTestLevel(['###############', '#.@>>E........#', '#.............#', '#.............#', '###############']);
    const level: CompiledLevel = {
      ...built,
      rulesFlavor: 'cc',
      extraPlayers: [{ x: 8, y: 3, dir: 'E', character: 'melinda' }]
    };
    const engine = new GameEngine();
    engine.loadLevel(level);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < 40 && (engine.getExitedPlayers() ?? 0) < 1; i++) engine.tick();
    expect(engine.getExitedPlayers()).toBe(1);
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.getPlayer().moveCooldown).toBe(0);
  });
});

/** The tick that plays a step on a CC2 actor-order level has already run one tick of its wait when the step is read. */
const PLAYED_TICKS = 1;

/** A level converted from a CC2-engine source: the classic rules plus the stored CC2 data that selects the CC2 step timing. */
function startCc2(rows: string[]): { engine: GameEngine; w: TestWorld } {
  const engine = new GameEngine();
  engine.loadLevel({ ...level(rows, true), cc2: {} as never });
  return { engine, w: (engine as unknown as { w: TestWorld }).w };
}

/** Ticks from a voluntary step east onto the lane until the player has moved one cell further. */
function ticksToFirstSlideStep(engine: GameEngine, w: TestWorld): number {
  // On a level that plays in actor order the step is played by the first tick, which is counted.
  const playedTicks = engine.playsInActorOrder() ? playMove(engine, 'E') && 1 : (engine.attemptPlayerMove('E'), 0);
  const x = w.player.x;
  for (let t = 1; t <= 12; t++) {
    engine.tick();
    if (w.player.x !== x) return playedTicks + t;
  }
  return -1;
}

describe('CC2 engine player step timing', () => {
  it('lasts one tick longer for a voluntary step onto ice or a force floor than on the shared classic model', () => {
    for (const rows of [FORCE_LANE, ICE_LANE]) {
      const shared = start(rows, true);
      const cc2 = startCc2(rows);
      expect(ticksToFirstSlideStep(cc2.engine, cc2.w)).toBe(ticksToFirstSlideStep(shared.engine, shared.w) + 1);
    }
  });

  it('keeps the player busy two ticks after a voluntary step onto a force floor, one on the shared model', () => {
    const shared = start(FORCE_LANE, true);
    const cc2 = startCc2(FORCE_LANE);
    shared.engine.attemptPlayerMove('E');
    playMove(cc2.engine, 'E');
    expect(shared.engine.getPlayer().moveCooldown).toBe(1);
    expect(cc2.engine.getPlayer().moveCooldown + PLAYED_TICKS).toBe(2);
  });

  it('does not let speed boots shorten the step onto a slide tile', () => {
    for (const rows of [FORCE_LANE, ICE_LANE]) {
      const plain = startCc2(rows);
      const hasted = startCc2(rows);
      hasted.engine.getPlayer().boots.add('boots_speed');
      expect(ticksToFirstSlideStep(hasted.engine, hasted.w)).toBe(ticksToFirstSlideStep(plain.engine, plain.w));
    }
  });

  it('carries the player at most one cell every two ticks while a held key goes along the floor', () => {
    const { engine, w } = startCc2(FORCE_LANE);
    const xs: number[] = [];
    for (let t = 0; t < 16; t++) {
      engine.attemptPlayerMove('E');
      engine.tick();
      xs.push(w.player.x);
    }
    const moves = xs.filter((x, i) => i > 0 && x !== xs[i - 1]).length;
    expect(moves).toBeLessThanOrEqual(8);
    expect(moves).toBeGreaterThanOrEqual(6);
  });

  it('waits one tick less than the shared model once a slide ends on plain floor', () => {
    const run = (cc2: boolean): number => {
      const { engine, w } = cc2 ? startCc2(ICE_LANE) : start(ICE_LANE, true);
      engine.attemptPlayerMove('E');
      for (let i = 0; i < 60 && w.player.x < 11; i++) engine.tick();
      expect(w.player.x).toBe(11);
      return engine.getPlayer().moveCooldown;
    };
    expect(run(true)).toBe(run(false) - 1);
  });

  it('lets a player with the choice walk against a force floor, which the shared model refuses', () => {
    const choose = (cc2: boolean): boolean => {
      const { engine, w } = cc2 ? startCc2(FORCE_LANE) : start(FORCE_LANE, true);
      engine.attemptPlayerMove('E');
      for (let i = 0; i < 12 && w.player.x < 5; i++) engine.tick();
      settleCooldown(engine);
      return engine.attemptPlayerMove('W');
    };
    expect(choose(false)).toBe(false);
    expect(choose(true)).toBe(true);
  });
});
