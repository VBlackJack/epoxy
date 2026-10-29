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
 * Builds the Epoxy campaign from tools/campaign-script.json. Each scripted
 * level (motifs to teach, puzzle count, hardest tier) is generated from
 * several seeds; the best scoring proven level is kept and written to
 * public/configs/levels.json as legend rows, so it stays readable and can be
 * retouched by hand or in the editor. The level's titles and hints live in
 * the locales under levels.level_<n>.
 *
 * Run with: npm run build:campaign
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { GeneratedLevel, ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { CompiledLevel, LevelBlueprint, LevelsConfig } from '../src/core/types';
import { LevelScript } from '../src/generator/ProgressionPlanner';
import { replays } from '../src/test/levelChecks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_FILE = resolve(ROOT, 'tools', 'campaign-script.json');
const LEVELS_FILE = resolve(ROOT, 'public', 'configs', 'levels.json');
const LEVEL_ID_PREFIX = 'epoxy_level_';
const LEVEL_KEY_PREFIX = 'levels.level_';
const JSON_INDENT = 2;

interface CampaignScript {
  seedsPerLevel: number;
  levels: LevelScript[];
}

/** Legend rows for the grids; anything the legend cannot spell goes to overrides and item lists. */
function toBlueprint(level: CompiledLevel, legend: LevelsConfig['legend']): LevelBlueprint {
  const byPair = new Map<string, string>();
  const byTerrain = new Map<string, string>();
  for (const [ch, entry] of Object.entries(legend)) {
    const key = `${entry.terrain}|${entry.item ?? ''}`;
    if (!byPair.has(key)) byPair.set(key, ch);
    if (!entry.item && !byTerrain.has(entry.terrain)) byTerrain.set(entry.terrain, ch);
  }
  const floorChar = byTerrain.get('floor') as string;
  const terrainOverrides: Array<{ x: number; y: number; id: string }> = [];
  const items: Array<{ x: number; y: number; id: string }> = [];
  const rows = level.terrain.map((row, y) =>
    row
      .map((terrainId, x) => {
        const itemId = level.items[y][x];
        const pair = byPair.get(`${terrainId}|${itemId ?? ''}`);
        if (pair) return pair;
        if (itemId) items.push({ x, y, id: itemId });
        const plain = byTerrain.get(terrainId);
        if (plain) return plain;
        terrainOverrides.push({ x, y, id: terrainId });
        return floorChar;
      })
      .join('')
  );
  return {
    id: level.id,
    theme: level.theme,
    solution: level.solution,
    number: level.number,
    titleKey: level.titleKey,
    hintKey: level.hintKey,
    password: level.password,
    timeLimitSeconds: level.timeLimitSeconds,
    chipsRequired: level.chipsRequired,
    playerStart: { ...level.playerStart },
    rows,
    terrainOverrides,
    items,
    entities: level.entities,
    trapLinks: level.trapLinks,
    cloneLinks: level.cloneLinks
  };
}

// The report config allows long runs; see vitest.report.config.ts.
it('builds the campaign', () => {
  loadTestConfigs();
  const script = JSON.parse(readFileSync(SCRIPT_FILE, 'utf-8')) as CampaignScript;
  const levelsConfig = JSON.parse(readFileSync(LEVELS_FILE, 'utf-8')) as LevelsConfig;
  const blueprints: LevelBlueprint[] = [];

  script.levels.forEach((entry, index) => {
    const number = index + 1;
    let best: GeneratedLevel | null = null;
    for (let seed = 1; seed <= script.seedsPerLevel; seed++) {
      const generated = ProceduralGenerator.generateDetailed(number, seed, entry);
      if (!best || generated.score > best.score) best = generated;
    }
    const chosen = best as GeneratedLevel;
    const level: CompiledLevel = {
      ...chosen.level,
      id: `${LEVEL_ID_PREFIX}${number}`,
      titleKey: `${LEVEL_KEY_PREFIX}${number}.title`,
      hintKey: `${LEVEL_KEY_PREFIX}${number}.hint`
    };
    const blueprint = toBlueprint(level, levelsConfig.legend);
    // The written rows must compile back to the proven level, and still win.
    const recompiled = ConfigRegistry.compileBlueprint(blueprint);
    expect(recompiled.terrain).toEqual(level.terrain);
    expect(recompiled.items).toEqual(level.items);
    expect(replays(recompiled, chosen.solution)).toBe(true);
    blueprints.push(blueprint);
  });

  writeFileSync(
    LEVELS_FILE,
    `${JSON.stringify({ legend: levelsConfig.legend, levels: blueprints }, null, JSON_INDENT)}\n`
  );
});
