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
import { CompiledLevel, LevelPack } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel, makeUserPack } from '../test/packFixtures';
import {
  badgeLabelKey,
  buildLevelRows,
  buildLibraryRows,
  buildPackActions,
  dropSlotAt,
  dropTargetIndex,
  EDIT_BLOCKED_REASON_KEY,
  engineBadgesOf,
  managerState,
  movedLevelIndex,
  packFileName,
  resolveSelection,
  selectionAfterRemoval,
  transferTargets
} from './packManagerModel';

const name = (pack: LevelPack): string => pack.name;

describe('engineBadgesOf', () => {
  it('maps a missing ruleset to Epoxy and lists each badge once, in a fixed order', () => {
    expect(engineBadgesOf([{}, { ruleset: 'epoxy' }])).toEqual(['epoxy']);
    expect(engineBadgesOf([{ ruleset: 'cc3d' }, { ruleset: 'lynx' }, {}])).toEqual(['epoxy', 'lynx', 'cc3d']);
  });

  it('adds Sokoban for the targets win rule', () => {
    expect(engineBadgesOf([{ winRule: 'targets' }])).toEqual(['epoxy', 'sokoban']);
    expect(engineBadgesOf([{ ruleset: 'lynx', winRule: 'targets' }])).toEqual(['lynx', 'sokoban']);
  });

  it('is empty for no levels', () => {
    expect(engineBadgesOf([])).toEqual([]);
  });

  it('gives each badge a translation key', () => {
    expect(badgeLabelKey('sokoban')).toBe('app.packs.manager.badge.sokoban.label');
  });
});

describe('library rows', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  let imported: LevelPack;
  let mineA: LevelPack;
  let mineB: LevelPack;
  beforeEach(() => {
    imported = { id: 'imp', name: 'Imported', builtIn: false, levels: [makeLevel('i1')] };
    mineA = makeUserPack('a', ['a1', 'a2']);
    mineB = makeUserPack('b', []);
  });

  it('lists the packs the player created first, then the imported ones', () => {
    const rows = buildLibraryRows([imported, mineA, mineB], name);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'imp']);
    expect(rows.map((r) => r.imported)).toEqual([false, false, true]);
  });

  it('treats the custom pack as the player\'s own even without the flag', () => {
    const custom: LevelPack = { id: 'epoxy_custom', name: 'Custom', builtIn: false, levels: [makeLevel('c1')] };
    const rows = buildLibraryRows([imported, custom], name);
    expect(rows.map((r) => r.id)).toEqual(['epoxy_custom', 'imp']);
    expect(rows[0].imported).toBe(false);
  });

  it('carries the display name, count and badges', () => {
    const [row] = buildLibraryRows([mineA], (p) => `Name of ${p.id}`);
    expect(row).toMatchObject({ id: 'a', label: 'Name of a', levelCount: 2, badges: ['epoxy'] });
  });

  it('gives an empty pack no badge', () => {
    expect(buildLibraryRows([mineB], name)[0].badges).toEqual([]);
  });

  it('derives the manager state', () => {
    const rows = buildLibraryRows([mineA, mineB], name);
    expect(managerState([], undefined)).toBe('no_packs');
    expect(managerState(rows, rows[0])).toBe('pack');
    expect(managerState(rows, rows[1])).toBe('empty_pack');
  });

  it('keeps a wanted selection that exists, else takes the first row', () => {
    const rows = buildLibraryRows([mineA, mineB], name);
    expect(resolveSelection(rows, 'b')).toBe('b');
    expect(resolveSelection(rows, 'gone')).toBe('a');
    expect(resolveSelection(rows, null)).toBe('a');
    expect(resolveSelection([], 'a')).toBeNull();
  });

  it('moves the selection to the neighbour of a removed pack', () => {
    const rows = buildLibraryRows([mineA, mineB, imported], name);
    expect(selectionAfterRemoval(rows, 'a')).toBe('b');
    expect(selectionAfterRemoval(rows, 'imp')).toBe('b');
    expect(selectionAfterRemoval(buildLibraryRows([mineA], name), 'a')).toBeNull();
  });

  it('lists every other pack as a transfer target', () => {
    const rows = buildLibraryRows([mineA, mineB, imported], name);
    expect(transferTargets(rows, 'a').map((t) => t.id)).toEqual(['b', 'imp']);
  });
});

