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
import type { PlayEngine } from '../core/PlayEngine';
import { CC2_HORIZONTAL_DIRECTIONS as HORIZONTAL_DIRECTIONS } from '../core/epoxy/cc2HeldInput';
import type { Direction, TimedMove } from '../core/types';

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

/** Applies one recorded action to the engine: a drop, a swap of players, a cycle of the boots, a turn in place, or a move. */
export function applyTimedMove(engine: PlayEngine, move: TimedMove): void {
  if (move.drop) {
    engine.dropItem(move.drop);
  } else if (move.swap === true) {
    engine.swapPlayer?.();
  } else if (move.cycle === true) {
    engine.cycleInventory?.();
  } else if (move.turn === true) {
    engine.turnPlayer?.(move.dir);
  } else if (move.alt !== undefined && engine.attemptPlayerMoveHeld) {
    // A two-key hold: the engine resolves both keys as it did when the move was recorded.
    engine.attemptPlayerMoveHeld([move.dir, move.alt]);
  } else {
    engine.attemptPlayerMove(move.dir);
  }
}

/** True when `alt` can be the second key of a two-key hold with `dir`: a direction on the other axis. */
function isOrthogonalAlt(dir: Direction, alt: unknown): alt is Direction {
  return isDirection(alt) && HORIZONTAL_DIRECTIONS.includes(alt) !== HORIZONTAL_DIRECTIONS.includes(dir);
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
    // A second key must be a direction on the other axis; anything else makes the record unreadable.
    if (entry.alt !== undefined && !isOrthogonalAlt(entry.dir, entry.alt)) return undefined;
    previousTick = entry.tick;
    result.push(
      typeof entry.drop === 'string'
        ? { tick: entry.tick, dir: entry.dir, drop: entry.drop }
        : entry.swap === true
          ? { tick: entry.tick, dir: entry.dir, swap: true }
          : entry.cycle === true
            ? { tick: entry.tick, dir: entry.dir, cycle: true }
            : entry.turn === true
              ? { tick: entry.tick, dir: entry.dir, turn: true }
              : entry.alt !== undefined
                ? { tick: entry.tick, dir: entry.dir, alt: entry.alt }
                : { tick: entry.tick, dir: entry.dir }
    );
  }
  return result;
}
