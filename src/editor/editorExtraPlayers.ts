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
 * The other players (`extraPlayers`) of an editor map: the starts of a level with several players, beyond the main
 * start. Their order is the swap order of the game, so it is kept as placed, never sorted. Pure module: no DOM.
 */

import { normalizeExtraPlayers } from '../config/ConfigValidation';
import type { ExtraPlayerStart } from '../core/types';

/** The other players of a map, as the editor reads and rewrites them (Epoxy levels only, never CC3D). */
export interface ExtraPlayerHolder {
  terrain: string[][];
  playerStart: { x: number; y: number };
  extraPlayers?: ExtraPlayerStart[];
}

/** The other players in canonical form (see normalizeExtraPlayers), or undefined when none is left. */
export function canonicalExtraPlayers(
  players: readonly ExtraPlayerStart[] | undefined,
  start: { x: number; y: number },
  terrain: readonly (readonly string[])[]
): ExtraPlayerStart[] | undefined {
  if (!players || players.length === 0) return undefined;
  return normalizeExtraPlayers(players, start, terrain[0]?.length ?? 0, terrain.length) ?? undefined;
}

/** Deep copy of a list of other players; undefined when it is absent or empty. */
export function cloneExtraPlayers(players: readonly ExtraPlayerStart[] | undefined): ExtraPlayerStart[] | undefined {
  if (!players || players.length === 0) return undefined;
  return players.map((entry) => ({ ...entry }));
}

/** The other players moved by (dx, dy), with the ones that leave the new grid dropped. */
export function translateExtraPlayers(
  players: readonly ExtraPlayerStart[],
  dx: number,
  dy: number,
  width: number,
  height: number
): ExtraPlayerStart[] {
  return players
    .map((entry) => ({ ...entry, x: entry.x + dx, y: entry.y + dy }))
    .filter((entry) => entry.x >= 0 && entry.x < width && entry.y >= 0 && entry.y < height);
}

/** Replaces the other players of a map by the canonical form of `players`; the field is removed when none is left. */
export function replaceExtraPlayers(map: ExtraPlayerHolder, players: readonly ExtraPlayerStart[]): void {
  const canonical = canonicalExtraPlayers(players, map.playerStart, map.terrain);
  if (canonical) map.extraPlayers = canonical;
  else delete map.extraPlayers;
}

/** Removes the other players standing on the cells the predicate picks; returns how many went. The map is changed in place. */
export function removeExtraPlayersWhere(map: ExtraPlayerHolder, predicate: (x: number, y: number) => boolean): number {
  const before = map.extraPlayers ?? [];
  const kept = before.filter((entry) => !predicate(entry.x, entry.y));
  if (kept.length !== before.length) replaceExtraPlayers(map, kept);
  return before.length - kept.length;
}

/** The other player standing on a cell, or undefined. */
export function extraPlayerAt(map: Pick<ExtraPlayerHolder, 'extraPlayers'>, x: number, y: number): ExtraPlayerStart | undefined {
  return map.extraPlayers?.find((entry) => entry.x === x && entry.y === y);
}

/** The cells whose other player differs between two lists (moved, turned, another character, added or removed). */
export function differingExtraPlayerCells(
  before: readonly ExtraPlayerStart[] | undefined,
  after: readonly ExtraPlayerStart[] | undefined
): Array<{ x: number; y: number }> {
  const keyed = (players: readonly ExtraPlayerStart[] | undefined): Map<string, string> => {
    const map = new Map<string, string>();
    for (const entry of players ?? []) map.set(`${entry.x},${entry.y}`, JSON.stringify([entry.dir, entry.character]));
    return map;
  };
  const was = keyed(before);
  const now = keyed(after);
  const cells = new Map<string, { x: number; y: number }>();
  for (const entry of [...(before ?? []), ...(after ?? [])]) {
    const key = `${entry.x},${entry.y}`;
    if (was.get(key) !== now.get(key)) cells.set(key, { x: entry.x, y: entry.y });
  }
  // A reorder moves nobody on the board but changes the swap order: every player of the new list counts.
  if (cells.size === 0 && JSON.stringify(before ?? []) !== JSON.stringify(after ?? [])) {
    for (const entry of after ?? []) cells.set(`${entry.x},${entry.y}`, { x: entry.x, y: entry.y });
  }
  return [...cells.values()];
}
