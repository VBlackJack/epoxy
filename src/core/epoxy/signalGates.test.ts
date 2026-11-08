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
import { canonicalSignalPort, formatSignalPort, isSignalPort, parseSignalPort } from '../signalPorts';
import {
  buildSignalNetwork,
  cloneSignalState,
  createSignalState,
  settleSignals,
  type SignalLinkSpec,
  type SignalNetwork,
  type SignalNodeSpec,
  type SignalState
} from './signalNetwork';

const SOURCE_A = 10;
const SOURCE_B = 11;
const GATE = 20;
const SINK = 30;
const SINK_UNDERFLOW = 31;
const SECOND_GATE = 40;
const COUNTER_DIGIT_MAX = 9;

const link = (from: number, to: number, port?: string): SignalLinkSpec => (port === undefined ? { from, to } : { from, to, port });
const levels = (...on: number[]): Map<number, boolean> => new Map<number, boolean>(on.map((cell) => [cell, true]));

/** Settles a network with the sources in `on` and returns the new state and the level of the first sink. */
function settle(network: SignalNetwork, state: SignalState, on: readonly number[], prime = false): { state: SignalState; sink: boolean; sink2: boolean } {
  const result = settleSignals(network, state, levels(...on), prime);
  const sinks = result.sinkOutputs;
  return { state: result.state, sink: sinks[0]?.on ?? false, sink2: sinks[1]?.on ?? false };
}

describe('port names', () => {
  it('reads an input, an output, both, and nothing else', () => {
    expect(parseSignalPort('in0')).toEqual({ in: 0 });
    expect(parseSignalPort('in1')).toEqual({ in: 1 });
    expect(parseSignalPort('out1')).toEqual({ out: 1 });
    expect(parseSignalPort('out1>in0')).toEqual({ out: 1, in: 0 });
    expect(parseSignalPort('in2')).toEqual({});
    expect(parseSignalPort('left')).toEqual({});
    expect(parseSignalPort(undefined)).toEqual({});
    expect(isSignalPort('a')).toBe(false);
    expect(isSignalPort('out0')).toBe(true);
  });

  it('writes a pair back to its text', () => {
    expect(formatSignalPort({})).toBeUndefined();
    expect(formatSignalPort({ in: 1 })).toBe('in1');
    expect(formatSignalPort({ out: 0, in: 1 })).toBe('out0>in1');
    expect(parseSignalPort(formatSignalPort({ out: 1, in: 0 }))).toEqual({ out: 1, in: 0 });
  });
});

describe('canonical ports', () => {
  it('drops the default ports, so in0, out0 and out0>in0 are no port at all', () => {
    for (const text of ['in0', 'out0', 'out0>in0', 'a', undefined]) expect(canonicalSignalPort(text), String(text)).toBeUndefined();
    expect(canonicalSignalPort('out0>in1')).toBe('in1');
    expect(canonicalSignalPort('out1>in0')).toBe('out1');
    expect(canonicalSignalPort('out1>in1')).toBe('out1>in1');
  });
});

describe('NAND gate', () => {
  const network = buildSignalNetwork(
    [
      { cell: SOURCE_A, kind: 'source' },
      { cell: SOURCE_B, kind: 'source' },
      { cell: GATE, kind: 'nand' },
      { cell: SINK, kind: 'sink' }
    ],
    [link(SOURCE_A, GATE), link(SOURCE_B, GATE), link(GATE, SINK)]
  );

  it('follows the NAND truth table', () => {
    const fresh = createSignalState(network);
    expect(settle(network, fresh, []).sink).toBe(true);
    expect(settle(network, fresh, [SOURCE_A]).sink).toBe(true);
    expect(settle(network, fresh, [SOURCE_B]).sink).toBe(true);
    expect(settle(network, fresh, [SOURCE_A, SOURCE_B]).sink).toBe(false);
  });

  it('is unpowered with no input, like every gate', () => {
    const lone = buildSignalNetwork([{ cell: GATE, kind: 'nand' }, { cell: SINK, kind: 'sink' }], [link(GATE, SINK)]);
    expect(settle(lone, createSignalState(lone), []).sink).toBe(false);
  });

  it('adds no counter field to a state without a counter', () => {
    const state = createSignalState(network);
    expect(Object.keys(state).sort()).toEqual(['lastOutputs', 'latchBits']);
    expect(Object.keys(cloneSignalState(state)).sort()).toEqual(['lastOutputs', 'latchBits']);
  });
});

