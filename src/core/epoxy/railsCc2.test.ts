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

/**
 * Chip's Challenge 2 track cells: the entry rule, the exit rule, the order a blocked step is turned in, the switch moving
 * behind an actor and under a gray button, the railroad sign, blocks, monsters, undo and the hash. Every level here is
 * synthetic. The rules are those of the Lexy's Labyrinth railroad (js/tiletypes.js `railroad`, js/game.js
 * `can_actor_leave_cell`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findRailConfigErrors } from '../../config/ConfigValidation';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { RAILROAD_SIGN_ITEM_ID, RAIL_JUNCTION_TILE_ID } from '../coreConstants';
import { isEpoxyOnlyTileId } from '../RulesetFeatures';
import { signalSinkOf } from '../signalLinks';
import { engineSimulationRun } from '../engineSimHash';
import type { CompiledLevel, Direction, EntityPlacement, RailTrackCell } from '../types';

const SIZE = 9;
const CENTER = 4;
const TIME_LIMIT_SECONDS = 100;
const MAX_WAIT_TICKS = 40;
const MONSTER_WALK_TICKS = 120;

/** Segment bits, in the order of the Lexy's Labyrinth railroad. */
const NE = 1 << 0;
const SE = 1 << 1;
const SW = 1 << 2;
const NW = 1 << 3;
const EW = 1 << 4;
const NS = 1 << 5;
/** Segment numbers, for the active segment of a switch. */
const SEG_EW = 4;
const SEG_NS = 5;

interface Setup {
  tracks?: RailTrackCell[];
  items?: Array<[number, number, string]>;
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
}

