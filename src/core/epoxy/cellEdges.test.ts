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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { cellEdgeMask, isEdgeBlockedAt } from '../EdgeRules';
import { GameEngine } from '../GameEngine';
import { CellEdge, CompiledLevel, Direction } from '../types';

const SIZE = 11;
/** Ticks run before each move so the move cooldown has elapsed. */
const COOLDOWN_TICKS = 12;
/** Upper bound of ticks a slide needs to settle in these small rooms. */
const SETTLE_TICKS = 80;

/** Walled floor room with the player at (2, 5). */
function room(id: string, cellEdges?: CellEdge[]): CompiledLevel {
  return {
    id,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 5, dir: 'E' },
    terrain: Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    ...(cellEdges ? { cellEdges } : {}),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function start(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function ticks(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function step(engine: GameEngine, dir: Direction): boolean {
  ticks(engine, COOLDOWN_TICKS);
  return engine.attemptPlayerMove(dir);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('cellEdgeMask', () => {
  it('is null without edges and for an empty list', () => {
    expect(cellEdgeMask(room('none'))).toBeNull();
    expect(cellEdgeMask(room('empty', []))).toBeNull();
  });

  it('sets one bit per side and memoises on the edge list', () => {
    const level = room('bits', [{ x: 3, y: 4, sides: ['N', 'W'] }]);
    const mask = cellEdgeMask(level);
    expect(mask?.[4 * SIZE + 3]).toBe(1 | 8);
    expect(cellEdgeMask(level)).toBe(mask);
  });

  it('skips malformed entries without throwing', () => {
    const junk = [
      null,
      7,
      'x',
      { x: 1, y: 1 },
      { x: 99, y: 1, sides: ['N'] },
      { x: 1.5, y: 1, sides: ['N'] },
      { x: 2, y: 2, sides: ['Q', 3, 'E'] }
    ];
    const mask = cellEdgeMask(room('junk', junk as unknown as CellEdge[]));
    expect(mask?.[2 * SIZE + 2]).toBe(2);
    expect(Array.from(mask ?? []).filter((b) => b !== 0)).toHaveLength(1);
    expect(cellEdgeMask(room('notlist', {} as unknown as CellEdge[]))).toBeNull();
  });
});

describe('isEdgeBlockedAt', () => {
  it('reads an edge from either cell', () => {
    const level = room('either', [{ x: 3, y: 5, sides: ['E'] }]);
    const mask = cellEdgeMask(level);
    expect(isEdgeBlockedAt(level.terrain, mask, 3, 5, 4, 5, 'E')).toBe(true);
    expect(isEdgeBlockedAt(level.terrain, mask, 4, 5, 3, 5, 'W')).toBe(true);
    expect(isEdgeBlockedAt(level.terrain, mask, 3, 5, 3, 4, 'N')).toBe(false);
    expect(isEdgeBlockedAt(level.terrain, null, 3, 5, 4, 5, 'E')).toBe(false);
  });

  it('keeps the tile edges of thin wall tiles', () => {
    const level = room('tiles');
    level.terrain[5][3] = 'thin_wall_e';
    expect(isEdgeBlockedAt(level.terrain, null, 3, 5, 4, 5, 'E')).toBe(true);
  });
});

describe('cell edges in play', () => {
  it('stops the player on plain floor from both sides', () => {
    const engine = start(room('floor', [{ x: 3, y: 5, sides: ['E'] }]));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(3);
    expect(step(engine, 'E')).toBe(false);
    const other = start(room('floor_back', [{ x: 3, y: 5, sides: ['W'] }]));
    expect(step(other, 'E')).toBe(false);
    expect(other.getPlayer().x).toBe(2);
  });

  it('keeps the player off water behind an edge', () => {
    const open = room('water_open');
    open.terrain[5][3] = 'water';
    const drowned = start(open);
    step(drowned, 'E');
    expect(drowned.getPlayer().alive).toBe(false);

    const walled = room('water_walled', [{ x: 3, y: 5, sides: ['W'] }]);
    walled.terrain[5][3] = 'water';
    const engine = start(walled);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer()).toMatchObject({ x: 2, alive: true });
  });

  it('bounces the player off an edge on ice', () => {
    const level = room('ice_bounce', [{ x: 6, y: 5, sides: ['E'] }]);
    for (let x = 3; x <= 6; x++) level.terrain[5][x] = 'ice';
    const engine = start(level);
    expect(step(engine, 'E')).toBe(true);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 5, isSliding: false, alive: true });
  });

  it('ends a slide that an edge stops on a corner whose way back is closed too', () => {
    // Ice corner (north-west): entered going west it turns south. Its south edge is closed.
    const level = room('ice_corner', [{ x: 6, y: 5, sides: ['S'] }]);
    level.playerStart = { x: 8, y: 5, dir: 'W' };
    level.terrain[5][6] = 'ice_nw';
    level.terrain[5][7] = 'ice';
    const engine = start(level);
    expect(step(engine, 'W')).toBe(true);
    ticks(engine, SETTLE_TICKS);
    const player = engine.getPlayer();
    expect(player.alive).toBe(true);
    expect(player.isSliding).toBe(false);
    expect(player.y).toBe(5);
  });

  it('stops a slide on a force floor at an edge', () => {
    const level = room('force_stop', [{ x: 5, y: 5, sides: ['E'] }]);
    for (let x = 3; x <= 5; x++) level.terrain[5][x] = 'force_e';
    const engine = start(level);
    expect(step(engine, 'E')).toBe(true);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer()).toMatchObject({ x: 5, y: 5, isSliding: false, alive: true });
  });

  it('refuses to push a block across an edge, so it never sinks behind one', () => {
    const level = room('block', [{ x: 4, y: 5, sides: ['W'] }]);
    level.terrain[5][4] = 'water';
    level.entities = [{ x: 3, y: 5, type: 'dirt_block', dir: 'E' }];
    const engine = start(level);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getEntities()[0]).toMatchObject({ x: 3, y: 5 });
    expect(engine.getTerrain()[5][4]).toBe('water');

    const open = room('block_open');
    open.terrain[5][4] = 'water';
    open.entities = [{ x: 3, y: 5, type: 'dirt_block', dir: 'E' }];
    const sinking = start(open);
    expect(step(sinking, 'E')).toBe(true);
    expect(sinking.getTerrain()[5][4]).not.toBe('water');
  });

  it('keeps a monster from crossing an edge', () => {
    const level = room('monster', [{ x: 3, y: 5, sides: ['E'] }]);
    level.playerStart = { x: 9, y: 9, dir: 'N' };
    // A pocket open only to the east, where the edge is.
    level.terrain[4][3] = 'wall';
    level.terrain[6][3] = 'wall';
    level.terrain[5][2] = 'wall';
    level.entities = [{ x: 3, y: 5, type: 'walker', dir: 'E' }];
    const engine = start(level);
    for (let i = 0; i < SETTLE_TICKS; i++) {
      engine.tick();
      expect(engine.getEntities()[0].x).toBeLessThan(4);
    }
  });

  it('stops a laser beam at an edge', () => {
    const level = room('beam', [{ x: 5, y: 5, sides: ['E'] }]);
    level.terrain[5][3] = 'laser_emitter_e';
    const beam = (engine: GameEngine): string[] => engine.getBeamCells().map((c) => `${c.x},${c.y}`);
    const walled = beam(start(level));
    expect(walled).toContain('5,5');
    expect(walled).not.toContain('6,5');
    const open = room('beam_open');
    open.terrain[5][3] = 'laser_emitter_e';
    expect(beam(start(open))).toContain('6,5');
  });

  it('keeps a teleport exit off water behind an edge', () => {
    const build = (edges?: CellEdge[]): GameEngine => {
      const level = room('teleport', edges);
      level.terrain[5][3] = 'teleport';
      level.terrain[5][7] = 'teleport';
      level.terrain[5][8] = 'water';
      return start(level);
    };
    const open = build();
    step(open, 'E');
    expect(open.getPlayer().alive).toBe(false);
    const walled = build([{ x: 7, y: 5, sides: ['E'] }]);
    step(walled, 'E');
    expect(walled.getPlayer().alive).toBe(true);
    expect(walled.getPlayer().x).not.toBe(8);
  });

  it('keeps an edge when the terrain under it changes', () => {
    const level = room('survives', [{ x: 3, y: 5, sides: ['W'] }]);
    const engine = start(level);
    expect(step(engine, 'E')).toBe(false);
    engine.getTerrain()[5][3] = 'water';
    expect(step(engine, 'E')).toBe(false);
    engine.getTerrain()[5][3] = 'toggle_wall_open';
    expect(step(engine, 'E')).toBe(false);
  });

  it('restores the position on undo', () => {
    const engine = start(room('undo', [{ x: 4, y: 5, sides: ['E'] }]));
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(3);
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'E')).toBe(false);
  });

  it('forgets the edges of the previous level on load', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('edged', [{ x: 3, y: 5, sides: ['W'] }]));
    expect(step(engine, 'E')).toBe(false);
    engine.loadLevel(room('plain'));
    expect(engine.getPanels().size).toBe(0);
    expect(step(engine, 'E')).toBe(true);
  });
});

describe('getPanels', () => {
  it('lists the sides of each edged cell in N, E, S, W order', () => {
    const engine = start(
      room('panels', [
        { x: 4, y: 4, sides: ['W', 'N'] },
        { x: 6, y: 6, sides: ['S'] }
      ])
    );
    expect(engine.getPanels().get(4 * SIZE + 4)).toEqual(['N', 'W']);
    expect(engine.getPanels().get(6 * SIZE + 6)).toEqual(['S']);
    expect(engine.getPanels().size).toBe(2);
  });
});