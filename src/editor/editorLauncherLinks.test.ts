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
import { hasEpoxyOnlyContent } from '../core/RulesetFeatures';
import type { CompiledLevel, LauncherLink } from '../core/types';
import { datRefusalReason } from '../formats/DatCodec';
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { cloneDocument, cloneMap, type EditorDocument, type EditorMap, sameDocument, withEditedMap } from './editorDocument';
import { DRAFT_VERSION, type EditorDraft, levelFingerprint, parseDraft, serializeDraft } from './editorDraft';
import {
  canonicalLauncherLinks,
  cloneLauncherLinks,
  differingLauncherLinks,
  dropLauncherLinksAt,
  hasLauncherLinks,
  pruneLauncherLinks,
  setLauncherLinks,
  translateLauncherLinks
} from './editorLauncherLinks';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { applyTool } from './editorTools';
import { historyDiff } from './historyDiff';
import { eraseCell, floodFillTerrain, paintTerrain, resizeMap } from './mapEdits';
import { requiresEpoxyRules } from './metadataFields';
import { ANCHOR_CENTRE, ANCHOR_END, ANCHOR_START } from './resizeAnchor';
import { describeResize } from './resizeReport';
import { levelMapChanged } from './saveTarget';
import { clearRect, extractClip, fillRect, moveRect, pasteClip } from './selectionEdits';

const WIDTH = 10;
const HEIGHT = 7;
const TRIGGER = { x: 3, y: 2 };
const LAUNCHER = { x: 6, y: 2 };
const TRIGGER_TILE = 'shot_trigger';
const LAUNCHER_TILE = 'shot_launcher_e';
const BOUNDS = { minSize: 5, maxSize: 14 };
const LINK: LauncherLink = { buttonX: TRIGGER.x, buttonY: TRIGGER.y, launcherX: LAUNCHER.x, launcherY: LAUNCHER.y };

beforeEach(() => {
  // The terrain lookup registered by the config registry is what makes the canonical form real.
  loadTestConfigs();
  i18n.setLocale('en');
});

