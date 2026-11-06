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

/** The lot modules and the shared hooks: id ownership, the walk frame and the monster sprite cache. */

import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import * as blocks from './runewardBlocks';
import * as devices from './runewardDevices';
import * as items from './runewardItems';
import * as marks from './runewardMarks';
import * as monsters from './runewardMonsters';
import {
  RUNEWARD_FALLBACK,
  RUNEWARD_PAINTERS,
  runewardMonsterSprite,
  runewardMonsterSpriteKey,
  runewardWalkFrame,
  type RunewardPaintEnv
} from './runewardTiles';

const LOT_MODULES = [blocks, monsters, devices, items, marks];
const REFERENCE_TICKS_PER_SECOND = 60;
const SPRITE_SIZE = 32;
const OTHER_SPRITE_SIZE = 48;
const WALK_FRAMES = 2;

function envAt(timeTick: number, reducedMotion: boolean): Pick<RunewardPaintEnv, 'timeTick' | 'reducedMotion'> {
  return { timeTick, reducedMotion };
}

describe('Runeward lot modules', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('gives every pending id to exactly one module', () => {
    const all = LOT_MODULES.flatMap((module) => [...module.PENDING]);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(RUNEWARD_FALLBACK));
  });

  it('keeps every pending id a known tile, item or entity of the game', () => {
    const known = new Set([
      ...Object.keys(ConfigRegistry.getTiles().tiles),
      ...Object.keys(ConfigRegistry.getMonsters().entities)
    ]);
    expect(LOT_MODULES.flatMap((module) => [...module.PENDING]).filter((id) => !known.has(id))).toEqual([]);
  });

  it('has painters for its ids and an empty PENDING in every lot module; the fallback set is empty', () => {
    expect(Object.keys(blocks.ENTITIES).length).toBeGreaterThan(0);
    expect(Object.keys(monsters.ENTITIES).length).toBeGreaterThan(0);
    expect(Object.keys(devices.TILES).length).toBeGreaterThan(0);
    expect(Object.keys(devices.ENTITIES).length).toBeGreaterThan(0);
    expect(Object.keys(items.ITEMS).length).toBeGreaterThan(0);
    expect(Object.keys(items.TILES).length).toBeGreaterThan(0);
    expect(Object.keys(marks.TILES).length).toBeGreaterThan(0);
    expect(monsters.SHOT).toBeTypeOf('function');
    expect(RUNEWARD_PAINTERS.shot).toBe(monsters.SHOT);
    for (const module of LOT_MODULES) expect([...module.PENDING]).toEqual([]);
    expect(RUNEWARD_FALLBACK.size).toBe(0);
  });

  it('registers every lot painter in the dispatch', () => {
    for (const [id, painter] of Object.entries({ ...devices.TILES, ...items.TILES, ...marks.TILES })) {
      expect(RUNEWARD_PAINTERS.tiles[id], id).toBe(painter);
    }
    for (const [id, painter] of Object.entries(items.ITEMS)) expect(RUNEWARD_PAINTERS.items[id], id).toBe(painter);
    for (const [id, painter] of Object.entries({ ...blocks.ENTITIES, ...monsters.ENTITIES, ...devices.ENTITIES })) {
      expect(RUNEWARD_PAINTERS.entities[id], id).toBe(painter);
    }
    for (const id of devices.ANIMATED) expect(RUNEWARD_PAINTERS.animatedTiles.has(id), id).toBe(true);
    expect(RUNEWARD_PAINTERS.animatedTiles.has('turtle')).toBe(true);
  });
});

describe('Runeward walk frame', () => {
  const art = { animation: { monsterStepMs: 250 } };
  const ticksPerStep = (art.animation.monsterStepMs * REFERENCE_TICKS_PER_SECOND) / 1000;

  it('alternates between the two frames as the clock advances', () => {
    expect(runewardWalkFrame(envAt(0, false), art)).toBe(0);
    expect(runewardWalkFrame(envAt(ticksPerStep, false), art)).toBe(1);
    expect(runewardWalkFrame(envAt(ticksPerStep * WALK_FRAMES, false), art)).toBe(0);
  });

  it('freezes at frame 0 under reduced motion', () => {
    expect(runewardWalkFrame(envAt(ticksPerStep, true), art)).toBe(0);
  });
});

describe('Runeward monster sprite cache', () => {
  it('keys a sprite by type, direction, frame and size', () => {
    const base = runewardMonsterSpriteKey('bug', 'N', 0, SPRITE_SIZE);
    expect(new Set([
      base,
      runewardMonsterSpriteKey('tank', 'N', 0, SPRITE_SIZE),
      runewardMonsterSpriteKey('bug', 'S', 0, SPRITE_SIZE),
      runewardMonsterSpriteKey('bug', 'N', 1, SPRITE_SIZE),
      runewardMonsterSpriteKey('bug', 'N', 0, OTHER_SPRITE_SIZE)
    ]).size).toBe(5);
  });

  it('builds a sprite once per key and reuses it', () => {
    const env = { cache: new Map<string, unknown>() };
    let builds = 0;
    const build = (): object => {
      builds += 1;
      return {};
    };
    const first = runewardMonsterSprite(env, 'bug', 'N', 0, SPRITE_SIZE, build);
    expect(runewardMonsterSprite(env, 'bug', 'N', 0, SPRITE_SIZE, build)).toBe(first);
    expect(builds).toBe(1);
    expect(runewardMonsterSprite(env, 'bug', 'N', 1, SPRITE_SIZE, build)).not.toBe(first);
    expect(builds).toBe(2);
  });
});
