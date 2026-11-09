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
import { playScenario, room } from '../cc3d/cc3dEvidenceRig';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement } from '../types';

/**
 * Format 15 block rules: the CC3D dirt, the CC2 pop-up wall, the CC3D slime, the CC3D ice block and the appearing wall
 * any mover reveals. Epoxy is played on rooms of the real ids; the CC3D engine is asked through the evidence rig
 * (the converter does not produce the format 15 ids, so only the CC3D side of a scenario is read).
 */

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const MAX_WAIT_TICKS = 40;
const REST_TICKS = 60;

interface Setup {
  entities?: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
}

function level(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'format15_blocks',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

function block(type: string, x: number): EntityPlacement {
  return { type, x, y: ROW, dir: 'E' };
}

/** Plays the setup: the player at x=2 pushes east `pushes` times, then time passes so that slides settle. */
function play(setup: Setup, pushes = 1): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level(setup));
  for (let i = 0; i < pushes; i++) {
    for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; waited++) engine.tick();
    engine.attemptPlayerMove('E');
  }
  for (let i = 0; i < REST_TICKS; i++) engine.tick();
  return engine;
}

function blocks(engine: GameEngine): string[] {
  return engine
    .getEntities()
    .filter((e) => e.kind === 'block')
    .sort((a, b) => a.x - b.x)
    .map((e) => `${e.type}@${e.x}`);
}

function terrainAt(engine: GameEngine, x: number): string {
  return engine.getTerrain()[ROW][x];
}

const MIRROR_AND_TURRET_IDS = ['mirror_slash', 'one_sided_mirror_ne', 'turret_fixed', 'turret_cw'];

beforeEach(() => {
  loadTestConfigs();
});

describe('dirt_3d: the CC3D dirt', () => {
  it('is cleared by a block that enters it, which survives', () => {
    for (const type of ['dirt_block', 'color_block_red', 'arrow_block_one']) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'dirt_3d']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@4`]);
      expect(terrainAt(engine, 4), type).toBe('floor');
    }
  });

  it('is passed over, and kept, by the ice blocks', () => {
    for (const type of ['ice_block', 'ice_block_3d']) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'dirt_3d']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@4`]);
      expect(terrainAt(engine, 4), type).toBe('dirt_3d');
    }
  });

  it('refuses the mirrors and the turrets', () => {
    for (const type of MIRROR_AND_TURRET_IDS) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'dirt_3d']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@3`]);
      expect(terrainAt(engine, 4), type).toBe('dirt_3d');
    }
  });

  it('agrees with the CC3D engine: the dirt block clears it, the ice block keeps it', () => {
    const dirt = playScenario({ rows: room('@KD.'), moves: 'E' });
    expect(dirt.pair.rig.terrainAt(3, 1)).toBe('floor');
    expect(dirt.pair.rig.entities.map((e) => e.x)).toEqual([3]);
    const ice = playScenario({ rows: room('@ZD.'), moves: 'E' });
    expect(ice.pair.rig.terrainAt(3, 1)).toBe('dirt');
    expect(ice.pair.rig.entities.map((e) => e.x)).toEqual([3]);
  });
});

describe('popup_wall_cc2: the CC2 pop-up wall', () => {
  it('refuses the dirt block and admits the other blocks', () => {
    const refused = play({ entities: [block('dirt_block', 3)], terrain: [[4, ROW, 'popup_wall_cc2']] }, 1);
    expect(blocks(refused)).toEqual(['dirt_block@3']);
    expect(terrainAt(refused, 4)).toBe('popup_wall_cc2');
    for (const type of ['ice_block', 'color_block_red', 'mirror_slash']) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'popup_wall_cc2']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@4`]);
      expect(terrainAt(engine, 4), type).toBe('popup_wall_cc2');
    }
  });
});

