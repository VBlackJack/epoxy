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
 * The adventurer-mage: a stocky traveller in a tunic and a short cape, a floppy feathered cap, a satchel
 * and a rune glowing on the chest, with a crystal-tipped staff. Drawn in the 0..100 unit square of the
 * look; a west view is the mirror of east.
 */

import {
  PROFILE_STEP_LIFT,
  PROFILE_STEP_SPREAD,
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

const LEG_TOP = 66;
const FOOT_Y = 90;
const LEG_STEP_LIFT = 4;
const STAFF_WIDTH = 3.6;
const STAFF_TIP_Y = 36;
const CRYSTAL_GLOW_REACH = 12;
const CRYSTAL_GLOW_CORE_ALPHA = 0.55;
const CRYSTAL_GLOW_MID_ALPHA = 0.15;
const RUNE_GLOW_CORE_ALPHA = 0.7;
const RUNE_GLOW_MID_ALPHA = 0.15;

function crystalStaff(L: Look, x0: number, y0: number, x1: number, y1: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  line(L, x0, y0, x1, y1, L.wood, STAFF_WIDTH);
  glow(L, x1, y1 - 4, CRYSTAL_GLOW_REACH, withAlpha(m.orb, CRYSTAL_GLOW_CORE_ALPHA), withAlpha(m.orb, CRYSTAL_GLOW_MID_ALPHA));
  poly(L, [[x1, y1 - 12], [x1 + 5, y1 - 5], [x1, y1 + 1], [x1 - 5, y1 - 5]], vgrad(L, y1 - 12, y1 + 1, m.orbCore, m.orb), true, 0.1);
  ctx.strokeStyle = L.c(withAlpha(m.orbCore, 0.8));
  ctx.lineWidth = L.lw * 0.4;
  ctx.beginPath();
  ctx.moveTo(x1 - 1, y1 - 9);
  ctx.lineTo(x1 - 2.6, y1 - 5);
  ctx.stroke();
}

/** The rune on the chest: three crossing strokes in a glow. */
function chestRune(L: Look, x: number, y: number, s: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  glow(L, x, y, 11 * s, withAlpha(m.orb, RUNE_GLOW_CORE_ALPHA), withAlpha(m.orb, RUNE_GLOW_MID_ALPHA));
  ctx.strokeStyle = L.c(m.orbCore);
  ctx.lineWidth = L.lw * 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 5 * s);
  ctx.lineTo(x, y + 5 * s);
  ctx.moveTo(x - 3.5 * s, y - 2 * s);
  ctx.lineTo(x + 3.5 * s, y + 1.5 * s);
  ctx.moveTo(x - 3.5 * s, y + 2 * s);
  ctx.lineTo(x + 3.5 * s, y - 1.5 * s);
  ctx.stroke();
}

/** A soft floppy cap with a short brim and a feather. */
function cap(L: Look, cx: number, cy: number, side: number): void {
  const { ctx } = L;
  const m = L.art.mage;
  ell(L, cx, cy + 1, 15.5, 4.4, hgrad(L, cx - 15, cx + 15, m.hatLight, m.hat));
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.quadraticCurveTo(cx - 12, cy - 15, cx + 2, cy - 15);
  ctx.quadraticCurveTo(cx + 14 - side * 2, cy - 14, cx + 12 + (side ? side * 8 : 8), cy - 4);
  ctx.lineTo(cx + 12, cy);
  ctx.closePath();
  fillStroke(L, hgrad(L, cx - 12, cx + 12, m.hatLight, m.hat));
  ctx.fillStyle = L.gold;
  ctx.fillRect(cx - 11.6, cy - 3.2, 23.2, 2.6);
  ctx.beginPath();
  ctx.moveTo(cx + 9 - side, cy - 4);
  ctx.quadraticCurveTo(cx + 16 + side * 2, cy - 16, cx + 9, cy - 21);
  ctx.quadraticCurveTo(cx + 8, cy - 12, cx + 9 - side, cy - 4);
  ctx.closePath();
  fillStroke(L, L.art.character.feather);
}

