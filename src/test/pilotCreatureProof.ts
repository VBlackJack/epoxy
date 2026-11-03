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

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel } from '../core/types';
import { DEFAULT_SEARCH_STATE_CAP, searchCanWin, searchShortestWin, SearchWin } from './pilotSearch';

/** The creature a level proof keeps alive unless the caller names another. */
export const DEFAULT_CREATURE = 'bug';

export interface CreatureProofOptions {
  /** Entity type that must still be alive at the win; the default is the bug. */
  creature?: string;
  /** Most states a search may visit; exceeding it throws. */
  stateCap?: number;
  /** Offer the drop of held items as a move; true by default. */
  allowDrops?: boolean;
}

function loadEngine(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/**
 * Searches exhaustively for the shortest win in which every creature of the
 * given type that the level starts with is still alive (none drowned, burned
 * or crushed). Returns the win, or null when every win costs a creature.
 * A level without such a creature has nothing to keep alive, so any win counts.
 */
export function searchWinWithCreatureAlive(level: CompiledLevel, options: CreatureProofOptions = {}): SearchWin | null {
  const creature = options.creature ?? DEFAULT_CREATURE;
  const engine = loadEngine(level);
  const starting = engine.getEntities().filter((e) => e.type === creature).map((e) => e.uid);
  return searchShortestWin(engine, {
    stateCap: options.stateCap ?? DEFAULT_SEARCH_STATE_CAP,
    allowDrops: options.allowDrops,
    // By identity, not by count: a clone spawned meanwhile must not stand in for a creature that died.
    accept: (e) => {
      const alive = new Set(e.getEntities().map((x) => x.uid));
      return starting.every((uid) => alive.has(uid));
    }
  });
}

/** Both runs of the proof: with and without the drop of held items as a move. */
export interface CreatureProof {
  withDrops: SearchWin | null;
  withoutDrops: SearchWin | null;
}

export function creatureProof(level: CompiledLevel, options: CreatureProofOptions = {}): CreatureProof {
  return {
    withDrops: searchWinWithCreatureAlive(level, { ...options, allowDrops: true }),
    withoutDrops: searchWinWithCreatureAlive(level, { ...options, allowDrops: false })
  };
}

/**
 * Throws unless the level is winnable (drops allowed) and no win keeps the
 * creature alive, with the drop of held items allowed and forbidden alike. An
 * unwinnable level would make the claim vacuously true, so it is refused too.
 * The message carries the shortest offending win.
 */
export function assertNoWinWithCreatureAlive(level: CompiledLevel, options: CreatureProofOptions = {}): void {
  const creature = options.creature ?? DEFAULT_CREATURE;
  if (!searchCanWin(loadEngine(level), { stateCap: options.stateCap ?? DEFAULT_SEARCH_STATE_CAP, allowDrops: true })) {
    throw new Error('the level cannot be won at all, so the proof would be vacuous');
  }
  const proof = creatureProof(level, options);
  const found = proof.withDrops ?? proof.withoutDrops;
  if (found) {
    const mode = proof.withoutDrops ? 'without drops' : 'only with drops';
    throw new Error(`a win keeps the ${creature} alive (${mode}): ${found.actions.join(' ')}`);
  }
}
