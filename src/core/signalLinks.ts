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
 * Signal links as a level stores them, and their compilation into the signal network the engine runs.
 *
 * A level stores wires only. What each end is comes from the tile on its cell: a laser receiver or a
 * held signal source is a source (only a `from` end), a gate tile is a gate (either end), a hold door is
 * a sink (only a `to` end). A cell no link touches is not a node.
 */

import {
  TerrainTileLookup,
  getRegisteredTerrainLookup,
  isInBounds,
  isRecord,
  isRuleset
} from '../config/ConfigValidation';
import { SIGNAL_PORT_MAX_LENGTH, SIGNAL_PORT_MIN_LENGTH } from './coreConstants';
import type { CellUnderlay, CompiledLevel, SignalLink, SignalNodeDef, SignalSpec, TileDefinition } from './types';

/** What a tile is to a signal network. */
type SignalRole = 'source' | 'gate' | 'sink';

/** A cell's place in the network, derived from its tile. */
interface CellNode {
  role: SignalRole;
  def: SignalNodeDef;
}

/** The node a tile makes of its cell, or null when the tile takes no part in signals. */
function nodeOfTile(tile: TileDefinition, cell: number): CellNode | null {
  if (tile.laserReceiverGroup !== undefined) {
    return { role: 'source', def: { cell, kind: 'source', sample: 'receiver' } };
  }
  if (tile.signalSource === 'held') {
    return { role: 'source', def: { cell, kind: 'source', sample: 'held' } };
  }
  if (tile.signalGate !== undefined) {
    const def: SignalNodeDef =
      tile.signalGate === 'latch'
        ? { cell, kind: 'latch', startBit: tile.signalLatchStartsOn === true }
        : { cell, kind: tile.signalGate };
    return { role: 'gate', def };
  }
  if (tile.holdDoorColor !== undefined) {
    return { role: 'sink', def: { cell, kind: 'sink', color: tile.holdDoorColor } };
  }
  return null;
}

/** The node of a cell: its top, or the terrain hidden under it when the top takes no part (a hidden device works once the top is gone). */
function nodeAt(
  terrain: readonly (readonly string[])[],
  hidden: ReadonlyMap<number, string>,
  x: number,
  y: number,
  lookup: TerrainTileLookup
): CellNode | null {
  const width = terrain[0]?.length ?? 0;
  const cell = y * width + x;
  for (const id of [terrain[y][x], hidden.get(cell)]) {
    const tile = id === undefined ? undefined : lookup(id);
    const node = tile === undefined ? null : nodeOfTile(tile, cell);
    if (node !== null) return node;
  }
  return null;
}

function hiddenTerrain(underlays: readonly CellUnderlay[] | null, width: number): Map<number, string> {
  const hidden = new Map<number, string>();
  for (const under of underlays ?? []) hidden.set(under.y * width + under.x, under.terrain);
  return hidden;
}

/** A port is kept when it is a string of the allowed length; anything else loses the port, never the link. */
function validPort(value: unknown): string | undefined {
  return typeof value === 'string' && value.length >= SIGNAL_PORT_MIN_LENGTH && value.length <= SIGNAL_PORT_MAX_LENGTH
    ? value
    : undefined;
}

/**
 * The signal links of a level in canonical form: only the Epoxy ruleset carries them. Entries that are
 * not records, lie outside the grid, hold a non-integer coordinate or join a cell to itself are dropped.
 * With a tile lookup, an entry is also dropped unless its `from` cell is a source or a gate and its `to`
 * cell a gate or a sink (a device hidden under a removable top counts). A port that is not a string of 1 to
 * 16 characters is dropped alone. A pair of cells is kept once, with the smallest port (none is the smallest),
 * because a duplicate wire would change the parity of a XOR. The links are sorted by source row, source
 * column, target row, then target column. A cycle is kept: the validator refuses it later. Returns null
 * when none is left.
 */
export function normalizeSignalLinks(
  links: unknown,
  terrain: readonly (readonly string[])[],
  ruleset: unknown,
  underlays: readonly CellUnderlay[] | null = null,
  lookup: TerrainTileLookup | null = getRegisteredTerrainLookup()
): SignalLink[] | null {
  if ((isRuleset(ruleset) ? ruleset : 'epoxy') !== 'epoxy' || !Array.isArray(links)) return null;
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const hidden = hiddenTerrain(underlays, width);
  const kept = new Map<string, SignalLink>();
  for (const entry of links as unknown[]) {
    if (!isRecord(entry)) continue;
    const { fromX, fromY, toX, toY } = entry;
    if (!isInBounds(fromX, fromY, width, height) || !isInBounds(toX, toY, width, height)) continue;
    if (fromX === toX && fromY === toY) continue;
    const link: SignalLink = { fromX: fromX as number, fromY: fromY as number, toX: toX as number, toY: toY as number };
    const port = validPort(entry.port);
    if (port !== undefined) link.port = port;
    if (lookup !== null) {
      const from = nodeAt(terrain, hidden, link.fromX, link.fromY, lookup);
      const to = nodeAt(terrain, hidden, link.toX, link.toY, lookup);
      if (from === null || (from.role !== 'source' && from.role !== 'gate')) continue;
      if (to === null || (to.role !== 'gate' && to.role !== 'sink')) continue;
    }
    const key = `${link.fromY},${link.fromX},${link.toY},${link.toX}`;
    const previous = kept.get(key);
    if (previous === undefined || (link.port ?? '') < (previous.port ?? '')) kept.set(key, link);
  }
  if (kept.size === 0) return null;
  return [...kept.values()].sort((a, b) => a.fromY - b.fromY || a.fromX - b.fromX || a.toY - b.toY || a.toX - b.toX);
}

/**
 * The signal network of a level, or undefined when it has no signal link left after normalizing. The
 * nodes are the cells the links touch, their kinds read from the tiles through `lookup`.
 */
export function compileSignalSpec(
  level: Pick<CompiledLevel, 'terrain' | 'ruleset' | 'underlays' | 'signalLinks'>,
  lookup: TerrainTileLookup
): SignalSpec | undefined {
  const links = normalizeSignalLinks(level.signalLinks, level.terrain, level.ruleset, level.underlays ?? null, lookup);
  if (links === null) return undefined;
  const width = level.terrain[0]?.length ?? 0;
  const hidden = hiddenTerrain(level.underlays ?? null, width);
  const nodes = new Map<number, SignalNodeDef>();
  const touch = (x: number, y: number): number => {
    const cell = y * width + x;
    if (!nodes.has(cell)) {
      const node = nodeAt(level.terrain, hidden, x, y, lookup);
      if (node !== null) nodes.set(cell, node.def);
    }
    return cell;
  };
  const specLinks = links.map((l) => ({
    from: touch(l.fromX, l.fromY),
    to: touch(l.toX, l.toY),
    ...(l.port === undefined ? {} : { port: l.port })
  }));
  return { nodes: [...nodes.values()].sort((a, b) => a.cell - b.cell), links: specLinks };
}
