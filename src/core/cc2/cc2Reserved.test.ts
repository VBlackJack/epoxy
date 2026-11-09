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

/**
 * The reserved Chip's Challenge 2 ids: the config file that defines them, the pack format 12 that carries them, and
 * how the engine, the validator and the editor treat a mechanic Epoxy does not play.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { ConfigLoadError, findCc2Errors } from '../../config/ConfigValidation';
import {
  PACK_JSON_ID_SET_VERSIONS,
  PACK_JSON_MAX_VERSION,
  PACK_JSON_VERSION_V11,
  PACK_JSON_VERSION_V12,
  PACK_JSON_VERSION_V12_IDS,
  PACK_JSON_VERSION_V15
} from '../../config/constants';
import { tileAvailability, entityAvailability } from '../../editor/paletteAvailability';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { createTestBundle, loadTestConfigs } from '../../test/loadTestConfigs';
import { formatValidationIssue } from '../../ui/validatorIssueText';
import { CC2_ID_PREFIX, MECHANICS_PARAM, STATIONARY_PATTERN } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator, unsupportedMechanicIds } from '../LevelValidator';
import { hasEpoxyOnlyContent } from '../RulesetFeatures';
import { idSetVersionOf } from '../signalLinks';
import type { CompiledLevel, Direction } from '../types';

const SIZE = 9;
const ROW = 4;
const PLAYER_X = 1;
const TIME_LIMIT_SECONDS = 200;
const MAX_WAIT_TICKS = 40;
const IDLE_TICKS = 300;
const PACK_NOW = 9000;
const ISSUE_KEY = 'validator.issues.cc2_unsupported.label';
const WALL_ID = 'cc2_purple_wall';
const ITEM_ID = 'cc2_green_chip';
const MONSTER_ID = 'cc2_ghost';
const BLOCK_ID = 'cc2_melinda';
/** The three ids above in alphabetical order, as the validator lists them. */
const SORTED_IDS = [MONSTER_ID, ITEM_ID, WALL_ID];

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: Array<[number, number, string]>;
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'cc2_reserved_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items,
    entities: (setup.entities ?? []).map(([x, y, type]) => ({ type, x, y, dir: 'S' as Direction })),
    trapLinks: [],
    cloneLinks: []
  };
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

beforeEach(() => {
  loadTestConfigs();
});

