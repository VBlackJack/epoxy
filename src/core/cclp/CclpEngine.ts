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

import { LynxEngine, SoundPlayer } from '../lynx/LynxEngine';
import { LYNX_RULE_MODULES } from '../lynx/rules';
import { RuleModule } from '../lynx/ruleApi';
import { OPPOSITE_DIRECTION } from '../coreConstants';
import { Direction } from '../types';
import { heldKeyRules } from './rules/heldKeys';

/** The modules the CCLP rules add to the Lynx ones. */
export const CCLP_RULE_MODULES: readonly RuleModule[] = [heldKeyRules];

/**
 * The rules of every non-official CC1 .DAT, bundled or imported (the CCLP packs among them; levels with ruleset 'lynx' and rulesProfile 'cclp'): the frozen Lynx
 * engine with the CCLP modules added through its constructor, as Cc2Engine does. Nothing of the Lynx folder is changed here.
 */
export class CclpEngine extends LynxEngine {
  /** `extraModules`: rule modules added after the CCLP ones (the monster watch's private copy taps the simulation with one). */
  constructor(sound?: SoundPlayer, extraModules: readonly RuleModule[] = []) {
    super(sound, [...LYNX_RULE_MODULES, ...CCLP_RULE_MODULES, ...extraModules]);
  }

  /** Lynx reads no direction at all from an opposing pair or from three keys or more (Lexy _extract_player_directions). */
  public override holdPlayerDirections(dirs: readonly Direction[]): void {
    super.holdPlayerDirections(cancelsDirections(dirs) ? [] : dirs);
  }

  /** A press of an opposing pair or of three keys or more is no move. */
  public override attemptPlayerMoveHeld(dirs: readonly Direction[]): boolean {
    return cancelsDirections(dirs) ? false : super.attemptPlayerMoveHeld(dirs);
  }
}

/** The most keys Lynx reads at once. */
const MAX_READ_KEYS = 2;

/** True for held keys that give no direction: an opposing pair among them, or more than two distinct keys. */
export function cancelsDirections(dirs: readonly Direction[]): boolean {
  const keys = [...new Set(dirs)];
  return keys.length > MAX_READ_KEYS || keys.some((d) => keys.includes(OPPOSITE_DIRECTION[d]));
}
