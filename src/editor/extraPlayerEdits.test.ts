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
import { EXTRA_PLAYERS_MAX } from '../core/coreConstants';
import type { ExtraPlayerStart } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { cloneDocument, sameDocument, type EditorDocument, type EditorMap } from './editorDocument';
import { differingExtraPlayerCells } from './editorExtraPlayers';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { historyDiff } from './historyDiff';
import { eraseCell, paintPlayerStart, paintTerrain, resizeMap } from './mapEdits';
import { applyTool } from './editorTools';
import { clearRect, extractClip, fillRect, moveRect, pasteClip } from './selectionEdits';
import { levelStartingAt } from './testFromHere';
import {
  defaultExtraCharacter,
  placeExtraPlayer,
  removeExtraPlayerAt,
  rotateExtraPlayerAt,
  setExtraPlayerCharacter
} from './extraPlayerEdits';

const SIZE = 10;
const BOUNDS = { minSize: 3, maxSize: 40 };

beforeEach(() => {
  loadTestConfigs();
});

/** A bordered map with the main start at (1, 1). */
function bordered(width = SIZE, height = SIZE): EditorMap {
  const terrain: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'floor'))
  );
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
}

function withPlayers(...players: ExtraPlayerStart[]): EditorMap {
  const map = bordered();
  map.extraPlayers = players;
  return map;
}

const second: ExtraPlayerStart = { x: 4, y: 3, dir: 'E', character: 'melinda' };
const third: ExtraPlayerStart = { x: 6, y: 5, dir: 'N', character: 'chip' };

describe('placing a second player', () => {
  it('adds a start in swap order with the facing and the character given', () => {
    const first = placeExtraPlayer(bordered(), 4, 3, 'E', 'melinda');
    expect(first.changed).toBe(true);
    const both = placeExtraPlayer(first.map, 6, 5, 'N', 'chip');
    expect(both.map.extraPlayers).toEqual([second, third]);
  });

  it('refuses the main start cell and says why', () => {
    const result = placeExtraPlayer(bordered(), 1, 1, 'E', 'melinda');
    expect(result.changed).toBe(false);
    expect(result.refusal).toBe('on_start');
  });

  it('turns a start already on the cell and keeps its character', () => {
    const result = placeExtraPlayer(withPlayers(second), 4, 3, 'W', 'chip');
    expect(result.changed).toBe(true);
    expect(result.map.extraPlayers).toEqual([{ ...second, dir: 'W' }]);
    expect(placeExtraPlayer(withPlayers(second), 4, 3, 'E', 'chip').changed).toBe(false);
  });

  it('refuses an eighth other player', () => {
    let map = bordered();
    for (let i = 0; i < EXTRA_PLAYERS_MAX; i++) map = placeExtraPlayer(map, 2 + (i % 7), 2 + Math.floor(i / 7), 'S', 'chip').map;
    expect(map.extraPlayers).toHaveLength(EXTRA_PLAYERS_MAX);
    const refused = placeExtraPlayer(map, 8, 8, 'S', 'chip');
    expect(refused.changed).toBe(false);
    expect(refused.refusal).toBe('too_many');
  });

  it('ignores a cell off the grid and a CC3D map, and leaves its input alone', () => {
    const map = bordered();
    expect(placeExtraPlayer(map, -1, 2, 'S', 'chip').changed).toBe(false);
    expect(placeExtraPlayer(map, SIZE, 2, 'S', 'chip').changed).toBe(false);
    placeExtraPlayer(map, 3, 3, 'S', 'chip');
    expect(map.extraPlayers).toBeUndefined();
  });

  it('takes the character the main player does not play by default', () => {
    expect(defaultExtraCharacter(undefined)).toBe('melinda');
    expect(defaultExtraCharacter('chip')).toBe('melinda');
    expect(defaultExtraCharacter('melinda')).toBe('chip');
  });

  it('goes through the tool dispatcher with the brush, and refuses with a message', () => {
    const brush = { kind: 'extra_player_start' as const, id: 'extra_player_start' };
    const placed = applyTool({ map: bordered(), tool: 'brush', brush, dir: 'W', x: 5, y: 5, extraCharacter: 'melinda' });
    expect(placed.changed).toBe(true);
    expect(placed.map.extraPlayers).toEqual([{ x: 5, y: 5, dir: 'W', character: 'melinda' }]);
    const refused = applyTool({ map: bordered(), tool: 'brush', brush, dir: 'W', x: 1, y: 1 });
    expect(refused.changed).toBe(false);
    expect(refused.messages.map((m) => m.key)).toEqual(['editor.extra_players.status.on_start.label']);
  });
});

