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
import { CompiledLevel, Direction, GridPoint } from './types';
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

  it('judges nothing while a ward is worn or lies on the map, since a monster is then no permanent wall', () => {
    const stuck = (): GameEngine =>
      engineAt(
        [
          { x: 1, y: 5 },
          { x: 3, y: 4 },
          { x: 6, y: 5 }
        ],
        { x: 2, y: 5 }
      );
    expect(BlockPuzzleSolver.isStuck(stuck())).toBe(true);
    const worn = stuck();
    worn.getPlayer().boots.add('ward');
    expect(BlockPuzzleSolver.isStuck(worn)).toBe(false);
    const onMap = stuck();
    onMap.getItems()[1][1] = 'ward';
    expect(BlockPuzzleSolver.isStuck(onMap)).toBe(false);
  });

  it('judges nothing while a blast charge is held or lies on the map, since a blast removes blocks and monsters', () => {
    const stuck = (): GameEngine =>
      engineAt(
        [
          { x: 1, y: 5 },
          { x: 3, y: 4 },
          { x: 6, y: 5 }
        ],
        { x: 2, y: 5 }
      );
    expect(BlockPuzzleSolver.isStuck(stuck())).toBe(true);
    const held = stuck();
    held.getPlayer().keys.charge = 1;
    expect(BlockPuzzleSolver.isStuck(held)).toBe(false);
    expect(BlockPuzzleSolver.hint(held)).toBeNull();
    const onMap = stuck();
    onMap.getItems()[1][1] = 'charge';
    expect(BlockPuzzleSolver.isStuck(onMap)).toBe(false);
  });

  it('judges nothing on a receivers level, whatever its buttons and blocks', () => {
    const engine = engineAt(
      [
        { x: 1, y: 5 },
        { x: 3, y: 4 },
        { x: 6, y: 5 }
      ],
      { x: 2, y: 5 }
    );
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(true);
    engine.getLevel().winRule = 'receivers';
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
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

  it('does not check the solvability of a level with signal wires, which the search does not model', () => {
    const engine = corridorEngine();
    engine.getLevel().winRule = 'targets';
    engine.getTerrain()[2][4] = 'block_target';
    expect(BlockPuzzleSolver.verdict(engine).kind).toBe('solved');
    engine.getLevel().signalLinks = [{ fromX: 1, fromY: 1, toX: 2, toY: 1 }];
    expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'not_checked' });
  });

  it('gives no hint on a level with signal wires', () => {
    const engine = corridorEngine();
    expect(BlockPuzzleSolver.hint(engine)).toEqual(['E']);
    engine.getLevel().signalLinks = [{ fromX: 1, fromY: 1, toX: 2, toY: 1 }];
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
  });

  it('never reports a level with signal wires stuck', () => {
    const engine = engineAt(
      [
        { x: 1, y: 5 },
        { x: 3, y: 4 },
        { x: 6, y: 5 }
      ],
      { x: 2, y: 5 }
    );
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(true);
    engine.getLevel().signalLinks = [{ fromX: 1, fromY: 1, toX: 2, toY: 1 }];
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
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

  describe('arrow blocks', () => {
    const FIRST_LANE_Y = 2;
    const SECOND_LANE_Y = 3;
    const LANE_FIRST_X = 1;
    const LANE_LAST_X = 5;
    const PLAYER_X = 1;
    const BLOCK_X = 3;
    const TARGET_X = 5;
    const CORRIDOR_PUSHES = 2;

    interface Placed {
      type: string;
      x: number;
      y: number;
      dir: Direction;
    }

    /** A targets level: lanes of floor on the given rows, a block target at the end of each, the player at the west end. */
    function targetsEngine(lanes: number[], blocks: Placed[]): GameEngine {
      const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
      const terrain = Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => 'wall'));
      for (const y of lanes) {
        for (let x = LANE_FIRST_X; x <= LANE_LAST_X; x++) terrain[y][x] = 'floor';
        terrain[y][TARGET_X] = 'block_target';
      }
      const level: CompiledLevel = {
        id: 'arrow_lanes',
        number: 1,
        password: 'TEST',
        timeLimitSeconds: 0,
        chipsRequired: 0,
        playerStart: { x: PLAYER_X, y: lanes[0], dir: 'E' },
        terrain,
        items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
        entities: blocks,
        trapLinks: [],
        cloneLinks: [],
        winRule: 'targets'
      };
      const engine = new GameEngine();
      engine.loadLevel(level);
      return engine;
    }

    const block = (type: string, dir: Direction, y = FIRST_LANE_Y): Placed => ({ type, x: BLOCK_X, y, dir });

    it('solves a level whose arrow block faces the way it must be pushed', () => {
      const engine = targetsEngine([FIRST_LANE_Y], [block('arrow_block_one', 'E')]);
      expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'solved', pushes: CORRIDOR_PUSHES });
    });

    it('solves it with the arrow on the back side of a line block', () => {
      const engine = targetsEngine([FIRST_LANE_Y], [block('arrow_block_line', 'W')]);
      expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'solved', pushes: CORRIDOR_PUSHES });
    });

    it('proves unsolvable a layout that only the arrows make impossible', () => {
      const arrow = targetsEngine([FIRST_LANE_Y], [block('arrow_block_one', 'N')]);
      expect(BlockPuzzleSolver.verdict(arrow)).toEqual({ kind: 'unsolvable' });
      const dirt = targetsEngine([FIRST_LANE_Y], [block('dirt_block', 'N')]);
      expect(BlockPuzzleSolver.verdict(dirt)).toEqual({ kind: 'solved', pushes: CORRIDOR_PUSHES });
    });

    it('judges a mix of dirt and arrow blocks', () => {
      const lanes = [FIRST_LANE_Y, SECOND_LANE_Y];
      const mixed = targetsEngine(lanes, [block('dirt_block', 'N'), block('arrow_block_one', 'E', SECOND_LANE_Y)]);
      // An arrow block can push a line of blocks, which the search does not model: with another block it judges nothing.
      expect(BlockPuzzleSolver.verdict(mixed)).toEqual({ kind: 'not_checked' });
      // The modelling of the mix itself is checked on blocks that cannot chain.
      delete ConfigRegistry.getEntityDef('arrow_block_one')?.chainPushes;
      expect(BlockPuzzleSolver.verdict(mixed)).toEqual({ kind: 'solved', pushes: CORRIDOR_PUSHES * 2 });
      // Facing north, the arrow block can never travel east, and the dirt block alone covers one target only.
      const stuck = targetsEngine(lanes, [block('dirt_block', 'N'), block('arrow_block_one', 'N', SECOND_LANE_Y)]);
      expect(BlockPuzzleSolver.verdict(stuck)).toEqual({ kind: 'unsolvable' });
    });

    it('flags as stuck a block whose arrows can never lead it to a target', () => {
      const arrow = targetsEngine([FIRST_LANE_Y], [block('arrow_block_one', 'N')]);
      expect(BlockPuzzleSolver.isStuck(arrow)).toBe(true);
      const dirt = targetsEngine([FIRST_LANE_Y], [block('dirt_block', 'N')]);
      expect(BlockPuzzleSolver.isStuck(dirt)).toBe(false);
    });

    it('keeps the verdict of a plain dirt level', () => {
      const engine = targetsEngine([FIRST_LANE_Y], [block('dirt_block', 'E')]);
      expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'solved', pushes: CORRIDOR_PUSHES });
    });
  });

  describe('turn plates', () => {
    const ROOM_FIRST = 1;
    const ROOM_LAST = 5;
    const START = { x: 1, y: 1 };
    const BLOCK_CELL = { x: 2, y: 2 };
    const PLATE_CELL = { x: 3, y: 2 };
    const TARGET_CELL = { x: 3, y: 4 };
    /** One push east onto the plate, then two pushes south to the target. */
    const TURNED_PUSHES = 3;

    /** An open floor room with a block target; the plate id (if any) sits one cell east of the block. */
    function roomEngine(blockType: string, plate: string | null): GameEngine {
      const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
      const terrain = Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => 'wall'));
      for (let y = ROOM_FIRST; y <= ROOM_LAST; y++) for (let x = ROOM_FIRST; x <= ROOM_LAST; x++) terrain[y][x] = 'floor';
      terrain[TARGET_CELL.y][TARGET_CELL.x] = 'block_target';
      if (plate) terrain[PLATE_CELL.y][PLATE_CELL.x] = plate;
      const level: CompiledLevel = {
        id: 'turn_room',
        number: 1,
        password: 'TEST',
        timeLimitSeconds: 0,
        chipsRequired: 0,
        playerStart: { x: START.x, y: START.y, dir: 'E' },
        terrain,
        items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
        entities: [{ type: blockType, x: BLOCK_CELL.x, y: BLOCK_CELL.y, dir: 'E' }],
        trapLinks: [],
        cloneLinks: [],
        winRule: 'targets'
      };
      const engine = new GameEngine();
      engine.loadLevel(level);
      return engine;
    }

    it('solves a level only a clockwise plate makes solvable', () => {
      expect(BlockPuzzleSolver.verdict(roomEngine('arrow_block_one', 'turn_plate_cw'))).toEqual({
        kind: 'solved',
        pushes: TURNED_PUSHES
      });
    });

    it('proves the same level unsolvable without the plate', () => {
      expect(BlockPuzzleSolver.verdict(roomEngine('arrow_block_one', null))).toEqual({ kind: 'unsolvable' });
    });

    it('turns the other way on a counter-clockwise plate', () => {
      expect(BlockPuzzleSolver.verdict(roomEngine('arrow_block_one', 'turn_plate_ccw'))).toEqual({ kind: 'unsolvable' });
    });

    it('does not report a false dead end that a plate resolves', () => {
      expect(BlockPuzzleSolver.isStuck(roomEngine('arrow_block_one', 'turn_plate_cw'))).toBe(false);
      expect(BlockPuzzleSolver.isStuck(roomEngine('arrow_block_one', null))).toBe(true);
    });

    it('leaves a dirt block unaffected by a plate', () => {
      const dirt = roomEngine('dirt_block', 'turn_plate_cw');
      const bare = roomEngine('dirt_block', null);
      expect(BlockPuzzleSolver.verdict(dirt)).toEqual(BlockPuzzleSolver.verdict(bare));
      expect(BlockPuzzleSolver.isStuck(dirt)).toBe(false);
    });
  });
});
