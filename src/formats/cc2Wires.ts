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

import type { SignalLink } from '../core/types';
import type { Cc2Map } from './cc2Model';
import { Cc2Layer } from './cc2Model';
import { cc2TileInfo } from './cc2TileTable';

/**
 * CC2 wires as topology. A wire is an overlay on a cell: the low nibble of the cell modifier names the sides the wire
 * leaves by (N, E, S, W = 1, 2, 4, 8) and the high nibble marks the sides that dive into a tunnel. The network of a
 * wire is the flood fill of wire cells joined side to side; a cell with all four sides is a crossing, whose two axes
 * stay apart; a tunnel joins two cells of the same row or column the way brackets match. The devices on the networks
 * are the sources (pink button), the gates, and the sinks. Only the connections are modelled, never the timing: a
 * level with wires is approximate in coverage, and a replay decides whether that is enough.
 *
 * Facts checked on the 200 official levels: tunnel bits are always a subset of the wire bits of the cell; a gate has
 * its output on the side it faces and its inputs on the two sides next to it (a NOT gate: the side behind it); the
 * gate modifier is the gate kind plus the facing (N, E, S, W = 0..3). The kind values below are read from the shape of
 * the neighbouring wires and are not verified against a CC2 reference; the unknown ones are kept as opaque gates.
 */

/** The four sides, in the order of the wire bits. */
export const SIDE_COUNT = 4;
const SIDE_N = 0;
const SIDE_E = 1;
const SIDE_S = 2;
const SIDE_W = 3;
const SIDE_OFFSETS_X: readonly number[] = [0, 1, 0, -1];
const SIDE_OFFSETS_Y: readonly number[] = [-1, 0, 1, 0];
const OPPOSITE_STEP = 2;
const RIGHT_STEP = 1;
const LEFT_STEP = 3;
const WIRE_NIBBLE_MASK = 0x0f;
const TUNNEL_SHIFT = 4;
const ALL_SIDES_MASK = 0x0f;
/** Axis groups of a crossing: north-south and east-west. */
const GROUP_MAIN = 0;
const GROUP_CROSS = 1;
const GROUPS_PER_CELL = 2;

/** Tile codes that carry a wire mask as their modifier. */
const CODE_FLOOR = 0x01;
const CODE_STEEL_WALL = 0x50;
const CODE_PINK_BUTTON = 0x5e;
const CODE_BLACK_BUTTON = 0x87;
const CODE_TOGGLE_SWITCH_OFF = 0x88;
const CODE_TOGGLE_SWITCH_ON = 0x89;
const CODE_LOGIC_GATE = 0x5c;
const CODE_TELEPORT_FIRST = 0x10;
const CODE_TELEPORT_LAST = 0x13;
const CODE_TRANSMOGRIFIER = 0x4e;
/** Sinks and devices that take a wire from any side (no mask of their own). */
const CODE_CLONER_CC1 = 0x43;
const CODE_CLONER = 0x44;
const CODE_TRAP = 0x42;
const CODE_OPEN_TRAP = 0x41;
const CODE_FLAME_JET_OFF = 0x5f;
const CODE_FLAME_JET_ON = 0x60;
const CODE_PURPLE_FLOOR = 0x72;
const CODE_PURPLE_WALL = 0x73;

/** Kinds of a logic gate, as the modifier names them. */
export type Cc2GateKind = 'not' | 'and' | 'or' | 'xor' | 'latch' | 'nand' | 'counter' | 'unknown';

/** Gate kind values: the modifier with its two low bits (the facing) cleared. */
const GATE_BASE_NOT = 0x00;
const GATE_BASE_AND = 0x04;
const GATE_BASE_OR = 0x08;
const GATE_BASE_XOR = 0x0c;
const GATE_BASE_LATCH = 0x10;
const GATE_BASE_NAND = 0x14;
/** Unverified: the reversed latch may use another value (0x40..0x43). */
const GATE_BASE_LATCH_REVERSED = 0x18;
const GATE_FACING_MASK = 0x03;
const GATE_BASE_MASK = 0xfc;
/** The counter gates are the ten values 0x1e..0x27 (the digit shown), and have no facing. */
const GATE_COUNTER_FIRST = 0x1e;
const GATE_COUNTER_LAST = 0x27;

