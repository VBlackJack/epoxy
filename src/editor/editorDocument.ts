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
import { DEFAULT_RULESET } from '../core/coreConstants';
import { canonicalJson } from './canonicalJson';
import { canonicalEdges, cloneEdges } from './editorCellEdges';
import { CellEdge, CloneLink, Direction, EntityPlacement, Ruleset, TrapLink, WinRule } from '../core/types';

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
   * Thin walls on cells of any terrain (Epoxy ruleset only), in canonical form (see normalizeCellEdges).
   * Absent when the level has none, and never held by a CC3D level.
   */
  cellEdges?: CellEdge[];
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
}

/** Everything an undo step must bring back: the map and the metadata. */
export type EditorDocument = EditorMap & EditorMetadata;

/** Deep copy of a map; nothing is shared with the source, except the immutable CC3D level. */
export function cloneMap(map: EditorMap): EditorMap {
  const cellEdges = map.cc3d ? undefined : cloneEdges(map.cellEdges);
  return {
    terrain: map.terrain.map((row) => [...row]),
    items: map.items.map((row) => [...row]),
    entities: map.entities.map((e) => ({ ...e })),
    trapLinks: map.trapLinks.map((l) => ({ ...l })),
    cloneLinks: map.cloneLinks.map((l) => ({ ...l })),
    playerStart: { ...map.playerStart },
    ...(cellEdges ? { cellEdges } : {}),
    ...(map.cc3d ? { cc3d: map.cc3d } : {})
  };
}

/**
 * The document with the map layers of an edit result: a layer the map no longer has (the thin walls
 * of an edit that removed the last one) is gone from the document too, not left over from before.
 */
export function withEditedMap(doc: EditorDocument, map: EditorMap): EditorDocument {
  const { cellEdges: _previous, ...rest } = doc;
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
    ruleset: doc.ruleset
  };
}

/** Brings a stored step back into a usable document: a CC3D one gets its derived layers again. */
export function restoreDocument(snapshot: EditorDocument): EditorDocument {
  return snapshot.cc3d ? { ...snapshot, ...displayLayersOf(snapshot.cc3d) } : snapshot;
}

/** Deep copy of a document; nothing is shared with the source, except the immutable CC3D level. */
export function cloneDocument(doc: EditorDocument): EditorDocument {
  const { terrain, items, entities, trapLinks, cloneLinks, playerStart, cellEdges, cc3d } = cloneMap(doc);
  return {
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks,
    playerStart,
    ...(cellEdges ? { cellEdges } : {}),
    ...(cc3d ? { cc3d } : {}),
    title: doc.title,
    hint: doc.hint,
    author: doc.author,
    password: doc.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    winRule: doc.winRule,
    ruleset: doc.ruleset
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
      cellEdges: hasCc3d ? null : (canonicalEdges(doc.cellEdges, doc.terrain) ?? []),
      title: doc.title,
      hint: doc.hint,
      author: doc.author,
      password: doc.password,
      timeLimitSeconds: doc.timeLimitSeconds,
      chipsRequired: doc.chipsRequired,
      winRule: doc.winRule,
      ruleset: effectiveRuleset(doc.ruleset)
    });
  return normalize(a) === normalize(b);
}
