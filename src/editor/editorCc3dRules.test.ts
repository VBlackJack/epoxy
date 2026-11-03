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
import type { Cc3dLevel } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { placeLayer, placeMob, removeMob, rotateMob, setItem, setPanelSide, setPlayer } from './cc3dEdits';
import { compiledCc3d, editableCc3dModel, smallCc3dLevel } from './cc3dEditorFixtures';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { levelMapChanged, prepareLevelForSave } from './saveTarget';
import { levelStartingAt, startCellProblem } from './testFromHere';

beforeEach(() => {
  loadTestConfigs();
});

/** The level as the editor would export it after an edit of its cc3d data. */
function after(level: CompiledLevel, edit: (cc3d: Cc3dLevel) => Cc3dLevel): CompiledLevel {
  const doc = documentFromLevel(level, { title: 'T', hint: '' });
  const cc3d = edit(doc.cc3d as Cc3dLevel);
  return levelFromDocument({ ...doc, cc3d }, { id: level.id, number: level.number, password: level.password, fallbackTitle: 'T' });
}

describe('levelMapChanged for a CC3D level', () => {
  it('is false for an untouched round trip and for a repainted identical cell', () => {
    const level = smallCc3dLevel();
    expect(levelMapChanged(level, after(level, (c) => c))).toBe(false);
    expect(levelMapChanged(level, after(level, (c) => placeLayer(c, 2, 1, { kind: 'floor' })))).toBe(false);
  });

  it('counts every kind of cc3d edit as a map change', () => {
    const level = smallCc3dLevel();
    const edits: Array<(c: Cc3dLevel) => Cc3dLevel> = [
      (c) => placeLayer(c, 2, 1, { kind: 'water' }),
      (c) => setItem(c, 2, 1, { kind: 'orb_ice' }),
      (c) => setPanelSide(c, 2, 1, 'N', true),
      (c) => setPlayer(c, 3, 1),
      (c) => rotateMob(c, 2, 2),
      (c) => removeMob(c, 2, 2),
      (c) => placeMob(c, { kind: 'omni', x: 3, y: 1, dir: 'N' })
    ];
    for (const edit of edits) expect(levelMapChanged(level, after(level, edit))).toBe(true);
  });

  it('sees a reordered mob list, which links devices differently', () => {
    const level = smallCc3dLevel();
    expect(levelMapChanged(level, after(level, (c) => ({ ...c, mobs: [...c.mobs].reverse() })))).toBe(true);
  });

  it('drops the solution and keeps it when only the title changes', () => {
    const level: CompiledLevel = { ...smallCc3dLevel(), solution: 'EESE' };
    const moved = after(level, (c) => setPlayer(c, 3, 1));
    expect(prepareLevelForSave(moved, level, null).level.solution).toBeUndefined();
    const same = { ...after(level, (c) => c), customTitle: 'Another title' };
    expect(prepareLevelForSave(same, level, null).level.solution).toBe('EESE');
  });
});

describe('test from here on a CC3D level', () => {
  function map(rows: string[]): Parameters<typeof startCellProblem>[0] {
    const level = compiledCc3d(editableCc3dModel(rows));
    return { ...documentFromLevel(level, { title: 'T', hint: '' }), ruleset: 'cc3d' };
  }

  it('accepts a bare floor and refuses the rest', () => {
    const m = map(['#####', '#@.iX', '#.K.M', '#####']);
    expect(startCellProblem(m, { x: 2, y: 1 })).toBeNull();
    expect(startCellProblem(m, { x: 3, y: 1 })).toBeNull();
    expect(startCellProblem(m, { x: 0, y: 0 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 4, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 2, y: 2 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 4, y: 2 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 9, y: 9 })).toBe('no_cell');
    expect(startCellProblem(m, null)).toBe('no_cell');
  });

  it('refuses water, fire and a device or blocker on the top layer', () => {
    const m = map(['######', '#@WFO#', '#..N.#', '######']);
    expect(startCellProblem(m, { x: 2, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 3, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 4, y: 1 })).toBe('not_walkable');
    expect(startCellProblem(m, { x: 3, y: 2 })).toBe('not_walkable');
  });

  it('moves cc3d.player and leaves the source level alone', () => {
    const stored = smallCc3dLevel();
    const level = compiledCc3d({ ...(stored.cc3d as Cc3dLevel), player: { x: 1, y: 1, dir: 'S' } });
    const before = JSON.stringify(level);
    const moved = levelStartingAt(level, { x: 3, y: 2 });
    expect(moved.cc3d?.player).toEqual({ x: 3, y: 2, dir: 'S' });
    // A stored level without a facing keeps none: the engine's default still applies.
    expect(levelStartingAt(stored, { x: 3, y: 2 }).cc3d?.player).toEqual({ x: 3, y: 2 });
    expect(moved.playerStart).toEqual({ x: 3, y: 2, dir: level.playerStart.dir });
    expect(JSON.stringify(level)).toBe(before);
  });
});
