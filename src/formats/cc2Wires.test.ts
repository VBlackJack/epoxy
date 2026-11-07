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

import { describe, expect, it } from 'vitest';
import { buildCc2Wires, decodeCc2Gate } from './cc2Wires';
import { FLOOR_CODE, makeMap, modTile, put } from './cc2TestMaps';

const PINK = 0x5e;
const CLONER = 0x44;
const GATE = 0x5c;
const TOGGLE_SWITCH = 0x88;
const PURPLE_WALL = 0x73;
const TOGGLE_WALL = 0x0e;
const N = 0x1;
const E = 0x2;
const S = 0x4;
const W = 0x8;
const TUNNEL_E = 0x20;
const TUNNEL_W = 0x80;
const ALL_SIDES = 0xf;

const wire = (x: number, y: number, mod: number) => put(x, y, modTile(FLOOR_CODE, mod));
const button = (x: number, y: number, mod: number) => put(x, y, modTile(PINK, mod));
const cloner = (x: number, y: number) => put(x, y, modTile(CLONER, E));

const link = (fromX: number, fromY: number, toX: number, toY: number) => ({ fromX, fromY, toX, toY });

describe('gate modifier', () => {
  it('reads the kind and the facing', () => {
    expect(decodeCc2Gate(undefined)).toEqual({ kind: 'not', facing: 0 });
    expect(decodeCc2Gate(0x05)).toEqual({ kind: 'and', facing: 1 });
    expect(decodeCc2Gate(0x0a)).toEqual({ kind: 'or', facing: 2 });
    expect(decodeCc2Gate(0x0f)).toEqual({ kind: 'xor', facing: 3 });
    expect(decodeCc2Gate(0x11)).toEqual({ kind: 'latch', facing: 1 });
    expect(decodeCc2Gate(0x16)).toEqual({ kind: 'nand', facing: 2 });
  });

  it('reads counters and unknown values as gates without a facing', () => {
    expect(decodeCc2Gate(0x1e)).toEqual({ kind: 'counter' });
    expect(decodeCc2Gate(0x27)).toEqual({ kind: 'counter' });
    expect(decodeCc2Gate(0x42)).toEqual({ kind: 'unknown' });
    expect(decodeCc2Gate(0x1c)).toEqual({ kind: 'unknown' });
  });
});

