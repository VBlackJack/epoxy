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
import {
  PACK_JSON_ID_SET_VERSIONS,
  PACK_JSON_MAX_VERSION,
  PACK_JSON_VERSION_V11,
  PACK_JSON_VERSION_V16,
  PACK_JSON_VERSION_V11_IDS,
  PACK_JSON_VERSION_V9
} from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import flipShowcase from '../../test/fixtures/flipShowcase.json';
import railShowcase from '../../test/fixtures/railShowcase.json';
import relayShowcase from '../../test/fixtures/relayShowcase.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { TOKEN_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { hasEpoxyOnlyContent, hasTokenContent, isEpoxyOnlyItemId, isTokenTileId } from '../RulesetFeatures';
import { idSetVersionOf } from '../signalLinks';
import type { CompiledLevel, Direction, LevelBlueprint } from '../types';

const TOKEN = TOKEN_ITEM_ID;
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const ROW = 5;
const PLAYER_START_X = 1;
const MAX_WAIT_TICKS = 40;
const BOOTS = 'boots_water';
const KEY = 'key_red';
const BOOT_THIEF = 'thief';
const KEY_THIEF = 'thief_keys';
const THIEF_X = 3;
const FORCE_X = 2;
const SEED_TOKEN_COUNT = 2;
const PACK_NOW = 8000;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'toll_token_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: PLAYER_START_X, y: ROW, dir: 'E' },
    terrain,
    items,
    entities: [],
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

function walkEast(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) step(engine, 'E');
}

function tokens(engine: GameEngine): number {
  return engine.getPlayer().keys[TOKEN] || 0;
}

/** An engine on a level with a thief on the row of the start, two cells ahead. */
function thiefRoom(thief: string): GameEngine {
  return load(room({ terrain: [[THIEF_X, ROW, thief]] }));
}

beforeEach(() => {
  loadTestConfigs();
});

describe('toll token: configuration', () => {
  it('is a counted item named in both languages, with its messages', () => {
    const tile = ConfigRegistry.getTile(TOKEN);
    expect(tile.collectible).toBe('token');
    expect(tile.layer).toBe('item');
    expect(tile.dropsAs).toBeUndefined();
    for (const locale of [en, fr] as unknown as Array<{
      tiles: Record<string, { name: string; desc: { label: string } }>;
      hud: { messages: Record<string, { label: string }> };
    }>) {
      expect(locale.tiles[TOKEN].name).toBeTruthy();
      expect(locale.tiles[TOKEN].desc.label).toBeTruthy();
      expect(locale.hud.messages.thief_paid.label).toBeTruthy();
      expect(locale.hud.messages.drop_token.label).toBeTruthy();
    }
    expect([en.tiles.toll_token.name, fr.tiles.toll_token.name]).toEqual(['Toll Token', 'Jeton de péage']);
  });

  it('is picked up into the key count and shown among the held items with its count', () => {
    const engine = load(room({ items: [[2, ROW, TOKEN], [3, ROW, TOKEN]] }));
    expect(engine.getHeldItems()).toEqual([]);
    expect(engine.getPlayer().keys[TOKEN]).toBeUndefined();
    walkEast(engine, 1);
    expect(tokens(engine)).toBe(1);
    expect(engine.getHeldItems()).toEqual([TOKEN]);
    expect(engine.holdsItem(TOKEN)).toBe(true);
    expect(engine.getItems()[ROW][2]).toBeNull();
    walkEast(engine, 1);
    expect(tokens(engine)).toBe(SEED_TOKEN_COUNT);
  });

  it('cannot be set down', () => {
    const engine = load(room());
    engine.getPlayer().keys[TOKEN] = 1;
    expect(engine.dropItem(TOKEN)).toBe(false);
    expect(tokens(engine)).toBe(1);
    expect(engine.getItems()[ROW][PLAYER_START_X]).toBeNull();
  });
});