/** A walled room with a trigger and a launcher on one row, linked. */
function linked(links: LauncherLink[] | null = [LINK]): EditorMap {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[TRIGGER.y][TRIGGER.x] = TRIGGER_TILE;
  terrain[LAUNCHER.y][LAUNCHER.x] = LAUNCHER_TILE;
  const map: EditorMap = {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
  if (links) map.launcherLinks = links.map((l) => ({ ...l }));
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

function toLevel(map: EditorMap, extra: Partial<CompiledLevel> = {}): CompiledLevel {
  return { id: 'lvl_launch', number: 1, password: 'TEST', timeLimitSeconds: 0, chipsRequired: 0, ...cloneMap(map), ...extra };
}

const CONTEXT = { id: 'x', number: 1, password: 'TEST', fallbackTitle: 'T' };

describe('the launcher link helpers', () => {
  it('canonicalise: sorted, deduplicated, links without a trigger and a launcher dropped, undefined when none is left', () => {
    const map = linked(null);
    map.terrain[4][3] = TRIGGER_TILE;
    map.terrain[4][6] = LAUNCHER_TILE;
    const second: LauncherLink = { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 };
    expect(canonicalLauncherLinks([second, LINK, { ...LINK }, { buttonX: 1, buttonY: 1, launcherX: 6, launcherY: 2 }], map.terrain)).toEqual([
      LINK,
      second
    ]);
    expect(canonicalLauncherLinks([{ buttonX: 1, buttonY: 1, launcherX: 2, launcherY: 1 }], map.terrain)).toBeUndefined();
    expect(canonicalLauncherLinks(undefined, map.terrain)).toBeUndefined();
    expect(canonicalLauncherLinks([], map.terrain)).toBeUndefined();
  });

  it('clone to an independent list, and read as absent when empty', () => {
    const original = [LINK];
    const copy = cloneLauncherLinks(original);
    expect(copy).toEqual(original);
    copy![0].buttonX = 9;
    expect(original[0].buttonX).toBe(TRIGGER.x);
    expect(cloneLauncherLinks([])).toBeUndefined();
    expect(cloneLauncherLinks(undefined)).toBeUndefined();
    expect(hasLauncherLinks(linked())).toBe(true);
    expect(hasLauncherLinks(linked(null))).toBe(false);
  });

  it('drop the links of a cell, with the count, deleting the field when none is left', () => {
    const map = linked();
    expect(dropLauncherLinksAt(map, 1, 1)).toBe(0);
    expect(map.launcherLinks).toHaveLength(1);
    expect(dropLauncherLinksAt(map, LAUNCHER.x, LAUNCHER.y)).toBe(1);
    expect('launcherLinks' in map).toBe(false);
  });

  it('translate and drop the links with an end leaving the grid', () => {
    expect(translateLauncherLinks([LINK], 1, 1, WIDTH, HEIGHT)).toEqual([{ buttonX: 4, buttonY: 3, launcherX: 7, launcherY: 3 }]);
    expect(translateLauncherLinks([LINK], 4, 0, WIDTH, HEIGHT)).toEqual([]);
    expect(translateLauncherLinks([LINK], -4, 0, WIDTH, HEIGHT)).toEqual([]);
  });

  it('prune what the terrain no longer supports, and count it', () => {
    const map = linked();
    map.terrain[LAUNCHER.y][LAUNCHER.x] = 'floor';
    expect(pruneLauncherLinks(map)).toBe(1);
    expect('launcherLinks' in map).toBe(false);
    expect(pruneLauncherLinks(map)).toBe(0);
  });

  it('store links in canonical order, one per pair, and drop the field when none is left', () => {
    const map = linked(null);
    const second: LauncherLink = { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 };
    setLauncherLinks(map, [second, LINK, { ...LINK }]);
    expect(map.launcherLinks).toEqual([LINK, second]);
    setLauncherLinks(map, []);
    expect('launcherLinks' in map).toBe(false);
  });

  it('name the links held by one list only', () => {
    const other: LauncherLink = { buttonX: 1, buttonY: 1, launcherX: 2, launcherY: 2 };
    expect(differingLauncherLinks([LINK], [LINK])).toEqual([]);
    expect(differingLauncherLinks([LINK], [other])).toEqual([LINK, other]);
    expect(differingLauncherLinks(undefined, [LINK])).toEqual([LINK]);
  });
});

describe('the document and the level', () => {
  it('round trip: a level with launcher links opens and exports them, without sharing the list', () => {
    const level = toLevel(linked());
    const doc = documentFromLevel(level, { title: 'Room', hint: '' });
    expect(doc.launcherLinks).toEqual([LINK]);
    expect(doc.launcherLinks).not.toBe(level.launcherLinks);
    const exported = levelFromDocument(doc, CONTEXT);
    expect(exported.launcherLinks).toEqual([LINK]);
    expect(exported.launcherLinks).not.toBe(doc.launcherLinks);
  });

  it('opens a level in canonical form: a link without its launcher is dropped', () => {
    const map = linked();
    map.terrain[LAUNCHER.y][LAUNCHER.x] = 'floor';
    expect(documentFromLevel(toLevel(map), { title: '', hint: '' }).launcherLinks).toBeUndefined();
  });

  it('is absent from the level when there is none', () => {
    const doc = documentFromLevel(toLevel(linked(null)), { title: '', hint: '' });
    expect('launcherLinks' in doc).toBe(false);
    expect('launcherLinks' in levelFromDocument(doc, CONTEXT)).toBe(false);
  });

  it('is stripped from the export of a Lynx document', () => {
    const doc = { ...documentFromLevel(toLevel(linked()), { title: '', hint: '' }), ruleset: 'lynx' as const };
    expect('launcherLinks' in levelFromDocument(doc, CONTEXT)).toBe(false);
  });

  it('is never held by a CC3D document', () => {
    const doc = cloneDocument(toDocument(linked()));
    expect(cloneMap({ ...doc, cc3d: {} as never }).launcherLinks).toBeUndefined();
  });

  it('copies independently with cloneMap and cloneDocument', () => {
    const doc = toDocument(linked());
    cloneMap(doc).launcherLinks![0].buttonX = 9;
    cloneDocument(doc).launcherLinks![0].buttonX = 9;
    expect(doc.launcherLinks![0].buttonX).toBe(TRIGGER.x);
  });

  it('compares with sameDocument: a link-only change counts, the order of a list does not', () => {
    const a = toDocument(linked());
    expect(sameDocument(a, cloneDocument(a))).toBe(true);
    expect(sameDocument(a, toDocument(linked(null)))).toBe(false);
    const second = linked([LINK, { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 }]);
    second.terrain[4][3] = TRIGGER_TILE;
    second.terrain[4][6] = LAUNCHER_TILE;
    const reversed = linked([{ buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 }, LINK]);
    reversed.terrain[4][3] = TRIGGER_TILE;
    reversed.terrain[4][6] = LAUNCHER_TILE;
    expect(sameDocument(toDocument(second), toDocument(reversed))).toBe(true);
    // A link whose ends hold no trigger and launcher reads as none, as in the canonical form.
    const stale = toDocument(linked(null));
    stale.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 2, launcherY: 1 }];
    expect(sameDocument(stale, toDocument(linked(null)))).toBe(true);
  });

  it('is dropped from the document by an edit that removed the last one (withEditedMap)', () => {
    const doc = toDocument(linked());
    const edited = paintTerrain(doc, TRIGGER.x, TRIGGER.y, 'floor');
    expect('launcherLinks' in edited.map).toBe(false);
    expect('launcherLinks' in withEditedMap(doc, edited.map)).toBe(false);
  });

  it('counts as a change of the map for the save (levelMapChanged)', () => {
    const base = toLevel(linked(null));
    expect(levelMapChanged(base, toLevel(linked()))).toBe(true);
    expect(levelMapChanged(toLevel(linked()), toLevel(linked()))).toBe(false);
    const reordered = linked([LINK, { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 }]);
    const swapped = linked([{ buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 }, LINK]);
    expect(levelMapChanged(toLevel(reordered), toLevel(swapped))).toBe(false);
    expect(levelMapChanged(base, { ...base, launcherLinks: [] })).toBe(false);
  });

  it('marks both ends in the history diff, both ways', () => {
    const before = toDocument(linked());
    const after = toDocument(linked(null));
    const ends = [
      { x: TRIGGER.x, y: TRIGGER.y },
      { x: LAUNCHER.x, y: LAUNCHER.y }
    ];
    expect(historyDiff(before, after).cells).toEqual(ends);
    expect(historyDiff(after, before).cells).toEqual(ends);
    expect(historyDiff(before, cloneDocument(before)).cells).toEqual([]);
  });

  it('survives a draft round trip', () => {
    const level = levelFromDocument(toDocument(linked()), CONTEXT);
    const draft: EditorDraft = { v: DRAFT_VERSION, tabId: 't', writtenAt: 1, source: { packId: null, levelId: null }, currentLevelId: 'x', baseHash: '', level };
    const text = serializeDraft(draft, 1_000_000);
    expect(text.ok).toBe(true);
    const parsed = parseDraft(text.ok ? text.text : '', 1_000_000);
    expect(parsed.ok && parsed.draft.level.launcherLinks).toEqual([LINK]);
    expect(parsed.ok && levelFingerprint(parsed.draft.level)).toBe(levelFingerprint(level));
    expect(levelFingerprint(level)).not.toBe(levelFingerprint(levelFromDocument(toDocument(linked(null)), CONTEXT)));
  });

  it('locks the Lynx choice: launcher links alone are Epoxy only content', () => {
    const map = linked();
    // The ends hidden under a removable top do not show in the grids, so the link is what says it.
    map.terrain[TRIGGER.y][TRIGGER.x] = 'floor';
    map.terrain[LAUNCHER.y][LAUNCHER.x] = 'floor';
    const doc = toDocument(map);
    expect(requiresEpoxyRules(doc.winRule, hasEpoxyOnlyContent(doc))).toBe(true);
    const plain = toDocument(linked(null));
    plain.terrain[TRIGGER.y][TRIGGER.x] = 'floor';
    plain.terrain[LAUNCHER.y][LAUNCHER.x] = 'floor';
    expect(requiresEpoxyRules(plain.winRule, hasEpoxyOnlyContent(plain))).toBe(false);
  });

  it('is refused by the .DAT export', () => {
    expect(datRefusalReason(toLevel(linked()))).toBe('laser_content');
  });
});

