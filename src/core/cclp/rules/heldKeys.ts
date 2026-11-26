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

import { HeldKeysDecision, RuleContext, RuleModule } from '../../lynx/ruleApi';
import { Creature } from '../../lynx/model';
import { Direction } from '../../types';

/** The horizontal keys: with no reason to prefer either key, the horizontal one decides. */
const HORIZONTAL_KEYS: readonly Direction[] = ['E', 'W'];

/**
 * Two keys held at once, as the Lynx game decides them (Tile World's Lynx rules, described by Lexy's Labyrinth
 * make_player_decision). The core probes both directions the way Chip's decision probes a step (`open`): when both are open
 * and one is Chip's facing he keeps it, when one only is open he takes it, otherwise the horizontal key decides. The block
 * on the side of the other key is pushed too ("slap"), Chip staying where his own decision takes him.
 */
export function decideHeldKeys(
  _ctx: RuleContext,
  chip: Creature,
  keys: readonly Direction[],
  open: readonly boolean[]
): HeldKeysDecision | null {
  const [first, second] = keys;
  if (first === undefined || second === undefined) return null;
  const firstOpen = open[0] === true;
  const secondOpen = open[1] === true;
  let dir: Direction;
  if (firstOpen && secondOpen && (first === chip.dir || second === chip.dir)) dir = chip.dir;
  else if (firstOpen !== secondOpen) dir = firstOpen ? first : second;
  else dir = HORIZONTAL_KEYS.includes(first) ? first : second;
  return { dir, slap: dir === first ? second : first };
}

export const heldKeyRules: RuleModule = {
  name: 'cclpHeldKeys',
  resolveHeldKeys: decideHeldKeys
};
