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
 * CC2 engine, wave 15: the frame clock of the player. A forced step on a force floor refused at the decisions of a tic (frame 2) is
 * tried again in frames 0 and 1 of the next tic, before the input (Lexy forced decisions of frames 0 and 1, game.js:869-888, and the
 * refused slide, game.js:1127-1162); a forced step that goes in frame f keeps frame f for the next ones (map054 t617-t634).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement } from '../types';
import { cc2HiddenStateKey } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FORCE_EAST = 'force_e';
const FORCE_SOUTH = 'force_s';
const FORCE_NORTH = 'force_n';
const CYCLE = 'force_cycle';
const WALL = 'wall';
const LANE_X = 3;
const BELT_END_X = 8;
const WARM_UP_TICKS = 4;
const RUN_TICKS = 10;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** A belt of force floors going east along the player's row, its second cell a wall until the test opens it. */
function eastBelt(mode: 'cc2' | 'cc' | 'native' = 'cc2'): CompiledLevel {
  const terrain: Record<string, string> = { [`${LANE_X + 1},${ROOM_ROW}`]: WALL };
  for (let x = LANE_X; x <= BELT_END_X; x++) if (x !== LANE_X + 1) terrain[`${x},${ROOM_ROW}`] = FORCE_EAST;
  terrain[`${LANE_X},${ROOM_ROW}`] = FORCE_EAST;
  return room({ mode, startX: LANE_X, terrain });
}

function openWall(engine: GameEngine): void {
  worldOf(engine).terrain[ROOM_ROW][LANE_X + 1] = FORCE_EAST;
}

function trail(engine: GameEngine, ticks: number): string[] {
  const w = worldOf(engine);
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    engine.tick();
    out.push(`${w.player.x},${w.player.y}`);
  }
  return out;
}

describe('PFS: the retry of a refused forced step', () => {
  it('runs in the next tick before the input, which is refused, and keeps its frame (map054 t617-t634 shape)', () => {
    const engine = load(eastBelt());
    const w = worldOf(engine);
    trail(engine, WARM_UP_TICKS);
    expect(w.player.cc2FrameRetry).toBe(true);
    openWall(engine);
    engine.attemptPlayerMove('N');
    const after = trail(engine, RUN_TICKS);
    // Frame 0 of the first tick after the wall opened: he steps east before his input, so the input north is refused and stays
    // refused; the next forced steps follow two ticks apart, still in frame 0, each before the input of its tic.
    expect(after.slice(0, 4)).toEqual(['4,5', '4,5', '5,5', '5,5']);
    expect(after.every((cell) => cell.endsWith(`,${ROOM_ROW}`))).toBe(true);
    expect(w.player.cc2SlideFrame).toBe(0);
  });

  it('a bonk that moves him sets no retry mark (item 4)', () => {
    const terrain = { [`${LANE_X},${ROOM_ROW}`]: CYCLE, [`${LANE_X + 1},${ROOM_ROW}`]: WALL };
    const engine = load(room({ mode: 'cc2', startX: LANE_X, terrain }));
    const w = worldOf(engine);
    // The level starts on the pad: the first draw sends him east into the wall, the bonk turns the floor south and he leaves.
    for (let i = 0; i < WARM_UP_TICKS; i++) {
      engine.tick();
      if (w.player.y !== ROOM_ROW) break;
    }
    expect(w.player.y).toBe(ROOM_ROW + 1);
    expect(w.player.cc2FrameRetry).toBeUndefined();
  });

  it('never sets a mark outside the CC2 engine', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(eastBelt(mode));
      const w = worldOf(engine);
      for (let i = 0; i < RUN_TICKS; i++) {
        engine.tick();
        expect(w.player.cc2FrameRetry).toBeUndefined();
        expect(w.player.cc2SlideFrame).toBeUndefined();
        expect(w.player.cc2PrePassMoved).toBeUndefined();
      }
    }
  });
});

describe('PFS: the player is an actor of the list (item 1)', () => {
  const BELT_CELL = 4;
  const CORRIDOR_X = 3;

  function contested(playerRow: number, monsterRow: number, playerFloor: string, monsterFloor: string): GameEngine {
    const terrain: Record<string, string> = {
      [`${CORRIDOR_X},${BELT_CELL}`]: WALL,
      [`${CORRIDOR_X},${playerRow}`]: playerFloor,
      [`${CORRIDOR_X},${monsterRow}`]: monsterFloor
    };
    const monster = { type: 'bug', x: CORRIDOR_X, y: monsterRow, dir: monsterFloor === FORCE_NORTH ? 'N' : 'S' } as EntityPlacement;
    const level = room({ mode: 'cc2', terrain, entities: [monster] });
    const engine = load({ ...level, playerStart: { x: CORRIDOR_X, y: playerRow, dir: playerFloor === FORCE_NORTH ? 'N' : 'S' } });
    for (let i = 0; i < WARM_UP_TICKS; i++) engine.tick();
    worldOf(engine).terrain[BELT_CELL][CORRIDOR_X] = 'floor';
    return engine;
  }

  it('a monster listed after him steps before him, one listed ahead of him after him', () => {
    // Both want the opened cell. Reading order lists the upper actor first; the reverse loop moves the lower one first.
    const monsterBelow = contested(3, 5, FORCE_SOUTH, FORCE_NORTH);
    const monsterAbove = contested(5, 3, FORCE_NORTH, FORCE_SOUTH);
    monsterBelow.tick();
    monsterAbove.tick();
    // The monster below him is listed after him: it moves first, so he steps second and meets it, keeping his retry mark.
    expect(worldOf(monsterBelow).player.alive).toBe(false);
    expect(worldOf(monsterBelow).player.cc2FrameRetry).toBe(true);
    // The monster above him is listed ahead: he steps first and leaves his retry behind him.
    expect(worldOf(monsterAbove).player.alive).toBe(false);
    expect(worldOf(monsterAbove).player.cc2FrameRetry).toBeUndefined();
  });
});

