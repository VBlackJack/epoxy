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
 * A signal network: sources, logic gates, toggle latches and sinks joined by directed links. Pure and
 * engine-free: it knows nothing of the grid, the players or the lasers. A node is named by the index of
 * its cell, and the engine samples its sources and reads its sinks.
 *
 * Rules, all deterministic:
 *  - Nodes are evaluated in a fixed topological order, ties broken by cell index.
 *  - Every node of a cycle (a strongly connected component of more than one node, or a node linked to
 *    itself) outputs off. Nodes downstream of a cycle still evaluate, seeing it off.
 *  - A node reads the outputs of the nodes linked into it. A gate with no input is unpowered and outputs
 *    off, NOT included (the validator will refuse such a gate later). With inputs: AND is all on, OR is
 *    any on, NOT is none on (a NOR when several inputs), XOR is an odd number of inputs on.
 *  - A NAND is off when all its inputs are on, on otherwise (a NAND with no input is unpowered, like every gate).
 *  - A data latch has a data input (port in0, the default) and a clock input (port in1). While the clock is on, its bit
 *    follows the data (the OR of the data wires); the bit is its output and it holds while the clock is off. A latch
 *    with no clock wire never changes. Level-sensitive, unlike the toggle latch.
 *  - A counter holds a digit from 0 to 9 and starts with its authored digit. It counts up on a rising edge of its in0
 *    input and down on a rising edge of its in1 input (both at once: no change). Counting up past 9 wraps to 0 and
 *    pulses out0 for that settle; counting down below 0 wraps to 9 and raises out1, which holds until the next count.
 *    A link leaves out0 unless its port names out1. The prime settle counts nothing.
 *  - A sink outputs on when any input is on, and off with no input. A source outputs the level sampled
 *    for it; links into a source are ignored.
 *  - A toggle latch flips its bit on a rising edge of its input (the input is on, where the last settle
 *    saw it off) and outputs the bit. Its input is the OR of its inputs; a latch with no input holds.
 *    A latch starts with its authored start bit (off by default).
 *  - The first settle of a network, the prime (see settleSignals), only records levels and outputs: no latch
 *    flips and no edge is reported, so an input already on at load changes nothing.
 *  - State arrays are indexed in evaluation order, so changing the ordering rules changes the hash of signal levels.
 *  - A world change caused in the same pass as a settle (a door toggling, then the lasers and turrets) reaches
 *    the network at the next settle, one tick later.
 *  - A settle leaves no memory beyond SignalState: settling again with unchanged sources changes nothing
 *    and reports no edge.
 */

import { SIGNAL_COUNTER_MAX } from '../coreConstants';
import { parseSignalPort } from '../signalPorts';
import type { SignalLinkSpec, SignalNodeKind, SignalNodeSpec, SignalState } from '../types';

export type { SignalLinkSpec, SignalNodeKind, SignalNodeSpec, SignalState };

export const SIGNAL_NODE_KINDS: readonly SignalNodeKind[] = [
  'source',
  'and',
  'or',
  'not',
  'xor',
  'latch',
  'nand',
  'dlatch',
  'counter',
  'sink'
];

export type SignalBuildErrorCode = 'unknown_kind' | 'duplicate_cell' | 'unknown_endpoint';

/** Thrown for a network no validator would have let through: a programming error, not a player message. */
export class SignalBuildError extends Error {
  readonly code: SignalBuildErrorCode;
  readonly cell: number;

  constructor(code: SignalBuildErrorCode, cell: number) {
    super(`signal network: ${code} at cell ${cell}`);
    this.name = 'SignalBuildError';
    this.code = code;
    this.cell = cell;
  }
}

/** One wire into a node, with the ports it joins: the output of the node it leaves (1 only for a counter underflow) and the input it enters. */
export interface SignalWire {
  /** Index (in SignalNetwork.nodes) of the node the wire leaves. */
  from: number;
  /** 1 when the wire leaves the underflow output of a counter, else 0. */
  fromPort: 0 | 1;
  /** 1 when the wire enters the second input (a data latch clock, a counter down), else 0. */
  toPort: 0 | 1;
}

export interface SignalNode extends SignalNodeSpec {
  /** Indexes (in SignalNetwork.nodes) of the nodes linked into this one, ascending, one per link. */
  inputs: number[];
  /** The same links with their ports, ordered by source, then output port, then input port. */
  wires: SignalWire[];
  /** True for a node of a cycle: it outputs off. */
  cyclic: boolean;
}

