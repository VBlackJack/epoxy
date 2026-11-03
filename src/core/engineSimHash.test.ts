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
 * Golden check of the native Epoxy engine, to prove that splitting GameEngine into modules changes nothing.
 * Every Epoxy-ruleset level the repository ships (campaign, pilot, the two showcase packs, 20 generated levels
 * with fixed seeds) is played by two scripts (its stored solution, and a fixed scripted play with undo) and the
 * SHA-256 of the state after every tick is hashed. Lynx and CC3D levels are skipped: the engine selector does
 * not route them to GameEngine.
 *
 * When EPOXY_SIM_GOLDEN names a file, the hashes of every level and script must match that file exactly; a
 * missing file fails. The file is only written when EPOXY_SIM_GOLDEN_WRITE=1 is also set, and that must be
 * done on the reference checkout (before the refactor), never on the branch under test. Hashes and ids only.
 * Without EPOXY_SIM_GOLDEN, a quick determinism check hashes the first campaign levels twice, and a guard checks\n * that every stored solution of a campaign or pilot level is won and that the levels without a stored solution\n * (hashed from their initial state only) are exactly the expected ones.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import laserShowcase from '../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../test/fixtures/mechanicsShowcase.json';
import { ENGINE_SCRIPTS, engineSimulationHash, engineSimulationRun } from './engineSimHash';
import { ProceduralGenerator } from './ProceduralGenerator';
import type { CompiledLevel, LevelBlueprint } from './types';

const SIM_GOLDEN_FILE = process.env.EPOXY_SIM_GOLDEN;
const SIM_GOLDEN_WRITE = process.env.EPOXY_SIM_GOLDEN_WRITE === '1';
const GENERATED_LEVEL_COUNT = 20;
const GENERATOR_SEED = 7;
const DETERMINISM_LEVEL_COUNT = 3;
const DETERMINISM_TIMEOUT_MS = 30_000;
const SOLUTION_GUARD_TIMEOUT_MS = 60_000;
const SIMULATION_TIMEOUT_MS = 600_000;
/** Campaign, pilot and showcase levels (not the generated ones) that carry no stored solution: only their initial state is hashed. */
const EXPECTED_NO_SOLUTION_COUNT = 3;
const SKIPPED_RULESETS: readonly string[] = ['lynx', 'cc3d'];

/** Whether the engine selector hands this level to GameEngine. */
function playedByGameEngine(level: CompiledLevel): boolean {
  return !SKIPPED_RULESETS.includes(level.ruleset ?? 'epoxy');
}

function dedupe(levels: readonly CompiledLevel[]): CompiledLevel[] {
  const seen = new Set<string>();
  return levels.filter((level) => {
    if (!playedByGameEngine(level) || seen.has(level.id)) return false;
    seen.add(level.id);
    return true;
  });
}

function campaignAndPilotLevels(): CompiledLevel[] {
  return dedupe([...ConfigRegistry.getLevels(), ...ConfigRegistry.getPilotLevels()]);
}

function showcaseLevels(): CompiledLevel[] {
  return [laserShowcase, mechanicsShowcase].flatMap((pack) =>
    (pack as { levels: LevelBlueprint[] }).levels.map((blueprint) => ConfigRegistry.compileBlueprint(blueprint))
  );
}

function generatedLevels(): CompiledLevel[] {
  return Array.from({ length: GENERATED_LEVEL_COUNT }, (_, index) =>
    ProceduralGenerator.generateLevel(index + 1, GENERATOR_SEED)
  );
}

function collectLevels(): CompiledLevel[] {
  return dedupe([...campaignAndPilotLevels(), ...showcaseLevels(), ...generatedLevels()]);
}

function hashAll(levels: readonly CompiledLevel[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const level of levels) {
    for (const script of ENGINE_SCRIPTS) {
      result[`${level.id}#${script}`] = engineSimulationHash(level, script);
    }
  }
  return result;
}

describe('engine simulation golden', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('hashes the same level twice to the same value', () => {
    const levels = campaignAndPilotLevels().slice(0, DETERMINISM_LEVEL_COUNT);
    expect(levels.length).toBe(DETERMINISM_LEVEL_COUNT);
    expect(hashAll(levels)).toEqual(hashAll(levels));
  }, DETERMINISM_TIMEOUT_MS);

  it('wins every stored solution of a campaign or pilot level and lists the levels without a solution', () => {
    const stored = campaignAndPilotLevels();
    for (const level of stored) {
      const run = engineSimulationRun(level, 'solution');
      if (run.hasSolution) expect(run.won, `${level.id} stored solution is not won`).toBe(true);
    }
    const withoutSolution = [...stored, ...showcaseLevels()]
      .filter((level) => !engineSimulationRun(level, 'solution').hasSolution)
      .map((level) => level.id);
    expect(withoutSolution, `levels hashed from their initial state only: ${withoutSolution.join(', ')}`).toHaveLength(
      EXPECTED_NO_SOLUTION_COUNT
    );
  }, SOLUTION_GUARD_TIMEOUT_MS);

  it.skipIf(!SIM_GOLDEN_FILE)(
    'matches the golden hashes of every level',
    () => {
      const file = SIM_GOLDEN_FILE as string;
      const actual = hashAll(collectLevels());
      if (SIM_GOLDEN_WRITE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(actual, null, 2));
        return;
      }
      expect(existsSync(file), `golden file ${file} is missing`).toBe(true);
      expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    },
    SIMULATION_TIMEOUT_MS
  );
});