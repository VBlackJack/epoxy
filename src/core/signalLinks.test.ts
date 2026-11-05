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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, stripInvalidTextFields, TerrainTileLookup } from '../config/ConfigValidation';
import { SIGNAL_PORT_MAX_LENGTH } from './coreConstants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { compileSignalSpec, normalizeSignalLinks } from './signalLinks';
import type { CellUnderlay, SignalLink, TileDefinition } from './types';

const SIZE = 6;
const FLOOR = 'floor';
const RECEIVER = 'stub_receiver';
const PLATE = 'stub_plate';
const GATE_AND = 'stub_and';
const GATE_LATCH_ON = 'stub_latch_on';
const DOOR = 'stub_door';
const COVER = 'stub_cover';
const MAX_PORT = 'p'.repeat(SIGNAL_PORT_MAX_LENGTH);

const FIELDS: Record<string, Partial<TileDefinition>> = {
  [FLOOR]: {},
  [COVER]: {},
  [RECEIVER]: { laserReceiverGroup: 'g' },
  [PLATE]: { signalSource: 'held' },
  [GATE_AND]: { signalGate: 'and' },
  [GATE_LATCH_ON]: { signalGate: 'latch', signalLatchStartsOn: true },
  [DOOR]: { holdDoorColor: 'blue' }
};

const lookup: TerrainTileLookup = (id) => (id in FIELDS ? ({ id, ...FIELDS[id] } as TileDefinition) : undefined);

const A = { x: 0, y: 0 };
const B = { x: 1, y: 0 };
const C = { x: 2, y: 0 };
const D = { x: 3, y: 0 };

/** A grid of floor with the given tiles placed. */
function grid(placed: Array<[{ x: number; y: number }, string]>): string[][] {
  const terrain = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => FLOOR));
  for (const [p, id] of placed) terrain[p.y][p.x] = id;
  return terrain;
}

const wire = (from: { x: number; y: number }, to: { x: number; y: number }, port?: string): SignalLink => ({
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  ...(port === undefined ? {} : { port })
});

/** A -> gate B -> door C on a grid where A is a source. */
const chain = (): string[][] => grid([[A, PLATE], [B, GATE_AND], [C, DOOR]]);

