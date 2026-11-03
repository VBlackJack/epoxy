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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('./silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { Direction, LevelBlueprint } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from './loadTestConfigs';
import { pushWinExists, searchMoveWin, searchPushWin } from './pilotPushSearch';
import { searchCanWin, searchShortestWin } from './pilotSearch';

function room(rows: string[], blocks: Array<[number, number]>, targets: Array<[number, number]>): GameEngine {
  const blueprint: LevelBlueprint = {
    id: 'epoxy_p_push',
    number: 1,
    password: 'PUSH',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: 'targets',
    playerStart: { x: 1, y: 1, dir: 'E' },
    rows,
    terrainOverrides: targets.map(([x, y]) => ({ x, y, id: 'block_target' })),
    items: [],
    entities: blocks.map(([x, y]) => ({ type: 'dirt_block', x, y, dir: 'S' })),
    trapLinks: [],
    cloneLinks: []
  };
  const engine = new GameEngine();
  engine.loadLevel(ConfigRegistry.compileBlueprint(blueprint));
  return engine;
}

/** A river one cell wide in the middle: one block bridges it, the other goes on to the target. */
const RIVER = ['##########', '#...W....#', '#...W....#', '#...W....#', '##########'];

describe('pilot push search agrees with the engine search', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('finds the same shortest win in moves on a room with a river', () => {
    const blocks: Array<[number, number]> = [[2, 1], [2, 2]];
    const model = searchMoveWin(room(RIVER, blocks, [[8, 1]]));
    const engine = searchShortestWin(room(RIVER, blocks, [[8, 1]]), { allowDrops: false });
    expect(model).not.toBeNull();
    expect(model?.moves.length).toBe(engine?.length);
    // The moves it reports win in the real engine.
    const replay = room(RIVER, blocks, [[8, 1]]);
    let at = 0;
    for (const move of model?.moves ?? '') expect(PieceSolver.play(replay, move as Direction), `move ${at++} of ${model?.moves}`).toBe(true);
    expect(replay.isLevelCompleted()).toBe(true);
    expect(searchPushWin(room(RIVER, blocks, [[8, 1]]))).toEqual({ pushes: 9 });
  });

  it('agrees that a room is lost when the only block is needed twice, and that a second block saves it', () => {
    expect(pushWinExists(room(RIVER, [[2, 1]], [[8, 1]]))).toBe(false);
    expect(searchCanWin(room(RIVER, [[2, 1]], [[8, 1]]), { allowDrops: false })).toBe(false);
    expect(searchMoveWin(room(RIVER, [[2, 1]], [[8, 1]]))).toBeNull();
    expect(pushWinExists(room(RIVER, [[2, 1], [2, 2]], [[8, 1]]))).toBe(true);
  });

  it('refuses a block on fresh dirt until it is trodden, as the engine does', () => {
    const rows = ['#########', '#..d....#', '#########'];
    const model = searchMoveWin(room(rows, [[2, 1]], [[6, 1]]));
    const engine = searchShortestWin(room(rows, [[2, 1]], [[6, 1]]), { allowDrops: false });
    expect(model).toBeNull();
    expect(engine).toBeNull();
  });

  it('lets the block cross the dirt once the player has trodden it, in the model and in the engine', () => {
    const rows = ['#########', '#..d....#', '#.......#', '#########'];
    const model = searchMoveWin(room(rows, [[2, 1]], [[6, 1]]));
    const engine = searchShortestWin(room(rows, [[2, 1]], [[6, 1]]), { allowDrops: false });
    expect(model).not.toBeNull();
    expect(model?.moves.length).toBe(engine?.length);
    // The shortest win walks round the block to tread the dirt first, then pushes: it replays in the engine.
    const replay = room(rows, [[2, 1]], [[6, 1]]);
    for (const move of model?.moves ?? '') expect(PieceSolver.play(replay, move as Direction)).toBe(true);
    expect(replay.isLevelCompleted()).toBe(true);
    expect(replay.getTerrain()[1][3]).toBe('floor');
  });
});
