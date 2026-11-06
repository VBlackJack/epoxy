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
 * Monsters of the Runeward style and the shot in flight.
 * Every id listed in PENDING keeps the shared drawing until its painter is added to this module;
 * the dispatch in runewardTiles.ts reads the tables and PENDING, so no other file changes.
 */

import type { RunewardEntityPainter } from './runewardTiles';

/** Painters by entity type; an id moves here from PENDING when its painter lands. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = {};

/** Painter of a shot in flight, or null while the shared drawing is used. */
export const SHOT: RunewardEntityPainter | null = null;

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob', 'puppet',
  'skitter'
];
