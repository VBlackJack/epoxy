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
 * The track cells as data: the CC2 railroad modifier, the canonical form of a level's `railTracks`, the pack format and the
 * editor, which carries the field through without authoring it. Every level and modifier here is synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_VERSION_V13 } from '../config/constants';
import { normalizeRailTracks, stripInvalidTextFields } from '../config/ConfigValidation';
import { RAIL_JUNCTION_TILE_ID } from '../core/coreConstants';
import type { CompiledLevel, RailTrackCell } from '../core/types';
import { eraseCell, floodFillTerrain, paintTerrain } from '../editor/mapEdits';
import { historyDiff } from '../editor/historyDiff';
import { clearRect, extractClip, moveRect, pasteClip } from '../editor/selectionEdits';
import { levelMapChanged } from '../editor/saveTarget';
import { cloneDocument, sameDocument, withEditedMap } from '../editor/editorDocument';
import { documentFromLevel, levelFromDocument } from '../editor/editorLevelIo';
import { resizeMap } from '../editor/mapEdits';
import { parsePackJson, serializePack } from '../packs/packJson';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { decodeCc2Track, isCc2Junction } from './cc2Tracks';

/** Modifier bits of the railroad tile. */
const SWITCH_FLAG = 0x40;
const ACTIVE_SHIFT = 8;
const ENTRY_SHIFT = 12;

const CELLS: RailTrackCell[] = [
  { x: 2, y: 2, mask: 0x31 },
  { x: 3, y: 4, mask: 0x30, active: 4, entry: 'W' }
];

/** A small epoxy level with track cells on the given cells. */
function levelWith(cells: RailTrackCell[] = CELLS): CompiledLevel {
  const level = makeLevel('rails');
  for (const cell of cells) level.terrain[cell.y][cell.x] = RAIL_JUNCTION_TILE_ID;
  return { ...level, railTracks: cells.map((cell) => ({ ...cell })) };
}

const EXPORT = { id: 'rails', number: 1, password: 'TEST', fallbackTitle: 'Rails' };

beforeEach(() => {
  loadTestConfigs();
});

describe('the CC2 railroad modifier', () => {
  it('reads the six segment bits in the order of the Lexy railroad', () => {
    for (let bit = 0; bit < 6; bit++) expect(decodeCc2Track(1 << bit)).toEqual({ mask: 1 << bit });
    expect(decodeCc2Track(0x3f)).toEqual({ mask: 0x3f });
  });

  it('reads the switch flag and the active segment together', () => {
    expect(decodeCc2Track(0x11 | SWITCH_FLAG | (4 << ACTIVE_SHIFT))).toEqual({ mask: 0x11, active: 4 });
    // The active bits mean nothing without the flag.
    expect(decodeCc2Track(0x11 | (4 << ACTIVE_SHIFT))).toEqual({ mask: 0x11 });
    // An active number past the six segments names no segment.
    expect(decodeCc2Track(0x11 | SWITCH_FLAG | (9 << ACTIVE_SHIFT))).toEqual({ mask: 0x11 });
  });

  it('reads the entered side as the side opposite the direction of travel', () => {
    // Direction order is north, east, south, west: moving north entered from the south (the default, left out).
    expect(decodeCc2Track(0x20)).toEqual({ mask: 0x20 });
    expect(decodeCc2Track(0x20 | (1 << ENTRY_SHIFT))).toEqual({ mask: 0x20, entry: 'W' });
    expect(decodeCc2Track(0x20 | (2 << ENTRY_SHIFT))).toEqual({ mask: 0x20, entry: 'N' });
    expect(decodeCc2Track(0x20 | (3 << ENTRY_SHIFT))).toEqual({ mask: 0x20, entry: 'E' });
  });

  it('keeps a track modifier with no segment and no switch as a cell that lets nobody in', () => {
    expect(decodeCc2Track(undefined)).toEqual({ mask: 0 });
  });

  it('tells a junction (several segments, or a switch) from a plain track', () => {
    expect(isCc2Junction(0x10)).toBe(false);
    expect(isCc2Junction(0x11)).toBe(true);
    expect(isCc2Junction(0x10 | SWITCH_FLAG | (4 << ACTIVE_SHIFT))).toBe(true);
  });
});

