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
 * What a Runeward painter may use besides its arguments: the paint environment, the animation clock and the monster
 * sprite cache. This module imports no lot module, so every lot module can depend on it without a cycle; the dispatch
 * in runewardTiles.ts re-exports it for the existing imports.
 */

import type { Direction, RunewardArtConfig } from '../../../core/types';
import { REFERENCE_FRAME_MS } from '../../renderTiming';

/** What a painter may use besides its arguments. */
export interface RunewardPaintEnv {
  /** Animation clock of the renderer, in frame ticks. */
  readonly timeTick: number;
  /** True when the signal node of the cell being drawn is on; false in the editor and for non-signal cells. */
  readonly signalPowered: boolean;
  /** True when the player asked for reduced motion. */
  readonly reducedMotion: boolean;
  /** Per-renderer cache a painter may fill lazily (sprites, gradients); created on first use. */
  readonly cache: Map<string, unknown>;
  /** Colours and timings of the painters (game.json runewardArt). */
  readonly art: Readonly<RunewardArtConfig>;
}

/** Animation clock of the painters in milliseconds; reduced motion freezes it at 0. */
export function runewardClockMs(env: Pick<RunewardPaintEnv, 'timeTick' | 'reducedMotion'>): number {
  return env.reducedMotion ? 0 : env.timeTick * REFERENCE_FRAME_MS;
}

/** Frames of the monster walk cycle. */
const WALK_FRAME_COUNT = 2;

/** Frame of the monster walk cycle (0 or 1) at the current clock; reduced motion freezes it at 0. */
export function runewardWalkFrame(
  env: Pick<RunewardPaintEnv, 'timeTick' | 'reducedMotion'>,
  art: { readonly animation: Pick<RunewardArtConfig['animation'], 'monsterStepMs'> }
): number {
  return Math.floor(runewardClockMs(env) / art.animation.monsterStepMs) % WALK_FRAME_COUNT;
}

/** Prefix of the monster sprite keys in the painter cache. */
const MONSTER_SPRITE_KEY_PREFIX = 'monster';

/** Separator of the parts of a monster sprite key. */
const MONSTER_SPRITE_KEY_SEPARATOR = '|';

/** Most monster sprites the painter cache keeps; sizes change continuously while zooming, so past this the sprites start over. */
export const MONSTER_SPRITE_CACHE_MAX_ENTRIES = 256;

/** Cache key of one monster sprite: type, facing, walk frame and tile size. */
export function runewardMonsterSpriteKey(type: string, dir: Direction, frame: number, size: number): string {
  return [MONSTER_SPRITE_KEY_PREFIX, type, dir, frame, size].join(MONSTER_SPRITE_KEY_SEPARATOR);
}

/** The monster sprite cached in the painter cache under type, facing, frame and size; built on first use. */
export function runewardMonsterSprite<T>(
  env: Pick<RunewardPaintEnv, 'cache'>,
  type: string,
  dir: Direction,
  frame: number,
  size: number,
  build: () => T
): T {
  const key = runewardMonsterSpriteKey(type, dir, frame, size);
  if (env.cache.has(key)) return env.cache.get(key) as T;
  const monsterKeys = [...env.cache.keys()].filter((cached) => cached.startsWith(`${MONSTER_SPRITE_KEY_PREFIX}${MONSTER_SPRITE_KEY_SEPARATOR}`));
  if (monsterKeys.length >= MONSTER_SPRITE_CACHE_MAX_ENTRIES) {
    for (const stale of monsterKeys) env.cache.delete(stale);
  }
  const sprite = build();
  env.cache.set(key, sprite);
  return sprite;
}
