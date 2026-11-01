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
 * Material map of a 16-bit sprite. A material is (ramp, tone) packed in one id: ramp index in
 * the high bits, tone in the low bits; -1 is transparent. The `$` swap token is resolved to the
 * swap ramp here, and the automatic outline becomes the material of the outline ramp.
 */

import {
  RETRO_LEGEND_SEPARATOR,
  RETRO_OUTLINE_RAMP,
  RETRO_OUTLINE_TONE,
  RETRO_SWAP_RAMP_TOKEN,
  RETRO_TRANSPARENT_CHAR,
  type RetroRamps,
  type RetroSprite
} from '../retroSprites';

/** Id of a transparent pixel. */
export const MATERIAL_NONE = -1;
/** Bits holding the tone inside a material id. */
export const MATERIAL_TONE_BITS = 4;
const MATERIAL_TONE_MASK = (1 << MATERIAL_TONE_BITS) - 1;
/** Outline pixels are the tone 0 of the first ramp of every table. */
const OUTLINE_RAMP_INDEX = 0;

export function materialRamp(id: number): number {
  return id >> MATERIAL_TONE_BITS;
}

export function materialTone(id: number): number {
  return id & MATERIAL_TONE_MASK;
}

export function makeMaterial(rampIndex: number, tone: number): number {
  return (rampIndex << MATERIAL_TONE_BITS) | tone;
}

export interface MaterialMap {
  /** Material id per pixel, row-major, width * height. */
  ids: Int16Array;
  /** Ramp name per ramp index used in ids. */
  rampNames: string[];
}

interface LegendRef {
  ramp: string;
  tone: number;
}

function parseLegendRef(value: string): LegendRef | null {
  const at = value.lastIndexOf(RETRO_LEGEND_SEPARATOR);
  if (at <= 0) return null;
  const tone = Number(value.slice(at + 1));
  if (!Number.isInteger(tone) || tone < 0 || tone > MATERIAL_TONE_MASK) return null;
  return { ramp: value.slice(0, at), tone };
}

/** Resolves legend characters to material ids; unknown or unresolvable characters are transparent. */
class MaterialTable {
  readonly rampNames: string[] = [RETRO_OUTLINE_RAMP];
  private readonly byChar = new Map<string, number>();

  constructor(
    private readonly sprite: RetroSprite,
    private readonly ramps16: RetroRamps,
    private readonly ramps32: RetroRamps,
    private readonly swapRamp: string | undefined
  ) {}

  of(ch: string): number {
    const cached = this.byChar.get(ch);
    if (cached !== undefined) return cached;
    const id = this.resolve(ch);
    this.byChar.set(ch, id);
    return id;
  }

  private resolve(ch: string): number {
    const value = this.sprite.legend[ch];
    const ref = value === undefined ? null : parseLegendRef(value);
    if (!ref) return MATERIAL_NONE;
    const ramp = ref.ramp === RETRO_SWAP_RAMP_TOKEN ? this.swapRamp : ref.ramp;
    if (ramp === undefined || !this.ramps16[ramp]?.[ref.tone] || !this.ramps32[ramp]) return MATERIAL_NONE;
    return makeMaterial(this.indexOf(ramp), ref.tone);
  }

  private indexOf(ramp: string): number {
    const known = this.rampNames.indexOf(ramp);
    if (known >= 0) return known;
    this.rampNames.push(ramp);
    return this.rampNames.length - 1;
  }
}

function addOutline(ids: Int16Array, width: number, height: number): void {
  const border: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ids[i] !== MATERIAL_NONE) continue;
      const touchesOpaque =
        (y > 0 && ids[i - width] !== MATERIAL_NONE) ||
        (x < width - 1 && ids[i + 1] !== MATERIAL_NONE) ||
        (y < height - 1 && ids[i + width] !== MATERIAL_NONE) ||
        (x > 0 && ids[i - 1] !== MATERIAL_NONE);
      if (touchesOpaque) border.push(i);
    }
  }
  const outline = makeMaterial(OUTLINE_RAMP_INDEX, RETRO_OUTLINE_TONE);
  for (const index of border) ids[index] = outline;
}

/** Builds the material map of a 16-bit sprite. The outline needs the outline ramp in ramps32. */
export function buildMaterialMap(
  sprite: RetroSprite,
  ramps16: RetroRamps,
  ramps32: RetroRamps,
  swapRamp?: string
): MaterialMap {
  const { width, height } = sprite;
  const table = new MaterialTable(sprite, ramps16, ramps32, swapRamp);
  const ids = new Int16Array(width * height).fill(MATERIAL_NONE);
  for (let y = 0; y < height; y++) {
    const row = sprite.rows[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === undefined || ch === RETRO_TRANSPARENT_CHAR) continue;
      ids[y * width + x] = table.of(ch);
    }
  }
  if (sprite.outline && ramps32[RETRO_OUTLINE_RAMP]?.[RETRO_OUTLINE_TONE]) addOutline(ids, width, height);
  return { ids, rampNames: table.rampNames };
}
