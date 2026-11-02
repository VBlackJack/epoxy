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

/** How the music track is chosen: follows the biome, any track at random, or among the ticked ones. */
export const MUSIC_MODES = ['default', 'random', 'custom'] as const;
export type MusicMode = (typeof MUSIC_MODES)[number];

/** Mode used when neither the saved settings nor audio.json name a valid one. */
export const FALLBACK_MUSIC_MODE: MusicMode = 'default';

export function isMusicMode(value: unknown): value is MusicMode {
  return typeof value === 'string' && (MUSIC_MODES as readonly string[]).includes(value);
}

export interface TrackPickContext {
  /** Track of the biome on screen, used by the 'default' mode. */
  themeTrackId: string | null;
  /** Every track that exists. */
  allIds: readonly string[];
  /** Tracks ticked for the 'custom' mode. */
  customIds: readonly string[];
  /** Track playing now: not picked again while another one is eligible. */
  previousId: string | null;
  /** Tracks that failed to play this session. */
  excludedIds: ReadonlySet<string>;
  /**
   * Tracks of the endless run, set only while its levels are the ones on screen: the
   * 'default' mode plays one of them, never the same twice in a row, instead of the biome track.
   */
  endlessTrackIds?: readonly string[] | null;
  /** Source of randomness in [0, 1). */
  random: () => number;
}

/** Picks one id among the candidates, never the previous one unless it is the only choice. */
function pickAmong(candidates: readonly string[], ctx: TrackPickContext): string | null {
  if (candidates.length === 0) return null;
  const others = candidates.filter((id) => id !== ctx.previousId);
  const pool = others.length > 0 ? others : candidates;
  const index = Math.min(Math.floor(ctx.random() * pool.length), pool.length - 1);
  return pool[Math.max(index, 0)];
}

/**
 * Chooses the track to play, or null when none is eligible (the caller then plays nothing).
 */
export function pickTrack(mode: MusicMode, ctx: TrackPickContext): string | null {
  const known = new Set(ctx.allIds);
  const eligible = (ids: readonly string[]): string[] =>
    ids.filter((id, i) => known.has(id) && !ctx.excludedIds.has(id) && ids.indexOf(id) === i);
  switch (mode) {
    case 'default': {
      const endless = eligible(ctx.endlessTrackIds ?? []);
      if (endless.length > 0) return pickAmong(endless, ctx);
      const id = ctx.themeTrackId;
      return id !== null && eligible([id]).length === 1 ? id : null;
    }
    case 'random':
      return pickAmong(eligible(ctx.allIds), ctx);
    case 'custom':
      return pickAmong(eligible(ctx.customIds), ctx);
  }
}

/**
 * Custom list to store: an empty list stands for "every track", so tracks
 * added to audio.json later count as ticked for a player who ticked them all.
 */
export function customIdsForStorage(customIds: readonly string[], allIds: readonly string[]): string[] {
  const everyTrackTicked = allIds.length > 0 && allIds.every((id) => customIds.includes(id));
  return everyTrackTicked ? [] : [...customIds];
}

export interface MusicSettings {
  mode: MusicMode;
  customIds: string[];
}

/**
 * Turns stored values into valid ones: an unknown mode becomes the default
 * mode, and the custom list loses non-strings, duplicates and unknown ids
 * (an empty result means every track). Pure: it never touches storage.
 */
export function sanitizeMusicSettings(
  rawMode: unknown,
  rawCustom: unknown,
  allIds: readonly string[],
  defaultMode: MusicMode
): MusicSettings {
  const known = new Set(allIds);
  const kept: string[] = [];
  if (Array.isArray(rawCustom)) {
    for (const value of rawCustom) {
      if (typeof value === 'string' && known.has(value) && !kept.includes(value)) kept.push(value);
    }
  }
  return {
    mode: isMusicMode(rawMode) ? rawMode : defaultMode,
    customIds: kept.length > 0 ? kept : [...allIds]
  };
}
