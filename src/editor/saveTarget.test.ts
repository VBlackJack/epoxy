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
import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import { CompiledLevel, Ruleset } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { EDITOR_DEFAULT_PASSWORD } from '../ui/uiConstants';
import {
  decideSave,
  isSaveChord,
  isUserOwnedPack,
  levelMapChanged,
  mayRebindAfterSave,
  needsImportedConfirmation,
  nextEditableIndex,
  pickSaveDestination,
  prepareLevelForSave,
  reconcileSource,
  resolveSavedPassword
} from './saveTarget';

const mine = { id: 'user_1', userCreated: true };
const imported = { id: 'pack_import' };
const none = new Set<string>();

describe('decideSave', () => {
  it('updates in place when the source pack is a pack the player created', () => {
    expect(
      decideSave({
        source: { packId: 'user_1', levelId: 'a' },
        editablePacks: [mine, imported],
        confirmedImportedPackIds: none,
        forceCopy: false
      })
    ).toEqual({ kind: 'in_place', packId: 'user_1' });
  });

  it('asks for a destination when the source is read-only or absent', () => {
    for (const packId of ['epoxy_campaign', 'epoxy_procedural', null]) {
      expect(
        decideSave({
          source: { packId, levelId: 'a' },
          editablePacks: [mine],
          confirmedImportedPackIds: none,
          forceCopy: false
        })
      ).toEqual({ kind: 'choose_pack' });
    }
  });

  it('asks to confirm the first save into an imported pack, then saves in place', () => {
    const base = {
      source: { packId: 'pack_import', levelId: 'a' },
      editablePacks: [mine, imported],
      forceCopy: false
    };
    expect(decideSave({ ...base, confirmedImportedPackIds: none })).toEqual({
      kind: 'confirm_imported',
      packId: 'pack_import'
    });
    expect(decideSave({ ...base, confirmedImportedPackIds: new Set(['pack_import']) })).toEqual({
      kind: 'in_place',
      packId: 'pack_import'
    });
  });

  it('always asks for a destination when a copy is wanted', () => {
    expect(
      decideSave({
        source: { packId: 'user_1', levelId: 'a' },
        editablePacks: [mine],
        confirmedImportedPackIds: none,
        forceCopy: true
      })
    ).toEqual({ kind: 'choose_pack' });
  });

  it('updates in place for a new level aimed at a pack (no level id yet)', () => {
    expect(
      decideSave({
        source: { packId: 'user_1', levelId: null },
        editablePacks: [mine],
        confirmedImportedPackIds: none,
        forceCopy: false
      })
    ).toEqual({ kind: 'in_place', packId: 'user_1' });
  });
});

describe('needsImportedConfirmation', () => {
  it('only concerns imported packs not yet confirmed', () => {
    expect(needsImportedConfirmation(imported, none)).toBe(true);
    expect(needsImportedConfirmation(imported, new Set(['pack_import']))).toBe(false);
    expect(needsImportedConfirmation(mine, none)).toBe(false);
    expect(needsImportedConfirmation(undefined, none)).toBe(false);
  });
});

describe('isUserOwnedPack', () => {
  it('counts created packs and the custom pack, not imported ones', () => {
    expect(isUserOwnedPack(mine)).toBe(true);
    expect(isUserOwnedPack({ id: 'epoxy_custom' })).toBe(true);
    expect(isUserOwnedPack(imported)).toBe(false);
  });

  it('never asks to confirm saving into the custom pack', () => {
    expect(needsImportedConfirmation({ id: 'epoxy_custom' }, none)).toBe(false);
  });

  it('preselects the custom pack like one the player created', () => {
    expect(pickSaveDestination([imported, { id: 'epoxy_custom' }], null)).toBe('epoxy_custom');
  });
});