describe('cc2-tiles.json', () => {
  it('defines exactly the ids of pack format 12, each flagged unimplemented', () => {
    const bundle = createTestBundle();
    const cc2 = bundle.cc2Tiles;
    expect(cc2).toBeDefined();
    const defined = [...Object.keys(cc2?.tiles ?? {}), ...Object.keys(cc2?.entities ?? {})].sort();
    expect(defined).toEqual([...PACK_JSON_VERSION_V12_IDS].sort());
    expect(defined).toHaveLength(30);
    for (const def of [...Object.values(cc2?.tiles ?? {}), ...Object.values(cc2?.entities ?? {})]) {
      expect(def.id.startsWith(CC2_ID_PREFIX)).toBe(true);
      expect(def.unimplemented, def.id).toBe('cc2');
    }
    for (const def of Object.values(cc2?.entities ?? {})) expect(def.epoxyOnly, def.id).toBe(true);
  });

  it('names and describes every id in both locales', () => {
    const cc2 = ConfigRegistry.getCc2Tiles();
    for (const locale of [en, fr] as unknown as Array<{
      tiles: Record<string, { name: string; desc: { label: string } }>;
      entities: Record<string, { name: string; desc: { label: string } }>;
    }>) {
      for (const id of Object.keys(cc2.tiles)) {
        expect(locale.tiles[id].name, id).toBeTruthy();
        expect(locale.tiles[id].desc.label, id).toBeTruthy();
      }
      for (const id of Object.keys(cc2.entities)) {
        expect(locale.entities[id].name, id).toBeTruthy();
        expect(locale.entities[id].desc.label, id).toBeTruthy();
      }
    }
    for (const def of [...Object.values(cc2.tiles), ...Object.values(cc2.entities)]) {
      expect(def.descriptionKey, def.id).toBe(def.i18nKey.replace(/\.name$/, '.desc.label'));
    }
  });

  it('is found by getTile and getEntityDef and never listed by getTiles or getMonsters', () => {
    const cc2 = ConfigRegistry.getCc2Tiles();
    for (const id of Object.keys(cc2.tiles)) {
      expect(ConfigRegistry.getTile(id).id).toBe(id);
      expect(ConfigRegistry.getTiles().tiles[id]).toBeUndefined();
    }
    for (const id of Object.keys(cc2.entities)) {
      expect(ConfigRegistry.getEntityDef(id)?.id).toBe(id);
      expect(ConfigRegistry.getMonsters().entities[id]).toBeUndefined();
    }
    expect(ConfigRegistry.getTile('floor').id).toBe('floor');
  });

  it('counts the reserved terrains as terrain tiles and the items as not', () => {
    for (const def of Object.values(ConfigRegistry.getCc2Tiles().tiles)) {
      expect(ConfigRegistry.isTerrainTile(def.id), def.id).toBe(def.layer === 'terrain');
    }
  });

  it('refuses an entry that is not flagged, shadows another config, or could be walked through', () => {
    const unflagged = createTestBundle();
    delete (unflagged.cc2Tiles?.tiles[WALL_ID] as { unimplemented?: string }).unimplemented;
    expect(() => ConfigRegistry.applyConfigs(unflagged)).toThrow(ConfigLoadError);

    const shadow = createTestBundle();
    if (shadow.cc2Tiles) shadow.cc2Tiles.tiles.floor = { ...shadow.tiles.tiles.floor, unimplemented: 'cc2' };
    expect(() => ConfigRegistry.applyConfigs(shadow)).toThrow(ConfigLoadError);

    const open = createTestBundle();
    if (open.cc2Tiles) open.cc2Tiles.tiles[WALL_ID].passableByPlayer = true;
    expect(() => ConfigRegistry.applyConfigs(open)).toThrow(ConfigLoadError);

    const walker = createTestBundle();
    if (walker.cc2Tiles) walker.cc2Tiles.entities[MONSTER_ID].movementPattern = 'chase_player';
    expect(() => ConfigRegistry.applyConfigs(walker)).toThrow(ConfigLoadError);

    const pushable = createTestBundle();
    if (pushable.cc2Tiles) pushable.cc2Tiles.entities[BLOCK_ID].pushable = true;
    expect(() => ConfigRegistry.applyConfigs(pushable)).toThrow(ConfigLoadError);
  });

  it('accepts a bundle built without the file', () => {
    const bundle = createTestBundle();
    delete bundle.cc2Tiles;
    expect(findCc2Errors(undefined, bundle.tiles.tiles, bundle.cc3dTiles.tiles, bundle.monsters.entities)).toEqual([]);
    expect(() => ConfigRegistry.applyConfigs(bundle)).not.toThrow();
    expect(ConfigRegistry.getCc2Tiles().tiles).toEqual({});
  });
});

describe('pack format 12', () => {
  it('has a row in the id set table and is the highest format this build reads', () => {
    expect(PACK_JSON_VERSION_V12).toBe(PACK_JSON_VERSION_V11 + 1);
    expect(PACK_JSON_ID_SET_VERSIONS.map((row) => row.version)).toContain(PACK_JSON_VERSION_V12);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V15);
  });

  it('is detected from a reserved id in the terrain, the items, the entities or a clone template', () => {
    expect(idSetVersionOf(room())).toBe(0);
    expect(idSetVersionOf(room({ terrain: [[3, ROW, WALL_ID]] }))).toBe(PACK_JSON_VERSION_V12);
    expect(idSetVersionOf(room({ items: [[3, ROW, ITEM_ID]] }))).toBe(PACK_JSON_VERSION_V12);
    expect(idSetVersionOf(room({ entities: [[3, ROW, MONSTER_ID]] }))).toBe(PACK_JSON_VERSION_V12);
    const cloner = room();
    cloner.cloneLinks = [{ buttonX: 2, buttonY: 2, clonerX: 3, clonerY: 3, templateType: MONSTER_ID, templateDir: 'S' }];
    expect(idSetVersionOf(cloner)).toBe(PACK_JSON_VERSION_V12);
  });

  it('writes version 12 for a level that uses an id, and reads it back', () => {
    const level = room({ terrain: [[3, ROW, WALL_ID]], items: [[4, ROW, ITEM_ID]], entities: [[5, ROW, MONSTER_ID]] });
    const text = serializePack('N', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V12);
    const read = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => PACK_NOW);
    expect(read.ok).toBe(true);
    expect(JSON.parse(serializePack('N', [room()])).version).toBeLessThan(PACK_JSON_VERSION_V12);
  });
});

