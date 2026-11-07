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
import flipShowcase from '../test/fixtures/flipShowcase.json';
import laserShowcase from '../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../test/fixtures/mechanicsShowcase.json';
import signalShowcase from '../test/fixtures/signalShowcase.json';
import railShowcase from '../test/fixtures/railShowcase.json';
import relayShowcase from '../test/fixtures/relayShowcase.json';
import stoneShowcase from '../test/fixtures/stoneShowcase.json';
import wispShowcase from '../test/fixtures/wispShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { usesFlipSinkFormat } from './signalLinks';
import type { CompiledLevel, LevelBlueprint } from './types';

/** Index of the only level of the flip showcase pack: a plate wired to a closed wall. */
const WALL_LEVEL_INDEX = 0;
const WALL_CELL = { x: 6, y: 3 };
const WALL_CLOSED = 'toggle_wall_closed';
const WALL_OPEN = 'toggle_wall_open';
/** The walk that never stops: it steps on the plate and goes on through the opened wall. */
const FULL_WALK = 'EEEEEEEEE';
/** The walk that steps on the plate, then off it: the release flips nothing. */
const ON_AND_OFF_WALK = 'EEE';

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((flipShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

describe('wired flip showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no validator issue and an open way to the exit', () => {
    const level = compileShowcase(WALL_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain[WALL_CELL.y][WALL_CELL.x]).toBe(WALL_CLOSED);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.issues.map((issue) => issue.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('carries a stored solution that wins, and fails once the wire is cut', () => {
    const level = compileShowcase(WALL_LEVEL_INDEX);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins({ ...level, signalLinks: [] })).toBe(false);
  });

  it('flips the wall on the step onto the plate and leaves it open on release', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(WALL_LEVEL_INDEX));
    for (const action of decodeActions(ON_AND_OFF_WALK)) PieceSolver.play(engine, action);
    expect(engine.getTerrain()[WALL_CELL.y][WALL_CELL.x]).toBe(WALL_OPEN);
    const full = new GameEngine();
    full.loadLevel(compileShowcase(WALL_LEVEL_INDEX));
    for (const action of decodeActions(FULL_WALK)) PieceSolver.play(full, action);
    expect(full.isLevelCompleted()).toBe(true);
  });

  it('needs the flip pack format, and no other shipped level or fixture does', () => {
    expect(usesFlipSinkFormat(compileShowcase(WALL_LEVEL_INDEX))).toBe(true);
    // A link to a flip tile would come back to life on load in a build that drops it today, and change a hash: none exists.
    const others: CompiledLevel[] = [
      ...ConfigRegistry.getLevels(),
      ...ConfigRegistry.getPilotLevels(),
      ...[laserShowcase, mechanicsShowcase, railShowcase, relayShowcase, signalShowcase, stoneShowcase, wispShowcase].flatMap((pack) =>
        (pack as { levels: LevelBlueprint[] }).levels.map((blueprint) => ConfigRegistry.compileBlueprint(blueprint))
      )
    ];
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter((level) => usesFlipSinkFormat(level)).map((level) => level.id)).toEqual([]);
  });
});
