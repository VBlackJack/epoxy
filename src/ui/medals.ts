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

export type MedalTier = 'gold' | 'silver' | 'bronze';

/** Medal earned for finishing with `timeRemaining` of `timeLimit` seconds; none on an untimed level. */
export function getMedalTier(
  timeRemaining: number,
  timeLimit: number,
  goldRatio: number,
  silverRatio: number
): MedalTier | null {
  if (timeLimit <= 0) return null;
  const ratio = timeRemaining / timeLimit;
  if (ratio >= goldRatio) return 'gold';
  if (ratio >= silverRatio) return 'silver';
  return 'bronze';
}

/** Translation key of the full medal label ("GOLD Medal"). */
export function medalLabelKey(tier: MedalTier): string {
  return `hud.messages.medal_${tier}.label`;
}

/** Translation key of the medal icon alone. */
export function medalIconKey(tier: MedalTier): string {
  return `hud.messages.medal_${tier}_icon.label`;
}
