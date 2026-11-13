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

/** The engine surface that accepts every held direction at once, most recent first. */
export interface HeldMoveEngine {
  attemptPlayerMoveHeld(dirs: readonly Direction[]): boolean;
}

/** True when the engine takes the whole held set (two-key rules); a plain engine only takes one direction. */
export function supportsHeldMove<T extends object>(engine: T): engine is T & HeldMoveEngine {
  return typeof (engine as { attemptPlayerMoveHeld?: unknown }).attemptPlayerMoveHeld === 'function';
}

interface HeldKey {
  code: string;
  dir: Direction;
}

/** The direction keys currently down, in press order, tracked by physical key code. */
export class HeldKeys {
  private keys: HeldKey[] = [];

  /** Records a press. A code already held (key auto-repeat) keeps its place in the order. */
  press(code: string, dir: Direction): void {
    if (this.has(code)) return;
    this.keys.push({ code, dir });
  }

  /** Records a release; true when the code was held. */
  release(code: string): boolean {
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => k.code !== code);
    return this.keys.length !== before;
  }

  has(code: string): boolean {
    return this.keys.some((k) => k.code === code);
  }

  clear(): void {
    this.keys = [];
  }

  /** Distinct held directions, most recent press first. */
  directions(): Direction[] {
    const out: Direction[] = [];
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const dir = this.keys[i].dir;
      if (!out.includes(dir)) out.push(dir);
    }
    return out;
  }

  /** The most recently pressed held direction, or null. */
  current(): Direction | null {
    return this.keys.length > 0 ? this.keys[this.keys.length - 1].dir : null;
  }
}