const GATE_BASE_KIND: ReadonlyMap<number, Cc2GateKind> = new Map<number, Cc2GateKind>([
  [GATE_BASE_NOT, 'not'],
  [GATE_BASE_AND, 'and'],
  [GATE_BASE_OR, 'or'],
  [GATE_BASE_XOR, 'xor'],
  [GATE_BASE_LATCH, 'latch'],
  [GATE_BASE_NAND, 'nand'],
  [GATE_BASE_LATCH_REVERSED, 'latch']
]);

export interface Cc2Gate {
  kind: Cc2GateKind;
  /** Side the gate outputs to (0 N, 1 E, 2 S, 3 W); undefined for a counter or an unknown kind. */
  facing?: number;
}

/** Decodes the modifier of a logic gate tile (none means 0: a NOT gate facing north). */
export function decodeCc2Gate(mod: number | undefined): Cc2Gate {
  const value = mod ?? 0;
  if (value >= GATE_COUNTER_FIRST && value <= GATE_COUNTER_LAST) return { kind: 'counter' };
  const kind = GATE_BASE_KIND.get(value & GATE_BASE_MASK);
  return kind === undefined ? { kind: 'unknown' } : { kind, facing: value & GATE_FACING_MASK };
}

/** What a cell is to the wires. */
type Role = 'wire' | 'source' | 'gate' | 'sink';

/** What a node is in a report. */
export type Cc2WireNodeKind =
  | 'pink_button'
  | 'toggle_switch'
  | 'black_button'
  | 'logic_gate'
  | 'cloner'
  | 'trap'
  | 'flame_jet'
  | 'purple'
  | 'teleport'
  | 'transmogrifier';

interface CellInfo {
  role: Role;
  kind?: Cc2WireNodeKind;
  /** Whether Epoxy plays this node (so a link may start or end there). */
  supported: boolean;
  /** Wire sides the device uses; ALL_SIDES_MASK for a device that takes a wire from any side. */
  mask: number;
  tunnels: number;
  gate?: Cc2Gate;
}

/** A device the wires touch that Epoxy cannot play as a link end. */
export interface Cc2UnsupportedNode {
  x: number;
  y: number;
  kind: Cc2WireNodeKind;
  /** 'source' feeds a network, 'sink' is fed by one. */
  end: 'source' | 'sink';
}

export interface Cc2WireResult {
  /** Signal links in canonical order, from supported sources and gates to supported gates and sinks. */
  links: SignalLink[];
  /** Whether any cell carries a wire. */
  hasWires: boolean;
  /** Whether any cell carries a tunnel bit. */
  hasTunnels: boolean;
  /** Cells of the devices a wire reaches as an input (sinks), sorted by place: the cells whose tile may need its wired form. */
  wiredSinks: Array<{ x: number; y: number }>;
  /** Devices on a network that Epoxy cannot play, sorted by place. */
  unsupported: Cc2UnsupportedNode[];
  /** Human-readable notes (tunnel without a partner, gate of unknown kind). */
  warnings: string[];
}

function terrainTile(cell: { tiles: { code: number; mod?: number }[] }): { code: number; mod?: number } | undefined {
  for (let i = cell.tiles.length - 1; i >= 0; i--) {
    if (cc2TileInfo(cell.tiles[i].code)?.layer === Cc2Layer.Terrain) return cell.tiles[i];
  }
  return undefined;
}

