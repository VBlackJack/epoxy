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
import {
  SIGNAL_NODE_KINDS,
  SignalBuildError,
  buildSignalNetwork,
  cloneSignalState,
  createSignalState,
  settleSignals,
  type SignalLinkSpec,
  type SignalNetwork,
  type SignalNodeKind,
  type SignalNodeSpec,
  type SignalState
} from './signalNetwork';

const SOURCE_A = 10;
const SOURCE_B = 11;
const SOURCE_C = 12;
const GATE = 20;
const SINK = 30;
const TOGGLE = 25;

function node(cell: number, kind: SignalNodeKind): SignalNodeSpec {
  return { cell, kind };
}

function link(from: number, to: number, port?: string): SignalLinkSpec {
  return port === undefined ? { from, to } : { from, to, port };
}

function cellsInOrder(network: SignalNetwork): number[] {
  return network.nodes.map((n) => n.cell);
}

function levels(...on: number[]): Map<number, boolean> {
  return new Map<number, boolean>(on.map((cell) => [cell, true]));
}

/** One gate of the given kind fed by the listed sources, driving one sink. */
function gateNetwork(kind: SignalNodeKind, sources: readonly number[]): SignalNetwork {
  return buildSignalNetwork(
    [...sources.map((cell) => node(cell, 'source')), node(GATE, kind), node(SINK, 'sink')],
    [...sources.map((cell) => link(cell, GATE)), link(GATE, SINK)]
  );
}

function sinkOn(network: SignalNetwork, on: readonly number[]): boolean {
  const result = settleSignals(network, createSignalState(network), levels(...on));
  return result.sinkOutputs[0].on;
}

