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
 * Frame duration the per-frame tuning values in game.json (lerp factors, decays,
 * particle speeds) were authored against: one frame of a 60 Hz display.
 */
export const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Converts the time elapsed since the previous frame into a multiple of the
 * reference frame. The delta is clamped so a long pause (hidden tab, mode switch)
 * does not make animations jump.
 */
export function frameScaleFromDelta(deltaMs: number, maxDeltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.min(deltaMs, maxDeltaMs) / REFERENCE_FRAME_MS;
}

/**
 * Rescales a per-reference-frame lerp factor so that the motion covers the same
 * distance per second whatever the refresh rate.
 */
export function scaleLerpFactor(factor: number, frameScale: number): number {
  if (factor >= 1) return 1;
  if (factor <= 0) return 0;
  return 1 - Math.pow(1 - factor, frameScale);
}

/** Rescales a per-reference-frame multiplicative decay (e.g. 0.85 per frame). */
export function scaleDecay(factor: number, frameScale: number): number {
  return Math.pow(factor, frameScale);
}
