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

import { GameEngine } from './GameEngine';
import { LynxEngine } from './lynx/LynxEngine';
import { PlayEngine, VisualEventCallback, WinCallback } from './PlayEngine';
import { CompiledLevel } from './types';

/**
 * Holds one engine per ruleset and hands out the one a level asks for. The
 * Lynx engine is only built when a Lynx level is first played. The callbacks
 * are given once and reach whichever engine is running, and the total score
 * runs on when the page moves from one engine to the other.
 */
export class EngineSelector {
  private readonly epoxy = new GameEngine();
  private lynx: LynxEngine | null = null;
  private active: PlayEngine = this.epoxy;
  private winCallback: WinCallback | null = null;
  private visualCallback: VisualEventCallback | null = null;

  /** The engine of the level played last. */
  public get current(): PlayEngine {
    return this.active;
  }

  public setOnWinCallback(cb: WinCallback): void {
    this.winCallback = cb;
    this.epoxy.setOnWinCallback(cb);
    this.lynx?.setOnWinCallback(cb);
  }

  public setOnVisualEventCallback(cb: VisualEventCallback): void {
    this.visualCallback = cb;
    this.epoxy.setOnVisualEventCallback(cb);
    this.lynx?.setOnVisualEventCallback(cb);
  }

  /** The engine that plays the level; it becomes the current one. */
  public forLevel(level: Pick<CompiledLevel, 'ruleset'>): PlayEngine {
    const next: PlayEngine = level.ruleset === 'lynx' ? this.lynxEngine() : this.epoxy;
    if (next !== this.active) {
      next.carryTotalScore(this.active.getTotalScore());
      this.active = next;
    }
    return next;
  }

  private lynxEngine(): LynxEngine {
    if (this.lynx === null) {
      this.lynx = new LynxEngine();
      if (this.winCallback) this.lynx.setOnWinCallback(this.winCallback);
      if (this.visualCallback) this.lynx.setOnVisualEventCallback(this.visualCallback);
    }
    return this.lynx;
  }
}