describe('signal network: build', () => {
  it('refuses an unknown node kind, a duplicate cell and a dangling link', () => {
    expect(() => buildSignalNetwork([node(1, 'bogus' as SignalNodeKind)], [])).toThrow(SignalBuildError);
    expect(() => buildSignalNetwork([node(1, 'and'), node(1, 'or')], [])).toThrow(SignalBuildError);
    expect(() => buildSignalNetwork([node(1, 'and')], [link(1, 2)])).toThrow(SignalBuildError);
    expect(() => buildSignalNetwork([node(1, 'and')], [link(3, 1)])).toThrow(SignalBuildError);
    try {
      buildSignalNetwork([node(1, 'bogus' as SignalNodeKind)], []);
    } catch (error) {
      expect((error as SignalBuildError).code).toBe('unknown_kind');
    }
  });

  it('accepts every declared kind', () => {
    const specs = SIGNAL_NODE_KINDS.map((kind, i) => node(i, kind));
    expect(buildSignalNetwork(specs, []).nodes).toHaveLength(SIGNAL_NODE_KINDS.length);
  });

  it('keeps the port of a link and ignores it for the order', () => {
    const withPort = buildSignalNetwork([node(1, 'source'), node(2, 'sink')], [link(1, 2, 'left')]);
    const without = buildSignalNetwork([node(1, 'source'), node(2, 'sink')], [link(1, 2)]);
    expect(withPort.links[0].port).toBe('left');
    expect(cellsInOrder(withPort)).toEqual(cellsInOrder(without));
  });

  it('works on an empty network', () => {
    const network = buildSignalNetwork([], []);
    const result = settleSignals(network, createSignalState(network), new Map());
    expect(result.sinkOutputs).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('signal network: order', () => {
  it('puts a node after everything linked into it, whatever the cell numbers say', () => {
    // The sink has the smallest cell, the source the largest: the order must still run source, gate, sink.
    const network = buildSignalNetwork(
      [node(1, 'sink'), node(50, 'source'), node(25, 'and')],
      [link(50, 25), link(25, 1)]
    );
    expect(cellsInOrder(network)).toEqual([50, 25, 1]);
  });

  it('breaks ties by cell index', () => {
    const network = buildSignalNetwork(
      [node(9, 'source'), node(3, 'source'), node(7, 'source'), node(5, 'source')],
      []
    );
    expect(cellsInOrder(network)).toEqual([3, 5, 7, 9]);
  });

  it('breaks ties among ready nodes by cell index while respecting links', () => {
    const network = buildSignalNetwork(
      [node(8, 'source'), node(2, 'sink'), node(4, 'source'), node(6, 'or')],
      [link(8, 6), link(6, 2)]
    );
    // 4 and 8 are ready first (4 wins), then 8, then 6, which frees 2.
    expect(cellsInOrder(network)).toEqual([4, 8, 6, 2]);
  });

  it('does not depend on the order the nodes and links are listed in', () => {
    const nodes = [node(5, 'sink'), node(2, 'or'), node(9, 'source'), node(1, 'source'), node(7, 'not')];
    const links = [link(9, 7), link(1, 2), link(7, 2), link(2, 5)];
    const reference = cellsInOrder(buildSignalNetwork(nodes, links));
    expect(cellsInOrder(buildSignalNetwork([...nodes].reverse(), [...links].reverse()))).toEqual(reference);
    expect(reference.indexOf(2)).toBeGreaterThan(reference.indexOf(7));
    expect(reference.indexOf(5)).toBe(reference.length - 1);
  });

  it('gives the same network on every build', () => {
    const nodes = [node(3, 'source'), node(1, 'or'), node(2, 'sink')];
    const links = [link(3, 1), link(1, 2)];
    expect(buildSignalNetwork(nodes, links)).toEqual(buildSignalNetwork(nodes, links));
  });

  it('indexes sources, sinks and cells', () => {
    const network = gateNetwork('and', [SOURCE_A, SOURCE_B]);
    expect(network.sourceIndexes.map((i) => network.nodes[i].cell)).toEqual([SOURCE_A, SOURCE_B]);
    expect(network.sinkIndexes.map((i) => network.nodes[i].cell)).toEqual([SINK]);
    expect(network.nodes[network.indexOfCell.get(GATE) as number].kind).toBe('and');
  });
});

describe('signal network: cycles', () => {
  it('finds no cycle in a chain', () => {
    const network = gateNetwork('or', [SOURCE_A]);
    expect(network.cycles).toEqual([]);
    expect(network.nodes.every((n) => !n.cyclic)).toBe(true);
  });

  it('turns every node of a two-gate cycle off, even with the sources on', () => {
    const network = buildSignalNetwork(
      [node(1, 'source'), node(2, 'or'), node(3, 'or'), node(4, 'sink')],
      [link(1, 2), link(2, 3), link(3, 2), link(3, 4)]
    );
    expect(network.cycles).toHaveLength(1);
    expect(network.cycles[0].map((i) => network.nodes[i].cell).sort()).toEqual([2, 3]);
    const result = settleSignals(network, createSignalState(network), levels(1));
    const byCell = (cell: number): boolean => result.state.lastOutputs[network.indexOfCell.get(cell) as number];
    expect(byCell(1)).toBe(true);
    expect(byCell(2)).toBe(false);
    expect(byCell(3)).toBe(false);
    expect(byCell(4)).toBe(false);
  });

  it('treats a self-loop as a cycle', () => {
    const network = buildSignalNetwork([node(1, 'source'), node(2, 'or'), node(3, 'sink')], [link(1, 2), link(2, 2), link(2, 3)]);
    expect(network.cycles).toHaveLength(1);
    expect(network.nodes[network.indexOfCell.get(2) as number].cyclic).toBe(true);
    expect(settleSignals(network, createSignalState(network), levels(1)).sinkOutputs[0].on).toBe(false);
  });

  it('keeps a NOT inside a cycle off instead of oscillating', () => {
    const network = buildSignalNetwork([node(1, 'not'), node(2, 'not'), node(3, 'sink')], [link(1, 2), link(2, 1), link(2, 3)]);
    const first = settleSignals(network, createSignalState(network), new Map());
    const second = settleSignals(network, first.state, new Map());
    for (const result of [first, second]) {
      expect(result.state.lastOutputs).toEqual([false, false, false]);
      expect(result.sinkOutputs[0].on).toBe(false);
    }
    expect(second.edges).toEqual([]);
  });

  it('keeps a NOT that feeds its own input off', () => {
    const network = buildSignalNetwork([node(1, 'not'), node(2, 'sink')], [link(1, 1), link(1, 2)]);
    expect(settleSignals(network, createSignalState(network), new Map()).sinkOutputs[0].on).toBe(false);
  });

  it('evaluates a node downstream of a cycle as if the cycle were off', () => {
    const network = buildSignalNetwork(
      [node(1, 'or'), node(2, 'or'), node(3, 'not'), node(4, 'sink')],
      [link(1, 2), link(2, 1), link(2, 3), link(3, 4)]
    );
    expect(settleSignals(network, createSignalState(network), new Map()).sinkOutputs[0].on).toBe(true);
  });

  it('lets an upstream node feed a cycle without joining it', () => {
    const network = buildSignalNetwork(
      [node(1, 'source'), node(2, 'or'), node(3, 'or')],
      [link(1, 2), link(2, 3), link(3, 2)]
    );
    expect(network.nodes[network.indexOfCell.get(1) as number].cyclic).toBe(false);
    expect(cellsInOrder(network)[0]).toBe(1);
  });

  it('holds the bit of a latch caught in a cycle', () => {
    const network = buildSignalNetwork(
      [node(1, 'source'), node(2, 'latch'), node(3, 'or'), node(4, 'sink')],
      [link(1, 2), link(2, 3), link(3, 2), link(3, 4)]
    );
    const state = settleSignals(network, createSignalState(network), levels(1)).state;
    expect(state.latchBits.every((bit) => !bit)).toBe(true);
    expect(buildSignalNetwork([node(2, 'latch')], []).nodes[0].cyclic).toBe(false);
  });
});

describe('signal network: gate truth tables', () => {
  const rows: Array<[SignalNodeKind, boolean[]]> = [
    // Outputs for inputs (A, B) = (off,off), (on,off), (off,on), (on,on).
    ['and', [false, false, false, true]],
    ['or', [false, true, true, true]],
    ['xor', [false, true, true, false]],
    ['not', [true, false, false, false]],
    ['sink', [false, true, true, true]]
  ];

  it.each(rows)('%s of two inputs', (kind, expected) => {
    const network = gateNetwork(kind, [SOURCE_A, SOURCE_B]);
    const inputs: number[][] = [[], [SOURCE_A], [SOURCE_B], [SOURCE_A, SOURCE_B]];
    expect(inputs.map((on) => sinkOn(network, on))).toEqual(expected);
  });

  it('NOT of one input inverts it', () => {
    const network = gateNetwork('not', [SOURCE_A]);
    expect(sinkOn(network, [])).toBe(true);
    expect(sinkOn(network, [SOURCE_A])).toBe(false);
  });

  it('XOR of three inputs is odd parity', () => {
    const network = gateNetwork('xor', [SOURCE_A, SOURCE_B, SOURCE_C]);
    expect(sinkOn(network, [SOURCE_A])).toBe(true);
    expect(sinkOn(network, [SOURCE_A, SOURCE_B])).toBe(false);
    expect(sinkOn(network, [SOURCE_A, SOURCE_B, SOURCE_C])).toBe(true);
  });

  it.each(['and', 'or', 'not', 'xor'] as const)('an unlinked %s gate outputs off, NOT included', (kind) => {
    const network = buildSignalNetwork([node(GATE, kind), node(SINK, 'sink')], [link(GATE, SINK)]);
    expect(settleSignals(network, createSignalState(network), new Map()).sinkOutputs[0].on).toBe(false);
  });

  it('an unlinked sink is off', () => {
    const network = buildSignalNetwork([node(SINK, 'sink')], []);
    expect(settleSignals(network, createSignalState(network), levels(SINK)).sinkOutputs[0].on).toBe(false);
  });

  it('a source ignores the links into it', () => {
    const network = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(SOURCE_B, 'source'), node(SINK, 'sink')],
      [link(SOURCE_A, SOURCE_B), link(SOURCE_B, SINK)]
    );
    expect(sinkOn(network, [SOURCE_A])).toBe(false);
    expect(sinkOn(network, [SOURCE_B])).toBe(true);
  });

  it('two links from one node count as two inputs', () => {
    const network = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(GATE, 'xor'), node(SINK, 'sink')],
      [link(SOURCE_A, GATE, 'one'), link(SOURCE_A, GATE, 'two'), link(GATE, SINK)]
    );
    expect(sinkOn(network, [SOURCE_A])).toBe(false);
  });

  it('chains gates in one settle', () => {
    // NOT(AND(A, B)) -> sink
    const network = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(SOURCE_B, 'source'), node(GATE, 'and'), node(TOGGLE + 1, 'not'), node(SINK, 'sink')],
      [link(SOURCE_A, GATE), link(SOURCE_B, GATE), link(GATE, TOGGLE + 1), link(TOGGLE + 1, SINK)]
    );
    expect(sinkOn(network, [SOURCE_A])).toBe(true);
    expect(sinkOn(network, [SOURCE_A, SOURCE_B])).toBe(false);
  });
});

