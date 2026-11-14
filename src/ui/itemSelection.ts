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

import { BRIBE_ITEM_ID, THIEF_PAYMENT_ITEM_IDS } from '../core/coreConstants';

/**
 * The engine's tool belt, oldest first, or undefined when the engine has none (the PlayEngine interface does not declare
 * it: only the Epoxy engine has a belt, and only on a CC2-engine level).
 */
export function engineToolBelt(engine: object): readonly string[] | undefined {
  const reader = (engine as { getToolBelt?: () => readonly string[] | undefined }).getToolBelt;
  return typeof reader === 'function' ? reader.call(engine) : undefined;
}

/**
 * True when the cycle and drop keys may select the item. A toll token is never set down. The bribe is set down only on a
 * tool-belt level (a CC2-engine level, where the engine passes its belt); elsewhere it is a payment like the token.
 */
export function isItemSelectable(itemId: string, belt: readonly string[] | undefined): boolean {
  if (!THIEF_PAYMENT_ITEM_IDS.has(itemId)) return true;
  return belt !== undefined && itemId === BRIBE_ITEM_ID;
}

/**
 * The ids the cycle key walks, in order: the keys, then the boots. On a tool-belt level the belt tools come first among the
 * boots, oldest first, so the cycle follows the belt the engine drops from. `belt` is undefined off a belt level.
 */
export function selectableItemOrder(
  keyIds: readonly string[],
  bootIds: readonly string[],
  belt: readonly string[] | undefined
): string[] {
  const ordered = belt === undefined ? [...keyIds, ...bootIds] : [...keyIds, ...belt, ...bootIds];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of ordered) {
    if (seen.has(id) || !isItemSelectable(id, belt)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}
