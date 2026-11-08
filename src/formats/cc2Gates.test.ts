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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { convertCc2Map } from './cc2ToEpoxy';
import type { Cc2ConvertOptions } from './cc2ToEpoxy';
import { buildCc2Wires } from './cc2Wires';
import { FLOOR_CODE, makeMap, modTile, player, put } from './cc2TestMaps';

const OPTIONS: Cc2ConvertOptions = { file: 'gates.c2m', order: 1, sha256: 'cd'.repeat(32) };
const N = 0x1;
const E = 0x2;
const S = 0x4;
const W = 0x8;
const GATE = 0x5c;
const PINK = 0x5e;
const CLONER = 0x44;
const LIGHTNING_BOLT = 0x62;
/** Gate modifiers: the kind plus the facing (0 north, 1 east, 2 south, 3 west). */
const NAND_FACING_E = 0x15;
const LATCH_CW_FACING_E = 0x11;
const LATCH_CCW_FACING_E = 0x41;
const COUNTER_FIRST = 0x1e;
const COUNTER_SEVEN = COUNTER_FIRST + 7;

beforeAll(() => {
  loadTestConfigs();
});

const wire = (x: number, y: number, mask: number) => put(x, y, modTile(FLOOR_CODE, mask));
const button = (x: number, y: number, mask: number) => put(x, y, modTile(PINK, mask));
const gate = (x: number, y: number, mod: number) => put(x, y, modTile(GATE, mod));

describe('CC2 gates the converter now plays', () => {
  it('maps the NAND gate, both latches and the counter digits to Epoxy tiles', () => {
    const cells = [
      gate(0, 0, NAND_FACING_E),
      gate(1, 0, LATCH_CW_FACING_E),
      gate(2, 0, LATCH_CCW_FACING_E),
      gate(3, 0, COUNTER_FIRST),
      gate(4, 0, COUNTER_SEVEN),
      gate(5, 0, COUNTER_FIRST + 9)
    ];
    const { level, coverage } = convertCc2Map(makeMap(6, 2, [player(0, 1), ...cells]), OPTIONS);
    expect(level.terrain[0]).toEqual([
      'signal_gate_nand',
      'signal_gate_dlatch',
      'signal_gate_dlatch',
      'signal_counter_0',
      'signal_counter_7',
      'signal_counter_9'
    ]);
    expect(coverage.lost).toEqual([]);
    expect(coverage.approx).toContain('counter_gate');
    expect(coverage.approx).not.toContain('data_latch');
    expect(coverage.approx).toContain('wire');
  });

  it('keeps the other gates and their links free of ports', () => {
    // Two buttons on the north and south inputs of an AND gate facing east, a clone machine on its output.
    const map = makeMap(4, 3, [player(0, 2), button(2, 0, S), gate(2, 1, 0x05), button(2, 2, N), put(3, 1, { code: CLONER })]);
    const { links } = buildCc2Wires(map);
    expect(links).toHaveLength(3);
    for (const l of links) expect(l.port).toBeUndefined();
  });
});

