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
 * Edits of the other players (`extraPlayers`) of an editor map: placing a start, turning it, choosing its character
 * and removing it. Every function returns a new map (or null / an unchanged result) and leaves its input alone.
 * Pure module: no DOM.
 */

import { DEFAULT_PLAYER_CHARACTER, EXTRA_PLAYERS_MAX, transmogrifiedCharacter } from '../core/coreConstants';
import type { Direction, ExtraPlayerStart, PlayerCharacter } from '../core/types';
import { cloneMap, type EditorMap } from './editorDocument';
import { extraPlayerAt, replaceExtraPlayers } from './editorExtraPlayers';
import { rotateClockwise } from './editorKeyboard';

/** The locale key of the name of each character (see PLAYER_CHARACTERS). */
export const CHARACTER_NAME_KEYS: Record<PlayerCharacter, string> = {
  chip: 'editor.extra_players.character.chip.label',
  melinda: 'editor.extra_players.character.melinda.label'
};

/** Why a start was not placed. */
export type ExtraPlayerRefusal = 'on_start' | 'too_many';

/** Outcome of placing another player's start. */
export interface ExtraPlayerPlacement {
  map: EditorMap;
  /** False when the map is as it was (out of the grid, same start, refused). */
  changed: boolean;
  refusal?: ExtraPlayerRefusal;
}

function inside(map: EditorMap, x: number, y: number): boolean {
  const height = map.terrain.length;
  const width = map.terrain[0]?.length ?? 0;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

/** The character a new start gets: the one the main player is not, since two of a kind need no second start. */
export function defaultExtraCharacter(levelCharacter: PlayerCharacter | undefined): PlayerCharacter {
  return transmogrifiedCharacter(levelCharacter ?? DEFAULT_PLAYER_CHARACTER);
}

/**
 * Places the start of another player. A start already on the cell is turned (its character stays); the main start's
 * cell and a full list refuse. `character` is the one a new start takes.
 */
export function placeExtraPlayer(source: EditorMap, x: number, y: number, dir: Direction, character: PlayerCharacter): ExtraPlayerPlacement {
  if (source.cc3d || !inside(source, x, y)) return { map: source, changed: false };
  if (source.playerStart.x === x && source.playerStart.y === y) return { map: source, changed: false, refusal: 'on_start' };
  const present = extraPlayerAt(source, x, y);
  if (present) {
    if (present.dir === dir) return { map: source, changed: false };
    const map = cloneMap(source);
    replaceExtraPlayers(map, (map.extraPlayers ?? []).map((entry) => (entry.x === x && entry.y === y ? { ...entry, dir } : entry)));
    return { map, changed: true };
  }
  if ((source.extraPlayers?.length ?? 0) >= EXTRA_PLAYERS_MAX) return { map: source, changed: false, refusal: 'too_many' };
  const map = cloneMap(source);
  replaceExtraPlayers(map, [...(map.extraPlayers ?? []), { x, y, dir, character }]);
  return { map, changed: true };
}

/** Applies a change to the other player standing on a cell; null when the map is CC3D, nobody stands there or nothing changes. */
function editExtraPlayerAt(map: EditorMap, x: number, y: number, change: (entry: ExtraPlayerStart) => ExtraPlayerStart): EditorMap | null {
  if (map.cc3d) return null;
  const present = extraPlayerAt(map, x, y);
  if (!present) return null;
  const next = change(present);
  if (next.dir === present.dir && next.character === present.character) return null;
  const edited = cloneMap(map);
  replaceExtraPlayers(edited, (edited.extraPlayers ?? []).map((entry) => (entry.x === x && entry.y === y ? next : entry)));
  return edited;
}

/** The map with the other player on a cell given a character. */
export function setExtraPlayerCharacter(map: EditorMap, x: number, y: number, character: PlayerCharacter): EditorMap | null {
  return editExtraPlayerAt(map, x, y, (entry) => ({ ...entry, character }));
}

/** The map with the other player on a cell turned a quarter turn clockwise. */
export function rotateExtraPlayerAt(map: EditorMap, x: number, y: number): EditorMap | null {
  return editExtraPlayerAt(map, x, y, (entry) => ({ ...entry, dir: rotateClockwise(entry.dir) }));
}

/** The map without the other player on a cell; null when nobody stands there. */
export function removeExtraPlayerAt(map: EditorMap, x: number, y: number): EditorMap | null {
  if (map.cc3d || !extraPlayerAt(map, x, y)) return null;
  const edited = cloneMap(map);
  replaceExtraPlayers(edited, (edited.extraPlayers ?? []).filter((entry) => !(entry.x === x && entry.y === y)));
  return edited;
}
