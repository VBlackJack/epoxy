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

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import {
  PACK_JSON_ID_SET_VERSIONS,
  PACK_JSON_VERSION_V10,
  PACK_JSON_VERSION_V10_IDS,
  PACK_JSON_VERSION_V9
} from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import { parseSegment } from '../../generator/CampaignRoute';
import {
  decodeActions,
  DROP_ACTION_ITEMS,
  DROP_STONE_ACTION,
  encodeActions,
  isDropAction,
  PieceSolver,
  WAIT_ACTION
} from '../../generator/PieceSolver';
import { storedSolutionWins, timedSolution } from '../../generator/SolutionReplay';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { collectDueMoves } from '../../ui/replaySchedule';
import { STONE_DEATH_REASON_KEY, STONE_ITEM_ID } from '../coreConstants';
import { engineSimulationHash } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { featuresFor, hasEpoxyOnlyContent, isEpoxyOnlyItemId, isStoneTileId } from '../RulesetFeatures';
import { idSetVersionOf } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, Shot } from '../types';
import { shotsStateKey } from './epoxyShots';

const STONE = STONE_ITEM_ID;
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const PLAYER_START = { x: 2, y: 5 };
const MAX_WAIT_TICKS = 40;
/** Ticks that let a stone cross the whole room several times over. */
const FLIGHT_TICKS = 30;
const SCRIPT_REPEATS = 2;
const BLOCK_ID = 'dirt_block';
const ICE_BLOCK_ID = 'ice_block';
const MONSTER_ID = 'pink_ball';
const SLASH_MIRROR = 'mirror_slash';
const BACKSLASH_MIRROR = 'mirror_backslash';
/** Solution of the bomb corridor: pick the stone up, throw it at the bomb, wait for it to go off, walk to the exit. */
const CORRIDOR_SOLUTION = 'ET.EEEEEEE';
/** The same walk with the throw left out. */
const CORRIDOR_SOLUTION_WITHOUT_THROW = 'E.EEEEEEE';
const STORED_SOLUTION_LIMIT_TICKS = 5000;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  solution?: string;
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'hurl_stone_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? PLAYER_START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.solution === undefined ? {} : { solution: setup.solution })
  };
}

/** A room that holds a stone far from the player, so the level has shots from the start. */
function stoneRoom(setup: Setup = {}): CompiledLevel {
  return room({ ...setup, items: [[11, 11, STONE], ...(setup.items ?? [])] });
}

/**
 * A corridor along row 5 from the player to the exit, shut in by walls above and below. A stone lies one cell ahead of
 * the start and a bomb stands in the corridor beyond it.
 */