describe('ports of the CC2 gates', () => {
  /** A clockwise latch facing east: its clock is on the south side (CC2 in0), its data on the north side (CC2 in1). */
  it('wires the clock of a clockwise latch to the Epoxy clock port and its data to the data port', () => {
    // Sources feed the gate through a direct contact: a pink button facing the gate is an output on its mask side.
    const map = makeMap(3, 3, [
      player(0, 2),
      button(1, 0, S),
      gate(1, 1, LATCH_CW_FACING_E),
      button(1, 2, N),
      put(2, 1, { code: CLONER })
    ]);
    const { links } = buildCc2Wires(map);
    const byFrom = (x: number, y: number) => links.find((l) => l.fromX === x && l.fromY === y && l.toX === 1 && l.toY === 1);
    // Facing east: CC2 in0 is the side after the facing (south), CC2 in1 the side before it (north).
    // A clockwise latch clocks on in0, so the south button is the clock (Epoxy in1) and the north button the data (in0).
    expect(byFrom(1, 2)?.port).toBe('in1');
    expect(byFrom(1, 0)?.port).toBe('in0');
  });

  it('swaps the two ports for the counter-clockwise latch', () => {
    const map = makeMap(3, 3, [
      player(0, 2),
      button(1, 0, S),
      gate(1, 1, LATCH_CCW_FACING_E),
      button(1, 2, N),
      put(2, 1, { code: CLONER })
    ]);
    const { links } = buildCc2Wires(map);
    const byFrom = (x: number, y: number) => links.find((l) => l.fromX === x && l.fromY === y && l.toX === 1 && l.toY === 1);
    expect(byFrom(1, 2)?.port).toBe('in0');
    expect(byFrom(1, 0)?.port).toBe('in1');
  });

  it('wires the counter: count up from the east, count down from the south, overflow west, underflow north', () => {
    const map = makeMap(3, 3, [
      player(0, 2),
      gate(1, 1, COUNTER_FIRST),
      button(2, 1, W),
      button(1, 2, N),
      put(0, 1, { code: CLONER }),
      put(1, 0, { code: CLONER })
    ]);
    const { links } = buildCc2Wires(map);
    const into = links.filter((l) => l.toX === 1 && l.toY === 1);
    expect(into.find((l) => l.fromX === 2)?.port).toBe('in0');
    expect(into.find((l) => l.fromY === 2)?.port).toBe('in1');
    const out = links.filter((l) => l.fromX === 1 && l.fromY === 1);
    expect(out.find((l) => l.toX === 0)?.port).toBe('out0');
    expect(out.find((l) => l.toY === 0)?.port).toBe('out1');
  });
});

describe('lightning bolt', () => {
  it('maps the bolt item to the Epoxy item and turns the wire floors of a read net into wire floors', () => {
    // pink button -> wire -> wire -> cloner; the bolt lies elsewhere.
    const map = makeMap(5, 2, [
      player(0, 1),
      button(0, 0, E),
      wire(1, 0, E | W),
      wire(2, 0, E | W),
      put(3, 0, { code: CLONER }),
      put(4, 1, { code: LIGHTNING_BOLT }, { code: FLOOR_CODE })
    ]);
    const { level, coverage } = convertCc2Map(map, OPTIONS);
    expect(level.items[1][4]).toBe('lightning_bolt');
    expect(coverage.approx).toContain('lightning_bolt');
    expect(level.terrain[0][1]).toBe('signal_wire_floor');
    expect(level.terrain[0][2]).toBe('signal_wire_floor');
    const links = level.signalLinks ?? [];
    // Each wire floor drives the cloner, besides the button.
    expect(links.filter((l) => l.fromX === 1 && l.toX === 3)).toHaveLength(1);
    expect(links.filter((l) => l.fromX === 2 && l.toX === 3)).toHaveLength(1);
    expect(coverage.lost).toEqual([]);
  });

  it('leaves the wire floors alone on a level without a bolt', () => {
    const map = makeMap(5, 2, [player(0, 1), button(0, 0, E), wire(1, 0, E | W), wire(2, 0, E | W), put(3, 0, { code: CLONER })]);
    const { level } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[0][1]).toBe('floor');
    expect((level.signalLinks ?? []).every((l) => l.fromX === 0)).toBe(true);
  });

  it('does not power a net that nothing reads', () => {
    const map = makeMap(4, 2, [
      player(0, 1),
      wire(1, 0, E | W),
      wire(2, 0, E | W),
      put(3, 1, { code: LIGHTNING_BOLT }, { code: FLOOR_CODE })
    ]);
    const { level } = convertCc2Map(map, OPTIONS);
    expect(level.terrain[0][1]).toBe('floor');
    expect(level.signalLinks).toBeUndefined();
  });
});
