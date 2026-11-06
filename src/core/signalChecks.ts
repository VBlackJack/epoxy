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
 * Validator checks of the signal wiring of an Epoxy level: one input per hold door, no colour shared by plates
 * and signal doors, NOT gates with one input, gates with an input, no cycle, no dangling link, no idle signal
 * plate, and the loops closed through the world (a laser receiver whose signal moves the door that cuts or
 * opens its own beam).
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS } from '../config/constants';
import { CHANNEL_COLOR_NAME_KEY_PREFIX, FLOOR_TILE_ID } from './coreConstants';
import { registryTileLookup } from './epoxy/epoxySignals';
import { buildSignalNetwork } from './epoxy/signalNetwork';
import { GameEngine } from './GameEngine';
import { compileSignalSpec, normalizeSignalLinks } from './signalLinks';
import { t } from '../i18n/I18nManager';
import { underlayMap } from './Underlays';
import type { ChannelColor, CompiledLevel, GridPoint, SignalNodeDef, SignalSpec, ValidationIssue } from './types';

type Params = Record<string, string | number>;

/** True when the level is played by the Epoxy rules, the only ones with signals. */
function isEpoxyLevel(level: CompiledLevel): boolean {
  return level.ruleset !== 'lynx' && level.ruleset !== 'cc3d';
}

/** The location params of an issue about several cells: the first one in row-major order and how many there are. */
function located(cells: readonly GridPoint[], extra: Params = {}): Params {
  const first = cells.reduce((best, cell) => (cell.y < best.y || (cell.y === best.y && cell.x < best.x) ? cell : best));
  return { ...extra, x: first.x, y: first.y, count: cells.length };
}

function colorName(color: ChannelColor): string {
  return t(`${CHANNEL_COLOR_NAME_KEY_PREFIX}${color}`);
}

/** The compiled signal network of an Epoxy level, or undefined when it has none. */
function specOf(level: CompiledLevel): SignalSpec | undefined {
  return isEpoxyLevel(level) ? compileSignalSpec(level, registryTileLookup) : undefined;
}

/** The colours of the hold doors a signal sink drives: those doors open from the signals, not from plates. */
export function signalDrivenColors(level: CompiledLevel): Set<ChannelColor> {
  const colors = new Set<ChannelColor>();
  for (const node of specOf(level)?.nodes ?? []) {
    if (node.kind === 'sink' && node.color !== undefined) colors.add(node.color);
  }
  return colors;
}

/** The colours of the pressure plates of the level, hidden ones included. */
function plateColors(level: CompiledLevel): Set<ChannelColor> {
  const colors = new Set<ChannelColor>();
  const underlays = underlayMap(level);
  const width = level.terrain[0]?.length ?? 0;
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      for (const tileId of [id, underlays?.get(y * width + x)]) {
        const color = tileId === undefined ? undefined : ConfigRegistry.getTile(tileId).plateColor;
        if (color !== undefined) colors.add(color);
      }
    })
  );
  return colors;
}

/** The signal links that normalizing dropped (a tile changed under them, or an end is not a device), located at their source end. */
function danglingCells(level: CompiledLevel): GridPoint[] {
  const raw = level.signalLinks;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const kept = normalizeSignalLinks(raw, level.terrain, level.ruleset, level.underlays ?? null, registryTileLookup) ?? [];
  const keys = new Set(kept.map((l) => `${l.fromY},${l.fromX},${l.toY},${l.toX}`));
  const height = level.terrain.length;
  const width = level.terrain[0]?.length ?? 0;
  const inGrid = (x: unknown, y: unknown): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0 && (x as number) < width && (y as number) < height;
  const cells: GridPoint[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const { fromX, fromY, toX, toY } = entry as unknown as Record<string, unknown>;
    if (keys.has(`${fromY},${fromX},${toY},${toX}`)) continue;
    if (inGrid(fromX, fromY)) cells.push({ x: fromX as number, y: fromY as number });
    else if (inGrid(toX, toY)) cells.push({ x: toX as number, y: toY as number });
  }
  return cells;
}

