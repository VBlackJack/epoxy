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
import type { CompiledLevel, Ruleset } from '../core/types';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { resolveMessage, type TranslationNode } from '../i18n/messageFormat';
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CONNECTIONS_KEYS, connectionRows } from './connectionRows';
import type { EditorMap } from './editorDocument';
import { sessionClick, type LinkSession } from './linkSession';

const EPOXY: Ruleset = 'epoxy';
const SIZE = 9;
const PLATE = 'signal_plate';
const WALL = 'toggle_wall_closed';
const RAIL = 'rail_switch_a';
const PLATE_CELL = { x: 1, y: 1 };
const SECOND_PLATE_CELL = { x: 1, y: 2 };
const WALL_CELL = { x: 3, y: 1 };

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

function map(): EditorMap {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x): string => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[PLATE_CELL.y][PLATE_CELL.x] = PLATE;
  terrain[SECOND_PLATE_CELL.y][SECOND_PLATE_CELL.x] = PLATE;
  terrain[WALL_CELL.y][WALL_CELL.x] = WALL;
  terrain[WALL_CELL.y + 3][WALL_CELL.x] = RAIL;
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 7, y: 7, dir: 'S' }
  };
}

function level(wired: boolean): CompiledLevel {
  const { terrain, items } = map();
  return {
    id: 'wired_flip_editor',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 7, y: 7, dir: 'S' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(wired ? { signalLinks: [{ fromX: PLATE_CELL.x, fromY: PLATE_CELL.y, toX: WALL_CELL.x, toY: WALL_CELL.y }] } : {})
  };
}

describe('wired flip: the editor', () => {
  it('links a plate to a toggle wall and to a rail switch', () => {
    const plate: LinkSession = { system: 'signal', end: 'button', x: PLATE_CELL.x, y: PLATE_CELL.y };
    const toWall = sessionClick(map(), plate, WALL_CELL, 'S', EPOXY);
    expect(toWall.map?.signalLinks).toEqual([{ fromX: 1, fromY: 1, toX: WALL_CELL.x, toY: WALL_CELL.y }]);
    const toRail = sessionClick(map(), plate, { x: WALL_CELL.x, y: WALL_CELL.y + 3 }, 'S', EPOXY);
    expect(toRail.map?.signalLinks).toHaveLength(1);
  });

  it('takes one input per flip sink', () => {
    const first = sessionClick(map(), { system: 'signal', end: 'button', x: PLATE_CELL.x, y: PLATE_CELL.y }, WALL_CELL, 'S', EPOXY).map as EditorMap;
    const second: LinkSession = { system: 'signal', end: 'button', x: SECOND_PLATE_CELL.x, y: SECOND_PLATE_CELL.y };
    const result = sessionClick(first, second, WALL_CELL, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.messages).toEqual([{ key: 'editor.link.refused.single_input.label', params: { x: WALL_CELL.x, y: WALL_CELL.y } }]);
  });

  it('no longer asks for a green button once a wire flips the wall, and says what the wire does', () => {
    expect(connectionRows(level(false), WALL_CELL.x, WALL_CELL.y).note).toEqual({
      key: CONNECTIONS_KEYS.needsToggleWall,
      params: { colour: 'green' }
    });
    const wired = connectionRows(level(true), WALL_CELL.x, WALL_CELL.y);
    expect(wired.note).toEqual({ key: CONNECTIONS_KEYS.signalFlips });
    expect(wired.controlledBy?.rows[0].unlink).toEqual({ system: 'signal', button: PLATE_CELL, target: WALL_CELL });
    for (const [name, locale] of [['en', enLocale], ['fr', frLocale]] as const) {
      expect(resolveMessage(locale as TranslationNode, CONNECTIONS_KEYS.signalFlips), name).toBeDefined();
    }
  });

  it('offers the Link button on a toggle wall', () => {
    expect(connectionRows(level(false), WALL_CELL.x, WALL_CELL.y).link).toEqual({ type: 'start', system: 'signal', end: 'target', blocked: false });
  });
});