describe('editing a second player', () => {
  it('chooses the character and turns the player a quarter turn', () => {
    const map = withPlayers(second);
    expect(setExtraPlayerCharacter(map, 4, 3, 'chip')?.extraPlayers).toEqual([{ ...second, character: 'chip' }]);
    expect(setExtraPlayerCharacter(map, 4, 3, 'melinda')).toBeNull();
    expect(rotateExtraPlayerAt(map, 4, 3)?.extraPlayers).toEqual([{ ...second, dir: 'S' }]);
    expect(rotateExtraPlayerAt(map, 5, 5)).toBeNull();
  });

  it('removes a player and drops the field with the last one', () => {
    const map = withPlayers(second, third);
    expect(removeExtraPlayerAt(map, 4, 3)?.extraPlayers).toEqual([third]);
    expect(removeExtraPlayerAt(removeExtraPlayerAt(map, 4, 3)!, 6, 5)?.extraPlayers).toBeUndefined();
    expect(removeExtraPlayerAt(map, 2, 2)).toBeNull();
  });

  it('keeps the main start off the cell of another player', () => {
    const map = withPlayers(second);
    expect(paintPlayerStart(map, 4, 3, 'S').changed).toBe(false);
    const message = applyTool({ map, tool: 'brush', brush: { kind: 'player_start', id: 'player_start' }, dir: 'S', x: 4, y: 3 });
    expect(message.messages.map((m) => m.key)).toEqual(['editor.extra_players.status.start_on_extra.label']);
    expect(paintPlayerStart(map, 5, 5, 'S').map.extraPlayers).toEqual([second]);
  });
});

