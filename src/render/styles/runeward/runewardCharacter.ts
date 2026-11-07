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
 * The player of the Runeward style: one of three characters (mage, scribe, adventurer), drawn for the
 * state the game is in. This module owns the pose, the states around the figure (shadow, swimming, the
 * three kinds of death, the ward ring) and the choice of the figure; the figures themselves live in
 * their own modules. Pure: no DOM, nothing but the context it is handed.
 */

import type { Direction, PlayerState, RunewardArtConfig, RunewardBootsKind } from '../../../core/types';
import { adventurerFigure } from './runewardCharacterAdventurer';
import {
  STRIDE_SWAY,
  TAU,
  UNIT,
  ell,
  glow,
  makeLook,
  mixColours,
  strideOf,
  withAlpha,
  type Figure,
  type FigureState,
  type Look
} from './runewardCharacterKit';
import { mageFigure } from './runewardCharacterMage';
import { scribeFigure } from './runewardCharacterScribe';

type Art = Readonly<RunewardArtConfig>;

/** The playable Runeward characters. */
export const RUNEWARD_CHARACTERS = ['mage', 'scribe', 'adventurer'] as const;
export type RunewardCharacterId = (typeof RUNEWARD_CHARACTERS)[number];

/** Why the player died, as far as the drawing cares: in fire, in water, or of anything else. */
export type RunewardDeathCause = 'fire' | 'water' | 'other';

/** How the character stands: where it looks, and the poses the game asks for. */
export interface MagePose {
  readonly dir: Direction;
  readonly inWater: boolean;
  readonly alive: boolean;
  /** 0 standing, 1 or 2 for the two strides. */
  readonly frame: number;
  /** Lift of the sprite in tiles. */
  readonly hop: number;
  /** Which character is drawn. */
  readonly character: RunewardCharacterId;
  /** Gliding on ice (or a force floor): arms out, no stride. */
  readonly skating: boolean;
  /** The boots held, in the order they were picked up; the ward is drawn as a ring, not as boots. */
  readonly boots: readonly RunewardBootsKind[];
  /** A ward is held: the ring is shown around the figure. */
  readonly wardActive: boolean;
  /** How the player died; read only while not alive. */
  readonly deathCause: RunewardDeathCause;
}

/** What the renderer adds to a pose, read from the state of the game; every field is optional. */
export interface PlayerPoseExtras {
  readonly character?: RunewardCharacterId;
  readonly skating?: boolean;
  readonly boots?: readonly RunewardBootsKind[];
  readonly wardActive?: boolean;
  readonly deathCause?: RunewardDeathCause;
}

/** Death reasons (the engines' message keys) that have a drawing of their own. */
const DEATH_REASON_FIRE = 'hud.messages.death_fire';
const DEATH_REASON_WATER = 'hud.messages.death_water';
/** Hazards of the tile the player stands on, when the engine gave no reason. */
const HAZARD_FIRE = 'fire';
const HAZARD_WATER = 'water';

/**
 * How the player died, for the drawing: from the death reason the engine exposes, else from the hazard
 * of the tile under the player. Anything else is `other`.
 */
export function deathCauseOf(reasonKey: string | null | undefined, hazardUnder?: string | null): RunewardDeathCause {
  if (reasonKey === DEATH_REASON_FIRE) return 'fire';
  if (reasonKey === DEATH_REASON_WATER) return 'water';
  if (reasonKey) return 'other';
  if (hazardUnder === HAZARD_FIRE) return 'fire';
  if (hazardUnder === HAZARD_WATER) return 'water';
  return 'other';
}

/**
 * The extras of a pose, read from the player state of an engine: gliding, the boots held (the ward
 * is the ring, not boots), and how the player died. `hazardUnder` is the hazard of the tile under the
 * player, used only when the engine gave no death reason.
 */
export function poseExtrasOf(
  player: Pick<PlayerState, 'isSliding' | 'boots' | 'alive' | 'deathReasonKey'>,
  hazardUnder?: string | null
): PlayerPoseExtras {
  const held = bootKindsOfItems(player.boots);
  return {
    skating: player.isSliding,
    boots: held.filter((kind) => kind !== WARD_ITEM_ID),
    wardActive: held.includes(WARD_ITEM_ID),
    deathCause: player.alive ? undefined : deathCauseOf(player.deathReasonKey, hazardUnder)
  };
}

/** A full pose from the basic one and the extras; a missing extra means the plain state. */
export function completePose(
  basic: Pick<MagePose, 'dir' | 'inWater' | 'alive' | 'frame' | 'hop'>,
  extras: PlayerPoseExtras = {}
): MagePose {
  return {
    ...basic,
    character: extras.character ?? 'mage',
    skating: extras.skating ?? false,
    boots: extras.boots ?? [],
    wardActive: extras.wardActive ?? false,
    deathCause: extras.deathCause ?? 'other'
  };
}

