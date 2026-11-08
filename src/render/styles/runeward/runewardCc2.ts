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
 * painter of the monster they resemble, seen through or with a coloured dot. The mirror players are the Runeward mage seen
 * through glass, with Melinda's bow on the mirror Melinda and a pale dot on both.
 */

import { MIRROR_MARK_COLOURS, MIRROR_PLAYER_ALPHA, paintMelindaBow, paintMonsterDot } from '../../cc2Marks';
import { completePose } from './runewardCharacter';
import { runewardClockMs, type RunewardPaintEnv } from './runewardEnv';
import { paintMage } from './runewardPainters';
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
    // A no-sign over a look-alike (the hiking boots) sits on the painter of that look-alike, listed before it.
    const under = base[variant.base] ?? painters[variant.base];
    if (under === undefined) continue;
    painters[id] = (ctx, x, y, size, env) => {
      under(ctx, x, y, size, env);
      paintCc2Mark(ctx, variant.mark, x, y, size, runewardMarkColours(env.art, variant.mark));
    };
  }
  return painters;
}

/** Colour of the dot of a monster look-alike, by the part of the Runeward art it is taken from. */
type MonsterDotColour = 'yellow' | 'red' | 'blue' | 'green' | 'wall';

/** A monster drawn as another one: the Runeward monster it is drawn on, its opacity and the dot it wears, if any. */
interface MonsterVariant {
  readonly base: string;
  readonly alpha: number;
  readonly dot?: MonsterDotColour;
  /** Size of the drawing as a share of the tile, centred (the baby monsters are small); the tile when absent. */
  readonly scale?: number;
}

const OPAQUE = 1;
/** Opacity of the floor mimic, all but invisible on the floor, and of the ghost, which is seen through. */
const FLOOR_MIMIC_ALPHA = 0.2;
const GHOST_ALPHA = 0.55;
/** Size of a baby monster as a share of the tile, as the other styles draw it. */
const BABY_SCALE = 0.62;

/** The CC2 monsters of the game drawn as a Runeward monster of its own look. */
const MONSTER_VARIANTS: Readonly<Record<string, MonsterVariant>> = {
  floor_mimic: { base: 'teeth', alpha: FLOOR_MIMIC_ALPHA },
  timid_teeth: { base: 'teeth', alpha: OPAQUE, dot: 'yellow' },
  ghost: { base: 'wisp', alpha: GHOST_ALPHA, dot: 'wall' },
  rover: { base: 'blob', alpha: OPAQUE, dot: 'red' },
  // The CC3D monsters: the Runeward monster they resemble with a coloured dot (the babies half size, unmarked).
  bouncer: { base: 'pink_ball', alpha: OPAQUE, dot: 'blue' },
  snappy: { base: 'teeth', alpha: OPAQUE, dot: 'red' },
  nibble: { base: 'teeth', alpha: OPAQUE, dot: 'green' },
  blinky: { base: 'glider', alpha: OPAQUE, dot: 'red' },
  baby_blinky: { base: 'glider', alpha: OPAQUE, scale: BABY_SCALE },
  limpy: { base: 'paramecium', alpha: OPAQUE, dot: 'green' },
  limpa: { base: 'bug', alpha: OPAQUE, dot: 'green' },
  omni: { base: 'blob', alpha: OPAQUE, dot: 'green' },
  legs_green: { base: 'walker', alpha: OPAQUE, dot: 'green' },
  legs_red: { base: 'walker', alpha: OPAQUE, dot: 'red' },
  screamer: { base: 'fireball', alpha: OPAQUE, dot: 'blue' },
  baby_screamer: { base: 'fireball', alpha: OPAQUE, scale: BABY_SCALE },
  walker_3d: { base: 'walker', alpha: OPAQUE, dot: 'yellow' },
  // The blue golem: the Runeward tank with a blue dot.
  golem_blue: { base: 'tank', alpha: OPAQUE, dot: 'blue' },
  // The yellow golem: the Runeward tank with a yellow dot (the puppet keeps its stone look).
  golem_yellow: { base: 'tank', alpha: OPAQUE, dot: 'yellow' }
};

/** The colour of a monster's dot in the Runeward art. */
function dotFill(dot: MonsterDotColour, art: RunewardPaintEnv['art']): string {
  switch (dot) {
    case 'yellow':
      return art.keys.yellow.main;
    case 'red':
      return art.keys.red.main;
    case 'blue':
      return art.keys.blue.main;
    case 'green':
      return art.keys.green.main;
    default:
      return art.wall.topLight;
  }
}

/** The look-alike monsters over the painters of the monsters they resemble; a base without a painter leaves its look-alike out. */
export function variantEntityPainters(base: Readonly<Record<string, RunewardEntityPainter>>): Record<string, RunewardEntityPainter> {
  const painters: Record<string, RunewardEntityPainter> = {};
  for (const [id, variant] of Object.entries(MONSTER_VARIANTS)) {
    const under = base[variant.base];
    if (under === undefined) continue;
    painters[id] = (ctx, dir, x, y, size, env) => {
      ctx.save();
      ctx.globalAlpha = (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : OPAQUE) * variant.alpha;
      if (variant.scale !== undefined) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        ctx.translate(cx, cy);
        ctx.scale(variant.scale, variant.scale);
        ctx.translate(-cx, -cy);
      }
      under(ctx, dir, x, y, size, env);
      ctx.restore();
      if (variant.dot === undefined) return;
      const { art } = env;
      const edge = art.ink ? art.ink.line : art.shadow.color;
      const fill = dotFill(variant.dot, art);
      paintMonsterDot(ctx, x, y, size, { fill, edge, ink: fill });
    };
  }
  return painters;
}

/** The mirror players by entity id; true for the one drawn with Melinda's bow. */
const MIRROR_PLAYERS: Readonly<Record<string, boolean>> = { mirror_chip: false, mirror_melinda: true };

/** The mirror players: the Runeward mage standing on the cell, seen through glass, with a pale dot. */
export function mirrorEntityPainters(): Record<string, RunewardEntityPainter> {
  const painters: Record<string, RunewardEntityPainter> = {};
  for (const [id, withBow] of Object.entries(MIRROR_PLAYERS)) {
    painters[id] = (ctx, dir, x, y, size, env) => {
      ctx.save();
      ctx.globalAlpha = (typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : OPAQUE) * MIRROR_PLAYER_ALPHA;
      ctx.translate(x, y);
      paintMage(ctx, size, env.art, completePose({ dir, inWater: false, alive: true, frame: 0, hop: 0 }), runewardClockMs(env));
      ctx.restore();
      if (withBow) paintMelindaBow(ctx, x, y, size, dir);
      paintMonsterDot(ctx, x, y, size, MIRROR_MARK_COLOURS);
    };
  }
  return painters;
}
