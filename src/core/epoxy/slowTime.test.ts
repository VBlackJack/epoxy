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
import { findSlowTimeConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { monsterSlowdown } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';

const SIZE = 11;
const SLOW_ID = 'slow_time';
const MONSTER_TYPE = 'pink_ball';
/** The monster of these tests (interval 5) moves every interval + 1 ticks. */
const NORMAL_PERIOD = 6;
const SLOW_PERIOD = 12;
const OBSERVED_TICKS = 120;
const MIN_GAPS_OBSERVED = 3;
const PLAYER_ROW = 5;
const PLAYER_START_X = 2;
const CHARM_X = 3;
const THIEF_X = 4;
const MONSTER_ROW = 2;
const MONSTER_START_X = 3;
const CLONER_CELL = 8;
const TIME_LIMIT_SECONDS = 100;
/** Upper bound of ticks the player cooldown can need. */
const MAX_WAIT_TICKS = 30;
/** Boots the validator tracks, with the bit each gets (sorted by id): the same as before the charm existed. */
const EXPECTED_BOOT_BITS = new Map([
  ['boots_fire', 1],
  ['boots_force', 2],
  ['boots_ice', 4],
  ['boots_water', 8]
]);

interface Setup {
  charm?: boolean;
  thief?: boolean;
  ice?: boolean;
  entities?: EntityPlacement[];
}

/** Walled floor room, the player at (2, 5), a ball on row 2, optionally a charm at (3, 5) and a thief at (4, 5). */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  if (setup.charm) items[PLAYER_ROW][CHARM_X] = SLOW_ID;
  if (setup.thief) terrain[PLAYER_ROW][THIEF_X] = 'thief';
  if (setup.ice) for (let x = THIEF_X; x < SIZE - 1; x++) terrain[PLAYER_ROW][x] = 'ice';
  return {
    id: 'slow_time_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: PLAYER_START_X, y: PLAYER_ROW, dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [{ type: MONSTER_TYPE, x: MONSTER_START_X, y: MONSTER_ROW, dir: 'E' }],
    trapLinks: [],
    cloneLinks: []
  };
}

/** An engine plus a log of the ticks at which its first monster changed cell. */
class Probe {
  public readonly engine = new GameEngine();
  public readonly moves: number[] = [];
  private tickCount = 0;

  public constructor(level: CompiledLevel) {
    this.engine.loadLevel(level);
  }

  /** The engine world, for the pure helpers that read it. */
  public world(): EpoxyWorld {
    return (this.engine as unknown as { w: EpoxyWorld }).w;
  }

  private monsterCell(): string {
    const monster = this.engine.getEntities().find((e) => e.kind === 'monster');
    return monster ? `${monster.x},${monster.y}` : '';
  }

  public run(count: number): void {
    for (let i = 0; i < count; i++) {
      const before = this.monsterCell();
      this.engine.tick();
      this.tickCount++;
      if (this.monsterCell() !== before) this.moves.push(this.tickCount);
    }
  }

  /** Runs until the player may move, then moves; returns the ticks waited. */
  public step(dir: Direction): number {
    for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
      if (this.engine.attemptPlayerMove(dir)) return waited;
      this.run(1);
    }
    throw new Error('the player never became able to move');
  }

  /** Distances between consecutive monster moves, from the move at index `from` on. */
  public gapsFrom(from: number): number[] {
    const seen = this.moves.slice(from);
    return seen.slice(1).map((t, i) => t - seen[i]);
  }
}

beforeEach(() => {
  loadTestConfigs();
});

describe('slow-time charm: configuration', () => {
  it('is a collectible boot that slows monsters twice', () => {
    const def = ConfigRegistry.getTile(SLOW_ID);
    expect(def.collectible).toBe('boot');
    expect(def.slowsMonsters).toBe(2);
    expect(def.laserTransparent).toBe(true);
  });

  it('refuses a factor outside 2 to 4, a fraction, and a carrier that is not a boot', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    expect(findSlowTimeConfigErrors(tiles)).toEqual([]);
    const withFactor = (factor: number): string[] =>
      findSlowTimeConfigErrors({ ...tiles, [SLOW_ID]: { ...tiles[SLOW_ID], slowsMonsters: factor } });
    expect(withFactor(1)).toHaveLength(1);
    expect(withFactor(5)).toHaveLength(1);
    expect(withFactor(2.5)).toHaveLength(1);
    expect(withFactor(4)).toEqual([]);
    const notBoot = { ...tiles.score_10, slowsMonsters: 2 };
    expect(findSlowTimeConfigErrors({ ...tiles, score_10: notBoot })).toHaveLength(1);
  });
});