describe('painting over a trigger or a launcher', () => {
  it('drops the link, with the count, when either end is overwritten', () => {
    for (const end of [TRIGGER, LAUNCHER]) {
      const result = paintTerrain(linked(), end.x, end.y, 'wall');
      expect(result.removedLinks).toBe(1);
      expect('launcherLinks' in result.map).toBe(false);
    }
  });

  it('keeps it when the same tile is painted again, and when another cell is painted', () => {
    expect(paintTerrain(linked(), TRIGGER.x, TRIGGER.y, TRIGGER_TILE).changed).toBe(false);
    const other = paintTerrain(linked(), 2, 4, 'wall');
    expect(other.removedLinks).toBe(0);
    expect(other.map.launcherLinks).toEqual([LINK]);
  });

  it('leaves the source untouched', () => {
    const source = linked();
    paintTerrain(source, TRIGGER.x, TRIGGER.y, 'wall');
    expect(source.launcherLinks).toEqual([LINK]);
  });

  it('is announced by the brush tool with the removed links message', () => {
    const outcome = applyTool({
      map: linked(),
      tool: 'brush',
      brush: { kind: 'terrain', id: 'floor' },
      dir: 'S',
      x: LAUNCHER.x,
      y: LAUNCHER.y,
      pendingWire: null
    });
    expect(outcome.messages).toEqual([{ key: 'editor.layout.status.links_removed', params: { count: 1 } }]);
  });

  it('is dropped by the eraser, and a link alone makes the cell erasable', () => {
    const erased = eraseCell(linked(), TRIGGER.x, TRIGGER.y);
    expect(erased.removedLinks).toBe(1);
    expect('launcherLinks' in erased.map).toBe(false);
    // A floor cell that still carries a (stale) link end is not "empty".
    const stale = linked();
    stale.terrain[TRIGGER.y][TRIGGER.x] = 'floor';
    expect(eraseCell(stale, TRIGGER.x, TRIGGER.y).changed).toBe(true);
  });

  it('is dropped by a flood fill across a region holding an end', () => {
    const result = floodFillTerrain(linked(), 2, 4, 'ice');
    // The trigger and launcher tiles are not part of the floor region: the link stays.
    expect(result.removedLinks).toBe(0);
    expect(result.map.launcherLinks).toEqual([LINK]);
    const trigger = floodFillTerrain(linked(), TRIGGER.x, TRIGGER.y, 'floor');
    expect(trigger.removedLinks).toBe(1);
  });
});