export interface SignalNetwork {
  /** The nodes in evaluation order. */
  nodes: SignalNode[];
  /** The links, with ports kept as given. */
  links: SignalLinkSpec[];
  /** Node index by cell index. */
  indexOfCell: ReadonlyMap<number, number>;
  /** Indexes of the source nodes, in evaluation order. */
  sourceIndexes: number[];
  /** Indexes of the sink nodes, in evaluation order. */
  sinkIndexes: number[];
  /** The cycles: node indexes of each strongly connected component that loops, in evaluation order. */
  cycles: number[][];
}

export interface SignalSinkOutput {
  cell: number;
  on: boolean;
}

export interface SignalEdge {
  cell: number;
  /** True for off to on, false for on to off. */
  rising: boolean;
}

export interface SettleResult {
  state: SignalState;
  /** Every sink with its level now, in evaluation order. */
  sinkOutputs: SignalSinkOutput[];
  /** The sinks whose level differs from the last settle, in evaluation order. */
  edges: SignalEdge[];
}

/** Strongly connected components by the Tarjan algorithm; returns the component number of each node and each size. */
function stronglyConnected(count: number, successors: readonly (readonly number[])[]): { comp: number[]; size: number[] } {
  const comp: number[] = new Array<number>(count).fill(-1);
  const size: number[] = [];
  const order: number[] = new Array<number>(count).fill(-1);
  const low: number[] = new Array<number>(count).fill(0);
  const onStack: boolean[] = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  let counter = 0;

  const visit = (root: number): void => {
    // Iterative to stay clear of the call-stack limit on a long chain.
    const frames: Array<{ node: number; next: number }> = [{ node: root, next: 0 }];
    order[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const edges = successors[frame.node];
      if (frame.next < edges.length) {
        const target = edges[frame.next++];
        if (order[target] === -1) {
          order[target] = low[target] = counter++;
          stack.push(target);
          onStack[target] = true;
          frames.push({ node: target, next: 0 });
        } else if (onStack[target]) {
          low[frame.node] = Math.min(low[frame.node], order[target]);
        }
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        low[parent] = Math.min(low[parent], low[frame.node]);
      }
      if (low[frame.node] === order[frame.node]) {
        const id = size.length;
        let members = 0;
        let member: number;
        do {
          member = stack.pop() as number;
          onStack[member] = false;
          comp[member] = id;
          members++;
        } while (member !== frame.node);
        size.push(members);
      }
    }
  };

  for (let i = 0; i < count; i++) if (order[i] === -1) visit(i);
  return { comp, size };
}

/**
 * Builds a network: validates the nodes and links, finds the cycles and fixes the evaluation order, a
 * topological order of the components with ties broken by the smallest cell index.
 */
