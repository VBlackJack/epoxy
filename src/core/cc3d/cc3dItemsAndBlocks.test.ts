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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { cc3dLevel, stacked } from './cc3dTestMaps';
import { Cc3dRig } from './cc3dTestRig';

beforeAll(() => {
  loadTestConfigs();
});

const SETTLE_TICKS = 40;

describe('FISH, sockets and extra FISH', () => {
  it('counts the FISH on the map and lowers the count on pickup', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@ii.#']));
    expect(rig.engine.getChipsRemaining()).toBe(2);
    rig.walk('E');
    expect(rig.engine.getChipsRemaining()).toBe(1);
    expect(rig.visualsOf('chip')).toHaveLength(1);
    rig.walk('E');
    expect(rig.engine.getChipsRemaining()).toBe(0);
  });

  it('a socket blocks until every FISH is collected, then opens', () => {
    const rig = new Cc3dRig(cc3dLevel(['#i###', '#@S.#']));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
    rig.walk('N', 'S', 'E');
    expect(rig.player.x).toBe(2);
    expect(rig.terrainAt(2, 1)).toBe('floor');
    expect(rig.visualsOf('unlock')).toHaveLength(1);
  });

  it('an extra FISH lowers the remaining count without being counted', () => {
    const rig = new Cc3dRig(cc3dLevel(['######', '#.i###', '#@eSX#', '######']));
    expect(rig.engine.getChipsRemaining()).toBe(1);
    rig.walk('E');
    expect(rig.engine.getChipsRemaining()).toBe(0);
    rig.walk('E', 'E');
    expect(rig.engine.isLevelCompleted()).toBe(true);
  });

  it('the red socket follows the same rule for now [U]', () => {
    const glyphs = { S: stacked({ kind: 'floor' }, { kind: 'socket_red' }) };
    const rig = new Cc3dRig(cc3dLevel(['#@S.#'], { glyphs }));
    rig.walk('E');
    expect(rig.player.x).toBe(2);
  });
});

describe('keys and doors', () => {
  it('a door without its key stays shut', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@u1.#']));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(2);
  });

  it('a red door uses up the key', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@r1.#']));
    rig.walk('E');
    expect(rig.engine.holdsItem('key_red')).toBe(true);
    rig.walk('E');
    expect(rig.player.x).toBe(3);
    expect(rig.engine.holdsItem('key_red')).toBe(false);
    expect(rig.terrainAt(3, 0)).toBe('floor');
  });

  it('a green door keeps the key', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@g4.#']));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(3);
    expect(rig.engine.holdsItem('key_green')).toBe(true);
  });

  it('counts keys per colour', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@rr.#']));
    rig.walk('E', 'E');
    expect(rig.player.keys).toEqual({ key_red: 2 });
  });

  it('the keys gate takes every key and the tools gate every tool', () => {
    const keys = new Cc3dRig(cc3dLevel(['#@rn.#']));
    keys.walk('E', 'E');
    expect(keys.engine.holdsItem('key_red')).toBe(false);
    const tools = new Cc3dRig(cc3dLevel(['#@aN.#']));
    tools.walk('E');
    expect(tools.engine.holdsItem('boots_ice')).toBe(true);
    tools.walk('E');
    expect(tools.engine.holdsItem('boots_ice')).toBe(false);
  });
});

describe('tools', () => {
  it('keeps four tools and drops the oldest on the cell when a fifth is taken [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@aofws.#']));
    rig.walk('E', 'E', 'E', 'E');
    expect(rig.player.boots.size).toBe(4);
    rig.walk('E');
    expect(rig.engine.holdsItem('boots_ice')).toBe(false);
    for (const id of ['boots_force', 'boots_fire', 'boots_water', 'stopwatch_bonus']) {
      expect(rig.engine.holdsItem(id)).toBe(true);
    }
    expect(rig.engine.getItems()[0][6]).toBe('boots_ice');
  });
});

describe('terrain stack: the top acts', () => {
  const glyphs = { B: stacked({ kind: 'floor' }, { kind: 'bomb' }, { kind: 'door', color: 'red' }) };

  it('a door over a bomb blocks, and the bomb does nothing yet', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@B.#'], { glyphs }));
    rig.walk('E');
    expect(rig.player.alive).toBe(true);
    expect(rig.player.x).toBe(1);
  });

  it('opening the door pops it, then the bomb acts', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@rB.#'], { glyphs }));
    rig.walk('E', 'E');
    expect(rig.player.deathReasonKey).toBe('hud.messages.death_bomb');
    expect(rig.engine.holdsItem('key_red')).toBe(false);
  });
});