function classify(code: number, mod: number | undefined): CellInfo | null {
  const wires = (mod ?? 0) & WIRE_NIBBLE_MASK;
  const tunnels = ((mod ?? 0) >> TUNNEL_SHIFT) & WIRE_NIBBLE_MASK;
  if (code === CODE_FLOOR || code === CODE_STEEL_WALL) {
    return wires === 0 ? null : { role: 'wire', supported: true, mask: wires, tunnels };
  }
  if (code === CODE_PINK_BUTTON) return { role: 'source', kind: 'pink_button', supported: true, mask: wires, tunnels: 0 };
  if (code === CODE_TOGGLE_SWITCH_OFF || code === CODE_TOGGLE_SWITCH_ON) {
    return { role: 'source', kind: 'toggle_switch', supported: true, mask: wires, tunnels: 0 };
  }
  if (code === CODE_BLACK_BUTTON) return { role: 'source', kind: 'black_button', supported: true, mask: wires, tunnels: 0 };
  if (code === CODE_LOGIC_GATE) {
    const gate = decodeCc2Gate(mod);
    const supported = gate.kind !== 'nand' && gate.kind !== 'counter' && gate.kind !== 'unknown';
    return { role: 'gate', kind: 'logic_gate', supported, mask: ALL_SIDES_MASK, tunnels: 0, gate };
  }
  if (code === CODE_CLONER || code === CODE_CLONER_CC1) {
    // The modifier of a clone machine holds its arrow, not wires: it takes a wire from any side.
    return { role: 'sink', kind: 'cloner', supported: true, mask: ALL_SIDES_MASK, tunnels: 0 };
  }
  // Green toggle walls are not wire devices in CC2 (only the green button flips them); purple walls are the wired toggles.
  if (code === CODE_TRAP || code === CODE_OPEN_TRAP) {
    return { role: 'sink', kind: 'trap', supported: true, mask: ALL_SIDES_MASK, tunnels: 0 };
  }
  if (code === CODE_FLAME_JET_OFF || code === CODE_FLAME_JET_ON) {
    return { role: 'sink', kind: 'flame_jet', supported: true, mask: ALL_SIDES_MASK, tunnels: 0 };
  }
  if (code === CODE_PURPLE_FLOOR || code === CODE_PURPLE_WALL) {
    return { role: 'sink', kind: 'purple', supported: true, mask: ALL_SIDES_MASK, tunnels: 0 };
  }
  if (code >= CODE_TELEPORT_FIRST && code <= CODE_TELEPORT_LAST) {
    return wires === 0 ? null : { role: 'sink', kind: 'teleport', supported: false, mask: wires, tunnels: 0 };
  }
  if (code === CODE_TRANSMOGRIFIER) {
    return wires === 0 ? null : { role: 'sink', kind: 'transmogrifier', supported: false, mask: wires, tunnels: 0 };
  }
  return null;
}

