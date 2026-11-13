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

/** Two direction keys held at once on a CC2-engine level: the slap, the choice between the keys, one undo step, one record. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { ROOM_ROW, room, type RoomOptions } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { applyTimedMove, sanitizeTimedMoves } from '../../ui/replaySchedule';
import { stableStringify } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import type { Direction, EntityPlacement } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 5;
const START_Y = ROOM_ROW;
const MAX_WAIT_TICKS = 40;
const HOLD_TICKS = 6;
const SMALL_UNDO_CAP = 3;

const block = (x: number, y: number): EntityPlacement => ({ type: 'dirt_block', x, y, dir: 'N' });
const mirror = (x: number, y: number): EntityPlacement => ({ type: 'mirror_chip', x, y, dir: 'N' });

function load(opts: Partial<RoomOptions> = {}, mode: RoomOptions['mode'] = 'cc2'): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: START_X, ...opts }));
  return engine;
}

/** Ticks until the player may decide again. */
function settle(engine: GameEngine): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; waited++) engine.tick();
}

function hold(engine: GameEngine, dirs: Direction[]): boolean {
  settle(engine);
  return engine.attemptPlayerMoveHeld!(dirs);
}

function cellOfEntity(engine: GameEngine, type: string): string {
  const entity = engine.getEntities().find((e) => e.type === type);
  return entity ? `${entity.x},${entity.y}` : 'gone';
}

function at(engine: GameEngine): string {
  const { x, y } = engine.getPlayer();
  return `${x},${y}`;
}

function undoCount(engine: GameEngine): number {
  let count = 0;
  while (engine.undo()) count++;
  return count;
}

function stateOf(engine: GameEngine): string {
  return stableStringify({
    tick: engine.getTick(),
    player: engine.getPlayer(),
    entities: engine.getEntities(),
    terrain: engine.getTerrain(),
    items: engine.getItems(),
    steps: engine.getStepsCount(),
    timedMoves: engine.getTimedMoveHistory()
  });
}