describe('the canonical form of the track cells', () => {
  let terrain: string[][] = [];
  beforeEach(() => {
    terrain = levelWith().terrain;
  });

  it('keeps well formed cells in reading order', () => {
    expect(normalizeRailTracks([...CELLS].reverse(), terrain, 'epoxy')).toEqual(CELLS);
  });

  it('drops cells outside the grid, off a track cell tile, empty, or listed twice', () => {
    const noisy = [
      { x: 2, y: 2, mask: 0x31 },
      { x: 2, y: 2, mask: 0x01 },
      { x: 99, y: 2, mask: 1 },
      { x: 1, y: 1, mask: 1 },
      { x: 3, y: 4, mask: 0 },
      'nope',
      null
    ];
    expect(normalizeRailTracks(noisy, terrain, 'epoxy')).toEqual([{ x: 2, y: 2, mask: 0x31 }]);
  });

  it('keeps a switch with no segment held, masks stray bits and drops a default entry side', () => {
    const odd = [
      { x: 2, y: 2, mask: 0, active: 3 },
      { x: 3, y: 4, mask: 0xff, entry: 'S' }
    ];
    expect(normalizeRailTracks(odd, terrain, 'epoxy')).toEqual([
      { x: 2, y: 2, mask: 0, active: 3 },
      { x: 3, y: 4, mask: 0x3f }
    ]);
  });

  it('is an Epoxy feature only', () => {
    expect(normalizeRailTracks(CELLS, terrain, 'lynx')).toBeNull();
    expect(normalizeRailTracks(undefined, terrain, 'epoxy')).toBeNull();
  });

  it('is repaired in a stored level by the text field check', () => {
    const level = { ...levelWith(), railTracks: [...CELLS, { x: 1, y: 1, mask: 4 }] };
    expect(stripInvalidTextFields(level).railTracks).toEqual(CELLS);
    const bare = { ...levelWith([]), railTracks: [{ x: 1, y: 1, mask: 4 }] };
    expect(stripInvalidTextFields(bare).railTracks).toBeUndefined();
    const good = levelWith();
    expect(stripInvalidTextFields(good)).toBe(good);
  });

  it('is compiled out of a level blueprint onto the track cells that exist', () => {
    const level = makeLevel('compiled', { railTracks: [{ x: 1, y: 1, mask: 2 }] });
    expect(level.railTracks).toBeUndefined();
  });
});

describe('the pack format', () => {
  it('writes format 13 for a level with track cells and reads the cells back', () => {
    const level = levelWith();
    const text = serializePack('Rails', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V13);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), () => 7000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.levels[0].railTracks).toEqual(CELLS);
  });

  it('writes format 13 for a level that only holds the railroad sign', () => {
    const level = makeLevel('sign');
    level.items[1][1] = 'railroad_sign';
    expect(JSON.parse(serializePack('Sign', [level])).version).toBe(PACK_JSON_VERSION_V13);
  });

  it('leaves the format of a level without them alone', () => {
    expect(JSON.parse(serializePack('Plain', [makeLevel('plain')])).version).toBeLessThan(PACK_JSON_VERSION_V13);
  });
});

