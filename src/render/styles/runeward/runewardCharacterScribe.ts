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
 * The rune-scribe: a hooded figure in a long cloak, a scroll at the belt and a staff that carries a
 * lantern. The hood is outlined in the dark cloak edge, heavier on Parchment, so it stays readable
 * on a pale floor. Drawn in the 0..100 unit square of the look; a west view is the mirror of east.
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
  vgrad,
  withAlpha,
  type Figure,
  type FigureState,
  type Look
} from './runewardCharacterKit';

const HEM_Y = 87;
const HEM_Y_BOOTED = 82;
const STAFF_WIDTH = 3.4;
const STAFF_TOP = 26;
const LANTERN_GLOW_REACH = 15;
const LANTERN_GLOW_CORE_ALPHA = 0.6;
const LANTERN_GLOW_MID_ALPHA = 0.2;
/** How much heavier the hood edge is than the ordinary outline, on a plain and on an inked floor. */
const HOOD_EDGE_GROWTH = 1.25;
const HOOD_EDGE_GROWTH_INK = 1.7;

function lantern(L: Look, x: number, y: number): void {
  const { ctx } = L;
  const lamp = L.art.character.lantern;
  const m = L.art.mage;
  glow(L, x, y + 4, LANTERN_GLOW_REACH, withAlpha(lamp.glassBottom, LANTERN_GLOW_CORE_ALPHA), withAlpha(lamp.glassBottom, LANTERN_GLOW_MID_ALPHA));
  line(L, x, y - 8, x, y - 3, L.wood, 1.6);
  ctx.beginPath();
  ctx.arc(x, y - 9, 2.2, 0, Math.PI * 2);
  ctx.strokeStyle = L.out;
  ctx.lineWidth = L.lw;
  ctx.stroke();
  poly(L, [[x - 4, y - 3], [x + 4, y - 3], [x + 5, y + 9], [x - 5, y + 9]], vgrad(L, y - 3, y + 9, lamp.glassTop, lamp.glassBottom), true, 0.15);
  poly(L, [[x - 6, y - 3], [x + 6, y - 3], [x + 3, y - 6], [x - 3, y - 6]], L.gold, true, 0.1);
  poly(L, [[x - 5.5, y + 9], [x + 5.5, y + 9], [x + 4, y + 12], [x - 4, y + 12]], L.gold, true, 0.1);
  ctx.strokeStyle = L.c(lamp.rib);
  ctx.lineWidth = L.lw * 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x, y + 9);
  ctx.stroke();
  dot(L, x, y + 3, 1.6, m.orbCore);
}

