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
 * Wave 17: an OR or a NOT gate wired to its own input keeps a self link in the cc2 record (Cc2LevelData.selfLinks), never in
 * signalLinks. The other gate kinds drop it. The link is added to the signal spec on the CC2 engine only.
 * Lexy reference: game.js do_wire_phase (a gate's output powers its circuit, so an input of the same circuit reads it one phase later).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { stripInvalidTextFields } from '../config/ConfigValidation';
import { registryTileLookup } from '../core/epoxy/epoxySignals';
import { compileSignalSpec } from '../core/signalLinks';
import { buildSignalNetwork } from '../core/epoxy/signalNetwork';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { cc2GridHash, convertCc2Map } from './cc2ToEpoxy';
import type { Cc2ConvertOptions } from './cc2ToEpoxy';
import { buildCc2Wires } from './cc2Wires';
import { FLOOR_CODE, makeMap, modTile, player, put } from './cc2TestMaps';

const OPTIONS: Cc2ConvertOptions = { file: 'one.c2m', order: 3, sha256: 'ab'.repeat(32) };
const PINK = 0x5e;
const GATE = 0x5c;
const CLONER = 0x44;
const N = 0x1;
const E = 0x2;
const S = 0x4;
const W = 0x8;
/** Gate modifiers facing east: the kind in the high bits, the facing in the low two (see decodeCc2Gate). */
const NOT_EAST = 0x01;
const AND_EAST = 0x05;
const OR_EAST = 0x09;
const XOR_EAST = 0x0d;
const GATE_X = 1;
const GATE_Y = 1;
const WIDTH = 5;
const HEIGHT = 3;
const GATE_CELL = GATE_Y * WIDTH + GATE_X;
const BUTTON_CELL = (GATE_Y + 1) * WIDTH + GATE_X;

beforeAll(() => {
  loadTestConfigs();
});

const wire = (x: number, y: number, mod: number) => put(x, y, modTile(FLOOR_CODE, mod));

/**
 * A gate facing east at (1,1) whose output wire loops back to its input, a button wired to its south side and a clone machine
 * at (3,1) on the output. A NOT gate reads from the west only, so its loop comes back through (0,1).
 */
function loopMap(gateMod: number) {
  const notGate = gateMod === NOT_EAST;
  const loopBack = notGate
    ? [wire(2, 1, W | N | E), wire(2, 0, S | W), wire(1, 0, E | W), wire(0, 0, E | S), wire(0, 1, N | E)]
    : [wire(2, 1, W | N | E), wire(2, 0, S | W), wire(1, 0, E | S)];
  return makeMap(WIDTH, HEIGHT, [
    player(4, 2),
    put(GATE_X, GATE_Y + 1, modTile(PINK, N)),
    put(GATE_X, GATE_Y, modTile(GATE, gateMod)),
    ...loopBack,
    put(3, 1, modTile(CLONER, E))
  ]);
}

const selfLinksOf = (gateMod: number) => buildCc2Wires(loopMap(gateMod)).selfLinks;
const isSelf = (l: { fromX: number; fromY: number; toX: number; toY: number }) => l.fromX === l.toX && l.fromY === l.toY;

describe('cc2Wires self links', () => {
  it('records an OR gate wired to its own input, outside the links', () => {
    const result = buildCc2Wires(loopMap(OR_EAST));
    expect(result.selfLinks).toEqual([GATE_CELL]);
    expect(result.links.some(isSelf)).toBe(false);
  });

  it('records a NOT gate wired to its own input', () => {
    expect(selfLinksOf(NOT_EAST)).toEqual([GATE_CELL]);
  });

  it('drops an AND or XOR self link (the self link scope is OR and NOT only)', () => {
    expect(selfLinksOf(AND_EAST)).toBeUndefined();
    expect(selfLinksOf(XOR_EAST)).toBeUndefined();
  });

  it('records nothing for a gate that does not read its own output', () => {
    const map = makeMap(WIDTH, HEIGHT, [
      put(GATE_X, GATE_Y + 1, modTile(PINK, N)),
      put(GATE_X, GATE_Y, modTile(GATE, OR_EAST)),
      put(3, 1, modTile(CLONER, E)),
      wire(2, 1, W | E)
    ]);
    expect(buildCc2Wires(map).selfLinks).toBeUndefined();
  });
});

describe('the cc2 record', () => {
  it('carries the self links of the import and leaves signalLinks and the grid hash alone', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    expect(level.cc2?.selfLinks).toEqual([GATE_CELL]);
    expect((level.signalLinks ?? []).some(isSelf)).toBe(false);
    // The hash reads the grid parts only (signalLinks hold no self link), so it matches the stored one.
    expect(cc2GridHash(level)).toBe(level.cc2?.gridHash);
  });

  it('has no field for a level without a self loop', () => {
    const { level } = convertCc2Map(makeMap(WIDTH, HEIGHT, [player(0, 0)]), OPTIONS);
    expect(level.cc2 !== undefined && 'selfLinks' in level.cc2).toBe(false);
  });

  it('keeps a good list and drops a malformed one alone', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    expect(stripInvalidTextFields(level)).toBe(level);
    for (const bad of ['x', [], [3, 3], [5, 2], [-1], [1.5], ['a']]) {
      const kept = stripInvalidTextFields({ ...level, cc2: { ...(level.cc2 as NonNullable<CompiledLevel['cc2']>), selfLinks: bad as number[] } });
      expect(kept.cc2 !== undefined && 'selfLinks' in kept.cc2, JSON.stringify(bad)).toBe(false);
      expect(kept.cc2?.gridHash).toBe(level.cc2?.gridHash);
      expect(kept.cc2?.sha256).toBe(level.cc2?.sha256);
    }
  });
});