describe('resizing with launcher links', () => {
  const grow = (col: 0 | 1 | 2, row: 0 | 1 | 2): ReturnType<typeof resizeMap> =>
    resizeMap(linked(), WIDTH + 2, HEIGHT + 2, BOUNDS, { col, row });

  it.each([
    ['top left', ANCHOR_START, 0, 0],
    ['centre', ANCHOR_CENTRE, 1, 1],
    ['bottom right', ANCHOR_END, 2, 2]
  ])('translates the links of a growth anchored %s', (_name, step, dx, dy) => {
    const result = grow(step, step);
    expect(result.map.launcherLinks).toEqual([
      { buttonX: TRIGGER.x + dx, buttonY: TRIGGER.y + dy, launcherX: LAUNCHER.x + dx, launcherY: LAUNCHER.y + dy }
    ]);
    expect(result.report.droppedLauncherLinks).toBeUndefined();
    expect(result.map.terrain[TRIGGER.y + dy][TRIGGER.x + dx]).toBe(TRIGGER_TILE);
  });

  it('keeps a link through a crop that leaves both ends', () => {
    const result = resizeMap(linked(), 8, HEIGHT, BOUNDS, { col: ANCHOR_CENTRE, row: ANCHOR_START });
    expect(result.map.launcherLinks).toEqual([{ buttonX: 2, buttonY: 2, launcherX: 5, launcherY: 2 }]);
  });

  it('drops and counts a link whose end is cropped away', () => {
    const result = resizeMap(linked(), 6, HEIGHT, BOUNDS);
    expect('launcherLinks' in result.map).toBe(false);
    expect(result.report.droppedLauncherLinks).toBe(1);
    const note = describeResize(result).find((entry) => entry.key === 'editor.layout.size.dropped_links');
    expect(note?.params).toEqual({ count: 1 });
  });

  it('drops and counts a link whose end the new border turns to wall', () => {
    // Anchored at the end, a 7 wide room puts the trigger (x = 3 - 3) on the new left ring.
    const result = resizeMap(linked(), 7, HEIGHT, BOUNDS, { col: ANCHOR_END, row: ANCHOR_START });
    expect(result.map.terrain[TRIGGER.y][0]).toBe('wall');
    expect('launcherLinks' in result.map).toBe(false);
    expect(result.report.droppedLauncherLinks).toBe(1);
  });
});

