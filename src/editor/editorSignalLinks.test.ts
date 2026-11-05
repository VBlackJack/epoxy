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
import { DEFAULT_WIN_RULE } from '../core/coreConstants';
import type { CompiledLevel, SignalLink } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { cloneMap, type EditorDocument, type EditorMap, sameDocument } from './editorDocument';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { dropSignalLinksAt, setSignalLinks, translateSignalLinks } from './editorSignalLinks';
import { eraseCell, paintTerrain, resizeMap } from './mapEdits';
import { ANCHOR_CENTRE, ANCHOR_END } from './resizeAnchor';
import { levelMapChanged } from './saveTarget';
import { moveRect } from './selectionEdits';

const LYNX_RULESET = 'lynx' as const;
const WIDTH = 10;
const HEIGHT = 7;
const FROM = { x: 3, y: 2 };
const TO = { x: 6, y: 2 };
const OTHER = { x: 6, y: 4 };
const BOUNDS = { minSize: 5, maxSize: 14 };
const LINK: SignalLink = { fromX: FROM.x, fromY: FROM.y, toX: TO.x, toY: TO.y };
const PORT_LINK: SignalLink = { fromX: FROM.x, fromY: FROM.y, toX: OTHER.x, toY: OTHER.y, port: 'a' };

beforeEach(() => {
  loadTestConfigs();
});