describe('slow-time charm: monster speed', () => {
  it('leaves a monster at one move every interval + 1 ticks without the charm', () => {
    const probe = new Probe(room());
    probe.run(OBSERVED_TICKS);
    expect(probe.moves[0]).toBe(NORMAL_PERIOD);
    expect(new Set(probe.gapsFrom(0))).toEqual(new Set([NORMAL_PERIOD]));
    expect(monsterSlowdown(probe.world())).toBe(1);
  });

  it('doubles the monster step once the charm is picked up', () => {
    const probe = new Probe(room({ charm: true }));
    probe.step('E');
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(true);
    const pickedAt = probe.moves.length;
    probe.run(OBSERVED_TICKS);
    // The step already counting down ends at the old pace; every step loaded afterwards is twice as long.
    const gaps = probe.gapsFrom(pickedAt);
    expect(gaps.length).toBeGreaterThan(MIN_GAPS_OBSERVED);
    expect(new Set(gaps.slice(1))).toEqual(new Set([SLOW_PERIOD]));
  });

  it('keeps the first step of a monster at the normal pace: level load is unchanged', () => {
    const probe = new Probe(room());
    probe.engine.getPlayer().boots.add(SLOW_ID);
    probe.run(OBSERVED_TICKS);
    expect(probe.moves[0]).toBe(NORMAL_PERIOD);
    expect(new Set(probe.gapsFrom(0))).toEqual(new Set([SLOW_PERIOD]));
  });

  it('returns to the normal pace after the charm is dropped', () => {
    const probe = new Probe(room({ charm: true }));
    probe.step('E');
    probe.run(OBSERVED_TICKS / 2);
    expect(probe.engine.dropItem(SLOW_ID)).toBe(true);
    const droppedAt = probe.moves.length;
    probe.run(OBSERVED_TICKS);
    const gaps = probe.gapsFrom(droppedAt);
    expect(gaps.length).toBeGreaterThan(MIN_GAPS_OBSERVED);
    expect(new Set(gaps.slice(1))).toEqual(new Set([NORMAL_PERIOD]));
  });

  it('returns to the normal pace after a thief steals the charm', () => {
    const probe = new Probe(room({ charm: true, thief: true }));
    probe.step('E');
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(true);
    probe.run(OBSERVED_TICKS / 2);
    probe.step('E');
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(false);
    const stolenAt = probe.moves.length;
    probe.run(OBSERVED_TICKS);
    const gaps = probe.gapsFrom(stolenAt);
    expect(gaps.length).toBeGreaterThan(MIN_GAPS_OBSERVED);
    expect(new Set(gaps.slice(1))).toEqual(new Set([NORMAL_PERIOD]));
  });

  it('slows every monster, not only the first', () => {
    const entities: EntityPlacement[] = [
      { type: MONSTER_TYPE, x: MONSTER_START_X, y: MONSTER_ROW, dir: 'E' },
      { type: MONSTER_TYPE, x: MONSTER_START_X, y: MONSTER_ROW + 1, dir: 'E' }
    ];
    const probe = new Probe(room({ entities }));
    probe.engine.getPlayer().boots.add(SLOW_ID);
    const cells = (): string[] => probe.engine.getEntities().map((e) => `${e.x},${e.y}`);
    const start = cells();
    probe.run(NORMAL_PERIOD);
    expect(cells()).not.toEqual(start);
    const afterFirstMove = cells();
    probe.run(SLOW_PERIOD - 1);
    expect(cells()).toEqual(afterFirstMove);
    probe.run(1);
    expect(cells()).not.toEqual(afterFirstMove);
  });

  it('takes the largest factor among held boots, and ignores boots that do not slow', () => {
    const probe = new Probe(room());
    expect(monsterSlowdown(probe.world())).toBe(1);
    probe.engine.getPlayer().boots.add('boots_water');
    expect(monsterSlowdown(probe.world())).toBe(1);
    probe.engine.getPlayer().boots.add(SLOW_ID);
    expect(monsterSlowdown(probe.world())).toBe(2);
  });
});