describe('signal network: toggle latch', () => {
  const network = buildSignalNetwork(
    [node(SOURCE_A, 'source'), node(TOGGLE, 'latch'), node(SINK, 'sink')],
    [link(SOURCE_A, TOGGLE), link(TOGGLE, SINK)]
  );

  function step(state: SignalState, on: boolean) {
    return settleSignals(network, state, on ? levels(SOURCE_A) : new Map());
  }

  it('flips once per rising edge of its input and holds in between', () => {
    let state = createSignalState(network);
    const seen: boolean[] = [];
    for (const on of [false, true, true, true, false, false, true, false, true]) {
      const result = step(state, on);
      state = result.state;
      seen.push(result.sinkOutputs[0].on);
    }
    expect(seen).toEqual([false, true, true, true, true, true, false, false, true]);
  });

  it('does not flip when settled again with the input still on', () => {
    const first = step(createSignalState(network), true);
    const again = step(first.state, true);
    expect(again.sinkOutputs[0].on).toBe(true);
    expect(again.edges).toEqual([]);
    expect(again.state).toEqual(first.state);
  });

  it('does not flip on a prime settle, nor when the input stays on after it', () => {
    const primed = settleSignals(network, createSignalState(network), levels(SOURCE_A), true);
    expect(primed.sinkOutputs[0].on).toBe(false);
    expect(primed.edges).toEqual([]);
    expect(step(primed.state, true).sinkOutputs[0].on).toBe(false);
    // The next rising edge flips it.
    const low = step(primed.state, false);
    expect(step(low.state, true).sinkOutputs[0].on).toBe(true);
  });

  it('starts with its authored bit', () => {
    const authored = buildSignalNetwork(
      [node(SOURCE_A, 'source'), { cell: TOGGLE, kind: 'latch', startBit: true }, node(SINK, 'sink')],
      [link(SOURCE_A, TOGGLE), link(TOGGLE, SINK)]
    );
    const state = createSignalState(authored);
    expect(state.latchBits.filter(Boolean)).toHaveLength(1);
    const primed = settleSignals(authored, state, new Map(), true);
    expect(primed.sinkOutputs[0].on).toBe(true);
    expect(primed.edges).toEqual([]);
    // One rising edge flips it off.
    expect(settleSignals(authored, primed.state, levels(SOURCE_A)).sinkOutputs[0].on).toBe(false);
  });

  it('a latch with a start bit and no input keeps it', () => {
    const alone = buildSignalNetwork([{ cell: TOGGLE, kind: 'latch', startBit: true }, node(SINK, 'sink')], [link(TOGGLE, SINK)]);
    const result = settleSignals(alone, createSignalState(alone), new Map());
    expect(result.sinkOutputs[0].on).toBe(true);
  });

  it('holds with no input', () => {
    const alone = buildSignalNetwork([node(TOGGLE, 'latch'), node(SINK, 'sink')], [link(TOGGLE, SINK)]);
    const result = settleSignals(alone, createSignalState(alone), new Map());
    expect(result.sinkOutputs[0].on).toBe(false);
  });

  it('reads the OR of several inputs as its input', () => {
    const two = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(SOURCE_B, 'source'), node(TOGGLE, 'latch'), node(SINK, 'sink')],
      [link(SOURCE_A, TOGGLE), link(SOURCE_B, TOGGLE), link(TOGGLE, SINK)]
    );
    let state = createSignalState(two);
    state = settleSignals(two, state, levels(SOURCE_A)).state;
    // B rises while A is still on: the OR did not rise, so no flip.
    const result = settleSignals(two, state, levels(SOURCE_A, SOURCE_B));
    expect(result.sinkOutputs[0].on).toBe(true);
    expect(result.edges).toEqual([]);
  });

  it('can drive another latch', () => {
    const second = TOGGLE + 1;
    const chain = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(TOGGLE, 'latch'), node(second, 'latch'), node(SINK, 'sink')],
      [link(SOURCE_A, TOGGLE), link(TOGGLE, second), link(second, SINK)]
    );
    let state = createSignalState(chain);
    state = settleSignals(chain, state, levels(SOURCE_A)).state; // first latch on, second flips on
    state = settleSignals(chain, state, new Map()).state; // first stays on, input of the second unchanged
    const result = settleSignals(chain, state, levels(SOURCE_A)); // first latch off: falling input, no flip
    expect(result.sinkOutputs[0].on).toBe(true);
  });
});