function front(L: Look, st: FigureState): void {
  const { ctx } = L;
  const m = L.art.mage;
  const ch = L.art.character;
  const sx = st.armsOut ? 91 : 79;
  crystalStaff(L, sx, 90, st.armsOut ? 93 : sx, STAFF_TIP_Y);
  // Legs and boots.
  const f = st.frame;
  const left = f === 1 ? -LEG_STEP_LIFT : 0;
  const right = f === 2 ? -LEG_STEP_LIFT : 0;
  poly(L, [[38, LEG_TOP], [48, LEG_TOP], [47, FOOT_Y - 6 + left], [39, FOOT_Y - 6 + left]], ch.trouser, true, 0.2);
  poly(L, [[52, LEG_TOP], [62, LEG_TOP], [61, FOOT_Y - 6 + right], [53, FOOT_Y - 6 + right]], ch.trouser, true, 0.2);
  boot(L, 43, FOOT_Y + left, 13, 8, st.feet[0]);
  boot(L, 57, FOOT_Y + right, 13, 8, st.feet[1]);
  if (st.back) {
    // Short cape over the whole back.
    ctx.beginPath();
    ctx.moveTo(34, 42);
    ctx.quadraticCurveTo(50, 38, 66, 42);
    ctx.quadraticCurveTo(73, 62, 74, 78);
    ctx.quadraticCurveTo(50, 84, 26, 78);
    ctx.quadraticCurveTo(27, 62, 34, 42);
    ctx.closePath();
    fillStroke(L, hgrad(L, 26, 74, m.hatLight, m.hat));
    ctx.strokeStyle = L.c(m.hat);
    ctx.lineWidth = L.lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(50, 46);
    ctx.lineTo(50, 80);
    ctx.moveTo(38, 50);
    ctx.quadraticCurveTo(37, 66, 32, 78);
    ctx.moveTo(62, 50);
    ctx.quadraticCurveTo(63, 66, 68, 78);
    ctx.stroke();
    ctx.fillStyle = L.gold;
    ctx.fillRect(35, 41, 30, 3);
  } else {
    // Torso, belt and chest rune.
    poly(L, [[33, 44], [67, 44], [70, 70], [30, 70]], hgrad(L, 30, 70, m.robeLight, m.robe), true, 0.12);
    poly(L, [[30, 64], [70, 64], [70, 70], [30, 70]], L.gold, true, 0.15);
    ctx.fillStyle = L.c(ch.leatherDark);
    ctx.fillRect(46, 63.5, 8, 7);
    chestRune(L, 50, 54, 1);
    // Cape edges peeking at the shoulders.
    poly(L, [[30, 44], [38, 44], [34, 62], [26, 60]], m.hatLight, true, 0.3);
    poly(L, [[70, 44], [62, 44], [66, 62], [74, 60]], m.hatLight, true, 0.3);
    // Satchel on the left hip and its strap.
    ctx.lineCap = 'round';
    ctx.strokeStyle = L.out;
    ctx.lineWidth = 3.4 + L.lw;
    ctx.beginPath();
    ctx.moveTo(60, 44);
    ctx.lineTo(38, 69);
    ctx.stroke();
    ctx.strokeStyle = L.c(ch.strap);
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(60, 44);
    ctx.lineTo(38, 69);
    ctx.stroke();
    poly(L, [[28, 66], [42, 66], [43, 78], [27, 78]], ch.satchel, true, 0.2);
    poly(L, [[28, 66], [42, 66], [41, 71], [29, 71]], ch.satchelLight, true, 0.2);
    ell(L, 35, 72, 1.6, 1.6, L.gold);
  }
  // Arms.
  if (st.armsOut) {
    poly(L, [[34, 46], [16, 47], [12, 54], [34, 58]], m.robe, true, 0.3);
    ell(L, 11, 51, 3.8, 3.8, m.skin);
    poly(L, [[66, 46], [88, 47], [92, 54], [66, 58]], m.robe, true, 0.3);
    ell(L, 92, 51, 3.8, 3.8, m.skin);
  } else {
    poly(L, [[66, 46], [76, 52], [80, 62], [70, 64], [64, 56]], m.robe, true, 0.3);
    ell(L, sx, 62, 4, 4, m.skin);
    poly(L, [[34, 46], [26, 56], [27, 66], [35, 65], [37, 55]], m.robe, true, 0.3);
    ell(L, 30, 68, 3.8, 3.8, m.skin);
  }
  // Head.
  ell(L, 50, 36, 12, 11.5, st.back ? ch.hair : m.skin);
  if (!st.back) {
    dot(L, 45.5, 37, 1.9, m.eyes);
    dot(L, 54.5, 37, 1.9, m.eyes);
    ctx.strokeStyle = L.c(ch.skinShade);
    ctx.lineWidth = L.lw * 0.5;
    ctx.beginPath();
    ctx.moveTo(47.5, 42);
    ctx.quadraticCurveTo(50, 43.5, 52.5, 42);
    ctx.stroke();
  }
  cap(L, 50, 30, 0);
}

