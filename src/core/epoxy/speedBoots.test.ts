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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findSpeedBootsConfigErrors } from '../../config/ConfigValidation';
import { tileAvailability } from '../../editor/paletteAvailability';
import { datRefusalReason } from '../../formats/DatCodec';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { hasEpoxyOnlyContent, isEpoxyOnlyTileId, isSpeedBootsTileId } from '../RulesetFeatures';
import { monsterSlowdown, playerHaste } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction } from '../types';

const SIZE = 11;
const SPEED_ID = 'boots_speed';
const SLOW_ID = 'slow_time';
const PLAYER_ROW = 5;
const PLAYER_START_X = 2;
const BOOTS_X = 3;
const THIEF_X = 4;
const TIME_LIMIT_SECONDS = 100;
const OBSERVED_TICKS = 40;
/** Upper bound of ticks the player cooldown can need. */
const MAX_WAIT_TICKS = 30;
/** Walking cooldown of the base game and the hasted one (the config says 4, the boots halve it). */
const BASE_COOLDOWN = 4;
const HASTED_COOLDOWN = 2;
/** Boots the validator tracks, with the bit each gets (sorted by id): unchanged by the speed boots. */
const EXPECTED_BOOT_BITS = new Map([
  ['boots_fire', 1],
  ['boots_force', 2],
  ['boots_ice', 4],
  ['boots_water', 8]
]);

interface Setup {
  boots?: boolean;
  thief?: boolean;
  ice?: boolean;
  force?: boolean;
}

/** Walled floor room, the player at (2, 5), optionally boots at (3, 5), a thief at (4, 5), ice or force floor from (4, 5). */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  if (setup.boots) items[PLAYER_ROW][BOOTS_X] = SPEED_ID;
  if (setup.thief) terrain[PLAYER_ROW][THIEF_X] = 'thief';
  if (setup.ice) for (let x = THIEF_X; x < SIZE - 1; x++) terrain[PLAYER_ROW][x] = 'ice';
  if (setup.force) for (let x = THIEF_X; x < SIZE - 1; x++) terrain[PLAYER_ROW][x] = 'force_e';
  return {
    id: 'speed_boots_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: PLAYER_START_X, y: PLAYER_ROW, dir: 'E' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

/** An engine plus helpers that walk it and read the cooldown it set. */
class Probe {
  public readonly engine = new GameEngine();

  public constructor(level: CompiledLevel) {
    this.engine.loadLevel(level);
  }

  public world(): EpoxyWorld {
    return (this.engine as unknown as { w: EpoxyWorld }).w;
  }

  /** Runs until the player may move, then moves; returns the cooldown the move set. */
  public step(dir: Direction): number {
    for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
      if (this.engine.attemptPlayerMove(dir)) return this.engine.getPlayer().moveCooldown;
      this.engine.tick();
    }
    throw new Error('the player never became able to move');
  }

  /** Position of the player after each of `count` ticks. */
  public trace(count: number): string[] {
    const cells: string[] = [];
    for (let i = 0; i < count; i++) {
      this.engine.tick();
      const p = this.engine.getPlayer();
      cells.push(`${p.x},${p.y}`);
    }
    return cells;
  }
}

beforeEach(() => {
  loadTestConfigs();
});

describe('speed boots: configuration', () => {
  it('is a collectible boot that hastes the player twice', () => {
    const def = ConfigRegistry.getTile(SPEED_ID);
    expect(def.collectible).toBe('boot');
    expect(def.hastesPlayer).toBe(2);
    expect(def.laserTransparent).toBe(true);
    expect(ConfigRegistry.getGame().timing.playerMoveCooldownTicks).toBe(BASE_COOLDOWN);
  });

  it('refuses every factor but 2, and a carrier that is not a boot', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    expect(findSpeedBootsConfigErrors(tiles)).toEqual([]);
    const withFactor = (factor: number): string[] =>
      findSpeedBootsConfigErrors({ ...tiles, [SPEED_ID]: { ...tiles[SPEED_ID], hastesPlayer: factor } });
    for (const factor of [1, 3, 4, 2.5, 0]) expect(withFactor(factor), String(factor)).toHaveLength(1);
    const notBoot = { ...tiles.score_10, hastesPlayer: 2 };
    expect(findSpeedBootsConfigErrors({ ...tiles, score_10: notBoot })).toHaveLength(1);
  });
});