describe('normalizeSignalLinks', () => {
  it('keeps a well-formed wire and nothing else', () => {
    expect(normalizeSignalLinks([wire(A, B), wire(B, C)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B), wire(B, C)]);
  });

  it('is null for a non-Epoxy ruleset, a non-list and an empty result', () => {
    expect(normalizeSignalLinks([wire(A, B)], chain(), 'lynx', null, lookup)).toBeNull();
    expect(normalizeSignalLinks([wire(A, B)], chain(), 'cc3d', null, lookup)).toBeNull();
    expect(normalizeSignalLinks('nope', chain(), 'epoxy', null, lookup)).toBeNull();
    expect(normalizeSignalLinks([], chain(), 'epoxy', null, lookup)).toBeNull();
  });

  it('drops entries that are not records, are out of bounds or hold bad coordinates', () => {
    const bad = [null, 7, 'x', { fromX: 0, fromY: 0 }, wire(A, { x: SIZE, y: 0 }), wire({ x: -1, y: 0 }, B), { ...wire(A, B), toX: 1.5 }];
    expect(normalizeSignalLinks([...bad, wire(A, B)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B)]);
  });

  it('drops a self-link', () => {
    expect(normalizeSignalLinks([wire(B, B), wire(A, B)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B)]);
  });

  it('drops links whose ends are not the right kind of device', () => {
    const terrain = grid([[A, PLATE], [B, GATE_AND], [C, DOOR], [D, RECEIVER]]);
    const links = [
      wire(B, A), // into a source
      wire(C, B), // out of a sink
      wire(A, D), // into a receiver (a source)
      wire(A, { x: 4, y: 0 }), // into a plain floor cell
      wire({ x: 4, y: 0 }, B), // out of a plain floor cell
      wire(D, C), // receiver straight into a door: valid
      wire(A, B) // valid
    ];
    expect(normalizeSignalLinks(links, terrain, 'epoxy', null, lookup)).toEqual([wire(A, B), wire(D, C)]);
  });

  it('counts a device hidden under a removable top, as a launcher link does', () => {
    const terrain = grid([[A, PLATE], [B, COVER], [C, DOOR]]);
    const under: CellUnderlay[] = [{ x: B.x, y: B.y, terrain: GATE_AND }];
    expect(normalizeSignalLinks([wire(A, B), wire(B, C)], terrain, 'epoxy', null, lookup)).toBeNull();
    expect(normalizeSignalLinks([wire(A, B), wire(B, C)], terrain, 'epoxy', under, lookup)).toEqual([wire(A, B), wire(B, C)]);
  });

  it('keeps a port of 1 to 16 characters and drops only the port otherwise', () => {
    const links = [
      wire(A, B, 'in'),
      { ...wire(B, C), port: '' },
      { ...wire(A, C), port: 7 },
      { ...wire(B, D), port: 'x'.repeat(SIGNAL_PORT_MAX_LENGTH + 1) }
    ];
    const terrain = grid([[A, PLATE], [B, GATE_AND], [C, DOOR], [D, DOOR]]);
    expect(normalizeSignalLinks(links, terrain, 'epoxy', null, lookup)).toEqual([
      wire(A, B, 'in'),
      wire(A, C),
      wire(B, C),
      wire(B, D)
    ]);
    expect(normalizeSignalLinks([wire(A, B, MAX_PORT)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B, MAX_PORT)]);
  });

  it('keeps a duplicate wire once, with the smallest port, so a XOR keeps its parity', () => {
    expect(normalizeSignalLinks([wire(A, B, 'b'), wire(A, B, 'a'), wire(A, B, 'c')], chain(), 'epoxy', null, lookup)).toEqual([
      wire(A, B, 'a')
    ]);
    expect(normalizeSignalLinks([wire(A, B, 'a'), wire(A, B)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B)]);
    expect(normalizeSignalLinks([wire(A, B), wire(A, B)], chain(), 'epoxy', null, lookup)).toEqual([wire(A, B)]);
  });

  it('sorts by source row, source column, target row, then target column, whatever the input order', () => {
    const terrain = grid([
      [A, PLATE],
      [B, PLATE],
      [{ x: 0, y: 1 }, PLATE],
      [{ x: 2, y: 2 }, GATE_AND],
      [{ x: 4, y: 2 }, GATE_AND]
    ]);
    const links = [
      wire({ x: 0, y: 1 }, { x: 2, y: 2 }),
      wire(B, { x: 4, y: 2 }),
      wire(A, { x: 4, y: 2 }),
      wire(B, { x: 2, y: 2 }),
      wire(A, { x: 2, y: 2 })
    ];
    const expected = [
      wire(A, { x: 2, y: 2 }),
      wire(A, { x: 4, y: 2 }),
      wire(B, { x: 2, y: 2 }),
      wire(B, { x: 4, y: 2 }),
      wire({ x: 0, y: 1 }, { x: 2, y: 2 })
    ];
    expect(normalizeSignalLinks(links, terrain, 'epoxy', null, lookup)).toEqual(expected);
    expect(normalizeSignalLinks([...links].reverse(), terrain, 'epoxy', null, lookup)).toEqual(expected);
  });

  it('keeps a cycle, which the validator refuses later', () => {
    const terrain = grid([[A, GATE_AND], [B, GATE_AND]]);
    expect(normalizeSignalLinks([wire(A, B), wire(B, A)], terrain, 'epoxy', null, lookup)).toEqual([wire(A, B), wire(B, A)]);
  });

  it('only checks the shape without a tile lookup', () => {
    expect(normalizeSignalLinks([wire(A, B), wire(A, A)], grid([]), 'epoxy', null, null)).toEqual([wire(A, B)]);
  });
});