describe('reconcileSource', () => {
  const packs = [
    { id: 'a', levels: [{ id: 'a1' }, { id: 'a2' }] },
    { id: 'b', levels: [{ id: 'b1' }] }
  ];

  it('keeps a source that is still valid', () => {
    const source = { packId: 'a', levelId: 'a1' };
    expect(reconcileSource(source, packs)).toEqual({ source, lost: false });
  });

  it('keeps a source with no pack, and a new level aimed at an existing pack', () => {
    expect(reconcileSource({ packId: null, levelId: null }, packs).lost).toBe(false);
    const aimed = { packId: 'b', levelId: null };
    expect(reconcileSource(aimed, packs)).toEqual({ source: aimed, lost: false });
  });

  it('follows a level moved to another pack', () => {
    const moved = [
      { id: 'a', levels: [{ id: 'a2' }] },
      { id: 'b', levels: [{ id: 'b1' }, { id: 'a1' }] }
    ];
    expect(reconcileSource({ packId: 'a', levelId: 'a1' }, moved)).toEqual({
      source: { packId: 'b', levelId: 'a1' },
      lost: false
    });
  });

  it('loses a deleted level', () => {
    const without = [{ id: 'a', levels: [{ id: 'a2' }] }];
    expect(reconcileSource({ packId: 'a', levelId: 'a1' }, without)).toEqual({
      source: { packId: null, levelId: null },
      lost: true
    });
  });

  it('loses the source when its pack is deleted, even for a new level aimed at it', () => {
    expect(reconcileSource({ packId: 'gone', levelId: 'a1' }, packs).lost).toBe(true);
    expect(reconcileSource({ packId: 'gone', levelId: null }, packs).lost).toBe(true);
  });
});

describe('mayRebindAfterSave', () => {
  it('allows a rebind only when no other level was loaded meanwhile', () => {
    expect(mayRebindAfterSave(3, 3)).toBe(true);
    expect(mayRebindAfterSave(3, 4)).toBe(false);
  });
});

describe('pickSaveDestination', () => {
  it('prefers the last destination while it exists', () => {
    expect(pickSaveDestination([imported, mine], 'pack_import')).toBe('pack_import');
  });

  it('falls back to the first pack the player created', () => {
    expect(pickSaveDestination([imported, mine], 'gone')).toBe('user_1');
    expect(pickSaveDestination([imported, mine], null)).toBe('user_1');
  });

  it('returns null when there is nothing to preselect', () => {
    expect(pickSaveDestination([imported], null)).toBeNull();
    expect(pickSaveDestination([], 'user_1')).toBeNull();
  });
});

describe('level comparison and preparation', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const base = (): CompiledLevel => ({
    ...makeLevel('a'),
    theme: 'cyber_neon',
    solution: 'NNEE',
    titleKey: 'levels.l1.title',
    hintKey: 'levels.l1.hint'
  });
  const edited = (level: CompiledLevel, patch: Partial<CompiledLevel>): CompiledLevel => ({ ...level, ...patch });
  const flipped = (level: CompiledLevel): string[][] => {
    const terrain = level.terrain.map((row) => [...row]);
    terrain[2][2] = terrain[2][2] === 'wall' ? 'floor' : 'wall';
    return terrain;
  };

  it('ignores titles, hints and the time limit when comparing maps', () => {
    const level = base();
    expect(
      levelMapChanged(level, edited(level, { customTitle: 'x', customHint: 'y', timeLimitSeconds: 5 }))
    ).toBe(false);
  });

  it('ignores the order of entities', () => {
    const entities = [
      { x: 2, y: 2, type: 'bug', dir: 'N' as const },
      { x: 3, y: 3, type: 'bug', dir: 'S' as const }
    ];
    const level = edited(base(), { entities });
    expect(levelMapChanged(level, edited(level, { entities: [entities[1], entities[0]] }))).toBe(false);
  });

  it('sees a changed cell, start, rule or chip count', () => {
    const level = base();
    expect(levelMapChanged(level, edited(level, { terrain: flipped(level) }))).toBe(true);
    expect(levelMapChanged(level, edited(level, { playerStart: { x: 2, y: 2, dir: 'N' } }))).toBe(true);
    expect(levelMapChanged(level, edited(level, { winRule: 'targets' }))).toBe(true);
    expect(levelMapChanged(level, edited(level, { ruleset: 'lynx' }))).toBe(true);
    expect(levelMapChanged(level, edited(level, { chipsRequired: 3 }))).toBe(true);
  });

  it('treats an absent win rule and ruleset as their defaults', () => {
    const level = base();
    expect(levelMapChanged(level, edited(level, { winRule: 'exit', ruleset: 'epoxy' }))).toBe(false);
  });

  it('keeps theme, keys and solution while the map and the texts are untouched', () => {
    const original = base();
    const draft: CompiledLevel = {
      ...original,
      theme: undefined,
      solution: undefined,
      titleKey: undefined,
      hintKey: undefined,
      customTitle: 'Shown title',
      customHint: 'Shown hint'
    };
    const { level, mapChanged } = prepareLevelForSave(draft, original, { title: 'Shown title', hint: 'Shown hint' });
    expect(mapChanged).toBe(false);
    expect(level.theme).toBe('cyber_neon');
    expect(level.solution).toBe('NNEE');
    expect(level.titleKey).toBe('levels.l1.title');
    expect(level.hintKey).toBe('levels.l1.hint');
    expect(level.customTitle).toBeUndefined();
    expect(level.customHint).toBeUndefined();
  });

  it('drops a key whose text changed, and the solution when the map changed', () => {
    const original = base();
    const draft: CompiledLevel = {
      ...original,
      terrain: flipped(original),
      theme: undefined,
      solution: undefined,
      titleKey: undefined,
      hintKey: undefined,
      customTitle: 'New title',
      customHint: ''
    };
    const { level, mapChanged } = prepareLevelForSave(draft, original, { title: 'Old title', hint: 'Old hint' });
    expect(mapChanged).toBe(true);
    expect(level.solution).toBeUndefined();
    expect(level.theme).toBe('cyber_neon');
    expect(level.titleKey).toBeUndefined();
    expect(level.customTitle).toBe('New title');
    expect(level.hintKey).toBeUndefined();
    expect(level.customHint).toBe('');
  });

  it('returns the draft untouched when there is no original', () => {
    const draft = makeLevel('z');
    expect(prepareLevelForSave(draft, null, null)).toEqual({ level: draft, mapChanged: false });
  });
});

