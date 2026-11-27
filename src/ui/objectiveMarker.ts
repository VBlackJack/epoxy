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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel, GridPoint } from '../core/types';
import { TIMING_DEFAULTS } from './uiConstants';
import { PathEngine, Pathfinder } from '../core/Pathfinder';

/** The goal the marker shows; `reachable` is false when no tapped path reaches it from here yet. */
export interface MarkedObjective {
  readonly point: GridPoint;
  readonly reachable: boolean;
}

/**
 * The objective marker's answer: the first goal a tapped path reaches now, else the goal the search sees beyond what the
 * path refuses. The HUD asks every tick, so the answer is kept for the level object (the editor's test play reuses a level
 * id), Chip's cell, the chips left, his keys and boots, and the second; `forget` drops it when the game is loaded again,
 * undone or replayed.
 */
export class ObjectiveMarker {
  private cache: { level: CompiledLevel; key: string; value: MarkedObjective | null } | null = null;
  /** How many times the search ran, for the tests. */
  public searches = 0;
  /** How many searches ran out of their expansion budget, for the tests and the harness. */
  public budgetHits = 0;

  public forget(): void {
    this.cache = null;
  }

  public get(engine: PathEngine, tick: number, ticksPerSecond: number): MarkedObjective | null {
    const player = engine.getPlayer();
    const level = engine.getLevel();
    const second = Math.floor(tick / ticksPerSecond);
    const key = `${player.x},${player.y}|${engine.getChipsRemaining()}|${JSON.stringify(player.keys)}|${[...player.boots].sort().join('+')}|${second}`;
    if (this.cache?.level !== level || this.cache.key !== key) {
      this.searches++;
      const outcome = { exhausted: false };
      const budget = ConfigRegistry.getGame().timing.walkObjectiveExpansionBudget ?? TIMING_DEFAULTS.walkObjectiveExpansionBudget;
      const reachable = Pathfinder.findReachableObjective(engine, budget, outcome);
      if (outcome.exhausted) this.budgetHits++;
      const found = reachable ?? Pathfinder.findNextObjective(engine);
      this.cache = { level, key, value: found === null ? null : { point: found, reachable: reachable !== null } };
    }
    return this.cache.value;
  }
}