describe('key doors over other layers', () => {
  const over = (layer: Parameters<typeof stacked>[0]) => ({
    B: stacked({ kind: 'floor' }, layer, { kind: 'door', color: 'red' })
  });

  it('a key door over a closed hold door: the key is spent, the door opens, the player stays', () => {
    const glyphs = over({ kind: 'hold_door', color: 'green', open: false });
    const rig = new Cc3dRig(cc3dLevel(['#@rB.#'], { glyphs }));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(2);
    expect(rig.engine.holdsItem('key_red')).toBe(false);
    expect(rig.terrainAt(3, 0)).toBe('cc3d_hold_door_green_closed');
    rig.walk('E');
    expect(rig.player.x).toBe(2);
  });

  it('a key door over a closed toggle door behaves the same', () => {
    const glyphs = over({ kind: 'toggle_door', color: 'green', open: false });
    const rig = new Cc3dRig(cc3dLevel(['#@rB.#'], { glyphs }));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(2);
    expect(rig.engine.holdsItem('key_red')).toBe(false);
  });

  it('a key door over an open toggle door lets the player through', () => {
    const glyphs = over({ kind: 'toggle_door', color: 'green', open: true });
    const rig = new Cc3dRig(cc3dLevel(['#@rB.#'], { glyphs }));
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(3);
  });
});

describe('items after a teleport [U]', () => {
  it('the player also takes the item of the cell the teleport put him on', () => {
    const glyphs = { t: { stack: [{ kind: 'teleport_red' as const }] }, i: { stack: [{ kind: 'teleport_red' as const }], item: { kind: 'fish' as const } } };
    const rig = new Cc3dRig(cc3dLevel(['#@t..i.#'], { glyphs }));
    rig.walk('E');
    rig.tick(40);
    expect(rig.engine.getItems()[0][5]).toBeNull();
  });
});

describe('blocks', () => {
  it('the player pushes one block, both moving at once', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@K..#']));
    rig.press('E');
    rig.tick();
    expect(rig.player.x).toBe(2);
    expect(rig.entityAt(3, 0)?.type).toBe('dirt_block');
    expect(rig.entityAt(3, 0)?.cooldownTicks).toBe(3);
  });

  it('refuses a push into a wall or into a second block', () => {
    const wall = new Cc3dRig(cc3dLevel(['#@K#']));
    wall.walk('E');
    expect(wall.player.x).toBe(1);
    expect(wall.entityAt(2, 0)).toBeDefined();
    const two = new Cc3dRig(cc3dLevel(['#@KK.#']));
    two.walk('E');
    expect(two.player.x).toBe(1);
  });

  it('a dirt block fills water into dirt [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KW.#']));
    rig.walk('E');
    expect(rig.terrainAt(3, 0)).toBe('dirt');
    expect(rig.entities).toHaveLength(0);
    rig.walk('E');
    expect(rig.player.x).toBe(3);
    expect(rig.player.alive).toBe(true);
  });

  it('[P] a colour block floats as a bridge the player walks across', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@CW.#']));
    rig.walk('E');
    expect(rig.entityAt(3, 0)?.type).toBe('cc3d_block_blue');
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(4);
    expect(rig.player.alive).toBe(true);
  });

  it('[P] an ice block turns water into ice and vanishes', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@ZW.#']));
    rig.walk('E');
    expect(rig.terrainAt(3, 0)).toBe('ice');
    expect(rig.entities).toHaveLength(0);
  });

  it('an ice block melts in fire into water [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@ZF.#']));
    rig.walk('E');
    expect(rig.terrainAt(3, 0)).toBe('water');
    expect(rig.entities).toHaveLength(0);
  });

  it('a dirt block cannot be pushed into fire [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KF.#']));
    rig.walk('E');
    expect(rig.player.x).toBe(1);
  });

  it('an ice block pushes a chain of ice blocks, other blocks do not chain [U]', () => {
    const chain = new Cc3dRig(cc3dLevel(['#@ZZ..#']));
    chain.walk('E');
    expect(chain.entityAt(3, 0)).toBeDefined();
    expect(chain.entityAt(4, 0)).toBeDefined();
    const mixed = new Cc3dRig(cc3dLevel(['#@KZ.#']));
    mixed.walk('E');
    expect(mixed.player.x).toBe(1);
  });

  it('a block pushed onto slime cleans it [U]', () => {
    const rig = new Cc3dRig(cc3dLevel(['#@KL.#']));
    rig.walk('E');
    expect(rig.terrainAt(3, 0)).toBe('floor');
    expect(rig.entities).toHaveLength(0);
    rig.walk('E', 'E');
    expect(rig.player.x).toBe(4);
    expect(rig.player.alive).toBe(true);
  });

  it('blocks cross gravel and are carried by force floors', () => {
    const gravel = new Cc3dRig(cc3dLevel(['#@KG.#']));
    gravel.walk('E');
    expect(gravel.entityAt(3, 0)).toBeDefined();
    const force = new Cc3dRig(cc3dLevel(['#@K>..#']));
    force.walk('E');
    force.tick(SETTLE_TICKS);
    expect(force.entityAt(4, 0)).toBeDefined();
  });

  it('a block cannot be pushed onto the exit or a bomb [U]', () => {
    const exit = new Cc3dRig(cc3dLevel(['#@KX#']));
    exit.walk('E');
    expect(exit.player.x).toBe(1);
    const bomb = new Cc3dRig(cc3dLevel(['#@KO#']));
    bomb.walk('E');
    expect(bomb.player.x).toBe(1);
  });
});
