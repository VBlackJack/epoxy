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
import { findCharacterItemConfigErrors } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13, PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import { cc2TileInfo } from '../../formats/cc2TileTable';
import { ITEM_MAP } from '../../formats/cc2Mapping';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { tileAvailability } from '../../editor/paletteAvailability';
import { classifyCc2Level } from '../cc2/cc2Coverage';
import { BRIBE_ITEM_ID, STEEL_FOIL_ITEM_ID, TOGGLE_CLOCK_ITEM_ID, TOKEN_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { Pathfinder } from '../Pathfinder';
import { hasEpoxyOnlyContent, isEpoxyOnlyItemId } from '../RulesetFeatures';
import type { CompiledLevel, Direction, TileDefinition } from '../types';
import { canMonsterEnter } from './epoxyMonsters';

const SIZE = 13;
const ROW = 5;
const PLAYER_START_X = 1;
const TICKS_PER_SECOND = 20;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const FOIL = STEEL_FOIL_ITEM_ID;
const CLOCK = TOGGLE_CLOCK_ITEM_ID;
const BRIBE = BRIBE_ITEM_ID;
const TOKEN = TOKEN_ITEM_ID;
const BOOTS = 'boots_water';
const KEY = 'key_red';
const BOOT_THIEF = 'thief';
const KEY_THIEF = 'thief_keys';
const THIEF_X = 3;
const WALL_X = 3;
const CLOCK_X = 3;
const BLOCK_ID = 'dirt_block';
const BIG_COUNT = 3;
const CC2_CODE_CLOCK = 0x4d;
const CC2_CODE_FOIL = 0x8c;
const CC2_CODE_BRIBE = 0x8f;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  timeLimitSeconds?: number;
  entities?: CompiledLevel['entities'];
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'cc2_wave2_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: setup.timeLimitSeconds ?? TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: PLAYER_START_X, y: ROW, dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function tickSeconds(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) engine.tick();
}

const count = (engine: GameEngine, id: string): number => engine.getPlayer().keys[id] || 0;

beforeEach(() => {
  loadTestConfigs();
});

