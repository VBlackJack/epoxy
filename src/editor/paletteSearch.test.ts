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

import { describe, expect, it } from 'vitest';
import {
  foldForSearch,
  matchRank,
  parseQuery,
  RANK_DESCRIPTION_ONLY,
  RANK_IN_NAME,
  RANK_NAME_STARTS,
  RANK_NAME_WORD_STARTS,
  searchPalette,
  SearchableEntry
} from './paletteSearch';

function entry(id: string, name: string, description?: string, category = 'mechanisms'): SearchableEntry {
  return { kind: 'terrain', id, name, description, category };
}

describe('foldForSearch and parseQuery', () => {
  it('lower-cases, strips accents and collapses spaces', () => {
    expect(foldForSearch('  PIÈGE   Mécanique ')).toBe('piege mecanique');
  });

  it('splits a query into folded words and gives none for blank text', () => {
    expect(parseQuery('  Piège  bouton ')).toEqual(['piege', 'bouton']);
    expect(parseQuery('   ')).toEqual([]);
    expect(parseQuery('')).toEqual([]);
  });
});

describe('matchRank', () => {
  const trap = entry('trap', 'Piège Mécanique', "Retient ce qui y entre tant qu'un bouton brun n'est pas tenu.");

  it('finds the French trap by an unaccented word, whatever the case', () => {
    expect(matchRank(trap, parseQuery('piege'))).toBe(RANK_NAME_STARTS);
    expect(matchRank(trap, parseQuery('PIÈGE'))).toBe(RANK_NAME_STARTS);
    expect(matchRank(trap, parseQuery('PIEGE'))).toBe(RANK_NAME_STARTS);
  });

  it('requires every word (AND) in the name or the description', () => {
    expect(matchRank(trap, parseQuery('piege bouton'))).not.toBeNull();
    expect(matchRank(trap, parseQuery('piege laser'))).toBeNull();
  });

  it('ranks a name prefix, a word prefix, a name substring and a description match in that order', () => {
    expect(matchRank(entry('a', 'Red Door'), parseQuery('red'))).toBe(RANK_NAME_STARTS);
    expect(matchRank(entry('b', 'Big Red Door'), parseQuery('red'))).toBe(RANK_NAME_WORD_STARTS);
    expect(matchRank(entry('c', 'Colored Door'), parseQuery('red'))).toBe(RANK_IN_NAME);
    expect(matchRank(entry('d', 'Door', 'Opens with a red key'), parseQuery('red'))).toBe(RANK_DESCRIPTION_ONLY);
  });

  it('never matches an id and never matches an empty query', () => {
    expect(matchRank(entry('hold_door_red_closed', 'Gate'), parseQuery('hold_door'))).toBeNull();
    expect(matchRank(entry('x', 'Gate'), [])).toBeNull();
  });
});

describe('searchPalette', () => {
  it('puts a name prefix above a description match', () => {
    const entries = [entry('a', 'Door', 'Needs a key'), entry('b', 'Key Red'), entry('c', 'Pocket Key')];
    expect(searchPalette(entries, 'key').map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps the given order for equal ranks', () => {
    const entries = [entry('z', 'Wall A'), entry('y', 'Wall B'), entry('x', 'Wall C')];
    expect(searchPalette(entries, 'wall').map((e) => e.id)).toEqual(['z', 'y', 'x']);
  });

  it('returns every entry, in order, for an empty query', () => {
    const entries = [entry('a', 'A'), entry('b', 'B')];
    expect(searchPalette(entries, '  ').map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('does not match raw ids', () => {
    const entries = [entry('hold_door_red_closed', 'Gate')];
    expect(searchPalette(entries, 'hold_door')).toEqual([]);
  });
});
