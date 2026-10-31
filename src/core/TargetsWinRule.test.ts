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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, sanitizeStoredLevels } from '../config/ConfigValidation';
import { DatCodec } from '../formats/DatCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { BlockPuzzleSolver } from './BlockPuzzleSolver';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { Pathfinder } from './Pathfinder';
import { CompiledLevel, Direction, EntityPlacement, LevelBlueprint, WinRule } from './types';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  $: 'floor',
  '@': 'floor',
  T: 'block_target',
  '*': 'block_target',
  I: 'ice',
  E: 'exit'
};
/** Ticks run before each move so the player's move cooldown has elapsed. */
const COOLDOWN_TICKS = 8;
/** Upper bound of ticks a slide needs to settle in these small rooms. */
const SETTLE_TICKS = 40;

/**
 * Builds a level from rows: # wall, . floor, P player, T target, $ block,
 * * block on a target, @ monster, I ice, E exit.
 */
function room(rows: string[], winRule?: WinRule): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === '$' || ch === '*') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      if (ch === '@') entities.push({ type: 'bug', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'targets_room',
    ...(winRule ? { winRule } : {}),
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function move(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('block_target tile', () => {
  it('is passable by everyone and carries no action', () => {
    const tile = ConfigRegistry.getTile('block_target');
    expect(tile.passableByPlayer).toBe(true);
    expect(tile.passableByMonster).toBe(true);
    expect(tile.passableByBlock).toBe(true);
    expect(tile.buttonAction).toBeUndefined();
    expect(tile.isTrap).toBeUndefined();
  });
});

describe('targets win rule in the engine', () => {
  it('completes once the last block is pushed onto the last target', () => {
    const engine = engineFor(room(['#####', '#P$T#', '#####'], 'targets'));
    expect(engine.isLevelCompleted()).toBe(false);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('needs every target covered', () => {
    const engine = engineFor(room(['######', '#P$T.#', '#.$T.#', '######'], 'targets'));
    move(engine, 'E');
    expect(engine.isLevelCompleted()).toBe(false);
    move(engine, 'W');
    move(engine, 'S');
    move(engine, 'E');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('ignores the player standing on a target', () => {
    const engine = engineFor(room(['#####', '#PT.#', '#####'], 'targets'));
    move(engine, 'E');
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('never completes a level without targets', () => {
    const engine = engineFor(room(['#####', '#P$.#', '#####'], 'targets'));
    move(engine, 'E');
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('leaves a level without a win rule to its exit', () => {
    const engine = engineFor(room(['#####', '#P$T#', '#####']));
    move(engine, 'E');
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('keeps the exit working in a targets level', () => {
    const engine = engineFor(room(['######', '#P.ET#', '#$####'], 'targets'));
    move(engine, 'E');
    move(engine, 'E');
    move(engine, 'E');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('completes when a block that slid on ice comes to rest on the target', () => {
    const engine = engineFor(room(['#######', '#P$IIT#', '#######'], 'targets'));
    move(engine, 'E');
    expect(engine.isLevelCompleted()).toBe(false);
    for (let i = 0; i < SETTLE_TICKS && !engine.isLevelCompleted(); i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getEntities()[0].x).toBe(5);
  });

  it('does not count a block that is still sliding over a target', () => {
    const engine = engineFor(room(['####', '#P*#', '####'], 'targets'));
    const state = engine.captureState();
    state.entities = state.entities.map((e) => ({ ...e, isSliding: true, cooldownTicks: 3, dir: 'E' }));
    engine.restoreState(state);
    engine.tick();
    expect(engine.isLevelCompleted()).toBe(false);
    for (let i = 0; i < SETTLE_TICKS && !engine.isLevelCompleted(); i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('does not let a dead player win', () => {
    // The only target already holds a block, yet the monster kills the player first.
    const engine = engineFor(room(['######', '#P@*.#', '######'], 'targets'));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(false);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('refuses to undo after the win', () => {
    const engine = engineFor(room(['#####', '#P$T#', '#####'], 'targets'));
    move(engine, 'E');
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.canUndo()).toBe(false);
    expect(engine.undo()).toBe(false);
  });
});

describe('targets win rule in the validator', () => {
  it('needs no exit', () => {
    const report = LevelValidator.validate(room(['#####', '#P$T#', '#####'], 'targets'));
    expect(report.valid).toBe(true);
    expect(report.stats.targetCount).toBe(1);
  });

  it('still demands an exit when the rule is the exit', () => {
    const report = LevelValidator.validate(room(['#####', '#P$T#', '#####']));
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.no_exit.label');
  });

  it('reports a level without targets', () => {
    const report = LevelValidator.validate(room(['#####', '#P$.#', '#####'], 'targets'));
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.no_targets.label');
  });

  it('reports fewer blocks than targets', () => {
    const report = LevelValidator.validate(room(['#######', '#P$.T.#', '#..T..#', '#######'], 'targets'));
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.fewer_blocks_than_targets.label');
  });

  it('warns, without failing, when the blocks provably cannot cover the targets', () => {
    const report = LevelValidator.validate(room(['######', '#$...#', '#.P..#', '#...T#', '######'], 'targets'));
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([
      { severity: 'warning', i18nKey: 'validator.issues.targets_unsolvable.label' }
    ]);
  });
});

describe('targets win rule in the block puzzle solver', () => {
  it('flags a block stuck in a corner away from the only target', () => {
    const engine = engineFor(room(['######', '#$...#', '#.P..#', '#...T#', '######'], 'targets'));
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(true);
  });

  it('does not flag a solvable layout and hints the first push', () => {
    const engine = engineFor(room(['#####', '#P$T#', '#####'], 'targets'));
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
    expect(BlockPuzzleSolver.hint(engine)).toEqual(['E']);
  });

  it('gives no hint once every target holds a block', () => {
    const engine = engineFor(room(['#####', '#P*.#', '#####'], 'targets'));
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
  });
});

describe('targets win rule in the pathfinder', () => {
  it('points at a target no block holds', () => {
    const engine = engineFor(room(['#######', '#P*.T.#', '#######'], 'targets'));
    expect(Pathfinder.findNextObjective(engine)).toEqual({ x: 4, y: 1 });
  });
});

describe('winRule storage and compilation', () => {
  const blueprint = (winRule: unknown): LevelBlueprint => {
    const level = room(['#####', '#P$T#', '#####']);
    return { ...level, winRule } as unknown as LevelBlueprint;
  };

  it('compiles a valid win rule and drops an unknown one', () => {
    expect(ConfigRegistry.compileBlueprint(blueprint('targets')).winRule).toBe('targets');
    expect('winRule' in ConfigRegistry.compileBlueprint(blueprint('bogus'))).toBe(false);
  });

  it('keeps a stored win rule that is valid and drops one that is not', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const good = room(['#####', '#P$T#', '#####'], 'targets');
    const bad = { ...room(['#####', '#P$T#', '#####']), id: 'bad', winRule: 'sideways' };
    expect(isCompiledLevelShape(bad, bounds)).toBe(true);
    const [kept, repaired] = sanitizeStoredLevels([good, bad], bounds);
    expect(kept.winRule).toBe('targets');
    expect(repaired.id).toBe('bad');
    expect('winRule' in repaired).toBe(false);
  });
});

describe('targets win rule in the .DAT export', () => {
  it('refuses the level instead of writing its targets as floor', () => {
    const level = room(['#####', '#P$T#', '#####'], 'targets');
    const encoded = DatCodec.encodeLevelsWithReport([level]);
    expect(encoded.refused).toEqual([{ levelId: level.id, reason: 'targets_win_rule' }]);
    expect(encoded.levelCount).toBe(0);
    expect(encoded.lost).toEqual([]);
  });
});
