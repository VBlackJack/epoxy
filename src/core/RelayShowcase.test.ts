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
import { PACK_JSON_VERSION_V11 } from '../config/constants';
import { decodeActions, PieceSolver } from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import relayShowcase from '../test/fixtures/relayShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { idSetVersionOf } from './signalLinks';
import type { CompiledLevel, LevelBlueprint } from './types';

/** Index of the only level of the relay showcase pack: a plate wired through a latch to a dark pad, a pad lit as placed, a wall between. */
const PAD_LEVEL_INDEX = 0;
const POWERED_PAD = { x: 5, y: 3 };
const FAR_PAD = { x: 9, y: 3 };
const PLATE_CELL = { x: 2, y: 3 };
const PAD_DARK = 'relay_pad_dark';
const PAD_LIT = 'relay_pad_lit';
/** The walk of the stored solution: onto the plate, along to the pad, out of the far pad and to the exit. */
const FULL_WALK = 'EEEEE';
/** Onto the plate, then back off it: the latch keeps the pad lit after the release. */
const ON_PLATE_WALK = 'E';
const OFF_PLATE_WALK = 'W';

function walk(engine: GameEngine, text: string): void {
  for (const action of decodeActions(text)) PieceSolver.play(engine, action);
}

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((relayShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

describe('relay pad showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no validator issue and an open way to the exit', () => {
    const level = compileShowcase(PAD_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain[POWERED_PAD.y][POWERED_PAD.x]).toBe(PAD_DARK);
    expect(level.terrain[FAR_PAD.y][FAR_PAD.x]).toBe(PAD_LIT);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.issues.map((issue) => issue.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('carries a stored solution that wins, and fails once the wire is cut', () => {
    const level = compileShowcase(PAD_LEVEL_INDEX);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins({ ...level, signalLinks: [] })).toBe(false);
  });

  it('lights the pad on the first press of the plate and keeps it lit after the release', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(PAD_LEVEL_INDEX));
    expect(engine.getTerrain()[POWERED_PAD.y][POWERED_PAD.x]).toBe(PAD_DARK);
    walk(engine, ON_PLATE_WALK);
    expect(engine.getPlayer().x).toBe(PLATE_CELL.x);
    expect(engine.getTerrain()[POWERED_PAD.y][POWERED_PAD.x]).toBe(PAD_LIT);
    walk(engine, OFF_PLATE_WALK);
    expect(engine.getPlayer().x).toBe(PLATE_CELL.x - 1);
    expect(engine.getTerrain()[POWERED_PAD.y][POWERED_PAD.x]).toBe(PAD_LIT);
    const full = new GameEngine();
    full.loadLevel(compileShowcase(PAD_LEVEL_INDEX));
    walk(full, FULL_WALK);
    expect(full.isLevelCompleted()).toBe(true);
  });

  it('needs the relay pack format, read from its ids', () => {
    expect(idSetVersionOf(compileShowcase(PAD_LEVEL_INDEX))).toBe(PACK_JSON_VERSION_V11);
  });
});