describe('resolveSavedPassword', () => {
  it('keeps a typed password', () => {
    expect(resolveSavedPassword(' abcd ', [])).toBe('abcd');
  });

  it('gives the shared default to an empty field in a pack without codes', () => {
    expect(resolveSavedPassword('', [{ password: DEFAULT_LEVEL_PASSWORD }])).toBe(DEFAULT_LEVEL_PASSWORD);
    expect(resolveSavedPassword('', [])).toBe(DEFAULT_LEVEL_PASSWORD);
  });

  it('gives an editable code to an empty field in a pack that uses codes', () => {
    expect(resolveSavedPassword('', [{ password: 'ABCD' }])).toBe(EDITOR_DEFAULT_PASSWORD);
  });
});

describe('nextEditableIndex', () => {
  const levels: Array<{ ruleset?: Ruleset }> = [{}, { ruleset: 'cc3d' }, { ruleset: 'cc3d' }, { ruleset: 'lynx' }, {}];

  it('skips levels the editor cannot open', () => {
    expect(nextEditableIndex(levels, 0, 1)).toBe(3);
    expect(nextEditableIndex(levels, 3, -1)).toBe(0);
  });

  it('returns -1 past either end', () => {
    expect(nextEditableIndex(levels, 4, 1)).toBe(-1);
    expect(nextEditableIndex(levels, 0, -1)).toBe(-1);
  });
});

describe('isSaveChord', () => {
  const chord = (over: Partial<Parameters<typeof isSaveChord>[0]>): Parameters<typeof isSaveChord>[0] => ({
    key: 's',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over
  });

  it('matches Ctrl+S and Cmd+S', () => {
    expect(isSaveChord(chord({}))).toBe(true);
    expect(isSaveChord(chord({ key: 'S', ctrlKey: false, metaKey: true }))).toBe(true);
  });

  it('rejects a bare S, Alt chords and other letters', () => {
    expect(isSaveChord(chord({ ctrlKey: false }))).toBe(false);
    expect(isSaveChord(chord({ altKey: true }))).toBe(false);
    expect(isSaveChord(chord({ key: 'z' }))).toBe(false);
  });

  it('falls back to the physical key on a non-Latin layout', () => {
    expect(isSaveChord(chord({ key: 'ы', code: 'KeyS' }))).toBe(true);
    expect(isSaveChord(chord({ key: 'ы', code: 'KeyA' }))).toBe(false);
  });
});