describe('data latch', () => {
  const nodes: SignalNodeSpec[] = [
    { cell: SOURCE_A, kind: 'source' },
    { cell: SOURCE_B, kind: 'source' },
    { cell: GATE, kind: 'dlatch' },
    { cell: SINK, kind: 'sink' }
  ];
  const network = buildSignalNetwork(nodes, [link(SOURCE_A, GATE, 'in0'), link(SOURCE_B, GATE, 'in1'), link(GATE, SINK)]);

  it('copies the data while the clock is on and holds it when the clock is off', () => {
    let state = createSignalState(network);
    // Clock off: data is ignored.
    ({ state } = settle(network, state, [SOURCE_A]));
    expect(settle(network, state, [SOURCE_A]).sink).toBe(false);
    // Clock on with data on: the bit follows.
    let step = settle(network, state, [SOURCE_A, SOURCE_B]);
    expect(step.sink).toBe(true);
    state = step.state;
    // Clock off again: the bit holds although the data drops.
    step = settle(network, state, []);
    expect(step.sink).toBe(true);
    state = step.state;
    // Clock on with data off: the bit follows down.
    step = settle(network, state, [SOURCE_B]);
    expect(step.sink).toBe(false);
  });

  it('is level-sensitive: a clock held on follows the data every settle, where the toggle latch flips once', () => {
    let state = createSignalState(network);
    let step = settle(network, state, [SOURCE_B, SOURCE_A]);
    expect(step.sink).toBe(true);
    state = step.state;
    step = settle(network, state, [SOURCE_B]);
    expect(step.sink).toBe(false);
    state = step.state;
    step = settle(network, state, [SOURCE_B, SOURCE_A]);
    expect(step.sink).toBe(true);
  });

  it('never changes with no clock wire, and a wire with no port is the data', () => {
    const noClock = buildSignalNetwork(nodes, [link(SOURCE_A, GATE), link(GATE, SINK)]);
    const state = createSignalState(noClock);
    expect(settle(noClock, state, [SOURCE_A]).sink).toBe(false);
  });

  it('keeps the toggle latch unchanged: it flips on a rising edge and ignores ports', () => {
    const toggle = buildSignalNetwork(
      [{ cell: SOURCE_A, kind: 'source' }, { cell: GATE, kind: 'latch' }, { cell: SINK, kind: 'sink' }],
      [link(SOURCE_A, GATE, 'in1'), link(GATE, SINK)]
    );
    let state = createSignalState(toggle);
    let step = settle(toggle, state, [SOURCE_A]);
    expect(step.sink).toBe(true);
    state = step.state;
    step = settle(toggle, state, [SOURCE_A]);
    expect(step.sink).toBe(true);
    state = step.state;
    step = settle(toggle, settle(toggle, state, []).state, [SOURCE_A]);
    expect(step.sink).toBe(false);
  });
});

