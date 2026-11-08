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

import { CompiledLevel } from '../types';
import { LynxEngine, SoundPlayer } from '../lynx/LynxEngine';
import { LYNX_RULE_MODULES } from '../lynx/rules';
import { CC2_RULE_MODULES } from './rules';
import { ICE_BLOCK } from './rules/iceBlocks';

/** Entity ids the Lynx world builder leaves out and a CC2 module places itself: they are played, not unsupported. */
const MODULE_PLACED_ENTITIES: readonly string[] = [ICE_BLOCK];

/**
 * The Chip's Challenge 2 rules for the replay harness: the frozen Lynx engine
 * with the CC2 rule modules added through its constructor. Nothing of the Lynx
 * folder is changed. It is not a ruleset of its own: only the CC2 replay check
 * builds it. Undo is refused: a rule module (the stopwatches) changes the time
 * limit of the level, which an undo snapshot of the world does not restore.
 */
export class Cc2Engine extends LynxEngine {
  constructor(sound?: SoundPlayer) {
    super(sound, [...LYNX_RULE_MODULES, ...CC2_RULE_MODULES]);
  }

  public override canUndo(): boolean {
    return false;
  }

  public override undo(): boolean {
    return false;
  }

  /** The ids played as walls or left out, without the entities a CC2 module places itself. */
  public override getUnsupportedTiles(): string[] {
    return super.getUnsupportedTiles().filter((id) => !MODULE_PLACED_ENTITIES.includes(id));
  }

  /** Plays a copy of the level: a rule module may change its time limit (stopwatches), never the caller's level. */
  public override loadLevel(level: CompiledLevel, seed?: number): void {
    super.loadLevel({ ...level }, seed);
  }
}

export function createCc2Engine(sound?: SoundPlayer): Cc2Engine {
  return new Cc2Engine(sound);
}