describe('compileSignalSpec self links', () => {
  const compile = (level: CompiledLevel) => compileSignalSpec(level, registryTileLookup);
  const selfLinksIn = (level: CompiledLevel) => (compile(level)?.links ?? []).filter((l) => l.from === l.to);

  it('adds the self link of an OR gate on the CC2 engine, after the other links', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    const spec = compile(level);
    expect(selfLinksIn(level)).toEqual([{ from: GATE_CELL, to: GATE_CELL }]);
    expect(spec?.links[spec.links.length - 1]).toEqual({ from: GATE_CELL, to: GATE_CELL });
  });

  it('adds the self link of a NOT gate', () => {
    const { level } = convertCc2Map(loopMap(NOT_EAST), OPTIONS);
    expect(selfLinksIn(level)).toEqual([{ from: GATE_CELL, to: GATE_CELL }]);
  });

  it('never adds it to a level without the cc2 record (a native level)', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    const { cc2: _cc2, ...native } = level;
    expect(selfLinksIn(native as CompiledLevel)).toEqual([]);
  });

  it('skips a cell that is not an OR or a NOT node, outside the grid, or listed twice', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    const record = level.cc2 as NonNullable<CompiledLevel['cc2']>;
    expect(selfLinksIn({ ...level, cc2: { ...record, selfLinks: [BUTTON_CELL] } })).toEqual([]);
    expect(selfLinksIn({ ...level, cc2: { ...record, selfLinks: [WIDTH * HEIGHT] } })).toEqual([]);
    expect(selfLinksIn({ ...level, cc2: { ...record, selfLinks: [GATE_CELL, GATE_CELL] } })).toHaveLength(1);
  });

  it('downgrade: with the field removed the spec holds every other link', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    const record = { ...(level.cc2 as NonNullable<CompiledLevel['cc2']>) };
    const full = compile(level)?.links ?? [];
    delete record.selfLinks;
    const stripped = compile({ ...level, cc2: record })?.links ?? [];
    expect(stripped).toEqual(full.filter((l) => l.from !== l.to));
    expect(stripped.length).toBeGreaterThan(0);
  });

  it('builds an acyclic network with the gate-delay option, a cycle without it', () => {
    const { level } = convertCc2Map(loopMap(OR_EAST), OPTIONS);
    const spec = compile(level) as NonNullable<ReturnType<typeof compile>>;
    expect(buildSignalNetwork(spec.nodes, spec.links, { gateDelay: true }).cycles).toEqual([]);
    expect(buildSignalNetwork(spec.nodes, spec.links).cycles).toHaveLength(1);
  });
});
