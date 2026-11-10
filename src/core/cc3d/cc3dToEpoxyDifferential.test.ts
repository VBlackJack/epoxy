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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { cc3dLevel } from './cc3dTestMaps';
import { convertCc3dLevel } from './cc3dToEpoxy';
import { DifferentialPair, displayTerrainWithoutBomb, isWithinOneCell, monsterTimingKind } from './cc3dToEpoxyDifferential';
import type { MonsterAt } from './cc3dToEpoxyDifferential';
import { normalizeCell } from './model';
import type { Cc3dCell } from './model';

const MONSTER_DEATH = 'hud.messages.death_monster';
const OTHER_DEATH = 'hud.messages.death_water';
const ROOM = ['#######', '#@.B..#', '#######'];
const SEED = 1;

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

describe('isWithinOneCell', () => {
  it('counts the same cell and the orthogonal neighbours, not the diagonals', () => {
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 4, y: 3 })).toBe(true);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 3, y: 2 })).toBe(true);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 4, y: 2 })).toBe(false);
    expect(isWithinOneCell({ x: 3, y: 3 }, { x: 5, y: 3 })).toBe(false);
  });
});

describe('monsterTimingKind', () => {
  const survivor = { x: 2, y: 2 };
  const blinky = (x: number, y: number): MonsterAt => ({ type: 'blinky', x, y });

  it('accepts the same monster next to the survivor on both sides', () => {
    expect(monsterTimingKind(survivor, { x: 3, y: 2 }, [blinky(3, 2)], [blinky(3, 2)])).toBe('blinky');
  });

  it('refuses a monster on the survivor cell, a diagonal monster, another kind and a far dead player', () => {
    expect(monsterTimingKind(survivor, { x: 3, y: 2 }, [blinky(2, 2), blinky(3, 2)], [blinky(3, 2)])).toBeNull();
    expect(monsterTimingKind(survivor, { x: 3, y: 2 }, [blinky(3, 3)], [blinky(3, 3)])).toBeNull();
    expect(monsterTimingKind(survivor, { x: 3, y: 2 }, [blinky(3, 2)], [{ type: 'limpa', x: 3, y: 2 }])).toBeNull();
    expect(monsterTimingKind(survivor, { x: 5, y: 2 }, [blinky(3, 2)], [blinky(3, 2)])).toBeNull();
  });
});

interface Staged {
  x: number;
  y: number;
  alive: boolean;
  death?: string;
  monsters?: MonsterAt[];
}