describe('compileSignalSpec', () => {
  it('builds nodes from the tiles and links by cell index', () => {
    const spec = compileSignalSpec({ terrain: chain(), signalLinks: [wire(B, C), wire(A, B, 'in')] }, lookup);
    expect(spec).toEqual({
      nodes: [
        { cell: 0, kind: 'source', sample: 'held' },
        { cell: 1, kind: 'and' },
        { cell: 2, kind: 'sink', color: 'blue' }
      ],
      links: [
        { from: 0, to: 1, port: 'in' },
        { from: 1, to: 2 }
      ]
    });
  });

  it('reads a receiver source, a door colour and a latch that starts on from the tiles', () => {
    const terrain = grid([[A, RECEIVER], [B, GATE_LATCH_ON], [C, DOOR]]);
    const spec = compileSignalSpec({ terrain, signalLinks: [wire(A, B), wire(B, C)] }, lookup);
    expect(spec?.nodes).toEqual([
      { cell: 0, kind: 'source', sample: 'receiver' },
      { cell: 1, kind: 'latch', startBit: true },
      { cell: 2, kind: 'sink', color: 'blue' }
    ]);
  });

  it('uses the width for the cell index and a hidden device under a top', () => {
    const terrain = grid([[{ x: 1, y: 2 }, PLATE], [{ x: 3, y: 4 }, COVER]]);
    const spec = compileSignalSpec(
      { terrain, underlays: [{ x: 3, y: 4, terrain: DOOR }], signalLinks: [wire({ x: 1, y: 2 }, { x: 3, y: 4 })] },
      lookup
    );
    expect(spec).toEqual({
      nodes: [
        { cell: 2 * SIZE + 1, kind: 'source', sample: 'held' },
        { cell: 4 * SIZE + 3, kind: 'sink', color: 'blue' }
      ],
      links: [{ from: 2 * SIZE + 1, to: 4 * SIZE + 3 }]
    });
  });

  it('is undefined without links, with only invalid links and on a non-Epoxy level', () => {
    expect(compileSignalSpec({ terrain: chain() }, lookup)).toBeUndefined();
    expect(compileSignalSpec({ terrain: chain(), signalLinks: [wire(C, A)] }, lookup)).toBeUndefined();
    expect(compileSignalSpec({ terrain: chain(), ruleset: 'lynx', signalLinks: [wire(A, B)] }, lookup)).toBeUndefined();
  });
});

describe('signal links on a stored level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  /** A real laser receiver wired to a real hold door. */
  function wiredLevel() {
    const level = makeLevel('wired');
    level.terrain[1][1] = 'laser_receiver_red';
    level.terrain[3][3] = 'hold_door_red_closed';
    return { ...level, signalLinks: [wire({ x: 1, y: 1 }, { x: 3, y: 3 }, 'door')] };
  }

  it('strips to itself when canonical, and the JSON round trip keeps ports', () => {
    const level = wiredLevel();
    expect(stripInvalidTextFields(level)).toBe(level);
    const back = JSON.parse(JSON.stringify(level));
    expect(back.signalLinks).toEqual(level.signalLinks);
    expect(stripInvalidTextFields(back)).toBe(back);
  });

  it('canonicalizes a stored level with bad wires, and drops the field when none is left', () => {
    const level = wiredLevel();
    const messy = { ...level, signalLinks: [wire({ x: 3, y: 3 }, { x: 1, y: 1 }), ...level.signalLinks, level.signalLinks[0], 'x'] };
    const fixed = stripInvalidTextFields(messy as never);
    expect(fixed.signalLinks).toEqual(level.signalLinks);
    expect(messy.signalLinks).toHaveLength(4);
    const none = stripInvalidTextFields({ ...level, signalLinks: [wire({ x: 3, y: 3 }, { x: 1, y: 1 })] });
    expect('signalLinks' in none).toBe(false);
  });

  it('drops the wires of a non-Epoxy level', () => {
    const lynx = { ...wiredLevel(), ruleset: 'lynx' as const };
    expect('signalLinks' in stripInvalidTextFields(lynx)).toBe(false);
  });

  it('refuses a level holding more wires than four per cell in a strict shape check', () => {
    const level = wiredLevel();
    const bounds = ConfigRegistry.getLevelSizeBounds();
    expect(isCompiledLevelShape(level, bounds, true)).toBe(true);
    const cells = level.terrain.length * level.terrain[0].length;
    const flood = { ...level, signalLinks: Array.from({ length: cells * 4 + 1 }, () => level.signalLinks[0]) };
    expect(isCompiledLevelShape(flood, bounds, true)).toBe(false);
  });
});
