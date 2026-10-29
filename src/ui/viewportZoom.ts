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

import { GameConfig } from '../core/types';

/** Zoom presets from game.json, or the single default viewport width. */
export function getViewportPresets(game: GameConfig): number[] {
  const presets = game.grid.viewportPresets;
  return presets && presets.length > 0 ? presets : [game.grid.viewportWidth];
}

/**
 * Moves one preset towards more tiles (step 1, zoom out) or fewer tiles
 * (step -1, zoom in), clamped to the ends. A current value that is not a
 * preset is treated as `fallbackTiles`.
 */
export function stepZoomPreset(
  presets: readonly number[],
  current: number,
  step: 1 | -1,
  fallbackTiles: number
): number {
  if (presets.length === 0) return current;
  let idx = presets.indexOf(current);
  if (idx < 0) idx = Math.max(0, presets.indexOf(fallbackTiles));
  const nextIdx = Math.min(presets.length - 1, Math.max(0, idx + step));
  return presets[nextIdx];
}

/** Next preset in a wrap-around cycle. */
export function cycleZoomPreset(presets: readonly number[], current: number): number {
  if (presets.length === 0) return current;
  const idx = presets.indexOf(current);
  return presets[(idx + 1) % presets.length];
}
