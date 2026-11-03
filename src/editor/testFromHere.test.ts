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
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { getEditorKeyAction } from './editorKeyboard';
import { levelStartingAt, pickTestCell, startCellProblem } from './testFromHere';

const TERRAIN = [
  ['wall', 'wall', 'wall', 'wall', 'wall'],
  ['wall', 'floor', 'water', 'exit', 'wall'],
  ['wall', 'floor', 'floor', 'floor', 'wall'],
  ['wall', 'wall', 'wall', 'wall', 'wall']
];
const ENTITIES = [{ type: 'dirt_block', x: 3, y: 2, dir: 'S' as const }];

function level(): CompiledLevel {
  return {
    id: 'from_here',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'E' },
    terrain: TERRAIN.map((row) => [...row]),
    items: TERRAIN.map((row) => row.map(() => null)),
    entities: ENTITIES.map((e) => ({ ...e })),
    trapLinks: [],
    cloneLinks: []
  };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('startCellProblem', () => {
  const map = { terrain: TERRAIN, entities: ENTITIES };

  it('accepts a plain floor cell', () => {
    expect(startCellProblem(map, { x: 2, y: 2 })).toBeNull();
  });

  it('refuses walls, hazards, exits and entities as not walkable', () => {
    expect(startCellProblem(map, { x: 0, y: 0 })).toBe('not_walkable');
    expect(startCellProblem(map, { x: 2, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(map, { x: 3, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(map, { x: 3, y: 2 })).toBe('not_walkable');
  });

  it('asks for a cell when there is none or it lies outside the map', () => {
    expect(startCellProblem(map, null)).toBe('no_cell');
    expect(startCellProblem(map, { x: 9, y: 9 })).toBe('no_cell');
    expect(startCellProblem(map, { x: -1, y: 1 })).toBe('no_cell');
  });

  it('serves Epoxy and Lynx, and refuses CC3D', () => {
    expect(startCellProblem({ ...map, ruleset: 'lynx' }, { x: 2, y: 2 })).toBeNull();
    expect(startCellProblem({ ...map, ruleset: 'epoxy' }, { x: 2, y: 2 })).toBeNull();
    expect(startCellProblem({ ...map, ruleset: 'cc3d' }, { x: 2, y: 2 })).toBe('not_supported');
  });
});

describe('pickTestCell', () => {
  const cursor = { x: 1, y: 1 };
  const hover = { x: 2, y: 2 };

  it('prefers the cursor while the canvas has the focus, else the last hovered cell', () => {
    expect(pickTestCell(cursor, hover, true)).toBe(cursor);
    expect(pickTestCell(cursor, hover, false)).toBe(hover);
  });

  it('falls back to whichever cell exists', () => {
    expect(pickTestCell(cursor, null, false)).toBe(cursor);
    expect(pickTestCell(null, hover, true)).toBe(hover);
    expect(pickTestCell(null, null, true)).toBeNull();
  });
});

describe('levelStartingAt', () => {
  it('moves the start of a copy and leaves the source level untouched', () => {
    const source = level();
    const copy = levelStartingAt(source, { x: 2, y: 2 });
    expect(copy.playerStart).toEqual({ x: 2, y: 2, dir: 'E' });
    expect(source.playerStart).toEqual({ x: 1, y: 1, dir: 'E' });
    expect(copy).not.toBe(source);
    expect(copy.terrain).not.toBe(source.terrain);
    expect(copy.entities).not.toBe(source.entities);
  });
});

describe('the T key', () => {
  const chord = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it('asks for a test from here, on QWERTY and AZERTY alike', () => {
    expect(getEditorKeyAction({ key: 't', ...chord })).toEqual({ kind: 'test_from_here' });
    expect(getEditorKeyAction({ key: 'T', code: 'KeyT', ...chord })).toEqual({ kind: 'test_from_here' });
  });

  it('leaves Ctrl+T to the browser', () => {
    expect(getEditorKeyAction({ key: 't', ...chord, ctrlKey: true })).toBeNull();
  });
});
