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
 * Lookup tables from game identifiers to palette keys of game.json. They are
 * module constants so the renderer does not rebuild them every frame.
 */

/** Colour key used when a tile or item declares none. */
export const DEFAULT_COLOR_KEY = 'red';

/** Particle colour of each visual event kind; other kinds use their colour key. */
export const FX_COLOR_KEYS: Readonly<Record<string, string>> = {
  chip: 'fxChip',
  splash: 'fxSplash',
  explosion: 'fxExplosion',
  teleport: 'fxTeleport',
  win: 'fxWin'
};

/** Palette key of the block target mark. */
export const BLOCK_TARGET_COLOR_KEY = 'blockTarget';

/** Palette key of the outline a block gets while it stands on a block target. */
export const BLOCK_ON_TARGET_COLOR_KEY = 'blockOnTarget';

/** Palette key of each button's cap. */
export const BUTTON_COLOR_KEYS: Readonly<Record<string, string>> = {
  button_green: 'green',
  button_blue: 'blue',
  button_brown: 'brown',
  button_red: 'red',
  button_orange: 'orange',
  button_gray: 'gray'
};

/** Colour-blind glyph drawn on each button (see drawColorGlyph). */
export const BUTTON_GLYPH_KEYS: Readonly<Record<string, string>> = {
  button_green: 'green',
  button_blue: 'blue',
  button_brown: 'yellow',
  button_red: 'red',
  button_orange: 'orange',
  button_gray: 'orange'
};

export const BOOT_COLOR_KEYS: Readonly<Record<string, string>> = {
  boots_water: 'waterWave',
  boots_fire: 'fireMid',
  boots_ice: 'iceShine',
  boots_force: 'green',
  boots_speed: 'yellow',
  boots_eye: 'teleportRing',
  boots_pull: 'orange'
};

export const MONSTER_COLOR_KEYS: Readonly<Record<string, string>> = {
  bug: 'monsterBug',
  paramecium: 'monsterParamecium',
  pink_ball: 'monsterPinkBall',
  walker: 'monsterWalker',
  teeth: 'monsterTeeth',
  glider: 'monsterGlider',
  fireball: 'monsterFireball',
  tank: 'monsterTank',
  blob: 'monsterBlob'
};

/** Palette key used for a monster type missing from MONSTER_COLOR_KEYS. */
export const DEFAULT_MONSTER_COLOR_KEY = 'monsterBug';

/** Palette key used for boots missing from BOOT_COLOR_KEYS. */
export const DEFAULT_BOOT_COLOR_KEY = 'blue';

/**
 * Colour-blind glyph key of a tile: the colour key of a colour teleporter, null for a plain
 * teleporter or any other tile. Doors and keys use their colour key the same way.
 */
export function teleporterGlyphKey(def: { isTeleporter?: boolean; colorKey?: string }): string | null {
  return def.isTeleporter && def.colorKey ? def.colorKey : null;
}

/** Retro style: ramp that colours the swap tones of a template sprite, per colour key. */
export const RETRO_SWAP_RAMPS: Readonly<Record<string, string>> = {
  red: 'red',
  blue: 'blue',
  yellow: 'yellow',
  green: 'green',
  orange: 'orange',
  brown: 'brown',
  gray: 'gravel'
};

/** Retro style: ramp of the boots template, per boots tile id (force boots are green). */
export const RETRO_BOOT_RAMPS: Readonly<Record<string, string>> = {
  boots_water: 'water',
  boots_fire: 'fire',
  boots_ice: 'ice',
  boots_force: 'green',
  boots_speed: 'yellow',
  boots_eye: 'teleport',
  boots_pull: 'orange'
};

/** Retro style: ramp of the ring of the plain (colourless) teleporter. */
export const RETRO_PLAIN_TELEPORT_RAMP = 'teleport';
