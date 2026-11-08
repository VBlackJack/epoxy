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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { parseSignalPort } from '../core/signalPorts';
import type { SignalPortIndex } from '../core/signalPorts';

/**
 * What each port of a gate with ordered ports does, as locale keys the editor translates: the inputs of a data latch
 * (data, clock) and of a counter (count up, count down), the outputs of a counter (overflow pulse, underflow level).
 * Pure.
 */

/** The gate kinds (see TileDefinition.signalGate) whose ports are ordered. */
export const GATE_KIND_DLATCH = 'dlatch';
export const GATE_KIND_COUNTER = 'counter';

/** The role a port plays, by name. */
export type SignalPortRole = 'data' | 'clock' | 'count_up' | 'count_down' | 'overflow' | 'underflow';

/** Which side of a gate a port sits on. */
export type SignalPortSide = 'input' | 'output';

/** Locale key of the long name of each role (literal keys, so the locale checks see them). */
export const PORT_ROLE_LABEL_KEYS: Readonly<Record<SignalPortRole, string>> = {
  data: 'editor.signal_ports.data.label',
  clock: 'editor.signal_ports.clock.label',
  count_up: 'editor.signal_ports.count_up.label',
  count_down: 'editor.signal_ports.count_down.label',
  overflow: 'editor.signal_ports.overflow.label',
  underflow: 'editor.signal_ports.underflow.label'
};

/** Locale key of the short tag of each role, drawn next to the end of a wire on the map. */
export const PORT_ROLE_TAG_KEYS: Readonly<Record<SignalPortRole, string>> = {
  data: 'editor.signal_ports.data.tag',
  clock: 'editor.signal_ports.clock.tag',
  count_up: 'editor.signal_ports.count_up.tag',
  count_down: 'editor.signal_ports.count_down.tag',
  overflow: 'editor.signal_ports.overflow.tag',
  underflow: 'editor.signal_ports.underflow.tag'
};

export const SIGNAL_PORT_KEYS = {
  both: 'editor.signal_ports.both.label',
  swapActionInput: 'editor.signal_ports.swap.action_input',
  swapActionOutput: 'editor.signal_ports.swap.action_output',
  swapAriaInput: 'editor.signal_ports.swap.aria_input',
  swapAriaOutput: 'editor.signal_ports.swap.aria_output',
  swapDone: 'editor.signal_ports.swap.done',
  speechInput: 'editor.cell_speech.port_input.label',
  speechOutput: 'editor.cell_speech.port_output.label'
} as const;

const INPUT_ROLES: Readonly<Record<string, readonly [SignalPortRole, SignalPortRole]>> = {
  [GATE_KIND_DLATCH]: ['data', 'clock'],
  [GATE_KIND_COUNTER]: ['count_up', 'count_down']
};

const OUTPUT_ROLES: Readonly<Record<string, readonly [SignalPortRole, SignalPortRole]>> = {
  [GATE_KIND_COUNTER]: ['overflow', 'underflow']
};

/** The signal gate kind of a tile id, or undefined when the tile is not a gate. */
export function gateKindOfTile(tileId: string | undefined): string | undefined {
  return tileId === undefined ? undefined : ConfigRegistry.getTile(tileId).signalGate;
}

/** Whether a gate kind has ordered ports on that side. */
export function gateHasPorts(kind: string | undefined, side: SignalPortSide): boolean {
  return kind !== undefined && (side === 'input' ? INPUT_ROLES : OUTPUT_ROLES)[kind] !== undefined;
}

/** The role of a port of a gate kind, or undefined when the gate has no ordered ports on that side. */
export function portRole(kind: string | undefined, side: SignalPortSide, index: SignalPortIndex): SignalPortRole | undefined {
  if (kind === undefined) return undefined;
  return (side === 'input' ? INPUT_ROLES : OUTPUT_ROLES)[kind]?.[index];
}

/** The roles a wire has at each end: the output of the gate it leaves and the input of the gate it enters. */
export interface WirePortRoles {
  out?: SignalPortRole;
  in?: SignalPortRole;
}

/** The roles of the ends of a wire with that port text, given the gate kind at each end. */
export function wirePortRoles(port: string | undefined, fromKind: string | undefined, toKind: string | undefined): WirePortRoles {
  const pair = parseSignalPort(port);
  const out = portRole(fromKind, 'output', pair.out ?? 0);
  const input = portRole(toKind, 'input', pair.in ?? 0);
  return { ...(out !== undefined ? { out } : {}), ...(input !== undefined ? { in: input } : {}) };
}
