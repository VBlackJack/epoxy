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

import { ORDERED_DIRECTIONS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import { Direction, UndoSnapshot } from '../core/types';
import { PieceSolver, WAIT_ACTION } from '../generator/PieceSolver';

/** Prefix of the search action that puts a held item down (the game's drop action, keys E and X). */
export const DROP_ACTION_PREFIX = 'DROP:';

/** One step of an exhaustive search: a move, a wait, or the drop of a held item. */
export type SearchAction = Direction | typeof WAIT_ACTION | `${typeof DROP_ACTION_PREFIX}${string}`;

/** States a search may visit before it gives up by throwing, so a runaway proof fails loudly. */
export const DEFAULT_SEARCH_STATE_CAP = 400000;

export interface SearchOptions {
  /** Most states to visit; exceeding it throws. */
  stateCap?: number;
  /** Rejects a win by its final state (for example: chips left, an item not delivered). */
  accept?: (engine: GameEngine) => boolean;
  /** Offer the drop of held items as a move; true by default. Turn it off to prove a drop is needed. */
  allowDrops?: boolean;
}

export interface SearchWin {
  /** Number of actions of the shortest win. */
  length: number;
  /** The winning actions, in order. */
  actions: SearchAction[];
}

export function dropAction(itemId: string): SearchAction {
  return `${DROP_ACTION_PREFIX}${itemId}`;
}

/**
 * Identity of a game state for the exhaustive searches: the player (cell,
 * facing, cooldown, keys, boots), chips left, every terrain and item cell (so
 * water turned to dirt and dirt turned to floor count), every entity in its
 * array order (which sets the update order) with position, direction and
 * cooldown (blocks, pink balls and other monsters; the cooldowns carry the
 * tick phase of their moves), and the random generator state, so levels with
 * random elements are never merged wrongly.
 */
export function searchStateKey(engine: GameEngine): string {
  const state: UndoSnapshot = engine.captureState();
  const keys = Object.entries(state.player.keys)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const entities = state.entities.map((e) => [e.type, e.x, e.y, e.dir, e.cooldownTicks, e.isSliding]);
  return JSON.stringify([
    state.player.x,
    state.player.y,
    state.player.dir,
    state.player.moveCooldown,
    keys,
    [...state.player.boots].sort(),
    state.chipsRemaining,
    state.terrain,
    state.items,
    entities,
    state.rngState
  ]);
}

/** The actions worth trying from the engine's current state: moves, a wait when something moves, drops of held items. */
export function searchActions(engine: GameEngine, allowDrops = true): SearchAction[] {
  const actions: SearchAction[] = [...ORDERED_DIRECTIONS];
  if (engine.getEntities().some((e) => e.kind === 'monster')) actions.push(WAIT_ACTION);
  if (!allowDrops) return actions;
  const state = engine.captureState();
  const held = [
    ...Object.entries(state.player.keys)
      .filter(([, count]) => count > 0)
      .map(([id]) => id),
    ...state.player.boots
  ].sort();
  for (const id of held) actions.push(dropAction(id));
  return actions;
}

/** Plays one search action and lets it settle; false when it does nothing, kills the player or never settles. */
export function applySearchAction(engine: GameEngine, action: SearchAction): boolean {
  if (action.startsWith(DROP_ACTION_PREFIX)) return engine.dropItem(action.slice(DROP_ACTION_PREFIX.length));
  return PieceSolver.play(engine, action as Direction | typeof WAIT_ACTION);
}

function isWin(engine: GameEngine, accept: (e: GameEngine) => boolean): boolean {
  return engine.isLevelCompleted() && engine.getChipsRemaining() === 0 && accept(engine);
}

/**
 * Breadth-first search over every state reachable from the engine's current
 * one, with moves, waits (when a monster moves) and item drops. Returns the
 * shortest win, or null when none exists. Throws when `stateCap` is exceeded.
 * The engine is left in an unspecified state.
 */
export function searchShortestWin(engine: GameEngine, options: SearchOptions = {}): SearchWin | null {
  const cap = options.stateCap ?? DEFAULT_SEARCH_STATE_CAP;
  const accept = options.accept ?? (() => true);
  const seen = new Set<string>([searchStateKey(engine)]);
  const nodes: Array<{ state: UndoSnapshot; parent: number; action: SearchAction | null }> = [
    { state: engine.captureState(), parent: -1, action: null }
  ];
  const pathTo = (index: number, last: SearchAction): SearchAction[] => {
    const path: SearchAction[] = [last];
    for (let n = index; nodes[n].parent >= 0; n = nodes[n].parent) path.unshift(nodes[n].action as SearchAction);
    return path;
  };
  for (let head = 0; head < nodes.length; head++) {
    engine.restoreState(nodes[head].state);
    const actions = searchActions(engine, options.allowDrops ?? true);
    for (const action of actions) {
      engine.restoreState(nodes[head].state);
      if (!applySearchAction(engine, action)) continue;
      if (isWin(engine, accept)) {
        const path = pathTo(head, action);
        return { length: path.length, actions: path };
      }
      if (engine.isLevelCompleted()) continue;
      const id = searchStateKey(engine);
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > cap) throw new Error(`search exceeded ${cap} states`);
      nodes.push({ state: engine.captureState(), parent: head, action });
    }
  }
  return null;
}

/** Whether any state reachable from the engine's current one wins; see `searchShortestWin`. */
export function searchCanWin(engine: GameEngine, options: SearchOptions = {}): boolean {
  return searchShortestWin(engine, options) !== null;
}