describe('wire networks', () => {
  it('links a pink button to a clone machine along a plain wire', () => {
    const map = makeMap(5, 1, [button(0, 0, E), wire(1, 0, E | W), wire(2, 0, E | W), cloner(3, 0)]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([link(0, 0, 3, 0)]);
    expect(result.hasWires).toBe(true);
    expect(result.hasTunnels).toBe(false);
  });

  it('does not link across a gap in the wire', () => {
    const map = makeMap(5, 1, [button(0, 0, E), wire(1, 0, E | W), cloner(3, 0)]);
    expect(buildCc2Wires(map).links).toEqual([]);
  });

  it('feeds every sink of the network and ignores a green toggle wall', () => {
    const map = makeMap(3, 3, [
      button(1, 0, S),
      wire(1, 1, N | E | W),
      put(0, 1, { code: TOGGLE_WALL }),
      cloner(2, 1)
    ]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([link(1, 0, 2, 1)]);
    expect(result.unsupported).toEqual([]);
  });

  it('joins two sources of the same network to the same sink', () => {
    const map = makeMap(5, 1, [button(0, 0, E), wire(1, 0, E | W), wire(2, 0, E | W), button(4, 0, W), cloner(3, 0)]);
    // The second button reaches the clone machine directly, side by side.
    expect(buildCc2Wires(map).links).toEqual([link(0, 0, 3, 0), link(4, 0, 3, 0)]);
    expect(buildCc2Wires(makeMap(3, 1, [button(0, 0, E), wire(1, 0, E | W), button(2, 0, W)])).links).toEqual([]);
  });

  it('joins a tunnel to the cell that closes it', () => {
    // Wire in a tunnel from x=1 to x=4; the cells in between are not part of the network.
    const map = makeMap(6, 1, [
      button(0, 0, E),
      wire(1, 0, E | W | TUNNEL_E),
      wire(4, 0, E | W | TUNNEL_W),
      cloner(5, 0)
    ]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([link(0, 0, 5, 0)]);
    expect(result.hasTunnels).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('matches nested tunnels like brackets', () => {
    // A tunnels x=1 to x=4 and B tunnels x=2 to x=3: the inner pair must not be taken by the outer wire.
    const map = makeMap(5, 2, [
      button(0, 0, E),
      wire(1, 0, E | W | TUNNEL_E),
      wire(2, 0, S | E | TUNNEL_E),
      wire(3, 0, S | W | TUNNEL_W),
      wire(4, 0, S | W | TUNNEL_W),
      button(2, 1, N),
      cloner(3, 1),
      cloner(4, 1)
    ]);
    const links = buildCc2Wires(map).links;
    expect(links).toEqual([link(0, 0, 4, 1), link(2, 1, 3, 1)]);
  });

  it('matches tunnels along a column', () => {
    const map = makeMap(1, 6, [
      button(0, 0, S),
      put(0, 1, modTile(FLOOR_CODE, S | N | 0x40)),
      put(0, 4, modTile(FLOOR_CODE, S | N | 0x10)),
      cloner(0, 5)
    ]);
    expect(buildCc2Wires(map).links).toEqual([link(0, 0, 0, 5)]);
  });

  it('warns about a tunnel without a partner and keeps the cell a dead end', () => {
    const map = makeMap(4, 1, [button(0, 0, E), wire(1, 0, E | W | TUNNEL_E), cloner(3, 0)]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([]);
    expect(result.warnings.length).toBe(1);
  });

  it('keeps the two axes of a four-wire crossing apart', () => {
    const map = makeMap(3, 3, [
      button(0, 1, E),
      wire(1, 1, ALL_SIDES),
      cloner(2, 1),
      button(1, 0, S),
      cloner(1, 2)
    ]);
    expect(buildCc2Wires(map).links).toEqual([link(1, 0, 1, 2), link(0, 1, 2, 1)]);
  });

  it('joins the sides of a three-wire junction', () => {
    const map = makeMap(3, 3, [button(0, 1, E), wire(1, 1, W | E | S), cloner(2, 1), cloner(1, 2)]);
    expect(buildCc2Wires(map).links).toEqual([link(0, 1, 2, 1), link(0, 1, 1, 2)]);
  });
});

describe('logic gates', () => {
  it('links the inputs of an AND gate to it and it to its output', () => {
    // An AND gate facing east: inputs on its north and south sides.
    const map = makeMap(3, 3, [button(1, 0, S), button(1, 2, N), put(1, 1, modTile(GATE, 0x05)), cloner(2, 1)]);
    expect(buildCc2Wires(map).links).toEqual([link(1, 0, 1, 1), link(1, 1, 2, 1), link(1, 2, 1, 1)]);
  });

  it('reads a NOT gate from behind only', () => {
    // A NOT gate facing east takes its input from the west, not from the north.
    const map = makeMap(3, 3, [button(0, 1, E), button(1, 0, S), put(1, 1, modTile(GATE, 0x01)), cloner(2, 1)]);
    expect(buildCc2Wires(map).links).toEqual([link(0, 1, 1, 1), link(1, 1, 2, 1)]);
  });

  it('passes a gate output through a wire to a sink', () => {
    const map = makeMap(5, 3, [
      button(1, 0, S),
      button(1, 2, N),
      put(1, 1, modTile(GATE, 0x05)),
      wire(2, 1, E | W),
      cloner(3, 1)
    ]);
    expect(buildCc2Wires(map).links).toEqual([link(1, 0, 1, 1), link(1, 1, 3, 1), link(1, 2, 1, 1)]);
  });

  it('reports a NAND gate as a gate Epoxy does not play, without a link', () => {
    const map = makeMap(3, 3, [button(0, 1, E), put(1, 1, modTile(GATE, 0x16)), cloner(1, 2)]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([]);
    expect(result.unsupported.some((node) => node.kind === 'logic_gate')).toBe(true);
  });
});

describe('devices Epoxy does not play', () => {
  it('reports a purple wall sink and keeps the other sinks of the network', () => {
    const map = makeMap(5, 1, [button(0, 0, E), wire(1, 0, E | W), put(2, 0, { code: PURPLE_WALL }), cloner(3, 0)]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([]);
    expect(result.unsupported).toEqual([{ x: 2, y: 0, kind: 'purple', end: 'sink' }]);
  });

  it('reports a wired trap and a wired flame jet as sinks', () => {
    const map = makeMap(3, 3, [button(1, 0, S), wire(1, 1, N | E | W), put(0, 1, { code: 0x42 }), put(2, 1, { code: 0x5f })]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([]);
    expect(result.unsupported.map((node) => node.kind)).toEqual(['trap', 'flame_jet']);
  });

  it('reports a toggle switch source', () => {
    const map = makeMap(3, 1, [put(0, 0, modTile(TOGGLE_SWITCH, E)), wire(1, 0, E | W), cloner(2, 0)]);
    const result = buildCc2Wires(map);
    expect(result.links).toEqual([]);
    expect(result.unsupported).toEqual([{ x: 0, y: 0, kind: 'toggle_switch', end: 'source' }]);
  });

  it('gives a map with no wire no link', () => {
    const result = buildCc2Wires(makeMap(4, 4));
    expect(result).toEqual({ links: [], hasWires: false, hasTunnels: false, unsupported: [], warnings: [] });
  });
});