describe('selection edits with launcher links', () => {
  const triggerCell = { x: TRIGGER.x, y: TRIGGER.y, width: 1, height: 1 };
  const row = { x: TRIGGER.x, y: TRIGGER.y, width: LAUNCHER.x - TRIGGER.x + 1, height: 1 };

  it('never put a link in a clip', () => {
    const clip = extractClip(linked(), row, false);
    expect(JSON.stringify(clip)).not.toContain('launcherLinks');
    expect(clip.terrain[0][0]).toBe(TRIGGER_TILE);
  });

  it('are dropped by clearing a rectangle holding an end, with the count', () => {
    const result = clearRect(linked(), triggerCell);
    expect(result.droppedLinks).toBe(1);
    expect('launcherLinks' in result.map).toBe(false);
  });

  it('are dropped by pasting over an end, and not pasted', () => {
    const clip = extractClip(linked(null), triggerCell, false);
    const result = pasteClip(linked(), clip, LAUNCHER.x, LAUNCHER.y, 'epoxy');
    expect(result.droppedLinks).toBe(1);
    expect('launcherLinks' in result.map).toBe(false);
    // Pasting the pair elsewhere makes the trigger and launcher tiles, but no link.
    const rowClip = extractClip(linked(), row, false);
    const copy = pasteClip(linked(), rowClip, 3, 4, 'epoxy');
    expect(copy.droppedLinks).toBe(0);
    expect(copy.map.launcherLinks).toEqual([LINK]);
    expect(copy.map.terrain[4][3]).toBe(TRIGGER_TILE);
  });

  it('are dropped by a terrain fill over an end, and kept by an item fill', () => {
    const fill = fillRect(linked(), triggerCell, { kind: 'terrain', id: 'floor' }, 'S', 'epoxy');
    expect(fill.droppedLinks).toBe(1);
    expect('launcherLinks' in fill.map).toBe(false);
    const item = fillRect(linked(), triggerCell, { kind: 'item', id: 'chip' }, 'S', 'epoxy');
    expect(item.droppedLinks).toBe(0);
    expect(item.map.launcherLinks).toEqual([LINK]);
  });

  it('move and translate with a rectangle holding both ends', () => {
    const result = moveRect(linked(), row, 0, 1);
    expect(result.droppedLinks).toBe(0);
    expect(result.map.terrain[TRIGGER.y + 1][TRIGGER.x]).toBe(TRIGGER_TILE);
    expect(result.map.launcherLinks).toEqual([{ buttonX: TRIGGER.x, buttonY: TRIGGER.y + 1, launcherX: LAUNCHER.x, launcherY: LAUNCHER.y + 1 }]);
  });

  it('are dropped, with the count, by a move that takes one end only', () => {
    const result = moveRect(linked(), triggerCell, 0, 1);
    expect(result.droppedLinks).toBe(1);
    expect('launcherLinks' in result.map).toBe(false);
  });

  it('are dropped by a move that overwrites an end', () => {
    const source = linked();
    source.terrain[3][6] = 'wall';
    const result = moveRect(source, { x: 6, y: 3, width: 1, height: 1 }, 0, -1);
    expect(result.droppedLinks).toBe(1);
    expect('launcherLinks' in result.map).toBe(false);
  });

  it('keep an unrelated link in place through a move', () => {
    const source = linked([LINK, { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 }]);
    source.terrain[4][3] = TRIGGER_TILE;
    source.terrain[4][6] = LAUNCHER_TILE;
    const result = moveRect(source, row, 0, -1);
    expect(result.map.launcherLinks).toEqual(
      expect.arrayContaining([
        { buttonX: 3, buttonY: 4, launcherX: 6, launcherY: 4 },
        { buttonX: 3, buttonY: 1, launcherX: 6, launcherY: 1 }
      ])
    );
    expect(result.map.launcherLinks).toHaveLength(2);
  });
});