describe('toll token: boot thief', () => {
  it('is spent instead of the boots', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[TOKEN] = 1;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
    expect(tokens(engine)).toBe(0);
    expect(Object.keys(engine.getPlayer().keys)).not.toContain(TOKEN);
  });

  it('is kept when the thief has nothing to take', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().keys[TOKEN] = 1;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(tokens(engine)).toBe(1);
  });

  it('takes the boots when no token is held', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().boots.size).toBe(0);
  });

  it('spends one token per visit, however many are held', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[TOKEN] = SEED_TOKEN_COUNT;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(tokens(engine)).toBe(SEED_TOKEN_COUNT - 1);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
  });

  it('picks the boots on the thief cell up first, then pays', () => {
    const engine = load(room({ terrain: [[THIEF_X, ROW, BOOT_THIEF]], items: [[THIEF_X, ROW, BOOTS]] }));
    engine.getPlayer().keys[TOKEN] = 1;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
    expect(tokens(engine)).toBe(0);
  });

  it('pays a thief a force floor carries the player into, as on foot', () => {
    const engine = load(room({ terrain: [[FORCE_X, ROW, 'force_e'], [THIEF_X, ROW, BOOT_THIEF]] }));
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[TOKEN] = 1;
    step(engine, 'E');
    for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().x < THIEF_X; i++) engine.tick();
    expect(engine.getPlayer().x).toBeGreaterThanOrEqual(THIEF_X);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
    expect(tokens(engine)).toBe(0);
  });
});

describe('toll token: key thief', () => {
  it('is spent and the keys stay', () => {
    const engine = thiefRoom(KEY_THIEF);
    engine.getPlayer().keys[KEY] = 2;
    engine.getPlayer().keys[TOKEN] = 1;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().keys[KEY]).toBe(2);
    expect(tokens(engine)).toBe(0);
  });

  it('takes the keys when no token is held', () => {
    const engine = thiefRoom(KEY_THIEF);
    engine.getPlayer().keys[KEY] = 2;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().keys[KEY]).toBeUndefined();
  });

  it('never takes tokens, and keeps them when it has no key to take', () => {
    const engine = thiefRoom(KEY_THIEF);
    engine.getPlayer().keys[TOKEN] = SEED_TOKEN_COUNT;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(tokens(engine)).toBe(SEED_TOKEN_COUNT);
  });

  it('spends one token per visit and keeps the rest', () => {
    const engine = thiefRoom(KEY_THIEF);
    engine.getPlayer().keys[KEY] = 1;
    engine.getPlayer().keys[TOKEN] = SEED_TOKEN_COUNT;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(engine.getPlayer().keys[KEY]).toBe(1);
    expect(tokens(engine)).toBe(SEED_TOKEN_COUNT - 1);
  });
});

describe('toll token: undo', () => {
  it('gives the token back, and paying again keeps the boots', () => {
    const engine = thiefRoom(BOOT_THIEF);
    engine.getPlayer().boots.add(BOOTS);
    engine.getPlayer().keys[TOKEN] = 1;
    walkEast(engine, THIEF_X - PLAYER_START_X);
    expect(tokens(engine)).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(tokens(engine)).toBe(1);
    expect(engine.getPlayer().x).toBe(THIEF_X - 1);
    walkEast(engine, 1);
    expect(tokens(engine)).toBe(0);
    expect(engine.getPlayer().boots.has(BOOTS)).toBe(true);
  });
});

describe('toll token: validator', () => {
  /** Boots on the floor, a thief, then water before the exit: only a player who keeps the boots can swim. */
  function boatCorridor(withToken: boolean): CompiledLevel {
    const terrain: Array<[number, number, string]> = [[8, ROW, 'exit'], [6, ROW, 'water'], [4, ROW, BOOT_THIEF]];
    for (let x = 1; x <= 8; x++) terrain.push([x, ROW - 1, 'wall'], [x, ROW + 1, 'wall']);
    const items: Array<[number, number, string]> = [[2, ROW, BOOTS]];
    if (withToken) items.push([3, ROW, TOKEN]);
    return room({ terrain, items });
  }

  it('reports the exit unreachable when the thief takes the boots and no token exists', () => {
    expect(LevelValidator.validate(boatCorridor(false)).stats.reachableExit).toBe(false);
  });

  it('never reports a false unreachable when a token is on the map', () => {
    expect(LevelValidator.validate(boatCorridor(true)).stats.reachableExit).toBe(true);
  });

  it('reports no false unreachable behind a key thief when a token is on the map', () => {
    const terrain: Array<[number, number, string]> = [[2, ROW, KEY_THIEF], [3, ROW, 'door_red'], [4, ROW, 'exit'], [1, ROW - 1, 'floor']];
    for (let x = 1; x <= 4; x++) terrain.push([x, ROW - 1, 'wall'], [x, ROW + 1, 'wall']);
    terrain.push([1, ROW - 1, 'floor']);
    const level = room({ terrain, items: [[1, ROW, KEY], [1, ROW - 1, TOKEN]] });
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(true);
  });
});

