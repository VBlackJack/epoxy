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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { checkSignalWiring } from '../core/signalChecks';
import { retroTileLayers } from '../render/retroCompose';
import type { CompiledLevel, TileDefinition, ValidationIssue } from '../core/types';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { appendSignalLink, setSignalLinks, type SignalLinkHolder } from './editorSignalLinks';

const SIZE = 7;
const SOURCE_A = { x: 1, y: 1 };
const SOURCE_B = { x: 1, y: 3 };
const GATE = { x: 3, y: 2 };
const SINK_A = { x: 5, y: 1 };
const SINK_B = { x: 5, y: 3 };

beforeEach(() => {
  loadTestConfigs();
});

function holder(gate: string): SignalLinkHolder {
  const terrain: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
  terrain[SOURCE_A.y][SOURCE_A.x] = 'signal_plate';
  terrain[SOURCE_B.y][SOURCE_B.x] = 'signal_plate';
  terrain[GATE.y][GATE.x] = gate;
  terrain[SINK_A.y][SINK_A.x] = 'hold_door_red_closed';
  terrain[SINK_B.y][SINK_B.x] = 'hold_door_blue_closed';
  return { terrain };
}

describe('editor wires into gates with ordered ports', () => {
  it('gives the first wire into a data latch the data port and the second the clock port', () => {
    const map = holder('signal_gate_dlatch');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    const ports = (map.signalLinks ?? []).map((link) => [link.fromY, link.port]);
    expect(ports).toEqual([[1, 'in0'], [3, 'in1']]);
  });

  it('gives a counter its count-up and count-down ports, and its overflow then underflow outputs', () => {
    const map = holder('signal_counter_0');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, SOURCE_B, GATE);
    appendSignalLink(map, GATE, SINK_A);
    appendSignalLink(map, GATE, SINK_B);
    const into = (map.signalLinks ?? []).filter((link) => link.toX === GATE.x).map((link) => link.port);
    const out = (map.signalLinks ?? []).filter((link) => link.fromX === GATE.x).map((link) => link.port);
    expect(into).toEqual(['in0', 'in1']);
    expect(out).toEqual(['out0', 'out1']);
  });

  it('leaves the links of the other gates without a port', () => {
    const map = holder('signal_gate_and');
    appendSignalLink(map, SOURCE_A, GATE);
    appendSignalLink(map, GATE, SINK_A);
    expect((map.signalLinks ?? []).every((link) => link.port === undefined)).toBe(true);
  });

  it('keeps the two wires of one pair when they name different ports', () => {
    const map = holder('signal_counter_0');
    setSignalLinks(map, [
      { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y, port: 'out0' },
      { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y, port: 'out1' },
      { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y, port: 'out1' }
    ]);
    expect(map.signalLinks?.map((link) => link.port)).toEqual(['out0', 'out1']);
  });
});

describe('retro composition of the counter', () => {
  it('stacks the shared counter sprite, the number it starts with and the lit overlay', () => {
    const def = ConfigRegistry.getTile('signal_counter_7') as TileDefinition;
    const base = {
      tileId: 'signal_counter_7',
      def,
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
    const off = retroTileLayers(base).map((layer) => layer.name);
    expect(off).toEqual(['floor', 'signal_gate_counter', 'digit_7']);
    const on = retroTileLayers({ ...base, powered: true }).map((layer) => layer.name);
    expect(on).toEqual([...off, 'signal_gate_counter_lit']);
  });
});

describe('validator wiring checks for the new gates', () => {
  function levelWith(gate: string, links: CompiledLevel['signalLinks']): CompiledLevel {
    const terrain: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
    terrain[SOURCE_A.y][SOURCE_A.x] = 'signal_plate';
    terrain[GATE.y][GATE.x] = gate;
    terrain[SINK_A.y][SINK_A.x] = 'hold_door_red_closed';
    return {
      id: 'ports',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 100,
      chipsRequired: 0,
      playerStart: { x: 0, y: 0, dir: 'E' },
      terrain,
      items: terrain.map((row) => row.map(() => null)),
      entities: [],
      trapLinks: [],
      cloneLinks: [],
      signalLinks: links
    };
  }

  it('asks for an input on a NAND gate, a data latch and a counter', () => {
    for (const gate of ['signal_gate_nand', 'signal_gate_dlatch', 'signal_counter_3']) {
      const issues: ValidationIssue[] = [];
      checkSignalWiring(
        levelWith(gate, [{ fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y }]),
        issues
      );
      expect(issues.map((issue) => issue.i18nKey), gate).toContain('validator.issues.signal_gate_no_input.label');
    }
  });

  it('counts the wire floors that feed one sink as one input, and two plates as two', () => {
    const floors = [
      { x: 1, y: 5 },
      { x: 2, y: 5 }
    ];
    const keys = (tile: string): string[] => {
      const level = levelWith('floor', floors.map((cell) => ({ fromX: cell.x, fromY: cell.y, toX: SINK_A.x, toY: SINK_A.y })));
      for (const cell of floors) level.terrain[cell.y][cell.x] = tile;
      const issues: ValidationIssue[] = [];
      checkSignalWiring(level, issues);
      return issues.map((issue) => issue.i18nKey);
    };
    expect(keys('signal_wire_floor')).not.toContain('validator.issues.signal_sink_inputs.label');
    expect(keys('signal_plate')).toContain('validator.issues.signal_sink_inputs.label');
  });

  it('accepts a wired NAND gate, data latch and counter without an error', () => {
    for (const gate of ['signal_gate_nand', 'signal_gate_dlatch', 'signal_counter_3']) {
      const issues: ValidationIssue[] = [];
      checkSignalWiring(
        levelWith(gate, [
          { fromX: SOURCE_A.x, fromY: SOURCE_A.y, toX: GATE.x, toY: GATE.y },
          { fromX: GATE.x, fromY: GATE.y, toX: SINK_A.x, toY: SINK_A.y }
        ]),
        issues
      );
      expect(issues.filter((issue) => issue.severity === 'error'), gate).toEqual([]);
    }
  });
});