describe('signal network: edges and idempotence', () => {
  const network = gateNetwork('and', [SOURCE_A, SOURCE_B]);

  it('reports a rising edge, then a falling edge, each once', () => {
    let state = createSignalState(network);
    const rise = settleSignals(network, state, levels(SOURCE_A, SOURCE_B));
    expect(rise.edges).toEqual([{ cell: SINK, rising: true }]);
    state = rise.state;
    const hold = settleSignals(network, state, levels(SOURCE_A, SOURCE_B));
    expect(hold.edges).toEqual([]);
    const fall = settleSignals(network, hold.state, levels(SOURCE_A));
    expect(fall.edges).toEqual([{ cell: SINK, rising: false }]);
    expect(settleSignals(network, fall.state, levels(SOURCE_A)).edges).toEqual([]);
  });

  it('settling twice with unchanged inputs gives the same state and no second edge', () => {
    const first = settleSignals(network, createSignalState(network), levels(SOURCE_A, SOURCE_B));
    const second = settleSignals(network, first.state, levels(SOURCE_A, SOURCE_B));
    expect(second.state).toEqual(first.state);
    expect(second.edges).toEqual([]);
    expect(second.sinkOutputs).toEqual(first.sinkOutputs);
  });

  it('reports no edge for a change that does not reach a sink', () => {
    const result = settleSignals(network, createSignalState(network), levels(SOURCE_A));
    expect(result.edges).toEqual([]);
    expect(result.state.lastOutputs[network.indexOfCell.get(SOURCE_A) as number]).toBe(true);
  });

  it('reports a NOT that is on at the first settle as a rising edge, but not on a prime settle', () => {
    const inverter = gateNetwork('not', [SOURCE_A]);
    expect(settleSignals(inverter, createSignalState(inverter), new Map()).edges).toEqual([{ cell: SINK, rising: true }]);
    const primed = settleSignals(inverter, createSignalState(inverter), new Map(), true);
    expect(primed.edges).toEqual([]);
    expect(primed.sinkOutputs[0].on).toBe(true);
    expect(settleSignals(inverter, primed.state, new Map()).edges).toEqual([]);
  });

  it('does not change the state it is given', () => {
    const state = createSignalState(network);
    const before = cloneSignalState(state);
    settleSignals(network, state, levels(SOURCE_A, SOURCE_B));
    expect(state).toEqual(before);
  });

  it('is deterministic: the same inputs always give the same result', () => {
    const script = [[SOURCE_A], [SOURCE_A, SOURCE_B], [], [SOURCE_B], [SOURCE_A, SOURCE_B]];
    const run = (): unknown[] => {
      let state = createSignalState(network);
      return script.map((on) => {
        const result = settleSignals(network, state, levels(...on));
        state = result.state;
        return { state: cloneSignalState(result.state), sinks: result.sinkOutputs, edges: result.edges };
      });
    };
    expect(run()).toEqual(run());
  });

  it('reports one edge per sink in evaluation order', () => {
    const two = buildSignalNetwork(
      [node(SOURCE_A, 'source'), node(40, 'sink'), node(31, 'sink')],
      [link(SOURCE_A, 40), link(SOURCE_A, 31)]
    );
    expect(settleSignals(two, createSignalState(two), levels(SOURCE_A)).edges).toEqual([
      { cell: 31, rising: true },
      { cell: 40, rising: true }
    ]);
  });
});
