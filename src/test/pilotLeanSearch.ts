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

/**
 * Compact visited-set key: two independent 53-bit hashes of the state key joined into one string
 * (about 106 bits), so the set holds short strings instead of whole state keys.
 */
function hashKey(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  let c2 = 0x9e3779b9;
  let d = 0x7f4a7c15 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
    c2 = Math.imul(c2 ^ (c + 31), 0xcc9e2d51);
    c2 = (c2 << 15) | (c2 >>> 17);
    d = Math.imul(d + c * 131, 0x1b873593) ^ (d >>> 11);
  }
  return `${(a >>> 0) * 0x200000 + (b >>> 11)}.${(c2 >>> 0) * 0x200000 + (d >>> 11)}`;
}

/**
 * Breadth-first search like `searchShortestWin`, built for rooms with several blocks: it keeps a
 * compact hash of every visited state instead of a snapshot per node, holds snapshots for the
 * current and the next layer only, and rebuilds the winning path from compact parent records.
 * Two distinct states could in theory share the hash, and a collision hides the second state: it
 * could turn a real win into a missing one (a false null) or lengthen a shortest win. With about
 * 106 hash bits the chance is about 10^-18 for an ideal hash at twelve million states, far under any other risk.
 */
export function searchShortestWinLean(engine: GameEngine, options: LeanSearchOptions = {}): SearchWin | null {
  const cap = options.stateCap ?? LEAN_SEARCH_STATE_CAP;
  const accept = options.accept ?? (() => true);
  const allowDrops = options.allowDrops ?? true;
  const seen = new Set<string>([hashKey(searchStateKey(engine))]);
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
