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
 * Studies the bundled community packs and the Epoxy campaign: which mechanic
 * families levels combine, how the mix grows through a pack, which mechanic
 * each pack introduces first, and how many blocks and monsters levels use.
 * Writes local/community-study.md, an authoring aid kept out of the repo.
 *
 * Run with: npm run report:study
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { LevelMetrics } from '../src/core/LevelMetrics';
import { LevelValidator } from '../src/core/LevelValidator';
import { CompiledLevel } from '../src/core/types';
import { DatCodec } from '../src/formats/DatCodec';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'community-study.md');
/** Levels per slice when describing how a pack's mix grows. */
const SLICE_SIZE = 30;
const TOP_PAIRS = 15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)];
}

function entityCounts(level: CompiledLevel): { blocks: number; monsters: Map<string, number> } {
  let blocks = 0;
  const monsters = new Map<string, number>();
  for (const e of level.entities) {
    const kind = ConfigRegistry.getEntityDef(e.type)?.kind;
    if (kind === 'block') blocks++;
    if (kind === 'monster') monsters.set(e.type, (monsters.get(e.type) ?? 0) + 1);
  }
  return { blocks, monsters };
}

function describePack(name: string, levels: CompiledLevel[]): string[] {
  const out = [`## ${name} (${levels.length} levels)`, ''];
  const reports = levels.map((l) => LevelMetrics.measure(l));

  out.push('| Levels | Median families | Median chips | Median blocks | Median monsters | Share with monsters |');
  out.push('|---|---|---|---|---|---|');
  for (let start = 0; start < levels.length; start += SLICE_SIZE) {
    const slice = levels.slice(start, start + SLICE_SIZE);
    const sliceReports = reports.slice(start, start + SLICE_SIZE);
    const counts = slice.map(entityCounts);
    const monsterTotals = counts.map((c) => [...c.monsters.values()].reduce((a, b) => a + b, 0));
    out.push(
      `| ${start + 1}-${start + slice.length} | ${median(sliceReports.map((r) => r.mechanicCount))} | ` +
        `${median(slice.map((l) => l.chipsRequired))} | ${median(counts.map((c) => c.blocks))} | ` +
        `${median(monsterTotals)} | ${Math.round((100 * monsterTotals.filter((m) => m > 0).length) / slice.length)}% |`
    );
  }

  const firstSeen = new Map<string, number>();
  reports.forEach((r, i) => r.mechanics.forEach((m) => firstSeen.has(m) || firstSeen.set(m, i + 1)));
  out.push('', `First level using each family: ${[...firstSeen.entries()].map(([m, n]) => `${m} ${n}`).join(', ')}`);

  const pairs = new Map<string, number>();
  for (const r of reports) {
    for (let i = 0; i < r.mechanics.length; i++) {
      for (let j = i + 1; j < r.mechanics.length; j++) {
        const key = `${r.mechanics[i]}+${r.mechanics[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const topPairs = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_PAIRS);
  out.push('', `Most frequent pairs: ${topPairs.map(([p, n]) => `${p} ${Math.round((100 * n) / levels.length)}%`).join(', ')}`);

  const monsterTypes = new Map<string, number>();
  levels.map(entityCounts).forEach((c) => c.monsters.forEach((n, t) => monsterTypes.set(t, (monsterTypes.get(t) ?? 0) + n)));
  out.push('', `Monsters by type: ${[...monsterTypes.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`, '');
  return out;
}

function describeCampaign(levels: CompiledLevel[]): string[] {
  const out = ['## Epoxy campaign', '', '| # | Title | Families | Chips | Blocks | Monsters | Validator |', '|---|---|---|---|---|---|---|'];
  for (const level of levels) {
    const report = LevelMetrics.measure(level);
    const counts = entityCounts(level);
    const validation = LevelValidator.validate(level);
    out.push(
      `| ${level.number} | ${level.titleKey ?? level.customTitle ?? level.id} | ${report.mechanics.join(' ')} | ` +
        `${level.chipsRequired} | ${counts.blocks} | ${[...counts.monsters.values()].reduce((a, b) => a + b, 0)} | ` +
        `${validation.valid ? 'ok' : validation.issues.map((i) => i.i18nKey.split('.').slice(-2, -1)[0]).join(' ')} |`
    );
  }
  return out;
}

it('writes the community study', () => {
  loadTestConfigs();
  const lines: string[] = ['# Community packs and campaign study', ''];
  for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
    const buffer = readFileSync(resolve(ROOT, 'public', pack.url));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    lines.push(...describePack(pack.name, DatCodec.decodeBuffer(bytes, pack.prefix)));
  }
  lines.push(...describeCampaign(ConfigRegistry.getLevels()));
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`);
});
