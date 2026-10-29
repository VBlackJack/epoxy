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

import { isDirection, isFiniteNumber, isRecord } from '../config/ConfigValidation';
import { TimedMove } from '../core/types';

export interface DueMoves {
  due: TimedMove[];
  nextIndex: number;
}

/**
 * Returns the recorded moves to apply at `tick`, starting at `startIndex`.
 * A move whose tick has already passed is returned too, so it is attempted
 * exactly once and then skipped: a replay never waits on a move forever.
 */
export function collectDueMoves(moves: readonly TimedMove[], startIndex: number, tick: number): DueMoves {
  const due: TimedMove[] = [];
  let idx = Math.max(0, startIndex);
  while (idx < moves.length && moves[idx].tick <= tick) {
    due.push(moves[idx]);
    idx++;
  }
  return { due, nextIndex: idx };
}

/**
 * Validates timed moves read from storage. Returns undefined when the value
 * is not a well formed, tick ordered list, so a corrupt record only loses
 * its replay.
 */
export function sanitizeTimedMoves(value: unknown): TimedMove[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: TimedMove[] = [];
  let previousTick = 0;
  for (const entry of value) {
    if (!isRecord(entry) || !isFiniteNumber(entry.tick) || entry.tick < previousTick || !isDirection(entry.dir)) {
      return undefined;
    }
    previousTick = entry.tick;
    result.push({ tick: entry.tick, dir: entry.dir });
  }
  return result;
}
