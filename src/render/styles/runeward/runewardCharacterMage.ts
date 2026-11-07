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
 * The refined mage, the default Runeward character: a pointed hat, a belted robe and a staff
 * with a glowing orb. Drawn in the 0..100 unit square of the look; a west view is the mirror of east.
 */

import {
  PROFILE_STEP_LIFT,
  PROFILE_STEP_SPREAD,
  STEP_LIFT,
  boot,
  dot,
  ell,
  fillStroke,
  glow,
  hgrad,
  line,
  poly,
  shade,
  withAlpha,
  type Figure,
  type FigureState,
  type Look
} from './runewardCharacterKit';

/** Radius of the staff orb and the reach of its glow, in orb radii. */
const ORB_RADIUS = 6.5;
const ORB_GLOW_REACH = 1.9;
const ORB_GLOW_CORE_ALPHA = 0.55;
const ORB_GLOW_MID_ALPHA = 0.18;
const ORB_EDGE_SHADE = 0.7;
const ROBE_BACK_SHADE = 0.75;
const ROBE_FOLD_SHADE = 0.55;
const ROBE_SIDE_SHADE = 0.8;
const CAPE_SHADE = 0.7;
const HEM_Y = 86;
const HEM_Y_BOOTED = 80;
const STAFF_WIDTH = 3.4;
const STAFF_TOP = 24;

function orb(L: Look, x: number, y: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  glow(L, x, y, ORB_RADIUS * ORB_GLOW_REACH, withAlpha(m.orb, ORB_GLOW_CORE_ALPHA), withAlpha(m.orb, ORB_GLOW_MID_ALPHA));
  ctx.beginPath();
  ctx.arc(x, y, ORB_RADIUS, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, ORB_RADIUS);
  gradient.addColorStop(0, L.c(m.orbCore));
  gradient.addColorStop(0.5, L.c(m.orb));
  gradient.addColorStop(1, L.c(shade(m.orb, ORB_EDGE_SHADE)));
  fillStroke(L, gradient);
}

function staff(L: Look, x0: number, y0: number, x1: number, y1: number): void {
  line(L, x0, y0, x1, y1, L.wood, STAFF_WIDTH);
  orb(L, x1, y1 - 3);
}

function hat(L: Look, cx: number, cy: number, side: number, back: boolean): void {
  const { ctx } = L;
  const m = L.art.mage;
  ell(L, cx, cy, 23, 6.4, hgrad(L, cx - 23, cx + 23, m.hatLight, m.hat));
  const lean = side === 0 ? 10 : -side * 12;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy - 1);
  ctx.quadraticCurveTo(cx - 6, cy - 26, cx + lean, cy - 29);
  ctx.quadraticCurveTo(cx + lean + 10 * (side === 0 ? 1 : -side * 0.5), cy - 18, cx + 15, cy - 1);
  ctx.closePath();
  fillStroke(L, hgrad(L, cx - 15, cx + 15, m.hatLight, m.hat));
  poly(L, [[cx - 15, cy - 1], [cx + 15, cy - 1], [cx + 13.5, cy - 7], [cx - 13.5, cy - 7]], L.gold, true, 0.15);
  if (!back && side === 0) dot(L, cx, cy - 4, 1.4, m.orbCore);
}

function feet(L: Look, st: FigureState, hemY: number): void {
  const [left, right] = st.feet;
  const f = st.frame;
  if (!st.profile) {
    boot(L, 41, hemY + 4 + (f === 1 ? -STEP_LIFT : 0), 11, 6, left);
    boot(L, 59, hemY + 4 + (f === 2 ? -STEP_LIFT : 0), 11, 6, right);
  } else {
    const a = f === 1 ? PROFILE_STEP_SPREAD : f === 2 ? -PROFILE_STEP_SPREAD : 0;
    boot(L, 46 + a, hemY + 4, 12, 6, left);
    boot(L, 54 - a, hemY + 4 - (f ? PROFILE_STEP_LIFT : 0), 12, 6, right);
  }
}

