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
 * The Runeward device painters (thin walls, swivel doors, turn plates, machines, flame jets, lasers, launchers,
 * puppet control, turrets): every variant must look different from its siblings, laser groups keep their colour,
 * the flame freezes under reduced motion, and the parapet and the frames stay legible against the floor. When a
 * contrast pair fails, the colours in game.json change, never the thresholds below.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { Direction, RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import * as devices from './runewardDevices';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, type RunewardPaintEnv, type RunewardTilePass } from './runewardTiles';

const TILE = 48;
const FAR_TICK = 937;
const PLAIN_ON_FLOOR_MIN = 3;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 424242, cx: 3, cy: 7 };
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const THIN_WALL_COUNT = 15;

const HEX_RADIX = 16;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const FLARE = 0.05;
const MAX_CHANNEL = 255;

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => {
    const c = parseInt(part, HEX_RADIX) / MAX_CHANNEL;
    return c <= SRGB_LINEAR_CUTOFF ? c / SRGB_LINEAR_DIVISOR : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA);
  });
  return LUMA_RED * r + LUMA_GREEN * g + LUMA_BLUE * b;
}

/** WCAG contrast ratio, at least 1. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + FLARE) / (Math.min(la, lb) + FLARE);
}

function plainArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArt as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

function envOf(art: RunewardArtConfig, timeTick: number, reducedMotion: boolean): RunewardPaintEnv {
  return { timeTick, signalPowered: false, reducedMotion, cache: new Map(), art };
}

function tileLog(id: string, art: RunewardArtConfig, pass: RunewardTilePass = 'all', timeTick = 0, reducedMotion = false): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, pass, CELL, envOf(art, timeTick, reducedMotion), false, false);
  return lines;
}

function entityLog(id: string, dir: Direction, art: RunewardArtConfig): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.entities[id](ctx, dir, 0, 0, TILE, envOf(art, 0, false));
  return lines;
}

function thinWallIds(): string[] {
  return Object.keys(ConfigRegistry.getTiles().tiles).filter((id) => id.startsWith('thin_wall_'));
}

function uniqueLogs(logs: readonly string[][]): number {
  return new Set(logs.map((lines) => lines.join('\n'))).size;
}

const ARTS: readonly (readonly [string, () => RunewardArtConfig])[] = [['plain', plainArt], ['parchment', parchmentArt]];

describe('Runeward device painters', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('paints every device id and leaves none to the shared drawing', () => {
    expect(devices.PENDING).toEqual([]);
    expect(thinWallIds()).toHaveLength(THIN_WALL_COUNT);
    for (const id of thinWallIds()) expect(RUNEWARD_PAINTERS.tiles[id], id).toBeDefined();
    for (const id of Object.keys(devices.TILES)) expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
    for (const id of Object.keys(devices.ENTITIES)) expect(RUNEWARD_FALLBACK.has(id), id).toBe(false);
  });

  describe.each(ARTS)('%s ink', (_name, artOf) => {
    it('gives every thin wall id a distinct drawing', () => {
      const ids = thinWallIds();
      expect(uniqueLogs(ids.map((id) => tileLog(id, artOf())))).toBe(ids.length);
    });

    it('derives the parapets from the blocked edges of the definition', () => {
      const north = tileLog('thin_wall_n', artOf());
      const both = tileLog('thin_wall_ns', artOf());
      expect(both.length).toBeGreaterThan(north.length);
    });

    it('gives each swivel orientation a distinct drawing', () => {
      const ids = ['swivel_door_ne', 'swivel_door_se', 'swivel_door_sw', 'swivel_door_nw'];
      expect(uniqueLogs(ids.map((id) => tileLog(id, artOf())))).toBe(ids.length);
    });

    it('draws the clockwise and counter-clockwise turn plates as different images', () => {
      expect(tileLog('turn_plate_cw', artOf())).not.toEqual(tileLog('turn_plate_ccw', artOf()));
    });

    it('gives each laser emitter and shot launcher direction a distinct drawing', () => {
      const emitters = DIRECTIONS.map((d) => tileLog(`laser_emitter_${d.toLowerCase()}`, artOf()));
      const launchers = DIRECTIONS.map((d) => tileLog(`shot_launcher_${d.toLowerCase()}`, artOf()));
      expect(uniqueLogs(emitters)).toBe(DIRECTIONS.length);
      expect(uniqueLogs(launchers)).toBe(DIRECTIONS.length);
    });

    it('shows open and closed laser gates differently', () => {
      for (const group of ['red', 'blue']) {
        expect(tileLog(`laser_gate_${group}_open`, artOf())).not.toEqual(tileLog(`laser_gate_${group}_closed`, artOf()));
      }
    });

    it('gives each turret facing a distinct drawing, and each kind its own', () => {
      for (const id of ['turret_fixed', 'turret_cw', 'turret_ccw']) {
        expect(uniqueLogs(DIRECTIONS.map((d) => entityLog(id, d, artOf()))), id).toBe(DIRECTIONS.length);
      }
      const kinds = ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'].map((id) => entityLog(id, 'N', artOf()));
      expect(uniqueLogs(kinds)).toBe(kinds.length);
    });

    it('turns the cw and ccw turrets in opposite senses', () => {
      for (const dir of DIRECTIONS) expect(entityLog('turret_cw', dir, artOf())).not.toEqual(entityLog('turret_ccw', dir, artOf()));
    });

    it('draws the multi turret the same whatever its facing', () => {
      expect(entityLog('turret_multi', 'N', artOf())).toEqual(entityLog('turret_multi', 'W', artOf()));
    });

    it('keeps each laser group in its own colour', () => {
      const art = artOf();
      const { red, blue } = art.device.laserChannel;
      for (const id of ['laser_receiver_red', 'laser_gate_red_open', 'laser_gate_red_closed']) {
        const text = tileLog(id, art).join('\n');
        expect(text, id).toContain(red.main);
        expect(text, id).not.toContain(blue.main);
      }
      for (const id of ['laser_receiver_blue', 'laser_gate_blue_open', 'laser_gate_blue_closed']) {
        const text = tileLog(id, art).join('\n');
        expect(text, id).toContain(blue.main);
        expect(text, id).not.toContain(red.main);
      }
    });
  });

  describe('flame jets', () => {
    it('declares only the lit jet animated, and gives it a painter', () => {
      expect([...devices.ANIMATED]).toEqual(['flame_jet_on']);
      for (const id of devices.ANIMATED) expect(RUNEWARD_PAINTERS.tiles[id]).toBeDefined();
    });

    it.each(ARTS)('freezes the flame under reduced motion (%s)', (_name, artOf) => {
      const art = artOf();
      expect(tileLog('flame_jet_on', art, 'animated', FAR_TICK, true)).toEqual(tileLog('flame_jet_on', art, 'animated', 0, true));
    });

    it.each(ARTS)('moves the flame with the clock otherwise (%s)', (_name, artOf) => {
      const art = artOf();
      expect(tileLog('flame_jet_on', art, 'animated', FAR_TICK, false)).not.toEqual(tileLog('flame_jet_on', art, 'animated', 0, false));
    });

    it('keeps the flame out of the cached terrain and the nozzle out of the overlay', () => {
      const art = plainArt();
      const flame = tileLog('flame_jet_on', art, 'animated');
      const terrain = tileLog('flame_jet_on', art, 'static');
      const flameCalls = flame.filter((line) => line.startsWith('quadraticCurveTo('));
      expect(flameCalls.length).toBeGreaterThan(0);
      expect(terrain.filter((line) => line.startsWith('quadraticCurveTo(')).length).toBe(0);
      expect(flame.some((line) => line.startsWith('createLinearGradient('))).toBe(false);
    });

    it('shows the cold and the lit jet differently, and draws the cold one in the static pass only', () => {
      const art = plainArt();
      expect(tileLog('flame_jet_off', art, 'static')).not.toEqual(tileLog('flame_jet_on', art, 'static'));
      expect(tileLog('flame_jet_off', art, 'animated')).toEqual([]);
    });
  });

  describe('legibility', () => {
    it('keeps the plain parapets and swivel leaves at 3:1 or more against the floor', () => {
      const art = plainArt();
      expect(contrast(art.device.thinWall.base, art.floor.base)).toBeGreaterThanOrEqual(PLAIN_ON_FLOOR_MIN);
      expect(contrast(art.device.swivel.base, art.floor.base)).toBeGreaterThanOrEqual(PLAIN_ON_FLOOR_MIN);
    });

    it('keeps the plain laser frames at 3:1 or more against the floor', () => {
      const art = plainArt();
      for (const channel of ['red', 'blue'] as const) {
        expect(contrast(art.device.laserChannel[channel].main, art.floor.base), channel).toBeGreaterThanOrEqual(PLAIN_ON_FLOOR_MIN);
      }
    });
  });
});