describe('the editor', () => {
  const texts = { title: 'Rails', hint: '' };

  it('carries the track cells through a load and a save unchanged', () => {
    const level = levelWith();
    const doc = documentFromLevel(level, texts);
    expect(doc.railTracks).toEqual(CELLS);
    const saved = levelFromDocument(doc, EXPORT);
    expect(saved.railTracks).toEqual(CELLS);
    expect(saved.terrain).toEqual(level.terrain);
  });

  it('keeps them in a copy of the document and compares documents by them', () => {
    const doc = documentFromLevel(levelWith(), texts);
    const copy = cloneDocument(doc);
    expect(copy.railTracks).toEqual(CELLS);
    expect(copy.railTracks).not.toBe(doc.railTracks);
    expect(sameDocument(doc, copy)).toBe(true);
    const other = cloneDocument(doc);
    other.railTracks = [{ x: 2, y: 2, mask: 0x01 }, CELLS[1]];
    expect(sameDocument(doc, other)).toBe(false);
  });

  it('loses them when an edit result no longer has them', () => {
    const doc = documentFromLevel(levelWith(), texts);
    const { railTracks: _gone, ...bare } = doc;
    expect(withEditedMap(doc, bare).railTracks).toBeUndefined();
  });

  it('does not export a cell the terrain no longer makes a track cell', () => {
    const doc = documentFromLevel(levelWith(), texts);
    doc.terrain[2][2] = 'floor';
    expect(levelFromDocument(doc, EXPORT).railTracks).toEqual([CELLS[1]]);
  });

  it('exports none for a level of another ruleset', () => {
    const doc = documentFromLevel(levelWith(), texts);
    doc.ruleset = 'lynx';
    expect(levelFromDocument(doc, EXPORT).railTracks).toBeUndefined();
  });

  it('moves them with their cells when the map is resized, and drops the ones that leave', () => {
    const doc = documentFromLevel(levelWith(), texts);
    const grown = resizeMap(doc, doc.terrain[0].length + 2, doc.terrain.length + 2, ConfigRegistry.getLevelSizeBounds(), { col: 2, row: 2 });
    expect(grown.map.railTracks?.map((cell) => [cell.x, cell.y])).toEqual(CELLS.map((cell) => [cell.x + 2, cell.y + 2]));
    const cropped = resizeMap(doc, 4, 4, ConfigRegistry.getLevelSizeBounds());
    expect(cropped.map.railTracks?.map((cell) => [cell.x, cell.y])).toEqual([[2, 2]]);
  });

  it('moves with the cells of a move, a copy and a paste, and goes with a clear', () => {
    const doc = documentFromLevel(levelWith(), texts);
    const rect = { x: 2, y: 2, width: 1, height: 1 };
    const clip = extractClip(doc, rect, false);
    expect(clip.railTracks).toEqual([{ dx: 0, dy: 0, mask: 0x31 }]);
    const pasted = pasteClip(doc, clip, 5, 5, 'epoxy');
    expect(pasted.map.railTracks).toEqual([...CELLS, { x: 5, y: 5, mask: 0x31 }].sort((a, b) => a.y - b.y || a.x - b.x));
    const moved = moveRect(doc, rect, 3, 0);
    expect(moved.map.railTracks).toEqual([{ x: 3, y: 4, mask: 0x30, active: 4, entry: 'W' }, { x: 5, y: 2, mask: 0x31 }].sort((a, b) => a.y - b.y || a.x - b.x));
    expect(clearRect(doc, rect).map.railTracks).toEqual([CELLS[1]]);
  });

  it('drops the entry of a cell that stops being a track cell', () => {
    const doc = documentFromLevel(levelWith(), texts);
    expect(paintTerrain(doc, 2, 2, 'floor').map.railTracks).toEqual([CELLS[1]]);
    expect(eraseCell(doc, 3, 4).map.railTracks).toEqual([CELLS[0]]);
    expect(floodFillTerrain(doc, 2, 2, 'wall').map.railTracks).toEqual([CELLS[1]]);
    // Painting the same tile again changes nothing.
    expect(paintTerrain(doc, 2, 2, RAIL_JUNCTION_TILE_ID).changed).toBe(false);
  });

  it('counts a track cell change in the history diff and in the map signature', () => {
    const before = documentFromLevel(levelWith(), texts);
    const after = cloneDocument(before);
    after.railTracks = [{ x: 2, y: 2, mask: 0x01 }, CELLS[1]];
    expect(historyDiff(before, after).cells).toEqual([{ x: 2, y: 2 }]);
    expect(levelMapChanged(levelFromDocument(before, EXPORT), levelFromDocument(after, EXPORT))).toBe(true);
    expect(levelMapChanged(levelFromDocument(before, EXPORT), levelFromDocument(cloneDocument(before), EXPORT))).toBe(false);
  });
});
