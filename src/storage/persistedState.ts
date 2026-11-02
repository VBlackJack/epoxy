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
import { parseRenderStyleId } from '../render/styles/renderStyles';
import { sanitizeTimedMoves } from '../ui/replaySchedule';

/** High score as stored: legacy records may carry untimed replayMoves. */
export type StoredHighScore = LevelHighScore & { replayTimedMoves?: TimedMove[] };

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
/**
 * Position to resume at in the active pack. The saved level id wins, so a
 * reorder, an insert or a removal keeps the player on the same level; a save
 * without an id (or whose level left the pack) falls back to its index.
 */
export function resolveSavedLevel(
  saved: unknown,
  activePackId: string,
  levels: readonly { readonly id: string }[]
): number | null {
  if (!isRecord(saved) || saved.packId !== activePackId) return null;
  if (typeof saved.levelId === 'string') {
    const byId = levels.findIndex((l) => l.id === saved.levelId);
    if (byId >= 0) return byId;
  }
  return resolveSavedLevelIndex(saved, activePackId, levels.length);
}

export function parseGraphicsStyle(value: unknown): GraphicsStyle | undefined {
  return parseRenderStyleId(value);
}
