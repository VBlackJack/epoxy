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

import { PLAYER_START_FACING } from '../core/cc3d/cc3dConstants';
import { deriveDisplayLayers } from '../core/cc3d/cc3dLayers';
import type { Cc3dLevel } from '../core/cc3d/model';
import { DEFAULT_PLAYER_CHARACTER, DEFAULT_RULESET } from '../core/coreConstants';
import { canonicalJson } from './canonicalJson';
import { canonicalEdges, cloneEdges } from './editorCellEdges';
import { canonicalCellHints, cloneCellHints } from './editorCellHints';
import { canonicalExtraPlayers, cloneExtraPlayers } from './editorExtraPlayers';
import { canonicalRailTracks, cloneRailTracks } from './editorRailTracks';
import { canonicalUnderlays, cloneUnderlays } from './editorUnderlays';
import { canonicalLauncherLinks, cloneLauncherLinks } from './editorLauncherLinks';
import { canonicalSignalLinks, cloneSignalLinks } from './editorSignalLinks';
import { CellEdge, CellHint, CellUnderlay, CloneLink, Direction, EntityPlacement, ExtraPlayerStart, LauncherLink, PlayerCharacter, RailTrackCell, Ruleset, SignalLink, TrapLink, WinRule } from '../core/types';

/** Where the player starts and which way the character faces. */
export interface EditorPlayerStart {
  x: number;
  y: number;
  dir: Direction;
}

/** The map layers of a level being edited. Width and height are implied by `terrain`. */
export interface EditorMap {
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  playerStart: EditorPlayerStart;
  /**
   * The starts of the players beyond the first (Epoxy ruleset only), in canonical form (see normalizeExtraPlayers), in
   * swap order. Absent when the level has one player, and never held by a CC3D level.
   */
  extraPlayers?: ExtraPlayerStart[];
  /** True while an imported level has no start of its own; placing a start clears it. */
  missingStart?: boolean;
  /**
   * Thin walls on cells of any terrain (Epoxy ruleset only), in canonical form (see normalizeCellEdges).
   * Absent when the level has none, and never held by a CC3D level.
   */
  cellEdges?: CellEdge[];
  /**
   * The track segments of the Chip's Challenge 2 track cells (Epoxy ruleset only), in canonical form (see
   * normalizeRailTracks). Not authored by the editor: carried through unchanged. Absent when the level has none, and never held by a CC3D level.
   */
  railTracks?: RailTrackCell[];
  /**
   * Texts of single hint tiles (Epoxy ruleset only), in canonical form (see normalizeCellHints), held on hint tiles only.
   * Absent when the level has none, and never held by a CC3D level.
   */
  cellHints?: CellHint[];
  /**
   * Terrain hidden under a removable top such as a door (Epoxy ruleset only), in canonical form (see
   * normalizeUnderlays). Absent when the level has none, and never held by a CC3D level.
   */
  underlays?: CellUnderlay[];
  /**
   * Shot trigger to shot launcher links (Epoxy ruleset only), in canonical form (see normalizeLauncherLinks).
   * Absent when the level has none, and never held by a CC3D level.
   */
  launcherLinks?: LauncherLink[];
  /**
   * Signal links between devices (Epoxy ruleset only), in canonical form (see normalizeSignalLinks).
   * Absent when the level has none, and never held by a CC3D level.
   */
  signalLinks?: SignalLink[];
  /**
   * CC3D levels only: the single source of truth of the map. Its cells and mobs are immutable (an edit builds
   * a new level that shares every untouched cell), so copies and history steps keep references, never deep
   * copies. `terrain`, `items`, `entities` and `playerStart` are then derived from it for display.
   */
  cc3d?: Cc3dLevel;
}

/** The level fields the editor form edits besides the map. */
export interface EditorMetadata {
  title: string;
  hint: string;
  author: string;
  password: string;
  timeLimitSeconds: number;
  chipsRequired: number;
  winRule: WinRule;
  /** Absent means the default ruleset. */
  ruleset: Ruleset | undefined;
  /** The character the level is played with; absent means Chip. */
  character?: PlayerCharacter;
}

/** Everything an undo step must bring back: the map and the metadata. */
export type EditorDocument = EditorMap & EditorMetadata;

