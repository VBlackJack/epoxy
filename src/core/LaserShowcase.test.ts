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

import { GameEngine } from './GameEngine';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, LevelBlueprint } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import showcase from '../test/fixtures/laserShowcase.json';

/** Ticks run before each move so the player's move cooldown has elapsed. */
const COOLDOWN_TICKS = 20;
/** Ticks run after the last move so a pushed mirror and the gates settle. */
const SETTLE_TICKS = 40;

/** Solutions of the two levels, one letter per step. */
const LEVEL_1_SOLUTION = 'EEEEEEESSSWWWNSS';
const LEVEL_2_SOLUTION = 'EEEENENNNNEEE';
/** Straight into the beam of level 2: east, then north up to the emitter row. */
const LEVEL_2_BEAM_WALK = 'ENN';

function step(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

function walk(engine: GameEngine, path: string): void {
  for (const ch of path) {
    expect(step(engine, ch as Direction), `move ${ch} at (${engine.getPlayer().x}, ${engine.getPlayer().y})`).toBe(true);
  }
}

function settle(engine: GameEngine): void {
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

function compileLevel(index: number): CompiledLevel {
  const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[index];
  return ConfigRegistry.compileBlueprint(blueprint);
}

/**
 * The two hand-made levels of the laser, mirror, receiver and laser gate set.
 * It is also the pack to import in the running game to see them drawn.
 */
describe('laser showcase pack', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each([0, 1])('level %i passes the editor validator and compiles at its own size', (index) => {
    const level = compileLevel(index);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    for (const id of new Set(level.terrain.flat())) {
      expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
  });

  it('level 1 lights both receivers once both mirrors are in their beams', () => {
    const level = compileLevel(0);
    expect(level.winRule).toBe('receivers');
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(engine.isLevelCompleted()).toBe(false);
    walk(engine, LEVEL_1_SOLUTION);
    settle(engine);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('level 1 does not complete with only one mirror in place', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileLevel(0));
    walk(engine, LEVEL_1_SOLUTION.slice(0, -1));
    settle(engine);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('level 2 opens its gate with one mirror and leads to the exit', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileLevel(1));
    walk(engine, LEVEL_2_SOLUTION);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('level 2 kills a player who walks straight into the beam', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileLevel(1));
    walk(engine, LEVEL_2_BEAM_WALK);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
    expect(engine.isLevelCompleted()).toBe(false);
  });
});
