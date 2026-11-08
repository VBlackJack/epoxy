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

/**
 * Proof that chain pushing leaves the bundled levels as they were: every stored solution of every bundled pack
 * (campaign, pilot, citadel, excavation, tutorial and the showcase packs) is replayed, and none of them moves
 * two blocks with one push. A solution that chained would have been refused before this rule existed.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { timedSolution } from '../../generator/SolutionReplay';
import { collectDueMoves } from '../../ui/replaySchedule';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, LevelBlueprint } from '../types';

/** Every showcase fixture pack, found by name so that a new one is covered without editing this file. */
const SHOWCASE_PACKS = Object.values(
  import.meta.glob<{ levels: LevelBlueprint[] }>('../../test/fixtures/*Showcase.json', { eager: true, import: 'default' })
);
/** Rulesets the native Epoxy engine does not play. */
const OTHER_ENGINE_RULESETS: readonly string[] = ['lynx', 'cc3d', 'cc2'];
/** Upper bound on ticks of one replay, as in the simulation golden helper. */
const MAX_REPLAY_TICKS = 200000;
const REPLAY_TIMEOUT_MS = 300_000;

function bundledLevels(): CompiledLevel[] {
  const showcases = SHOWCASE_PACKS.flatMap((pack) =>
    pack.levels.map((blueprint) => ConfigRegistry.compileBlueprint(blueprint))
  );
  const all = [
    ...ConfigRegistry.getLevels(),
    ...ConfigRegistry.getPilotLevels(),
    ...ConfigRegistry.getCitadelLevels(),
    ...ConfigRegistry.getExcavationLevels(),
    ...ConfigRegistry.getTutorialLevels(),
    ...showcases
  ];
  const seen = new Set<string>();
  return all.filter((level) => {
    if (OTHER_ENGINE_RULESETS.includes(level.ruleset ?? 'epoxy') || seen.has(level.id)) return false;
    seen.add(level.id);
    return true;
  });
}

describe('chain pushing on the bundled levels', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it(
    'is never used by a stored solution, and every stored solution is still won',
    () => {
      const levels = bundledLevels();
      expect(levels.length).toBeGreaterThan(0);
      expect(SHOWCASE_PACKS.length).toBeGreaterThanOrEqual(9);
      let replayed = 0;
      for (const level of levels) {
        const moves = timedSolution(level);
        if (moves === null) continue;
        replayed++;
        const engine = new GameEngine();
        engine.loadLevel(level);
        let index = 0;
        for (let i = 0; i < MAX_REPLAY_TICKS && !engine.isLevelCompleted(); i++) {
          const { due, nextIndex } = collectDueMoves(moves, index, engine.getTick());
          for (const move of due) {
            if (move.drop !== undefined) engine.dropItem(move.drop);
            else engine.attemptPlayerMove(move.dir);
          }
          index = nextIndex;
          engine.tick();
          if (!engine.getPlayer().alive) break;
        }
        expect(engine.isLevelCompleted() && engine.getChipsRemaining() === 0, `${level.id}: stored solution is not won`).toBe(true);
        expect(engine.getChainPushCount(), `${level.id}: stored solution chains blocks`).toBe(0);
      }
      expect(replayed).toBe(bundledLevels().filter((level) => timedSolution(level) !== null).length);
      expect(replayed).toBeGreaterThan(0);
    },
    REPLAY_TIMEOUT_MS
  );
});
