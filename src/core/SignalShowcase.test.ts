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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn(), runSilently: <T>(task: () => T): T => task() }
}));

import { GameEngine } from './GameEngine';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, LevelBlueprint } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import signalShowcase from '../test/fixtures/signalShowcase.json';
import { storedSolutionWins } from '../generator/SolutionReplay';

/** Ticks the move cooldown away, then plays one step and reports whether it was taken. */
function step(engine: GameEngine, dir: Direction): boolean {
  const cooldownTicks = 20;
  for (let i = 0; i < cooldownTicks; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

function walk(engine: GameEngine, path: string): void {
  for (const ch of path) {
    expect(step(engine, ch as Direction), `move ${ch} at (${engine.getPlayer().x}, ${engine.getPlayer().y})`).toBe(true);
  }
}

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((signalShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

/** Indexes of the two signal levels in the signal showcase pack: the logic gate level, then the pulse signals level. */
const GATES_LEVEL_INDEX = 0;
const PULSE_LEVEL_INDEX = 1;
/** The gate level: the plate cells, and the hold door they open through the AND gate. */
const GATE_PLATE_CELLS = [
  { x: 5, y: 2 },
  { x: 5, y: 4 }
];
const GATE_DOOR_CELL = { x: 8, y: 3 };
const PULSE_LATCH_DOOR_CELL = { x: 8, y: 2 };

describe('signal gates showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('wires two plates through an AND gate to a hold door, with no validator issue', () => {
    const level = compileShowcase(GATES_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain.flat()).toEqual(expect.arrayContaining(['signal_plate', 'signal_gate_and', 'hold_door_red_closed']));
    expect(level.signalLinks).toHaveLength(3);
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('opens the door only once both plates carry a block', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(GATES_LEVEL_INDEX));
    expect(engine.getTerrain()[GATE_DOOR_CELL.y][GATE_DOOR_CELL.x]).toBe('hold_door_red_closed');
    walk(engine, 'NEEE');
    expect(engine.getEntities().find((e) => e.x === GATE_PLATE_CELLS[0].x && e.y === GATE_PLATE_CELLS[0].y)).toBeDefined();
    expect(engine.getTerrain()[GATE_DOOR_CELL.y][GATE_DOOR_CELL.x]).toBe('hold_door_red_closed');
    walk(engine, 'WWSSEE');
    expect(engine.getTerrain()[GATE_DOOR_CELL.y][GATE_DOOR_CELL.x]).toBe('hold_door_red_open');
    walk(engine, 'NEEEEEE');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('carries a stored solution that wins, and fails once the gate is unwired', () => {
    const level = compileShowcase(GATES_LEVEL_INDEX);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins({ ...level, signalLinks: [] })).toBe(false);
  });
});

describe('pulse signals showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('uses a pulse button, a latch, a plate, a launcher and a clone machine, with no validator issue', () => {
    const level = compileShowcase(PULSE_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain.flat()).toEqual(
      expect.arrayContaining(['signal_button', 'signal_latch_off', 'signal_plate', 'shot_launcher_e', 'clone_machine'])
    );
    expect(level.signalLinks).toHaveLength(5);
    const report = LevelValidator.validate(level);
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('flips the latch on a pulse press and keeps the door open after leaving the button', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase(PULSE_LEVEL_INDEX));
    expect(engine.getTerrain()[PULSE_LATCH_DOOR_CELL.y][PULSE_LATCH_DOOR_CELL.x]).toBe('hold_door_red_closed');
    walk(engine, 'NEE');
    walk(engine, 'EE');
    expect(engine.getTerrain()[PULSE_LATCH_DOOR_CELL.y][PULSE_LATCH_DOOR_CELL.x]).toBe('hold_door_red_open');
  });

  it('carries a stored solution that wins, and fails once the signals are unwired', () => {
    const level = compileShowcase(PULSE_LEVEL_INDEX);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins({ ...level, signalLinks: [] })).toBe(false);
  });
});
