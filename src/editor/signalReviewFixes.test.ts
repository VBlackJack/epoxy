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

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { canonicalSignalPort } from '../core/signalPorts';
import { checkSignalWiring } from '../core/signalChecks';
import { normalizeSignalLinks } from '../core/signalLinks';
import type { CompiledLevel, SignalLink, TileDefinition, ValidationIssue } from '../core/types';
import { retroTileLayers } from '../render/retroCompose';
import { paintSignalTile } from '../render/signalTilePainter';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { setSignalLinks, type SignalLinkHolder } from './editorSignalLinks';

const SIZE = 9;
const BUTTON = { x: 1, y: 1 };
const GATE = { x: 3, y: 2 };
const DOOR = { x: 5, y: 1 };
const PLATE = { x: 6, y: 6 };
const PLAYER = { x: 7, y: 6 };
const NUMBER_STARTED = 4;
const SEGMENTS_OF_ONE = 2;
const SEGMENTS_OF_EIGHT = 7;

beforeEach(() => {
  loadTestConfigs();
});

function grid(entries: Array<[{ x: number; y: number }, string]>): string[][] {
  const terrain: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
  for (const [cell, id] of entries) terrain[cell.y][cell.x] = id;
  return terrain;
}

function levelOf(terrain: string[][], signalLinks: SignalLink[], start = { x: 0, y: 0 }): CompiledLevel {
  return {
    id: 'review',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'W' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks
  };
}

const wire = (from: { x: number; y: number }, to: { x: number; y: number }, port?: string): SignalLink => ({
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  ...(port === undefined ? {} : { port })
});

describe('one wire per canonical port', () => {
  it('drops the default ports', () => {
    for (const text of ['in0', 'out0', 'out0>in0', 'a', undefined]) expect(canonicalSignalPort(text), String(text)).toBeUndefined();
    expect(canonicalSignalPort('out0>in1')).toBe('in1');
    expect(canonicalSignalPort('out1>in0')).toBe('out1');
  });

  it('keeps one wire for a pair named with no port, in0 or out0>in0, in the editor and in the compiler', () => {
    const terrain = grid([[BUTTON, 'signal_plate'], [GATE, 'signal_gate_xor']]);
    const links = [wire(BUTTON, GATE), wire(BUTTON, GATE, 'in0'), wire(BUTTON, GATE, 'out0>in0')];
    const map: SignalLinkHolder = { terrain };
    setSignalLinks(map, links);
    expect(map.signalLinks).toHaveLength(1);
    expect(normalizeSignalLinks(links, terrain, 'epoxy')).toHaveLength(1);
    const two = [wire(BUTTON, GATE, 'in0'), wire(BUTTON, GATE, 'in1')];
    setSignalLinks(map, two);
    expect(map.signalLinks?.map((link) => link.port)).toEqual(['in0', 'in1']);
    expect(normalizeSignalLinks(two, terrain, 'epoxy')).toHaveLength(2);
  });
});

describe('pulse button reaching a hold door through the new gates', () => {
  const warns = (gate: string, port: string | undefined): boolean => {
    const terrain = grid([[BUTTON, 'signal_button'], [GATE, gate], [DOOR, 'hold_door_red_closed']]);
    const issues: ValidationIssue[] = [];
    checkSignalWiring(levelOf(terrain, [wire(BUTTON, GATE), wire(GATE, DOOR, port)]), issues);
    return issues.some((issue) => issue.i18nKey === 'validator.issues.signal_pulse_door.label');
  };

  it('warns through the overflow output of a counter and through a data latch, not through a held output', () => {
    expect(warns('signal_counter_0', 'out0')).toBe(true);
    expect(warns('signal_counter_0', undefined)).toBe(true);
    expect(warns('signal_gate_dlatch', undefined)).toBe(true);
    expect(warns('signal_counter_0', 'out1')).toBe(false);
    expect(warns('signal_latch_off', undefined)).toBe(false);
  });
});

describe('counter drawing shows the live count', () => {
  it('reports the count by cell from the engine and follows it after a step', () => {
    const terrain = grid([[PLATE, 'signal_plate'], [GATE, `signal_counter_${NUMBER_STARTED}`], [DOOR, 'hold_door_red_closed']]);
    const engine = new GameEngine();
    engine.loadLevel(levelOf(terrain, [wire(PLATE, GATE, 'in0'), wire(GATE, DOOR, 'out0')], PLAYER));
    const cell = GATE.y * SIZE + GATE.x;
    expect(engine.getCounterValues()?.get(cell)).toBe(NUMBER_STARTED);
    for (let waited = 0; waited < 40 && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
    expect(engine.attemptPlayerMove('W')).toBe(true);
    expect(engine.getCounterValues()?.get(cell)).toBe(NUMBER_STARTED + 1);
    const plain = new GameEngine();
    plain.loadLevel(levelOf(grid([[PLATE, 'signal_plate'], [GATE, 'signal_gate_or'], [DOOR, 'hold_door_red_closed']]), [wire(PLATE, GATE), wire(GATE, DOOR)], PLAYER));
    expect(plain.getCounterValues()).toBeUndefined();
  });

  it('draws the retro number sprite of the live count, else the starting number', () => {
    const input = {
      tileId: 'signal_counter_2',
      def: ConfigRegistry.getTile('signal_counter_2') as TileDefinition,
      resolve: (id: string) => ConfigRegistry.getTile(id),
      pass: 'all' as const,
      hash: 0,
      wallMask: 0,
      floorDetailEvery: 0,
      isEditor: false,
      revealHiddenWalls: false,
      isClosedTrap: false,
      phase: 0,
      reducedMotion: false
    };
    expect(retroTileLayers(input).map((layer) => layer.name)).toContain('digit_2');
    expect(retroTileLayers({ ...input, counterCount: 8 }).map((layer) => layer.name)).toContain('digit_8');
  });

  it('strokes the segments of the live count in the vector styles', () => {
    const moves = (liveCount?: number): number => {
      let count = 0;
      const ctx = new Proxy({}, { get: (_t, name) => (name === 'moveTo' ? () => count++ : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
      paintSignalTile(ctx, 0, 0, 32, 'counter_1', false, { box: '#000', idle: '#111', lit: '#222' }, { rounded: false, glowBlurPx: 0 }, liveCount);
      return count;
    };
    expect(moves(8) - moves()).toBe(SEGMENTS_OF_EIGHT - SEGMENTS_OF_ONE);
  });
});
