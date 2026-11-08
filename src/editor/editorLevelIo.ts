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

import type { Cc3dLevel } from '../core/cc3d/model';
import { DEFAULT_PLAYER_CHARACTER, DEFAULT_RULESET, DEFAULT_WIN_RULE } from '../core/coreConstants';
import type { CompiledLevel } from '../core/types';
import { canonicalEdges } from './editorCellEdges';
import { canonicalExtraPlayers } from './editorExtraPlayers';
import { canonicalRailTracks } from './editorRailTracks';
import { canonicalUnderlays } from './editorUnderlays';
import { canonicalLauncherLinks } from './editorLauncherLinks';
import { canonicalSignalLinks } from './editorSignalLinks';
import { cloneMap, displayLayersOf, type EditorDocument, type EditorMetadata } from './editorDocument';

/**
 * Conversion between a stored level and the document the editor holds. Pure: the editor supplies the
 * texts it resolved and the values it chose for the export, and these functions only move data.
 */

/** The title and hint shown in the form when a level was opened (already translated). */
/** The ruleset whose levels are held as cc3d data. */
export const CC3D_RULESET = 'cc3d';

export interface DocumentTexts {
  title: string;
  hint: string;
}

/** What an export needs from the editor besides the document. */
export interface LevelExportContext {
  id: string;
  number: number;
  /** The password to store, already resolved. */
  password: string;
  /** Title used when the form's title is empty. */
  fallbackTitle: string;
}

/** Fish an exit must be preceded by: the importer's count, `fish` items only. */
export function cc3dFishCount(cc3d: Pick<Cc3dLevel, 'cells'>): number {
  return cc3d.cells.reduce((count, cell) => (cell.item?.kind === 'fish' ? count + 1 : count), 0);
}

/**
 * The editor document of a level. A CC3D level is held as its cc3d data (shared by reference, it is never
 * mutated) and its display layers are derived from it; any other level is deep-copied.
 */
export function documentFromLevel(level: CompiledLevel, texts: DocumentTexts): EditorDocument {
  const map = level.cc3d ? { ...cloneMap(level), ...displayLayersOf(level.cc3d), cc3d: level.cc3d } : cloneMap(level);
  // The editor holds thin walls in canonical form, so two documents of the same walls compare equal.
  const cellEdges = level.cc3d ? undefined : canonicalEdges(map.cellEdges, map.terrain);
  if (cellEdges) map.cellEdges = cellEdges;
  else delete map.cellEdges;
  // Track cells are held in canonical form too, and only on cells that still hold a track cell tile.
  const railTracks = level.cc3d ? undefined : canonicalRailTracks(map.railTracks, map.terrain);
  if (railTracks) map.railTracks = railTracks;
  else delete map.railTracks;
  // The other players are held in canonical form too: inside the grid, off the main start and off each other.
  const extraPlayers = level.cc3d ? undefined : canonicalExtraPlayers(map.extraPlayers, map.playerStart, map.terrain);
  if (extraPlayers) map.extraPlayers = extraPlayers;
  else delete map.extraPlayers;
  // Hidden terrain is held in canonical form too, and only where the terrain on top can still hide it.
  const underlays = level.cc3d ? undefined : canonicalUnderlays(map.underlays, map.terrain);
  if (underlays) map.underlays = underlays;
  else delete map.underlays;
  // Launcher links are held in canonical form too, and only where a trigger and a launcher still stand at their ends.
  const launcherLinks = level.cc3d ? undefined : canonicalLauncherLinks(map.launcherLinks, map.terrain, map.underlays);
  if (launcherLinks) map.launcherLinks = launcherLinks;
  else delete map.launcherLinks;
  // Signal links are held in canonical form too; an end is not checked against the tiles, so an import is kept whole.
  const signalLinks = level.cc3d ? undefined : canonicalSignalLinks(map.signalLinks, map.terrain);
  if (signalLinks) map.signalLinks = signalLinks;
  else delete map.signalLinks;
  return {
    ...map,
    title: texts.title,
    hint: texts.hint,
    author: level.author ?? '',
    password: level.password,
    timeLimitSeconds: level.timeLimitSeconds,
    chipsRequired: level.chipsRequired,
    winRule: level.winRule ?? DEFAULT_WIN_RULE,
    ruleset: level.ruleset,
    ...(level.character !== undefined && level.character !== DEFAULT_PLAYER_CHARACTER ? { character: level.character } : {})
  };
}

/**
 * The metadata the form read, with what the engine of the document forbids put back: a CC3D document
 * keeps its cc3d ruleset (the Epoxy rules the laser content or the win rule would force do not apply to
 * it), and any other document keeps its own ruleset when the form names cc3d.
 */
export function metadataForDocument(doc: EditorDocument, next: EditorMetadata): EditorMetadata {
  if (doc.cc3d) return { ...next, ruleset: doc.ruleset };
  // No other level takes the cc3d engine from the form: it would have no cc3d data to play.
  return next.ruleset === CC3D_RULESET ? { ...next, ruleset: doc.ruleset } : next;
}

/**
 * The level an editor document stands for. A CC3D level keeps its cc3d data (map id included), has its
 * display layers derived from it and its required fish recomputed from the cells; any other level is
 * exported exactly as before.
 */
export function levelFromDocument(doc: EditorDocument, context: LevelExportContext): CompiledLevel {
  // The ruleset decides which engine reads the level: cc3d data under another ruleset would silently not play.
  if (doc.cc3d && doc.ruleset !== CC3D_RULESET) throw new Error(`A document with cc3d data must have the ${CC3D_RULESET} ruleset`);
  const level: CompiledLevel = {
    id: context.id,
    ...(doc.winRule === DEFAULT_WIN_RULE ? {} : { winRule: doc.winRule }),
    ...(doc.ruleset ? { ruleset: doc.ruleset } : {}),
    // Chip is the default character and stays unwritten, so a level played by Chip keeps the record it always had.
    ...(doc.character !== undefined && doc.character !== DEFAULT_PLAYER_CHARACTER ? { character: doc.character } : {}),
    number: context.number,
    customTitle: doc.title || context.fallbackTitle,
    customHint: doc.hint,
    ...(doc.author ? { author: doc.author } : {}),
    password: context.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    ...cloneMap(doc)
  };
  // A track cell entry only stays on a cell that still holds a track cell tile (the editor does not author them).
  const exportedRailTracks = doc.cc3d ? undefined : canonicalRailTracks(level.railTracks, level.terrain);
  if (exportedRailTracks) level.railTracks = exportedRailTracks;
  else delete level.railTracks;
  const exportedExtraPlayers = doc.cc3d ? undefined : canonicalExtraPlayers(level.extraPlayers, level.playerStart, level.terrain);
  if (exportedExtraPlayers) level.extraPlayers = exportedExtraPlayers;
  else delete level.extraPlayers;
  // Thin walls exist under the Epoxy ruleset only: a document of another ruleset never exports them.
  // Hidden terrain, shot launcher links and signal links are Epoxy features in the same way.
  if (doc.ruleset !== undefined && doc.ruleset !== DEFAULT_RULESET) {
    delete level.character;
    delete level.extraPlayers;
    delete level.cellEdges;
    delete level.railTracks;
    delete level.underlays;
    delete level.launcherLinks;
    delete level.signalLinks;
  }
  if (doc.cc3d) {
    Object.assign(level, displayLayersOf(doc.cc3d), { chipsRequired: cc3dFishCount(doc.cc3d) });
  }
  return level;
}
