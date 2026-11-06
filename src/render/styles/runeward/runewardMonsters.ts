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
 *
 * Every creature is drawn into a small display list (shapes with their colours and widths) that is
 * built once per type, facing, walk frame and tile size, kept in the painter cache, and replayed at
 * each draw with the bob of the clock. The creatures are original Runeward drawings: ink outline,
 * a soft ellipse shadow, a small bob and two eye dots toward the facing. On the parchment variant
 * (art.ink present) the outlines are ink lines over flat washes and every glow becomes a gold-ink
 * halo. The proportions are the drawings themselves, so they are named constants below; every colour
 * comes from the art config.
 */

import type { Direction, RunewardArtConfig, RunewardCreatureColours } from '../../../core/types';
import { hasInkHatching, heavyLineWidth, inkLineWidth } from './runewardInk';
import { runewardClockMs, runewardMonsterSprite, runewardWalkFrame, type RunewardEntityPainter } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;
type Point = readonly [number, number];

const TAU = Math.PI * 2;
const HALF = 0.5;

// ---- Display list ------------------------------------------------------------------------------

/** One path command; coordinates are in pixels of the tile. */
type Segment =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['E', number, number, number, number, number]
  | readonly ['Z'];

/** A filled and/or stroked path with its colours. */
interface Shape {
  readonly segments: readonly Segment[];
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly width: number;
  readonly alpha: number;
}

/** A creature ready to replay: its shadow, which stays on the ground, and its body, which bobs. */
interface Sprite {
  readonly shadow: readonly Shape[];
  readonly body: readonly Shape[];
}

/** Which ink line a silhouette gets. */
type Edge = 'heavy' | 'fine' | null;

interface Style {
  readonly fill?: string | null;
  readonly edge?: Edge;
  readonly alpha?: number;
}

/** Smallest radius of an eye dot or spark, in pixels. */
const MIN_DOT_PX = 1.2;
/** Eye dot radius, as a fraction of the tile. */
const EYE_RADIUS = 0.032;
/** Opacity of an eye seen from behind (peeking over the shoulder). */
const EYE_BEHIND_ALPHA = 0.55;
/** Lift of the eyes of an upright creature seen from behind, in tiles. */
const EYE_BEHIND_LIFT = 0.045;
/** Opacity of highlights and soft shading laid over a body. */
const SHEEN_ALPHA = 0.5;
/** Opacity of the outer layer of the soft shadow, and the radius share of the inner layer. */
const SHADOW_OUTER_ALPHA = 0.5;
const SHADOW_INNER_SCALE = 0.62;
/** Halo of a glow: opacity of the outer and inner layers, and the radius share of the inner one. */
const HALO_OUTER_ALPHA = 0.2;
const HALO_INNER_ALPHA = 0.32;
const HALO_INNER_SCALE = 0.62;
/** Opacity of the gold-ink ring that stands for a glow on the parchment. */
const GOLD_HALO_ALPHA = 0.85;
/** Hatching of the parchment: strokes laid on the shaded flank of a body. */
const HATCH = { strokes: 3, gap: 0.05, reach: 0.06, alpha: 0.7 } as const;

/** Builds the shapes of one creature in tile fractions, sized to the tile in pixels as it goes. */
class Drawing {
  readonly shapes: Shape[] = [];
  readonly outline: string;
  readonly ink: boolean;

  constructor(
    readonly size: number,
    readonly art: Art
  ) {
    this.ink = art.ink !== undefined;
    this.outline = art.ink ? art.ink.line : art.block.dirt.edge;
  }

  private edgeWidth(edge: Exclude<Edge, null>): number {
    return edge === 'heavy' ? heavyLineWidth(this.size) : inkLineWidth(this.size);
  }

  private px(value: number): number {
    return value * this.size;
  }

  private add(segments: Segment[], style: Style): void {
    const edge = style.edge ?? null;
    this.shapes.push({
      segments,
      fill: style.fill ?? null,
      stroke: edge === null ? null : this.outline,
      width: edge === null ? 0 : this.edgeWidth(edge),
      alpha: style.alpha ?? 1
    });
  }

  private open(points: readonly Point[]): Segment[] {
    return points.map(([x, y], i): Segment => [i === 0 ? 'M' : 'L', this.px(x), this.px(y)]);
  }

  /** A closed polygon. */
  poly(points: readonly Point[], style: Style): void {
    this.add([...this.open(points), ['Z']], style);
  }

