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
import { GameEngine } from './GameEngine';
import { BlockPuzzleSolver, requestedSearchBudget, watchSearchBudget } from './BlockPuzzleSolver';
import { CompiledLevel, GridPoint } from './types';
import { compilePiece } from '../generator/PieceCompiler';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from '../test/loadTestConfigs';

/**
 * The Sokoban wing of a campaign level a playtester got stuck in: three
 * blocks, three brown buttons, each holding one exit trap open.
 */
const WING = {
  id: 'stuck_wing',
  motif: 'sokoban',
  tier: 3,
  rows: [
    '###########',
    '#....m.####',
    '@.#..#.XXX$',
    '#.&&...####',
    '##.m##.####',
    '#..&..m####',
    '###########'
  ],
  trapLinks: [
    { buttonX: 3, buttonY: 4, trapX: 7, trapY: 2 },
    { buttonX: 5, buttonY: 1, trapX: 8, trapY: 2 },
    { buttonX: 6, buttonY: 5, trapX: 9, trapY: 2 }
  ]
};

/** The solver map draws the piece one cell in from the corner. */
const OFFSET = 1;
/** Solving the whole wing with the engine takes a few seconds. */
const FULL_SOLVE_TIMEOUT_MS = 60000;
/** Hints a full solution may take, at one push each. */
const MAX_HINTS = 40;

function engineAt(blocks: GridPoint[] | null, player: GridPoint | null): GameEngine {
  const piece = compilePiece(WING, ConfigRegistry.getPieceLegend());
  const engine = new GameEngine();
  engine.loadLevel(PieceSolver.toLevel(piece));
  if (blocks && player) {
    const state = engine.captureState();
    state.entities = state.entities.map((e, i) => ({ ...e, x: blocks[i].x + OFFSET, y: blocks[i].y + OFFSET }));
    state.player.x = player.x + OFFSET;
    state.player.y = player.y + OFFSET;
    engine.restoreState(state);
  }
  return engine;
}

describe('BlockPuzzleSolver', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it(
    'does not flag the puzzle as it starts, which is solvable',
    () => {
      const piece = compilePiece(WING, ConfigRegistry.getPieceLegend());
      expect(PieceSolver.solve(piece).solvable).toBe(true);
      expect(BlockPuzzleSolver.isStuck(engineAt(null, null))).toBe(false);
    },
    FULL_SOLVE_TIMEOUT_MS
  );

  it('flags a proven dead end: a block pushed into a corner off any button', () => {
    const engine = engineAt(
      [
        { x: 1, y: 5 },
        { x: 3, y: 4 },
        { x: 6, y: 5 }
      ],
      { x: 2, y: 5 }
    );
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(true);
  });

  it('does not flag the playtested position, which the engine proves solvable', () => {
    // Blocks on the two lower buttons, the last one still loose: it looked stuck, it is not.
    const engine = engineAt(
      [
        { x: 2, y: 3 },
        { x: 3, y: 4 },
        { x: 6, y: 5 }
      ],
      { x: 3, y: 3 }
    );
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
  });

  it('hints moves that end with every button covered', () => {
    const engine = engineAt(null, null);
    for (let guard = 0; guard < MAX_HINTS; guard++) {
      const hint = BlockPuzzleSolver.hint(engine);
      if (!hint) break;
      for (const dir of hint) {
        engine.attemptPlayerMove(dir);
        PieceSolver.settle(engine);
      }
    }
    const blocks = engine.getEntities().map((e) => `${e.x - OFFSET},${e.y - OFFSET}`);
    expect(blocks).toEqual(expect.arrayContaining(['3,4', '5,1', '6,5']));
  });

  it('does not flag a block that is merely far from a button', () => {
    const engine = engineAt(
      [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 6, y: 5 }
      ],
      { x: 1, y: 3 }
    );
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
  });

  it('never flags a fresh campaign level, including puzzles behind locked doors', () => {
    for (const level of ConfigRegistry.getLevels()) {
      const engine = new GameEngine();
      engine.loadLevel(level);
      expect(BlockPuzzleSolver.isStuck(engine), level.id).toBe(false);
    }
  });

  /** A one-tile corridor on row 2: the player at (1, 2), a block at (2, 2) and a brown button at (4, 2). */
  function corridorEngine(cells: Record<number, string> = {}): GameEngine {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const terrain = Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => 'wall'));
    for (let x = 1; x <= 5; x++) terrain[2][x] = cells[x] ?? 'floor';
    terrain[2][4] = 'button_brown';
    const level: CompiledLevel = {
      id: 'corridor',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: 1, y: 2, dir: 'E' },
      terrain,
      items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
      entities: [{ x: 2, y: 2, type: 'dirt_block', dir: 'E' }],
      trapLinks: [],
      cloneLinks: []
    };
    const engine = new GameEngine();
    engine.loadLevel(level);
    return engine;
  }

  it('pushes a block along an open corridor onto the button', () => {
    const engine = corridorEngine();
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
    expect(BlockPuzzleSolver.hint(engine)).toEqual(['E']);
  });

  it('does not push a block through a thin wall', () => {
    // The wall bars the west edge of (3, 2): the block cannot be pushed into it, so no push is offered.
    const engine = corridorEngine({ 3: 'thin_wall_w' });
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
  });

  it('does not walk the player through a thin wall to reach a block', () => {
    // The player's own way to the block is walled off, so the puzzle is out of reach and not judged.
    const engine = corridorEngine({ 2: 'thin_wall_w' });
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
  });

  it('takes its two search budgets from game.json', () => {
    const { watchSearchBudget: watch, hintSearchBudget: hint } = ConfigRegistry.getGame().blockPuzzle;
    expect(watchSearchBudget()).toBe(watch);
    expect(requestedSearchBudget()).toBe(hint);
    expect(watch).toBeLessThan(hint);
  });

  it('gives no verdict when the search budget runs out', () => {
    const engine = engineAt(
      [
        { x: 1, y: 5 },
        { x: 3, y: 4 },
        { x: 6, y: 5 }
      ],
      { x: 2, y: 5 }
    );
    expect(BlockPuzzleSolver.isStuck(engine, 1)).toBe(false);
  });

  it('stays silent on levels without brown buttons', () => {
    const level = ConfigRegistry.getLevels()[0];
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
  });
});
