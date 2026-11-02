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
 * Banding of colour gradients for the Retro HD styles: a smooth gradient becomes a few flat
 * colour bands with hard edges, the way hardware with a small palette showed shading. Pure module:
 * no DOM.
 */

import { Rgb, formatHexColour, lerpColour } from '../retro32/colour';
import { parseCssColour } from './retroHdPalette';

/** One colour stop of a gradient, as passed to addColorStop. */
export interface GradientStop {
  readonly offset: number;
  readonly colour: string;
}

const OPAQUE = 1;
const ALPHA_DECIMALS = 1000;
const HALF = 0.5;

interface Sample {
  readonly offset: number;
  readonly rgb: Rgb;
  readonly alpha: number;
}

function toSample(stop: GradientStop): Sample | null {
  const parsed = parseCssColour(stop.colour);
  if (!parsed) return null;
  return { offset: stop.offset, rgb: parsed.rgb, alpha: parsed.alpha === null ? OPAQUE : Number(parsed.alpha) };
}

function colourAt(samples: readonly Sample[], position: number): { rgb: Rgb; alpha: number } {
  if (position <= samples[0].offset) return samples[0];
  for (let i = 1; i < samples.length; i++) {
    const next = samples[i];
    if (position <= next.offset) {
      const prev = samples[i - 1];
      const span = next.offset - prev.offset;
      const t = span > 0 ? (position - prev.offset) / span : 1;
      return { rgb: lerpColour(prev.rgb, next.rgb, t), alpha: prev.alpha + (next.alpha - prev.alpha) * t };
    }
  }
  return samples[samples.length - 1];
}

/**
 * The stops of `bands` flat bands covering 0..1, each of the colour the smooth gradient has at
 * the middle of its band. Stops that are not plain colours are returned unchanged, and so is a
 * gradient asked for fewer than two bands.
 */
export function bandStops(stops: readonly GradientStop[], bands: number): GradientStop[] {
  const samples = stops.map(toSample);
  if (bands < 2 || stops.length === 0 || samples.some((s) => s === null)) return [...stops];
  const known = samples as Sample[];
  const out: GradientStop[] = [];
  for (let i = 0; i < bands; i++) {
    const { rgb, alpha } = colourAt(known, (i + HALF) / bands);
    const colour = alpha >= OPAQUE
      ? formatHexColour(rgb)
      : `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${Math.round(alpha * ALPHA_DECIMALS) / ALPHA_DECIMALS})`;
    out.push({ offset: i / bands, colour }, { offset: (i + 1) / bands, colour });
  }
  return out;
}