/** What a signal does along a path: an inversion (NOT), an XOR (no sign describes it), or a latch (edge-triggered, so it cannot oscillate). */
interface PathState {
  inverted: boolean;
  xor: boolean;
  latch: boolean;
}

/** How a laser receiver's signal reaches the sinks: the colours reached and the parities of the paths. */
interface ReceiverReach {
  colors: Set<ChannelColor>;
  /** Some path inverts the signal an odd number of times. */
  inverting: boolean;
  /** Some path crosses an XOR. */
  xor: boolean;
  /** Some path crosses a latch and no XOR. */
  latchOnly: boolean;
  /** Some path is clean and non-inverting. */
  straight: boolean;
}

function receiverReach(spec: SignalSpec, from: number): ReceiverReach {
  const byCell = new Map<number, SignalNodeDef>(spec.nodes.map((n) => [n.cell, n]));
  const outgoing = new Map<number, number[]>();
  for (const link of spec.links) outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  const reach: ReceiverReach = { colors: new Set(), inverting: false, xor: false, latchOnly: false, straight: false };
  const seen = new Set<string>();
  const queue: Array<{ cell: number; state: PathState }> = [{ cell: from, state: { inverted: false, xor: false, latch: false } }];
  while (queue.length > 0) {
    const { cell, state } = queue.shift() as { cell: number; state: PathState };
    for (const next of outgoing.get(cell) ?? []) {
      const node = byCell.get(next);
      if (node === undefined) continue;
      const arrived: PathState = {
        inverted: node.kind === 'not' ? !state.inverted : state.inverted,
        xor: state.xor || node.kind === 'xor',
        latch: state.latch || node.kind === 'latch'
      };
      if (node.kind === 'sink') {
        // A launcher or cloner sink has no colour and moves no door: it takes no part in a world loop.
        if (node.color !== undefined) {
          reach.colors.add(node.color);
          if (arrived.xor) reach.xor = true;
          else if (arrived.latch) reach.latchOnly = true;
          else if (arrived.inverted) reach.inverting = true;
          else reach.straight = true;
        }
        continue;
      }
      const key = `${next}:${arrived.inverted ? 1 : 0}:${arrived.xor ? 1 : 0}:${arrived.latch ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ cell: next, state: arrived });
    }
  }
  return reach;
}

/** The pulse buttons that reach a hold door along a path with no latch (NOT and XOR do not latch), located at the button. */
function pulseDoorCells(spec: SignalSpec): number[] {
  const byCell = new Map<number, SignalNodeDef>(spec.nodes.map((n) => [n.cell, n]));
  const outgoing = new Map<number, number[]>();
  for (const link of spec.links) outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  const cells: number[] = [];
  for (const source of spec.nodes) {
    if (source.kind !== 'source' || source.sample !== 'pulse') continue;
    const seen = new Set<string>();
    const queue: Array<{ cell: number; latched: boolean }> = [{ cell: source.cell, latched: false }];
    let reachesDoor = false;
    while (queue.length > 0 && !reachesDoor) {
      const { cell, latched } = queue.shift() as { cell: number; latched: boolean };
      for (const next of outgoing.get(cell) ?? []) {
        const node = byCell.get(next);
        if (node === undefined) continue;
        if (node.kind === 'sink') {
          if (node.color !== undefined && !latched) reachesDoor = true;
          continue;
        }
        const arrived = latched || node.kind === 'latch';
        const key = `${next}:${arrived ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ cell: next, latched: arrived });
      }
    }
    if (reachesDoor) cells.push(source.cell);
  }
  return cells;
}

