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

import type { Direction } from '../core/types';
import { setToggleState } from './toggleState';

/** The key codes bound to each move direction. */
export interface MoveKeyCodes {
  moveUp: readonly string[];
  moveDown: readonly string[];
  moveLeft: readonly string[];
  moveRight: readonly string[];
}

/** The part of a keyboard event the turn chord reads. */
export interface TurnChord {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * The direction to turn toward for Shift + a move key, or null when the chord is not a turn
 * (the ruleset does not turn in place, Shift is not held, or another command modifier is).
 * It reads the physical key code, so ZQSD and WASD layouts work like the arrows.
 */
export function turnDirectionForChord(chord: TurnChord, keys: MoveKeyCodes, turnInPlace: boolean): Direction | null {
  if (!turnInPlace || !chord.shiftKey || chord.ctrlKey || chord.metaKey || chord.altKey) return null;
  if (keys.moveUp.includes(chord.code)) return 'N';
  if (keys.moveDown.includes(chord.code)) return 'S';
  if (keys.moveLeft.includes(chord.code)) return 'W';
  if (keys.moveRight.includes(chord.code)) return 'E';
  return null;
}

/** Hidden class of the phone strip buttons. */
const HIDDEN_CLASS = 'hidden';

/**
 * Aim mode of the phone strip: while on, a direction input turns the player without stepping.
 * It is only available while the aim button is shown and enabled.
 */
export class AimMode {
  private on = false;

  constructor(private readonly button: HTMLButtonElement | null) {
    this.button?.addEventListener('click', () => this.set(!this.on));
    this.render();
  }

  isOn(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    this.on = on && Boolean(this.button) && !this.button?.disabled;
    this.render();
  }

  /**
   * Shows the button when the level turns in place and has a stone, enables it while one is held,
   * and leaves aim mode when it can no longer be used.
   */
  sync(visible: boolean, holdsStone: boolean): void {
    if (this.button) {
      this.button.classList.toggle(HIDDEN_CLASS, !visible);
      this.button.disabled = !holdsStone;
    }
    if (!visible || !holdsStone) this.on = false;
    this.render();
  }

  private render(): void {
    setToggleState(this.button, this.on);
  }
}