describe('slow-time charm: what it leaves alone', () => {
  it('keeps the player cooldown and the timer', () => {
    const plain = new Probe(room());
    const charmed = new Probe(room());
    charmed.engine.getPlayer().boots.add(SLOW_ID);
    expect(charmed.step('E')).toBe(plain.step('E'));
    expect(charmed.step('E')).toBe(plain.step('E'));
    plain.run(OBSERVED_TICKS);
    charmed.run(OBSERVED_TICKS);
    expect(charmed.engine.getTimeRemainingSeconds()).toBe(plain.engine.getTimeRemainingSeconds());
    expect(charmed.engine.getPlayer().x).toBe(plain.engine.getPlayer().x);
  });

  it('keeps the pace of a sliding block', () => {
    const glide = (charm: boolean): string[] => {
      const level = room({ ice: true, entities: [{ type: 'ice_block', x: CHARM_X, y: PLAYER_ROW, dir: 'E' }] });
      const probe = new Probe(level);
      if (charm) probe.engine.getPlayer().boots.add(SLOW_ID);
      probe.step('E');
      const trace: string[] = [];
      for (let i = 0; i < OBSERVED_TICKS; i++) {
        probe.run(1);
        const block = probe.engine.getEntities().find((e) => e.kind === 'block');
        trace.push(block ? `${block.x},${block.y}` : 'gone');
      }
      return trace;
    };
    const plainTrace = glide(false);
    expect(new Set(plainTrace).size).toBeGreaterThan(2);
    expect(glide(true)).toEqual(plainTrace);
  });

  it('spawns a clone with the normal cooldown while the charm is held', () => {
    const level = room({ entities: [{ type: MONSTER_TYPE, x: CLONER_CELL, y: CLONER_CELL, dir: 'E' }] });
    level.terrain[PLAYER_ROW][CHARM_X] = 'button_red';
    level.terrain[CLONER_CELL][CLONER_CELL] = 'clone_machine';
    level.cloneLinks = [
      { buttonX: CHARM_X, buttonY: PLAYER_ROW, clonerX: CLONER_CELL, clonerY: CLONER_CELL, templateType: MONSTER_TYPE, templateDir: 'E' }
    ];
    const probe = new Probe(level);
    probe.engine.getPlayer().boots.add(SLOW_ID);
    probe.step('E');
    const clone = probe.engine.getEntities().find((e) => e.kind === 'monster' && e.x === CLONER_CELL + 1 && e.y === CLONER_CELL);
    expect(clone).toBeDefined();
    expect(clone?.cooldownTicks).toBe(ConfigRegistry.getEntityDef(MONSTER_TYPE)?.moveIntervalTicks);
  });
});

describe('slow-time charm: undo', () => {
  it('puts the charm back on the floor and the monsters back to the normal pace', () => {
    const probe = new Probe(room({ charm: true }));
    probe.step('E');
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(true);
    expect(probe.engine.getItems()[PLAYER_ROW][CHARM_X]).toBeNull();
    expect(probe.engine.undo()).toBe(true);
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(false);
    expect(probe.engine.getItems()[PLAYER_ROW][CHARM_X]).toBe(SLOW_ID);
    const undoneAt = probe.moves.length;
    probe.run(OBSERVED_TICKS);
    expect(new Set(probe.gapsFrom(undoneAt))).toEqual(new Set([NORMAL_PERIOD]));
  });

  it('restores the charm when a drop is undone', () => {
    const probe = new Probe(room({ charm: true }));
    probe.step('E');
    expect(probe.engine.dropItem(SLOW_ID)).toBe(true);
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(false);
    expect(probe.engine.undo()).toBe(true);
    expect(probe.engine.holdsItem(SLOW_ID)).toBe(true);
  });
});

describe('slow-time charm: validator', () => {
  it('tracks the same boots, with the same bits, as before the charm existed', () => {
    const bits = (LevelValidator as unknown as { buildBootBits(): Map<string, number> }).buildBootBits();
    expect(bits).toEqual(EXPECTED_BOOT_BITS);
    expect(bits.has(SLOW_ID)).toBe(false);
  });

  it('accepts a level that holds the charm', () => {
    const level = room({ charm: true, entities: [] });
    level.terrain[PLAYER_ROW][SIZE - 2] = 'exit';
    const report = LevelValidator.validate(level);
    expect(report.valid).toBe(true);
  });
});