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
  w: 'floor',
  t: 'thief',
  v: 'force_w',
  f: 'floor',
  x: 'floor',
  E: 'exit',
  W: 'water',
  F: 'fire',
  S: 'slime',
  I: 'ice'
};

const ITEM_CODES: Record<string, string> = { f: 'boots_fire', w: 'boots_water', x: 'bomb' };

/**
 * Rows: # wall, . floor, P player, i ice block, d dirt block, E exit, W water, F fire, S slime,
 * I ice floor, f fire boots on floor, w flippers on floor, t thief, v west force floor, x bomb on floor.
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

  describe('melt then swim', () => {
    const WIDE_WALL = '############';
    // Flippers at (2,1), ice block at (3,1) pushed east onto the fire at (5,1): it melts into water that is swum.
    const SWIM_MOVES: Direction[] = ['E', 'E', 'E', 'E', 'E', 'E', 'E', 'E'];

    it('(a) flippers and an ice block, no filler: the fire is melted and swum', () => {
      const level = grid([WALL, '#Pwi.F.E##', WALL]);
      expect(exitUnreachable(level)).toBe(false);
      expect(engineWins(level, SWIM_MOVES)).toBe(true);
    });

    it('(b) guards over-optimism: the same lane without flippers stays unreachable', () => {
      const level = grid([WALL, '#P.i.F.E##', WALL]);
      expect(exitUnreachable(level)).toBe(true);
      expect(engineWins(level, SWIM_MOVES)).toBe(false);
    });

    it('(c) guards over-optimism: flippers without an ice block cannot cross the fire', () => {
      const level = grid([WALL, '#Pw..F.E##', WALL]);
      expect(exitUnreachable(level)).toBe(true);
      expect(engineWins(level, SWIM_MOVES)).toBe(false);
    });

    it('(d) fire boots with an ice block present cross the fire without spending anything', () => {
      const level = grid([WIDE_WALL.slice(1), '#fP..F.F.E#', '#.i########', WIDE_WALL.slice(1)]);
      expect(exitUnreachable(level)).toBe(false);
      expect(engineWins(level, ['W', 'E', 'E', 'E', 'E', 'E', 'E', 'E', 'E'])).toBe(true);
    });

    // After the melt the thief takes the flippers, so the water further on needs the only filler: the melt
    // itself must not have used it.
    const THIEF_ROUTE: Direction[] = ['E', 'E', 'E', 'E', 'E', 'E', 'S', 'S', 'E', 'N', 'N', 'E', 'E'];

    it('(e) a melt costs no filler: the dirt block is left for the water after the thief', () => {
      const level = grid([WIDE_WALL, '#Pwi.F.tW.E#', '#######.d###', '#######..###', WIDE_WALL]);
      expect(exitUnreachable(level)).toBe(false);
      expect(engineWins(level, THIEF_ROUTE)).toBe(true);
    });

    it('(e) guards over-optimism: without the filler the water after the thief stays unreachable', () => {
      const level = grid([WIDE_WALL, '#Pwi.F.tW.E#', '#######..###', '#######..###', WIDE_WALL]);
      expect(exitUnreachable(level)).toBe(true);
      expect(engineWins(level, THIEF_ROUTE)).toBe(false);
    });

    // The melted fire is water for everyone: fire boots do not protect there, so crossing it again after the
    // thief needs the filler. The far fire at the west end needs fire boots (the one ice block is spent). The
    // force floors let the player back from the fire boots without passing the thief again.
    const RECROSS_WALL = '####################';
    const RECROSS_ROUTE: Direction[] = [
      ...Array<Direction>(7).fill('E'),
      'S', 'W', 'S', 'W', 'N', 'N',
      ...Array<Direction>(13).fill('W')
    ];
    const recrossLevel = (dirt: boolean): CompiledLevel =>
      grid([
        RECROSS_WALL,
        '#EF........PwiF.t..#',
        dirt ? '##############d.vvf#' : '##############..vvf#',
        '##############..####',
        RECROSS_WALL
      ]);

    it('(f) fire boots recross a melted fire once a dirt block has filled it', () => {
      const level = recrossLevel(true);
      expect(exitUnreachable(level)).toBe(false);
      expect(engineWins(level, RECROSS_ROUTE)).toBe(true);
    });

    it('(f) guards over-optimism: fire boots do not cross a melted fire without a filler', () => {
      const level = recrossLevel(false);
      expect(exitUnreachable(level)).toBe(true);
      expect(engineWins(level, RECROSS_ROUTE)).toBe(false);
    });

    it('(g) an ice-floor slide ends in a melted fire: a swimmer survives it', () => {
      const level = grid([
        '#######',
        '###F.E#',
        '###I###',
        '###I###',
        '###I###',
        '###i###',
        '#Pw...#',
        '#######'
      ]);
      expect(exitUnreachable(level)).toBe(false);
      expect(engineWins(level, ['E', 'E', 'N', 'N', 'E', 'E'])).toBe(true);
    });

    it('(g) guards over-optimism: the same slide without flippers stays unreachable', () => {
      const level = grid([
        '#######',
        '###F.E#',
        '###I###',
        '###I###',
        '###I###',
        '###i###',
        '#P....#',
        '#######'
      ]);
      expect(exitUnreachable(level)).toBe(true);
      expect(engineWins(level, ['E', 'E', 'N', 'N', 'E', 'E'])).toBe(false);
    });
  });
});

describe('arrow blocks that can never be pushed', () => {
  const LOCKED = 'validator.issues.arrow_block_locked.label';
  const ROWS = ['#######', '#P....#', '#....E#', '#######'];

  beforeAll(() => {
    loadTestConfigs();
  });

  function lockedIssues(entity: EntityPlacement) {
    const level = { ...grid(ROWS), entities: [entity] };
    return LevelValidator.validate(level).issues.filter((i) => i.i18nKey === LOCKED);
  }

  it('flags an arrow block whose only arrow faces a wall', () => {
    const issues = lockedIssues({ type: 'arrow_block_one', x: 3, y: 1, dir: 'N' });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].params).toMatchObject({ x: 3, y: 1 });
  });

  it('flags an arrow block whose arrows all face a wall or the edge of the map', () => {
    // Line at (3,1) facing north: forward is the wall above, back is the floor below, so it is free.
    expect(lockedIssues({ type: 'arrow_block_line', x: 3, y: 1, dir: 'N' })).toHaveLength(0);
    // Corner at (5,1) facing N: forward is the north wall, right is the east wall (5,1 is the last floor column).
    expect(lockedIssues({ type: 'arrow_block_corner', x: 5, y: 1, dir: 'N' })).toHaveLength(1);
  });

  it('does not flag an arrow block with an arrow toward free floor', () => {
    expect(lockedIssues({ type: 'arrow_block_one', x: 3, y: 1, dir: 'E' })).toHaveLength(0);
    expect(lockedIssues({ type: 'arrow_block_one', x: 3, y: 1, dir: 'S' })).toHaveLength(0);
  });

  it('does not flag an arrow block beside a swivel door, whatever side it is closed on', () => {
    // swivel_door_ne is closed on its north and east sides, but it turns; the block at (3,1) points east.
    const level = grid(ROWS);
    level.terrain[1][4] = 'swivel_door_ne';
    level.entities = [{ type: 'arrow_block_one', x: 3, y: 1, dir: 'E' }];
    expect(LevelValidator.validate(level).issues.some((i) => i.i18nKey === LOCKED)).toBe(false);
    // The block standing on a swivel door is not judged by that door's static closed sides either.
    const onSwivel = grid(ROWS);
    onSwivel.terrain[1][3] = 'swivel_door_ne';
    onSwivel.entities = [{ type: 'arrow_block_one', x: 3, y: 1, dir: 'E' }];
    expect(LevelValidator.validate(onSwivel).issues.some((i) => i.i18nKey === LOCKED)).toBe(false);
  });

  it('never flags a dirt block', () => {
    expect(lockedIssues({ type: 'dirt_block', x: 3, y: 1, dir: 'N' })).toHaveLength(0);
  });
});

describe('turn plates with no arrow block', () => {
  const IDLE = 'validator.issues.turn_plate_idle.label';
  const ROWS = ['#######', '#P....#', '#....E#', '#######'];
  const PLATE = { x: 2, y: 1 };

  beforeAll(() => {
    loadTestConfigs();
  });

  function plateLevel(): CompiledLevel {
    const level = grid(ROWS);
    level.terrain[PLATE.y][PLATE.x] = 'turn_plate_cw';
    return level;
  }

  function idleIssues(level: CompiledLevel) {
    return LevelValidator.validate(level).issues.filter((i) => i.i18nKey === IDLE);
  }

  it('flags plates when the level has no arrow block', () => {
    const issues = idleIssues(plateLevel());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].params).toMatchObject({ x: PLATE.x, y: PLATE.y });
  });

  it('flags plates when only a dirt block is placed', () => {
    const level = { ...plateLevel(), entities: [{ type: 'dirt_block', x: 3, y: 1, dir: 'S' as const }] };
    expect(idleIssues(level)).toHaveLength(1);
  });

  it('does not flag plates when an arrow block is placed', () => {
    const level = { ...plateLevel(), entities: [{ type: 'arrow_block_one', x: 3, y: 1, dir: 'E' as const }] };
    expect(idleIssues(level)).toHaveLength(0);
  });

  it('does not flag plates when an arrow block is a clone template', () => {
    const level = {
      ...plateLevel(),
      cloneLinks: [{ buttonX: 1, buttonY: 2, clonerX: 4, clonerY: 2, templateType: 'arrow_block_one', templateDir: 'E' as const }]
    };
    expect(idleIssues(level)).toHaveLength(0);
  });

  it('does not flag a level without plates', () => {
    expect(idleIssues(grid(ROWS))).toHaveLength(0);
  });

  it('still flags a locked arrow block while the plates count as served', () => {
    const level = { ...plateLevel(), entities: [{ type: 'arrow_block_one', x: 3, y: 1, dir: 'N' as const }] };
    const keys = LevelValidator.validate(level).issues.map((i) => i.i18nKey);
    expect(keys).toContain('validator.issues.arrow_block_locked.label');
    expect(keys).not.toContain(IDLE);
  });
});
