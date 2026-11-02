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
import { PACK_NAME_MAX_LENGTH, USER_PACK_ID_PREFIX } from '../config/constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel, makeUserPack } from '../test/packFixtures';
import { CUSTOM_LEVEL_ID_PREFIX } from '../ui/uiConstants';
import {
  addLevel,
  copyLevelToPack,
  createUserPack,
  duplicateLevel,
  generateLevelId,
  moveLevel,
  moveLevelDown,
  moveLevelToPack,
  moveLevelUp,
  removeLevel,
  renamePack,
  updateLevel,
  upsertLevel
} from './userPacks';

const ids = (levels: readonly { id: string }[]) => levels.map((l) => l.id);
const numbers = (levels: readonly { number: number }[]) => levels.map((l) => l.number);

describe('userPacks', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  describe('create and rename', () => {
    it('creates an empty owned pack with a prefixed timestamp id', () => {
      const pack = createUserPack('  Mine  ', new Set(), () => 1000);
      expect(pack).toEqual({
        id: `${USER_PACK_ID_PREFIX}1000`,
        name: 'Mine',
        builtIn: false,
        userCreated: true,
        levels: []
      });
    });

    it('moves past an id that is taken', () => {
      const taken = new Set([`${USER_PACK_ID_PREFIX}1000`, `${USER_PACK_ID_PREFIX}1001`]);
      expect(createUserPack('A', taken, () => 1000)?.id).toBe(`${USER_PACK_ID_PREFIX}1002`);
    });

    it('refuses a blank name and cuts a long one', () => {
      expect(createUserPack('   ', new Set())).toBeNull();
      const long = createUserPack('x'.repeat(PACK_NAME_MAX_LENGTH + 20), new Set());
      expect(long?.name).toHaveLength(PACK_NAME_MAX_LENGTH);
    });

    it('renames and clears the i18n label without touching the original', () => {
      const labelled = { ...makeUserPack('p', ['a']), i18nKey: 'app.packs.custom.label' };
      const renamed = renamePack(labelled, ' New ');
      expect(renamed?.name).toBe('New');
      expect(renamed && 'i18nKey' in renamed).toBe(false);
      expect(labelled.i18nKey).toBe('app.packs.custom.label');
      expect(renamePack(labelled, ' ')).toBeNull();
    });
  });

  describe('level ids', () => {
    it('issues a custom_ id and skips the ones taken in any pack', () => {
      expect(generateLevelId(new Set(), () => 50)).toBe(`${CUSTOM_LEVEL_ID_PREFIX}50`);
      const taken = new Set([`${CUSTOM_LEVEL_ID_PREFIX}50`]);
      expect(generateLevelId(taken, () => 50)).toBe(`${CUSTOM_LEVEL_ID_PREFIX}51`);
    });
  });

  describe('add, update, remove', () => {
    it('appends and renumbers without mutating the source pack', () => {
      const pack = makeUserPack('p', ['a', 'b']);
      const next = addLevel(pack, { ...makeLevel('c'), number: 99 });
      expect(ids(next.levels)).toEqual(['a', 'b', 'c']);
      expect(numbers(next.levels)).toEqual([1, 2, 3]);
      expect(pack.levels).toHaveLength(2);
    });

    it('updates a level in place by id and keeps its position', () => {
      const pack = makeUserPack('p', ['a', 'b', 'c']);
      const edited = { ...makeLevel('b'), customTitle: 'Edited' };
      const next = updateLevel(pack, edited);
      expect(ids(next.levels)).toEqual(['a', 'b', 'c']);
      expect(next.levels[1].customTitle).toBe('Edited');
      expect(numbers(next.levels)).toEqual([1, 2, 3]);
      expect(updateLevel(pack, makeLevel('zzz'))).toBe(pack);
    });

    it('upserts: updates a known id, appends an unknown one', () => {
      const pack = makeUserPack('p', ['a']);
      expect(ids(upsertLevel(pack, makeLevel('a')).levels)).toEqual(['a']);
      expect(ids(upsertLevel(pack, makeLevel('b')).levels)).toEqual(['a', 'b']);
    });

    it('removes a level and renumbers', () => {
      const next = removeLevel(makeUserPack('p', ['a', 'b', 'c']), 'a');
      expect(ids(next.levels)).toEqual(['b', 'c']);
      expect(numbers(next.levels)).toEqual([1, 2]);
    });

    it('can empty a pack', () => {
      expect(removeLevel(makeUserPack('p', ['a']), 'a').levels).toEqual([]);
    });
  });

  describe('reorder', () => {
    it('moves a level to an index', () => {
      const next = moveLevel(makeUserPack('p', ['a', 'b', 'c', 'd']), 0, 2);
      expect(ids(next.levels)).toEqual(['b', 'c', 'a', 'd']);
      expect(numbers(next.levels)).toEqual([1, 2, 3, 4]);
      expect(ids(moveLevel(makeUserPack('p', ['a', 'b', 'c']), 2, 0).levels)).toEqual(['c', 'a', 'b']);
    });

    it('moves up and down by id and stops at the ends', () => {
      const pack = makeUserPack('p', ['a', 'b', 'c']);
      expect(ids(moveLevelUp(pack, 'c').levels)).toEqual(['a', 'c', 'b']);
      expect(ids(moveLevelDown(pack, 'a').levels)).toEqual(['b', 'a', 'c']);
      expect(moveLevelUp(pack, 'a')).toBe(pack);
      expect(moveLevelDown(pack, 'c')).toBe(pack);
      expect(moveLevelUp(pack, 'missing')).toBe(pack);
    });

    it('ignores out-of-range or fractional indexes', () => {
      const pack = makeUserPack('p', ['a', 'b']);
      expect(moveLevel(pack, 0, 5)).toBe(pack);
      expect(moveLevel(pack, -1, 0)).toBe(pack);
      expect(moveLevel(pack, 0.5, 1)).toBe(pack);
    });
  });

  describe('duplicate, copy, move between packs', () => {
    it('duplicates right after the source under a new id, as a deep copy', () => {
      const pack = makeUserPack('p', ['a', 'b']);
      const next = duplicateLevel(pack, 'a', 'copy_1');
      expect(ids(next?.levels ?? [])).toEqual(['a', 'copy_1', 'b']);
      expect(numbers(next?.levels ?? [])).toEqual([1, 2, 3]);
      expect(next?.levels[1].terrain).not.toBe(pack.levels[0].terrain);
      expect(duplicateLevel(pack, 'missing', 'x')).toBeNull();
    });

    it('copies to another pack under a new id and leaves the source alone', () => {
      const source = makeUserPack('s', ['a', 'b']);
      const destination = makeUserPack('d', ['z']);
      const next = copyLevelToPack(source, 'b', destination, 'fresh');
      expect(ids(next?.levels ?? [])).toEqual(['z', 'fresh']);
      expect(numbers(next?.levels ?? [])).toEqual([1, 2]);
      expect(ids(source.levels)).toEqual(['a', 'b']);
      expect(copyLevelToPack(source, 'missing', destination, 'x')).toBeNull();
    });

    it('moves to another pack keeping the id', () => {
      const moved = moveLevelToPack(makeUserPack('s', ['a', 'b', 'c']), 'b', makeUserPack('d', ['z']));
      expect(ids(moved?.source.levels ?? [])).toEqual(['a', 'c']);
      expect(numbers(moved?.source.levels ?? [])).toEqual([1, 2]);
      expect(ids(moved?.destination.levels ?? [])).toEqual(['z', 'b']);
      expect(numbers(moved?.destination.levels ?? [])).toEqual([1, 2]);
    });

    it('gives a moved level the suffix scheme when the destination holds its id', () => {
      const moved = moveLevelToPack(makeUserPack('s', ['a']), 'a', makeUserPack('d', ['a', 'a_2']));
      expect(ids(moved?.destination.levels ?? [])).toEqual(['a', 'a_2', 'a_3']);
    });

    it('carries every level field through a move and a copy', () => {
      const lynx = makeLevel('lynx_1', { ruleset: 'lynx', theme: 'night', solution: 'NNE', titleKey: 'k.t' });
      const source = { ...makeUserPack('s', []), levels: [lynx] };
      const copy = copyLevelToPack(source, 'lynx_1', makeUserPack('d', []), 'c1');
      expect(copy?.levels[0]).toMatchObject({ ruleset: 'lynx', theme: 'night', solution: 'NNE', titleKey: 'k.t' });
      const moved = moveLevelToPack(source, 'lynx_1', makeUserPack('d', []));
      expect(moved?.destination.levels[0]).toEqual(lynx);
    });
  });
});
