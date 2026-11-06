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
 * Pushable blocks and mirrors of the Runeward style: dirt, ice, colour, arrow blocks and the two kinds of mirror.
 * Every id listed in PENDING keeps the shared drawing until its painter is added to this module;
 * the dispatch in runewardTiles.ts reads the tables and PENDING, so no other file changes.
 */

import type { RunewardEntityPainter } from './runewardTiles';

/** Painters by entity type; an id moves here from PENDING when its painter lands. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = {};

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [
  'dirt_block', 'ice_block', 'color_block_red', 'color_block_green', 'color_block_blue',
  'color_block_yellow', 'arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee',
  'mirror_slash', 'mirror_backslash', 'one_sided_mirror_ne', 'one_sided_mirror_nw',
  'one_sided_mirror_se', 'one_sided_mirror_sw'
];
