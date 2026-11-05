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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findFacingTurnConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement, RuntimeEntity, TileDefinition } from '../types';

const SIZE = 11;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 120;
const PLATE_CW = 'turn_plate_cw';
const PLATE_CCW = 'turn_plate_ccw';
const INVALID_FACING_TURN = 2;
const ARROW_ONE = 'arrow_block_one';
const ARROW_TEE = 'arrow_block_tee';
const ALL_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

const STEP: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};
const CLOCKWISE: Record<Direction, Direction> = { N: 'E', E: 'S', S: 'W', W: 'N' };
const COUNTER_CLOCKWISE: Record<Direction, Direction> = { N: 'W', W: 'S', S: 'E', E: 'N' };

interface Setup {
  entities?: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  cloneLinks?: CompiledLevel['cloneLinks'];
  player: { x: number; y: number };
}

function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'turn_plate_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...setup.player, dir: 'N' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? []
  };
}

function placed(type: string, x: number, y: number, dir: Direction): EntityPlacement {
  return { type, x, y, dir };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function entityOf(engine: GameEngine, prefix: string): RuntimeEntity | undefined {
  return engine.getEntities().find((e) => e.type.startsWith(prefix));
}

function blockOf(engine: GameEngine): RuntimeEntity | undefined {
  return entityOf(engine, 'arrow_block_');
}

function blockAt(engine: GameEngine, x: number, y: number): RuntimeEntity | undefined {
  return engine.getEntities().find((e) => e.kind === 'block' && e.x === x && e.y === y);
}

/** One block in the centre, the player behind it ready to push it toward `dir`; the plate sits just ahead. */
function pushSetup(type: string, facing: Direction, dir: Direction, plate: string, extra: Partial<Setup> = {}): GameEngine {
  const { dx, dy } = STEP[dir];
  return load(
    room({
      entities: [placed(type, CENTER, CENTER, facing)],
      terrain: [[CENTER + dx, CENTER + dy, plate]],
      player: { x: CENTER - dx, y: CENTER - dy },
      ...extra
    })
  );
}

beforeEach(() => {
  loadTestConfigs();
});

describe('turn plates: configuration', () => {
  it('defines a clockwise and a counter-clockwise plate every mover may cross', () => {
    for (const [id, turn] of [
      [PLATE_CW, 1],
      [PLATE_CCW, -1]
    ] as const) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.facingTurn, id).toBe(turn);
      expect(tile.layer, id).toBe('terrain');
      expect(tile.category, id).toBe('mechanisms');
      expect(tile.i18nKey, id).toBe(`tiles.${id}.name`);
      expect(tile.passableByPlayer && tile.passableByMonster && tile.passableByBlock, id).toBe(true);
      expect(tile.laserTransparent, id).toBe(true);
    }
    expect(findFacingTurnConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
  });

  it('refuses a facingTurn other than 1 or -1, and one on an item tile', () => {
    const tiles: Record<string, TileDefinition> = structuredClone(ConfigRegistry.getTiles().tiles);
    const withTurn = (facingTurn: unknown, layer?: TileDefinition['layer']): string[] =>
      findFacingTurnConfigErrors({
        ...tiles,
        [PLATE_CW]: { ...tiles[PLATE_CW], facingTurn: facingTurn as never, ...(layer ? { layer } : {}) }
      });
    expect(withTurn(1)).toEqual([]);
    expect(withTurn(-1)).toEqual([]);
    expect(withTurn(INVALID_FACING_TURN)).toHaveLength(1);
    expect(withTurn('cw')).toHaveLength(1);
    expect(withTurn(1, 'item')).toHaveLength(1);
  });
});

