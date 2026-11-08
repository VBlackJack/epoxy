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
 * held or pulse signal source is a source (only a `from` end), a gate tile is a gate (either end), a hold
 * door, a shot launcher or a clone machine is a sink (only a `to` end). A cell no link touches is not a node.
 */

import { PACK_JSON_ID_SET_VERSIONS, PACK_JSON_VERSION_V7_IDS } from '../config/constants';
import {
  TerrainTileLookup,
  getRegisteredTerrainLookup,
  isInBounds,
  isRecord,
  isRuleset
} from '../config/ConfigValidation';
import {
  CLONE_MACHINE_TILE_ID,
  FLIP_SINK_TILE_IDS,
  SHOT_LAUNCHER_TILE_ID_PREFIX,
  SIGNAL_BUTTON_TILE_ID,
  SIGNAL_PORT_MAX_LENGTH,
  SIGNAL_PORT_MIN_LENGTH
} from './coreConstants';
import type { CellUnderlay, CompiledLevel, SignalLink, SignalNodeDef, SignalSpec, TileDefinition } from './types';

/** What a tile is to a signal network. */
type SignalRole = 'source' | 'gate' | 'sink';

/** A cell's place in the network, derived from its tile. */
interface CellNode {
  role: SignalRole;
  def: SignalNodeDef;
}

/** What a sink is, as its node def carries it: exactly one of a hold door colour, a device to fire or a relay pad to power. */
export type SignalSinkKind = Pick<SignalNodeDef, 'color' | 'fires' | 'powers'>;

/** Options of signalSinkOf. */
interface SignalSinkOptions {
  /** The tile is the terrain hidden under a removable top. A flip tile or a relay pad there is never a sink (see signalSinkOf). */
  hidden?: boolean;
}

/**
 * The sink a tile makes of its cell, or null when the tile is not a sink. The one place that says what a sink is,
 * read by the compiler, the pack format predicates and the editor. A hold door drives a colour; a shot launcher, a
 * clone machine and a flip tile (a green toggle wall or a rail switch: any tile with `togglesTo`) fire once on each
 * rising edge of their input. A flip tile hidden under a removable top is no sink: the per-family toggle parity of the
 * green button counts a hidden wall by its own bookkeeping, and a wire must not change that cell behind its back. A
 * hidden hold door, launcher or clone machine still is a sink. A relay pad (lit or dark: a signal link powers the pad, not
 * its current form) is a level sink that follows its input; it is never hidden (the level normalisation refuses it), and a
 * hidden one is no sink for the same reason as a hidden flip tile. A wired flip tile (a purple wall or a wired flame jet,
 * `wireTogglesTo`) flips on every change of its input, rising and falling, and a wired trap is a level sink that is open
 * while its input is on; neither is a sink when hidden, for the same reason.
 */
export function signalSinkOf(tile: TileDefinition, options: SignalSinkOptions = {}): SignalSinkKind | null {
  if (tile.holdDoorColor !== undefined) return { color: tile.holdDoorColor };
  if (tile.shotLauncher !== undefined) return { fires: 'launcher' };
  if (tile.isCloneMachine) return { fires: 'cloner' };
  if (tile.togglesTo !== undefined && options.hidden !== true) return { fires: 'flip' };
  if (tile.relayPad !== undefined && options.hidden !== true) return { powers: true };
  // A purple wall or a wired flame jet flips on every change of its input; a wired trap is a level sink like a relay pad.
  if (tile.wireTogglesTo !== undefined && options.hidden !== true) return { fires: 'flip_edges' };
  if (tile.wiredTrap === true && options.hidden !== true) return { powers: true };
  return null;
}

