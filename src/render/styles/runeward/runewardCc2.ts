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
 * Painters of the Chip's Challenge 2 look-alikes in the Runeward style: the green chip and bomb, the hiking boots, the
 * steel wall and the gender signs are the Runeward painter of the tile they resemble with the shared mark drawn over it
 * (see cc2Variants.ts), in the colours of the Runeward art.
 */

import { CC2_ITEM_VARIANTS, CC2_TERRAIN_VARIANTS, paintCc2Mark, runewardMarkColours } from '../../cc2Variants';
import type { RunewardItemPainter, RunewardTilePainter } from './runewardTiles';

/** The look-alike tiles over the painters of the tiles they resemble; a base without a painter leaves its look-alike out. */
export function variantTilePainters(base: Readonly<Record<string, RunewardTilePainter>>): Record<string, RunewardTilePainter> {
  const painters: Record<string, RunewardTilePainter> = {};
  for (const [id, variant] of Object.entries(CC2_TERRAIN_VARIANTS)) {
    const under = base[variant.base];
    if (under === undefined) continue;
    painters[id] = (ctx, x, y, size, pass, neighbours, env, isEditor, isClosedTrap) => {
      under(ctx, x, y, size, pass, neighbours, env, isEditor, isClosedTrap);
      if (pass !== 'animated') paintCc2Mark(ctx, variant.mark, x, y, size, runewardMarkColours(env.art, variant.mark));
    };
  }
  return painters;
}

/** The look-alike items over the painters of the items they resemble; a base without a painter leaves its look-alike out. */
export function variantItemPainters(base: Readonly<Record<string, RunewardItemPainter>>): Record<string, RunewardItemPainter> {
  const painters: Record<string, RunewardItemPainter> = {};
  for (const [id, variant] of Object.entries(CC2_ITEM_VARIANTS)) {
    const under = base[variant.base];
    if (under === undefined) continue;
    painters[id] = (ctx, x, y, size, env) => {
      under(ctx, x, y, size, env);
      paintCc2Mark(ctx, variant.mark, x, y, size, runewardMarkColours(env.art, variant.mark));
    };
  }
  return painters;
}
