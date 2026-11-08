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
 * Painters of the wired devices in the Runeward render style: the purple wall and floor, the toggle switch, the black
 * button and the gray pulse button on the Runeward floor, and the plug that marks a wired trap or flame jet on top
 * of the plain device. The shapes are the shared drawings of wiredArt.ts; every colour comes from the Runeward art
 * config (the portal and signal sections, the swivel device colours, the ink section of the ink drawings).
 */

import type { RunewardArtConfig } from '../../../core/types';
import { paintWiredMark } from '../../relayArt';
import { WIRED_SHAPE_OF_TILE, paintWiredDevice, type WiredColours, type WiredShape } from '../../wiredArt';
import { paintFloor } from './runewardPainters';
import type { RunewardTilePainter } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;

/** The colours a wired device wears in this art: the portal purple, the signal box colours, the swivel metal. */
function coloursOf(art: Art, shape: WiredShape): WiredColours {
  const { ink, portal, signal, device } = art;
  if (shape === 'purple_wall' || shape === 'purple_floor') {
    return ink
      ? { fill: portal.base, edge: ink.line, light: ink.gold, accent: ink.gold, lit: signal.lit }
      : { fill: portal.base, edge: device.swivel.edge, light: portal.ring, accent: shape === 'purple_wall' ? portal.core : portal.ring, lit: signal.lit };
  }
  if (shape === 'gray_button') {
    return { fill: device.swivel.base, edge: ink ? ink.line : device.swivel.edge, light: device.swivel.light, accent: signal.lit, lit: signal.lit };
  }
  return { fill: signal.box, edge: ink ? ink.line : signal.idle, light: signal.idle, accent: signal.idle, lit: signal.lit };
}

/** A wired device drawn over the Runeward floor; motionless, so it goes with the cached terrain. */
function wiredDeviceTile(shape: WiredShape): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env) => {
    if (pass === 'animated') return;
    ctx.save();
    ctx.translate(x, y);
    paintFloor(ctx, size, env.art, nb);
    paintWiredDevice(ctx, shape, 0, 0, size, coloursOf(env.art, shape), { glow: env.art.ink ? undefined : env.art.signal.lit });
    ctx.restore();
  };
}

/**
 * A plain device painter with the plug of a wired cell on top. `animated` is true when the plain device has an animated
 * pass (a lit flame jet): the plug then follows the animated pass, so it is drawn over the flames, and the cached pass
 * leaves it out.
 */
export function withWiredMark(base: RunewardTilePainter, animated: boolean): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env, isEditor, isClosedTrap) => {
    base(ctx, x, y, size, pass, nb, env, isEditor, isClosedTrap);
    if (animated ? pass === 'static' : pass === 'animated') return;
    const { ink, portal, shadow } = env.art;
    paintWiredMark(ctx, x, y, size, { body: ink ? ink.gold : portal.ring, edge: ink ? ink.line : shadow.color });
  };
}

/** Painters of the wired devices that have a drawing of their own, by tile id. */
export const WIRED_TILES: Readonly<Record<string, RunewardTilePainter>> = Object.fromEntries(
  Object.entries(WIRED_SHAPE_OF_TILE).map(([id, shape]): [string, RunewardTilePainter] => [id, wiredDeviceTile(shape)])
);