describe('speed boots: walking cooldown', () => {
  it('keeps the base cooldown on a level without the boots', () => {
    const probe = new Probe(room());
    expect(playerHaste(probe.world())).toBe(1);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
  });

  it('halves the cooldown while the boots are held', () => {
    const probe = new Probe(room());
    probe.engine.getPlayer().boots.add(SPEED_ID);
    expect(playerHaste(probe.world())).toBe(2);
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
  });

  it('hastes the very step that picks the boots up', () => {
    const probe = new Probe(room({ boots: true }));
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(true);
  });

  it('stacks with the slow-time charm: the player is hasted and the monsters are slowed', () => {
    const probe = new Probe(room());
    probe.engine.getPlayer().boots.add(SPEED_ID);
    probe.engine.getPlayer().boots.add(SLOW_ID);
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
    expect(monsterSlowdown(probe.world())).toBe(2);
    expect(playerHaste(probe.world())).toBe(2);
  });

  it('is not hasted by boots that do not haste', () => {
    const probe = new Probe(room());
    probe.engine.getPlayer().boots.add('boots_water');
    probe.engine.getPlayer().boots.add(SLOW_ID);
    expect(playerHaste(probe.world())).toBe(1);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
  });

  it('returns to the base cooldown after a thief steals the boots; the step onto the thief is already normal', () => {
    const probe = new Probe(room({ boots: true, thief: true }));
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(false);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
  });

  it('returns to the base cooldown once the boots are dropped', () => {
    const probe = new Probe(room({ boots: true }));
    probe.step('E');
    expect(probe.engine.dropItem(SPEED_ID)).toBe(true);
    expect(probe.step('E')).toBe(BASE_COOLDOWN);
  });
});

describe('speed boots: what they leave alone', () => {
  it('keeps the force floor cooldown', () => {
    const cooldownOnForce = (boots: boolean): number => {
      const probe = new Probe(room({ force: true }));
      if (boots) probe.engine.getPlayer().boots.add(SPEED_ID);
      probe.step('E');
      return probe.step('E');
    };
    const plain = cooldownOnForce(false);
    expect(cooldownOnForce(true)).toBe(plain);
  });

  it('keeps the timing of a slide on ice', () => {
    const slide = (boots: boolean): string[] => {
      const probe = new Probe(room({ ice: true }));
      if (boots) probe.engine.getPlayer().boots.add(SPEED_ID);
      probe.step('E');
      probe.step('E');
      return probe.trace(OBSERVED_TICKS);
    };
    const plainTrace = slide(false);
    expect(new Set(plainTrace).size).toBeGreaterThan(1);
    expect(slide(true)).toEqual(plainTrace);
  });
});

describe('speed boots: undo', () => {
  it('puts the boots back on the floor and the cooldown back to normal', () => {
    const probe = new Probe(room({ boots: true }));
    probe.step('E');
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(true);
    expect(probe.engine.undo()).toBe(true);
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(false);
    expect(probe.engine.getItems()[PLAYER_ROW][BOOTS_X]).toBe(SPEED_ID);
    expect(probe.engine.getPlayer().moveCooldown).toBe(0);
    expect(playerHaste(probe.world())).toBe(1);
  });

  it('restores the boots and the hasted cooldown when a drop is undone', () => {
    const probe = new Probe(room({ boots: true }));
    probe.step('E');
    expect(probe.engine.dropItem(SPEED_ID)).toBe(true);
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(false);
    expect(probe.engine.undo()).toBe(true);
    expect(probe.engine.holdsItem(SPEED_ID)).toBe(true);
    expect(playerHaste(probe.world())).toBe(2);
    expect(probe.step('E')).toBe(HASTED_COOLDOWN);
  });
});

describe('speed boots: Epoxy only', () => {
  it('is named as an Epoxy-only tile, alone and in a level', () => {
    expect(isSpeedBootsTileId(SPEED_ID)).toBe(true);
    expect(isSpeedBootsTileId('boots_fire')).toBe(false);
    expect(isEpoxyOnlyTileId(SPEED_ID)).toBe(true);
    expect(hasEpoxyOnlyContent(room({ boots: true }))).toBe(true);
    expect(hasEpoxyOnlyContent(room())).toBe(false);
  });

  it('is unavailable under the Lynx rules in the editor, like the other Epoxy-only items', () => {
    expect(tileAvailability('lynx', SPEED_ID).available).toBe(false);
    // The palette gates only Lynx today (CC3D levels edit as Epoxy-engine data); the boots follow the slow-time charm.
    expect(tileAvailability('cc3d', SPEED_ID)).toEqual(tileAvailability('cc3d', SLOW_ID));
    expect(tileAvailability('epoxy', SPEED_ID).available).toBe(true);
  });

  it('makes a .DAT export refuse the level', () => {
    expect(datRefusalReason(room({ boots: true }))).toBe('epoxy_only_items');
  });
});

describe('speed boots: validator', () => {
  it('tracks the same boots, with the same bits, as before the speed boots existed', () => {
    const bits = (LevelValidator as unknown as { buildBootBits(): Map<string, number> }).buildBootBits();
    expect(bits).toEqual(EXPECTED_BOOT_BITS);
    expect(bits.has(SPEED_ID)).toBe(false);
  });
});
