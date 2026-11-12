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
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, Cc2PlayerView, CompiledLevel, Direction, RuntimeEntity } from '../types';
import { chooseMonsterDirection } from './epoxyMonsters';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const OPEN_ROOM = ['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'];
const MONSTER_AT = { x: 2, y: 2 };

type Mode = 'cc2' | 'cc' | 'native';

interface Fixture {
  w: EpoxyWorld;
  monster: RuntimeEntity;
}

function fixture(rows: string[], mode: Mode, player: { x: number; y: number }, type = 'teeth'): Fixture {
  const built = buildTestLevel(rows, { entities: [{ type, x: MONSTER_AT.x, y: MONSTER_AT.y, dir: 'E' as Direction }] });
  const level: CompiledLevel = {
    ...built,
    playerStart: { x: player.x, y: player.y, dir: 'N' },
    ...(mode === 'cc2' ? { cc2: CC2_RECORD } : mode === 'cc' ? { rulesFlavor: 'cc' as const } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  const monster = w.entities.find((e) => e.kind === 'monster');
  if (monster === undefined) throw new Error('the monster is missing');
  return { w, monster };
}

function choose(f: Fixture): Direction | null {
  return chooseMonsterDirection(f.w, f.monster, ConfigRegistry.getEntityDef(f.monster.type));
}

describe('CC2 teeth aim at the apparent position of the player', () => {
  const player = { x: 6, y: 5 };

  it('aims at the player cell when no view is recorded', () => {
    const f = fixture(OPEN_ROOM, 'cc2', player);
    expect(f.w.cc2PlayerView).toBeUndefined();
    // dx 4 beats dy 3: horizontal first.
    expect(choose(f)).toBe('E');
  });

  it('subtracts the share of the step still to run, and a tie goes vertical', () => {
    const f = fixture(OPEN_ROOM, 'cc2', player);
    // The cell is (6,5) but the step E has not started: the apparent position is (5,5), a tie, so vertical wins.
    f.w.cc2PlayerView = { x: 6, y: 5, dir: 'E', cooldown: 4, stepLength: 4 };
    expect(choose(f)).toBe('S');
  });

  it('keeps a fractional share of the step', () => {
    const f = fixture(OPEN_ROOM, 'cc2', player);
    // Apparent (5.5,5): dx 3.5 beats dy 3.
    f.w.cc2PlayerView = { x: 6, y: 5, dir: 'E', cooldown: 2, stepLength: 4 };
    expect(choose(f)).toBe('E');
  });

  it('aims at the vertical axis for a larger dy', () => {
    const f = fixture(OPEN_ROOM, 'cc2', { x: 3, y: 6 });
    f.w.cc2PlayerView = { x: 3, y: 6, dir: 'S', cooldown: 0, stepLength: 4 };
    expect(choose(f)).toBe('S');
  });

  it('stays on the source pad of a teleport under way', () => {
    const f = fixture(OPEN_ROOM, 'cc2', { x: 7, y: 3 });
    // Without the pad the destination (7,3) would pull the teeth east; the apparent position is still on the pad (3,6).
    f.w.cc2PlayerView = { x: 7, y: 3, dir: 'E', cooldown: 0, stepLength: 4, sourcePad: { x: 3, y: 6 } };
    expect(choose(f)).toBe('S');
  });

  it('flees the apparent position as well', () => {
    const f = fixture(OPEN_ROOM, 'cc2', player, 'timid_teeth');
    const view: Cc2PlayerView = { x: 6, y: 5, dir: 'E', cooldown: 4, stepLength: 4 };
    f.w.cc2PlayerView = view;
    // The tie sends the aim vertical; teeth that flee turn away from it.
    const fleeing = choose(f);
    expect(fleeing === 'N' || fleeing === 'W').toBe(true);
  });

  it('ignores the view on a cc-flavour level and on a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const f = fixture(OPEN_ROOM, mode, player);
      f.w.cc2PlayerView = { x: 6, y: 5, dir: 'E', cooldown: 4, stepLength: 4 };
      expect(choose(f), mode).toBe('E');
    }
  });
});

describe('CC2 boxed-in teeth', () => {
  const player = { x: 7, y: 5 };

  it('face their last choice', () => {
    const f = fixture(OPEN_ROOM, 'cc2', player);
    // Candidates are [E, S] (dx 5 beats dy 3); wall both off.
    f.w.terrain[2][3] = 'wall';
    f.w.terrain[3][2] = 'wall';
    expect(choose(f)).toBeNull();
    expect(f.monster.dir).toBe('S');
  });

  it('face their first choice on a cc-flavour level', () => {
    const f = fixture(OPEN_ROOM, 'cc', player);
    f.w.terrain[2][3] = 'wall';
    f.w.terrain[3][2] = 'wall';
    expect(choose(f)).toBeNull();
    expect(f.monster.dir).toBe('E');
  });

  it('leave their facing alone on a native level', () => {
    const f = fixture(OPEN_ROOM, 'native', player);
    f.monster.dir = 'N';
    f.w.terrain[2][3] = 'wall';
    f.w.terrain[3][2] = 'wall';
    expect(choose(f)).toBeNull();
    expect(f.monster.dir).toBe('N');
  });
});
