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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isEpoxyOnlyEntityType, isEpoxyOnlyTileId } from '../core/RulesetFeatures';
import { resolveMessage, TranslationNode } from '../i18n/messageFormat';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CELL_EDGE_BRUSH_ID } from './editorTools';
import { descriptionKeyFor, nameWithDescription, paletteDescription } from './paletteDescriptions';

const MECHANISMS_CATEGORY = 'mechanisms';
const LOCALES: ReadonlyArray<readonly [string, TranslationNode]> = [
  ['en', enLocale as TranslationNode],
  ['fr', frLocale as TranslationNode]
];

beforeEach(() => {
  loadTestConfigs();
});

/** The tiles and entities that must explain themselves: the Mechanisms tab and everything only Epoxy plays. */
function describedEntries(): Array<{ kind: 'terrain' | 'item' | 'entity'; id: string }> {
  const entries: Array<{ kind: 'terrain' | 'item' | 'entity'; id: string }> = [];
  for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
    if (tile.category === MECHANISMS_CATEGORY || isEpoxyOnlyTileId(tile.id)) {
      entries.push({ kind: tile.layer === 'item' ? 'item' : 'terrain', id: tile.id });
    }
  }
  for (const entity of Object.values(ConfigRegistry.getMonsters().entities)) {
    if (entity.category === MECHANISMS_CATEGORY || isEpoxyOnlyEntityType(entity.id)) {
      entries.push({ kind: 'entity', id: entity.id });
    }
  }
  return entries;
}

describe('descriptionKeyFor', () => {
  it('swaps the name segment of a tile or entity key for the description segment', () => {
    expect(descriptionKeyFor('terrain', 'hold_door_red_closed')).toBe('tiles.hold_door_red_closed.desc.label');
    expect(descriptionKeyFor('item', 'boots_speed')).toBe('tiles.boots_speed.desc.label');
    expect(descriptionKeyFor('entity', 'turret_cw')).toBe('entities.turret_cw.desc.label');
  });

  it('gives the synthetic entries their own keys', () => {
    expect(descriptionKeyFor('player_start', 'player_start')).toBe('editor.palette.tools.player_start_desc.label');
    expect(descriptionKeyFor('cell_edge', CELL_EDGE_BRUSH_ID)).toBe('editor.palette.tools.cell_edge_desc.label');
  });

  it('gives no key to an unknown id or a cell edge entry that is not the thin wall', () => {
    expect(descriptionKeyFor('terrain', 'no_such_tile')).toBeUndefined();
    expect(descriptionKeyFor('entity', 'no_such_entity')).toBeUndefined();
    expect(descriptionKeyFor('cell_edge', 'panel')).toBeUndefined();
  });
});

describe('paletteDescription', () => {
  it('returns the translated text', () => {
    expect(paletteDescription('entity', 'turret_cw', (key) => `[${key}]`)).toBe('[entities.turret_cw.desc.label]');
  });

  it('falls back to nothing when the translator returns the key or an empty string', () => {
    expect(paletteDescription('terrain', 'wall', (key) => key)).toBeUndefined();
    expect(paletteDescription('terrain', 'wall', () => '')).toBeUndefined();
    expect(paletteDescription('terrain', 'no_such_tile', () => 'text')).toBeUndefined();
  });
});

describe('nameWithDescription', () => {
  it('joins the name and the description, or keeps the name alone', () => {
    expect(nameWithDescription('Trap', 'Holds things.')).toBe('Trap: Holds things.');
    expect(nameWithDescription('Trap', undefined)).toBe('Trap');
  });
});

describe('palette description contract', () => {
  it('reaches the Mechanisms tab, the Epoxy-only entries and both kinds', () => {
    const entries = describedEntries();
    expect(entries.some((entry) => entry.id === 'hold_door_red_closed')).toBe(true);
    expect(entries.some((entry) => entry.id === 'boots_speed')).toBe(true);
    expect(entries.some((entry) => entry.id === 'swivel_door_ne')).toBe(true);
    expect(entries.some((entry) => entry.id === 'skitter')).toBe(true);
    expect(entries.some((entry) => entry.id === 'button_brown')).toBe(true);
    expect(entries.some((entry) => entry.kind === 'entity')).toBe(true);
  });

  for (const [locale, tree] of LOCALES) {
    it(`gives every Mechanisms and Epoxy-only entry a description in ${locale}`, () => {
      const missing = describedEntries()
        .filter(({ kind, id }) => {
          const key = descriptionKeyFor(kind, id);
          const text = key === undefined ? undefined : resolveMessage(tree, key);
          return text === undefined || text.trim() === '';
        })
        .map((entry) => entry.id);
      expect(missing).toEqual([]);
    });

    it(`describes the player start and the thin wall in ${locale}`, () => {
      for (const [kind, id] of [
        ['player_start', 'player_start'],
        ['cell_edge', CELL_EDGE_BRUSH_ID]
      ] as const) {
        const key = descriptionKeyFor(kind, id);
        expect(key && resolveMessage(tree, key), `${locale} ${kind}`).toBeTruthy();
      }
    });
  }
});