describe('PFS: a parked player never takes the retry (item 2)', () => {
  it('a parked player refused on a force floor gets no mark', () => {
    const terrain = { [`${LANE_X + 1},${ROOM_ROW}`]: WALL, [`${LANE_X},${ROOM_ROW}`]: FORCE_EAST, [`${LANE_X + 3},${ROOM_ROW - 2}`]: FORCE_EAST, [`${LANE_X + 4},${ROOM_ROW - 2}`]: WALL };
    const base = room({ mode: 'cc2', startX: LANE_X, terrain });
    const engine = load({ ...base, extraPlayers: [{ x: LANE_X + 3, y: ROOM_ROW - 2, dir: 'E' as const, character: 'chip' as const }] });
    const w = worldOf(engine);
    // The parked player is carried east into the wall: his forced step is refused at every tick.
    w.parked[0].isSliding = true;
    w.parked[0].slideDir = 'E';
    w.parked[0].slideCooldown = 0;
    for (let i = 0; i < RUN_TICKS; i++) engine.tick();
    expect(w.parked.length).toBe(1);
    for (const parked of w.parked) {
      expect(parked.cc2FrameRetry).toBeUndefined();
      expect(parked.cc2SlideFrame).toBeUndefined();
      expect(parked.cc2PrePassMoved).toBeUndefined();
    }
  });
});

describe('PFS: a block pushed by a forced step of frame 0 is timed from frame 0 (item 5)', () => {
  const BLOCK_X = LANE_X + 1;
  const BEYOND_X = LANE_X + 2;

  function pushLevel(): GameEngine {
    const terrain = { [`${LANE_X},${ROOM_ROW}`]: FORCE_EAST, [`${BEYOND_X},${ROOM_ROW}`]: WALL };
    const block = { type: 'dirt_block', x: BLOCK_X, y: ROOM_ROW, dir: 'E' } as EntityPlacement;
    const engine = load(room({ mode: 'cc2', startX: LANE_X, terrain, entities: [block] }));
    for (let i = 0; i < WARM_UP_TICKS; i++) engine.tick();
    return engine;
  }

  it('onto a plain cell its arrival is held 11 frames from frame 0: 3 ticks, frame 2', () => {
    const engine = pushLevel();
    const w = worldOf(engine);
    w.terrain[ROOM_ROW][BEYOND_X] = 'floor';
    engine.tick();
    const block = w.entities.find((e) => e.kind === 'block');
    expect(block?.x).toBe(BEYOND_X);
    expect(block?.cc2ArrivalWait).toBe(3);
    expect(block?.cc2ArrivalFrame).toBe(2);
  });

  it('onto ice its first slide step is in frame 0, two pre-passes away', () => {
    const engine = pushLevel();
    const w = worldOf(engine);
    w.terrain[ROOM_ROW][BEYOND_X] = 'ice';
    engine.tick();
    const block = w.entities.find((e) => e.kind === 'block');
    expect(block?.x).toBe(BEYOND_X);
    expect(block?.cc2SlideFrame).toBe(0);
    expect(block?.cc2SlideDue).toBe(2);
  });
});