export function buildSignalNetwork(nodeSpecs: readonly SignalNodeSpec[], linkSpecs: readonly SignalLinkSpec[]): SignalNetwork {
  const seen = new Set<number>();
  for (const spec of nodeSpecs) {
    if (!SIGNAL_NODE_KINDS.includes(spec.kind)) throw new SignalBuildError('unknown_kind', spec.cell);
    if (seen.has(spec.cell)) throw new SignalBuildError('duplicate_cell', spec.cell);
    seen.add(spec.cell);
  }
  for (const link of linkSpecs) {
    if (!seen.has(link.from)) throw new SignalBuildError('unknown_endpoint', link.from);
    if (!seen.has(link.to)) throw new SignalBuildError('unknown_endpoint', link.to);
  }

  // Work in cell order, so the result never depends on how the level listed its nodes.
  const sorted = [...nodeSpecs].sort((a, b) => a.cell - b.cell);
  const rawIndex = new Map<number, number>(sorted.map((spec, i) => [spec.cell, i]));
  const count = sorted.length;
  const successors: number[][] = sorted.map(() => []);
  const selfLoop: boolean[] = new Array<boolean>(count).fill(false);
  for (const link of linkSpecs) {
    const from = rawIndex.get(link.from) as number;
    const to = rawIndex.get(link.to) as number;
    successors[from].push(to);
    if (from === to) selfLoop[from] = true;
  }
  for (const list of successors) list.sort((a, b) => a - b);

  const { comp, size } = stronglyConnected(count, successors);
  const looping = size.map(() => false);
  for (let i = 0; i < count; i++) if (size[comp[i]] > 1 || selfLoop[i]) looping[comp[i]] = true;

  // Kahn over the components. A component ranks by its smallest cell; the ready component of least rank goes first.
  const members: number[][] = size.map(() => []);
  for (let i = 0; i < count; i++) members[comp[i]].push(i);
  const pending: number[] = size.map(() => 0);
  const downstream: Array<Set<number>> = size.map(() => new Set<number>());
  for (let from = 0; from < count; from++) {
    for (const to of successors[from]) {
      if (comp[from] !== comp[to] && !downstream[comp[from]].has(comp[to])) {
        downstream[comp[from]].add(comp[to]);
        pending[comp[to]]++;
      }
    }
  }
  const ready: number[] = [];
  for (let c = 0; c < size.length; c++) if (pending[c] === 0) ready.push(c);
  const rank = (c: number): number => members[c][0];
  const componentOrder: number[] = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (rank(ready[i]) < rank(ready[best])) best = i;
    const [c] = ready.splice(best, 1);
    componentOrder.push(c);
    for (const next of downstream[c]) if (--pending[next] === 0) ready.push(next);
  }

  const evaluation: number[] = componentOrder.flatMap((c) => members[c]);
  const position = new Map<number, number>(evaluation.map((raw, i) => [raw, i]));
  const nodes: SignalNode[] = evaluation.map((raw) => ({ ...sorted[raw], inputs: [], wires: [], cyclic: looping[comp[raw]] }));
  for (const link of linkSpecs) {
    const to = position.get(rawIndex.get(link.to) as number) as number;
    const from = position.get(rawIndex.get(link.from) as number) as number;
    nodes[to].inputs.push(from);
    const ports = parseSignalPort(link.port);
    // Only a counter has a second output; a port naming one elsewhere is read as the first.
    nodes[to].wires.push({ from, fromPort: nodes[from].kind === 'counter' && ports.out === 1 ? 1 : 0, toPort: ports.in === 1 ? 1 : 0 });
  }
  for (const node of nodes) {
    node.inputs.sort((a, b) => a - b);
    node.wires.sort((a, b) => a.from - b.from || a.fromPort - b.fromPort || a.toPort - b.toPort);
  }

  const cycles: number[][] = [];
  for (const c of componentOrder) {
    if (looping[c]) cycles.push(members[c].map((raw) => position.get(raw) as number));
  }
  return {
    nodes,
    links: linkSpecs.map((link) => ({ ...link })),
    indexOfCell: new Map<number, number>(nodes.map((node, i) => [node.cell, i])),
    sourceIndexes: nodes.flatMap((node, i) => (node.kind === 'source' ? [i] : [])),
    sinkIndexes: nodes.flatMap((node, i) => (node.kind === 'sink' ? [i] : [])),
    cycles
  };
}

/** The state of a network before its first settle: everything off. */
export function createSignalState(network: SignalNetwork): SignalState {
  const state: SignalState = {
    latchBits: network.nodes.map((node) => node.kind === 'latch' && node.startBit === true),
    lastOutputs: network.nodes.map(() => false)
  };
  // The counter fields exist only in a network that has a counter, so every other state is unchanged.
  if (network.nodes.some((node) => node.kind === 'counter')) {
    state.counterValues = network.nodes.map((node) => (node.kind === 'counter' ? clampCount(node.startValue ?? 0) : 0));
    state.counterUnderflow = network.nodes.map(() => false);
  }
  return state;
}

function clampCount(value: number): number {
  return Math.min(SIGNAL_COUNTER_MAX, Math.max(0, Math.trunc(value)));
}

export function cloneSignalState(state: SignalState): SignalState {
  return {
    latchBits: [...state.latchBits],
    lastOutputs: [...state.lastOutputs],
    ...(state.counterValues !== undefined ? { counterValues: [...state.counterValues] } : {}),
    ...(state.counterUnderflow !== undefined ? { counterUnderflow: [...state.counterUnderflow] } : {})
  };
}

/** The level a gate of this kind outputs for its inputs; a gate with no input is unpowered. */
function gateOutput(kind: SignalNodeKind, inputs: readonly boolean[]): boolean {
  if (inputs.length === 0) return false;
  switch (kind) {
    case 'and':
      return inputs.every(Boolean);
    case 'nand':
      return !inputs.every(Boolean);
    case 'or':
    case 'sink':
      return inputs.some(Boolean);
    case 'not':
      return !inputs.some(Boolean);
    case 'xor':
      return inputs.filter(Boolean).length % 2 === 1;
    default:
      return false;
  }
}

