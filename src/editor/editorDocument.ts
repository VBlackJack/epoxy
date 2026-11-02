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

import { DEFAULT_RULESET } from '../core/coreConstants';
import { CloneLink, Direction, EntityPlacement, Ruleset, TrapLink, WinRule } from '../core/types';

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

/** Deep copy of a map; nothing is shared with the source. */
export function cloneMap(map: EditorMap): EditorMap {
  return {
    terrain: map.terrain.map((row) => [...row]),
    items: map.items.map((row) => [...row]),
    entities: map.entities.map((e) => ({ ...e })),
    trapLinks: map.trapLinks.map((l) => ({ ...l })),
    cloneLinks: map.cloneLinks.map((l) => ({ ...l })),
    playerStart: { ...map.playerStart }
  };
}

/** Deep copy of a document; nothing is shared with the source. */
export function cloneDocument(doc: EditorDocument): EditorDocument {
  const { terrain, items, entities, trapLinks, cloneLinks, playerStart } = cloneMap(doc);
  return {
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks,
    playerStart,
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
  const normalize = (doc: EditorDocument): string =>
    JSON.stringify({
      terrain: doc.terrain,
      items: doc.items,
      entities: byPosition(doc.entities),
      trapLinks: [...doc.trapLinks].sort((l, m) => l.buttonY - m.buttonY || l.buttonX - m.buttonX || l.trapY - m.trapY || l.trapX - m.trapX),
      cloneLinks: [...doc.cloneLinks].sort((l, m) => l.buttonY - m.buttonY || l.buttonX - m.buttonX || l.clonerY - m.clonerY || l.clonerX - m.clonerX),
      playerStart: doc.playerStart,
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