/** Walled floor room with the given track cells (their terrain is set from the list). */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const cell of setup.tracks ?? []) terrain[cell.y][cell.x] = RAIL_JUNCTION_TILE_ID;
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  const player = setup.player ?? { x: CENTER, y: CENTER + 2 };
  return {
    id: 'rails_cc2_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...player, dir: 'N' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.tracks ? { railTracks: setup.tracks } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

/** Walks the moves in order and returns where the player stands. */
function walk(engine: GameEngine, moves: Direction[]): { x: number; y: number } {
  for (const dir of moves) step(engine, dir);
  const { x, y } = engine.getPlayer();
  return { x, y };
}

function at(engine: GameEngine): { x: number; y: number } {
  const { x, y } = engine.getPlayer();
  return { x, y };
}

function railOf(engine: GameEngine, x: number, y: number): { active: number; entry: Direction } | undefined {
  const found = engine.getRailState()?.find(([cell]) => cell === y * SIZE + x);
  return found === undefined ? undefined : { active: found[1], entry: found[2] };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('track cells: configuration', () => {
  it('defines the track cell and the railroad sign, named in both locales, Epoxy only, format 13', () => {
    const names = { en, fr } as unknown as Record<string, { tiles: Record<string, { name: string; desc: { label: string } }> }>;
    for (const id of [RAIL_JUNCTION_TILE_ID, RAILROAD_SIGN_ITEM_ID]) {
      expect(ConfigRegistry.getTile(id).id, id).toBe(id);
      expect(names.en.tiles[id].name, id).toBeTruthy();
      expect(names.fr.tiles[id].name, id).toBeTruthy();
      expect(names.en.tiles[id].desc.label, id).toBeTruthy();
      expect(names.fr.tiles[id].desc.label, id).toBeTruthy();
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
      expect(PACK_JSON_VERSION_V13_IDS.has(id), id).toBe(true);
    }
    const junction = ConfigRegistry.getTile(RAIL_JUNCTION_TILE_ID);
    expect(junction.railJunction).toBe(true);
    expect(junction.railSides).toBeUndefined();
    expect(ConfigRegistry.getTile(RAILROAD_SIGN_ITEM_ID).collectible).toBe('boot');
  });

  it('leaves the native rail pieces as they were', () => {
    for (const id of ['rail_ns', 'rail_ew', 'rail_ne', 'rail_se', 'rail_sw', 'rail_nw', 'rail_switch_a', 'rail_switch_b']) {
      expect(ConfigRegistry.getTile(id).railJunction, id).toBeUndefined();
      expect(ConfigRegistry.getTile(id).railSides, id).toBeDefined();
    }
  });

  it('refuses a track cell that closes sides by itself or is not walkable', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    expect(findRailConfigErrors(tiles)).toEqual([]);
    const closed = { ...tiles, [RAIL_JUNCTION_TILE_ID]: { ...tiles[RAIL_JUNCTION_TILE_ID], passableByBlock: false } };
    expect(findRailConfigErrors(closed).join()).toContain('railJunction');
    const sided = { ...tiles, [RAIL_JUNCTION_TILE_ID]: { ...tiles[RAIL_JUNCTION_TILE_ID], railSides: ['N', 'S'] as Direction[] } };
    expect(findRailConfigErrors(sided).join()).toContain('railJunction');
    const item = { ...tiles, [RAILROAD_SIGN_ITEM_ID]: { ...tiles[RAILROAD_SIGN_ITEM_ID], railJunction: true } };
    expect(findRailConfigErrors(item).join()).toContain('a track cell is a terrain');
  });

  it('makes the track cell a flip sink, so a signal link or a gray button moves its switch', () => {
    expect(signalSinkOf(ConfigRegistry.getTile(RAIL_JUNCTION_TILE_ID))).toEqual({ fires: 'flip' });
  });
});

describe('track cells: entering', () => {
  it('lets the player in only through a side an open track touches', () => {
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NS }];
    // From the south: the north-south track touches the south side.
    expect(walk(load(room({ tracks })), ['N', 'N'])).toEqual({ x: CENTER, y: CENTER });
    // From the west: no track touches the west side.
    const sideways = load(room({ tracks, player: { x: CENTER - 1, y: CENTER } }));
    expect(step(sideways, 'E')).toBe(false);
    expect(at(sideways)).toEqual({ x: CENTER - 1, y: CENTER });
  });

  it('opens a side to a bend, and only the sides the cell holds a track for', () => {
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NE }];
    // North-east: enter from the north (moving south) and from the east (moving west); never from the south or the west.
    expect(step(load(room({ tracks, player: { x: CENTER, y: CENTER - 1 } })), 'S')).toBe(true);
    expect(step(load(room({ tracks, player: { x: CENTER + 1, y: CENTER } })), 'W')).toBe(true);
    expect(step(load(room({ tracks, player: { x: CENTER, y: CENTER + 1 } })), 'N')).toBe(false);
    expect(step(load(room({ tracks, player: { x: CENTER - 1, y: CENTER } })), 'E')).toBe(false);
  });

  it('shuts a cell that holds no track', () => {
    const engine = load(room({ terrain: [[CENTER, CENTER, RAIL_JUNCTION_TILE_ID]] }));
    expect(walk(engine, ['N', 'N'])).toEqual({ x: CENTER, y: CENTER + 1 });
  });

  it('opens only the active track of a cell with a switch', () => {
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NS | EW, active: SEG_EW }];
    // The east-west track is active: the south side is shut.
    expect(step(load(room({ tracks, player: { x: CENTER, y: CENTER + 1 } })), 'N')).toBe(false);
    expect(step(load(room({ tracks, player: { x: CENTER - 1, y: CENTER } })), 'E')).toBe(true);
  });
});

