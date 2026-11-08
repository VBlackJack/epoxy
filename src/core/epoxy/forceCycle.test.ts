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
import { FORCE_CYCLE_ORDER } from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { engineSimulationHash } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { hasEpoxyOnlyContent, isEpoxyOnlyTileId, isForceCycleTileId } from '../RulesetFeatures';
import { usesV7Ids } from '../signalLinks';
import { moveBlockTo } from './epoxyBlocks';
import { forceCycleArrival } from './epoxyForceCycle';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';

const CYCLE = 'force_cycle';
const SIZE = 11;
const TIME_LIMIT_SECONDS = 100;
const PLAYER_START = { x: 2, y: 5 };
const CYCLE_PAD = { x: 3, y: 5 };
const WALL_BEHIND_PAD = { x: 4, y: 5 };
const OTHER_PAD = { x: 7, y: 2 };
const BLOCK_START = { x: 7, y: 4 };
const MONSTER_START = { x: 9, y: 9 };
const MAX_WAIT_TICKS = 40;
const SCRIPT_REPEATS = 2;

interface Setup {
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  cloneLinks?: CompiledLevel['cloneLinks'];
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'force_cycle_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...PLAYER_START, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: setup.cloneLinks ?? []
  };
}

/** A room whose pad sits against a wall, so the player stops where it lands. */
function padLevel(extra: Setup = {}): CompiledLevel {
  return room({
    terrain: [[CYCLE_PAD.x, CYCLE_PAD.y, CYCLE], [WALL_BEHIND_PAD.x, WALL_BEHIND_PAD.y, 'wall'], ...(extra.terrain ?? [])],
    entities: extra.entities
  });
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function captured(engine: GameEngine): Record<string, unknown> {
  return (engine as unknown as { captureState: () => Record<string, unknown> }).captureState();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('force_cycle: configuration', () => {
  it('is a force floor with a flag and no fixed direction, named in both languages', () => {
    const tile = ConfigRegistry.getTile(CYCLE);
    expect(tile.slideType).toBe('force');
    expect(tile.forceCycle).toBe(true);
    expect(tile.forceDirection).toBeUndefined();
    expect(tile.protectedByItem).toBe(ConfigRegistry.getTile('force_random').protectedByItem);
    expect(isForceCycleTileId(CYCLE)).toBe(true);
    expect(isForceCycleTileId('force_random')).toBe(false);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      expect(locale.tiles[CYCLE].name).toBeTruthy();
      expect(locale.tiles[CYCLE].desc.label).toBeTruthy();
    }
  });

  it('turns east, south, west, north', () => {
    expect([...FORCE_CYCLE_ORDER]).toEqual(['E', 'S', 'W', 'N']);
  });
});

describe('force_cycle: the shared turn', () => {
  it('hands out the directions in order and wraps, advancing only on a turning floor', () => {
    const engine = load(padLevel());
    const world = contextOf(engine).world;
    const tile = ConfigRegistry.getTile(CYCLE);
    const picked = Array.from({ length: FORCE_CYCLE_ORDER.length + 1 }, () => forceCycleArrival(world, tile));
    expect(picked).toEqual(['E', 'S', 'W', 'N', 'E']);
    const before = world.forceCycleTurn;
    expect(forceCycleArrival(world, ConfigRegistry.getTile('force_random'))).toBeNull();
    expect(forceCycleArrival(world, ConfigRegistry.getTile('floor'))).toBeNull();
    expect(world.forceCycleTurn).toBe(before);
  });

  it('is shared by the player, a block and a monster on different floors', () => {
    const engine = load(
      padLevel({
        terrain: [[OTHER_PAD.x, OTHER_PAD.y, CYCLE]],
        entities: [
          { type: 'dirt_block', x: BLOCK_START.x, y: BLOCK_START.y, dir: 'S' },
          { type: 'bug', x: MONSTER_START.x, y: MONSTER_START.y, dir: 'N' }
        ]
      })
    );
    const ctx = contextOf(engine);
    const block = engine.getEntities().find((e) => e.type === 'dirt_block')!;
    const monster = engine.getEntities().find((e) => e.type === 'bug')!;
    expect(engine.getForceCycleTurn()).toBe(0);

    // First arrival, the player: east.
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().slideDir).toBe('E');
    expect(engine.getForceCycleTurn()).toBe(1);

    // Second, a block on the other floor: south.
    moveBlockTo(ctx, block, OTHER_PAD.x, OTHER_PAD.y, 'N');
    expect(block.dir).toBe('S');
    expect(block.isSliding).toBe(true);
    expect(engine.getForceCycleTurn()).toBe(2);

    // Third, a monster stepping onto the first floor once the player has left it: west.
    ctx.world.player.x = PLAYER_START.x;
    ctx.world.player.y = PLAYER_START.y;
    ctx.world.player.isSliding = false;
    monster.x = CYCLE_PAD.x;
    monster.y = CYCLE_PAD.y;
    resolveMonsterArrival(ctx, monster, false);
    expect(monster.dir).toBe('W');
    expect(engine.getForceCycleTurn()).toBe(3);

    // Fourth, the player again: north.
    ctx.world.player.moveCooldown = 0;
    monster.x = MONSTER_START.x;
    monster.y = MONSTER_START.y;
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().slideDir).toBe('N');
    expect(engine.getForceCycleTurn()).toBe(4);
  });

  it('counts a player arrival that force boots cancel, without pushing', () => {
    const engine = load(padLevel());
    contextOf(engine).world.player.boots.add('boots_force');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().isSliding).toBe(false);
    expect(engine.getForceCycleTurn()).toBe(1);
  });

  it('is hidden from the hash getter on a level without a turning floor', () => {
    expect(load(room()).getForceCycleTurn()).toBeUndefined();
    expect(load(padLevel()).getForceCycleTurn()).toBe(0);
  });
});

