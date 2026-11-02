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
 * The configuration side of the cc3d ruleset: the tile file that gives the display ids a definition,
 * its separation from tiles.json (which the Lynx engine reads), and the strings of the importer.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { CC3D_DISPLAY_IDS } from '../core/cc3d/display';
import { CC3D_ERROR_KEYS } from '../formats/Cc3dXmlCodec';
import { resolveMessage, TranslationNode } from '../i18n/messageFormat';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import { ConfigLoadError, findCc3dTileErrors } from './ConfigValidation';

const LOCALES: Record<string, TranslationNode> = { en: enLocale as TranslationNode, fr: frLocale as TranslationNode };
const KEY_SHAPE = /^cc3d\.import\.error\.[a-z0-9_]+\.label$/;
/** Placeholders each importer error may carry, as listed in Cc3dXmlCodec. */
const PARAMS_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  [CC3D_ERROR_KEYS.malformedXml]: ['detail', 'position'],
  [CC3D_ERROR_KEYS.invalidEncoding]: [],
  [CC3D_ERROR_KEYS.emptyInput]: [],
  [CC3D_ERROR_KEYS.notMap]: ['root'],
  [CC3D_ERROR_KEYS.badAttribute]: ['element', 'attribute', 'value'],
  [CC3D_ERROR_KEYS.badSize]: ['width', 'height', 'min', 'max'],
  [CC3D_ERROR_KEYS.unknownType]: ['id', 'name'],
  [CC3D_ERROR_KEYS.offGrid]: ['id', 'x', 'y'],
  [CC3D_ERROR_KEYS.playerCount]: ['count'],
  [CC3D_ERROR_KEYS.twoMobs]: ['x', 'y'],
  [CC3D_ERROR_KEYS.twoItems]: ['x', 'y'],
  [CC3D_ERROR_KEYS.twoFloors]: ['x', 'y', 'first', 'second'],
  [CC3D_ERROR_KEYS.unexpected]: ['detail']
};

beforeEach(() => {
  loadTestConfigs();
});

describe('cc3d importer error strings', () => {
  const keys = Object.values(CC3D_ERROR_KEYS);

  it('keys follow the house style', () => {
    for (const key of keys) expect(key).toMatch(KEY_SHAPE);
  });

  it('every key has a string in both locales', () => {
    for (const [locale, tree] of Object.entries(LOCALES)) {
      for (const key of keys) expect(resolveMessage(tree, key), `${locale} ${key}`).toBeTruthy();
    }
  });

  it('every string uses exactly the placeholders the key lists', () => {
    for (const [locale, tree] of Object.entries(LOCALES)) {
      for (const key of keys) {
        const text = resolveMessage(tree, key) ?? '';
        const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const allowed = PARAMS_BY_KEY[key];
        expect(allowed, key).toBeDefined();
        for (const name of used) expect(allowed, `${locale} ${key} {${name}}`).toContain(name);
        if (allowed.length > 0) expect(used.length, `${locale} ${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('cc3d-tiles.json', () => {
  it('defines exactly the display ids the importer can produce', () => {
    const defined = Object.keys(createTestBundle().cc3dTiles.tiles).sort();
    expect(defined).toEqual([...CC3D_DISPLAY_IDS].sort());
  });

  it('names every tile in both locales', () => {
    for (const def of Object.values(createTestBundle().cc3dTiles.tiles)) {
      for (const [locale, tree] of Object.entries(LOCALES)) {
        expect(resolveMessage(tree, def.i18nKey), `${locale} ${def.id}`).toBeTruthy();
      }
    }
  });

  it('is found by getTile and never listed by getTiles', () => {
    for (const id of CC3D_DISPLAY_IDS) {
      expect(ConfigRegistry.getTile(id).id).toBe(id);
      expect(ConfigRegistry.getTiles().tiles[id]).toBeUndefined();
    }
    expect(ConfigRegistry.getTile('floor').id).toBe('floor');
    expect(ConfigRegistry.getTile('no_such_tile').id).toBe('floor');
  });

  it('gives colour tiles a colour key', () => {
    const tiles = ConfigRegistry.getCc3dTiles().tiles;
    for (const id of CC3D_DISPLAY_IDS.filter((candidate) => /_(red|green|blue|yellow)(_|$)/.test(candidate))) {
      expect(tiles[id].colorKey, id).toBeDefined();
    }
  });

  it('closed doors block the player and open ones do not', () => {
    const tiles = ConfigRegistry.getCc3dTiles().tiles;
    for (const id of CC3D_DISPLAY_IDS.filter((candidate) => candidate.includes('_door_'))) {
      expect(tiles[id].passableByPlayer, id).toBe(id.endsWith('_open'));
    }
  });
});

describe('cc3d tile validation', () => {
  it('refuses an entry whose id differs from its key', () => {
    const bundle = createTestBundle();
    bundle.cc3dTiles.tiles.cc3d_sand.id = 'other';
    expect(() => ConfigRegistry.applyConfigs(bundle)).toThrow(ConfigLoadError);
  });

  it('refuses an entry without a name key', () => {
    const bundle = createTestBundle();
    bundle.cc3dTiles.tiles.cc3d_sand.i18nKey = '';
    expect(() => ConfigRegistry.applyConfigs(bundle)).toThrow(ConfigLoadError);
  });

  it('refuses an entry that shadows a tile of tiles.json', () => {
    const bundle = createTestBundle();
    bundle.cc3dTiles.tiles.floor = { ...bundle.tiles.tiles.floor };
    expect(() => ConfigRegistry.applyConfigs(bundle)).toThrow(ConfigLoadError);
  });

  it('refuses a file without a tiles object', () => {
    expect(findCc3dTileErrors(undefined, {})).toHaveLength(1);
    expect(findCc3dTileErrors({ tiles: {} }, {})).toEqual([]);
  });

  it('leaves the Lynx-readable tiles untouched', () => {
    const before = JSON.stringify(ConfigRegistry.getTiles());
    ConfigRegistry.applyConfigs(createTestBundle());
    expect(JSON.stringify(ConfigRegistry.getTiles())).toBe(before);
  });
});
