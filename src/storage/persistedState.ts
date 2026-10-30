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

import { isFiniteNumber, isRecord } from '../config/ConfigValidation';
import { GraphicsStyle, LevelHighScore, TimedMove } from '../core/types';
import { sanitizeTimedMoves } from '../ui/replaySchedule';

/** High score as stored: legacy records may carry untimed replayMoves. */
export type StoredHighScore = LevelHighScore & { replayTimedMoves?: TimedMove[] };

/** Graphics styles a saved settings record may name. */
const GRAPHICS_STYLES: readonly GraphicsStyle[] = ['modern', 'retro'];

/**
 * Validates the high score table read from storage. A record that is not an
 * object with finite numeric scores is dropped on its own; the others are
 * kept, legacy fields included. A record whose timed replay is malformed
 * keeps its scores and loses only the replay.
 */
export function sanitizeHighScores(value: unknown): Record<string, StoredHighScore> {
  const result: Record<string, StoredHighScore> = {};
  if (!isRecord(value)) return result;
  for (const [levelId, rec] of Object.entries(value)) {
    if (
      !isRecord(rec) ||
      !isFiniteNumber(rec.bestTimeRemaining) ||
      !isFiniteNumber(rec.minSteps) ||
      !isFiniteNumber(rec.bestScore)
    ) {
      continue;
    }
    const record = { ...rec } as unknown as StoredHighScore;
    record.replayTimedMoves = sanitizeTimedMoves(rec.replayTimedMoves);
    result[levelId] = record;
  }
  return result;
}

/**
 * Reads the level to resume from a saved progress record. Returns null when
 * the record is for another pack, or when its index is not an integer inside
 * the pack (a pack can shrink between releases).
 */
export function resolveSavedLevelIndex(
  saved: unknown,
  activePackId: string,
  levelCount: number
): number | null {
  if (!isRecord(saved) || saved.packId !== activePackId) return null;
  const index = saved.levelIndex;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= levelCount) return null;
  return index;
}

/** Returns the stored graphics style when it is a known one, else undefined. */
export function parseGraphicsStyle(value: unknown): GraphicsStyle | undefined {
  return GRAPHICS_STYLES.find((style) => style === value);
}
