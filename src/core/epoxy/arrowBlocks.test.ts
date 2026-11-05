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
import { findPushArrowConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { allowedPushDirs, hasEntityFacing } from './epoxyArrowBlocks';
import type { EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement, RuntimeEntity } from '../types';

const SIZE = 11;
const CENTER = 5;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 120;
const PAD = 'puppet_control';
const PUPPET = 'puppet';
const ALL_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const SHAPES = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee'] as const;

/** Unit step of each direction, to place the player behind the block. */
const STEP: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};

/** Directions a push may move each shape, by facing, written out by hand. */
const EXPECTED_ALLOWED: Record<string, Record<Direction, Direction[]>> = {
  arrow_block_one: { N: ['N'], E: ['E'], S: ['S'], W: ['W'] },
  arrow_block_line: { N: ['N', 'S'], E: ['E', 'W'], S: ['S', 'N'], W: ['W', 'E'] },
  arrow_block_corner: { N: ['N', 'E'], E: ['E', 'S'], S: ['S', 'W'], W: ['W', 'N'] },
  arrow_block_tee: { N: ['N', 'W', 'E'], E: ['E', 'N', 'S'], S: ['S', 'E', 'W'], W: ['W', 'S', 'N'] }
};

interface Setup {
  entities?: EntityPlacement[];
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  /** Item edits: x, y, item id. */
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
    id: 'arrow_room',
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

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
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

function arrowOf(engine: GameEngine): RuntimeEntity | undefined {
  return engine.getEntities().find((e) => e.type.startsWith('arrow_block_'));
}

function tileAt(engine: GameEngine, x: number, y: number): string {
  return world(engine).terrain[y][x];
}

/** Loads one arrow block in the centre and the player behind it, ready to push it toward `dir`. */
function pushSetup(type: string, facing: Direction, dir: Direction, extra: Partial<Setup> = {}): GameEngine {
  const { dx, dy } = STEP[dir];
  return load(
    room({
      entities: [placed(type, CENTER, CENTER, facing)],
      player: { x: CENTER - dx, y: CENTER - dy },
      ...extra
    })
  );
}

function defOf(type: string): EntityDefinition {
  const def = ConfigRegistry.getEntityDef(type);
  if (!def) throw new Error(`no definition ${type}`);
  return def;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('arrow blocks: configuration', () => {
  it('defines four blocks that behave as a dirt block, with their arrows', () => {
    const arrows: Record<string, string[]> = {
      arrow_block_one: ['FORWARD'],
      arrow_block_line: ['FORWARD', 'BACK'],
      arrow_block_corner: ['FORWARD', 'RIGHT'],
      arrow_block_tee: ['FORWARD', 'LEFT', 'RIGHT']
    };
    const { id: dirtId, i18nKey: dirtKey, ...dirtRest } = defOf('dirt_block');
    expect(dirtId).toBe('dirt_block');
    expect(dirtKey).toBe('entities.dirt_block.name');
    for (const id of SHAPES) {
      const { id: ownId, i18nKey: ownKey, pushArrows, ...ownRest } = defOf(id);
      expect(pushArrows, id).toEqual(arrows[id]);
      expect(ownId).toBe(id);
      expect(ownKey).toBe(`entities.${id}.name`);
      expect(ownRest, id).toEqual(dirtRest);
      expect(hasEntityFacing(defOf(id)), id).toBe(true);
    }
    expect(hasEntityFacing(defOf('dirt_block'))).toBe(false);
    expect(findPushArrowConfigErrors(ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('refuses an empty list, a repeated side, an unknown side and a monster with arrows', () => {
    const entities = structuredClone(ConfigRegistry.getMonsters().entities);
    const withArrows = (pushArrows: unknown, base: Partial<EntityDefinition> = {}): string[] =>
      findPushArrowConfigErrors({
        ...entities,
        arrow_block_one: { ...entities.arrow_block_one, ...base, pushArrows: pushArrows as never }
      });
    expect(withArrows(['FORWARD'])).toEqual([]);
    expect(withArrows(['FORWARD', 'LEFT', 'RIGHT', 'BACK'])).toEqual([]);
    expect(withArrows([])).toHaveLength(1);
    expect(withArrows('FORWARD')).toHaveLength(1);
    expect(withArrows(['FORWARD', 'FORWARD'])).toHaveLength(1);
    expect(withArrows(['FORWARD', 'UP'])).toHaveLength(1);
    expect(withArrows(['FORWARD'], { kind: 'monster' })).toHaveLength(1);
  });

  it('reads the arrows relative to the facing', () => {
    const entity = { facing: 'S', dir: 'N' } as RuntimeEntity;
    expect(allowedPushDirs(entity, defOf('arrow_block_tee'))).toEqual(['S', 'E', 'W']);
    expect(allowedPushDirs(entity, defOf('dirt_block'))).toBeUndefined();
  });
});

describe('arrow blocks: pushes by the player', () => {
  it('moves only toward a side that shows an arrow, for each shape and facing', () => {
    for (const type of SHAPES) {
      for (const facing of ALL_DIRECTIONS) {
        for (const dir of ALL_DIRECTIONS) {
          const engine = pushSetup(type, facing, dir);
          const moved = step(engine, dir);
          const block = arrowOf(engine);
          const allowed = EXPECTED_ALLOWED[type][facing].includes(dir);
          const label = `${type} facing ${facing} pushed ${dir}`;
          expect(moved, label).toBe(allowed);
          expect(block?.x, label).toBe(allowed ? CENTER + STEP[dir].dx : CENTER);
          expect(block?.y, label).toBe(allowed ? CENTER + STEP[dir].dy : CENTER);
          expect(block?.facing, label).toBe(facing);
        }
      }
    }
  });

  it('seeds the facing from the placement and leaves a dirt block without one', () => {
    const engine = load(
      room({ entities: [placed('arrow_block_tee', 3, 3, 'W'), placed('dirt_block', 7, 7, 'W')], player: { x: 1, y: 1 } })
    );
    expect(engine.getEntities().find((e) => e.type === 'arrow_block_tee')?.facing).toBe('W');
    expect(engine.getEntities().find((e) => e.type === 'dirt_block')?.facing).toBeUndefined();
  });

  it('keeps the arrows where they were after a push', () => {
    const engine = pushSetup('arrow_block_line', 'E', 'E');
    expect(step(engine, 'E')).toBe(true);
    expect(arrowOf(engine)?.facing).toBe('E');
    expect(step(engine, 'E')).toBe(true);
    expect(arrowOf(engine)?.x).toBe(CENTER + 2);
    // Sideways, the line has no arrow.
    const sideways = pushSetup('arrow_block_line', 'E', 'N');
    expect(step(sideways, 'N')).toBe(false);
  });
});

describe('arrow blocks: pushes by a steered puppet', () => {
  const PUPPET_X = 7;
  const ROW = CENTER;

  function puppetLevel(type: string, facing: Direction): GameEngine {
    return load(
      room({
        terrain: [[CENTER, ROW, PAD]],
        entities: [placed(PUPPET, PUPPET_X, ROW, 'E'), placed(type, PUPPET_X + 1, ROW, facing)],
        player: { x: CENTER - 1, y: ROW }
      })
    );
  }

  it('pushes a block with an arrow toward the step', () => {
    const engine = puppetLevel('arrow_block_one', 'E');
    expect(step(engine, 'E')).toBe(true);
    expect(arrowOf(engine)?.x).toBe(PUPPET_X + 2);
    expect(engine.getEntities().find((e) => e.type === PUPPET)?.x).toBe(PUPPET_X + 1);
  });

  it('is stopped by a block with no arrow toward the step', () => {
    const engine = puppetLevel('arrow_block_one', 'N');
    expect(step(engine, 'E')).toBe(true);
    expect(arrowOf(engine)?.x).toBe(PUPPET_X + 1);
    expect(engine.getEntities().find((e) => e.type === PUPPET)?.x).toBe(PUPPET_X);
  });
});

describe('arrow blocks: slides, teleports and clones ignore the arrows', () => {
  const CLONER = { x: 7, y: 3 };
  const BUTTON = { x: 3, y: 7 };

  function clonerLevel(withTemplate: boolean): GameEngine {
    return load(
      room({
        terrain: [
          [CLONER.x, CLONER.y, 'clone_machine'],
          [BUTTON.x, BUTTON.y, 'button_red']
        ],
        entities: withTemplate ? [placed('arrow_block_corner', CLONER.x, CLONER.y, 'S')] : [],
        cloneLinks: [
          {
            buttonX: BUTTON.x,
            buttonY: BUTTON.y,
            clonerX: CLONER.x,
            clonerY: CLONER.y,
            templateType: 'arrow_block_corner',
            templateDir: 'W'
          }
        ],
        player: { x: BUTTON.x, y: BUTTON.y + 1 }
      })
    );
  }

  it('slides on a force floor whatever its arrows, and keeps its facing', () => {
    // Pushed north (an arrow) onto an east force floor: the slide goes east, where it has no arrow.
    const engine = pushSetup('arrow_block_one', 'N', 'N', { terrain: [[CENTER, CENTER - 1, 'force_e']] });
    expect(step(engine, 'N')).toBe(true);
    run(engine, SETTLE_TICKS);
    const block = arrowOf(engine);
    expect(block?.x).toBeGreaterThan(CENTER);
    expect(block?.y).toBe(CENTER - 1);
    expect(block?.facing).toBe('N');
  });

  it('slides on ice and is deflected by an ice corner without turning', () => {
    // The north-west ice corner turns a block moving north toward the east.
    const engine = pushSetup('arrow_block_one', 'N', 'N', { terrain: [[CENTER, CENTER - 1, 'ice_nw']] });
    expect(step(engine, 'N')).toBe(true);
    run(engine, SETTLE_TICKS);
    const block = arrowOf(engine);
    expect(block?.x).toBeGreaterThan(CENTER);
    expect(block?.y).toBe(CENTER - 1);
    expect(block?.facing).toBe('N');
  });

  it('keeps its facing through a teleport', () => {
    const exit = { x: 2, y: 8 };
    const engine = pushSetup('arrow_block_tee', 'W', 'W', {
      terrain: [
        [CENTER - 1, CENTER, 'teleport'],
        [exit.x, exit.y, 'teleport']
      ]
    });
    expect(step(engine, 'W')).toBe(true);
    run(engine, SETTLE_TICKS);
    const block = arrowOf(engine);
    expect(block).toBeDefined();
    expect(block?.x === CENTER - 1 && block?.y === CENTER).toBe(false);
    expect(block?.facing).toBe('W');
  });

  it('copies the facing of its template onto a clone', () => {
    const engine = clonerLevel(true);
    expect(step(engine, 'N')).toBe(true);
    const copies = engine.getEntities().filter((e) => e.type === 'arrow_block_corner');
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => c.facing)).toEqual(['S', 'S']);
  });

  it('gives a clone with no template the facing of its spawn direction', () => {
    const engine = clonerLevel(false);
    expect(step(engine, 'N')).toBe(true);
    expect(arrowOf(engine)?.facing).toBe('W');
  });
});

describe('arrow blocks: hazards and undo', () => {
  it('turns into dirt in water, as a dirt block does', () => {
    const engine = pushSetup('arrow_block_one', 'E', 'E', { terrain: [[CENTER + 1, CENTER, 'water']] });
    expect(step(engine, 'E')).toBe(true);
    run(engine, SETTLE_TICKS);
    expect(arrowOf(engine)).toBeUndefined();
    expect(tileAt(engine, CENTER + 1, CENTER)).toBe('dirt');
  });

  it('is destroyed by a bomb', () => {
    const engine = pushSetup('arrow_block_one', 'E', 'E', { items: [[CENTER + 1, CENTER, 'bomb']] });
    expect(step(engine, 'E')).toBe(true);
    run(engine, SETTLE_TICKS);
    expect(arrowOf(engine)).toBeUndefined();
  });

  it('restores the facing and the cell on undo', () => {
    const engine = pushSetup('arrow_block_corner', 'S', 'S');
    expect(step(engine, 'S')).toBe(true);
    expect(arrowOf(engine)?.y).toBe(CENTER + 1);
    expect(engine.undo()).toBe(true);
    expect(arrowOf(engine)?.y).toBe(CENTER);
    expect(arrowOf(engine)?.facing).toBe('S');
  });
});