describe('toll token: Epoxy rules only', () => {
  it('counts as an Epoxy-only item, hidden from the Lynx palette and refused by the DAT export', () => {
    expect(isTokenTileId(TOKEN)).toBe(true);
    expect(isTokenTileId('chip')).toBe(false);
    expect(isEpoxyOnlyItemId(TOKEN)).toBe(true);
    const placed = room({ items: [[3, ROW, TOKEN]] });
    expect(hasTokenContent(placed)).toBe(true);
    expect(hasTokenContent(room())).toBe(false);
    expect(hasEpoxyOnlyContent(placed)).toBe(true);
    expect(tileAvailability('lynx', TOKEN).available).toBe(false);
    expect(tileAvailability('epoxy', TOKEN).available).toBe(true);
    expect(datRefusalReason(placed)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([placed, room()]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });
});

describe('toll token: pack format 11', () => {
  const bounds = (): ReturnType<typeof ConfigRegistry.getLevelSizeBounds> => ConfigRegistry.getLevelSizeBounds();
  const compile = (pack: unknown, index = 0): CompiledLevel =>
    ConfigRegistry.compileBlueprint((pack as { levels: LevelBlueprint[] }).levels[index]);
  const version = (levels: CompiledLevel[]): number => JSON.parse(serializePack('N', levels)).version;

  it('puts the token in the format 11 row and keeps the reading limit at or above 11', () => {
    expect([...PACK_JSON_VERSION_V11_IDS]).toContain(TOKEN);
    expect(PACK_JSON_ID_SET_VERSIONS.map((row) => row.version)).toContain(PACK_JSON_VERSION_V11);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V16);
    expect(idSetVersionOf(room({ items: [[3, ROW, TOKEN]] }))).toBe(PACK_JSON_VERSION_V11);
    expect(idSetVersionOf(room())).toBe(0);
  });

  it('writes a pack with a token as format 11 and reads it back', () => {
    const text = serializePack('Token', [room({ items: [[3, ROW, TOKEN]] })]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V11);
    const result = parsePackJson(text, bounds(), new Set<string>(), () => PACK_NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.levels[0].items[ROW][3]).toBe(TOKEN);
  });

  it('writes a pack with a flip link as format 11, even when the ids alone would say 9', () => {
    const flip = compile(flipShowcase);
    expect(version([flip])).toBe(PACK_JSON_VERSION_V11);
    const withRail: CompiledLevel = { ...flip, terrain: flip.terrain.map((row) => [...row]) };
    withRail.terrain[1][1] = 'rail_ew';
    expect(idSetVersionOf(withRail)).toBe(PACK_JSON_VERSION_V9);
    expect(version([withRail])).toBe(PACK_JSON_VERSION_V11);
  });

  it('keeps a rails-only pack at format 9 and writes a relay pack as format 11', () => {
    expect(version([compile(railShowcase)])).toBe(PACK_JSON_VERSION_V9);
    expect(version([compile(relayShowcase)])).toBe(PACK_JSON_VERSION_V11);
  });

  it('reads a format 11 file and refuses format 16', () => {
    const level = room({ items: [[3, ROW, TOKEN]] });
    const file = { format: JSON.parse(serializePack('N', [level])).format, name: 'x', levels: [level] };
    const read = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V11 }), bounds(), new Set<string>(), () => PACK_NOW);
    expect(read.ok).toBe(true);
    const refused = parsePackJson(JSON.stringify({ ...file, version: PACK_JSON_VERSION_V16 + 1 }), bounds(), new Set<string>(), () => PACK_NOW);
    expect(refused).toEqual({ ok: false, error: 'version' });
  });
});