describe('every edit path carries the other players', () => {
  it('survives painting terrain, items and entities over its cell', () => {
    const map = withPlayers(second);
    expect(paintTerrain(map, 4, 3, 'water').map.extraPlayers).toEqual([second]);
  });

  it('is erased by the eraser, even on an otherwise empty cell', () => {
    const erased = eraseCell(withPlayers(second), 4, 3);
    expect(erased.changed).toBe(true);
    expect(erased.map.extraPlayers).toBeUndefined();
  });

  it('is cleared with a selection but kept by a fill of terrain', () => {
    const map = withPlayers(second, third);
    const filled = fillRect(map, { x: 3, y: 2, width: 3, height: 3 }, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(filled.map.extraPlayers).toEqual([second, third]);
    const cleared = clearRect(map, { x: 3, y: 2, width: 3, height: 3 });
    expect(cleared.changed).toBe(true);
    expect(cleared.map.extraPlayers).toEqual([third]);
  });

  it('is left alone by an entity fill, which counts the cell as skipped', () => {
    const map = withPlayers(second);
    const filled = fillRect(map, { x: 3, y: 2, width: 3, height: 3 }, { kind: 'entity', id: 'block' }, 'S', 'epoxy');
    expect(filled.map.extraPlayers).toEqual([second]);
    expect(filled.map.entities.some((e) => e.x === 4 && e.y === 3)).toBe(false);
    expect(filled.skipped).toBe(1);
  });

  it('is refused as a fill brush', () => {
    const filled = fillRect(bordered(), { x: 2, y: 2, width: 2, height: 2 }, { kind: 'extra_player_start', id: 'extra_player_start' }, 'S', 'epoxy');
    expect(filled.refusal).toEqual({ reason: 'unsupported' });
  });

  it('is left out of a copy and carried by a cut, then pasted with its facing and character', () => {
    const map = withPlayers(second, third);
    const rect = { x: 3, y: 2, width: 3, height: 3 };
    expect(extractClip(map, rect, false).extraPlayers).toBeUndefined();
    const clip = extractClip(map, rect, true);
    expect(clip.extraPlayers).toEqual([{ dx: 1, dy: 1, dir: 'E', character: 'melinda' }]);
    const cleared = clearRect(map, rect).map;
    const pasted = pasteClip(cleared, clip, 2, 6, 'epoxy');
    expect(pasted.map.extraPlayers).toEqual([third, { x: 3, y: 7, dir: 'E', character: 'melinda' }]);
  });

  it('is not pasted by the Lynx rules, and the paste counts it as skipped', () => {
    const map = withPlayers(second);
    const clip = extractClip(map, { x: 3, y: 2, width: 3, height: 3 }, true);
    const pasted = pasteClip(bordered(), clip, 2, 6, 'lynx');
    expect(pasted.map.extraPlayers).toBeUndefined();
    expect(pasted.skipped).toBeGreaterThan(0);
  });

  it('is not pasted onto the main start, or past the cap', () => {
    const clip = extractClip(withPlayers({ x: 3, y: 3, dir: 'S', character: 'chip' }), { x: 3, y: 3, width: 1, height: 1 }, true);
    const onStart = pasteClip(bordered(), clip, 1, 1, 'epoxy');
    expect(onStart.map.extraPlayers).toBeUndefined();
    const crowd: ExtraPlayerStart[] = Array.from({ length: EXTRA_PLAYERS_MAX }, (_, i) => ({ x: 2 + i, y: 8, dir: 'S', character: 'chip' }));
    const full = pasteClip(withPlayers(...crowd), clip, 4, 4, 'epoxy');
    expect(full.map.extraPlayers).toEqual(crowd);
  });

  it('moves with a moved selection and keeps the swap order', () => {
    const map = withPlayers(second, third);
    const moved = moveRect(map, { x: 3, y: 2, width: 3, height: 3 }, 0, 3);
    expect(moved.changed).toBe(true);
    expect(moved.map.extraPlayers).toEqual([{ ...second, y: 6 }, third]);
  });

  it('follows its cell through a resize and is dropped, counted, when the cell goes', () => {
    const map = withPlayers(second, third);
    const grown = resizeMap(map, SIZE + 2, SIZE + 2, BOUNDS, { col: 2, row: 2 });
    expect(grown.map.extraPlayers).toEqual([{ ...second, x: 6, y: 5 }, { ...third, x: 8, y: 7 }]);
    expect(grown.report.droppedExtraPlayers).toBeUndefined();
    const cropped = resizeMap(map, 5, 5, BOUNDS);
    expect(cropped.map.extraPlayers).toBeUndefined();
    expect(cropped.report.droppedExtraPlayers).toBe(2);
  });
});

describe('document, history and save', () => {
  const documentOf = (map: EditorMap): EditorDocument => ({
    ...map,
    title: 'Two players',
    hint: '',
    author: '',
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: 'exit',
    ruleset: undefined
  });

  it('copies deeply and compares in swap order', () => {
    const doc = documentOf(withPlayers(second, third));
    const copy = cloneDocument(doc);
    expect(copy.extraPlayers).toEqual(doc.extraPlayers);
    expect(copy.extraPlayers?.[0]).not.toBe(doc.extraPlayers?.[0]);
    expect(sameDocument(doc, copy)).toBe(true);
    expect(sameDocument(doc, documentOf(withPlayers(third, second)))).toBe(false);
    expect(sameDocument(doc, documentOf(withPlayers(second)))).toBe(false);
    expect(sameDocument(documentOf(bordered()), documentOf(withPlayers()))).toBe(true);
  });

  it('shows the cells of the players that differ in the history diff', () => {
    const before = documentOf(withPlayers(second));
    const after = documentOf(withPlayers({ ...second, character: 'chip' }, third));
    const diff = historyDiff(before, after);
    expect(diff.cells).toEqual([
      { x: 4, y: 3 },
      { x: 6, y: 5 }
    ]);
    expect(differingExtraPlayerCells(undefined, undefined)).toEqual([]);
  });

  it('round-trips through the saved level', () => {
    const doc = documentOf(withPlayers(second, third));
    const level = levelFromDocument(doc, { id: 'lvl_two', number: 1, password: 'TEST', fallbackTitle: 'Two' });
    expect(level.extraPlayers).toEqual([second, third]);
    const reopened = documentFromLevel(level, { title: 'Two players', hint: '' });
    expect(reopened.extraPlayers).toEqual([second, third]);
    expect(sameDocument(reopened, doc)).toBe(true);
  });

  it('drops players that no longer fit when a level is opened, and under the Lynx rules when saved', () => {
    const level = levelFromDocument(documentOf(withPlayers(second)), { id: 'lvl_two', number: 1, password: 'TEST', fallbackTitle: 'Two' });
    level.extraPlayers = [{ x: 1, y: 1, dir: 'S', character: 'chip' }, { x: 99, y: 1, dir: 'S', character: 'chip' }];
    expect(documentFromLevel(level, { title: '', hint: '' }).extraPlayers).toBeUndefined();
    const lynx = levelFromDocument({ ...documentOf(withPlayers(second)), ruleset: 'lynx' }, { id: 'lvl_two', number: 1, password: 'TEST', fallbackTitle: 'Two' });
    expect(lynx.extraPlayers).toBeUndefined();
  });

  it('keeps the other players in a test from a cell, except the one on that cell', () => {
    const level = levelFromDocument(documentOf(withPlayers(second, third)), { id: 'lvl_two', number: 1, password: 'TEST', fallbackTitle: 'Two' });
    expect(levelStartingAt(level, { x: 8, y: 8 }).extraPlayers).toEqual([second, third]);
    expect(levelStartingAt(level, { x: 4, y: 3 }).extraPlayers).toEqual([third]);
    const lone = levelFromDocument(documentOf(withPlayers(second)), { id: 'lvl_two', number: 1, password: 'TEST', fallbackTitle: 'Two' });
    expect(levelStartingAt(lone, { x: 4, y: 3 }).extraPlayers).toBeUndefined();
    expect(level.extraPlayers).toEqual([second, third]);
  });
});