describe('wave 2 items: configuration', () => {
  it('defines the three items in both languages with their messages', () => {
    for (const id of [FOIL, CLOCK, BRIBE]) {
      expect(ConfigRegistry.getTile(id).layer).toBe('item');
      for (const locale of [en, fr] as unknown as Array<{
        tiles: Record<string, { name: string; desc: { label: string } }>;
      }>) {
        expect(locale.tiles[id].name, id).toBeTruthy();
        expect(locale.tiles[id].desc.label, id).toBeTruthy();
      }
    }
    expect(ConfigRegistry.getTile(FOIL).collectible).toBe('boot');
    expect(ConfigRegistry.getTile(BRIBE).collectible).toBe('token');
    expect(ConfigRegistry.getTile(CLOCK).collectible).toBeUndefined();
    for (const locale of [en, fr] as unknown as Array<{ hud: { messages: Record<string, { label: string }>; stats: Record<string, { label: string }> } }>) {
      for (const key of ['thief_bribed', 'timer_paused', 'timer_resumed']) expect(locale.hud.messages[key].label, key).toBeTruthy();
      expect(locale.hud.stats.time_paused.label).toBeTruthy();
    }
  });

  it('passes the configuration checks of the new fields', () => {
    expect(findCharacterItemConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
  });

  it('refuses a foil that would open a wall, name a missing tile or sit on a non-boot, and the item flags on terrain', () => {
    const tiles: Record<string, TileDefinition> = JSON.parse(JSON.stringify(ConfigRegistry.getTiles().tiles));
    tiles[FOIL].turnsWallsTo = { wall: 'floor', nowhere: 'steel_wall' };
    tiles[BRIBE].turnsWallsTo = { wall: 'steel_wall' };
    tiles.wall.togglesTimer = true;
    tiles.wall.blocksBlocks = true;
    const errors = findCharacterItemConfigErrors(tiles).join('\n');
    expect(errors).toContain(`${FOIL}.turnsWallsTo.wall: floor must be impassable`);
    expect(errors).toContain(`${FOIL}.turnsWallsTo.nowhere`);
    expect(errors).toContain(`${BRIBE}.turnsWallsTo: only boots`);
    expect(errors).toContain('wall.togglesTimer');
    expect(errors).toContain('wall.blocksBlocks');
  });

  it('counts the three as Epoxy-only items, out of the Lynx palette and refused by the DAT export', () => {
    for (const id of [FOIL, CLOCK, BRIBE]) {
      expect(isEpoxyOnlyItemId(id), id).toBe(true);
      expect(tileAvailability('lynx', id).available, id).toBe(false);
      expect(tileAvailability('epoxy', id).available, id).toBe(true);
      const placed = room({ items: [[CLOCK_X, ROW, id]] });
      expect(hasEpoxyOnlyContent(placed), id).toBe(true);
      expect(datRefusalReason(placed), id).toBe('epoxy_only_items');
    }
    const encoded = DatCodec.encodeLevelsWithReport([room({ items: [[CLOCK_X, ROW, FOIL]] }), room()]);
    expect(encoded.levelCount).toBe(1);
  });
});

describe('steel foil', () => {
  it('turns a bumped wall into a steel wall, without moving and without being used up', () => {
    const engine = load(room({ terrain: [[WALL_X, ROW, 'wall']] }));
    engine.getPlayer().boots.add(FOIL);
    expect(step(engine, 'E')).toBe(true);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[ROW][WALL_X]).toBe('steel_wall');
    expect(engine.getPlayer().x).toBe(WALL_X - 1);
    expect(engine.getPlayer().boots.has(FOIL)).toBe(true);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getTerrain()[ROW][WALL_X]).toBe('steel_wall');
  });

  it('does nothing without the foil, and leaves a steel wall, a door and the border alone', () => {
    const plain = load(room({ terrain: [[WALL_X, ROW, 'wall']] }));
    step(plain, 'E');
    step(plain, 'E');
    expect(plain.getTerrain()[ROW][WALL_X]).toBe('wall');
    const other = load(room({ terrain: [[WALL_X, ROW, 'steel_wall'], [WALL_X, ROW - 1, 'door_red']] }));
    other.getPlayer().boots.add(FOIL);
    step(other, 'E');
    step(other, 'E');
    expect(other.getTerrain()[ROW][WALL_X]).toBe('steel_wall');
    step(other, 'N');
    step(other, 'E');
    expect(other.getTerrain()[ROW - 1][WALL_X]).toBe('door_red');
  });

  it('is picked up as boots and taken by the boot thief, not by the key thief', () => {
    const engine = load(room({ items: [[2, ROW, FOIL]], terrain: [[WALL_X + 1, ROW, KEY_THIEF], [WALL_X + 3, ROW, BOOT_THIEF]] }));
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(FOIL)).toBe(true);
    expect(engine.getHeldItems()).toContain(FOIL);
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(FOIL)).toBe(true);
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getPlayer().boots.has(FOIL)).toBe(false);
  });

  it('is undone with the move that turned the wall', () => {
    const engine = load(room({ terrain: [[WALL_X, ROW, 'wall']] }));
    engine.getPlayer().boots.add(FOIL);
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getTerrain()[ROW][WALL_X]).toBe('steel_wall');
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()[ROW][WALL_X]).toBe('wall');
  });

  it('never makes a level unwinnable for the validator', () => {
    const level = room({
      terrain: [[WALL_X, ROW, 'wall'], [WALL_X + 2, ROW, 'exit']],
      items: [[2, ROW, FOIL]]
    });
    for (let y = 1; y < SIZE - 1; y++) if (y !== ROW) level.terrain[y][WALL_X] = 'wall';
    // The wall only opens by another way: the validator reads the foil as a no-op, so it must not report a way through.
    const withFoil = LevelValidator.validate(level).stats.reachableExit;
    level.items[ROW][2] = null;
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(withFoil);
  });
});