/** The cells of the clone machines wired to a signal whose clone appears on a pulse button that drives them. */
function clonerSelfFeedCells(level: CompiledLevel, spec: SignalSpec): number[] {
  const width = level.terrain[0]?.length ?? 0;
  const byCell = new Map<number, SignalNodeDef>(spec.nodes.map((n) => [n.cell, n]));
  const outgoing = new Map<number, number[]>();
  for (const link of spec.links) outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  const reaches = (from: number, target: number): boolean => {
    const seen = new Set<number>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const cell = queue.shift() as number;
      for (const next of outgoing.get(cell) ?? []) {
        if (next === target) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  };
  const cells: number[] = [];
  for (const sink of spec.nodes) {
    if (sink.kind !== 'sink' || sink.fires !== 'cloner') continue;
    const x = sink.cell % width;
    const y = Math.floor(sink.cell / width);
    // The template the engine spawns: the first clone link of the machine, else the entity sitting on it.
    const link = (level.cloneLinks ?? []).find((l) => l.clonerX === x && l.clonerY === y);
    const dir = link?.templateDir ?? (level.entities ?? []).find((e) => e.x === x && e.y === y)?.dir;
    if (dir === undefined) continue;
    const vec = DIRECTION_VECTORS[dir];
    const spawnX = x + vec.dx;
    const spawnY = y + vec.dy;
    if (spawnX < 0 || spawnX >= width || spawnY < 0 || spawnY >= level.terrain.length) continue;
    const spawn = spawnY * width + spawnX;
    const source = byCell.get(spawn);
    if (source?.kind === 'source' && source.sample === 'pulse' && reaches(spawn, sink.cell)) cells.push(sink.cell);
  }
  return cells;
}

/** The level with its signal links removed and every hold door of the given colours open (as floor) or shut. */
function withDoors(level: CompiledLevel, colors: ReadonlySet<ChannelColor>, open: boolean): CompiledLevel {
  const { signalLinks: _links, ...rest } = level;
  void _links;
  return {
    ...rest,
    terrain: level.terrain.map((row) =>
      row.map((id) => {
        const tile = ConfigRegistry.getTile(id);
        if (tile.holdDoorColor === undefined || !colors.has(tile.holdDoorColor)) return id;
        if (open) return FLOOR_TILE_ID;
        return tile.holdDoorOpen === true && tile.holdDoorTogglesTo !== undefined ? tile.holdDoorTogglesTo : id;
      })
    )
  };
}

/** The cells of the lit receivers of a level, as "x,y" keys. */
function litReceiverKeys(level: CompiledLevel): Set<string> {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return new Set(engine.getLitReceivers().map(({ x, y }) => `${x},${y}`));
}

/** The lit receivers with the doors of a set of colours open and shut, computed once per distinct set. */
interface DoorLegs {
  open: Set<string>;
  shut: Set<string>;
}

/**
 * Loops closed through the world. A laser receiver feeds a hold door; if that door's state cuts or opens the
 * beam that lights the receiver, the signal loops through the lasers. The beam leg is read by tracing the
 * beams with the doors open and then shut, signal links removed. The loop is odd (it inverts: the door would
 * flicker forever) when the leg and the path disagree in sign, or when the path crosses a XOR; it is even
 * (it holds itself) otherwise. A latch flips on an edge and cannot oscillate, so a path whose only taint is
 * a latch gives the even warning. Receivers reaching the same colours share one open/shut pair of engine loads.
 */
function checkWorldLoops(level: CompiledLevel, spec: SignalSpec, issues: ValidationIssue[]): void {
  const width = level.terrain[0]?.length ?? 0;
  const odd: GridPoint[] = [];
  const even: GridPoint[] = [];
  const legsByColors = new Map<string, DoorLegs>();
  for (const node of spec.nodes) {
    if (node.kind !== 'source' || node.sample !== 'receiver') continue;
    const reach = receiverReach(spec, node.cell);
    if (reach.colors.size === 0) continue;
    const cell = { x: node.cell % width, y: Math.floor(node.cell / width) };
    const colorsKey = [...reach.colors].sort().join(',');
    let legs = legsByColors.get(colorsKey);
    if (legs === undefined) {
      legs = {
        open: litReceiverKeys(withDoors(level, reach.colors, true)),
        shut: litReceiverKeys(withDoors(level, reach.colors, false))
      };
      legsByColors.set(colorsKey, legs);
    }
    const cellKey = `${cell.x},${cell.y}`;
    const litOpen = legs.open.has(cellKey);
    const litShut = legs.shut.has(cellKey);
    if (litOpen === litShut) continue;
    // +1: the beam reaches the receiver with the door open; -1: with the door shut.
    const leg = litOpen ? 1 : -1;
    const gains: number[] = [];
    if (reach.straight) gains.push(leg);
    if (reach.inverting) gains.push(-leg);
    if (reach.xor || gains.includes(-1)) odd.push(cell);
    else if (reach.latchOnly || gains.includes(1)) even.push(cell);
  }
  if (odd.length > 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.signal_world_loop_odd.label', params: located(odd) });
  }
  if (even.length > 0) {
    issues.push({ severity: 'warning', i18nKey: 'validator.issues.signal_world_loop_even.label', params: located(even) });
  }
}

/** Checks the signal wiring of a level; a level with no signal links gets none of these issues. */
export function checkSignalWiring(level: CompiledLevel, issues: ValidationIssue[]): void {
  if (!isEpoxyLevel(level)) return;
  const width = level.terrain[0]?.length ?? 0;
  const cellOf = (cell: number): GridPoint => ({ x: cell % width, y: Math.floor(cell / width) });
  const spec = specOf(level);

  const dangling = danglingCells(level);
  if (dangling.length > 0) {
    issues.push({ severity: 'warning', i18nKey: 'validator.issues.signal_link_dangling.label', params: located(dangling) });
  }

  // A signal plate that nothing is linked from drives nothing.
  const linkedFrom = new Set((spec?.links ?? []).map((l) => l.from));
  const idlePlates: GridPoint[] = [];
  const underlays = underlayMap(level);
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      const hidden = underlays?.get(y * width + x);
      const isPlate = [id, hidden].some((tileId) => tileId !== undefined && ConfigRegistry.getTile(tileId).signalSource !== undefined);
      if (isPlate && !linkedFrom.has(y * width + x)) idlePlates.push({ x, y });
    })
  );
  if (idlePlates.length > 0) {
    issues.push({ severity: 'warning', i18nKey: 'validator.issues.signal_source_unlinked.label', params: located(idlePlates) });
  }

  if (spec === undefined) return;

  const inputs = new Map<number, number>();
  for (const link of spec.links) inputs.set(link.to, (inputs.get(link.to) ?? 0) + 1);

  const multiSinks: GridPoint[] = [];
  const notBad: GridPoint[] = [];
  const noInput: GridPoint[] = [];
  const sinkCellsByColor = new Map<ChannelColor, GridPoint[]>();
  for (const node of spec.nodes) {
    const count = inputs.get(node.cell) ?? 0;
    if (node.kind === 'sink') {
      if (count > 1) multiSinks.push(cellOf(node.cell));
      if (node.color !== undefined) sinkCellsByColor.set(node.color, [...(sinkCellsByColor.get(node.color) ?? []), cellOf(node.cell)]);
    } else if (node.kind === 'not') {
      if (count !== 1) notBad.push(cellOf(node.cell));
    } else if (node.kind !== 'source' && count === 0) {
      noInput.push(cellOf(node.cell));
    }
  }
  if (multiSinks.length > 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.signal_sink_inputs.label', params: located(multiSinks) });
  }
  const plates = plateColors(level);
  for (const [color, cells] of sinkCellsByColor) {
    if (plates.has(color)) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.signal_colour_mixed.label',
        params: located(cells, { color: colorName(color) })
      });
    }
  }
  if (notBad.length > 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.signal_not_inputs.label', params: located(notBad) });
  }
  if (noInput.length > 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.signal_gate_no_input.label', params: located(noInput) });
  }

  const network = buildSignalNetwork(spec.nodes, spec.links);
  const cyclic = network.cycles.flat().map((i) => cellOf(network.nodes[i].cell));
  if (cyclic.length > 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.signal_cycle.label', params: located(cyclic) });
  }

  const pulseDoors = pulseDoorCells(spec).map(cellOf);
  if (pulseDoors.length > 0) {
    issues.push({ severity: 'warning', i18nKey: 'validator.issues.signal_pulse_door.label', params: located(pulseDoors) });
  }
  const selfFeeding = clonerSelfFeedCells(level, spec).map(cellOf);
  if (selfFeeding.length > 0) {
    issues.push({ severity: 'warning', i18nKey: 'validator.issues.signal_cloner_self_feed.label', params: located(selfFeeding) });
  }

  checkWorldLoops(level, spec, issues);
}