/** A walled room holding the given signal links on plain floor cells (no tile defines a signal device yet). */
function room(links: SignalLink[] | null = [LINK]): EditorMap {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  const map: EditorMap = {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
  if (links) map.signalLinks = links.map((l) => ({ ...l }));
  return map;
}

function toDocument(map: EditorMap): EditorDocument {
  return {
    ...cloneMap(map),
    title: 'Room',
    hint: '',
    author: '',
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: DEFAULT_WIN_RULE,
    ruleset: undefined
  };
}

function toLevel(map: EditorMap): CompiledLevel {
  return { id: 'lvl_signal', number: 1, password: 'TEST', timeLimitSeconds: 0, chipsRequired: 0, ...cloneMap(map) };
}

const CONTEXT = { id: 'x', number: 1, password: 'TEST', fallbackTitle: 'T' };

describe('the signal link helpers', () => {
  it('store one link per pair, sorted, and remove the field when none is left', () => {
    const map = room(null);
    setSignalLinks(map, [PORT_LINK, LINK, { ...LINK, port: 'b' }]);
    expect(map.signalLinks).toEqual([LINK, PORT_LINK]);
    setSignalLinks(map, []);
    expect(map.signalLinks).toBeUndefined();
  });

  it('drop the links touching a cell and count them', () => {
    const map = room([LINK, PORT_LINK]);
    expect(dropSignalLinksAt(map, TO.x, TO.y)).toBe(1);
    expect(map.signalLinks).toEqual([PORT_LINK]);
    expect(dropSignalLinksAt(map, 1, 1)).toBe(0);
  });

  it('translate and drop the links that leave the grid', () => {
    expect(translateSignalLinks([LINK, PORT_LINK], 1, 1, WIDTH, HEIGHT)).toHaveLength(2);
    expect(translateSignalLinks([LINK], 5, 0, WIDTH, HEIGHT)).toEqual([]);
  });
});

describe('opening and saving a level with signal links', () => {
  it('keeps the links, the port included, through a round trip', () => {
    const doc = documentFromLevel(toLevel(room([LINK, PORT_LINK])), { title: 'Room', hint: '' });
    expect(doc.signalLinks).toHaveLength(2);
    const saved = levelFromDocument(doc, CONTEXT);
    expect(saved.signalLinks).toEqual(doc.signalLinks);
    expect(saved.signalLinks).toContainEqual(PORT_LINK);
    expect(levelMapChanged(toLevel(room([LINK, PORT_LINK])), saved)).toBe(false);
  });

  it('sees a change of the links as a change of the map, but not their order', () => {
    expect(levelMapChanged(toLevel(room([LINK, PORT_LINK])), toLevel(room([PORT_LINK, LINK])))).toBe(false);
    expect(levelMapChanged(toLevel(room([LINK])), toLevel(room(null)))).toBe(true);
  });

  it('drops the links when the level is switched to Lynx', () => {
    const doc = { ...documentFromLevel(toLevel(room()), { title: '', hint: '' }), ruleset: LYNX_RULESET };
    expect(levelFromDocument(doc, CONTEXT).signalLinks).toBeUndefined();
  });

  it('compares documents without caring for the order of the links', () => {
    const a = toDocument(room([LINK, PORT_LINK]));
    const b = toDocument(room([PORT_LINK, LINK]));
    expect(sameDocument(a, b)).toBe(true);
    expect(sameDocument(a, toDocument(room([LINK])))).toBe(false);
    expect(sameDocument(toDocument(room(null)), toDocument(room([])))).toBe(true);
  });

  it('deep-copies the links with the map', () => {
    const source = room();
    const copy = cloneMap(source);
    copy.signalLinks![0].toX = 1;
    expect(source.signalLinks![0].toX).toBe(TO.x);
  });
});

describe('edits never leave a dangling signal link', () => {
  it('erasing a cell drops the links touching it', () => {
    const result = eraseCell(room(), FROM.x, FROM.y);
    expect(result.changed).toBe(true);
    expect(result.removedLinks).toBe(1);
    expect(result.map.signalLinks).toBeUndefined();
  });

  it('painting over an end drops the links, painting beside it keeps them', () => {
    expect(paintTerrain(room(), TO.x, TO.y, 'wall').map.signalLinks).toBeUndefined();
    expect(paintTerrain(room(), 2, 5, 'wall').map.signalLinks).toEqual([LINK]);
  });

  it('a resize translates the links, or drops those that lose an end', () => {
    const grown = resizeMap(room(), WIDTH + 2, HEIGHT + 2, BOUNDS, { col: ANCHOR_END, row: ANCHOR_END });
    expect(grown.map.signalLinks).toEqual([{ fromX: FROM.x + 2, fromY: FROM.y + 2, toX: TO.x + 2, toY: TO.y + 2 }]);
    const centred = resizeMap(room(), WIDTH + 2, HEIGHT, BOUNDS, { col: ANCHOR_CENTRE, row: ANCHOR_CENTRE });
    expect(centred.map.signalLinks?.[0].fromX).toBe(FROM.x + 1);
    const shrunk = resizeMap(room(), 6, HEIGHT, BOUNDS);
    expect(shrunk.map.signalLinks).toBeUndefined();
    expect(shrunk.report.droppedSignalLinks).toBe(1);
  });
});

describe('moving a selection', () => {
  it('carries a link with both ends inside it', () => {
    const result = moveRect(room(), { x: 2, y: 2, width: 6, height: 1 }, 0, 1);
    expect(result.map.signalLinks).toEqual([{ fromX: FROM.x, fromY: FROM.y + 1, toX: TO.x, toY: TO.y + 1 }]);
    expect(result.droppedLinks).toBe(0);
  });

  it('drops a link with one end inside it and keeps one with none', () => {
    const half = moveRect(room(), { x: 3, y: 2, width: 1, height: 1 }, 0, 1);
    expect(half.map.signalLinks).toBeUndefined();
    expect(half.droppedLinks).toBe(1);
    const outside = moveRect(room(), { x: 1, y: 5, width: 1, height: 1 }, 1, 0);
    expect(outside.map.signalLinks).toEqual([LINK]);
  });

  it('drops a link ending on a cell the move overwrites', () => {
    const result = moveRect(room(), { x: 3, y: 4, width: 1, height: 1 }, 0, -2);
    expect(result.map.signalLinks).toBeUndefined();
  });
});