describe('two keys on a CC2-engine level', () => {
  it('steps toward the facing key, and toward the other when the facing key is blocked', () => {
    const open = load();
    expect(hold(open, ['N', 'E'])).toBe(true);
    expect(at(open)).toBe(`${START_X + 1},${START_Y}`);
    const blocked = load({ terrain: { [`${START_X + 1},${START_Y}`]: 'wall' } });
    expect(hold(blocked, ['N', 'E'])).toBe(true);
    expect(at(blocked)).toBe(`${START_X},${START_Y - 1}`);
  });

  it('steps the mirror players once when the first direction is blocked', () => {
    const engine = load({ terrain: { [`${START_X + 1},${START_Y}`]: 'wall' }, entities: [mirror(3, 8)] });
    expect(hold(engine, ['N', 'E'])).toBe(true);
    expect(cellOfEntity(engine, 'mirror_chip')).toBe('3,7');
  });

  it('steps the mirror players once toward the horizontal key when both ways are blocked', () => {
    const engine = load({
      dir: 'S',
      terrain: { [`${START_X + 1},${START_Y}`]: 'wall', [`${START_X},${START_Y - 1}`]: 'wall' },
      entities: [mirror(3, 8)]
    });
    expect(hold(engine, ['N', 'E'])).toBe(false);
    expect(cellOfEntity(engine, 'mirror_chip')).toBe('4,8');
    expect(engine.getPlayer().dir).toBe('E');
  });

  it('slaps the block beside him, then moves: one undo restores both', () => {
    const engine = load({ entities: [block(START_X, START_Y + 1)] });
    expect(hold(engine, ['E', 'S'])).toBe(true);
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 2}`);
    expect(at(engine)).toBe(`${START_X + 1},${START_Y}`);
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: engine.getTick(), dir: 'E', alt: 'S' }]);
    expect(engine.undo()).toBe(true);
    expect(at(engine)).toBe(`${START_X},${START_Y}`);
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
    expect(engine.canUndo()).toBe(false);
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });

  it('keeps the same undo depth as a plain move at the snapshot cap', () => {
    ConfigRegistry.getGame().timing.maxUndoSnapshots = SMALL_UNDO_CAP;
    const plain = load();
    const twoKeys = load();
    for (const engine of [plain, twoKeys]) {
      for (let i = 0; i < SMALL_UNDO_CAP; i++) {
        settle(engine);
        engine.attemptPlayerMove(i % 2 === 0 ? 'E' : 'W');
      }
    }
    settle(plain);
    plain.attemptPlayerMove('N');
    hold(twoKeys, ['N', 'E']);
    expect(undoCount(plain)).toBe(SMALL_UNDO_CAP);
    expect(undoCount(twoKeys)).toBe(SMALL_UNDO_CAP);
  });

  it('replays a recorded {dir, alt} move to the same state, through a storage round trip', () => {
    const level = { entities: [block(START_X, START_Y + 1)], terrain: { [`${START_X + 2},${START_Y}`]: 'wall' } };
    const played = load(level);
    hold(played, ['E', 'S']);
    hold(played, ['N', 'E']);
    hold(played, ['S', 'E']);
    for (let i = 0; i < HOLD_TICKS; i++) played.tick();
    const recorded = played.getTimedMoveHistory();
    expect(recorded.some((move) => move.alt !== undefined)).toBe(true);
    const restored = sanitizeTimedMoves(JSON.parse(JSON.stringify(recorded)));
    expect(restored).toEqual(recorded);
    const replayed = load(level);
    let index = 0;
    while (replayed.getTick() <= played.getTick()) {
      while (index < recorded.length && recorded[index].tick <= replayed.getTick()) applyTimedMove(replayed, recorded[index++]);
      if (replayed.getTick() === played.getTick()) break;
      replayed.tick();
    }
    expect(stateOf(replayed)).toBe(stateOf(played));
  });

  it('ignores an opposing pair and three keys, and records nothing', () => {
    for (const dirs of [['E', 'W'], ['N', 'S'], ['N', 'E', 'S'], ['E', 'S', 'W']] as Direction[][]) {
      const engine = load({ entities: [block(START_X, START_Y + 1)] });
      expect(hold(engine, dirs)).toBe(false);
      expect(at(engine)).toBe(`${START_X},${START_Y}`);
      expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
      expect(engine.getTimedMoveHistory()).toEqual([]);
      expect(engine.canUndo()).toBe(false);
    }
  });

  it('only turns inside a closed trap, like one key, and does not slap', () => {
    const engine = load({ terrain: { [`${START_X},${START_Y}`]: 'trap_sealed' }, entities: [block(START_X, START_Y + 1)] });
    expect(hold(engine, ['N', 'W'])).toBe(false);
    expect(at(engine)).toBe(`${START_X},${START_Y}`);
    expect(engine.getPlayer().dir).toBe('W');
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
  });

  it('does not slap across a thin wall', () => {
    const engine = load({ terrain: { [`${START_X},${START_Y}`]: 'thin_wall_s' }, entities: [block(START_X, START_Y + 1)] });
    hold(engine, ['E', 'S']);
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
  });

  it('slaps along the track, not toward the key, on a track cell', () => {
    const engine = load({ terrain: { [`${START_X},${START_Y}`]: 'rail_ew' }, entities: [block(START_X, START_Y + 1)] });
    hold(engine, ['E', 'S']);
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
  });

  it('bumps an appearing wall into a wall and a blue fake wall into floor, one undo step restoring both', () => {
    const eastCell = `${START_X + 1},${START_Y}`;
    const appearing = load({ terrain: { [eastCell]: 'appearing_wall' } });
    expect(hold(appearing, ['E', 'S'])).toBe(true);
    expect(appearing.getTerrain()[START_Y][START_X + 1]).toBe('wall');
    expect(at(appearing)).toBe(`${START_X},${START_Y + 1}`);
    expect(appearing.undo()).toBe(true);
    expect(appearing.getTerrain()[START_Y][START_X + 1]).toBe('appearing_wall');
    const fake = load({ terrain: { [eastCell]: 'blue_wall_fake' } });
    expect(hold(fake, ['E', 'S'])).toBe(true);
    expect(fake.getTerrain()[START_Y][START_X + 1]).toBe('floor');
    expect(at(fake)).toBe(eastCell);
  });

  it('does not slap while the player waits out a step', () => {
    const engine = load({ entities: [block(START_X, START_Y + 1)] });
    engine.attemptPlayerMove('E');
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(engine.attemptPlayerMoveHeld!(['E', 'S'])).toBe(false);
    expect(cellOfEntity(engine, 'dirt_block')).toBe(`${START_X},${START_Y + 1}`);
  });

  it('records a turn once while blocked keys stay held', () => {
    const engine = load({
      dir: 'S',
      terrain: { [`${START_X + 1},${START_Y}`]: 'wall', [`${START_X},${START_Y - 1}`]: 'wall' }
    });
    for (let i = 0; i < HOLD_TICKS; i++) {
      hold(engine, ['N', 'E']);
      engine.tick();
    }
    expect(engine.getTimedMoveHistory()).toHaveLength(1);
    expect(undoCount(engine)).toBe(1);
  });

  it('drops a held pair that changed nothing without a record or an undo step', () => {
    const engine = load({ terrain: { [`${START_X + 1},${START_Y}`]: 'wall', [`${START_X},${START_Y - 1}`]: 'wall' } });
    expect(hold(engine, ['N', 'E'])).toBe(false);
    // The first refusal settles the force permission, as a single key does; the same hold again changes nothing.
    const recorded = engine.getTimedMoveHistory().length;
    expect(hold(engine, ['N', 'E'])).toBe(false);
    expect(engine.getTimedMoveHistory()).toHaveLength(recorded);
    expect(undoCount(engine)).toBe(recorded);
  });
});

describe('two keys on a force floor', () => {
  const forceRoom = (): GameEngine => load({ dir: 'S', entities: [mirror(START_X + 3, START_Y)], terrain: { [`${START_X},${START_Y}`]: 'force_n' } });

  it('refuses a player carried without permission: no turn, no mirror move, no record, no undo step', () => {
    const engine = forceRoom();
    const mirrorBefore = cellOfEntity(engine, 'mirror_chip');
    const dirBefore = engine.getPlayer().dir;
    engine.getPlayer().forcePermission = false;
    expect(engine.attemptPlayerMoveHeld!(['N', 'E'])).toBe(false);
    expect(engine.getPlayer().dir).toBe(dirBefore);
    expect(cellOfEntity(engine, 'mirror_chip')).toBe(mirrorBefore);
    expect(engine.getTimedMoveHistory()).toHaveLength(0);
    expect(undoCount(engine)).toBe(0);
  });

  it('plays the hold as ever once the player has the permission', () => {
    const engine = forceRoom();
    engine.getPlayer().forcePermission = true;
    expect(engine.attemptPlayerMoveHeld!(['N', 'E'])).toBe(true);
    expect(engine.getTimedMoveHistory()).toHaveLength(1);
  });
});

describe('two keys off the CC2 engine', () => {
  it('plays the most recent key exactly as attemptPlayerMove does', () => {
    const held = load({ entities: [block(START_X, START_Y + 1)] }, 'native');
    const plain = load({ entities: [block(START_X, START_Y + 1)] }, 'native');
    expect(hold(held, ['S', 'E'])).toBe(plain.attemptPlayerMove('S'));
    expect(stateOf(held)).toBe(stateOf(plain));
    expect(held.getTimedMoveHistory().every((move) => move.alt === undefined)).toBe(true);
  });

  it('plays a single key as attemptPlayerMove on a CC2-engine level too', () => {
    const held = load();
    const plain = load();
    hold(held, ['E']);
    plain.attemptPlayerMove('E');
    expect(stateOf(held)).toBe(stateOf(plain));
  });
});

describe('sanitizeTimedMoves with an alt', () => {
  const move = { tick: 1, dir: 'E', alt: 'N' };

  it('keeps an orthogonal alt', () => {
    expect(sanitizeTimedMoves([move])).toEqual([move]);
  });

  it('rejects the whole list on a bad or non-orthogonal alt', () => {
    expect(sanitizeTimedMoves([{ ...move, alt: 'X' }])).toBeUndefined();
    expect(sanitizeTimedMoves([{ ...move, alt: 'W' }])).toBeUndefined();
    expect(sanitizeTimedMoves([{ ...move, alt: 'E' }])).toBeUndefined();
    expect(sanitizeTimedMoves([{ ...move, alt: 3 }])).toBeUndefined();
  });
});