describe('turn plates: arrival of an arrow block', () => {
  it('turns clockwise on a clockwise plate and counter-clockwise on the other', () => {
    for (const [plate, expected] of [
      [PLATE_CW, CLOCKWISE],
      [PLATE_CCW, COUNTER_CLOCKWISE]
    ] as const) {
      for (const facing of ALL_DIRECTIONS) {
        const engine = pushSetup(ARROW_ONE, facing, facing, plate);
        expect(step(engine, facing), `${plate} ${facing}`).toBe(true);
        expect(blockOf(engine)?.facing, `${plate} ${facing}`).toBe(expected[facing]);
      }
    }
  });

  it('checks the next push against the turned arrows', () => {
    // A single arrow facing east, pushed east onto a clockwise plate, now points south.
    const engine = pushSetup(ARROW_ONE, 'E', 'E', PLATE_CW);
    expect(step(engine, 'E')).toBe(true);
    expect(blockOf(engine)?.facing).toBe('S');
    expect(step(engine, 'E')).toBe(false);
    expect(blockOf(engine)?.x).toBe(CENTER + 1);
  });

  it('does not turn a block that starts on a plate, and gives back its facing after four arrivals', () => {
    // A single arrow walked around a square of four clockwise plates: E, S, W, N pushes in turn.
    const engine = load(
      room({
        entities: [placed(ARROW_ONE, CENTER, CENTER, 'E')],
        terrain: [
          [CENTER, CENTER, PLATE_CW],
          [CENTER + 1, CENTER, PLATE_CW],
          [CENTER + 1, CENTER + 1, PLATE_CW],
          [CENTER, CENTER + 1, PLATE_CW]
        ],
        player: { x: CENTER - 1, y: CENTER }
      })
    );
    expect(blockOf(engine)?.facing).toBe('E');
    const walk: Array<[Direction, Direction]> = [
      ['E', 'S'],
      ['S', 'W'],
      ['W', 'N'],
      ['N', 'E']
    ];
    // Player moves that reach the cell behind the block before each push.
    const approach: Direction[][] = [[], ['N', 'E'], ['E', 'S'], ['S', 'W']];
    walk.forEach(([push, after], index) => {
      for (const move of approach[index]) expect(step(engine, move), `approach ${index}`).toBe(true);
      expect(step(engine, push), `push ${index}`).toBe(true);
      expect(blockOf(engine)?.facing, `push ${index}`).toBe(after);
    });
    expect(blockOf(engine)).toMatchObject({ x: CENTER, y: CENTER, facing: 'E' });
  });

  it('leaves a block that stays on the plate, and a refused push, unturned', () => {
    // The block already stands on the plate, facing north; a push east is refused (no east arrow).
    const engine = load(
      room({
        entities: [placed(ARROW_ONE, CENTER, CENTER, 'N')],
        terrain: [[CENTER, CENTER, PLATE_CW]],
        player: { x: CENTER - 1, y: CENTER }
      })
    );
    expect(step(engine, 'E')).toBe(false);
    run(engine, SETTLE_TICKS);
    expect(blockOf(engine)?.facing).toBe('N');
  });

  it('turns once when a slide ends on a plate', () => {
    // Pushed north onto an east force floor, the block slides one cell east onto the plate and stops.
    const engine = pushSetup(ARROW_ONE, 'N', 'N', PLATE_CW, {
      terrain: [
        [CENTER, CENTER - 1, 'force_e'],
        [CENTER + 1, CENTER - 1, PLATE_CW]
      ]
    });
    expect(step(engine, 'N')).toBe(true);
    run(engine, SETTLE_TICKS);
    expect(blockOf(engine)).toMatchObject({ x: CENTER + 1, y: CENTER - 1, facing: 'E', isSliding: false });
  });

  it('turns on the exit cell of a teleport', () => {
    const exitPad = { x: 8, y: 8 };
    const engine = load(
      room({
        entities: [placed(ARROW_TEE, CENTER, CENTER, 'W')],
        terrain: [
          [CENTER - 1, CENTER, 'teleport'],
          [exitPad.x, exitPad.y, 'teleport'],
          [exitPad.x - 1, exitPad.y, PLATE_CW]
        ],
        player: { x: CENTER + 1, y: CENTER }
      })
    );
    expect(step(engine, 'W')).toBe(true);
    run(engine, SETTLE_TICKS);
    expect(blockOf(engine)).toMatchObject({ x: exitPad.x - 1, y: exitPad.y, facing: 'N' });
  });

  it('turns a clone that spawns on a plate, but not its template', () => {
    const cloner = { x: 7, y: 3 };
    const button = { x: 3, y: 7 };
    const spawn = { x: cloner.x - 1, y: cloner.y };
    const engine = load(
      room({
        terrain: [
          [cloner.x, cloner.y, 'clone_machine'],
          [button.x, button.y, 'button_red'],
          [spawn.x, spawn.y, PLATE_CW]
        ],
        entities: [placed(ARROW_ONE, cloner.x, cloner.y, 'S')],
        cloneLinks: [
          {
            buttonX: button.x,
            buttonY: button.y,
            clonerX: cloner.x,
            clonerY: cloner.y,
            templateType: ARROW_ONE,
            templateDir: 'W'
          }
        ],
        player: { x: button.x, y: button.y + 1 }
      })
    );
    expect(step(engine, 'N')).toBe(true);
    expect(blockAt(engine, cloner.x, cloner.y)?.facing).toBe('S');
    expect(blockAt(engine, spawn.x, spawn.y)?.facing).toBe('W');
  });

  it('is destroyed by a bomb before any turn', () => {
    const engine = pushSetup(ARROW_ONE, 'E', 'E', PLATE_CW, { items: [[CENTER + 1, CENTER, 'bomb']] });
    expect(step(engine, 'E')).toBe(true);
    run(engine, SETTLE_TICKS);
    expect(blockOf(engine)).toBeUndefined();
  });

  it('restores the facing on undo', () => {
    const engine = pushSetup(ARROW_ONE, 'E', 'E', PLATE_CW);
    expect(step(engine, 'E')).toBe(true);
    expect(blockOf(engine)?.facing).toBe('S');
    expect(engine.undo()).toBe(true);
    expect(blockOf(engine)).toMatchObject({ x: CENTER, y: CENTER, facing: 'E' });
  });
});

describe('turn plates: nothing else turns', () => {
  it('leaves a dirt block without a facing', () => {
    const engine = pushSetup('dirt_block', 'E', 'E', PLATE_CW);
    expect(step(engine, 'E')).toBe(true);
    expect(entityOf(engine, 'dirt_block')).toMatchObject({ x: CENTER + 1, y: CENTER });
    expect(entityOf(engine, 'dirt_block')?.facing).toBeUndefined();
  });

  it('leaves the facing of a turret', () => {
    const engine = pushSetup('turret_fixed', 'E', 'E', PLATE_CW);
    expect(step(engine, 'E')).toBe(true);
    const turret = entityOf(engine, 'turret_');
    expect(turret?.x).toBe(CENTER + 1);
    expect(turret?.facing).toBe('E');
  });

  it('leaves a monster crossing a plate without a facing', () => {
    const engine = load(
      room({
        entities: [placed('bug', CENTER - 1, CENTER, 'E')],
        terrain: [[CENTER, CENTER, PLATE_CW]],
        player: { x: 1, y: 1 }
      })
    );
    run(engine, SETTLE_TICKS);
    const bug = entityOf(engine, 'bug');
    expect(bug).toBeDefined();
    expect(bug?.facing).toBeUndefined();
  });

  it('leaves the player facing the way they walked', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, PLATE_CW]], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: CENTER, y: CENTER, dir: 'E' });
  });
});
