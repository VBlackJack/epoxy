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
  AudioManager: { playSfx: vi.fn() }
}));

import { GameEngine } from './GameEngine';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, LevelBlueprint } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import showcase from '../test/fixtures/mechanicsShowcase.json';

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

function compileShowcase(): CompiledLevel {
  const blueprint = (showcase as { levels: LevelBlueprint[] }).levels[0];
  return ConfigRegistry.compileBlueprint(blueprint);
}

/**
 * The hand-made level that shows every mechanic of the drop, barrier, thief,
 * turtle, thin wall, colour teleport, flame jet and bonus item set. It is
 * also the pack to import in the running game to see them drawn.
 */
describe('mechanics showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('passes the editor validator', () => {
    const report = LevelValidator.validate(compileShowcase());
    expect(report.issues.map((i) => i.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('compiles at its own size with every tile resolved', () => {
    const level = compileShowcase();
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    expect(level.terrain).toHaveLength(11);
    expect(level.terrain[0]).toHaveLength(21);
    const ids = new Set(level.terrain.flat());
    for (const id of ids) {
      expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
    for (const id of level.items.flat()) {
      if (id) expect(ConfigRegistry.getTile(id).id, id).toBe(id);
    }
  });

  it('plays through to the exit, using every mechanic on the way', () => {
    const engine = new GameEngine();
    engine.loadLevel(compileShowcase());

    // The red key, then its barrier: the key must be put down to pass.
    walk(engine, 'EE');
    expect(engine.getPlayer().keys.key_red).toBe(1);
    walk(engine, 'E');
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.forbidden_item');
    expect(engine.dropItem('key_red')).toBe(true);
    walk(engine, 'EEE');
    expect(engine.getPlayer().keys.key_blue).toBe(1);
    walk(engine, 'WWW');
    expect(engine.getPlayer().keys.key_red).toBe(1);
    walk(engine, 'WWW');

    // The blue door, the bonus room, a blue teleport hop and the time penalty.
    walk(engine, 'SS');
    expect(engine.getTerrain()[3][1]).toBe('floor');
    walk(engine, 'SES');
    expect(engine.getLevelScoreMultiplier()).toBe(2);
    walk(engine, 'EEEE');
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 6 });
    walk(engine, 'EEEE');
    expect(engine.getExtraTimeSeconds()).toBe(-10);
    walk(engine, 'ENN');
    expect(engine.getPlayer().keys.key_yellow).toBe(1);

    // Thin panels close the room from above except at x = 1 and x = 5.
    walk(engine, 'WWWWWWNE');
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 3 });
    expect(step(engine, 'S')).toBe(false);
    walk(engine, 'EEEEEE');
    expect(engine.getTerrain()[3][8]).toBe('floor');

    // Turtles sink behind the player, the thief takes the keys, the button swaps the jets.
    walk(engine, 'EE');
    expect(engine.getTerrain()[3][9]).toBe('water');
    walk(engine, 'E');
    expect(engine.getTerrain()[3][10]).toBe('water');
    expect(Object.values(engine.getPlayer().keys).some((count) => count > 0)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole_keys');
    walk(engine, 'E');
    expect(engine.getTerrain()[3][13]).toBe('flame_jet_off');
    expect(engine.getTerrain()[9][17]).toBe('flame_jet_on');
    walk(engine, 'EE');
    expect(engine.getLevelBonusPoints()).toBe(100);
    expect(engine.getTotalScore()).toBe(0);
    walk(engine, 'E');
    expect(engine.getExtraTimeSeconds()).toBe(0);

    // The red teleport lands next to its twin, far from the blue pair.
    walk(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: 18, y: 7 });
    walk(engine, 'SSE');
    expect(engine.isLevelCompleted()).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
    const timing = ConfigRegistry.getGame().timing;
    expect(engine.getLastLevelScore()).toBe((timing.levelBasePoints + engine.getLastTimeBonus() + 100) * 2);
    expect(engine.getTotalScore()).toBe(engine.getLastLevelScore());
  });
});
