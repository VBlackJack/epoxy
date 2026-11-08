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
import { DEFAULT_RULESET } from '../core/coreConstants';
import { normalizeSignalLinks, signalSinkOf } from '../core/signalLinks';
import { formatSignalPort, isSignalPort, parseSignalPort } from '../core/signalPorts';
import type { SignalPortIndex } from '../core/signalPorts';
import type { CellUnderlay, SignalLink, TileDefinition } from '../core/types';

/** The signal links of a map, as the editor reads and rewrites them (Epoxy levels only, never CC3D). */
export interface SignalLinkHolder {
  terrain: string[][];
  underlays?: CellUnderlay[];
  signalLinks?: SignalLink[];
}

/** Deep copy of one link; the port is carried only when present. */
function copyLink(l: SignalLink): SignalLink {
  return { fromX: l.fromX, fromY: l.fromY, toX: l.toX, toY: l.toY, ...(l.port !== undefined ? { port: l.port } : {}) };
}

/**
 * The signal links in canonical form (bounds, one per pair, sorted; see normalizeSignalLinks), without asking the
 * tiles what the ends are: an imported level is kept whole, even when its tiles are not registered yet.
 * Undefined when none is left.
 */
export function canonicalSignalLinks(
  links: readonly SignalLink[] | undefined,
  terrain: readonly (readonly string[])[]
): SignalLink[] | undefined {
  if (!links || links.length === 0) return undefined;
  return normalizeSignalLinks(links, terrain, DEFAULT_RULESET, null, null) ?? undefined;
}

/** Deep copy of a list of signal links; undefined when it is absent or empty. */
export function cloneSignalLinks(links: readonly SignalLink[] | undefined): SignalLink[] | undefined {
  if (!links || links.length === 0) return undefined;
  return links.map(copyLink);
}

/** True when the map holds at least one signal link. */
export function hasSignalLinks(map: Pick<SignalLinkHolder, 'signalLinks'>): boolean {
  return (map.signalLinks?.length ?? 0) > 0;
}

/** Whether a link has one of its two ends on the cell. */
export function signalLinkTouches(link: SignalLink, x: number, y: number): boolean {
  return (link.fromX === x && link.fromY === y) || (link.toX === x && link.toY === y);
}

/** One wire per pair of cells, except that wires naming different real ports (see signalPorts.ts) are different wires. */
const pairKey = (l: SignalLink): string => [l.fromX, l.fromY, l.toX, l.toY].join('|') + (isSignalPort(l.port) ? `#${l.port}` : '');

/**
 * Stores the links of a map in canonical order (source row, source column, target row, target column), one per
 * pair (the smallest port wins, none being the smallest), so exports are stable after a move. The terrain is not
 * checked here. Removes the field when none is left.
 */
export function setSignalLinks(map: SignalLinkHolder, links: readonly SignalLink[]): void {
  if (links.length === 0) {
    delete map.signalLinks;
    return;
  }
  const unique = new Map<string, SignalLink>();
  for (const l of links) {
    const previous = unique.get(pairKey(l));
    if (previous === undefined || (l.port ?? '') < (previous.port ?? '')) unique.set(pairKey(l), copyLink(l));
  }
  map.signalLinks = [...unique.values()].sort(
    (a, b) => a.fromY - b.fromY || a.fromX - b.fromX || a.toY - b.toY || a.toX - b.toX || (a.port ?? '').localeCompare(b.port ?? '')
  );
}

/** Removes the links that touch the cell; returns how many were removed. The map is changed in place. */
export function dropSignalLinksAt(map: SignalLinkHolder, x: number, y: number): number {
  const before = map.signalLinks ?? [];
  const kept = before.filter((l) => !signalLinkTouches(l, x, y));
  if (kept.length !== before.length) setSignalLinks(map, kept);
  return before.length - kept.length;
}

/** The links moved by a step; links with an end leaving the grid are dropped. */
export function translateSignalLinks(links: readonly SignalLink[], dx: number, dy: number, width: number, height: number): SignalLink[] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  return links
    .map((l) => ({ ...copyLink(l), fromX: l.fromX + dx, fromY: l.fromY + dy, toX: l.toX + dx, toY: l.toY + dy }))
    .filter((l) => inside(l.fromX, l.fromY) && inside(l.toX, l.toY));
}

/**
 * Drops the links whose ends no longer hold a device that can take part (the terrain was changed under them),
 * as the registered tiles say. Returns how many were dropped. The map is changed in place.
 */
export function pruneSignalLinks(map: SignalLinkHolder): number {
  const before = map.signalLinks;
  if (!before || before.length === 0) return 0;
  const canonical = normalizeSignalLinks(before, map.terrain, DEFAULT_RULESET, map.underlays ?? null) ?? undefined;
  if (canonical) map.signalLinks = canonical;
  else delete map.signalLinks;
  return before.length - (canonical?.length ?? 0);
}

