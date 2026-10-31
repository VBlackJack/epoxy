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
 * Expands the hand-written campaign routes of tools/campaign-routes.json into
 * winning action strings and writes them to the `solution` of the matching
 * levels in public/configs/levels.json. Literal segments are played as written;
 * "@x,y" segments are found by a search in the real engine. Every expanded
 * route is replayed in a fresh engine before it is written. A level whose
 * route breaks is reported and left unchanged; the run fails at the end.
 *
 * Run with: npm run route:campaign
 * Only one level: EPOXY_ROUTE_LEVEL=epoxy_level_3 npm run route:campaign
 */

/// <reference types="node" />

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { LevelsConfig } from '../src/core/types';
import { CampaignRouteError, expandRoute } from '../src/generator/CampaignRoute';
import { decodeActions } from '../src/generator/PieceSolver';
import { replays } from '../src/test/levelChecks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_FILE = resolve(ROOT, 'tools', 'campaign-routes.json');
const LEVELS_FILE = resolve(ROOT, 'public', 'configs', 'levels.json');
const LEVEL_FILTER_VARIABLE = 'EPOXY_ROUTE_LEVEL';
const JSON_INDENT = 2;

interface CampaignRoutes {
  levels: Record<string, { segments: string[]; requires?: string[] }>;
}

// The report config allows long runs; see vitest.report.config.ts.
it('expands the campaign routes', () => {
  loadTestConfigs();
  const routes = JSON.parse(readFileSync(ROUTES_FILE, 'utf-8')) as CampaignRoutes;
  const levelsConfig = JSON.parse(readFileSync(LEVELS_FILE, 'utf-8')) as LevelsConfig;
  const only = process.env[LEVEL_FILTER_VARIABLE];
  const failures: string[] = [];

  for (const level of ConfigRegistry.getLevels()) {
    if (only && level.id !== only) continue;
    const route = routes.levels[level.id];
    if (!route) {
      failures.push(`${level.id}: no route`);
      console.log(`${level.id}: no route`);
      continue;
    }
    try {
      const result = expandRoute(level, route.segments);
      if (!replays(level, decodeActions(result.solution))) {
        throw new CampaignRouteError(level.id, route.segments.length, level.playerStart, 'the expanded route does not replay');
      }
      const blueprint = levelsConfig.levels.find((bp) => bp.id === level.id);
      expect(blueprint, level.id).toBeDefined();
      (blueprint as { solution?: string }).solution = result.solution;
      console.log(`${level.id}: ${result.moves} moves, ${result.statesExplored} states explored`);
    } catch (error) {
      if (!(error instanceof CampaignRouteError)) throw error;
      failures.push(error.message);
      console.log(`${level.id}: FAILED, ${error.message}`);
    }
  }

  writeFileSync(LEVELS_FILE, `${JSON.stringify(levelsConfig, null, JSON_INDENT)}\n`);
  expect(failures).toEqual([]);
});
