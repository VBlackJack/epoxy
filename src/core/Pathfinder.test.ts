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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from './GameEngine';
import { Pathfinder } from './Pathfinder';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** All-wall level with a one-tile corridor on row 2 from x = 2 to x = 8; the player stands at (2, 2). */
function corridor(cells: Record<number, string> = {}): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  const terrain = Array.from({ length: mapHeight }, () =>
    Array.from({ length: mapWidth }, () => 'wall')
  );
  for (let x = 2; x <= 8; x++) {
    terrain[2][x] = cells[x] ?? 'floor';
  }
  return {
    id: 'corridor',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'E' },
    terrain,
    items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function engineFor(level: CompiledLevel, boots: string[] = [], keys: Record<string, number> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const boot of boots) engine.getPlayer().boots.add(boot);
  Object.assign(engine.getPlayer().keys, keys);
  return engine;
}

describe('Pathfinder.findPath', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('crosses water with water boots', () => {
    const engine = engineFor(corridor({ 4: 'water' }), ['boots_water']);
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual(['E', 'E', 'E', 'E']);
  });

  it('knows a thief takes the boots before the water', () => {
    const engine = engineFor(corridor({ 3: 'thief', 4: 'water' }), ['boots_water']);
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual([]);
    // The thief itself is still a valid destination
    expect(Pathfinder.findPath(engine, 3, 2).moves).toEqual(['E']);
  });

  it('does not route across ice, but may end on it', () => {
    const engine = engineFor(corridor({ 4: 'ice' }));
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engine, 4, 2).moves).toEqual(['E', 'E']);
  });

  it('routes across ice with ice boots', () => {
    const engine = engineFor(corridor({ 4: 'ice' }), ['boots_ice']);
    expect(Pathfinder.findPath(engine, 6, 2).moves).toHaveLength(4);
  });

  it('does not route through a teleporter', () => {
    const engine = engineFor(corridor({ 4: 'teleport' }));
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual([]);
  });

  it('spends one held key per consuming door', () => {
    const level = corridor({ 4: 'door_red', 6: 'door_red' });
    expect(Pathfinder.findPath(engineFor(level, [], { key_red: 1 }), 8, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engineFor(level, [], { key_red: 2 }), 8, 2).moves).toHaveLength(6);
  });

  it('reuses a key that is not consumed', () => {
    const level = corridor({ 4: 'door_green', 6: 'door_green' });
    expect(Pathfinder.findPath(engineFor(level, [], { key_green: 1 }), 8, 2).moves).toHaveLength(6);
  });
});