describe('level rows', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  let levels: CompiledLevel[];
  beforeEach(() => {
    levels = [
      makeLevel('l1'),
      { ...makeLevel('l2'), ruleset: 'cc3d' as const },
      { ...makeLevel('l3'), ruleset: 'lynx' as const }
    ];
  });

  it('numbers the rows and bounds the move buttons', () => {
    const rows = buildLevelRows(levels, (l) => `T ${l.id}`);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.title)).toEqual(['T l1', 'T l2', 'T l3']);
    expect(rows.map((r) => r.canMoveUp)).toEqual([false, true, true]);
    expect(rows.map((r) => r.canMoveDown)).toEqual([true, true, false]);
  });

  it('lets the editor open every level, a cc3d one included, with no blocking reason', () => {
    const rows = buildLevelRows(levels, () => '');
    expect(rows.map((r) => r.canEdit)).toEqual([true, true, true]);
    expect(rows.map((r) => r.editBlockedReasonKey)).toEqual([null, null, null]);
    // The reason stays defined for a ruleset the editor may one day refuse.
    expect(EDIT_BLOCKED_REASON_KEY).toBe('app.packs.manager.level.edit_blocked.label');
  });

  it('shows one engine badge set per level', () => {
    const rows = buildLevelRows(levels, () => '');
    expect(rows.map((r) => r.badges)).toEqual([['epoxy'], ['cc3d'], ['lynx']]);
  });

  it('has no row for an empty pack', () => {
    expect(buildLevelRows([], () => '')).toEqual([]);
  });

  it('computes the index a moved row ends at', () => {
    expect(movedLevelIndex(2, 'up')).toBe(1);
    expect(movedLevelIndex(2, 'down')).toBe(3);
  });
});

describe('pack actions', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('disables play and exports for an empty pack', () => {
    expect(buildPackActions([], () => true)).toEqual({ canPlay: false, canExportJson: false, canExportCcl: false });
  });

  it('enables .CCL export only when some level can be exported', () => {
    const levels = [makeLevel('a')];
    expect(buildPackActions(levels, () => false)).toEqual({ canPlay: true, canExportJson: true, canExportCcl: false });
    expect(buildPackActions(levels, () => true).canExportCcl).toBe(true);
  });
});

describe('packFileName', () => {
  it('reduces a name to lower case letters, digits and underscores', () => {
    expect(packFileName('My Levels #2!', 'id')).toBe('my_levels_2.json');
  });

  it('drops accents', () => {
    expect(packFileName('Énigmes déjà vues', 'id')).toBe('enigmes_deja_vues.json');
  });

  it('falls back to the id, then to a fixed name, when nothing usable is left', () => {
    expect(packFileName('???', 'user_pack_1')).toBe('user_pack_1.json');
    expect(packFileName('???', '!!!')).toBe('pack.json');
  });
});

describe('drag and drop slots', () => {
  const mids = [50, 150, 250];

  it('finds the insertion slot from the row midpoints', () => {
    expect(dropSlotAt(10, mids)).toBe(0);
    expect(dropSlotAt(100, mids)).toBe(1);
    expect(dropSlotAt(200, mids)).toBe(2);
    expect(dropSlotAt(999, mids)).toBe(3);
    expect(dropSlotAt(10, [])).toBe(0);
  });

  it('turns a slot into the index the row ends up at', () => {
    // Dragging the first of three rows.
    expect([0, 1, 2, 3].map((slot) => dropTargetIndex(0, slot))).toEqual([0, 0, 1, 2]);
    // Dragging the last.
    expect([0, 1, 2, 3].map((slot) => dropTargetIndex(2, slot))).toEqual([0, 1, 2, 2]);
  });
});

describe('library rows and author', () => {
  it('carries the author of a pack and leaves the field out when there is none', () => {
    const withAuthor = { ...makeUserPack('a', ['x']), author: 'Ann' };
    const [row] = buildLibraryRows([withAuthor], name);
    expect(row.author).toBe('Ann');
    const [plain] = buildLibraryRows([makeUserPack('b', ['x'])], name);
    expect('author' in plain).toBe(false);
  });
});
