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
  f: 'floor',
  x: 'floor',
  E: 'exit',
  W: 'water',
  F: 'fire',
  S: 'slime',
  I: 'ice'
};

const ITEM_CODES: Record<string, string> = { f: 'boots_fire', x: 'bomb' };

/**
 * Rows: # wall, . floor, P player, i ice block, d dirt block, E exit, W water, F fire, S slime,
 * I ice floor, f fire boots on floor, x bomb on floor.
 */
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
    items: rows.map((row) => [...row].map((ch) => ITEM_CODES[ch] ?? null)),
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
const WALL = '##########';

// The "engine loses" assertions in the negative tests below replay one scripted route only: they show that
// route fails, not that no route exists. The validator verdict is what each test guards (over-optimism).
describe('blocks that fill water or melt fire', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('(a) an ice lane carries a dirt block into water: the exit beyond is reachable', () => {
    const level = grid([WALL, '#PdIIIW.E#', WALL]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, REPEAT_EAST)).toBe(true);
  });

  it('(b) guards over-optimism: the same ice lane without a block stays unreachable', () => {
    const level = grid([WALL, '#P.IIIW.E#', WALL]);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(c) guards over-optimism: an ice block alone cannot fill the water its melt leaves', () => {
    const level = grid([WALL, '#Pi.F.E###', WALL]);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(d) guards over-optimism: a dirt block alone neither burns nor puts the fire out', () => {
    const level = grid([WALL, '#Pd.F.E###', WALL]);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });

  it('(e) an ice block melts the fire, then a dirt block fills the water left', () => {
    const level = grid([WALL, '#P.i.F.E##', '#....d####', '#.......##', WALL]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, MELT_THEN_FILL)).toBe(true);
  });

  it('(f) guards over-optimism: a melt with nothing to fill the water stays unreachable', () => {
    const level = grid([WALL, '#P.i.F.E##', '#.....####', '#.......##', WALL]);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, MELT_THEN_FILL)).toBe(false);
  });

  it('keeps fire boots usable when an ice block exists (a melt must not leave water behind)', () => {
    const level = grid([WALL, '#fP..F.E##', '#.i#######', WALL]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['W', 'E', 'E', 'E', 'E', 'E', 'E'])).toBe(true);
  });

  it('does not let a dead-end fire branch take the only ice block needed for slime', () => {
    const level = grid([WALL, '#Pi.S.E###', '#.F#######', WALL]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['E', 'E', 'E', 'E', 'E', 'E'])).toBe(true);
  });

  it('shares {ice, dirt, dirt} between slime and a fire melt', () => {
    const level = grid([
      '###########',
      '#PdS.i.F.E#',
      '####...d###',
      '####....###',
      '###########'
    ]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['E', 'E', 'E', 'E', 'E', 'S', 'S', 'E', 'N', 'N', 'E', 'E'])).toBe(true);
  });

  it('a slide that dies on a bomb is replayed once a block has cleared it', () => {
    const level = grid([WALL, '#PdIIIx.E#', WALL]);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, REPEAT_EAST)).toBe(true);
  });

  it('guards over-optimism: the same bomb lane without a block stays unreachable', () => {
    const level = grid([WALL, '#P.IIIx.E#', WALL]);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, REPEAT_EAST)).toBe(false);
  });
});