/** The hood outline: the dark cloak edge, drawn over the ordinary outline. */
function hoodEdge(L: Look): void {
  const { ctx } = L;
  ctx.strokeStyle = L.c(L.art.character.cloak.edge);
  ctx.lineWidth = L.lw * (L.inked ? HOOD_EDGE_GROWTH_INK : HOOD_EDGE_GROWTH);
  ctx.lineJoin = 'round';
  ctx.stroke();
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

function hemRunes(L: Look, hemY: number): void {
  const { ctx } = L;
  ctx.save();
  ctx.clip();
  ctx.fillStyle = L.gold;
  ctx.fillRect(20, hemY - 4, 60, 2.2);
  ctx.restore();
}

function front(L: Look, st: FigureState, hemY: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  const ch = L.art.character;
  const cloak = ch.cloak;
  const sx = st.armsOut ? 92 : 80;
  line(L, st.armsOut ? 90 : sx, 90, sx, STAFF_TOP, L.wood, STAFF_WIDTH);
  lantern(L, sx, STAFF_TOP - 2);
  // Cloak bell.
  ctx.beginPath();
  ctx.moveTo(40, 40);
  ctx.quadraticCurveTo(50, 36, 60, 40);
  ctx.quadraticCurveTo(70, 62, 78, hemY);
  ctx.quadraticCurveTo(50, hemY + 5, 22, hemY);
  ctx.quadraticCurveTo(30, 62, 40, 40);
  ctx.closePath();
  fillStroke(L, hgrad(L, 22, 78, st.back ? cloak.main : cloak.light, cloak.dark));
  hemRunes(L, hemY);
  ctx.fillStyle = L.gold;
  for (let i = 0; i < 5; i += 1) ctx.fillRect(30 + i * 9, hemY - 8.5, 1.6, 3.6);
  if (st.back) {
    // Embroidered rune.
    ctx.strokeStyle = L.gold;
    ctx.lineWidth = L.lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(50, 50);
    ctx.lineTo(50, 74);
    ctx.moveTo(42, 58);
    ctx.lineTo(58, 64);
    ctx.moveTo(42, 66);
    ctx.lineTo(58, 58);
    ctx.stroke();
  } else {
    // Inner tunic strip, belt and scroll.
    poly(L, [[45, 48], [55, 48], [57, hemY - 4], [43, hemY - 4]], m.robe, true, 0.2);
    poly(L, [[43, 64], [57, 64], [57, 69], [43, 69]], L.gold, true, 0.2);
    poly(L, [[57, 66], [67, 64], [69, 74], [59, 76]], ch.scroll, true, 0.2);
    ctx.strokeStyle = L.c(ch.scrollInk);
    ctx.lineWidth = L.lw * 0.4;
    ctx.beginPath();
    ctx.moveTo(60, 69);
    ctx.lineTo(66, 68);
    ctx.moveTo(60, 72);
    ctx.lineTo(66, 71);
    ctx.stroke();
  }
  // Arms.
  if (st.armsOut) {
    poly(L, [[38, 46], [16, 47], [12, 54], [38, 57]], cloak.main, true, 0.3);
    ell(L, 11, 50.5, 3.6, 3.6, m.skin);
    poly(L, [[62, 46], [88, 47], [92, 54], [62, 57]], cloak.main, true, 0.3);
    ell(L, 91.5, 50.5, 3.6, 3.6, m.skin);
  } else {
    poly(L, [[62, 46], [74, 52], [80, 60], [70, 62], [62, 56]], cloak.main, true, 0.3);
    ell(L, sx, 60, 3.8, 3.8, m.skin);
    poly(L, [[38, 46], [32, 56], [34, 64], [41, 62], [42, 54]], cloak.main, true, 0.3);
    ell(L, 37, 66, 3.6, 3.6, m.skin);
  }
  feet(L, st, hemY);
  // Hood.
  ctx.beginPath();
  ctx.moveTo(34, 44);
  ctx.quadraticCurveTo(30, 14, 50, 12);
  ctx.quadraticCurveTo(70, 14, 66, 44);
  ctx.quadraticCurveTo(50, 52, 34, 44);
  ctx.closePath();
  fillStroke(L, hgrad(L, 34, 66, st.back ? cloak.main : cloak.light, cloak.dark));
  hoodEdge(L);
  if (!st.back) {
    // Face opening, the face in it, glowing eyes and a trim.
    ctx.beginPath();
    ctx.ellipse(50, 33, 11, 12.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = L.c(ch.hoodInner);
    ctx.fill();
    ctx.strokeStyle = L.out;
    ctx.lineWidth = L.lw;
    ctx.stroke();
    ctx.fillStyle = L.c(m.skin);
    ctx.beginPath();
    ctx.ellipse(50, 36, 7.5, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    dot(L, 46.5, 35, 1.9, m.orb);
    dot(L, 53.5, 35, 1.9, m.orb);
    dot(L, 46.5, 35, 0.8, m.orbCore);
    dot(L, 53.5, 35, 0.8, m.orbCore);
    ctx.strokeStyle = L.gold;
    ctx.lineWidth = L.lw * 0.6;
    ctx.beginPath();
    ctx.ellipse(50, 33, 11.4, 13, 0, Math.PI * 0.95, Math.PI * 2.05);
    ctx.stroke();
  } else {
    ctx.strokeStyle = L.c(cloak.dark);
    ctx.lineWidth = L.lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(50, 14);
    ctx.quadraticCurveTo(54, 30, 50, 46);
    ctx.stroke();
  }
  ell(L, 50, 46, 2.6, 2.6, L.gold);
}

function profile(L: Look, st: FigureState, hemY: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  const ch = L.art.character;
  const cloak = ch.cloak;
  const sx = 80;
  line(L, sx, 90, sx, STAFF_TOP, L.wood, STAFF_WIDTH);
  lantern(L, sx, STAFF_TOP - 2);
  // Trailing cloak.
  ctx.beginPath();
  ctx.moveTo(40, 40);
  ctx.quadraticCurveTo(50, 36, 60, 40);
  ctx.quadraticCurveTo(66, 62, 70, hemY);
  ctx.quadraticCurveTo(46, hemY + 5, 22, hemY);
  ctx.quadraticCurveTo(30, 60, 40, 40);
  ctx.closePath();
  fillStroke(L, hgrad(L, 22, 70, cloak.dark, cloak.main));
  hemRunes(L, hemY);
  feet(L, st, hemY);
  poly(L, [[34, 64], [44, 62], [46, 72], [36, 74]], ch.scroll, true, 0.2);
  // Arm to the staff.
  poly(L, [[50, 46], [66, 52], [74, 58], [70, 64], [54, 58]], cloak.main, true, 0.3);
  ell(L, sx, 60, 3.8, 3.8, m.skin);
  // Hood: the peak sweeps back.
  ctx.beginPath();
  ctx.moveTo(60, 46);
  ctx.quadraticCurveTo(68, 16, 46, 12);
  ctx.quadraticCurveTo(30, 8, 24, 20);
  ctx.quadraticCurveTo(34, 24, 36, 46);
  ctx.quadraticCurveTo(48, 52, 60, 46);
  ctx.closePath();
  fillStroke(L, hgrad(L, 24, 66, cloak.dark, cloak.light));
  hoodEdge(L);
  // Face opening on the front.
  ctx.beginPath();
  ctx.ellipse(58, 33, 7, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = L.c(ch.hoodInner);
  ctx.fill();
  ctx.strokeStyle = L.out;
  ctx.lineWidth = L.lw;
  ctx.stroke();
  ctx.fillStyle = L.c(m.skin);
  ctx.beginPath();
  ctx.ellipse(59.5, 36, 5, 6.6, 0, 0, Math.PI * 2);
  ctx.fill();
  dot(L, 61.5, 34.5, 2, m.orb);
  dot(L, 61.8, 34.5, 0.9, m.orbCore);
  ctx.strokeStyle = L.gold;
  ctx.lineWidth = L.lw * 0.6;
  ctx.beginPath();
  ctx.ellipse(58, 33, 7.4, 11.4, 0, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  ell(L, 56, 47, 2.4, 2.4, L.gold);
}

/** The rune-scribe: a hooded cloak, a scroll and a lantern-staff. */
export const scribeFigure: Figure = (L, st) => {
  const hemY = st.booted ? HEM_Y_BOOTED : HEM_Y;
  if (st.profile) profile(L, st, hemY);
  else front(L, st, hemY);
};
