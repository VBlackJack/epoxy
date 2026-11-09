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
import { findChainPushConfigErrors } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13 } from '../../config/constants';
import { serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { usesBlockChains } from '../blockChains';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityDefinition, EntityPlacement } from '../types';
import { attemptPushBlock } from './epoxyBlocks';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const ARROW_IDS = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee'] as const;
const PAD = 'puppet_control';
const PUPPET = 'puppet';

interface Setup {
  entities?: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  player?: { x: number; y: number };
}

function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'chain_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: setup.player?.x ?? PLAYER_X, y: setup.player?.y ?? ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

function placed(type: string, x: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y: ROW, dir };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

/** Block cells of the row, west to east, as "type@x". */
function layout(engine: GameEngine): string[] {
  return engine
    .getEntities()
    .filter((e) => e.kind === 'block')
    .sort((a, b) => a.x - b.x)
    .map((e) => `${e.type}@${e.x}`);
}

function defOf(type: string): EntityDefinition {
  const def = ConfigRegistry.getEntityDef(type);
  if (!def) throw new Error(`no definition ${type}`);
  return def;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('chain pushing: configuration', () => {
  it('lists what each block may push along', () => {
    expect(defOf('dirt_block').chainPushes).toBeUndefined();
    expect(defOf('ice_block').chainPushes).toEqual(['ice_block', ...ARROW_IDS, 'arrow_block_cross']);
    for (const id of ARROW_IDS) expect(defOf(id).chainPushes, id).toEqual(['dirt_block', 'ice_block', ...ARROW_IDS, 'arrow_block_cross']);
    expect(defOf('arrow_block_cross').chainPushes).toEqual(['dirt_block', 'ice_block', ...ARROW_IDS, 'arrow_block_cross']);
    expect(findChainPushConfigErrors(ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('rejects a chainPushes field that is empty, unknown, repeated, or on a monster', () => {
    const entities: Record<string, EntityDefinition> = {
      dirt_block: defOf('dirt_block'),
      bug: defOf('bug'),
      empty: { ...defOf('ice_block'), id: 'empty', chainPushes: [] },
      unknown: { ...defOf('ice_block'), id: 'unknown', chainPushes: ['nothing_here'] },
      notBlock: { ...defOf('ice_block'), id: 'notBlock', chainPushes: ['bug'] },
      twice: { ...defOf('ice_block'), id: 'twice', chainPushes: ['dirt_block', 'dirt_block'] },
      monster: { ...defOf('bug'), id: 'monster', chainPushes: ['dirt_block'] }
    };
    const errors = findChainPushConfigErrors(entities);
    expect(errors).toContain('empty.chainPushes: expected a non-empty array');
    expect(errors).toContain('unknown.chainPushes: "nothing_here" is not a known block');
    expect(errors).toContain('notBlock.chainPushes: "bug" is not a known block');
    expect(errors).toContain('twice.chainPushes: ids must be unique');
    expect(errors).toContain('monster.chainPushes: only a block may push a chain of blocks');
    expect(errors.some((e) => e.startsWith('dirt_block.') || e.startsWith('bug.'))).toBe(false);
  });
});

describe('chain pushing: the player', () => {
  it('pushes a line of two ice blocks', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4)] }));
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@4', 'ice_block@5']);
    expect(engine.getPlayer().x).toBe(3);
    expect(engine.getChainPushCount()).toBe(1);
  });

  it('pushes a line of three: ice, ice, then an arrow block that shows an arrow toward the push', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4), placed('arrow_block_one', 5, 'E')] }));
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@4', 'ice_block@5', 'arrow_block_one@6']);
  });

  it('refuses the whole line when a wall ends it, and nothing moves', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4)], terrain: [[5, ROW, 'wall']] }));
    expect(step(engine, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4']);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
    expect(engine.getChainPushCount()).toBe(0);
  });

  it('refuses a line that runs into the edge of the map', () => {
    const engine = load(room({ entities: [placed('ice_block', 8), placed('ice_block', 9)], player: { x: 7, y: ROW } }));
    expect(step(engine, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@8', 'ice_block@9']);
  });

  it('keeps a dirt block pushing nothing, and an ice block unable to push a dirt block', () => {
    const dirtFirst = load(room({ entities: [placed('dirt_block', 3), placed('dirt_block', 4)] }));
    expect(step(dirtFirst, 'E')).toBe(false);
    expect(layout(dirtFirst)).toEqual(['dirt_block@3', 'dirt_block@4']);
    const dirtAfterIce = load(room({ entities: [placed('ice_block', 3), placed('dirt_block', 4)] }));
    expect(step(dirtAfterIce, 'E')).toBe(false);
    expect(layout(dirtAfterIce)).toEqual(['ice_block@3', 'dirt_block@4']);
  });

  it('lets an arrow block push a dirt block, only toward one of its arrows', () => {
    const along = load(room({ entities: [placed('arrow_block_one', 3, 'E'), placed('dirt_block', 4)] }));
    expect(step(along, 'E')).toBe(true);
    expect(layout(along)).toEqual(['arrow_block_one@4', 'dirt_block@5']);
    const across = load(room({ entities: [placed('arrow_block_one', 3, 'N'), placed('dirt_block', 4)] }));
    expect(step(across, 'E')).toBe(false);
    expect(layout(across)).toEqual(['arrow_block_one@3', 'dirt_block@4']);
  });

  it('refuses the line when a member is an arrow block with no arrow toward the push', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('arrow_block_one', 4, 'N')] }));
    expect(step(engine, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@3', 'arrow_block_one@4']);
  });

  it('refuses the line when a member is sliding', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4)] }));
    const second = engine.getEntities().find((e) => e.x === 4);
    if (!second) throw new Error('no second block');
    second.isSliding = true;
    expect(step(engine, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4']);
  });

  it('stops partway when moving a block changes the world: the far block moves, the rest stay', () => {
    // The middle block stands on a recessed wall, which walls up the moment it leaves.
    const engine = load(
      room({ entities: [placed('ice_block', 3), placed('ice_block', 4)], terrain: [[4, ROW, 'recessed_wall']] })
    );
    expect(step(engine, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@5']);
    expect(world(engine).terrain[ROW][4]).toBe('wall');
    expect(engine.getPlayer().x).toBe(PLAYER_X);
    // The partial push is counted, recorded as a bump, and undo puts the moved block back.
    expect(engine.getChainPushCount()).toBe(1);
    expect(engine.getTimedMoveHistory()).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4']);
    expect(world(engine).terrain[ROW][4]).toBe('recessed_wall');
    expect(engine.getTimedMoveHistory()).toHaveLength(0);
  });

  it('turns the front block into ice on water and lets the next one land on it', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4)], terrain: [[5, ROW, 'water']] }));
    expect(step(engine, 'E')).toBe(true);
    expect(world(engine).terrain[ROW][5]).toBe('ice');
    expect(layout(engine)).toEqual(['ice_block@4']);
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@5']);
  });

  it('refuses a chain that would end on the live player', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4)], player: { x: 5, y: ROW } }));
    const first = engine.getEntities().find((e) => e.x === 3);
    if (!first) throw new Error('no first block');
    expect(attemptPushBlock(contextOf(engine), first, 'E')).toBe(false);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4']);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('restores every block on undo', () => {
    const engine = load(room({ entities: [placed('ice_block', 3), placed('ice_block', 4), placed('arrow_block_one', 5, 'E')] }));
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@4', 'ice_block@5', 'arrow_block_one@6']);
    expect(engine.undo()).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4', 'arrow_block_one@5']);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });
});