const FIGURES: Readonly<Record<RunewardCharacterId, Figure>> = {
  mage: mageFigure,
  scribe: scribeFigure,
  adventurer: adventurerFigure
};

/** Side the character leans to: -1 west, 1 east, 0 facing the viewer or away. */
export function mageSide(dir: Direction): number {
  if (dir === 'E') return 1;
  if (dir === 'W') return -1;
  return 0;
}

// ---- Layout of the states (unit space) ----------------------------------------------------------

const SHADOW = { x: 50, y: 92, rx: 27, ry: 6 } as const;
const BODY_CENTRE_X = 50;
const BODY_CENTRE_Y = 52;
/** Waterline when swimming and the drop of the figure below it. */
const SWIM = { line: 63, drop: 12 } as const;
/** Waterline of a drowned figure and the drop of the figure below it. */
const SINK = { line: 66, drop: 36, alpha: 0.85, tint: 0.45 } as const;
const BURN = { drop: 4, char: 0.62 } as const;
/** The fainted figure: its feet (at `fromY`) move to (`toX`, `toY`) and it tips over to the left. */
const FALL = { fromY: 88, toX: 76, toY: 78, scale: 0.8, angle: -Math.PI * 0.44, fade: 0.35, alpha: 0.75 } as const;
const RIPPLE = { y: 63, sinkY: 66, rx: 27, ry: 5.5, outerRx: 36, outerRy: 8, outerAlpha: 0.7 } as const;
const BUBBLES: readonly (readonly [number, number, number])[] = [[34, 56, 2.6], [66, 50, 2], [58, 36, 1.5], [40, 26, 1.2], [70, 30, 2.2]];
const BUBBLE_FILL_ALPHA = 0.35;
const BUBBLE_STROKE_ALPHA = 0.9;
const FLAMES: readonly (readonly [number, number, number])[] = [[26, 90, 22], [40, 92, 30], [54, 92, 36], [70, 90, 26], [48, 60, 20], [34, 48, 14], [62, 44, 16]];
const FIRE_GLOW = { y: 70, r: 40, coreAlpha: 0.55, midAlpha: 0.18 } as const;
const SPARKS: readonly (readonly [number, number, number])[] = [[26, 34, 3.2], [40, 20, 2.4], [70, 28, 2.8]];
const WARD_GLOW = { r: 52, coreAlpha: 0.5, midAlpha: 0.22 } as const;
const WARD_RING = { outer: 44, inner: 40, runes: 8, runeHalfWidth: 3, runeHalfHeight: 4 } as const;
/** Skating lean toward the facing side, in radians, and the glide streaks behind the feet. */
const SKATE_LEAN = 0.07;
const SKATE_STREAK_ROWS: readonly number[] = [84, 89];
const SKATE_STREAK_GAP = 16;
const SKATE_STREAK_LENGTH = 16;
/** Boots shown on the feet, in order of priority. */
const BOOT_PRIORITY: readonly RunewardBootsKind[] = ['ice', 'fire', 'water', 'force', 'speed', 'eye', 'pull'];
const BOOT_ITEM_PREFIX = 'boots_';
const WARD_ITEM_ID: RunewardBootsKind = 'ward';
const ALL_BOOT_KINDS: readonly RunewardBootsKind[] = [...BOOT_PRIORITY, WARD_ITEM_ID];

/** The two foot boots for the boots held: the first two by priority, one boot on both feet when only one is held. */
export function footBoots(held: readonly RunewardBootsKind[]): readonly [RunewardBootsKind | null, RunewardBootsKind | null] {
  const worn = BOOT_PRIORITY.filter((kind) => held.includes(kind));
  if (worn.length === 0) return [null, null];
  return [worn[0], worn[1] ?? worn[0]];
}