function bombCorridor(options: { stone?: boolean; stoneBehindBomb?: boolean; solution?: string } = {}): CompiledLevel {
  const terrain: Array<[number, number, string]> = [[10, 5, 'exit']];
  for (let x = 1; x <= 11; x++) {
    terrain.push([x, 4, 'wall'], [x, 6, 'wall']);
  }
  const items: Array<[number, number, string]> = [[6, 5, 'bomb']];
  if (options.stone !== false) items.push([options.stoneBehindBomb === true ? 8 : 3, 5, STONE]);
  return room({ terrain, items, ...(options.solution === undefined ? {} : { solution: options.solution }) });
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

function hold(engine: GameEngine, count = 1): void {
  engine.getPlayer().keys[STONE] = count;
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function entityTypes(engine: GameEngine): string[] {
  return engine.getEntities().map((entity) => entity.type);
}

function itemCount(engine: GameEngine, id: string): number {
  return engine.getItems().flat().filter((item) => item === id).length;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('hurl stone: configuration', () => {
  it('is a carried item the player throws, named in both languages', () => {
    const tile = ConfigRegistry.getTile(STONE);
    expect(tile.collectible).toBe('stone');
    expect(tile.layer).toBe('item');
    expect(tile.laserTransparent).toBe(true);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      expect(locale.tiles[STONE].name).toBeTruthy();
      expect(locale.tiles[STONE].desc.label).toBeTruthy();
    }
    expect([en.tiles.hurl_stone.name, fr.tiles.hurl_stone.name]).toEqual(['Hurl Stone', 'Pierre de jet']);
  });

  it('has its messages and its phone strip label in both languages, and a pace of at least one tick', () => {
    for (const locale of [en, fr] as unknown as Array<{
      hud: { messages: Record<string, { label: string }>; touch_overlay: Record<string, { action?: string }> };
    }>) {
      for (const key of ['death_stone', 'throw_busy', 'throw_blocked']) expect(locale.hud.messages[key].label, key).toBeTruthy();
      expect(locale.hud.touch_overlay.stone.action).toBeTruthy();
    }
    expect(STONE_DEATH_REASON_KEY).toBe('hud.messages.death_stone');
    expect(Number.isInteger(ConfigRegistry.getGame().timing.hurlStepTicks)).toBe(true);
    expect(ConfigRegistry.getGame().timing.hurlStepTicks).toBeGreaterThanOrEqual(1);
  });

  it('puts a phone strip button after the gate button, labelled by a key both languages define', () => {
    const page = readFileSync('index.html', 'utf8');
    const button = /<button id="touch-btn-stone"[^>]*>/.exec(page)?.[0] ?? '';
    expect(button).toContain('data-i18n-aria-label="hud.touch_overlay.stone.action"');
    expect(button).toContain('data-i18n-title="hud.touch_overlay.stone.action"');
    expect(page.indexOf('touch-btn-stone')).toBeGreaterThan(page.indexOf('touch-btn-gate'));
    expect(page.indexOf('touch-btn-stone')).toBeLessThan(page.indexOf('touch-btn-menu'));
  });
});

describe('hurl stone: pickup and state', () => {
  it('is picked up into the inventory as a count and listed among the held items', () => {
    const engine = load(room({ items: [[3, 5, STONE], [4, 5, STONE]] }));
    expect(engine.getHeldItems()).not.toContain(STONE);
    step(engine, 'E');
    expect(engine.getItems()[5][3]).toBeNull();
    expect(engine.getPlayer().keys[STONE]).toBe(1);
    expect(engine.getHeldItems()).toContain(STONE);
    step(engine, 'E');
    expect(engine.getPlayer().keys[STONE]).toBe(2);
  });

  it('exposes shots only on a level with a launcher or a stone', () => {
    expect(load(room()).getShots()).toBeUndefined();
    expect(load(stoneRoom()).getShots()).toEqual([]);
    expect(load(room({ terrain: [[8, 8, 'shot_launcher_e']] })).getShots()).toEqual([]);
  });

  it('keeps the state key of a launcher shot as it was and adds the payload only to a stone', () => {
    const launcherShot: Shot = { x: 3, y: 2, dir: 'E', cooldown: 1 };
    expect(shotsStateKey([launcherShot])).toBe('S3,2,E,1');
    expect(shotsStateKey([{ ...launcherShot, payload: 'hurl_stone' }])).toBe('S3,2,E,1,hurl_stone');
    expect(shotsStateKey([])).toBe('');
    expect(shotsStateKey(undefined)).toBe('');
  });

  it('turns the aids off on a stone level only', () => {
    expect(featuresFor(stoneRoom()).blockHint).toBe(false);
    expect(featuresFor(stoneRoom()).deadEndWatch).toBe(false);
    expect(featuresFor(room()).deadEndWatch).toBe(true);
  });
});

describe('hurl stone: throwing', () => {
  it('kills a monster in the cell ahead at once and is used up', () => {
    const engine = load(stoneRoom({ entities: [{ type: MONSTER_ID, x: 3, y: 5, dir: 'E' }] }));
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(entityTypes(engine)).not.toContain(MONSTER_ID);
    expect(engine.getPlayer().keys[STONE]).toBeUndefined();
    expect(engine.getShots()).toEqual([]);
  });

  it('kills the first monster on its flight and leaves the others', () => {
    const engine = load(
      stoneRoom({
        entities: [
          { type: MONSTER_ID, x: 7, y: 2, dir: 'N' },
          { type: MONSTER_ID, x: 8, y: 5, dir: 'N' }
        ]
      })
    );
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(engine.getShots()).toHaveLength(1);
    expect(engine.getShots()?.[0].payload).toBe('hurl_stone');
    tickN(engine, FLIGHT_TICKS);
    expect(entityTypes(engine).filter((type) => type === MONSTER_ID)).toHaveLength(1);
    expect(engine.getShots()).toEqual([]);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('sets off a bomb ahead: both are gone', () => {
    const engine = load(stoneRoom({ items: [[6, 5, 'bomb']] }));
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, FLIGHT_TICKS);
    expect(itemCount(engine, 'bomb')).toBe(0);
    expect(engine.getShots()).toEqual([]);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('melts an ice block in its way', () => {
    const engine = load(stoneRoom({ entities: [{ type: ICE_BLOCK_ID, x: 6, y: 5, dir: 'E' }] }));
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, FLIGHT_TICKS);
    expect(entityTypes(engine)).not.toContain(ICE_BLOCK_ID);
  });

  it('is lost when it stops against a wall: it does not drop back as an item', () => {
    const engine = load(stoneRoom({ terrain: [[7, 5, 'wall']] }));
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(engine.getShots()).toHaveLength(1);
    tickN(engine, FLIGHT_TICKS);
    expect(engine.getShots()).toEqual([]);
    expect(engine.getPlayer().keys[STONE]).toBeUndefined();
    // The only stone left on the map is the one that was never picked up.
    expect(itemCount(engine, STONE)).toBe(1);
    expect(engine.getItems()[5].includes(STONE)).toBe(false);
  });

  it('throws one stone at a time from a count', () => {
    const engine = load(stoneRoom());
    hold(engine, 2);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(engine.getPlayer().keys[STONE]).toBe(1);
    tickN(engine, FLIGHT_TICKS);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(engine.getPlayer().keys[STONE]).toBeUndefined();
  });

  it('crosses one cell per hurlStepTicks', () => {
    const stepTicks = ConfigRegistry.getGame().timing.hurlStepTicks;
    const engine = load(stoneRoom());
    hold(engine);
    engine.dropItem(STONE);
    const startX = engine.getShots()?.[0].x as number;
    tickN(engine, stepTicks * 2);
    expect((engine.getShots()?.[0].x as number) - startX).toBe(2);
  });

  it('is turned by a mirror and flies on', () => {
    const engine = load(stoneRoom({ entities: [{ type: SLASH_MIRROR, x: 5, y: 5, dir: 'N' }] }));
    hold(engine);
    engine.dropItem(STONE);
    tickN(engine, ConfigRegistry.getGame().timing.hurlStepTicks * 4);
    const shot = engine.getShots()?.[0];
    expect(shot?.dir).toBe('N');
    expect(shot?.x).toBe(5);
    expect(shot?.y).toBeLessThan(5);
  });

  it('kills the player, with its own message, when mirrors send it back', () => {
    // East to the mirror at (4,5), north to (4,3), west to (2,3), then south along column 2 back to the player.
    const engine = load(
      stoneRoom({
        entities: [
          { type: SLASH_MIRROR, x: 4, y: 5, dir: 'N' },
          { type: BACKSLASH_MIRROR, x: 4, y: 3, dir: 'N' },
          { type: SLASH_MIRROR, x: 2, y: 3, dir: 'N' }
        ]
      })
    );
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    tickN(engine, FLIGHT_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe(STONE_DEATH_REASON_KEY);
  });
});

describe('hurl stone: stone and launcher shot together', () => {
  it('refuses a step into the stone just thrown: the player lives and the stone flies on', () => {
    const engine = load(stoneRoom());
    hold(engine);
    expect(engine.dropItem(STONE)).toBe(true);
    const startX = engine.getShots()?.[0].x as number;
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().x).toBe(PLAYER_START.x);
    tickN(engine, 2);
    expect(engine.getShots()?.[0].x).toBeGreaterThan(startX);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('paces each shot by its own step, keeps the order, and round-trips the state key through undo', () => {
    const engine = load(stoneRoom({ terrain: [[1, 8, 'shot_launcher_e']] }));
    const world = (engine as unknown as { w: { shots: Shot[]; shotStepTicks: number } }).w;
    const launcherStep = world.shotStepTicks;
    expect(launcherStep).toBeGreaterThan(ConfigRegistry.getGame().timing.hurlStepTicks);
    hold(engine);
    world.shots.push({ x: 3, y: 8, dir: 'E', cooldown: launcherStep - 1 });
    engine.dropItem(STONE);
    expect(engine.getShots()?.map((s) => s.payload)).toEqual([undefined, 'hurl_stone']);
    const stoneStart = engine.getShots()?.[1].x as number;
    const keyBefore = shotsStateKey(engine.getShots());
    expect(keyBefore).toContain('hurl_stone');
    expect(engine.attemptPlayerMove('S')).toBe(true);
    tickN(engine, launcherStep * 2);
    const [launcherShot, stoneShot] = engine.getShots() as readonly Shot[];
    expect(launcherShot.x).toBe(3 + 2);
    expect(stoneShot.x - stoneStart).toBe(launcherStep * 2);
    expect(engine.undo()).toBe(true);
    expect(shotsStateKey(engine.getShots())).toBe(keyBefore);
  });
});

describe('hurl stone: refusals', () => {
  /** Asserts the throw changed nothing: no tick, no history, the stone still held, the board as it was. */
  function expectRefused(level: CompiledLevel, prepare?: (engine: GameEngine) => void): GameEngine {
    const engine = load(level);
    hold(engine);
    prepare?.(engine);
    const tick = engine.getTick();
    const history = engine.getTimedMoveHistory().length;
    const items = JSON.stringify(engine.getItems());
    const entities = JSON.stringify(engine.getEntities());
    expect(engine.dropItem(STONE)).toBe(false);
    expect(engine.getTick()).toBe(tick);
    expect(engine.getTimedMoveHistory()).toHaveLength(history);
    expect(engine.getPlayer().keys[STONE]).toBe(1);
    expect(engine.getShots()).toEqual([]);
    expect(JSON.stringify(engine.getItems())).toBe(items);
    expect(JSON.stringify(engine.getEntities())).toBe(entities);
    return engine;
  }

  it('refuses at a wall, with no tick, no undo step and the stone kept', () => {
    const engine = expectRefused(stoneRoom({ terrain: [[3, 5, 'wall']] }));
    expect(engine.undo()).toBe(false);
  });

  it('refuses at the edge of the map', () => {
    expectRefused(stoneRoom({ terrain: [[SIZE - 1, 5, 'floor']], player: { x: SIZE - 1, y: 5 } }));
  });

  it('refuses at a thin wall in the way', () => {
    const level = stoneRoom();
    expectRefused({ ...level, cellEdges: [{ x: 2, y: 5, sides: ['E'] }] });
  });

  it('refuses at terrain that is not laser transparent', () => {
    expectRefused(stoneRoom({ terrain: [[3, 5, 'door_red']] }));
  });

  it('refuses at a block that stops a shot', () => {
    expectRefused(stoneRoom({ entities: [{ type: BLOCK_ID, x: 3, y: 5, dir: 'N' }] }));
  });

  it('refuses at an item that is neither a bomb nor a lit charge', () => {
    expectRefused(stoneRoom({ items: [[3, 5, 'chip']] }));
  });

  it('refuses while the player is still in the cooldown of a step', () => {
    expectRefused(stoneRoom(), (engine) => {
      expect(engine.attemptPlayerMove('S')).toBe(true);
      expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
      engine.getPlayer().dir = 'E';
    });
  });

  it('refuses while the player slides', () => {
    expectRefused(stoneRoom(), (engine) => {
      engine.getPlayer().isSliding = true;
    });
  });

  it('accepts the throw once the cooldown is over', () => {
    const engine = load(stoneRoom());
    hold(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    engine.getPlayer().dir = 'E';
    expect(engine.dropItem(STONE)).toBe(false);
    tickN(engine, MAX_WAIT_TICKS);
    expect(engine.dropItem(STONE)).toBe(true);
  });

  it('does nothing when no stone is held', () => {
    const engine = load(stoneRoom());
    expect(engine.dropItem(STONE)).toBe(false);
    expect(engine.getShots()).toEqual([]);
  });

  it('throws at a bomb and at a lit charge ahead', () => {
    const bomb = load(stoneRoom({ items: [[3, 5, 'bomb']] }));
    hold(bomb);
    expect(bomb.dropItem(STONE)).toBe(true);
    expect(itemCount(bomb, 'bomb')).toBe(0);
    const lit = load(stoneRoom({ items: [[3, 5, 'charge_lit']] }));
    hold(lit);
    expect(lit.dropItem(STONE)).toBe(true);
  });
});

describe('hurl stone: undo', () => {
  it('restores the stone, the shot and the target after a throw', () => {
    const engine = load(stoneRoom({ items: [[6, 5, 'bomb']] }));
    hold(engine);
    const before = engine.captureState();
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, 1);
    expect(engine.getShots()).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().keys[STONE]).toBe(1);
    expect(engine.getShots()).toEqual([]);
    expect(engine.getItems()[5][6]).toBe('bomb');
    expect(engine.getTick()).toBe(before.ticksElapsed);
    expect(engine.getTimedMoveHistory()).toHaveLength(0);
  });

  it('puts a stone in flight back where it was when a later move is undone', () => {
    const engine = load(stoneRoom());
    hold(engine);
    engine.dropItem(STONE);
    tickN(engine, 2);
    const flying = JSON.stringify(engine.getShots());
    expect(engine.attemptPlayerMove('S')).toBe(true);
    tickN(engine, 3);
    expect(JSON.stringify(engine.getShots())).not.toBe(flying);
    expect(engine.undo()).toBe(true);
    expect(JSON.stringify(engine.getShots())).toBe(flying);
  });

  it('keeps the snapshots of a level without shots as they were', () => {
    const engine = load(room());
    step(engine, 'E');
    expect(engine.captureState()).not.toHaveProperty('shots');
  });
});

describe('hurl stone: solution letter T', () => {
  it('encodes and decodes the letter T as a throw of the stone', () => {
    expect(encodeActions(['E', DROP_STONE_ACTION, WAIT_ACTION, 'E'])).toBe('ET.E');
    expect(decodeActions('ET.E')).toEqual(['E', DROP_STONE_ACTION, WAIT_ACTION, 'E']);
    expect(isDropAction(DROP_STONE_ACTION)).toBe(true);
    expect(DROP_ACTION_ITEMS[DROP_STONE_ACTION]).toBe(STONE);
  });

  it('is refused as a campaign route segment, like X and G', () => {
    expect(() => parseSegment('ET')).toThrow();
    expect(() => parseSegment('T')).toThrow();
  });

  it('replays a stored solution that throws the stone at the bomb and reaches the exit', () => {
    const level = bombCorridor({ solution: CORRIDOR_SOLUTION });
    const engine = load(level);
    for (const action of decodeActions(CORRIDOR_SOLUTION)) expect(PieceSolver.play(engine, action)).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(storedSolutionWins(level)).toBe(true);
    const moves = timedSolution(level) ?? [];
    expect(moves.filter((move) => move.drop !== undefined).map((move) => move.drop)).toEqual([STONE]);
  });

  it('fails the same walk when the throw is left out, since the bomb is still there', () => {
    expect(storedSolutionWins(bombCorridor({ solution: CORRIDOR_SOLUTION_WITHOUT_THROW }))).toBe(false);
  });

  it('plays the timed throw back through the replay schedule to a win', () => {
    const moves = timedSolution(bombCorridor({ solution: CORRIDOR_SOLUTION })) ?? [];
    const replay = load(bombCorridor());
    let index = 0;
    for (let i = 0; i < STORED_SOLUTION_LIMIT_TICKS && !replay.isLevelCompleted(); i++) {
      const { due, nextIndex } = collectDueMoves(moves, index, replay.getTick());
      for (const move of due) {
        if (move.drop !== undefined) replay.dropItem(move.drop);
        else replay.attemptPlayerMove(move.dir);
      }
      index = nextIndex;
      replay.tick();
      expect(replay.getPlayer().alive).toBe(true);
    }
    expect(replay.isLevelCompleted()).toBe(true);
  });

  it('gives the same simulation hash twice for a level whose solution throws the stone', () => {
    const level = bombCorridor({ solution: CORRIDOR_SOLUTION });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'solution'));
    expect(new Set(hashes).size).toBe(1);
  });
});

describe('hurl stone: validator', () => {
  it('takes the bomb as passable once a stone can be picked up before it', () => {
    expect(LevelValidator.validate(bombCorridor()).stats.reachableExit).toBe(true);
  });

  it('keeps the bomb a wall without a stone', () => {
    expect(LevelValidator.validate(bombCorridor({ stone: false })).stats.reachableExit).toBe(false);
  });

  it('keeps the bomb a wall when the only stone lies behind it', () => {
    expect(LevelValidator.validate(bombCorridor({ stoneBehindBomb: true })).stats.reachableExit).toBe(false);
  });
});

describe('hurl stone: Epoxy rules only and pack format 10', () => {
  it('counts as an Epoxy-only item, hidden from the Lynx palette and refused by the DAT export', () => {
    expect(isStoneTileId(STONE)).toBe(true);
    expect(isStoneTileId('chip')).toBe(false);
    expect(isEpoxyOnlyItemId(STONE)).toBe(true);
    const placed = room({ items: [[3, 5, STONE]] });
    expect(hasEpoxyOnlyContent(placed)).toBe(true);
    expect(tileAvailability('lynx', STONE).available).toBe(false);
    expect(tileAvailability('epoxy', STONE).available).toBe(true);
    expect(datRefusalReason(placed)).toBe('epoxy_only_items');
    const encoded = DatCodec.encodeLevelsWithReport([placed, room()]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
    expect(encoded.levelCount).toBe(1);
  });

  it('adds the format 10 row to the table and detects the stone as a format 10 id', () => {
    expect(PACK_JSON_ID_SET_VERSIONS.map((row) => row.version)).toContain(PACK_JSON_VERSION_V10);
    expect([...PACK_JSON_VERSION_V10_IDS]).toEqual([STONE, 'wisp']);
    expect(PACK_JSON_VERSION_V10).toBe(PACK_JSON_VERSION_V9 + 1);
    expect(idSetVersionOf(room({ items: [[3, 5, STONE]] }))).toBe(PACK_JSON_VERSION_V10);
    expect(idSetVersionOf(room())).toBe(0);
    const cc3d: CompiledLevel = { ...room({ items: [[3, 5, STONE]] }), ruleset: 'cc3d' };
    expect(idSetVersionOf(cc3d)).toBe(0);
  });

  it('writes a pack with a stone as format 10 and reads it back', () => {
    const level = bombCorridor({ solution: CORRIDOR_SOLUTION });
    const text = serializePack('Stone', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V10);
    expect(JSON.parse(serializePack('Plain', [room()])).version).toBe(1);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levels[0].items[5][3]).toBe(STONE);
    expect(result.levels[0].solution).toBe(CORRIDOR_SOLUTION);
  });
});