  /** A closed smooth curve through the midpoints of the polygon sides, as an ooze outline. */
  smooth(points: readonly Point[], style: Style): void {
    const count = points.length;
    const mid = (i: number): Point => {
      const a = points[i % count];
      const b = points[(i + 1) % count];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    const start = mid(count - 1);
    const segments: Segment[] = [['M', this.px(start[0]), this.px(start[1])]];
    for (let i = 0; i < count; i += 1) {
      const end = mid(i);
      segments.push(['Q', this.px(points[i][0]), this.px(points[i][1]), this.px(end[0]), this.px(end[1])]);
    }
    segments.push(['Z']);
    this.add(segments, style);
  }

  /** An ellipse whose first radius lies along the angle `rotation`. */
  oval(cx: number, cy: number, rx: number, ry: number, rotation: number, style: Style): void {
    this.add([['E', this.px(cx), this.px(cy), this.px(rx), this.px(ry), rotation]], style);
  }

  /** A disc. */
  disc(cx: number, cy: number, radius: number, style: Style): void {
    this.oval(cx, cy, radius, radius, 0, style);
  }

  /** A rectangle with rounded corners. */
  roundRect(x: number, y: number, w: number, h: number, r: number, style: Style): void {
    const [x0, y0, x1, y1, rr] = [x, y, x + w, y + h, r].map((v) => this.px(v));
    this.add(
      [
        ['M', x0 + rr, y0],
        ['L', x1 - rr, y0],
        ['Q', x1, y0, x1, y0 + rr],
        ['L', x1, y1 - rr],
        ['Q', x1, y1, x1 - rr, y1],
        ['L', x0 + rr, y1],
        ['Q', x0, y1, x0, y1 - rr],
        ['L', x0, y0 + rr],
        ['Q', x0, y0, x0 + rr, y0],
        ['Z']
      ],
      style
    );
  }

  /** An open stroke through the points, in a colour and a width in pixels. */
  line(points: readonly Point[], colour: string, width: number, alpha = 1): void {
    this.shapes.push({ segments: this.open(points), fill: null, stroke: colour, width, alpha });
  }

  /** An open stroke in the ink outline colour. */
  inkLine(points: readonly Point[], edge: Exclude<Edge, null> = 'fine'): void {
    this.line(points, this.outline, this.edgeWidth(edge));
  }

  /** The eye dots. */
  eyes(points: readonly Point[], colour: string, alpha = 1): void {
    const radius = Math.max(MIN_DOT_PX, this.px(EYE_RADIUS));
    for (const [x, y] of points) {
      this.shapes.push({ segments: [['E', this.px(x), this.px(y), radius, radius, 0]], fill: colour, stroke: null, width: 0, alpha });
    }
  }

  /** A small dot, never thinner than a pixel. */
  spark(cx: number, cy: number, radius: number, colour: string, alpha: number): void {
    const r = Math.max(MIN_DOT_PX, this.px(radius));
    this.shapes.push({ segments: [['E', this.px(cx), this.px(cy), r, r, 0]], fill: colour, stroke: null, width: 0, alpha });
  }

  /** A glow: soft layers of the colour on the plain art, a thin gold-ink ring on the parchment. */
  halo(cx: number, cy: number, radius: number, colour: string): void {
    const { ink } = this.art;
    if (ink) {
      this.shapes.push({
        segments: [['E', this.px(cx), this.px(cy), this.px(radius), this.px(radius), 0]],
        fill: null,
        stroke: ink.gold,
        width: inkLineWidth(this.size),
        alpha: GOLD_HALO_ALPHA
      });
      return;
    }
    this.disc(cx, cy, radius, { fill: colour, alpha: HALO_OUTER_ALPHA });
    this.disc(cx, cy, radius * HALO_INNER_SCALE, { fill: colour, alpha: HALO_INNER_ALPHA });
  }

  /** Short hatch strokes on the shaded flank of a body; parchment only, and only on tiles big enough. */
  hatch(cx: number, cy: number): void {
    const { ink } = this.art;
    if (!ink || !hasInkHatching(this.size)) return;
    for (let i = 0; i < HATCH.strokes; i += 1) {
      const shift = (i - (HATCH.strokes - 1) / 2) * HATCH.gap;
      this.line(
        [
          [cx + shift, cy],
          [cx + shift + HATCH.reach, cy + HATCH.reach]
        ],
        ink.hatch,
        inkLineWidth(this.size),
        HATCH.alpha
      );
    }
  }
}

/** Draws the shapes of a display list into the context. */
function replay(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const shape of shapes) {
    ctx.beginPath();
    for (const segment of shape.segments) {
      switch (segment[0]) {
        case 'M':
          ctx.moveTo(segment[1], segment[2]);
          break;
        case 'L':
          ctx.lineTo(segment[1], segment[2]);
          break;
        case 'Q':
          ctx.quadraticCurveTo(segment[1], segment[2], segment[3], segment[4]);
          break;
        case 'E':
          ctx.ellipse(segment[1], segment[2], segment[3], segment[4], segment[5], 0, TAU);
          break;
        case 'Z':
          ctx.closePath();
          break;
      }
    }
    if (shape.alpha !== 1) ctx.globalAlpha = shape.alpha;
    if (shape.fill !== null) {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
    if (shape.stroke !== null) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (shape.alpha !== 1) ctx.globalAlpha = 1;
  }
}

// ---- Facing --------------------------------------------------------------------------------------

/** Forward and right-hand unit vectors of a facing, and the angle of the forward vector. */
interface Axes {
  readonly fx: number;
  readonly fy: number;
  readonly sx: number;
  readonly sy: number;
  readonly angle: number;
}

const AXES: Readonly<Record<Direction, Axes>> = {
  N: { fx: 0, fy: -1, sx: 1, sy: 0, angle: -Math.PI / 2 },
  E: { fx: 1, fy: 0, sx: 0, sy: 1, angle: 0 },
  S: { fx: 0, fy: 1, sx: -1, sy: 0, angle: Math.PI / 2 },
  W: { fx: -1, fy: 0, sx: 0, sy: -1, angle: Math.PI }
};

/** What a builder knows about the pose it draws. */
interface Pose {
  readonly axes: Axes;
  /** Walk frame, 0 or 1. */
  readonly frame: number;
  /** -1 / +1 by walk frame, for features that swap sides each step. */
  readonly swing: number;
  /** -1 west, 1 east, 0 facing the viewer or away from it. */
  readonly side: number;
  /** True when the creature walks away from the viewer. */
  readonly away: boolean;
  readonly colours: Readonly<RunewardCreatureColours>;
}

/** The point `forward` ahead and `right` to the right of the centre (cx, cy). */
function at(pose: Pose, cx: number, cy: number, forward: number, right: number): Point {
  const { fx, fy, sx, sy } = pose.axes;
  return [cx + fx * forward + sx * right, cy + fy * forward + sy * right];
}

/** An ellipse stretched `length` along the facing and `width` across it. */
function alongOval(
  d: Drawing,
  pose: Pose,
  cy: number,
  forward: number,
  right: number,
  length: number,
  width: number,
  style: Style
): void {
  const [x, y] = at(pose, HALF, cy, forward, right);
  d.oval(x, y, length, width, pose.axes.angle, style);
}

/** Eyes of a creature seen from above, ahead of the centre. */
function topEyes(d: Drawing, pose: Pose, cx: number, cy: number, forward: number, spread: number, colour: string): void {
  d.eyes([at(pose, cx, cy, forward, -spread), at(pose, cx, cy, forward, spread)], colour);
}

/** Eyes of an upright creature: both in front, both toward the side in profile, higher and dim from behind. */
function uprightEyes(d: Drawing, pose: Pose, cx: number, y: number, spread: number, shift: number, colour: string): void {
  const lift = pose.away ? EYE_BEHIND_LIFT : 0;
  const alpha = pose.away ? EYE_BEHIND_ALPHA : 1;
  const xs = pose.side === 0 ? [cx - spread, cx + spread] : [cx + pose.side * shift, cx + pose.side * (shift - spread * 2)];
  d.eyes(
    xs.map((x): Point => [x, y - lift]),
    colour,
    alpha
  );
}

// ---- Shadows -------------------------------------------------------------------------------------

/** Ground shadow of a creature: height in the tile and radii. */
interface ShadowSpec {
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

const SHADOWS: Readonly<Record<string, ShadowSpec>> = {
  bug: { y: 0.78, rx: 0.3, ry: 0.07 },
  paramecium: { y: 0.76, rx: 0.3, ry: 0.06 },
  pink_ball: { y: 0.8, rx: 0.22, ry: 0.06 },
  walker: { y: 0.86, rx: 0.26, ry: 0.065 },
  teeth: { y: 0.86, rx: 0.28, ry: 0.06 },
  skitter: { y: 0.86, rx: 0.22, ry: 0.05 },
  glider: { y: 0.88, rx: 0.16, ry: 0.04 },
  fireball: { y: 0.88, rx: 0.16, ry: 0.04 },
  tank: { y: 0.8, rx: 0.3, ry: 0.07 },
  blob: { y: 0.84, rx: 0.28, ry: 0.06 },
  puppet: { y: 0.88, rx: 0.32, ry: 0.07 }
};

/** The soft shadow: a wide faint ellipse with a smaller, darker one inside. */
function shadowOf(size: number, art: Art, spec: ShadowSpec): Shape[] {
  const colour = art.mage.shadow;
  const mark = new Drawing(size, art);
  mark.oval(HALF, spec.y, spec.rx, spec.ry, 0, { fill: colour, alpha: SHADOW_OUTER_ALPHA });
  mark.oval(HALF, spec.y, spec.rx * SHADOW_INNER_SCALE, spec.ry * SHADOW_INNER_SCALE, 0, { fill: colour });
  return mark.shapes;
}

// ---- Rune mite (bug) ---------------------------------------------------------------------------

const BUG = {
  cy: 0.56,
  shell: { length: 0.3, width: 0.21 },
  shine: { forward: -0.05, right: 0.08, length: 0.13, width: 0.045 },
  seam: { from: -0.26, to: 0.2 },
  head: { forward: 0.27, length: 0.1, width: 0.09 },
  /** Legs: positions along the shell, root and tip distance from the axis, and the swing of a step. */
  legs: { at: [-0.15, 0, 0.15], root: 0.17, tip: 0.31, swing: 0.045 },
  feeler: { rootForward: 0.33, rootRight: 0.04, tipForward: 0.46, tipRight: 0.12 },
  /** The notch bitten out of the left flank: where it sits and its size. */
  notch: { forward: 0, half: 0.075, depth: 0.12, edge: 0.215 },
  eye: { forward: 0.31, spread: 0.045 }
} as const;

function buildBug(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const { cy } = BUG;
  for (const [i, forward] of BUG.legs.at.entries()) {
    const step = (i + pose.frame) % 2 === 0 ? 1 : -1;
    for (const right of [-1, 1]) {
      const tipShift = BUG.legs.swing * step * right;
      d.inkLine([at(pose, HALF, cy, forward, right * BUG.legs.root), at(pose, HALF, cy, forward + tipShift, right * BUG.legs.tip)], 'heavy');
    }
  }
  for (const right of [-1, 1]) {
    d.inkLine([
      at(pose, HALF, cy, BUG.feeler.rootForward, right * BUG.feeler.rootRight),
      at(pose, HALF, cy, BUG.feeler.tipForward, right * BUG.feeler.tipRight)
    ]);
  }
  alongOval(d, pose, cy, 0, 0, BUG.shell.length, BUG.shell.width, { fill: c.body, edge: 'heavy' });
  alongOval(d, pose, cy, BUG.shine.forward, BUG.shine.right, BUG.shine.length, BUG.shine.width, { fill: c.light, alpha: SHEEN_ALPHA });
  d.line([at(pose, HALF, cy, BUG.seam.from, 0), at(pose, HALF, cy, BUG.seam.to, 0)], c.dark, inkLineWidth(d.size));
  const [hx, hy] = at(pose, HALF, cy, 0, 0.05);
  d.hatch(hx, hy);
  alongOval(d, pose, cy, BUG.head.forward, 0, BUG.head.length, BUG.head.width, { fill: c.dark, edge: 'heavy' });
  const n = BUG.notch;
  d.poly(
    [
      at(pose, HALF, cy, n.forward - n.half, -n.edge),
      at(pose, HALF, cy, n.forward, -(n.edge - n.depth)),
      at(pose, HALF, cy, n.forward + n.half, -n.edge)
    ],
    { fill: d.outline }
  );
  topEyes(d, pose, HALF, cy, BUG.eye.forward, BUG.eye.spread, c.eye);
}

// ---- Cilia drifter (paramecium) ----------------------------------------------------------------

const PARAMECIUM = {
  cy: 0.56,
  body: { length: 0.37, width: 0.15 },
  cilia: { count: 8, from: -0.28, to: 0.28, length: 0.085, tilt: 0.035 },
  nucleus: { forward: -0.1, length: 0.1, width: 0.055 },
  /** The notch bitten out of the right flank. */
  notch: { forward: 0.04, half: 0.06, depth: 0.095, edge: 0.15 },
  eye: { forward: 0.27, spread: 0.05 }
} as const;

function buildParamecium(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const { cy } = PARAMECIUM;
  const fringe = d.ink ? d.outline : c.light;
  const k = PARAMECIUM.cilia;
  for (let i = 0; i < k.count; i += 1) {
    const forward = k.from + (i * (k.to - k.from)) / (k.count - 1);
    const lean = (i + pose.frame) % 2 === 0 ? k.tilt : -k.tilt;
    for (const right of [-1, 1]) {
      d.line(
        [at(pose, HALF, cy, forward, right * PARAMECIUM.body.width), at(pose, HALF, cy, forward + lean, right * (PARAMECIUM.body.width + k.length))],
        fringe,
        inkLineWidth(d.size)
      );
    }
  }
  alongOval(d, pose, cy, 0, 0, PARAMECIUM.body.length, PARAMECIUM.body.width, { fill: c.body, edge: 'heavy' });
  const nu = PARAMECIUM.nucleus;
  alongOval(d, pose, cy, nu.forward, 0, nu.length, nu.width, { fill: c.dark, alpha: SHEEN_ALPHA, edge: 'fine' });
  const [hx, hy] = at(pose, HALF, cy, 0.1, -0.05);
  d.hatch(hx, hy);
  const n = PARAMECIUM.notch;
  d.poly(
    [
      at(pose, HALF, cy, n.forward - n.half, n.edge),
      at(pose, HALF, cy, n.forward, n.edge - n.depth),
      at(pose, HALF, cy, n.forward + n.half, n.edge)
    ],
    { fill: d.outline }
  );
  topEyes(d, pose, HALF, cy, PARAMECIUM.eye.forward, PARAMECIUM.eye.spread, c.eye);
}

// ---- Rose quartz ball (pink_ball) --------------------------------------------------------------

const PINK_BALL = {
  cy: 0.54,
  radius: 0.25,
  /** Squash of the stride frame: wider and flatter. */
  squash: { x: 1.12, y: 0.86 },
  band: { length: 0.06, width: 0.235 },
  shine: { dx: -0.09, dy: -0.09, radius: 0.055 },
  chevron: { distance: 0.36, half: 0.07, depth: 0.05 },
  eye: { forward: 0.13, spread: 0.075 }
} as const;

function buildPinkBall(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = PINK_BALL;
  const squashed = pose.frame === 1;
  const sx = squashed ? k.squash.x : 1;
  const sy = squashed ? k.squash.y : 1;
  const cy = k.cy + k.radius * (1 - sy);
  const mark = d.ink ? d.outline : c.eye;
  for (const sign of [1, -1]) {
    const tip = at(pose, HALF, cy, sign * k.chevron.distance, 0);
    const back = (right: number): Point => at(pose, HALF, cy, sign * (k.chevron.distance - k.chevron.depth), right);
    d.line([back(-k.chevron.half), tip, back(k.chevron.half)], mark, heavyLineWidth(d.size));
  }
  d.oval(HALF, cy, k.radius * sx, k.radius * sy, 0, { fill: c.body, edge: 'heavy' });
  alongOval(d, pose, cy, 0, 0, k.band.length * sx, k.band.width * sy, { fill: c.dark, edge: 'fine' });
  d.disc(HALF + k.shine.dx, cy + k.shine.dy, k.shine.radius, { fill: c.light, alpha: SHEEN_ALPHA });
  topEyes(d, pose, HALF, cy, k.eye.forward, k.eye.spread, c.eye);
}

// ---- Cairn strider (walker) --------------------------------------------------------------------

const WALKER = {
  legs: { xs: [0.4, 0.6], top: 0.66, bottom: 0.84, width: 0.1, lift: 0.045 },
  /** Stacked stones from the bottom: height and radii. */
  stones: [
    { y: 0.6, rx: 0.21, ry: 0.1 },
    { y: 0.46, rx: 0.16, ry: 0.085 },
    { y: 0.34, rx: 0.11, ry: 0.07 }
  ],
  /** Lean of each stone toward the side it faces, and its sway with the stride. */
  lean: 0.025,
  sway: 0.01,
  topShine: { dy: -0.025, rx: 0.5, ry: 0.35 },
  eye: { y: 0.46, spread: 0.05, shift: 0.1 },
  backRune: { y: 0.46, half: 0.05 }
} as const;

function buildWalker(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = WALKER;
  for (const [i, x] of k.legs.xs.entries()) {
    const lifted = (i + pose.frame) % 2 === 0;
    const bottom = k.legs.bottom - (lifted ? k.legs.lift : 0);
    d.roundRect(x - k.legs.width / 2, k.legs.top, k.legs.width, bottom - k.legs.top, k.legs.width / 3, { fill: c.dark, edge: 'heavy' });
  }
  for (const [i, stone] of k.stones.entries()) {
    const cx = HALF + pose.side * k.lean * i + pose.swing * k.sway * i;
    d.oval(cx, stone.y, stone.rx, stone.ry, 0, { fill: c.body, edge: 'heavy' });
    d.oval(cx, stone.y + k.topShine.dy, stone.rx * k.topShine.rx, stone.ry * k.topShine.ry, 0, { fill: c.light, alpha: SHEEN_ALPHA });
  }
  d.hatch(HALF + 0.05, k.stones[0].y);
  const eyeX = HALF + pose.side * k.lean;
  if (pose.away) {
    d.line(
      [
        [eyeX - k.backRune.half, k.backRune.y],
        [eyeX, k.backRune.y + k.backRune.half],
        [eyeX + k.backRune.half, k.backRune.y]
      ],
      c.dark,
      inkLineWidth(d.size)
    );
  }
  uprightEyes(d, pose, eyeX, k.eye.y, k.eye.spread, k.eye.shift, c.eye);
}

// ---- Hooded hunters (teeth, skitter) -----------------------------------------------------------

/** The cloak of a hunter before scaling: a hood point, shoulders and a ragged hem. */
const CLOAK_POINTS: readonly Point[] = [
  [0.5, 0.14],
  [0.8, 0.48],
  [0.72, 0.84],
  [0.5, 0.74],
  [0.28, 0.84],
  [0.2, 0.48]
];
/** Indices of the two hem corners that step with the walk. */
const HEM_RIGHT = 2;
const HEM_LEFT = 4;

/** Parameters that tell the tall chaser from the hunched runner. */
interface HunterSpec {
  /** Scale of the whole figure, standing on the same ground line. */
  readonly scale: number;
  /** Lean toward the facing per tile of height above the ground (a hunch). */
  readonly lean: number;
  readonly teeth: boolean;
  readonly streak: boolean;
}

const HUNTER = {
  floor: 0.84,
  hem: { stride: 0.03, mid: 0.78 },
  head: { y: 0.38, radius: 0.13, faceShift: 0.03 },
  eye: { spread: 0.05, shift: 0.07 },
  teeth: { y: 0.45, half: 0.07, count: 4, depth: 0.035 },
  glow: { radius: 0.2 },
  fold: { from: 0.5, to: 0.74 },
  streak: { from: 0.2, to: 0.4, spacing: 0.08, shortening: 0.05, y: 0.6 }
} as const;

const TEETH_SPEC: HunterSpec = { scale: 1, lean: 0.08, teeth: true, streak: false };
const SKITTER_SPEC: HunterSpec = { scale: 0.76, lean: 0.34, teeth: false, streak: true };

function buildHunter(d: Drawing, pose: Pose, spec: HunterSpec): void {
  const { colours: c } = pose;
  const k = HUNTER;
  const lean = pose.side * spec.lean;
  const place = ([px, py]: Point, stride = 0): Point => [
    HALF + (px - HALF) * spec.scale + lean * (k.floor - py) * spec.scale + stride,
    k.floor - (k.floor - py) * spec.scale
  ];
  if (spec.streak) {
    const { fx, fy, sx, sy } = pose.axes;
    for (const [i, right] of [-1, 0, 1].entries()) {
      const shorten = ((i + pose.frame) % 2) * k.streak.shortening;
      const across = right * k.streak.spacing;
      const along = (distance: number): Point => [HALF - fx * distance + sx * across, k.streak.y - fy * distance + sy * across];
      d.line([along(k.streak.from), along(k.streak.to - shorten)], d.ink ? d.outline : c.light, inkLineWidth(d.size));
    }
  }
  const stride = pose.swing * k.hem.stride;
  const cloak = CLOAK_POINTS.map((point, i): Point => place(point, i === HEM_RIGHT ? stride : i === HEM_LEFT ? -stride : 0));
  d.poly(cloak, { fill: c.body, edge: 'heavy' });
  d.poly([place(CLOAK_POINTS[0]), place(CLOAK_POINTS[3]), place(CLOAK_POINTS[HEM_LEFT]), place(CLOAK_POINTS[5])], {
    fill: c.light,
    alpha: SHEEN_ALPHA
  });
  d.line([place([HALF, k.fold.from]), place([HALF, k.fold.to])], c.dark, inkLineWidth(d.size));
  const hem = place([HALF, k.hem.mid]);
  d.hatch(hem[0] + 0.04, hem[1] - 0.04);
  const head = place([HALF + pose.side * k.head.faceShift, k.head.y]);
  if (!pose.away && spec.teeth) d.halo(head[0], head[1], k.glow.radius * spec.scale, c.eye);
  d.disc(head[0], head[1], k.head.radius * spec.scale, { fill: d.outline });
  uprightEyes(d, pose, head[0], head[1], k.eye.spread * spec.scale, k.eye.shift * spec.scale, c.eye);
  if (spec.teeth && !pose.away) {
    const t = k.teeth;
    const span = pose.side === 0 ? t.half : t.half * HALF;
    const mouthX = head[0] + pose.side * k.eye.shift * spec.scale * HALF;
    const mouthY = head[1] + (t.y - k.head.y) * spec.scale;
    const zigzag: Point[] = [];
    for (let i = 0; i <= t.count * 2; i += 1) {
      zigzag.push([mouthX - span + (i * span) / t.count, mouthY + (i % 2 === 0 ? 0 : t.depth)]);
    }
    d.poly(zigzag, { fill: c.eye });
  }
}

// ---- Wisps (glider, fireball) ------------------------------------------------------------------

const WISP = {
  cy: 0.42,
  orb: 0.19,
  core: 0.1,
  halo: 0.4,
  eye: { forward: 0.075, spread: 0.06 }
} as const;

const GLIDER = {
  /** A wing in forward/right tiles: root beside the orb, control of the sweep, tip and inner edge. */
  wing: { root: [0.02, 0.14], control: [-0.1, 0.4], tip: [-0.3, 0.3], inner: [-0.14, 0.2], flap: 0.05, alpha: 0.9 }
} as const;

function buildGlider(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const w = GLIDER.wing;
  d.halo(HALF, WISP.cy, WISP.halo, c.body);
  const flap = pose.swing * w.flap;
  for (const right of [-1, 1]) {
    const p = (forward: number, across: number, extra = 0): Point => at(pose, HALF, WISP.cy, forward, right * (across + extra));
    d.smooth([p(w.root[0], w.root[1]), p(w.control[0], w.control[1], flap), p(w.tip[0], w.tip[1], flap), p(w.inner[0], w.inner[1], flap * HALF)], {
      fill: c.light,
      edge: 'fine',
      alpha: w.alpha
    });
  }
  d.disc(HALF, WISP.cy, WISP.orb, { fill: c.body, edge: 'heavy' });
  d.disc(HALF, WISP.cy, WISP.core, { fill: c.light });
  topEyes(d, pose, HALF, WISP.cy, WISP.eye.forward, WISP.eye.spread, d.outline);
}

const FIREBALL = {
  /** Tongues behind the orb: sideways offset, the two lengths of a flicker and the flare of the tip. */
  tongues: [
    { right: -0.11, short: 0.28, long: 0.38, flare: -0.08 },
    { right: 0, short: 0.4, long: 0.3, flare: 0 },
    { right: 0.11, short: 0.28, long: 0.38, flare: 0.08 }
  ],
  rootBehind: 0.08,
  width: 0.07,
  /** Share of a tongue taken by its bright inner flame. */
  inner: 0.55
} as const;

function buildFireball(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = FIREBALL;
  d.halo(HALF, WISP.cy, WISP.halo, c.body);
  for (const [i, tongue] of k.tongues.entries()) {
    const length = (i + pose.frame) % 2 === 0 ? tongue.long : tongue.short;
    const base = (right: number, behind: number): Point => at(pose, HALF, WISP.cy, -behind, right);
    d.poly(
      [base(tongue.right - k.width, k.rootBehind), base(tongue.right + tongue.flare, k.rootBehind + length), base(tongue.right + k.width, k.rootBehind)],
      { fill: c.body, edge: 'fine' }
    );
    d.poly(
      [
        base(tongue.right - k.width * k.inner, k.rootBehind),
        base(tongue.right + tongue.flare, k.rootBehind + length * k.inner),
        base(tongue.right + k.width * k.inner, k.rootBehind)
      ],
      { fill: c.light }
    );
  }
  d.disc(HALF, WISP.cy, WISP.orb, { fill: c.body, edge: 'heavy' });
  d.disc(HALF, WISP.cy, WISP.core, { fill: c.light });
  topEyes(d, pose, HALF, WISP.cy, WISP.eye.forward, WISP.eye.spread, d.outline);
}

// ---- Rune ram (tank) ---------------------------------------------------------------------------

const TANK = {
  cy: 0.56,
  /** The wedge, as forward/right pairs for the right half (mirrored for the left). */
  tip: 0.36,
  shoulder: [0.14, 0.2],
  rear: [-0.28, 0.2],
  rollers: { at: [-0.16, 0.1], length: 0.06, width: 0.27, tread: 0.03, treadLength: 0.05 },
  horn: { base: 0.22, half: 0.07 },
  rune: { forward: -0.05, half: 0.05, depth: 0.05, halo: 0.13 },
  eye: { forward: 0.17, spread: 0.075 }
} as const;

function buildTank(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = TANK;
  const { cy } = k;
  for (const forward of k.rollers.at) {
    alongOval(d, pose, cy, forward, 0, k.rollers.length, k.rollers.width, { fill: c.dark, edge: 'heavy' });
    for (const right of [-1, 1]) {
      const shift = k.rollers.tread * pose.swing;
      d.line(
        [at(pose, HALF, cy, forward + shift, right * (k.rollers.width - k.rollers.treadLength)), at(pose, HALF, cy, forward + shift, right * k.rollers.width)],
        c.light,
        inkLineWidth(d.size)
      );
    }
  }
  d.poly(
    [
      at(pose, HALF, cy, k.tip, 0),
      at(pose, HALF, cy, k.shoulder[0], k.shoulder[1]),
      at(pose, HALF, cy, k.rear[0], k.rear[1]),
      at(pose, HALF, cy, k.rear[0], -k.rear[1]),
      at(pose, HALF, cy, k.shoulder[0], -k.shoulder[1])
    ],
    { fill: c.body, edge: 'heavy' }
  );
  d.poly([at(pose, HALF, cy, k.tip, 0), at(pose, HALF, cy, k.horn.base, k.horn.half), at(pose, HALF, cy, k.horn.base, -k.horn.half)], {
    fill: c.light,
    edge: 'fine'
  });
  const [hx, hy] = at(pose, HALF, cy, k.rollers.at[0], 0.1);
  d.hatch(hx, hy);
  const [rx, ry] = at(pose, HALF, cy, k.rune.forward, 0);
  d.halo(rx, ry, k.rune.halo, c.eye);
  d.line(
    [
      at(pose, HALF, cy, k.rune.forward - k.rune.depth, -k.rune.half),
      at(pose, HALF, cy, k.rune.forward + k.rune.depth, 0),
      at(pose, HALF, cy, k.rune.forward - k.rune.depth, k.rune.half)
    ],
    d.ink ? d.outline : c.eye,
    heavyLineWidth(d.size)
  );
  topEyes(d, pose, HALF, cy, k.eye.forward, k.eye.spread, c.eye);
}

// ---- Ooze (blob) -------------------------------------------------------------------------------

const BLOB = {
  cy: 0.6,
  points: 10,
  radius: 0.24,
  /** Wobble of the outline: share of the radius, angular frequency, and the phase the stride frame adds. */
  wobble: 0.13,
  frequency: 2.1,
  framePhase: Math.PI,
  /** Flattening of the height. */
  flatten: 0.78,
  /** Bubbles: offset from the centre and radius; they rise a little on the second frame. */
  bubbles: [
    { dx: -0.09, dy: -0.07, radius: 0.05 },
    { dx: 0.08, dy: -0.02, radius: 0.035 },
    { dx: 0.01, dy: 0.07, radius: 0.028 }
  ],
  rise: 0.02,
  glint: { offset: 3, radius: 4 },
  eye: { forward: 0.09, spread: 0.06 }
} as const;

function buildBlob(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = BLOB;
  const phase = pose.frame * k.framePhase;
  const outline: Point[] = [];
  for (let i = 0; i < k.points; i += 1) {
    const angle = (i / k.points) * TAU;
    const radius = k.radius * (1 + k.wobble * Math.sin(i * k.frequency + phase));
    outline.push([HALF + Math.cos(angle) * radius, k.cy + Math.sin(angle) * radius * k.flatten]);
  }
  d.smooth(outline, { fill: c.body, edge: 'heavy' });
  d.hatch(HALF + 0.06, k.cy + 0.08);
  const glint = d.ink ? d.outline : c.light;
  const rise = pose.frame * k.rise;
  for (const bubble of k.bubbles) {
    const bx = HALF + bubble.dx;
    const by = k.cy + bubble.dy - rise;
    d.disc(bx, by, bubble.radius, { fill: c.light, alpha: SHEEN_ALPHA, edge: 'fine' });
    d.disc(bx - bubble.radius / k.glint.offset, by - bubble.radius / k.glint.offset, bubble.radius / k.glint.radius, { fill: glint, alpha: SHEEN_ALPHA });
  }
  topEyes(d, pose, HALF, k.cy, k.eye.forward, k.eye.spread, c.eye);
}

// ---- Stone puppet (puppet) ---------------------------------------------------------------------

const PUPPET = {
  arms: { y: 0.42, h: 0.3, w: 0.16, swing: 0.03, radius: 0.06, overlapOuter: 0.75, overlapInner: 0.25 },
  body: { y: 0.22, w: 0.52, h: 0.62, radius: 0.14, sheenInset: 0.1, sheenW: 0.28, sheenH: 0.42, sheenTop: 0.03 },
  /** Share of the width kept in profile, and the shift toward the side. */
  profile: { keep: 0.72, shift: 0.025 },
  belt: { y: 0.56, h: 0.04, inset: 0.1 },
  /** The chest rune: a diamond with a stem. */
  rune: { y: 0.4, half: 0.07, stem: 0.07, halo: 0.17 },
  back: { top: 0.12, gap: 0.05 },
  eye: { y: 0.3, spread: 0.07, shift: 0.1 }
} as const;

function buildPuppet(d: Drawing, pose: Pose): void {
  const { colours: c } = pose;
  const k = PUPPET;
  const keep = pose.side === 0 ? 1 : k.profile.keep;
  const bodyW = k.body.w * keep;
  const bodyX = HALF - bodyW / 2 + pose.side * k.profile.shift;
  const sway = pose.swing * k.arms.swing;
  const armW = k.arms.w * keep;
  d.roundRect(bodyX - armW * k.arms.overlapOuter, k.arms.y + sway, armW, k.arms.h, k.arms.radius, { fill: c.dark, edge: 'heavy' });
  d.roundRect(bodyX + bodyW - armW * k.arms.overlapInner, k.arms.y - sway, armW, k.arms.h, k.arms.radius, { fill: c.dark, edge: 'heavy' });
  d.roundRect(bodyX, k.body.y, bodyW, k.body.h, k.body.radius, { fill: c.body, edge: 'heavy' });
  d.roundRect(bodyX + bodyW * k.body.sheenInset, k.body.y + k.body.sheenTop, bodyW * k.body.sheenW, k.body.h * k.body.sheenH, k.body.radius / 2, {
    fill: c.light,
    alpha: SHEEN_ALPHA
  });
  d.roundRect(bodyX + bodyW * k.belt.inset, k.belt.y, bodyW * (1 - 2 * k.belt.inset), k.belt.h, 0, { fill: c.dark });
  d.hatch(bodyX + bodyW * 0.6, k.body.y + k.body.h * 0.7);
  const centre = bodyX + bodyW / 2;
  if (pose.away) {
    d.line(
      [
        [centre, k.body.y + k.back.top],
        [centre, k.belt.y - k.back.gap]
      ],
      c.dark,
      inkLineWidth(d.size)
    );
  } else {
    const r = k.rune;
    d.halo(centre, r.y, r.halo, c.eye);
    d.poly(
      [
        [centre, r.y - r.half],
        [centre + r.half, r.y],
        [centre, r.y + r.half],
        [centre - r.half, r.y]
      ],
      { fill: c.eye, edge: d.ink ? 'fine' : null }
    );
    d.line(
      [
        [centre, r.y + r.half],
        [centre, r.y + r.half + r.stem]
      ],
      d.ink ? d.outline : c.eye,
      inkLineWidth(d.size)
    );
  }
  uprightEyes(d, pose, centre, k.eye.y, k.eye.spread, k.eye.shift, c.eye);
}

// ---- Rune bolt (shot) --------------------------------------------------------------------------

const BOLT = {
  /** Head ahead of the centre, tail behind it, and the half-width of the kite at its shoulders. */
  head: 0.2,
  tail: 0.34,
  half: 0.09,
  core: { head: 0.14, tail: 0.18, half: 0.04 },
  halo: { forward: 0.1, radius: 0.2 },
  sparks: { forward: -0.25, spread: 0.07, radius: 0.02 }
} as const;

function boltPoints(pose: Pose, head: number, tail: number, half: number): Point[] {
  return [at(pose, HALF, HALF, head, 0), at(pose, HALF, HALF, 0, half), at(pose, HALF, HALF, -tail, 0), at(pose, HALF, HALF, 0, -half)];
}

function buildBolt(d: Drawing, pose: Pose, glow: string, core: string): void {
  const [hx, hy] = at(pose, HALF, HALF, BOLT.halo.forward, 0);
  d.halo(hx, hy, BOLT.halo.radius, glow);
  d.poly(boltPoints(pose, BOLT.head, BOLT.tail, BOLT.half), { fill: glow, edge: 'heavy' });
  d.poly(boltPoints(pose, BOLT.core.head, BOLT.core.tail, BOLT.core.half), { fill: core });
  for (const right of [-1, 1]) {
    const [sx, sy] = at(pose, HALF, HALF, BOLT.sparks.forward, right * BOLT.sparks.spread);
    d.spark(sx, sy, BOLT.sparks.radius, core, SHEEN_ALPHA);
  }
}

// ---- Painters ----------------------------------------------------------------------------------

type Builder = (d: Drawing, pose: Pose) => void;

const BUILDERS: Readonly<Record<string, Builder>> = {
  bug: buildBug,
  paramecium: buildParamecium,
  pink_ball: buildPinkBall,
  walker: buildWalker,
  teeth: (d, pose) => buildHunter(d, pose, TEETH_SPEC),
  skitter: (d, pose) => buildHunter(d, pose, SKITTER_SPEC),
  glider: buildGlider,
  fireball: buildFireball,
  tank: buildTank,
  blob: buildBlob,
  puppet: buildPuppet
};

/** Types that hover: their bob is larger. */
const FLYING_TYPES: ReadonlySet<string> = new Set(['glider', 'fireball']);
/** Bob of a hovering creature, as a multiple of the shared amplitude. */
const FLYING_BOB_FACTOR = 1.8;

/** Type name under which the bolt sprite is cached. */
const SHOT_SPRITE_TYPE = 'shot';

function poseOf(type: keyof Art['monster'], dir: Direction, frame: number, art: Art): Pose {
  return {
    axes: AXES[dir],
    frame,
    swing: frame === 0 ? -1 : 1,
    side: dir === 'E' ? 1 : dir === 'W' ? -1 : 0,
    away: dir === 'N',
    colours: art.monster[type]
  };
}

function buildSprite(type: keyof Art['monster'], dir: Direction, frame: number, size: number, art: Art): Sprite {
  const d = new Drawing(size, art);
  BUILDERS[type](d, poseOf(type, dir, frame, art));
  return { shadow: shadowOf(size, art, SHADOWS[type]), body: d.shapes };
}

/** The painter of one creature type. */
function creaturePainter(type: keyof Art['monster']): RunewardEntityPainter {
  const bobFactor = FLYING_TYPES.has(type) ? FLYING_BOB_FACTOR : 1;
  return (ctx, dir, x, y, size, env) => {
    const { art } = env;
    const frame = runewardWalkFrame(env, art);
    const sprite = runewardMonsterSprite(env, type, dir, frame, size, () => buildSprite(type, dir, frame, size, art));
    const bob = Math.sin((runewardClockMs(env) / art.animation.bobPeriodMs) * TAU) * size * art.animation.bobAmplitude * bobFactor;
    ctx.save();
    ctx.translate(x, y);
    replay(ctx, sprite.shadow);
    ctx.translate(0, bob);
    replay(ctx, sprite.body);
    ctx.restore();
  };
}

/** Painters by entity type; an id moves here from PENDING when its painter lands. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = Object.fromEntries(
  Object.keys(BUILDERS).map((type): [string, RunewardEntityPainter] => [type, creaturePainter(type as keyof Art['monster'])])
);

/** Painter of a shot in flight: a rune bolt whose tail trails opposite the way it flies. */
export const SHOT: RunewardEntityPainter | null = (ctx, dir, x, y, size, env) => {
  const { art } = env;
  const sprite = runewardMonsterSprite(env, SHOT_SPRITE_TYPE, dir, 0, size, (): Sprite => {
    const d = new Drawing(size, art);
    buildBolt(d, poseOf(SHOT_SPRITE_TYPE, dir, 0, art), art.rune.glow, art.rune.core);
    return { shadow: [], body: d.shapes };
  });
  ctx.save();
  ctx.translate(x, y);
  replay(ctx, sprite.body);
  ctx.restore();
};

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [];
