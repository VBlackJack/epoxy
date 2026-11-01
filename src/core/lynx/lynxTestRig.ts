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

import { VisualEventKind } from '../PlayEngine';
import { CompiledLevel, Direction, PlayerState, RuntimeEntity } from '../types';
import { LynxEngine } from './LynxEngine';
import { ReplayOptions } from './worldBuilder';
import { RuleModule } from './ruleApi';

/** A visual event the engine emitted. */
export interface RecordedVisual {
  kind: VisualEventKind;
  x: number;
  y: number;
  colorKey?: string;
}

export interface RigOptions {
  seed?: number;
  replay?: ReplayOptions;
  modules?: readonly RuleModule[];
}

/**
 * Drives a LynxEngine tick by tick in tests and records what it emits. Tick
 * numbers follow the spec: "after tick k" is the state once getTick() reads k + 1.
 */
export class LynxRig {
  public readonly engine: LynxEngine;
  public readonly visuals: RecordedVisual[] = [];
  public readonly sounds: string[] = [];
  /** The terrain key of every footstep played (null for a plain step). */
  public readonly steps: Array<string | null> = [];
  public wins: Array<{ levelId: string; time: number; steps: number; score: number; moves: Direction[] }> = [];
  private held: Direction | null = null;

  constructor(
    public readonly level: CompiledLevel,
    options: RigOptions = {}
  ) {
    this.engine = new LynxEngine(
      { effect: (id) => this.sounds.push(id), step: (terrain) => this.steps.push(terrain) },
      options.modules
    );
    this.engine.setOnVisualEventCallback((kind, x, y, colorKey) => this.visuals.push({ kind, x, y, colorKey }));
    this.engine.setOnWinCallback((levelId, time, steps, score, moves) =>
      this.wins.push({ levelId, time, steps, score, moves })
    );
    if (options.replay) this.engine.setReplayOptions(options.replay);
    this.engine.loadLevel(level, options.seed);
  }

  /** One attemptPlayerMove call now, just before the next tick. */
  public press(dir: Direction): boolean {
    return this.engine.attemptPlayerMove(dir);
  }

  /** From now on, the direction counts as held down before every tick (no press is made). */
  public hold(dir: Direction): void {
    this.held = dir;
  }

  public release(): void {
    this.held = null;
    this.engine.holdPlayerDirection(null);
  }

  /** Plays `count` ticks (one by default). */
  public tick(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.engine.holdPlayerDirection(this.held);
      this.engine.tick();
    }
  }

  /** Plays ticks until the state is "after tick k". */
  public afterTick(k: number): void {
    const target = k + 1;
    if (this.engine.getTick() > target) throw new Error(`Tick ${k} is already past`);
    this.tick(target - this.engine.getTick());
  }

  public get player(): PlayerState {
    return this.engine.getPlayer();
  }

  public get entities(): RuntimeEntity[] {
    return this.engine.getEntities();
  }

  public entityAt(x: number, y: number): RuntimeEntity | undefined {
    return this.entities.find((e) => e.x === x && e.y === y);
  }

  public visualsOf(kind: VisualEventKind): RecordedVisual[] {
    return this.visuals.filter((v) => v.kind === kind);
  }

  public soundCount(id: string): number {
    return this.sounds.filter((s) => s === id).length;
  }
}
