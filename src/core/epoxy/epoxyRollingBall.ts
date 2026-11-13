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

import type { Direction } from '../types';
import type { EpoxyContext } from './epoxyWorld';

/**
 * The CC2 bowling ball as an actor: the `rolling_ball` monster a player sets down on a CC2-engine level. Not played yet: the
 * rule lands in a later batch, so nothing is launched and the caller keeps the path it has today (the hurled stone).
 * Returns true when a ball was launched from the cell (`x`, `y`) toward `dir`, false when none was.
 */
export function launchRollingBall(_ctx: EpoxyContext, _x: number, _y: number, _dir: Direction): boolean {
  return false;
}