describe('toggle clock', () => {
  const clockRoom = (extra: Setup = {}): GameEngine => load(room({ items: [[CLOCK_X, ROW, CLOCK]], ...extra }));

  it('pauses the level timer when stepped on and resumes it the next time', () => {
    const engine = clockRoom();
    step(engine, 'E');
    expect(engine.isTimerPaused()).toBe(false);
    step(engine, 'E');
    expect(engine.getPlayer().x).toBe(CLOCK_X);
    expect(engine.isTimerPaused()).toBe(true);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.timer_paused');
    const before = engine.getTimeRemainingSeconds();
    tickSeconds(engine, 10);
    expect(engine.getTimeRemainingSeconds()).toBe(before);
    step(engine, 'W');
    step(engine, 'E');
    expect(engine.isTimerPaused()).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.timer_resumed');
    const after = engine.getTimeRemainingSeconds();
    tickSeconds(engine, 5);
    expect(engine.getTimeRemainingSeconds()).toBeLessThan(after);
  });

  it('stays on the map and is never held', () => {
    const engine = clockRoom();
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getItems()[ROW][CLOCK_X]).toBe(CLOCK);
    expect(engine.getHeldItems()).toEqual([]);
  });

  it('does nothing on a level without a time limit', () => {
    const engine = clockRoom({ timeLimitSeconds: 0 });
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.isTimerPaused()).toBe(false);
    expect(engine.getStatusBannerKey()).toBeNull();
  });

  it('does not let the paused time run out the level', () => {
    const engine = clockRoom({ timeLimitSeconds: 3 });
    step(engine, 'E');
    step(engine, 'E');
    tickSeconds(engine, 30);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getTimeRemainingSeconds()).toBeGreaterThan(0);
  });

  it('keeps monsters and blocks out of its cell', () => {
    const engine = load(
      room({
        items: [[CLOCK_X, ROW, CLOCK]],
        entities: [
          { x: CLOCK_X + 1, y: ROW, type: 'bug', dir: 'W' },
          { x: CLOCK_X - 1, y: ROW + 2, type: BLOCK_ID, dir: 'E' }
        ]
      })
    );
    const world = (engine as unknown as { w: Parameters<typeof canMonsterEnter>[0] }).w;
    const bug = engine.getEntities().find((e) => e.type === 'bug');
    expect(bug).toBeDefined();
    if (bug) expect(canMonsterEnter(world, bug, 'W')).toBe(false);
    // A block in line with the clock cannot be pushed onto it.
    const pushed = load(room({ items: [[CLOCK_X, ROW, CLOCK]], entities: [{ x: CLOCK_X - 1, y: ROW, type: BLOCK_ID, dir: 'E' }] }));
    pushed.getPlayer().x = CLOCK_X - 2;
    expect(step(pushed, 'E')).toBe(false);
    expect(pushed.getEntities().find((e) => e.type === BLOCK_ID)?.x).toBe(CLOCK_X - 1);
  });

  it('puts the paused state back on undo', () => {
    const engine = clockRoom();
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.isTimerPaused()).toBe(true);
    tickSeconds(engine, 2);
    expect(engine.undo()).toBe(true);
    expect(engine.isTimerPaused()).toBe(false);
    step(engine, 'E');
    expect(engine.isTimerPaused()).toBe(true);
  });

  it('adds nothing to the state of a level without a toggle clock', () => {
    const plain = load(room());
    expect(plain.isTimerPaused()).toBeUndefined();
    expect(plain.getRuntimeKeyExtra()).toBe('');
    const withClock = clockRoom();
    expect(withClock.getRuntimeKeyExtra()).toContain('tm0');
    step(withClock, 'E');
    step(withClock, 'E');
    expect(withClock.getRuntimeKeyExtra()).toContain('tm1');
  });
});