/** The boot kinds named by the held item ids ("boots_ice", "ward"...), without duplicates and without unknown ids. */
export function bootKindsOfItems(itemIds: Iterable<string>): RunewardBootsKind[] {
  const kinds: RunewardBootsKind[] = [];
  for (const id of itemIds) {
    const name = id === WARD_ITEM_ID ? WARD_ITEM_ID : id.startsWith(BOOT_ITEM_PREFIX) ? id.slice(BOOT_ITEM_PREFIX.length) : '';
    const kind = ALL_BOOT_KINDS.find((candidate) => candidate === name);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

// ---- Effects ------------------------------------------------------------------------------------

function flame(L: Look, x: number, y: number, h: number): void {
  const { ctx } = L;
  const lava = L.art.lava;
  ctx.beginPath();
  ctx.moveTo(x - h * 0.35, y);
  ctx.quadraticCurveTo(x - h * 0.4, y - h * 0.5, x, y - h);
  ctx.quadraticCurveTo(x + h * 0.4, y - h * 0.5, x + h * 0.35, y);
  ctx.closePath();
  ctx.fillStyle = lava.light;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - h * 0.18, y);
  ctx.quadraticCurveTo(x - h * 0.2, y - h * 0.4, x, y - h * 0.62);
  ctx.quadraticCurveTo(x + h * 0.2, y - h * 0.4, x + h * 0.18, y);
  ctx.closePath();
  ctx.fillStyle = lava.crest;
  ctx.fill();
}

/** The rings the water makes around a figure standing in it. */
function ripples(L: Look, y: number, alpha: number): void {
  const { ctx } = L;
  const water = L.art.water;
  ctx.strokeStyle = withAlpha(water.crest, alpha);
  ctx.lineWidth = Math.max(L.lw * 0.65, 1.4 / L.unit);
  ctx.beginPath();
  ctx.ellipse(BODY_CENTRE_X, y, RIPPLE.rx, RIPPLE.ry, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(water.light, alpha * RIPPLE.outerAlpha);
  ctx.lineWidth = Math.max(L.lw * 0.45, 1 / L.unit);
  ctx.beginPath();
  ctx.ellipse(BODY_CENTRE_X, y + 1, RIPPLE.outerRx, RIPPLE.outerRy, 0, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(BODY_CENTRE_X, y + 1, RIPPLE.outerRx, RIPPLE.outerRy, 0, 1.1 * Math.PI, 1.9 * Math.PI);
  ctx.stroke();
}

/** The glow of the ward behind the figure. */
function wardGlow(L: Look): void {
  const { ward } = L.art.item.boots;
  glow(L, BODY_CENTRE_X, BODY_CENTRE_Y, WARD_GLOW.r, withAlpha(ward.light, WARD_GLOW.coreAlpha), withAlpha(ward.main, WARD_GLOW.midAlpha));
}

/** The ward ring around the figure: two circles and rune diamonds on the outer one. */
function wardRing(L: Look): void {
  const { ctx } = L;
  const halo = L.art.character.halo;
  ctx.lineWidth = Math.max(L.lw, 2.2);
  ctx.strokeStyle = halo.ring;
  ctx.beginPath();
  ctx.arc(BODY_CENTRE_X, BODY_CENTRE_Y, WARD_RING.outer, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = halo.inner;
  ctx.lineWidth = Math.max(L.lw * 0.5, 1);
  ctx.beginPath();
  ctx.arc(BODY_CENTRE_X, BODY_CENTRE_Y, WARD_RING.inner, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < WARD_RING.runes; i += 1) {
    const angle = (i / WARD_RING.runes) * TAU + Math.PI / WARD_RING.runes;
    const x = BODY_CENTRE_X + Math.cos(angle) * WARD_RING.outer;
    const y = BODY_CENTRE_Y + Math.sin(angle) * WARD_RING.outer;
    ctx.beginPath();
    ctx.moveTo(x, y - WARD_RING.runeHalfHeight);
    ctx.lineTo(x + WARD_RING.runeHalfWidth, y);
    ctx.lineTo(x, y + WARD_RING.runeHalfHeight);
    ctx.lineTo(x - WARD_RING.runeHalfWidth, y);
    ctx.closePath();
    ctx.fillStyle = halo.rune;
    ctx.fill();
    ctx.strokeStyle = L.out;
    ctx.lineWidth = L.lw * 0.5;
    ctx.stroke();
  }
}

/** Cool streaks behind the feet of a skater; `facing` is 1 when the skater looks east, -1 west. */
function glideStreaks(L: Look, facing: number): void {
  const { ctx } = L;
  ctx.strokeStyle = withAlpha(L.art.ice.light, 0.9);
  ctx.lineWidth = Math.max(L.lw * 0.7, 1.4 / L.unit);
  ctx.lineCap = 'round';
  for (const y of SKATE_STREAK_ROWS) {
    const start = BODY_CENTRE_X - facing * SKATE_STREAK_GAP;
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.lineTo(start - facing * SKATE_STREAK_LENGTH, y);
    ctx.stroke();
  }
}

// ---- The painter ----------------------------------------------------------------------------------

/**
 * Draws the character into the square from (0, 0) to (size, size). The figure is drawn from the pose;
 * a west view is the mirror of an east one.
 */
export function paintCharacter(ctx: CanvasRenderingContext2D, size: number, art: Art, pose: MagePose, timeMs: number): void {
  const { animation } = art;
  const unit = size / UNIT;
  const side = mageSide(pose.dir);
  const swimming = pose.alive && pose.inWater;
  const skating = pose.alive && !pose.inWater && pose.skating;
  const dead = !pose.alive;
  const cause = pose.deathCause;
  const bob = pose.alive ? (Math.sin((timeMs / animation.bobPeriodMs) * TAU) * size * animation.bobAmplitude) / unit : 0;
  const stride = strideOf(skating ? 0 : pose.frame);
  const lift = -pose.hop * UNIT;

  // A death tints the colours of the figure instead of painting over it.
  let tone: (colour: string) => string = (colour) => colour;
  if (dead && cause === 'fire') tone = (colour) => mixColours(colour, art.character.outline, BURN.char);
  else if (dead && cause === 'water') tone = (colour) => mixColours(colour, art.water.deep, SINK.tint);
  else if (dead) tone = (colour) => mixColours(colour, art.floor.light, FALL.fade);

  ctx.save();
  ctx.scale(unit, unit);
  const ground = makeLook(ctx, size, art);
  const look = makeLook(ctx, size, art, tone);
  const wardShown = pose.wardActive && pose.alive;

  if (wardShown) wardGlow(ground);
  const grounded = !swimming && !(dead && cause === 'water');
  if (grounded) ell(ground, SHADOW.x, SHADOW.y, SHADOW.rx, SHADOW.ry, art.mage.shadow, false);

  const feet = footBoots(pose.boots);
  const state: FigureState = {
    profile: side !== 0,
    back: pose.dir === 'N',
    frame: skating ? 0 : pose.frame,
    armsOut: skating,
    feet,
    booted: feet[0] !== null
  };
  const figure = FIGURES[pose.character];

  /** Draws the figure `drop` units lower, mirrored for west. */
  const draw = (drop: number, extra?: () => void): void => {
    ctx.save();
    if (side < 0) {
      ctx.translate(UNIT, 0);
      ctx.scale(-1, 1);
    }
    extra?.();
    ctx.translate(stride * STRIDE_SWAY, bob + lift + drop);
    figure(look, state);
    ctx.restore();
  };

  if (swimming) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, UNIT, SWIM.line);
    ctx.clip();
    draw(SWIM.drop);
    ctx.restore();
    ripples(ground, RIPPLE.y, 0.9);
  } else if (dead && cause === 'water') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, UNIT, SINK.line);
    ctx.clip();
    ctx.globalAlpha = SINK.alpha;
    draw(SINK.drop);
    ctx.restore();
    ripples(ground, RIPPLE.sinkY, 1);
    for (const [x, y, r] of BUBBLES) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = withAlpha(art.water.crest, BUBBLE_FILL_ALPHA);
      ctx.fill();
      ctx.strokeStyle = withAlpha(art.water.crest, BUBBLE_STROKE_ALPHA);
      ctx.lineWidth = ground.lw * 0.5;
      ctx.stroke();
    }
  } else if (dead && cause === 'fire') {
    draw(BURN.drop);
    glow(ground, BODY_CENTRE_X, FIRE_GLOW.y, FIRE_GLOW.r, withAlpha(art.lava.light, FIRE_GLOW.coreAlpha), withAlpha(art.lava.deep, FIRE_GLOW.midAlpha));
    for (const [x, y, h] of FLAMES) flame(ground, x, y, h);
  } else if (dead) {
    // Fainted: the figure lies on its side, pale, with a few sparks over it.
    ctx.save();
    ctx.globalAlpha = FALL.alpha;
    draw(0, () => {
      ctx.translate(FALL.toX, FALL.toY);
      ctx.rotate(FALL.angle);
      ctx.scale(FALL.scale, FALL.scale);
      ctx.translate(-BODY_CENTRE_X, -FALL.fromY);
    });
    ctx.restore();
    ctx.fillStyle = ground.gold;
    for (const [x, y, r] of SPARKS) {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.35, y - r * 0.35);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x + r * 0.35, y + r * 0.35);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.35, y + r * 0.35);
      ctx.lineTo(x - r, y);
      ctx.lineTo(x - r * 0.35, y - r * 0.35);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    if (skating) glideStreaks(ground, side === 0 ? 1 : side);
    if (skating && side !== 0) {
      draw(0, () => {
        ctx.translate(BODY_CENTRE_X, SHADOW.y);
        ctx.rotate(SKATE_LEAN);
        ctx.translate(-BODY_CENTRE_X, -SHADOW.y);
      });
    } else {
      draw(0);
    }
  }

  if (wardShown) wardRing(ground);
  ctx.restore();
}