describe('track cells: leaving and turning a step', () => {
  it('lets the player out along the track that joins the side of entry', () => {
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }] }));
    expect(walk(engine, ['N', 'N', 'N'])).toEqual({ x: CENTER, y: CENTER - 1 });
  });

  it('turns a refused step to the right first, then to the left', () => {
    // Two bends from the north: entered from the north, the cell leads east and west only.
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NE | NW }];
    const start = { x: CENTER, y: CENTER - 1 };
    // Pressing south (straight on) is refused; the right of south is west, which a track allows.
    expect(walk(load(room({ tracks, player: start })), ['S', 'S'])).toEqual({ x: CENTER - 1, y: CENTER });
    // Pressing north (straight back) is refused for the player; the right of north is east.
    expect(walk(load(room({ tracks, player: start })), ['S', 'N'])).toEqual({ x: CENTER + 1, y: CENTER });
    // A step that follows a track goes as pressed.
    expect(walk(load(room({ tracks, player: start })), ['S', 'E'])).toEqual({ x: CENTER + 1, y: CENTER });
  });

  it('turns to the left when the right is refused too', () => {
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NS }];
    // Entered from the south, pressing east: refused; the right of east is south (the side of entry, refused for the
    // player); the left is north, which the track allows.
    expect(walk(load(room({ tracks })), ['N', 'N', 'E'])).toEqual({ x: CENTER, y: CENTER - 1 });
  });

  it('does not turn a step on a cell that is not a track cell', () => {
    const engine = load(room());
    expect(walk(engine, ['N', 'E'])).toEqual({ x: CENTER + 1, y: CENTER + 1 });
  });

  it('remembers the side of the last entry, and the start entry of the level', () => {
    const tracks: RailTrackCell[] = [{ x: CENTER, y: CENTER, mask: NS, entry: 'N' }];
    // Nobody came in yet: the level says an actor entered from the north.
    expect(railOf(load(room({ tracks })), CENTER, CENTER)?.entry).toBe('N');
    const engine = load(room({ tracks }));
    walk(engine, ['N', 'N']);
    expect(railOf(engine, CENTER, CENTER)?.entry).toBe('S');
  });
});

describe('track cells: the switch', () => {
  const switchCell = (): RailTrackCell => ({ x: CENTER, y: CENTER, mask: NS | EW, active: SEG_NS });

  it('moves to the next track when the player leaves along the active one', () => {
    const engine = load(room({ tracks: [switchCell()] }));
    walk(engine, ['N', 'N']);
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(SEG_NS);
    walk(engine, ['N']);
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(SEG_EW);
    // The cell now opens to the east and west: the north side the player stands on is shut.
    expect(step(engine, 'S')).toBe(false);
    expect(at(engine)).toEqual({ x: CENTER, y: CENTER - 1 });
  });

  it('wraps round the segments in order, skipping the ones the cell does not hold', () => {
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: SE | SW | NS, active: SEG_NS }] }));
    walk(engine, ['N', 'N', 'N']);
    // After segment 5 the next held one wraps to segment 1 (south-east).
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(1);
  });

  it('does not move when the exit is not on the active track', () => {
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: NS | NE, active: SEG_NS }] }));
    walk(engine, ['N', 'N']);
    // Turned: pressing east is refused, the left (north) follows the active track, so the switch moves.
    walk(engine, ['E']);
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(0);
  });

  it('leaves a cell without a switch as it is', () => {
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: NS | EW }] }));
    walk(engine, ['N', 'N', 'N']);
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(-1);
  });

  it('moves under a gray button within reach, whoever stands on the cell', () => {
    const level = room({
      tracks: [switchCell()],
      terrain: [[CENTER + 1, CENTER + 2, 'button_gray_area']],
      player: { x: CENTER + 1, y: CENTER + 3 }
    });
    const engine = load(level);
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(SEG_NS);
    step(engine, 'N');
    expect(at(engine)).toEqual({ x: CENTER + 1, y: CENTER + 2 });
    expect(railOf(engine, CENTER, CENTER)?.active).toBe(SEG_EW);
  });

  it('is put back by undo, with the side of entry', () => {
    const engine = load(room({ tracks: [switchCell()] }));
    const before = JSON.stringify(engine.getRailState());
    walk(engine, ['N', 'N', 'N']);
    expect(JSON.stringify(engine.getRailState())).not.toBe(before);
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(JSON.stringify(engine.getRailState())).toBe(before);
  });

  it('tells two search states apart by their switch', () => {
    const a = load(room({ tracks: [switchCell()] }));
    const b = load(room({ tracks: [switchCell()] }));
    expect(a.getRuntimeKeyExtra()).toBe(b.getRuntimeKeyExtra());
    walk(b, ['N', 'N', 'N']);
    expect(a.getRuntimeKeyExtra()).not.toBe(b.getRuntimeKeyExtra());
  });
});