describe('PFS: a monster listed ahead of the player steps until his step onto the exit ends (item 15)', () => {
  const GATE_ROW = 3;
  /** Ticks until the last player's step onto the exit has ended and the level is won (wave 38). */
  const WIN_TICKS = 5;

  it('a bug on a force floor steps at the first tick, and the level is won when the step ends (Lexy lane w38r2_pfs_b: success at 5)', () => {
    // The lead stands on a force floor east with the exit on the next cell; a bug listed ahead of him stands on a force floor east
    // with a wall behind the floor beyond it. No input. Lexy lane w38r2_pfs_b: the bug is on (4,3) from tic 0, the win is at tic 5.
    // The bug of the winning tick is not asserted: Lexy's bug decides there, Epoxy ends the tick before the monsters.
    const terrain: Record<string, string> = {
      [`${LANE_X},${ROOM_ROW}`]: FORCE_EAST,
      [`${LANE_X + 1},${ROOM_ROW}`]: 'exit',
      [`${LANE_X},${GATE_ROW}`]: FORCE_EAST,
      [`${LANE_X + 2},${GATE_ROW}`]: WALL
    };
    const monster = { type: 'bug', x: LANE_X, y: GATE_ROW, dir: 'E' } as EntityPlacement;
    const engine = load(room({ mode: 'cc2', startX: LANE_X, terrain, entities: [monster] }));
    const w = worldOf(engine);
    engine.tick();
    expect(w.levelCompleted).toBe(false);
    expect(w.entities.find((e) => e.kind === 'monster')?.x).toBe(LANE_X + 1);
    for (let i = 1; i < WIN_TICKS; i++) engine.tick();
    expect(w.levelCompleted).toBe(true);
    expect(engine.getTick()).toBe(WIN_TICKS);
  });
});

describe('PFS: documented limits (item 12)', () => {
  it('the step from a force floor onto ice keeps no slide frame: Lexy times the ice step from its own frame, not modelled', () => {
    const terrain: Record<string, string> = { [`${LANE_X},${ROOM_ROW}`]: FORCE_EAST, [`${LANE_X + 1},${ROOM_ROW}`]: WALL, [`${LANE_X + 2},${ROOM_ROW}`]: 'ice' };
    const engine = load(room({ mode: 'cc2', startX: LANE_X, terrain }));
    const w = worldOf(engine);
    for (let i = 0; i < WARM_UP_TICKS; i++) engine.tick();
    w.terrain[ROOM_ROW][LANE_X + 1] = 'ice';
    engine.tick();
    expect(w.player.x).toBe(LANE_X + 1);
    expect(w.player.cc2SlideFrame).toBeUndefined();
  });

  it('the bonk of a turning floor bestows no item lying on the floor under him (Lexy game.js:1135-1150, not modelled)', () => {
    const terrain: Record<string, string> = { [`${LANE_X},${ROOM_ROW}`]: CYCLE };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) terrain[`${LANE_X + dx},${ROOM_ROW + dy}`] = WALL;
    const engine = load(room({ mode: 'cc2', startX: LANE_X, terrain, items: { [`${LANE_X},${ROOM_ROW}`]: 'key_red' } }));
    const w = worldOf(engine);
    for (let i = 0; i < RUN_TICKS; i++) engine.tick();
    expect(w.player.keys.red ?? 0).toBe(0);
  });
});

describe('PFS: undo across a frame-0 forced step', () => {
  function replayFromMidSlide(engine: GameEngine): void {
    const w = worldOf(engine);
    openWall(engine);
    engine.tick();
    // The step of frame 0 went: the slide frame is carried, the retry mark is gone.
    expect(w.player.x).toBe(LANE_X + 1);
    const snap = engine.captureState();
    const key = cc2HiddenStateKey(w);
    const first = trail(engine, RUN_TICKS);
    const keyAfter = cc2HiddenStateKey(w);
    engine.restoreState(snap);
    expect(worldOf(engine).player.cc2SlideFrame).toBe(0);
    expect(cc2HiddenStateKey(worldOf(engine))).toBe(key);
    expect(trail(engine, RUN_TICKS)).toEqual(first);
    expect(cc2HiddenStateKey(worldOf(engine))).toBe(keyAfter);
  }

  it('on an actor-order level replays identically', () => {
    const engine = load(eastBelt());
    expect(worldOf(engine).cc2ActorOrder).toBe(true);
    trail(engine, WARM_UP_TICKS);
    replayFromMidSlide(engine);
  });

  it('on a parked-player level replays identically', () => {
    const base = eastBelt();
    const engine = load({ ...base, extraPlayers: [{ x: LANE_X + 4, y: ROOM_ROW - 2, dir: 'E' as const, character: 'chip' as const }] });
    const w = worldOf(engine);
    expect(w.cc2ActorOrder).toBeUndefined();
    openWall(engine);
    // No actor order: the pre-pass runs at the end of the tick, so the frame-0 step is set up as it leaves it: sliding east with
    // the frame mark, one tick before the next forced step.
    w.player.x = LANE_X + 2;
    w.player.isSliding = true;
    w.player.slideDir = 'E';
    w.player.dir = 'E';
    w.player.slideCooldown = 1;
    w.player.moveCooldown = 1;
    w.player.cc2SlideFrame = 0;
    const snap = engine.captureState();
    const key = cc2HiddenStateKey(w);
    const first = trail(engine, RUN_TICKS);
    const keyAfter = cc2HiddenStateKey(w);
    engine.restoreState(snap);
    expect(worldOf(engine).player.cc2SlideFrame).toBe(0);
    expect(cc2HiddenStateKey(worldOf(engine))).toBe(key);
    expect(trail(engine, RUN_TICKS)).toEqual(first);
    expect(cc2HiddenStateKey(worldOf(engine))).toBe(keyAfter);
  });
});