describe('chain pushing: a sliding block', () => {
  const SLIDER_X = 3;
  const SAFE_ROW = 2;

  /** A room with the slider on ice at SLIDER_X, set sliding east and ready to move, the player out of the row. */
  function slideRoom(entities: EntityPlacement[], player = { x: 2, y: SAFE_ROW }): GameEngine {
    const engine = load(room({ entities, terrain: [[SLIDER_X, ROW, 'ice']], player }));
    const slider = engine.getEntities().find((e) => e.x === SLIDER_X && e.kind === 'block');
    if (!slider) throw new Error('no slider');
    slider.isSliding = true;
    slider.dir = 'E';
    slider.cooldownTicks = 0;
    return engine;
  }

  it('pushes a resting ice block, and chains through two', () => {
    const one = slideRoom([placed('ice_block', SLIDER_X), placed('ice_block', 4)]);
    one.tick();
    expect(layout(one)).toEqual(['ice_block@4', 'ice_block@5']);
    expect(one.getChainPushCount()).toBe(1);
    const two = slideRoom([placed('ice_block', SLIDER_X), placed('ice_block', 4), placed('ice_block', 5)]);
    two.tick();
    expect(layout(two)).toEqual(['ice_block@4', 'ice_block@5', 'ice_block@6']);
    expect(two.getChainPushCount()).toBe(1);
  });

  it('does not push a dirt block, and a sliding dirt block pushes nothing', () => {
    const iceIntoDirt = slideRoom([placed('ice_block', SLIDER_X), placed('dirt_block', 4)]);
    iceIntoDirt.tick();
    // The refused slide bounces back on the ice, as before.
    expect(layout(iceIntoDirt)).toEqual(['ice_block@2', 'dirt_block@4']);
    expect(iceIntoDirt.getChainPushCount()).toBe(0);
    const dirtIntoIce = slideRoom([placed('dirt_block', SLIDER_X), placed('ice_block', 4)]);
    dirtIntoIce.tick();
    expect(layout(dirtIntoIce)).toEqual(['dirt_block@2', 'ice_block@4']);
    expect(dirtIntoIce.getChainPushCount()).toBe(0);
  });

  it('does not push a sliding block', () => {
    const engine = slideRoom([placed('ice_block', SLIDER_X), placed('ice_block', 4)]);
    const target = engine.getEntities().find((e) => e.x === 4);
    if (!target) throw new Error('no target');
    target.isSliding = true;
    target.dir = 'W';
    target.cooldownTicks = MAX_WAIT_TICKS;
    engine.tick();
    expect(layout(engine)).toEqual(['ice_block@2', 'ice_block@4']);
    expect(engine.getChainPushCount()).toBe(0);
  });

  it('never pushes a block onto the player', () => {
    const engine = slideRoom([placed('ice_block', SLIDER_X), placed('ice_block', 4)], { x: 5, y: ROW });
    engine.tick();
    expect(layout(engine)).toEqual(['ice_block@2', 'ice_block@4']);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('is put back by undo of the next move', () => {
    const engine = slideRoom([placed('ice_block', SLIDER_X), placed('ice_block', 4)]);
    expect(step(engine, 'E')).toBe(true);
    const before = layout(engine);
    engine.tick();
    expect(layout(engine)).toEqual(['ice_block@4', 'ice_block@5']);
    expect(engine.undo()).toBe(true);
    expect(layout(engine)).toEqual(before);
    expect(layout(engine)).toEqual(['ice_block@3', 'ice_block@4']);
  });
});

describe('chain pushing: other movers never chain', () => {
  it('leaves a line alone when a steered puppet walks into it', () => {
    const engine = load(
      room({
        terrain: [[5, ROW, PAD]],
        entities: [placed(PUPPET, 6), placed('ice_block', 7), placed('ice_block', 8)],
        player: { x: 4, y: ROW }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@7', 'ice_block@8']);
    expect(engine.getEntities().find((e) => e.type === PUPPET)?.x).toBe(6);
    expect(engine.getChainPushCount()).toBe(0);
  });

  it('still pushes one block for a puppet', () => {
    const engine = load(
      room({ terrain: [[5, ROW, PAD]], entities: [placed(PUPPET, 6), placed('ice_block', 7)], player: { x: 4, y: ROW } })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@8']);
  });

  it('pulls only the block right behind the player with pull boots', () => {
    const engine = load(room({ entities: [placed('ice_block', 1), placed('ice_block', 2)], player: { x: 3, y: ROW } }));
    engine.getPlayer().boots.add('boots_pull');
    expect(step(engine, 'E')).toBe(true);
    expect(layout(engine)).toEqual(['ice_block@1', 'ice_block@3']);
    expect(engine.getChainPushCount()).toBe(0);
  });
});

describe('chain pushing: solver, validator and pack format', () => {
  /** A corridor with an arrow block at (2, 2), a block target at (4, 2) and a dirt block behind it. */
  function targetsEngine(): GameEngine {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    const terrain = Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => 'wall'));
    for (let x = 1; x <= 6; x++) terrain[2][x] = 'floor';
    terrain[2][4] = 'block_target';
    const engine = new GameEngine();
    engine.loadLevel({
      id: 'chain_targets',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: { x: 1, y: 2, dir: 'E' },
      terrain,
      items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
      entities: [
        { x: 2, y: 2, type: 'arrow_block_one', dir: 'E' },
        { x: 6, y: 2, type: 'dirt_block', dir: 'E' }
      ],
      trapLinks: [],
      cloneLinks: [],
      winRule: 'targets'
    });
    return engine;
  }

  it('judges nothing while a chain-capable block shares the level with another block', () => {
    const engine = targetsEngine();
    expect(BlockPuzzleSolver.verdict(engine)).toEqual({ kind: 'not_checked' });
    expect(BlockPuzzleSolver.hint(engine)).toBeNull();
    expect(BlockPuzzleSolver.isStuck(engine)).toBe(false);
  });

  it('judges the same level normally when no block can chain', () => {
    delete defOf('arrow_block_one').chainPushes;
    expect(BlockPuzzleSolver.verdict(targetsEngine()).kind).toBe('solved');
    expect(BlockPuzzleSolver.hint(targetsEngine())).toEqual(['E']);
  });

  it('writes a pack with a chain-capable block and another block as format 13', () => {
    const chain = room({ entities: [placed('ice_block', 3), placed('dirt_block', 6)] });
    expect(JSON.parse(serializePack('Chain', [chain])).version).toBe(PACK_JSON_VERSION_V13);
    const arrows = room({ entities: [placed('arrow_block_one', 3), placed('arrow_block_one', 6)] });
    expect(JSON.parse(serializePack('Arrows', [arrows])).version).toBe(PACK_JSON_VERSION_V13);
  });

  it('keeps a pack at its lowest format when no push can chain', () => {
    const alone = room({ entities: [placed('ice_block', 3)] });
    const dirtOnly = room({ entities: [placed('dirt_block', 3), placed('dirt_block', 6)] });
    expect(JSON.parse(serializePack('Alone', [alone])).version).toBeLessThan(PACK_JSON_VERSION_V13);
    expect(JSON.parse(serializePack('Dirt', [dirtOnly])).version).toBeLessThan(PACK_JSON_VERSION_V13);
    const cloned = room({ entities: [placed('ice_block', 3)] });
    cloned.cloneLinks = [
      { buttonX: 1, buttonY: 1, clonerX: 6, clonerY: ROW, templateType: 'dirt_block', templateDir: 'E' }
    ];
    expect(JSON.parse(serializePack('Cloner', [cloned])).version).toBe(PACK_JSON_VERSION_V13);
  });

  it('counts the template of a block cloner as a block', () => {
    const cloneOnly = room({});
    cloneOnly.cloneLinks = [
      { buttonX: 1, buttonY: 1, clonerX: 6, clonerY: ROW, templateType: 'ice_block', templateDir: 'E' }
    ];
    expect(JSON.parse(serializePack('Template', [cloneOnly])).version).toBe(PACK_JSON_VERSION_V13);
    expect(usesBlockChains(cloneOnly)).toBe(true);
  });

  it('answers false instead of throwing while the configs are not loaded', () => {
    const level = room({ entities: [placed('ice_block', 3), placed('dirt_block', 6)] });
    (ConfigRegistry as unknown as { monstersConfig: unknown }).monstersConfig = undefined;
    expect(usesBlockChains(level)).toBe(false);
  });
});