describe('track cells: the railroad sign', () => {
  it('lets its holder in and out on any side without turning the step', () => {
    const level = room({
      tracks: [{ x: CENTER, y: CENTER, mask: NS }],
      items: [[CENTER - 2, CENTER, RAILROAD_SIGN_ITEM_ID]],
      player: { x: CENTER - 2, y: CENTER + 1 }
    });
    const engine = load(level);
    step(engine, 'N');
    expect(engine.getHeldItems()).toContain(RAILROAD_SIGN_ITEM_ID);
    // From the west, which no track touches, and out to the east, which no track joins.
    expect(walk(engine, ['E', 'E', 'E'])).toEqual({ x: CENTER + 1, y: CENTER });
  });

  it('lets nothing else ignore the tracks', () => {
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }], player: { x: CENTER - 1, y: CENTER } }));
    expect(step(engine, 'E')).toBe(false);
  });
});

describe('track cells: blocks', () => {
  const block = (x: number, y: number): EntityPlacement => ({ type: 'dirt_block', x, y, dir: 'N' });

  it('keeps a block out through a side no track touches', () => {
    const level = room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }], entities: [block(CENTER - 1, CENTER)], player: { x: CENTER - 2, y: CENTER } });
    const engine = load(level);
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getEntities().find((e) => e.type === 'dirt_block')?.x).toBe(CENTER - 1);
  });

  it('lets a block in along a track and out the way it came', () => {
    const level = room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }], entities: [block(CENTER, CENTER + 1)], player: { x: CENTER, y: CENTER + 2 } });
    const engine = load(level);
    expect(step(engine, 'N')).toBe(true);
    const moved = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect({ x: moved?.x, y: moved?.y }).toEqual({ x: CENTER, y: CENTER });
  });

  it('turns a block pushed across the track onto it (and may send it back out of the side of entry)', () => {
    // The block starts on the cell; nobody came in, so it entered from the south. No track joins south to east, so pushed east
    // it is turned: the right of east is south, the side of entry, which a block may back out of.
    const level = room({ tracks: [{ x: CENTER, y: CENTER, mask: NS | EW }], entities: [block(CENTER, CENTER)], player: { x: CENTER - 1, y: CENTER } });
    const engine = load(level);
    step(engine, 'E');
    const moved = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect({ x: moved?.x, y: moved?.y }).toEqual({ x: CENTER, y: CENTER + 1 });
  });
});

describe('track cells: monsters', () => {
  it('does not walk a monster into a side no track touches', () => {
    const tank: EntityPlacement = { type: 'tank', x: CENTER - 2, y: CENTER, dir: 'E' };
    const engine = load(room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }], entities: [tank], player: { x: 1, y: SIZE - 2 } }));
    for (let tick = 0; tick < MONSTER_WALK_TICKS; tick++) {
      engine.tick();
      const monster = engine.getEntities().find((e) => e.type === 'tank');
      expect(monster?.x === CENTER && monster?.y === CENTER).toBe(false);
    }
  });
});

describe('track cells: levels without them', () => {
  it('has no rail state and the same simulation as before', () => {
    const plain = room();
    expect(load(plain).getRailState()).toBeUndefined();
    expect(load(plain).getRuntimeKeyExtra()).toBe('');
    const withTracks = room({ tracks: [{ x: CENTER, y: CENTER, mask: NS }] });
    expect(engineSimulationRun(plain, 'scripted').hash).not.toBe(engineSimulationRun(withTracks, 'scripted').hash);
  });
});
