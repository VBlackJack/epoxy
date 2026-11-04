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
import { UndoSnapshot } from '../core/types';
import { applySearchAction, DEFAULT_SEARCH_STATE_CAP, searchActions, searchStateKey } from './pilotSearch';

export interface StateGraphOptions {
  /** Most states to discover; exceeding it throws, so a runaway proof fails loudly. */
  stateCap?: number;
  /** Offer the drop of held items as a move; true by default. */
  allowDrops?: boolean;
  /** Also offer the one-tick wait (see `SearchOptions.fineWait`). */
  fineWait?: boolean;
  /**
   * Decides whether a discovered state is expanded further (true by default). A state that is not
   * expanded is still counted and still reported to `onState`, but nothing leaves it.
   */
  expandIf?: (engine: GameEngine) => boolean;
  /** Called once per distinct state, with the engine standing in that state. */
  onState?: (engine: GameEngine) => void;
  /** Called once per dead state (see `StateGraph.dead`), with the engine standing in that state. */
  onDead?: (engine: GameEngine) => void;
  /** Record the breadth-first depth of every state and report `StateGraph.shortestWin`; off by default. */
  trackDepth?: boolean;
}

export interface StateGraph {
  /** Distinct settled states reached, the start included. */
  states: number;
  /** States that were expanded (all of them unless `expandIf` held some back). */
  expanded: number;
  /** States from which some sequence of actions wins (an expanded state with a winning action, or one that leads to such a state). */
  canWin: number;
  /** Expanded states from which no sequence of actions wins: a softlock, for example a closed ice room. */
  dead: number;
  /**
   * With `trackDepth`: the fewest actions of a win, taken from the same breadth-first discovery order, or null when
   * no expanded state wins. Absent otherwise.
   */
  shortestWin?: number | null;
}

/**
 * Explores every state reachable from the engine's current one with the action model and state key
 * of `pilotSearch` (moves, waits, drops), then works out, backwards from the winning actions, which
 * states can still win. The winning step itself leads to no stored state. A death or a refused move
 * is not an edge. States that `expandIf` holds back are left out of the win count and of `dead`.
 * The engine is left in an unspecified state.
 */
export function exploreStateGraph(engine: GameEngine, options: StateGraphOptions = {}): StateGraph {
  const cap = options.stateCap ?? DEFAULT_SEARCH_STATE_CAP;
  const allowDrops = options.allowDrops ?? true;
  const expandIf = options.expandIf ?? (() => true);
  const index = new Map<string, number>();
  const snapshots: UndoSnapshot[] = [];
  const predecessors: number[][] = [];
  const winning: boolean[] = [];
  const expandable: boolean[] = [];
  const depth: number[] = [0];
  let shortestWin: number | null = null;

  const discover = (): number => {
    const key = searchStateKey(engine);
    const known = index.get(key);
    if (known !== undefined) return known;
    if (snapshots.length >= cap) throw new Error(`state graph exceeded ${cap} states`);
    const id = snapshots.length;
    index.set(key, id);
    snapshots.push(engine.captureState());
    predecessors.push([]);
    winning.push(false);
    expandable.push(expandIf(engine));
    options.onState?.(engine);
    return id;
  };

  discover();
  for (let head = 0; head < snapshots.length; head++) {
    if (!expandable[head]) continue;
    const from = snapshots[head];
    engine.restoreState(from);
    const actions = searchActions(engine, allowDrops, options.fineWait ?? false);
    for (const action of actions) {
      engine.restoreState(from);
      if (!applySearchAction(engine, action)) continue;
      if (engine.isLevelCompleted()) {
        if (engine.getChipsRemaining() === 0) {
          winning[head] = true;
          if (shortestWin === null || depth[head] + 1 < shortestWin) shortestWin = depth[head] + 1;
        }
        continue;
      }
      const to = discover();
      if (depth[to] === undefined) depth[to] = depth[head] + 1;
      predecessors[to].push(head);
    }
  }

  const canWin = new Array<boolean>(snapshots.length).fill(false);
  const pending: number[] = [];
  winning.forEach((wins, id) => {
    if (wins) {
      canWin[id] = true;
      pending.push(id);
    }
  });
  for (let head = 0; head < pending.length; head++) {
    for (const before of predecessors[pending[head]]) {
      if (canWin[before]) continue;
      canWin[before] = true;
      pending.push(before);
    }
  }
  const expanded = expandable.filter(Boolean).length;
  const winCount = canWin.filter(Boolean).length;
  const dead = canWin.filter((wins, id) => !wins && expandable[id]).length;
  if (options.onDead) {
    canWin.forEach((wins, id) => {
      if (wins || !expandable[id]) return;
      engine.restoreState(snapshots[id]);
      options.onDead?.(engine);
    });
  }
  return options.trackDepth
    ? { states: snapshots.length, expanded, canWin: winCount, dead, shortestWin }
    : { states: snapshots.length, expanded, canWin: winCount, dead };
}