/** Minimal union-find over small integers. */
class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(a: number): number {
    let root = a;
    while (this.parent[root] !== root) root = this.parent[root];
    let cursor = a;
    while (this.parent[cursor] !== root) {
      const next = this.parent[cursor];
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** A way a device meets a network: it drives it (output) or reads it (input). */
type PortKind = 'out' | 'in';

/**
 * The sides of a device with the direction of each: a source outputs on its mask; a sink reads on its mask; a gate
 * outputs on the side it faces and reads on the sides next to it (a NOT gate: behind it).
 */
function devicePorts(info: CellInfo): Map<number, PortKind> {
  const ports = new Map<number, PortKind>();
  if (info.role === 'gate') {
    const facing = info.gate?.facing;
    if (facing === undefined) return ports;
    ports.set(facing, 'out');
    if (info.gate?.kind === 'not') ports.set((facing + OPPOSITE_STEP) % SIDE_COUNT, 'in');
    else {
      ports.set((facing + LEFT_STEP) % SIDE_COUNT, 'in');
      ports.set((facing + RIGHT_STEP) % SIDE_COUNT, 'in');
    }
    return ports;
  }
  const kind: PortKind = info.role === 'source' ? 'out' : 'in';
  for (let side = 0; side < SIDE_COUNT; side++) if ((info.mask & (1 << side)) !== 0) ports.set(side, kind);
  return ports;
}

/**
 * Builds the wire networks of a map and the signal links between its devices. Pure and deterministic.
 */
export function buildCc2Wires(map: Cc2Map): Cc2WireResult {
  const { width, height } = map;
  const cells: (CellInfo | null)[] = map.cells.map((cell) => {
    const tile = terrainTile(cell);
    return tile === undefined ? null : classify(tile.code, tile.mod);
  });
  const warnings: string[] = [];
  const unsupported: Cc2UnsupportedNode[] = [];
  const result: Cc2WireResult = { links: [], hasWires: false, hasTunnels: false, wiredSinks: [], unsupported, warnings };
  const total = width * height;
  if (map.cells.length !== total) return result;

  // Net ids: one per cell and axis group. A non-crossing wire cell uses the main group for every side.
  const netOf = (index: number, side: number): number | undefined => {
    const info = cells[index];
    if (info === null || info === undefined || info.role !== 'wire') return undefined;
    if ((info.mask & (1 << side)) === 0) return undefined;
    const crossing = info.mask === ALL_SIDES_MASK;
    const group = crossing && (side === SIDE_E || side === SIDE_W) ? GROUP_CROSS : GROUP_MAIN;
    return index * GROUPS_PER_CELL + group;
  };

  const nets = new DisjointSet(total * GROUPS_PER_CELL);
  // Attachments of devices to nets, and direct device-to-device links, resolved after the unions.
  const attachments: Array<{ net: number; node: number; port: PortKind }> = [];
  const direct: Array<{ from: number; to: number }> = [];

  for (let index = 0; index < total; index++) {
    const info = cells[index];
    if (info === null || info === undefined) continue;
    if (info.role === 'wire') result.hasWires = true;
    if (info.tunnels !== 0) result.hasTunnels = true;
    if (info.role === 'source' || info.role === 'gate') {
      if (info.mask !== 0) result.hasWires = true;
    }
  }

  // Side-by-side connections.
  for (let index = 0; index < total; index++) {
    const info = cells[index];
    if (info === null || info === undefined) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const ports = info.role === 'wire' ? undefined : devicePorts(info);
    for (let side = 0; side < SIDE_COUNT; side++) {
      const tunnelBit = 1 << side;
      if (info.role === 'wire' && (info.tunnels & tunnelBit) !== 0) continue;
      const nx = x + SIDE_OFFSETS_X[side];
      const ny = y + SIDE_OFFSETS_Y[side];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbourIndex = ny * width + nx;
      const neighbour = cells[neighbourIndex];
      if (neighbour === null || neighbour === undefined) continue;
      const back = (side + OPPOSITE_STEP) % SIDE_COUNT;
      if (neighbour.role === 'wire' && (neighbour.tunnels & (1 << back)) !== 0) continue;
      const mine = info.role === 'wire' ? netOf(index, side) : ports?.has(side) ? ports.get(side) : undefined;
      if (mine === undefined) continue;
      const theirs =
        neighbour.role === 'wire' ? netOf(neighbourIndex, back) : devicePorts(neighbour).get(back);
      if (theirs === undefined) continue;
      if (typeof mine === 'number' && typeof theirs === 'number') nets.union(mine, theirs);
      else if (typeof theirs === 'number' && typeof mine === 'string') attachments.push({ net: theirs, node: index, port: mine });
      else if (typeof mine === 'string' && typeof theirs === 'string' && mine === 'out' && theirs === 'in') {
        direct.push({ from: index, to: neighbourIndex });
      }
      // The wire-side half of a device meeting is recorded from the device's own turn above.
    }
  }

  // Tunnels: open on the east and south sides, close on the west and north sides, like brackets in a row or column.
  const pairTunnels = (openSide: number, closeSide: number, lines: number, length: number, cellAt: (line: number, i: number) => number): void => {
    for (let line = 0; line < lines; line++) {
      const stack: number[] = [];
      for (let i = 0; i < length; i++) {
        const index = cellAt(line, i);
        const info = cells[index];
        if (info === null || info === undefined || info.role !== 'wire') continue;
        if ((info.tunnels & (1 << closeSide)) !== 0) {
          const opener = stack.pop();
          const here = netOf(index, closeSide);
          const there = opener === undefined ? undefined : netOf(opener, openSide);
          if (opener === undefined || here === undefined || there === undefined) {
            warnings.push(`tunnel without a partner at ${index % width},${Math.floor(index / width)}`);
          } else nets.union(here, there);
        }
        if ((info.tunnels & (1 << openSide)) !== 0) stack.push(index);
      }
      for (const left of stack) warnings.push(`tunnel without a partner at ${left % width},${Math.floor(left / width)}`);
    }
  };
  pairTunnels(SIDE_E, SIDE_W, height, width, (line, i) => line * width + i);
  pairTunnels(SIDE_S, SIDE_N, width, height, (line, i) => i * width + line);

  // Devices per net root.
  const drivers = new Map<number, number[]>();
  const readers = new Map<number, number[]>();
  for (const attachment of attachments) {
    const root = nets.find(attachment.net);
    const table = attachment.port === 'out' ? drivers : readers;
    const list = table.get(root);
    if (list === undefined) table.set(root, [attachment.node]);
    else if (!list.includes(attachment.node)) list.push(attachment.node);
  }

  const seen = new Set<string>();
  const unsupportedSeen = new Set<string>();
  const links: SignalLink[] = [];
  const note = (index: number, end: 'source' | 'sink'): void => {
    const info = cells[index] as CellInfo;
    const key = `${index}:${end}`;
    if (unsupportedSeen.has(key) || info.kind === undefined) return;
    unsupportedSeen.add(key);
    unsupported.push({ x: index % width, y: Math.floor(index / width), kind: info.kind, end });
    if (info.kind === 'logic_gate' && info.gate !== undefined) {
      warnings.push(`gate of kind ${info.gate.kind} at ${index % width},${Math.floor(index / width)} is not played`);
    }
  };
  const emit = (from: number, to: number): void => {
    if (from === to) return;
    const source = cells[from] as CellInfo;
    const sink = cells[to] as CellInfo;
    if (!source.supported) {
      note(from, 'source');
      return;
    }
    if (!sink.supported) {
      note(to, 'sink');
      return;
    }
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ fromX: from % width, fromY: Math.floor(from / width), toX: to % width, toY: Math.floor(to / width) });
  };