describe('slime_3d: the CC3D slime', () => {
  it('refuses the mirrors and the turrets', () => {
    for (const type of MIRROR_AND_TURRET_IDS) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'slime_3d']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@3`]);
      expect(terrainAt(engine, 4), type).toBe('slime_3d');
    }
  });

  it('is cleaned by the other blocks, which are used up as on the slime', () => {
    for (const type of ['dirt_block', 'ice_block', 'ice_block_3d', 'color_block_red']) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'slime_3d']] }, 1);
      expect(blocks(engine), type).toEqual([]);
      expect(terrainAt(engine, 4), type).toBe('floor');
    }
  });
});

describe('ice_block_3d: the CC3D ice block', () => {
  it('lets the head block govern the whole line, whatever the blocks behind push themselves', () => {
    // CC3D (cc3dEvidenceBlocks '@ZKK.'): an ice block pushes dirt blocks along; the dirt blocks push nothing themselves.
    const cc3d = playScenario({ rows: room('@ZKK.'), moves: 'E' });
    expect(cc3d.pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 4, 5]);
    const engine = play({ entities: [block('ice_block_3d', 3), block('dirt_block', 4), block('dirt_block', 5)] }, 1);
    expect(blocks(engine)).toEqual(['ice_block_3d@4', 'dirt_block@5', 'dirt_block@6']);
  });

  it('pushes a line that holds colour blocks, mirrors and turrets', () => {
    const cc3d = playScenario({ rows: room('@ZC..'), moves: 'E' });
    expect(cc3d.pair.rig.entities.map((e) => e.x).sort()).toEqual([3, 4]);
    const line = ['ice_block', 'color_block_red', 'mirror_slash', 'turret_fixed'];
    const engine = play({ entities: [block('ice_block_3d', 3), ...line.map((type, i) => block(type, 4 + i))] }, 1);
    expect(blocks(engine)).toEqual(['ice_block_3d@4', ...line.map((type, i) => `${type}@${5 + i}`)]);
  });

  it('does not let a dirt block head a chain', () => {
    const engine = play({ entities: [block('dirt_block', 3), block('dirt_block', 4)] }, 1);
    expect(blocks(engine)).toEqual(['dirt_block@3', 'dirt_block@4']);
  });

  it('refuses a line whose last block has nowhere to go', () => {
    const engine = play({ entities: [block('ice_block_3d', 3), block('dirt_block', 4)], terrain: [[5, ROW, 'wall']] }, 1);
    expect(blocks(engine)).toEqual(['ice_block_3d@3', 'dirt_block@4']);
  });

  it('is pushed over the thieves, which it does not change', () => {
    const cc3d = playScenario({ rows: room('@ZN.'), moves: 'E' });
    expect(cc3d.pair.rig.entities.map((e) => e.x)).toEqual([3]);
    for (const thief of ['thief', 'thief_keys']) {
      const engine = play({ entities: [block('ice_block_3d', 3)], terrain: [[4, ROW, thief]] }, 1);
      expect(blocks(engine), thief).toEqual(['ice_block_3d@4']);
      expect(terrainAt(engine, 4), thief).toBe(thief);
    }
  });

  it('slides over the thieves too, and the other blocks are still refused by them', () => {
    const slid = play({ entities: [block('ice_block_3d', 3)], terrain: [[4, ROW, 'ice'], [5, ROW, 'ice'], [6, ROW, 'thief']] }, 1);
    expect(blocks(slid)).toEqual(['ice_block_3d@6']);
    expect(terrainAt(slid, 6)).toBe('thief');
    const other = play({ entities: [block('ice_block', 3)], terrain: [[4, ROW, 'thief']] }, 1);
    expect(blocks(other)).toEqual(['ice_block@3']);
  });
});

describe('appearing_wall_any: the wall any mover reveals', () => {
  it('turns into a wall when a block is pushed into it, and the push is refused', () => {
    for (const type of ['dirt_block', 'ice_block', 'mirror_slash']) {
      const engine = play({ entities: [block(type, 3)], terrain: [[4, ROW, 'appearing_wall_any']] }, 1);
      expect(blocks(engine), type).toEqual([`${type}@3`]);
      expect(terrainAt(engine, 4), type).toBe('wall');
    }
  });

  it('is revealed by the last block of a pushed line', () => {
    const engine = play({ entities: [block('ice_block_3d', 3), block('dirt_block', 4)], terrain: [[5, ROW, 'appearing_wall_any']] }, 1);
    expect(blocks(engine)).toEqual(['ice_block_3d@3', 'dirt_block@4']);
    expect(terrainAt(engine, 5)).toBe('wall');
  });

  it('is revealed by a block that slides into it', () => {
    const engine = play({ entities: [block('ice_block', 3)], terrain: [[4, ROW, 'ice'], [5, ROW, 'ice'], [6, ROW, 'appearing_wall_any']] }, 1);
    expect(blocks(engine)).toHaveLength(1);
    expect(terrainAt(engine, 6)).toBe('wall');
  });

  it('agrees with the CC3D engine: a pushed block reveals the appearing wall', () => {
    const cc3d = playScenario({ rows: room('@KQ.'), moves: 'E' });
    expect(cc3d.pair.rig.terrainAt(3, 1)).toBe('wall');
    expect(cc3d.pair.rig.entities.map((e) => e.x)).toEqual([2]);
  });
});