/** The node a tile makes of its cell, or null when the tile takes no part in signals. `hidden`: the tile lies under a removable top. */
function nodeOfTile(tile: TileDefinition, cell: number, hidden: boolean = false): CellNode | null {
  if (tile.laserReceiverGroup !== undefined) {
    return { role: 'source', def: { cell, kind: 'source', sample: 'receiver' } };
  }
  if (tile.signalSource !== undefined) {
    return { role: 'source', def: { cell, kind: 'source', sample: tile.signalSource } };
  }
  if (tile.signalGate !== undefined) {
    const def: SignalNodeDef =
      tile.signalGate === 'latch'
        ? { cell, kind: 'latch', startBit: tile.signalLatchStartsOn === true }
        : { cell, kind: tile.signalGate };
    return { role: 'gate', def };
  }
  const sink = signalSinkOf(tile, { hidden });
  return sink === null ? null : { role: 'sink', def: { cell, kind: 'sink', ...sink } };
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
  const top = lookup(terrain[y][x]);
  const topNode = top === undefined ? null : nodeOfTile(top, cell);
  if (topNode !== null) return topNode;
  const under = hidden.get(cell);
  const underTile = under === undefined ? undefined : lookup(under);
  return underTile === undefined ? null : nodeOfTile(underTile, cell, true);
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

/**
 * True when the level needs pack format version 6: it places a pulse button (on the terrain or hidden under
 * a removable top), or one of its signal links ends on a shot launcher or a clone machine. An older build
 * would read the pulse tile as floor and drop the links to launchers and cloners, so it must refuse the
 * file. The shipped tile ids are read by name, so it holds before the configs are loaded; other tiles go through the lookup when there is one.
 */
export function usesPulseSinkFormat(
  level: Pick<CompiledLevel, 'terrain' | 'underlays' | 'signalLinks'>,
  lookup: TerrainTileLookup | null = getRegisteredTerrainLookup()
): boolean {
  const isPulse = (id: string | null | undefined): boolean =>
    id !== null && id !== undefined && (id === SIGNAL_BUTTON_TILE_ID || lookup?.(id)?.signalSource === 'pulse');
  const isEdgeSink = (id: string | null | undefined): boolean => {
    if (id === null || id === undefined) return false;
    if (id === CLONE_MACHINE_TILE_ID || id.startsWith(SHOT_LAUNCHER_TILE_ID_PREFIX)) return true;
    const tile = lookup?.(id);
    const fires = tile === undefined ? undefined : signalSinkOf(tile)?.fires;
    return fires === 'launcher' || fires === 'cloner';
  };
  if (level.terrain.some((row) => row.some(isPulse))) return true;
  const underlays = level.underlays ?? [];
  if (underlays.some((under) => isPulse(under.terrain))) return true;
  const hidden = new Map<string, string>(underlays.map((under) => [`${under.x},${under.y}`, under.terrain]));
  return (level.signalLinks ?? []).some((link) => {
    if (link === null || typeof link !== 'object') return false;
    const { toX, toY } = link;
    if (!Number.isInteger(toX) || !Number.isInteger(toY)) return false;
    return isEdgeSink(level.terrain[toY]?.[toX]) || isEdgeSink(hidden.get(`${toX},${toY}`));
  });
}

/**
 * True when a signal link of the level ends on a flip tile (a green toggle wall or a rail switch) in plain view. An
 * older build would drop such a link silently, so the file needs a format that build refuses. The tile ids are read
 * by name, so it holds before the configs are loaded; other tiles go through the lookup when there is one. A flip
 * tile hidden under a removable top is no sink, so a link to it does not count (the load drops it too).
 */
export function usesFlipSinkFormat(
  level: Pick<CompiledLevel, 'terrain' | 'signalLinks'>,
  lookup: TerrainTileLookup | null = getRegisteredTerrainLookup()
): boolean {
  const isFlip = (id: string | null | undefined): boolean =>
    id !== null && id !== undefined && (FLIP_SINK_TILE_IDS.has(id) || lookup?.(id)?.togglesTo !== undefined);
  return (level.signalLinks ?? []).some((link) => {
    if (link === null || typeof link !== 'object') return false;
    const { toX, toY } = link;
    if (!Number.isInteger(toX) || !Number.isInteger(toY)) return false;
    return isFlip(level.terrain[toY]?.[toX]);
  });
}

/**
 * True when the level places any id of pack format 7 (PACK_JSON_VERSION_V7_IDS) on its terrain, hidden terrain,
 * items, entities or clone templates. Ids are matched by name. CC3D levels are skipped: their tile space is
 * separate and cannot carry these ids.
 */
export function usesV7Ids(level: IdScanLevel): boolean {
  return usesIdSet(level, PACK_JSON_VERSION_V7_IDS);
}

/** The parts of a level the pack format id sets are matched against. */
type IdScanLevel = Pick<CompiledLevel, 'terrain' | 'underlays' | 'items' | 'entities' | 'cloneLinks' | 'ruleset'>;

/** True when the level places any id of the set on its terrain, hidden terrain, items, entities or clone templates. CC3D levels are skipped. */
function usesIdSet(level: IdScanLevel, ids: ReadonlySet<string>): boolean {
  if (level.ruleset === 'cc3d') return false;
  const isMember = (id: string | null | undefined): boolean => typeof id === 'string' && ids.has(id);
  if (level.terrain?.some((row) => row.some(isMember))) return true;
  if ((level.underlays ?? []).some((under) => isMember(under.terrain))) return true;
  if (level.items?.some((row) => Array.isArray(row) && row.some(isMember))) return true;
  if ((level.entities ?? []).some((entity) => isMember(entity.type))) return true;
  return (level.cloneLinks ?? []).some((link) => isMember(link.templateType));
}

/**
 * The highest pack format whose ids the level uses (see PACK_JSON_ID_SET_VERSIONS), or 0 when it uses none, so a
 * level written before the ids existed keeps its older version.
 */
export function idSetVersionOf(level: IdScanLevel): number {
  let version = 0;
  for (const row of PACK_JSON_ID_SET_VERSIONS) {
    if (row.version > version && usesIdSet(level, row.ids)) version = row.version;
  }
  return version;
}
