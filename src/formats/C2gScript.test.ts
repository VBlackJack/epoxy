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
import { c2gPathKey, createC2gResolver, parseC2gBytes, parseC2gScript } from './C2gScript';

const SAMPLE = [
  'game "Synthetic Pack"',
  '',
  '; a comment line',
  'script',
  '"story text that mentions music and map words"',
  '',
  'music "+Track01" map "1-2\\First_One.c2m"   ; 1',
  'music "+Track02"',
  'music "+Track03" MAP "1-2\\second.C2M"\t; 2',
  'map "plain\\third.c2m"',
  '0 x ='
].join('\r\n');

describe('parseC2gScript', () => {
  it('reads the game name and the ordered map paths', () => {
    const script = parseC2gScript(SAMPLE);
    expect(script.gameName).toBe('Synthetic Pack');
    expect(script.maps.map((m) => m.path)).toEqual(['1-2\\First_One.c2m', '1-2\\second.C2M', 'plain\\third.c2m']);
  });

  it('keeps the music of the line that places the map', () => {
    const script = parseC2gScript(SAMPLE);
    expect(script.maps.map((m) => m.music)).toEqual(['+Track01', '+Track03', undefined]);
  });

  it('normalizes path keys', () => {
    expect(parseC2gScript(SAMPLE).maps.map((m) => m.key)).toEqual(['1-2/first_one.c2m', '1-2/second.c2m', 'plain/third.c2m']);
    expect(c2gPathKey('A\\B\\C.C2M')).toBe('a/b/c.c2m');
  });

  it('ignores story text, comments and conditions', () => {
    const script = parseC2gScript('"music x map y"\n; map "z"\nscript');
    expect(script.maps).toEqual([]);
    expect(script.gameName).toBeNull();
  });

  it('handles LF only line endings and a missing game line', () => {
    const script = parseC2gScript('music "+T" map "a.c2m"\nmusic "+U" map "b.c2m"\n');
    expect(script.gameName).toBeNull();
    expect(script.maps.map((m) => m.path)).toEqual(['a.c2m', 'b.c2m']);
  });

  it('strips a UTF-8 byte order mark and decodes Windows-1252', () => {
    const encoder = new TextEncoder();
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, ...encoder.encode('game "Caf'), 0xe9, ...encoder.encode('"'));
    expect(parseC2gBytes(bytes).gameName).toBe('Café');
  });
});

describe('createC2gResolver', () => {
  const files = ['data/games/cc2/1-2/first_one.c2m', 'data/games/cc2/1-2/Second.c2m', 'other/third.c2m', 'dup/x.c2m', 'dup2/x.c2m'];
  const resolve = createC2gResolver(files);
  const entry = (path: string) => ({ path, key: c2gPathKey(path) });

  it('matches case-insensitively on a path suffix', () => {
    expect(resolve(entry('1-2\\First_One.c2m'))).toBe('data/games/cc2/1-2/first_one.c2m');
    expect(resolve(entry('1-2\\second.C2M'))).toBe('data/games/cc2/1-2/Second.c2m');
  });

  it('falls back to a unique base name', () => {
    expect(resolve(entry('elsewhere\\third.c2m'))).toBe('other/third.c2m');
  });

  it('does not guess between ambiguous or missing files', () => {
    expect(resolve(entry('nowhere\\x.c2m'))).toBeNull();
    expect(resolve(entry('missing.c2m'))).toBeNull();
  });
});