function profile(L: Look, st: FigureState): void {
  const m = L.art.mage;
  const ch = L.art.character;
  const sx = 80;
  const f = st.frame;
  const a = f === 1 ? PROFILE_STEP_SPREAD : f === 2 ? -PROFILE_STEP_SPREAD : 0;
  const lift = f ? PROFILE_STEP_LIFT : 0;
  crystalStaff(L, sx, 90, sx, STAFF_TIP_Y);
  // Short cape trailing behind.
  poly(L, [[40, 44], [30, 48], [22, 74], [34, 74], [42, 62]], m.hat, true, 0.25);
  poly(L, [[43 + a, LEG_TOP], [52 + a, LEG_TOP], [52 + a, FOOT_Y - 6], [44 + a, FOOT_Y - 6]], ch.trouser, true, 0.2);
  poly(L, [[48 - a, LEG_TOP], [57 - a, LEG_TOP], [57 - a, FOOT_Y - 6 - lift], [49 - a, FOOT_Y - 6 - lift]], ch.trouser, true, 0.2);
  boot(L, 47 + a, FOOT_Y, 14, 8, st.feet[0]);
  boot(L, 54 - a, FOOT_Y - lift, 14, 8, st.feet[1]);
  poly(L, [[36, 44], [64, 44], [66, 70], [34, 70]], hgrad(L, 34, 66, m.robe, m.robeLight), true, 0.15);
  poly(L, [[34, 64], [66, 64], [66, 70], [34, 70]], L.gold, true, 0.15);
  chestRune(L, 57, 54, 0.8);
  // Satchel at the back hip.
  poly(L, [[30, 62], [43, 62], [44, 76], [31, 76]], ch.satchel, true, 0.2);
  poly(L, [[30, 62], [43, 62], [42, 68], [31, 68]], ch.satchelLight, true, 0.2);
  ell(L, 37, 69, 1.5, 1.5, L.gold);
  // Arm to the staff.
  poly(L, [[50, 46], [66, 52], [76, 60], [72, 66], [54, 58]], m.robeLight, true, 0.3);
  ell(L, sx, 62, 4, 4, m.skin);
  // Head with a nose, hair at the back.
  ell(L, 52, 36, 11.6, 11.4, m.skin);
  poly(L, [[61, 36], [67.5, 40], [61, 42]], m.skin, true, 0.3);
  dot(L, 58, 36, 1.9, m.eyes);
  L.ctx.fillStyle = L.c(ch.hair);
  L.ctx.beginPath();
  L.ctx.ellipse(43, 39, 5.5, 7, 0, 0, Math.PI * 2);
  L.ctx.fill();
  cap(L, 51, 30, 1);
}

/** The adventurer-mage: a tunic, a short cape, a satchel and a crystal staff. */
export const adventurerFigure: Figure = (L, st) => {
  if (st.profile) profile(L, st);
  else front(L, st);
};
