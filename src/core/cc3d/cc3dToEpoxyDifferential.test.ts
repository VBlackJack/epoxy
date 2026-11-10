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

import { displayTerrainWithoutBomb, isWithinOneCell, monsterWithinOneCell } from './cc3dToEpoxyDifferential';
import type { Cc3dCell } from './model';

function cell(kinds: Array<Cc3dCell['terrain'][number]['kind']>, panels: Cc3dCell['panels'] = []): Cc3dCell {
  return { terrain: kinds.map((kind) => ({ kind })), panels, item: null };
}

describe('displayTerrainWithoutBomb', () => {
  it('keeps the real ground under a top bomb', () => {
    expect(displayTerrainWithoutBomb(cell(['floor', 'gravel', 'bomb']))).toBe('gravel');
    expect(displayTerrainWithoutBomb(cell(['floor', 'ice', 'bomb']))).toBe('ice');
    expect(displayTerrainWithoutBomb(cell(['floor', 'bomb']))).toBe('floor');
  });

  it('keeps the thin walls of the panels on a floor under a bomb', () => {
    expect(displayTerrainWithoutBomb(cell(['floor', 'bomb'], ['N']))).toBe('thin_wall_n');
  });

  it('strips every bomb layer of the top, and none below another terrain', () => {
    expect(displayTerrainWithoutBomb(cell(['floor', 'sand', 'bomb', 'bomb']))).toBe('cc3d_sand');
    expect(displayTerrainWithoutBomb(cell(['floor', 'bomb', 'wall']))).toBe('wall');
  });

  it('is the plain display id when no bomb is present', () => {
    expect(displayTerrainWithoutBomb(cell(['floor', 'water']))).toBe('water');
  });
});

describe('monster timing helpers', () => {
  it('counts a same or neighbouring cell as within one cell', () => {
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 4, y: 2 })).toBe(true);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 5, y: 3 })).toBe(false);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 3, y: 1 })).toBe(false);
  });

  it('finds a monster next to the player and none further away', () => {
    expect(monsterWithinOneCell({ x: 2, y: 2 }, [{ x: 9, y: 9 }, { x: 2, y: 3 }])).toBe(true);
    expect(monsterWithinOneCell({ x: 2, y: 2 }, [{ x: 9, y: 9 }, { x: 4, y: 2 }])).toBe(false);
    expect(monsterWithinOneCell({ x: 2, y: 2 }, [])).toBe(false);
  });
});
