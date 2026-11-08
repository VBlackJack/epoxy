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
 * The reach walk of the validator on Chip's Challenge 2 track cells and on no-signs. Every level is synthetic: a
 * walled room, a player, one chip to fetch, and the tracks (or signs) in the way.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import { Pathfinder } from './Pathfinder';
import { GameEngine } from './GameEngine';
import { RAILROAD_SIGN_ITEM_ID, RAIL_JUNCTION_TILE_ID } from './coreConstants';
import type { CompiledLevel, RailTrackCell } from './types';

const UNREACHABLE_CHIPS_KEY = 'validator.issues.unreachable_chips';
const TIME_LIMIT_SECONDS = 100;

/** Segment bits, in the order of the track order of the rules. */
const SW = 1 << 2;
const NW = 1 << 3;
const EW = 1 << 4;
const NS = 1 << 5;

/**
 * Builds a level from rows: '#' wall, '.' floor, 'P' the player, 'c' a chip, 's' a railroad sign, 'k' a red key,
 * 'x' a no-sign for the red key on a floor, '=' a track cell (mask taken from `masks` by order of appearance).
 */
function level(rows: string[], masks: number[] = []): CompiledLevel {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  const railTracks: RailTrackCell[] = [];
  let start = { x: 1, y: 1 };
  rows.forEach((row, y) => {
    terrain.push([]);
    items.push([]);
    [...row].forEach((code, x) => {
      terrain[y].push(code === '#' ? 'wall' : code === '=' ? RAIL_JUNCTION_TILE_ID : 'floor');
      let item: string | null = null;
      if (code === 'c') item = 'chip';
      if (code === 's') item = RAILROAD_SIGN_ITEM_ID;
      if (code === 'k') item = 'key_red';
      if (code === 'x') item = 'no_sign_key_red';
      items[y].push(item);
      if (code === 'P') start = { x, y };
      if (code === '=') railTracks.push({ x, y, mask: masks[railTracks.length] ?? 0 });
    });
  });
  return {
    id: 'validator_rails',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 1,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(railTracks.length > 0 ? { railTracks } : {})
  };
}

function keysOf(compiled: CompiledLevel): string[] {
  return LevelValidator.validate(compiled).issues.map((i) => i.i18nKey);
}

function missesChip(compiled: CompiledLevel): boolean {
  return keysOf(compiled).some((key) => key.startsWith(UNREACHABLE_CHIPS_KEY));
}

beforeEach(() => {
  loadTestConfigs();
});

describe('validator reach walk: CC2 tracks', () => {
  it('crosses a straight track along its segment', () => {
    expect(missesChip(level(['#####', '#P=c#', '#####'], [EW]))).toBe(false);
  });

  it('is stopped by a track whose segment does not touch the entry side', () => {
    expect(missesChip(level(['#####', '#P=c#', '#####'], [NS]))).toBe(true);
  });

  it('is stopped when no segment joins the entry side to the exit', () => {
    // South-west segment: in from the west is fine, but the only way out is south, a wall.
    expect(missesChip(level(['#####', '#P=c#', '#####'], [SW]))).toBe(true);
  });

  it('exits north of a track entered from the west when a north-west segment joins them', () => {
    // The player stands west of the track, the chip is north of it.
    const compiled = level(['####', '##c#', '#P=#', '####'], [NW]);
    expect(missesChip(compiled)).toBe(false);
  });

  it('refuses the same bend when the segment joins the south side instead', () => {
    const compiled = level(['####', '##c#', '#P=#', '####'], [SW]);
    expect(missesChip(compiled)).toBe(true);
  });

  it('treats a cell with no segment as a wall', () => {
    expect(missesChip(level(['#####', '#P=c#', '#####'], [0]))).toBe(true);
  });

  it('lets the railroad sign holder ignore the tracks once the sign is reachable', () => {
    expect(missesChip(level(['######', '#Ps=c#', '######'], [NS]))).toBe(false);
  });

  it('keeps the tracks binding when the sign sits behind them', () => {
    expect(missesChip(level(['#######', '#P=sc##', '#######'], [NS]))).toBe(true);
  });

  it('does not touch a level without tracks', () => {
    expect(missesChip(level(['#####', '#P.c#', '#####']))).toBe(false);
  });
});

describe('validator reach walk: no-signs', () => {
  it('keeps a no-sign passable for a holder, since the item can be dropped first', () => {
    // The red key is taken, the no-sign bars it, yet the key can be put down before the sign: still reachable.
    expect(missesChip(level(['#######', '#Pkxc.#', '#######']))).toBe(false);
  });
});

describe('hints on tracks', () => {
  it('does not plan a step the tracks refuse', () => {
    const engine = new GameEngine();
    engine.loadLevel(level(['#####', '#P=c#', '#####'], [NS]));
    const path = Pathfinder.findPath(engine, 3, 1);
    expect(path.moves).toEqual([]);
  });

  it('plans a step along a segment', () => {
    const engine = new GameEngine();
    engine.loadLevel(level(['#####', '#P=c#', '#####'], [EW]));
    const path = Pathfinder.findPath(engine, 3, 1);
    expect(path.moves).toEqual(['E', 'E']);
  });
});