function front(L: Look, st: FigureState, hemY: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  const ch = L.art.character;
  const sx = st.armsOut ? 90 : 79;
  if (st.armsOut) staff(L, 90, 84, 94, STAFF_TOP - 2);
  else staff(L, sx, 88, sx, STAFF_TOP);
  // Robe.
  ctx.beginPath();
  ctx.moveTo(38, 42);
  ctx.quadraticCurveTo(50, 38, 62, 42);
  ctx.quadraticCurveTo(70, 62, 75, hemY);
  ctx.quadraticCurveTo(50, hemY + 4, 25, hemY);
  ctx.quadraticCurveTo(30, 62, 38, 42);
  ctx.closePath();
  fillStroke(L, hgrad(L, 25, 75, st.back ? m.robe : m.robeLight, st.back ? shade(m.robe, ROBE_BACK_SHADE) : m.robe));
  if (st.back) {
    // Cape fold and collar.
    ctx.strokeStyle = L.c(shade(m.robe, ROBE_FOLD_SHADE));
    ctx.lineWidth = L.lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(50, 46);
    ctx.lineTo(50, hemY + 2);
    ctx.moveTo(40, 52);
    ctx.quadraticCurveTo(38, 70, 33, hemY - 2);
    ctx.moveTo(60, 52);
    ctx.quadraticCurveTo(62, 70, 67, hemY - 2);
    ctx.stroke();
    poly(L, [[36, 43], [64, 43], [60, 52], [40, 52]], m.hatLight, true, 0.3);
  } else {
    poly(L, [[31, 63], [69, 63], [70, 69], [30, 69]], L.gold, true, 0.2);
    ctx.fillStyle = L.c(shade(m.band, 0.7));
    ctx.fillRect(47, 63, 6, 6);
    ctx.strokeStyle = L.c(m.hatLight);
    ctx.lineWidth = L.lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(50, 44);
    ctx.lineTo(50, 63);
    ctx.stroke();
  }
  // Arms.
  if (st.armsOut) {
    poly(L, [[36, 46], [16, 46], [12, 53], [36, 56]], m.robe, true, 0.3);
    ell(L, 11, 50, 3.6, 3.6, m.skin);
    poly(L, [[64, 46], [86, 46], [90, 53], [64, 56]], m.robe, true, 0.3);
    ell(L, 91, 50, 3.6, 3.6, m.skin);
  } else {
    poly(L, [[64, 46], [74, 52], [78, 60], [68, 62], [62, 56]], m.robe, true, 0.3);
    ell(L, sx, 60, 3.8, 3.8, m.skin);
    poly(L, [[36, 46], [30, 56], [31, 66], [38, 64], [40, 54]], m.robe, true, 0.3);
    ell(L, 34, 67, 3.6, 3.6, m.skin);
  }
  feet(L, st, hemY);
  // Head and face.
  ell(L, 50, 36, 10.5, 10.5, st.back ? ch.hair : m.skin);
  if (!st.back) {
    dot(L, 46, 37, 1.7, m.eyes);
    dot(L, 54, 37, 1.7, m.eyes);
    ctx.strokeStyle = L.c(ch.skinShade);
    ctx.lineWidth = L.lw * 0.5;
    ctx.beginPath();
    ctx.moveTo(48, 42);
    ctx.quadraticCurveTo(50, 43.5, 52, 42);
    ctx.stroke();
  }
  hat(L, 50, 30, 0, st.back);
}

function profile(L: Look, st: FigureState, hemY: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  const ch = L.art.character;
  const sx = 80;
  staff(L, sx, 88, sx, STAFF_TOP);
  // Robe and the cape trailing behind it.
  ctx.beginPath();
  ctx.moveTo(40, 42);
  ctx.quadraticCurveTo(48, 38, 58, 42);
  ctx.quadraticCurveTo(66, 62, 68, hemY);
  ctx.quadraticCurveTo(46, hemY + 4, 28, hemY);
  ctx.quadraticCurveTo(34, 62, 40, 42);
  ctx.closePath();
  fillStroke(L, hgrad(L, 28, 68, shade(m.robe, ROBE_SIDE_SHADE), m.robe));
  poly(L, [[38, 44], [30, 52], [26, hemY - 2], [34, hemY - 6], [40, 60]], shade(m.robe, CAPE_SHADE), true, 0.3);
  poly(L, [[31, 63], [66, 63], [67, 69], [30, 69]], L.gold, true, 0.2);
  feet(L, st, hemY);
  // Arm to the staff.
  poly(L, [[52, 46], [66, 52], [74, 58], [70, 64], [56, 58]], m.robeLight, true, 0.3);
  ell(L, sx, 60, 3.8, 3.8, m.skin);
  // Head in profile, hair at the back.
  ell(L, 53, 36, 10, 10.2, m.skin);
  poly(L, [[61, 36], [67, 40], [61, 42]], m.skin, true, 0.3);
  dot(L, 58.5, 35.5, 1.7, m.eyes);
  ctx.fillStyle = L.c(ch.hair);
  ctx.beginPath();
  ctx.ellipse(46, 39, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  hat(L, 52, 30, 1, false);
}

/** The mage: a pointed hat, a robe and a staff with a glowing orb. */
export const mageFigure: Figure = (L, st) => {
  const hemY = st.booted ? HEM_Y_BOOTED : HEM_Y;
  if (st.profile) profile(L, st, hemY);
  else front(L, st, hemY);
};
