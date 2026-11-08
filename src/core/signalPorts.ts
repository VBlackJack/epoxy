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
 * The ports of a signal link. A gate with ordered ports (a data latch: `in0` data, `in1` clock; a counter: `in0` counts
 * up, `in1` counts down, `out0` overflow pulse, `out1` underflow level) reads which of them a wire joins from the `port`
 * of the link. The text is `in0`, `in1` (the input of the gate the link enters), `out0`, `out1` (the output of the
 * counter the link leaves) or an output and an input joined by `>` (`out1>in0`). Anything else names no port. Pure.
 */

import { SIGNAL_PORT_IN_PREFIX, SIGNAL_PORT_JOINER, SIGNAL_PORT_OUT_PREFIX } from './coreConstants';

/** An input or output number of a gate with ordered ports. */
export type SignalPortIndex = 0 | 1;

/** The ports a link names; an absent one means the first. */
export interface SignalPortPair {
  /** The output of the node the link leaves. */
  out?: SignalPortIndex;
  /** The input of the node the link enters. */
  in?: SignalPortIndex;
}

function indexOfPort(token: string, prefix: string): SignalPortIndex | undefined {
  if (!token.startsWith(prefix)) return undefined;
  const digit = token.slice(prefix.length);
  return digit === '0' ? 0 : digit === '1' ? 1 : undefined;
}

/** The ports a link's port text names; tokens that are not ports are ignored. */
export function parseSignalPort(port: string | undefined): SignalPortPair {
  const pair: SignalPortPair = {};
  if (port === undefined) return pair;
  for (const token of port.split(SIGNAL_PORT_JOINER)) {
    const out = indexOfPort(token, SIGNAL_PORT_OUT_PREFIX);
    if (out !== undefined) pair.out = out;
    const input = indexOfPort(token, SIGNAL_PORT_IN_PREFIX);
    if (input !== undefined) pair.in = input;
  }
  return pair;
}

/** Whether the port text names at least one real port. */
export function isSignalPort(port: string | undefined): boolean {
  const pair = parseSignalPort(port);
  return pair.out !== undefined || pair.in !== undefined;
}

/** The port text for an output and an input; undefined when neither is named. */
export function formatSignalPort(pair: SignalPortPair): string | undefined {
  const parts: string[] = [];
  if (pair.out !== undefined) parts.push(`${SIGNAL_PORT_OUT_PREFIX}${pair.out}`);
  if (pair.in !== undefined) parts.push(`${SIGNAL_PORT_IN_PREFIX}${pair.in}`);
  return parts.length === 0 ? undefined : parts.join(SIGNAL_PORT_JOINER);
}