/** Deep copy of a map; nothing is shared with the source, except the immutable CC3D level. */
export function cloneMap(map: EditorMap): EditorMap {
  const cellEdges = map.cc3d ? undefined : cloneEdges(map.cellEdges);
  const railTracks = map.cc3d ? undefined : cloneRailTracks(map.railTracks);
  const cellHints = map.cc3d ? undefined : cloneCellHints(map.cellHints);
  const extraPlayers = map.cc3d ? undefined : cloneExtraPlayers(map.extraPlayers);
  const underlays = map.cc3d ? undefined : cloneUnderlays(map.underlays);
  const launcherLinks = map.cc3d ? undefined : cloneLauncherLinks(map.launcherLinks);
  const signalLinks = map.cc3d ? undefined : cloneSignalLinks(map.signalLinks);
  return {
    terrain: map.terrain.map((row) => [...row]),
    items: map.items.map((row) => [...row]),
    entities: map.entities.map((e) => ({ ...e })),
    trapLinks: map.trapLinks.map((l) => ({ ...l })),
    cloneLinks: map.cloneLinks.map((l) => ({ ...l })),
    playerStart: { ...map.playerStart },
    ...(extraPlayers ? { extraPlayers } : {}),
    ...(map.missingStart ? { missingStart: true } : {}),
    ...(cellEdges ? { cellEdges } : {}),
    ...(railTracks ? { railTracks } : {}),
    ...(cellHints ? { cellHints } : {}),
    ...(underlays ? { underlays } : {}),
    ...(launcherLinks ? { launcherLinks } : {}),
    ...(signalLinks ? { signalLinks } : {}),
    ...(map.cc3d ? { cc3d: map.cc3d } : {})
  };
}

/**
 * The document with the map layers of an edit result: a layer the map no longer has (the thin walls
 * of an edit that removed the last one, or the hidden terrain) is gone from the document too, not left over
 * from before.
 */
export function withEditedMap(doc: EditorDocument, map: EditorMap): EditorDocument {
  const { missingStart: _previousMissingStart, extraPlayers: _previousExtraPlayers, cellEdges: _previousEdges, railTracks: _previousRailTracks, cellHints: _previousCellHints, underlays: _previousUnderlays, launcherLinks: _previousLauncherLinks, signalLinks: _previousSignalLinks, ...rest } = doc;
  return { ...rest, ...map };
}

/** The display layers a CC3D level implies, as the editor map holds them. */
export function displayLayersOf(cc3d: Cc3dLevel): Pick<EditorMap, 'terrain' | 'items' | 'entities' | 'trapLinks' | 'cloneLinks' | 'playerStart'> {
  const { terrain, items, entities } = deriveDisplayLayers(cc3d);
  return {
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: cc3d.player.x, y: cc3d.player.y, dir: cc3d.player.dir ?? PLAYER_START_FACING }
  };
}

/**
 * The document with another CC3D level and the display layers derived from it. The same level (by reference)
 * gives the same document back, so a no-op edit makes no history step.
 */
export function withCc3d(doc: EditorDocument, cc3d: Cc3dLevel): EditorDocument {
  if (doc.cc3d === cc3d) return doc;
  return { ...doc, cc3d, ...displayLayersOf(cc3d) };
}

/**
 * What a history step stores. A CC3D document keeps its level by reference and none of the derived layers
 * (they are rebuilt on the way out), so a step costs the changed cells and one array of references.
 */
export function snapshotDocument(doc: EditorDocument): EditorDocument {
  if (!doc.cc3d) return cloneDocument(doc);
  return {
    terrain: [],
    items: [],
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: doc.playerStart,
    cc3d: doc.cc3d,
    title: doc.title,
    hint: doc.hint,
    author: doc.author,
    password: doc.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    winRule: doc.winRule,
    ruleset: doc.ruleset,
    ...(doc.character !== undefined ? { character: doc.character } : {})
  };
}

/** Brings a stored step back into a usable document: a CC3D one gets its derived layers again. */
export function restoreDocument(snapshot: EditorDocument): EditorDocument {
  return snapshot.cc3d ? { ...snapshot, ...displayLayersOf(snapshot.cc3d) } : snapshot;
}