/** The level a wire carries: the output of the node it leaves, or the held underflow of a counter. */
function wireLevel(wire: SignalWire, outputs: readonly boolean[], underflow: readonly boolean[] | undefined): boolean {
  return wire.fromPort === 1 ? underflow?.[wire.from] === true : outputs[wire.from];
}

/**
 * Settles one counter and returns its overflow output. The counting is on the rising edge of each input, read against
 * the levels of the last settle; the prime settle counts nothing. Both inputs rising at once cancel.
 */
function settleCounter(
  node: SignalNode,
  index: number,
  previous: SignalState,
  next: SignalState,
  outputs: readonly boolean[],
  prime: boolean
): boolean {
  const values = next.counterValues as number[];
  const underflow = next.counterUnderflow as boolean[];
  const on = (port: 0 | 1): boolean => node.wires.some((wire) => wire.toPort === port && wireLevel(wire, outputs, underflow));
  const was = (port: 0 | 1): boolean =>
    node.wires.some((wire) => wire.toPort === port && wireLevel(wire, previous.lastOutputs, previous.counterUnderflow));
  const up = !prime && on(0) && !was(0);
  const down = !prime && on(1) && !was(1);
  if (up || down) underflow[index] = false;
  if (up === down) return false;
  if (up) {
    if (values[index] < SIGNAL_COUNTER_MAX) {
      values[index]++;
      return false;
    }
    values[index] = 0;
    return true;
  }
  if (values[index] > 0) {
    values[index]--;
  } else {
    values[index] = SIGNAL_COUNTER_MAX;
    underflow[index] = true;
  }
  return false;
}

/**
 * Settles the network: takes the sampled source levels (by cell index, missing means off), evaluates every
 * node in order and returns the new state, the sink levels and the edges. The given state is not changed.
 * With `prime` (the settle at level load) the levels and outputs are recorded but no latch flips and no edge is reported.
 */
export function settleSignals(
  network: SignalNetwork,
  state: SignalState,
  sourceLevels: ReadonlyMap<number, boolean>,
  prime: boolean = false
): SettleResult {
  const next = cloneSignalState(state);
  const outputs: boolean[] = network.nodes.map(() => false);
  for (let i = 0; i < network.nodes.length; i++) {
    const node = network.nodes[i];
    // A node of a cycle outputs off, and a latch in one holds its bit.
    if (node.cyclic) continue;
    // Each wire carries the output it leaves by: a counter has two (see wireLevel).
    const inputs = node.wires.map((wire) => wireLevel(wire, outputs, next.counterUnderflow));
    switch (node.kind) {
      case 'source':
        outputs[i] = sourceLevels.get(node.cell) === true;
        break;
      case 'latch': {
        // The input of the last settle is read from the stored outputs of the nodes linked in.
        const wasOn = node.wires.some((wire) => wireLevel(wire, state.lastOutputs, state.counterUnderflow));
        if (!prime && inputs.some(Boolean) && !wasOn) next.latchBits[i] = !next.latchBits[i];
        outputs[i] = next.latchBits[i];
        break;
      }
      case 'dlatch': {
        // The clock is the second input; while it is on the bit follows the data (the first input).
        if (node.wires.some((wire) => wire.toPort === 1 && wireLevel(wire, outputs, next.counterUnderflow))) {
          next.latchBits[i] = node.wires.some((wire) => wire.toPort === 0 && wireLevel(wire, outputs, next.counterUnderflow));
        }
        outputs[i] = next.latchBits[i];
        break;
      }
      case 'counter':
        outputs[i] = settleCounter(node, i, state, next, outputs, prime);
        break;
      default:
        outputs[i] = gateOutput(node.kind, inputs);
    }
  }
  const sinkOutputs: SignalSinkOutput[] = [];
  const edges: SignalEdge[] = [];
  for (const i of network.sinkIndexes) {
    const cell = network.nodes[i].cell;
    sinkOutputs.push({ cell, on: outputs[i] });
    if (!prime && outputs[i] !== state.lastOutputs[i]) edges.push({ cell, rising: outputs[i] });
  }
  next.lastOutputs = outputs;
  return { state: next, sinkOutputs, edges };
}