describe('force_cycle: other ways to arrive', () => {
  const TELEPORT_IN = { x: 3, y: 2 };
  const TELEPORT_OUT = { x: 6, y: 5 };
  const FAR_PAD = { x: 7, y: 5 };
  const SECOND_PAD = { x: 4, y: 5 };
  const CLONER = { x: 6, y: 2 };
  const CLONE_BUTTON = { x: 8, y: 8 };
  const MAX_TICKS = 80;

  it('counts the step off a teleport exit onto a turning floor beside it, once', () => {
    const engine = load(
      room({
        terrain: [
          [TELEPORT_IN.x, TELEPORT_IN.y, 'teleport'],
          [TELEPORT_OUT.x, TELEPORT_OUT.y, 'teleport'],
          [FAR_PAD.x, FAR_PAD.y, CYCLE],
          [FAR_PAD.x + 1, FAR_PAD.y, 'wall']
        ]
      })
    );
    const ctx = contextOf(engine);
    ctx.world.player.x = TELEPORT_IN.x - 1;
    ctx.world.player.y = TELEPORT_IN.y;
    expect(step(engine, 'E')).toBe(true);
    // The jump itself never counts; the player comes out and steps onto the floor beside the exit.
    expect(engine.getForceCycleTurn()).toBe(1);
    expect(engine.getPlayer()).toMatchObject({ x: FAR_PAD.x, y: FAR_PAD.y });
    expect(engine.getPlayer().slideDir).toBe('E');
  });

  it('counts each arrival once when a slide runs from one turning floor onto the next', () => {
    const engine = load(
      room({
        terrain: [
          [CYCLE_PAD.x, CYCLE_PAD.y, CYCLE],
          [SECOND_PAD.x, SECOND_PAD.y, CYCLE],
          [SECOND_PAD.x, SECOND_PAD.y + 1, 'wall'],
          [SECOND_PAD.x + 1, SECOND_PAD.y, 'wall']
        ]
      })
    );
    expect(step(engine, 'E')).toBe(true);
    for (let i = 0; i < MAX_TICKS && engine.getPlayer().isSliding; i++) engine.tick();
    expect(engine.getPlayer()).toMatchObject({ x: SECOND_PAD.x, y: SECOND_PAD.y });
    expect(engine.getForceCycleTurn()).toBe(2);
  });

  it('counts a cloned monster stepping onto a turning floor', () => {
    const engine = load(
      room({
        terrain: [
          [CLONER.x, CLONER.y, 'clone_machine'],
          [CLONER.x, CLONER.y + 1, CYCLE],
          [CLONE_BUTTON.x, CLONE_BUTTON.y, 'button_brown']
        ],
        entities: [{ type: 'bug', x: CLONER.x, y: CLONER.y, dir: 'S' }],
        cloneLinks: [
          { buttonX: CLONE_BUTTON.x, buttonY: CLONE_BUTTON.y, clonerX: CLONER.x, clonerY: CLONER.y, templateType: 'bug', templateDir: 'S' }
        ]
      })
    );
    expect(contextOf(engine).triggerButton(CLONE_BUTTON.x, CLONE_BUTTON.y, 'trigger_cloner')).toBe(true);
    for (let i = 0; i < MAX_TICKS && engine.getForceCycleTurn() === 0; i++) engine.tick();
    expect(engine.getForceCycleTurn()).toBe(1);
  });
});