type Cell = { x: number; y: number };

/** Which end of a signal wire a cell can be: the output (a source or a gate) or the input (a gate or a hold door). */
export type SignalEnd = 'output' | 'input';

/**
 * Whether the tile can be that end of a signal wire, read from the tile flags as normalizeSignalLinks reads them: a
 * laser receiver or a held or pulse source is an output only, a gate is both, a sink (see signalSinkOf: a hold door, a
 * shot launcher, a clone machine, a green toggle wall or a rail switch) is an input only. All but the hold door act
 * once, on the rising edge of their input.
 */
export function signalTileHoldsEnd(tile: TileDefinition | undefined, end: SignalEnd): boolean {
  if (!tile) return false;
  const isSource = tile.laserReceiverGroup !== undefined || tile.signalSource !== undefined;
  const isGate = tile.signalGate !== undefined;
  const isSink = signalSinkOf(tile) !== null;
  return end === 'output' ? isSource || isGate : isGate || isSink;
}

/** How many signal links have that end on the cell. */
export function signalLinkCountAt(map: Pick<SignalLinkHolder, 'signalLinks'>, end: SignalEnd, x: number, y: number): number {
  return (map.signalLinks ?? []).filter((l) => (end === 'output' ? l.fromX === x && l.fromY === y : l.toX === x && l.toY === y)).length;
}

/** Whether a signal link joins the two cells, from the output cell to the input cell. */
export function hasSignalLink(map: Pick<SignalLinkHolder, 'signalLinks'>, from: Cell, to: Cell): boolean {
  return (map.signalLinks ?? []).some((l) => l.fromX === from.x && l.fromY === from.y && l.toX === to.x && l.toY === to.y);
}

/** Removes every signal link from the output cell to the input cell. The map is changed in place. */
export function dropSignalPair(map: SignalLinkHolder, from: Cell, to: Cell): void {
  const before = map.signalLinks ?? [];
  const kept = before.filter((l) => !(l.fromX === from.x && l.fromY === from.y && l.toX === to.x && l.toY === to.y));
  if (kept.length !== before.length) setSignalLinks(map, kept);
}

/** The gate kind of the tile on the cell, or undefined when the cell holds no gate. */
function gateKindAt(map: Pick<SignalLinkHolder, 'terrain'>, cell: Cell): string | undefined {
  const id = map.terrain[cell.y]?.[cell.x];
  return id === undefined ? undefined : ConfigRegistry.getTile(id).signalGate;
}

/**
 * The first of the two ports (0, then 1) that no link in `taken` uses; the second when both are taken, so a third wire
 * never silently replaces the first.
 */
function freePort(taken: ReadonlySet<number>): SignalPortIndex {
  return taken.has(0) ? 1 : 0;
}

/**
 * Adds a signal link from the output cell to the input cell, in canonical order. The map is changed in place. A wire
 * into a data latch or a counter takes the first free input port (data or count up, then clock or count down); a wire
 * out of a counter takes the first free output port (overflow, then underflow).
 */
export function appendSignalLink(map: SignalLinkHolder, from: Cell, to: Cell): void {
  const links = map.signalLinks ?? [];
  const toKind = gateKindAt(map, to);
  const fromKind = gateKindAt(map, from);
  const pair: { out?: SignalPortIndex; in?: SignalPortIndex } = {};
  if (toKind === 'dlatch' || toKind === 'counter') {
    const taken = new Set<number>();
    for (const l of links) if (l.toX === to.x && l.toY === to.y) taken.add(parseSignalPort(l.port).in ?? 0);
    pair.in = freePort(taken);
  }
  if (fromKind === 'counter') {
    const taken = new Set<number>();
    for (const l of links) if (l.fromX === from.x && l.fromY === from.y) taken.add(parseSignalPort(l.port).out ?? 0);
    pair.out = freePort(taken);
  }
  const port = formatSignalPort(pair);
  setSignalLinks(map, [...links, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, ...(port === undefined ? {} : { port }) }]);
}

/** Whether a wire from `from` to `to` would close a loop: the signal already flows from `to` back to `from`. */
export function signalLinkClosesCycle(map: Pick<SignalLinkHolder, 'signalLinks'>, from: Cell, to: Cell): boolean {
  const links = map.signalLinks ?? [];
  const seen = new Set<string>([`${to.x},${to.y}`]);
  const pending: Cell[] = [to];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.x === from.x && next.y === from.y) return true;
    for (const l of links) {
      if (l.fromX !== next.x || l.fromY !== next.y) continue;
      const key = `${l.toX},${l.toY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push({ x: l.toX, y: l.toY });
    }
  }
  return false;
}

/** Whether the tile is a signal sink that takes one input link only (the validator refuses more): a hold door, a shot launcher, a clone machine or a flip tile. */
export function signalTileTakesOneInput(tile: TileDefinition | undefined): boolean {
  return tile !== undefined && signalSinkOf(tile) !== null;
}