describe('bribe', () => {
  const thiefRoom = (thief: string): GameEngine => load(room({ terrain: [[THIEF_X, ROW, thief]] }));
  const toThief = (engine: GameEngine): void => {
    for (let i = PLAYER_START_X; i < THIEF_X; i++) step(engine, 'E');
  };

  it('is picked up as a counted item that cannot be set down', () => {
    const engine = load(room({ items: [[2, ROW, BRIBE], [4, ROW, BRIBE]] }));
    step(engine, 'E');
    expect(count(engine, BRIBE)).toBe(1);
    expect(engine.getHeldItems()).toEqual([BRIBE]);
    expect(engine.dropItem(BRIBE)).toBe(false);
    expect(count(engine, BRIBE)).toBe(1);
  });

  it('says a bribe cannot be set down, not a toll token', () => {
    const engine = load(room());
    engine.getPlayer().keys[BRIBE] = 1;
    expect(engine.dropItem(BRIBE)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_bribe');
    engine.getPlayer().keys[TOKEN] = 1;
    engine.dropItem(TOKEN);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_token');
    for (const locale of [en, fr] as unknown as Array<{ hud: { messages: Record<string, { label: string }> } }>) {
      expect(locale.hud.messages.drop_bribe.label).toBeTruthy();
    }
  });

  it('is spent instead of the boots at the boot thief', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[BRIBE] = 1;
    toThief(engine);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
    expect(count(engine, BRIBE)).toBe(0);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_bribed');
  });

  it('is spent instead of the keys at the key thief', () => {
    const engine = thiefRoom(KEY_THIEF);
    engine.getPlayer().keys[KEY] = 2;
    engine.getPlayer().keys[BRIBE] = 1;
    toThief(engine);
    expect(count(engine, KEY)).toBe(2);
    expect(count(engine, BRIBE)).toBe(0);
  });

  it('is spent even when the thief had nothing to take, one per visit', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().keys[BRIBE] = BIG_COUNT;
    toThief(engine);
    expect(count(engine, BRIBE)).toBe(BIG_COUNT - 1);
  });

  it('is spent before a toll token, which stays for the next thief', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[BRIBE] = 1;
    engine.getPlayer().keys[TOKEN] = 1;
    toThief(engine);
    expect(count(engine, BRIBE)).toBe(0);
    expect(count(engine, TOKEN)).toBe(1);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
  });

  it('is never taken by the key thief, and the boots are lost without one', () => {
    const keys = thiefRoom(KEY_THIEF);
    keys.getPlayer().keys[KEY] = 1;
    keys.getPlayer().keys[BRIBE] = 0;
    toThief(keys);
    expect(count(keys, KEY)).toBe(0);
    const boots = thiefRoom(BOOT_THIEF);
    boots.getPlayer().boots.add(BOOTS);
    toThief(boots);
    expect(boots.getPlayer().boots.size).toBe(0);
  });

  it('is given back on undo', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[BRIBE] = 1;
    toThief(engine);
    expect(engine.undo()).toBe(true);
    expect(count(engine, BRIBE)).toBe(1);
  });

  it('is read by the validator and the planner as paying a thief', () => {
    const corridor = (withBribe: boolean): CompiledLevel => {
      const terrain: Array<[number, number, string]> = [[8, ROW, 'exit'], [6, ROW, 'water'], [4, ROW, BOOT_THIEF]];
      for (let x = 1; x <= 8; x++) terrain.push([x, ROW - 1, 'wall'], [x, ROW + 1, 'wall']);
      const items: Array<[number, number, string]> = [[2, ROW, BOOTS]];
      if (withBribe) items.push([3, ROW, BRIBE]);
      return room({ terrain, items });
    };
    expect(LevelValidator.validate(corridor(false)).stats.reachableExit).toBe(false);
    expect(LevelValidator.validate(corridor(true)).stats.reachableExit).toBe(true);
    const engine = load(corridor(false));
    engine.getPlayer().boots.add(BOOTS);
    expect(Pathfinder.findPath(engine, 8, ROW).moves).toEqual([]);
    engine.getPlayer().keys[BRIBE] = 1;
    expect(Pathfinder.findPath(engine, 8, ROW).moves.length).toBeGreaterThan(0);
  });
});

describe('wave 2 items: pack format 13', () => {
  const versionOf = (level: CompiledLevel): number => (JSON.parse(serializePack('N', [level])) as { version: number }).version;

  it('lists the three ids in the format 13 row and writes a pack that holds one as format 13', () => {
    for (const id of [FOIL, CLOCK, BRIBE]) {
      expect(PACK_JSON_VERSION_V13_IDS.has(id), id).toBe(true);
      expect(versionOf(room({ items: [[CLOCK_X, ROW, id]] })), id).toBe(PACK_JSON_VERSION_V13);
    }
    expect(versionOf(room())).toBeLessThan(PACK_JSON_VERSION_V13);
  });

  it('reads the pack back with its items', () => {
    const text = serializePack('Wave 2', [room({ items: [[2, ROW, FOIL], [3, ROW, CLOCK], [4, ROW, BRIBE]] })]);
    const read = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.levels[0].items[ROW].slice(2, 5)).toEqual([FOIL, CLOCK, BRIBE]);
  });
});

describe('wave 2 items: CC2 import', () => {
  it('maps the three CC2 item codes to the Epoxy ids', () => {
    expect(cc2TileInfo(CC2_CODE_FOIL)?.name).toBe('Steel Foil');
    expect(cc2TileInfo(CC2_CODE_CLOCK)).toBeDefined();
    expect(cc2TileInfo(CC2_CODE_BRIBE)?.name).toBe('Bribe');
    expect(ITEM_MAP.get(CC2_CODE_FOIL)).toMatchObject({ id: FOIL, key: 'steel_foil' });
    expect(ITEM_MAP.get(CC2_CODE_CLOCK)).toMatchObject({ id: CLOCK, key: 'toggle_clock' });
    expect(ITEM_MAP.get(CC2_CODE_BRIBE)).toMatchObject({ id: BRIBE, key: 'bribe' });
  });

  it('classifies the bribe and the foil as exact and the clock as approximate', () => {
    expect(classifyCc2Level(['bribe']).verdict).toBe('exact');
    expect(classifyCc2Level(['steel_foil']).verdict).toBe('exact');
    expect(classifyCc2Level(['toggle_clock']).verdict).toBe('approx');
    expect(classifyCc2Level(['steel_foil', 'toggle_clock']).approx).toEqual(['toggle_clock']);
  });
});