describe('force_cycle: undo and replay', () => {
  it('restores the counter on undo', () => {
    const engine = load(padLevel());
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getForceCycleTurn()).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getForceCycleTurn()).toBe(0);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().slideDir).toBe('E');
  });

  it('writes the counter in the snapshot only on a level with a turning floor', () => {
    expect('forceCycleTurn' in captured(load(room()))).toBe(false);
    expect(captured(load(padLevel())).forceCycleTurn).toBe(0);
  });

  it('replays to the same hash', () => {
    const level = padLevel({ entities: [{ type: 'dirt_block', x: BLOCK_START.x, y: BLOCK_START.y, dir: 'S' }] });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
  });
});

describe('force_cycle: validator and rulesets', () => {
  /** A corridor along the player's row, so the exit can only be reached across the cell under test. */
  const corridor = (middle: string, exitId = 'exit'): CompiledLevel => {
    const level = room({ terrain: [[CYCLE_PAD.x, CYCLE_PAD.y, middle], [WALL_BEHIND_PAD.x, WALL_BEHIND_PAD.y, exitId]] });
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if (y !== PLAYER_START.y || x < PLAYER_START.x || x > WALL_BEHIND_PAD.x) level.terrain[y][x] = 'wall';
      }
    }
    return level;
  };

  it('does not report a false unreachable exit behind a turning or a random floor', () => {
    const cycle = LevelValidator.validate(corridor(CYCLE));
    expect(cycle.stats.reachableExit).toBe(true);
    expect(cycle.valid).toBe(true);
    // A random floor has no predictable push either: the walk tries every exit rather than claiming none.
    expect(LevelValidator.validate(corridor('force_random')).stats.reachableExit).toBe(true);
  });

  it('still reports an exit that is truly unreachable past a turning floor', () => {
    const level = corridor(CYCLE);
    level.terrain[CYCLE_PAD.y][CYCLE_PAD.x + 1] = 'wall';
    const report = LevelValidator.validate(level);
    expect(report.stats.reachableExit).toBe(false);
    expect(report.valid).toBe(false);
  });

  it('is Epoxy-only content, refused in the Lynx palette', () => {
    expect(isEpoxyOnlyTileId(CYCLE)).toBe(true);
    expect(isEpoxyOnlyTileId('force_random')).toBe(false);
    expect(hasEpoxyOnlyContent(room())).toBe(false);
    expect(hasEpoxyOnlyContent(padLevel())).toBe(true);
    expect(tileAvailability('lynx', CYCLE).available).toBe(false);
    expect(tileAvailability('epoxy', CYCLE).available).toBe(true);
  });

  it('makes the pack writer pick format 7, but not for a CC3D level', () => {
    expect(usesV7Ids(room())).toBe(false);
    expect(usesV7Ids(padLevel())).toBe(true);
    expect(usesV7Ids({ ...padLevel(), ruleset: 'cc3d' })).toBe(false);
  });
});
