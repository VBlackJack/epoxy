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
import { applySearchAction, searchActions, searchStateKey, SearchAction, SearchWin } from './pilotSearch';

/** States a lean search may visit before it gives up by throwing. */
export const LEAN_SEARCH_STATE_CAP = 12000000;

export interface LeanSearchOptions {
  stateCap?: number;
  allowDrops?: boolean;
  /** Rejects a win by its final state. */
  accept?: (engine: GameEngine) => boolean;
  /** Searches for the first state satisfying this instead of a win (the level may be left unfinished). */
  goal?: (engine: GameEngine) => boolean;
  /** Called after each layer with its depth, size and the states seen so far. */
  onLayer?: (depth: number, size: number, seen: number) => void;
}

/** 53-bit hash of a state key (two independent 32-bit string hashes), so the visited set holds numbers, not strings. */
function hashKey(text: string): number {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0) * 0x200000 + (b >>> 11);
}

/**
 * Breadth-first search like `searchShortestWin`, built for rooms with several blocks: it keeps a
 * 53-bit hash of every visited state instead of a snapshot per node, holds snapshots for the
 * current and the next layer only, and rebuilds the winning path from compact parent records.
 * Two distinct states can in theory share a hash; the chance is negligible below the state cap
 * (about 10^-3 at twelve million states) and a collision could only hide a state, never invent a win.
 */
export function searchShortestWinLean(engine: GameEngine, options: LeanSearchOptions = {}): SearchWin | null {
  const cap = options.stateCap ?? LEAN_SEARCH_STATE_CAP;
  const accept = options.accept ?? (() => true);
  const allowDrops = options.allowDrops ?? true;
  const seen = new Set<number>([hashKey(searchStateKey(engine))]);
  const parents: number[] = [-1];
  const actionsTaken: Array<SearchAction | null> = [null];
  let layer: Array<{ state: UndoSnapshot; node: number }> = [{ state: engine.captureState(), node: 0 }];
  const pathTo = (node: number, last: SearchAction): SearchAction[] => {
    const path: SearchAction[] = [last];
    for (let n = node; parents[n] >= 0; n = parents[n]) path.unshift(actionsTaken[n] as SearchAction);
    return path;
  };
  let depth = 0;
  while (layer.length > 0) {
    options.onLayer?.(depth++, layer.length, seen.size);
    const next: Array<{ state: UndoSnapshot; node: number }> = [];
    for (const { state, node } of layer) {
      engine.restoreState(state);
      const actions = searchActions(engine, allowDrops);
      for (const action of actions) {
        engine.restoreState(state);
        if (!applySearchAction(engine, action)) continue;
        const reached = options.goal ? options.goal(engine) : engine.isLevelCompleted() && engine.getChipsRemaining() === 0 && accept(engine);
        if (reached) {
          const path = pathTo(node, action);
          return { length: path.length, actions: path };
        }
        if (engine.isLevelCompleted()) continue;
        const id = hashKey(searchStateKey(engine));
        if (seen.has(id)) continue;
        seen.add(id);
        if (seen.size > cap) throw new Error(`search exceeded ${cap} states`);
        parents.push(node);
        actionsTaken.push(action);
        next.push({ state: engine.captureState(), node: parents.length - 1 });
      }
    }
    layer = next;
  }
  return null;
}
