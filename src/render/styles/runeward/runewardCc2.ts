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
 * (see cc2Variants.ts), in the colours of the Runeward art. The floor mimic, timid teeth, ghost and rover are the Runeward
 * painter of the monster they resemble, seen through or with a coloured dot.
 */

import { paintMonsterDot } from '../../cc2Marks';
import { CC2_ITEM_VARIANTS, CC2_TERRAIN_VARIANTS, paintCc2Mark, runewardMarkColours } from '../../cc2Variants';
import type { RunewardEntityPainter, RunewardItemPainter, RunewardTilePainter } from './runewardTiles';

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

/** Colour of the dot of a monster look-alike, by the part of the Runeward art it is taken from. */
type MonsterDotColour = 'yellow' | 'red' | 'wall';

/** A monster drawn as another one: the Runeward monster it is drawn on, its opacity and the dot it wears, if any. */
interface MonsterVariant {
  readonly base: string;
  readonly alpha: number;
  readonly dot?: MonsterDotColour;
}

const OPAQUE = 1;
/** Opacity of the floor mimic, all but invisible on the floor, and of the ghost, which is seen through. */
const FLOOR_MIMIC_ALPHA = 0.2;
const GHOST_ALPHA = 0.55;

/** The CC2 monsters of the game drawn as a Runeward monster of its own look. */
const MONSTER_VARIANTS: Readonly<Record<string, MonsterVariant>> = {
  floor_mimic: { base: 'teeth', alpha: FLOOR_MIMIC_ALPHA },
  timid_teeth: { base: 'teeth', alpha: OPAQUE, dot: 'yellow' },
  ghost: { base: 'wisp', alpha: GHOST_ALPHA, dot: 'wall' },
  rover: { base: 'blob', alpha: OPAQUE, dot: 'red' }
};

/** The look-alike monsters over the painters of the monsters they resemble; a base without a painter leaves its look-alike out. */
export function variantEntityPainters(base: Readonly<Record<string, RunewardEntityPainter>>): Record<string, RunewardEntityPainter> {
  const painters: Record<string, RunewardEntityPainter> = {};
  for (const [id, variant] of Object.entries(MONSTER_VARIANTS)) {
    const under = base[variant.base];
    if (under === undefined) continue;
    painters[id] = (ctx, dir, x, y, size, env) => {
      ctx.save();
      ctx.globalAlpha = (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : OPAQUE) * variant.alpha;
      under(ctx, dir, x, y, size, env);
      ctx.restore();
      if (variant.dot === undefined) return;
      const { art } = env;
      const edge = art.ink ? art.ink.line : art.shadow.color;
      const fill = variant.dot === 'yellow' ? art.keys.yellow.main : variant.dot === 'red' ? art.keys.red.main : art.wall.topLight;
      paintMonsterDot(ctx, x, y, size, { fill, edge, ink: fill });
    };
  }
  return painters;
}