describe('counter', () => {
  const nodes: SignalNodeSpec[] = [
    { cell: SOURCE_A, kind: 'source' },
    { cell: SOURCE_B, kind: 'source' },
    { cell: GATE, kind: 'counter', startValue: COUNTER_DIGIT_MAX },
    { cell: SINK, kind: 'sink' },
    { cell: SINK_UNDERFLOW, kind: 'sink' }
  ];
  const wires = [
    link(SOURCE_A, GATE, 'in0'),
    link(SOURCE_B, GATE, 'in1'),
    link(GATE, SINK, 'out0'),
    link(GATE, SINK_UNDERFLOW, 'out1')
  ];
  const network = buildSignalNetwork(nodes, wires);
  const indexOfCounter = network.indexOfCell.get(GATE) as number;
  const valueOf = (state: SignalState): number => (state.counterValues as number[])[indexOfCounter];

  /** One full pulse of a source: on for a settle, off for the next. */
  function pulse(state: SignalState, source: number): { state: SignalState; overflow: boolean; underflow: boolean } {
    const on = settle(network, state, [source]);
    const off = settle(network, on.state, []);
    return { state: off.state, overflow: on.sink, underflow: on.sink2 };
  }

  it('starts with the authored digit and counts up on a rising edge', () => {
    const state = createSignalState(network);
    expect(valueOf(state)).toBe(COUNTER_DIGIT_MAX);
    const low = buildSignalNetwork(
      [{ cell: SOURCE_A, kind: 'source' }, { cell: GATE, kind: 'counter', startValue: 3 }, { cell: SINK, kind: 'sink' }],
      [link(SOURCE_A, GATE), link(GATE, SINK)]
    );
    const first = settleSignals(low, createSignalState(low), levels(SOURCE_A));
    expect((first.state.counterValues as number[])[low.indexOfCell.get(GATE) as number]).toBe(4);
    // Held on: no second count.
    const held = settleSignals(low, first.state, levels(SOURCE_A));
    expect((held.state.counterValues as number[])[low.indexOfCell.get(GATE) as number]).toBe(4);
  });

  it('wraps from 9 to 0 with a one-settle pulse on out0', () => {
    const state = createSignalState(network);
    const wrap = settle(network, state, [SOURCE_A]);
    expect(valueOf(wrap.state)).toBe(0);
    expect(wrap.sink).toBe(true);
    expect(wrap.sink2).toBe(false);
    // The pulse lasts one settle only.
    const after = settle(network, wrap.state, [SOURCE_A]);
    expect(after.sink).toBe(false);
  });

  it('counts down on in1, wraps below 0 to 9 and holds out1 until the next count', () => {
    let state = createSignalState(network);
    state = pulse(state, SOURCE_A).state;
    expect(valueOf(state)).toBe(0);
    const down = settle(network, state, [SOURCE_B]);
    expect(valueOf(down.state)).toBe(COUNTER_DIGIT_MAX);
    expect(down.sink2).toBe(true);
    expect(down.sink).toBe(false);
    // The underflow output holds while nothing counts.
    const idle = settle(network, down.state, []);
    expect(idle.sink2).toBe(true);
    // The next count clears it.
    const cleared = settle(network, idle.state, [SOURCE_B]);
    expect(valueOf(cleared.state)).toBe(COUNTER_DIGIT_MAX - 1);
    expect(cleared.sink2).toBe(false);
  });

  it('does not count when both inputs rise together', () => {
    const state = createSignalState(network);
    const both = settle(network, state, [SOURCE_A, SOURCE_B]);
    expect(valueOf(both.state)).toBe(COUNTER_DIGIT_MAX);
    expect(both.sink).toBe(false);
  });

  it('counts nothing at the prime settle, and an input already on then is not an edge later', () => {
    const state = createSignalState(network);
    const primed = settle(network, state, [SOURCE_A], true);
    expect(valueOf(primed.state)).toBe(COUNTER_DIGIT_MAX);
    const next = settle(network, primed.state, [SOURCE_A]);
    expect(valueOf(next.state)).toBe(COUNTER_DIGIT_MAX);
  });

  it('puts the count into a cloned state apart from the original (undo)', () => {
    const state = createSignalState(network);
    const copy = cloneSignalState(state);
    const wrap = settle(network, state, [SOURCE_A]);
    expect(valueOf(copy)).toBe(COUNTER_DIGIT_MAX);
    expect(valueOf(wrap.state)).toBe(0);
    expect(valueOf(state)).toBe(COUNTER_DIGIT_MAX);
    expect(copy.counterUnderflow).toEqual(state.counterUnderflow);
    expect(copy.counterUnderflow).not.toBe(state.counterUnderflow);
  });

  it('feeds a second counter from the overflow of the first', () => {
    const chain = buildSignalNetwork(
      [
        { cell: SOURCE_A, kind: 'source' },
        { cell: GATE, kind: 'counter', startValue: COUNTER_DIGIT_MAX },
        { cell: SECOND_GATE, kind: 'counter', startValue: 0 },
        { cell: SINK, kind: 'sink' }
      ],
      [link(SOURCE_A, GATE), link(GATE, SECOND_GATE, 'out0>in0'), link(SECOND_GATE, SINK)]
    );
    const second = chain.indexOfCell.get(SECOND_GATE) as number;
    const result = settleSignals(chain, createSignalState(chain), levels(SOURCE_A));
    expect((result.state.counterValues as number[])[second]).toBe(1);
  });

  it('sends the underflow port only to the wire that names it', () => {
    const odd = buildSignalNetwork(
      [{ cell: SOURCE_B, kind: 'source' }, { cell: GATE, kind: 'counter', startValue: 0 }, { cell: SINK, kind: 'sink' }],
      [link(SOURCE_B, GATE, 'in1'), link(GATE, SINK)]
    );
    // A wire with no output port leaves the overflow output: the underflow does not reach it.
    const result = settleSignals(odd, createSignalState(odd), levels(SOURCE_B));
    expect(result.sinkOutputs[0].on).toBe(false);
  });
});
