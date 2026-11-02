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

/** Lowest and highest volume the sliders offer, in percent. */
export const VOLUME_PERCENT_MIN = 0;
export const VOLUME_PERCENT_MAX = 100;
/** Granularity of the sliders, in percent. */
export const VOLUME_PERCENT_STEP = 5;
/** Volume used until the player moves a slider: 100 % is the loudness audio.json sets. */
export const VOLUME_PERCENT_DEFAULT = VOLUME_PERCENT_MAX;

/**
 * Turns a stored or slider value into a valid volume: a non-number becomes the default,
 * a number outside the range is clamped, and the result is snapped to the slider step.
 * Pure: it never touches storage.
 */
export function sanitizeVolumePercent(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return VOLUME_PERCENT_DEFAULT;
  const clamped = Math.min(VOLUME_PERCENT_MAX, Math.max(VOLUME_PERCENT_MIN, raw));
  const snapped = Math.round(clamped / VOLUME_PERCENT_STEP) * VOLUME_PERCENT_STEP;
  return Math.min(VOLUME_PERCENT_MAX, Math.max(VOLUME_PERCENT_MIN, snapped));
}

/** Effective gain: master volume times the category volume of audio.json times the player's percentage. */
export function effectiveVolume(masterVolume: number, categoryVolume: number, percent: number): number {
  return (masterVolume * categoryVolume * percent) / VOLUME_PERCENT_MAX;
}