  for (const [root, from] of drivers) {
    for (const source of from) for (const sink of readers.get(root) ?? []) emit(source, sink);
  }
  for (const edge of direct) emit(edge.from, edge.to);

  // Every sink a wire touches, whether or not a source feeds it: such a device is played in its wired form.
  const reached = new Set<number>();
  for (const list of readers.values()) for (const node of list) reached.add(node);
  for (const edge of direct) reached.add(edge.to);
  result.wiredSinks = [...reached]
    .filter((index) => (cells[index] as CellInfo).role === 'sink')
    .sort((a, b) => a - b)
    .map((index) => ({ x: index % width, y: Math.floor(index / width) }));

  links.sort((a, b) => a.fromY - b.fromY || a.fromX - b.fromX || a.toY - b.toY || a.toX - b.toX);
  unsupported.sort((a, b) => a.y - b.y || a.x - b.x || a.end.localeCompare(b.end));
  result.links = links;
  return result;
}

/** Wire sides of the modifier of a tile that carries wires: the low nibble. */
export function cc2WireMask(mod: number | undefined): number {
  return (mod ?? 0) & WIRE_NIBBLE_MASK;
}

/** Tunnel sides of the modifier of a wire tile: the high nibble. */
export function cc2TunnelMask(mod: number | undefined): number {
  return ((mod ?? 0) >> TUNNEL_SHIFT) & WIRE_NIBBLE_MASK;
}

/** Direction names of the four sides, for reports. */
export const CC2_SIDE_NAMES: readonly string[] = ['N', 'E', 'S', 'W'];
