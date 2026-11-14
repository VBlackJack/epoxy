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
 * Test helper for the CC2 engine, whose player takes his turn at his place in the entity pass: an input given before the tick is
 * only stored, so what a step did can be read once the tick has played it. Each helper gives the input, plays the tick it belongs
 * to and returns what the turn did, so a test reads an outcome the same way on a level that plays in actor order and on one that
 * steps at the input.
 */

import type { GameEngine } from '../core/GameEngine';
import type { Direction } from '../core/types';

/** What the input did, read after the tick that played it. */
export interface PlayedInput {
  /** What the input call returned: stored for the turn (actor order) or the outcome of the step (any other level). */
  accepted: boolean;
  /** Whether the player stepped. */
  moved: boolean;
}

/** The outcome of an input whose call returned `accepted`, read after the tick: the turn tells it in actor order, the call itself otherwise. */
function outcomeOf(engine: GameEngine, accepted: boolean): PlayedInput {
  if (!engine.playsInActorOrder()) return { accepted, moved: accepted };
  return { accepted, moved: accepted && engine.getLastPlayerTurn()?.moved === true };
}

/** One step: the input, then the tick that plays it. */
export function playMove(engine: GameEngine, dir: Direction): PlayedInput {
  const accepted = engine.attemptPlayerMove(dir);
  engine.tick();
  return outcomeOf(engine, accepted);
}

/** The held keys, most recent first: the input, then the tick that plays it. */
export function playHeld(engine: GameEngine, dirs: readonly Direction[]): PlayedInput {
  const accepted = engine.attemptPlayerMoveHeld(dirs);
  engine.tick();
  return outcomeOf(engine, accepted);
}

/** The drop key (`null` for the tool held longest): the input, then the tick that plays it. Returns whether the call was accepted. */
export function playDrop(engine: GameEngine, itemId: string | null): boolean {
  const accepted = engine.dropItem(itemId);
  engine.tick();
  return accepted;
}

/** The cycle key: the input, then the tick that plays it. Returns whether the call was accepted. */
export function playCycle(engine: GameEngine): boolean {
  const accepted = engine.cycleInventory();
  engine.tick();
  return accepted;
}

/** Ticks without any input. */
export function idleTicks(engine: GameEngine, count: number = 1): void {
  for (let i = 0; i < count; i++) engine.tick();
}