describe('reserved ids in play', () => {
  it('acts as a wall for a reserved terrain', () => {
    const engine = load(room({ terrain: [[PLAYER_X + 1, ROW, WALL_ID]] }));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
    expect(ConfigRegistry.getTile(WALL_ID).passableByMonster).toBe(false);
    expect(ConfigRegistry.getTile(WALL_ID).passableByBlock).toBe(false);
  });

  it('leaves a reserved item where it is and does nothing when the player walks over it', () => {
    const level = room({ items: [[PLAYER_X + 1, ROW, ITEM_ID]] });
    level.chipsRequired = 0;
    const engine = load(level);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(PLAYER_X + 1);
    expect(engine.getItems()[ROW][PLAYER_X + 1]).toBe(ITEM_ID);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().keys[ITEM_ID]).toBeUndefined();
    expect(engine.getHeldItems()).toEqual([]);
  });

  it('keeps a reserved monster motionless', () => {
    const farX = SIZE - 3;
    const engine = load(room({ entities: [[farX, ROW, MONSTER_ID]] }));
    expect(ConfigRegistry.getEntityDef(MONSTER_ID)?.movementPattern).toBe(STATIONARY_PATTERN);
    for (let i = 0; i < IDLE_TICKS; i++) engine.tick();
    const ghost = engine.getEntities().find((e) => e.type === MONSTER_ID);
    expect(ghost).toMatchObject({ x: farX, y: ROW });
  });

  it('keeps a reserved block in place: the player cannot push it', () => {
    const engine = load(room({ entities: [[PLAYER_X + 1, ROW, BLOCK_ID]] }));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
    const block = engine.getEntities().find((e) => e.type === BLOCK_ID);
    expect(block).toMatchObject({ x: PLAYER_X + 1, y: ROW });
  });

  it('counts as Epoxy-only content and is refused by the Lynx palette', () => {
    expect(hasEpoxyOnlyContent(room({ terrain: [[3, ROW, WALL_ID]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ items: [[3, ROW, ITEM_ID]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ entities: [[3, ROW, MONSTER_ID]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room())).toBe(false);
    expect(tileAvailability('lynx', WALL_ID).available).toBe(false);
    expect(entityAvailability('lynx', MONSTER_ID).available).toBe(false);
  });
});

describe('the editor palette', () => {
  it('lists none of the reserved ids', () => {
    const palette = new Set([...Object.keys(ConfigRegistry.getTiles().tiles), ...Object.keys(ConfigRegistry.getMonsters().entities)]);
    for (const id of PACK_JSON_VERSION_V12_IDS) expect(palette.has(id), id).toBe(false);
  });
});

describe('validator issue cc2_unsupported', () => {
  it('is an error that lists the reserved ids, sorted and without repeats', () => {
    const level = room({
      terrain: [[3, ROW, WALL_ID], [4, ROW, WALL_ID]],
      items: [[5, ROW, ITEM_ID]],
      entities: [[6, ROW, MONSTER_ID]]
    });
    expect(unsupportedMechanicIds(level)).toEqual(SORTED_IDS);
    const report = LevelValidator.validate(level);
    const issue = report.issues.find((candidate) => candidate.i18nKey === ISSUE_KEY);
    expect(issue?.severity).toBe('error');
    expect(issue?.params?.[MECHANICS_PARAM]).toBe(SORTED_IDS.join(','));
    expect(report.valid).toBe(false);
  });

  it('is absent from a level that uses none', () => {
    const report = LevelValidator.validate(room());
    expect(report.issues.some((candidate) => candidate.i18nKey === ISSUE_KEY)).toBe(false);
  });

  it('exists in both locales and shows the names of the mechanics, not their ids', () => {
    for (const locale of [en, fr] as unknown as Array<{ validator: { issues: { cc2_unsupported: { label: string } } } }>) {
      expect(locale.validator.issues.cc2_unsupported.label).toContain('{mechanics}');
    }
    const level = room({ terrain: [[3, ROW, WALL_ID]], entities: [[6, ROW, MONSTER_ID]] });
    const issue = LevelValidator.validate(level).issues.find((candidate) => candidate.i18nKey === ISSUE_KEY);
    expect(issue).toBeDefined();
    const text = formatValidationIssue(issue as NonNullable<typeof issue>);
    expect(text).not.toContain(WALL_ID);
    expect(text).not.toContain(MONSTER_ID);
  });
});