describe('DifferentialPair.compare', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function room(): DifferentialPair {
    const source = cc3dLevel(ROOM, { glyphs: { B: { stack: normalizeCell([{ kind: 'gravel' }, { kind: 'bomb' }]) } } });
    return new DifferentialPair(source, convertCc3dLevel(source).level, SEED);
  }

  /** Overrides who is alive, where, and which monsters stand, on each engine. */
  function stage(pair: DifferentialPair, cc3d: Staged, epoxy: Staged): void {
    const realA = pair.rig.player;
    const realB = pair.epoxy.getPlayer();
    vi.spyOn(pair.rig, 'player', 'get').mockReturnValue({ ...realA, x: cc3d.x, y: cc3d.y, alive: cc3d.alive, deathReasonKey: cc3d.death ?? null });
    vi.spyOn(pair.epoxy, 'getPlayer').mockReturnValue({ ...realB, x: epoxy.x, y: epoxy.y, alive: epoxy.alive, deathReasonKey: epoxy.death ?? null });
    const asEntities = (monsters: MonsterAt[] = []): never => monsters.map((m, i) => ({ id: `m${i}`, ...m, dir: 'N' })) as never;
    vi.spyOn(pair.rig, 'entities', 'get').mockReturnValue(asEntities(cc3d.monsters));
    vi.spyOn(pair.epoxy, 'getEntities').mockReturnValue(asEntities(epoxy.monsters));
  }

  const blinky = (x: number, y: number): MonsterAt => ({ type: 'blinky', x, y });

  it('agrees on a fresh room: the ground under a bomb is gravel on both sides', () => {
    const pair = room();
    expect(pair.rig.engine.getTerrain()[1][3]).toBe('bomb');
    expect(pair.epoxy.getTerrain()[1][3]).toBe('gravel');
    expect(pair.compare()).toBeNull();
  });

  it('catches a different ground under a bomb', () => {
    const pair = room();
    const real = pair.epoxy.getTerrain();
    vi.spyOn(pair.epoxy, 'getTerrain').mockReturnValue(real.map((row, y) => row.map((id, x) => (x === 3 && y === 1 ? 'floor' : id))));
    expect(pair.compare()?.field).toBe('cells');
  });

  it('catches a bomb present on one side only', () => {
    const missing = room();
    const items = missing.epoxy.getItems();
    expect(items[1][3]).toBe('bomb');
    vi.spyOn(missing.epoxy, 'getItems').mockReturnValue(items.map((row, y) => row.map((id, x) => (x === 3 && y === 1 ? null : id))));
    expect(missing.compare()?.field).toBe('items');
    const extra = room();
    vi.spyOn(extra.epoxy, 'getItems').mockReturnValue(extra.epoxy.getItems().map((row, y) => row.map((id, x) => (x === 4 && y === 1 ? 'bomb' : id))));
    expect(extra.compare()?.field).toBe('items');
  });

  it('accepts a monster death one step from a survivor next to the same monster, and flags it', () => {
    const pair = room();
    stage(pair, { x: 3, y: 1, alive: false, death: MONSTER_DEATH, monsters: [blinky(3, 1)] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 1)] });
    expect(pair.compare()).toBeNull();
    expect(pair.monsterTiming).toBe(true);
    expect(pair.monsterTimingType).toBe('blinky');
  });

  it('refuses it for another death, a diagonal monster, another kind, a monster on the survivor or a far dead player', () => {
    const cases: Array<[string, Staged, Staged]> = [
      ['water death', { x: 3, y: 1, alive: false, death: OTHER_DEATH, monsters: [blinky(3, 1)] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 1)] }],
      ['diagonal monster', { x: 3, y: 1, alive: false, death: MONSTER_DEATH, monsters: [blinky(3, 2)] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 2)] }],
      ['other kind', { x: 3, y: 1, alive: false, death: MONSTER_DEATH, monsters: [{ type: 'limpa', x: 3, y: 1 }] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 1)] }],
      ['monster on survivor', { x: 3, y: 1, alive: false, death: MONSTER_DEATH, monsters: [blinky(3, 1)] }, { x: 2, y: 1, alive: true, monsters: [blinky(2, 1), blinky(3, 1)] }],
      ['dead player far', { x: 5, y: 1, alive: false, death: MONSTER_DEATH, monsters: [blinky(3, 1)] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 1)] }]
    ];
    for (const [name, cc3d, epoxy] of cases) {
      const pair = room();
      stage(pair, cc3d, epoxy);
      expect(pair.compare()?.field, name).toBe('alive');
      expect(pair.monsterTiming, name).toBe(false);
    }
  });

  it('still runs the other checks when the timing difference is accepted', () => {
    const pair = room();
    stage(pair, { x: 3, y: 1, alive: false, death: MONSTER_DEATH, monsters: [blinky(3, 1)] }, { x: 2, y: 1, alive: true, monsters: [blinky(3, 1)] });
    const real = pair.epoxy.getTerrain();
    vi.spyOn(pair.epoxy, 'getTerrain').mockReturnValue(real.map((row, y) => row.map((id, x) => (x === 5 && y === 1 ? 'water' : id))));
    expect(pair.compare()?.field).toBe('cells');
  });

  it('accepts two monster deaths one step apart, and no further, diagonal or by another death', () => {
    const near = room();
    stage(near, { x: 2, y: 1, alive: false, death: MONSTER_DEATH }, { x: 3, y: 1, alive: false, death: MONSTER_DEATH });
    expect(near.compare()).toBeNull();
    const far = room();
    stage(far, { x: 2, y: 1, alive: false, death: MONSTER_DEATH }, { x: 4, y: 1, alive: false, death: MONSTER_DEATH });
    expect(far.compare()?.field).toBe('player');
    const diagonal = room();
    stage(diagonal, { x: 2, y: 1, alive: false, death: MONSTER_DEATH }, { x: 3, y: 2, alive: false, death: MONSTER_DEATH });
    expect(diagonal.compare()?.field).toBe('player');
    const water = room();
    stage(water, { x: 2, y: 1, alive: false, death: OTHER_DEATH }, { x: 3, y: 1, alive: false, death: OTHER_DEATH });
    expect(water.compare()?.field).toBe('player');
  });

  describe('a thin wall kept as a cell edge', () => {
    const EDGE_X = 4;
    const EDGE_Y = 1;

    function edgeRoom(): DifferentialPair {
      const source = cc3dLevel(ROOM, { glyphs: { B: { stack: normalizeCell([{ kind: 'gravel' }, { kind: 'bomb' }]) } } });
      const converted = convertCc3dLevel(source).level;
      converted.cellEdges = [{ x: EDGE_X, y: EDGE_Y, sides: ['N'] }];
      return new DifferentialPair(source, converted, SEED);
    }

    function show(pair: DifferentialPair, cc3d: string, epoxy: string): void {
      const put = (rows: string[][], id: string): string[][] => rows.map((row, y) => row.map((value, x) => (x === EDGE_X && y === EDGE_Y ? id : value)));
      vi.spyOn(pair.rig.engine, 'getTerrain').mockReturnValue(put(pair.rig.engine.getTerrain(), cc3d));
      vi.spyOn(pair.epoxy, 'getTerrain').mockReturnValue(put(pair.epoxy.getTerrain(), epoxy));
    }

    it('accepts floor on Epoxy when CC3D shows the stored thin wall', () => {
      const pair = edgeRoom();
      show(pair, 'thin_wall_n', 'floor');
      expect(pair.compare()).toBeNull();
    });

    it('refuses a different panel and an edge cell that is not floor on Epoxy', () => {
      const otherPanel = edgeRoom();
      show(otherPanel, 'thin_wall_s', 'floor');
      expect(otherPanel.compare()?.field).toBe('cells');
      const notFloor = edgeRoom();
      show(notFloor, 'thin_wall_n', 'water');
      expect(notFloor.compare()?.field).toBe('cells');
    });

    it('does not excuse a thin wall on a cell that has no stored edge', () => {
      const pair = edgeRoom();
      const put = (rows: string[][], id: string): string[][] => rows.map((row, y) => row.map((value, x) => (x === 5 && y === 1 ? id : value)));
      vi.spyOn(pair.rig.engine, 'getTerrain').mockReturnValue(put(pair.rig.engine.getTerrain(), 'thin_wall_n'));
      expect(pair.compare()?.field).toBe('cells');
    });
  });

  describe('a level that is over in both engines', () => {
    /** A terrain difference that any full compare would report. */
    function differAtCell(pair: DifferentialPair): void {
      const real = pair.epoxy.getTerrain();
      vi.spyOn(pair.epoxy, 'getTerrain').mockReturnValue(real.map((row, y) => row.map((id, x) => (x === 5 && y === 1 ? 'water' : id))));
    }

    function finish(pair: DifferentialPair, done: { cc3d: boolean; epoxy: boolean }, time: { cc3d: number; epoxy: number }): void {
      vi.spyOn(pair.rig.engine, 'isLevelCompleted').mockReturnValue(done.cc3d);
      vi.spyOn(pair.epoxy, 'isLevelCompleted').mockReturnValue(done.epoxy);
      vi.spyOn(pair.rig.engine, 'getTimeRemainingSeconds').mockReturnValue(time.cc3d);
      vi.spyOn(pair.epoxy, 'getTimeRemainingSeconds').mockReturnValue(time.epoxy);
    }

    it('stops comparing once both players are dead', () => {
      const pair = room();
      stage(pair, { x: 2, y: 1, alive: false, death: MONSTER_DEATH }, { x: 2, y: 1, alive: false, death: MONSTER_DEATH });
      differAtCell(pair);
      expect(pair.compare()).toBeNull();
    });

    it('still compares the cells while only one of them is over', () => {
      const pair = room();
      differAtCell(pair);
      expect(pair.compare()?.field).toBe('cells');
    });

    it('stops comparing once both levels are done with the same time left', () => {
      const pair = room();
      finish(pair, { cc3d: true, epoxy: true }, { cc3d: 30, epoxy: 30 });
      differAtCell(pair);
      expect(pair.compare()).toBeNull();
    });

    it('reports a different time left when both levels are done', () => {
      const pair = room();
      finish(pair, { cc3d: true, epoxy: true }, { cc3d: 30, epoxy: 29 });
      differAtCell(pair);
      const mismatch = pair.compare();
      expect(mismatch?.field).toBe('complete');
      expect(mismatch?.detail).toContain('time left');
    });

    it('reports one level done and the other not', () => {
      const pair = room();
      finish(pair, { cc3d: true, epoxy: false }, { cc3d: 30, epoxy: 30 });
      expect(pair.compare()?.field).toBe('complete');
    });
  });
});
