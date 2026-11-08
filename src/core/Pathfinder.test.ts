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
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
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

describe('Pathfinder.findNextObjective', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('does not point through a barrier against a held item', () => {
    const level = corridor({ 5: 'forbid_key_red', 8: 'exit' });
    expect(Pathfinder.findNextObjective(engineFor(level))).toEqual({ x: 8, y: 2 });
    expect(Pathfinder.findNextObjective(engineFor(level, [], { key_red: 1 }))).toBeNull();
  });

  it('does not point through a no-sign on the item layer against a held item', () => {
    const level = corridor({ 8: 'exit' });
    level.items[2][5] = 'no_sign_key_red';
    expect(Pathfinder.findNextObjective(engineFor(level))).toEqual({ x: 8, y: 2 });
    expect(Pathfinder.findNextObjective(engineFor(level, [], { key_red: 1 }))).toBeNull();
    expect(Pathfinder.findPath(engineFor(level, [], { key_red: 1 }), 8, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engineFor(level), 8, 2).moves).toHaveLength(6);
  });

  it('offers the orange button while a flame jet is lit', () => {
    const lit = corridor({ 4: 'button_orange', 6: 'flame_jet_on', 8: 'exit' });
    expect(Pathfinder.findNextObjective(engineFor(lit))).toEqual({ x: 4, y: 2 });
    const out = corridor({ 4: 'button_orange', 6: 'flame_jet_off', 8: 'exit' });
    expect(Pathfinder.findNextObjective(engineFor(out))).toEqual({ x: 8, y: 2 });
  });
});

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

  it('spends one toll token per thief, so one token does not cover two thieves before a fire', () => {
    const level = corridor({ 3: 'thief', 4: 'thief', 5: 'fire' });
    const oneToken = engineFor(level, ['boots_fire'], { toll_token: 1 });
    expect(Pathfinder.findPath(oneToken, 7, 2).moves).toEqual([]);
    const twoTokens = engineFor(level, ['boots_fire'], { toll_token: 2 });
    expect(Pathfinder.findPath(twoTokens, 7, 2).moves).toHaveLength(5);
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

  it('ends on a closed trap but never routes through one', () => {
    const engine = engineFor(corridor({ 4: 'trap' }));
    expect(engine.isCellClosedTrap(4, 2)).toBe(true);
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engine, 4, 2).moves).toEqual(['E', 'E']);
  });

  it('reuses a key that is not consumed', () => {
    const level = corridor({ 4: 'door_green', 6: 'door_green' });
    expect(Pathfinder.findPath(engineFor(level, [], { key_green: 1 }), 8, 2).moves).toHaveLength(6);
  });

  it('never plans through or onto a cell a laser beam crosses', () => {
    const level = corridor();
    // An emitter in the wall above the corridor fires down across (5, 2).
    level.terrain[1][5] = 'laser_emitter_s';
    const engine = engineFor(level);
    expect(engine.getBeamCells().map((c) => `${c.x},${c.y}`)).toEqual(['5,2']);
    expect(Pathfinder.findPath(engine, 7, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engine, 5, 2).moves).toEqual([]);
    expect(Pathfinder.findPath(engine, 4, 2).moves).toEqual(['E', 'E']);
  });

  it('blocks nothing when a block cuts the beam before the corridor', () => {
    const level = corridor();
    level.terrain[1][5] = 'laser_emitter_s';
    // The beam is cut at (5, 2) by a dirt block, which is not a mirror.
    level.entities = [{ type: 'dirt_block', x: 5, y: 2, dir: 'S' }];
    const engine = engineFor(level);
    expect(engine.getBeamCells()).toEqual([]);
    expect(Pathfinder.findPath(engine, 4, 2).moves).toEqual(['E', 'E']);
  });
});

describe('Pathfinder.findPath for Melinda', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const melinda = (level: CompiledLevel): CompiledLevel => ({ ...level, character: 'melinda' });

  it('routes across ice, which does not carry her off', () => {
    const engine = engineFor(melinda(corridor({ 4: 'ice' })));
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual(['E', 'E', 'E', 'E']);
  });

  it('refuses dirt and gravel without hiking boots and crosses them with the boots', () => {
    for (const tile of ['dirt', 'gravel']) {
      expect(Pathfinder.findPath(engineFor(melinda(corridor({ 4: tile }))), 6, 2).moves, tile).toEqual([]);
      expect(Pathfinder.findPath(engineFor(melinda(corridor({ 4: tile })), ['hiking_boots']), 6, 2).moves, tile).toHaveLength(4);
      expect(Pathfinder.findPath(engineFor(corridor({ 4: tile })), 6, 2).moves, tile).toHaveLength(4);
    }
  });

  it('refuses dirt after a thief took the hiking boots', () => {
    const engine = engineFor(melinda(corridor({ 3: 'thief', 4: 'dirt' })), ['hiking_boots']);
    expect(Pathfinder.findPath(engine, 6, 2).moves).toEqual([]);
  });
});