/** Deep copy of a document; nothing is shared with the source, except the immutable CC3D level. */
export function cloneDocument(doc: EditorDocument): EditorDocument {
  const { terrain, items, entities, trapLinks, cloneLinks, playerStart, extraPlayers, missingStart, cellEdges, railTracks, cellHints, underlays, launcherLinks, signalLinks, cc3d } = cloneMap(doc);
  return {
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks,
    playerStart,
    ...(extraPlayers ? { extraPlayers } : {}),
    ...(missingStart ? { missingStart } : {}),
    ...(cellEdges ? { cellEdges } : {}),
    ...(railTracks ? { railTracks } : {}),
    ...(cellHints ? { cellHints } : {}),
    ...(underlays ? { underlays } : {}),
    ...(launcherLinks ? { launcherLinks } : {}),
    ...(signalLinks ? { signalLinks } : {}),
    ...(cc3d ? { cc3d } : {}),
    title: doc.title,
    hint: doc.hint,
    author: doc.author,
    password: doc.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    winRule: doc.winRule,
    ruleset: doc.ruleset,
    ...(doc.character !== undefined ? { character: doc.character } : {})
  };
}

/** Ruleset as the game reads it: an absent one is the default engine. */
function effectiveRuleset(ruleset: Ruleset | undefined): Ruleset {
  return ruleset ?? DEFAULT_RULESET;
}

function byPosition<T extends { x: number; y: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Whether two documents hold the same level. The order of the entities and of
 * the links does not matter, and an absent ruleset equals the default one.
 */
export function sameDocument(a: EditorDocument, b: EditorDocument): boolean {
  if (a === b) return true;
  if (Boolean(a.cc3d) !== Boolean(b.cc3d)) return false;
  // A CC3D level is compared by reference first; the canonical text (mob order counts) is only the fallback.
  if (a.cc3d && b.cc3d && a.cc3d !== b.cc3d && canonicalJson(a.cc3d) !== canonicalJson(b.cc3d)) return false;
  const hasCc3d = a.cc3d !== undefined;
  const normalize = (doc: EditorDocument): string =>
    JSON.stringify({
      // The layers of a CC3D document are derived from its level, which was compared above.
      terrain: hasCc3d ? null : doc.terrain,
      items: hasCc3d ? null : doc.items,
      entities: hasCc3d ? null : byPosition(doc.entities),
      trapLinks: [...doc.trapLinks].sort((l, m) => l.buttonY - m.buttonY || l.buttonX - m.buttonX || l.trapY - m.trapY || l.trapX - m.trapX),
      cloneLinks: [...doc.cloneLinks].sort((l, m) => l.buttonY - m.buttonY || l.buttonX - m.buttonX || l.clonerY - m.clonerY || l.clonerX - m.clonerX),
      playerStart: hasCc3d ? null : doc.playerStart,
      extraPlayers: hasCc3d ? null : (canonicalExtraPlayers(doc.extraPlayers, doc.playerStart, doc.terrain) ?? []),
      missingStart: doc.missingStart === true,
      cellEdges: hasCc3d ? null : (canonicalEdges(doc.cellEdges, doc.terrain) ?? []),
      railTracks: hasCc3d ? null : (canonicalRailTracks(doc.railTracks, doc.terrain) ?? []),
      cellHints: hasCc3d ? null : (canonicalCellHints(doc.cellHints, doc.terrain) ?? []),
      underlays: hasCc3d ? null : (canonicalUnderlays(doc.underlays, doc.terrain) ?? []),
      launcherLinks: hasCc3d ? null : (canonicalLauncherLinks(doc.launcherLinks, doc.terrain, doc.underlays) ?? []),
      signalLinks: hasCc3d ? null : (canonicalSignalLinks(doc.signalLinks, doc.terrain) ?? []),
      title: doc.title,
      hint: doc.hint,
      author: doc.author,
      password: doc.password,
      timeLimitSeconds: doc.timeLimitSeconds,
      chipsRequired: doc.chipsRequired,
      winRule: doc.winRule,
      ruleset: effectiveRuleset(doc.ruleset),
      character: doc.character ?? DEFAULT_PLAYER_CHARACTER
    });
  return normalize(a) === normalize(b);
}
