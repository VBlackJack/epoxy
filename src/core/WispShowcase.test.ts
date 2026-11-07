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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { decodeActions, PieceSolver } from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import wispShowcase from '../test/fixtures/wispShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, LevelBlueprint } from './types';

/** Index of the only level of the wisp showcase pack: the corridor the wisp sweeps across. */
const CORRIDOR_LEVEL_INDEX = 0;
const WISP = 'wisp';
/** The walk that never waits: it runs into the wisp where it crosses the corridor. */
const HASTY_WALK = 'EEEEEEEE';

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((wispShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

describe('wisp showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no validator issue and an open way to the exit', () => {
    const level = compileShowcase(CORRIDOR_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.issues.map((issue) => issue.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('starts the wisp inside a wall, where no ordinary monster could stand', () => {
    const level = compileShowcase(CORRIDOR_LEVEL_INDEX);
    const wisp = level.entities.find((entity) => entity.type === WISP);
    expect(wisp).toBeDefined();
    expect(ConfigRegistry.getTile(level.terrain[wisp?.y ?? 0][wisp?.x ?? 0]).passableByMonster).toBe(false);
  });

  it('carries a stored solution that waits for the wisp to pass and wins', () => {
    expect(storedSolutionWins(compileShowcase(CORRIDOR_LEVEL_INDEX))).toBe(true);
  });

  it('kills a player who walks straight on without waiting', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(CORRIDOR_LEVEL_INDEX));
    for (const action of decodeActions(HASTY_WALK)) {
      PieceSolver.play(engine, action);
      if (!engine.getPlayer().alive) break;
    }
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.isLevelCompleted()).toBe(false);
  });
});
