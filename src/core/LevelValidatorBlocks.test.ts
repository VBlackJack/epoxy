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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, EntityPlacement } from './types';

const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
const SETTLE_TICKS = 400;

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  i: 'floor',
  d: 'floor',
  E: 'exit',
  W: 'water',
  F: 'fire',
  I: 'ice'
};

/** Rows: # wall, . floor, P player, i ice block, d dirt block, E exit, W water, F fire, I ice floor. */
function grid(rows: string[]): CompiledLevel {
  let start = { x: 0, y: 0 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === 'i') entities.push({ type: 'ice_block', x, y, dir: 'S' });
      if (ch === 'd') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'blocks_grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 1000,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items: rows.map((row) => [...row].map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function exitUnreachable(level: CompiledLevel): boolean {
  return LevelValidator.validate(level).issues.some((i) => i.i18nKey === UNREACHABLE_EXIT);
}

/** Plays the moves in the real engine, letting every slide settle, and reports whether the level was won. */
function engineWins(level: CompiledLevel, moves: Direction[]): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const settle = (): void => {
    for (let i = 0; i < SETTLE_TICKS; i++) {
      const moving = engine.getPlayer().isSliding || engine.getEntities().some((e) => e.isSliding);
      if (!moving && i > 0) return;
      engine.tick();
    }
  };
  for (const dir of moves) {
    if (engine.isLevelCompleted() || !engine.getPlayer().alive) break;
    let waited = 0;
    while (!engine.attemptPlayerMove(dir)) {
      engine.tick();
      if (++waited > SETTLE_TICKS) throw new Error(`move ${dir} refused`);
    }
    settle();
  }
  return engine.isLevelCompleted();
}

const REPEAT_EAST: Direction[] = ['E', 'E', 'E', 'E', 'E', 'E', 'E', 'E'];
// The ice block melts the fire at (5,1); the dirt block at (5,2) is then pushed north into the water.
const MELT_THEN_FILL: Direction[] = ['E', 'E', 'E', 'S', 'S', 'E', 'N', 'N', 'E', 'E'];

describe('blocks that fill water or melt fire', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('(a) an ice lane carries a dirt block into water: the exit beyond is reachable', () => {
    const level = grid(['#########', '#PdIIIW.E#', '#########']);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, REPEAT_EAST)).toBe(true);
  });

  it('(b) the same ice lane without a block ends in the water', () => {
    const level = grid(['#########', '#P.IIIW.E#', '#########']);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(c) an ice block alone melts the fire into water it cannot fill', () => {
    const level = grid(['#########', '#Pi.F.E##', '#########']);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(d) a dirt block alone neither burns nor puts the fire out', () => {
    const level = grid(['#########', '#Pd.F.E##', '#########']);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(e) an ice block melts the fire, then a dirt block fills the water left', () => {
    const level = grid(['#########', '#P.i.F.E#', '#....d###', '#.......#', '#########']);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, MELT_THEN_FILL)).toBe(true);
  });

  it('(f) an ice block melts the fire into water and nothing fills it', () => {
    const level = grid(['#########', '#P.i.F.E#', '#.....###', '#.......#', '#########']);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, MELT_THEN_FILL)).toBe(false);
  });
});
