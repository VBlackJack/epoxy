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
 * each pack introduces first, how many blocks and monsters levels use, and
 * how often classic puzzle idioms appear.
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
import { CompiledLevel, TileDefinition } from '../src/core/types';
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


/** Thresholds of the pattern detectors below. */
const MIN_BLOCKS_FOR_SOKOBAN = 3;
const MIN_TELEPORTERS_FOR_NETWORK = 3;
const MIN_BLUE_WALLS_FOR_MAZE = 6;
const MIN_FORCE_FOR_MAZE = 6;
const MIN_TOGGLE_BUTTONS_FOR_SEQUENCE = 2;
const MIN_CHIPS_FOR_HUNT = 20;

/**
 * Classic puzzle idioms of the genre, each detected by a cheap structural
 * test on a whole level. They estimate how often designers use each idiom;
 * a level can show several.
 */
const PATTERNS: Record<string, (level: CompiledLevel) => boolean> = {
  sokoban_bridge: (l) => entityCounts(l).blocks >= MIN_BLOCKS_FOR_SOKOBAN && countTiles(l, (t) => t.hazard === 'water') > 0,
  block_holds_trap: (l) => l.trapLinks.length > 0 && entityCounts(l).blocks > 0,
  cloner_feed: (l) => l.cloneLinks.length > 0,
  key_scarcity: (l) => keyScarcity(l),
  key_hunt: (l) => countTiles(l, (t) => Boolean(t.requiredKey)) >= 4,
  ice_corners: (l) => countTiles(l, (t) => Boolean(t.deflectionMap) && t.slideType === 'ice') > 0,
  force_maze: (l) => forceDirections(l) >= 2 && countTiles(l, (t) => t.slideType === 'force') >= MIN_FORCE_FOR_MAZE,
  teleport_network: (l) => countTiles(l, (t) => Boolean(t.isTeleporter)) >= MIN_TELEPORTERS_FOR_NETWORK,
  blue_wall_maze: (l) => countIds(l, ['blue_wall_fake', 'blue_wall_real']) >= MIN_BLUE_WALLS_FOR_MAZE,
  invisible_walls: (l) => countIds(l, ['invisible_wall', 'appearing_wall']) > 0,
  toggle_sequence: (l) => countTiles(l, (t) => t.buttonAction === 'toggle_walls') >= MIN_TOGGLE_BUTTONS_FOR_SEQUENCE,
  tank_switch: (l) => l.entities.some((e) => e.type === 'tank') && countTiles(l, (t) => t.buttonAction === 'reverse_tanks') > 0,
  thief_order: (l) => countTiles(l, (t) => Boolean(t.stealsBoots)) > 0,
  bomb_clearing: (l) => countItems(l, (t) => t.hazard === 'bomb') > 0 && entityCounts(l).blocks > 0,
  dirt_and_blocks: (l) => countIds(l, ['dirt']) > 0 && entityCounts(l).blocks > 0,
  boots_combo: (l) => countItems(l, (t) => t.collectible === 'boot') >= 2,
  monster_dodge: (l) => l.entities.some((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster'),
  chip_hunt: (l) => l.chipsRequired >= MIN_CHIPS_FOR_HUNT
};

function countTiles(level: CompiledLevel, test: (t: TileDefinition) => boolean): number {
  let n = 0;
  for (const row of level.terrain) for (const id of row) if (test(ConfigRegistry.getTile(id))) n++;
  return n;
}

function countItems(level: CompiledLevel, test: (t: TileDefinition) => boolean): number {
  let n = 0;
  for (const row of level.items) for (const id of row) if (id && test(ConfigRegistry.getTile(id))) n++;
  return n;
}

function countIds(level: CompiledLevel, ids: string[]): number {
  let n = 0;
  for (const row of level.terrain) for (const id of row) if (ids.includes(id)) n++;
  return n;
}

function forceDirections(level: CompiledLevel): number {
  const dirs = new Set<string>();
  for (const row of level.terrain) for (const id of row) {
    const dir = ConfigRegistry.getTile(id).forceDirection;
    if (dir) dirs.add(dir);
  }
  return dirs.size;
}

/** Fewer keys of a consumed colour than doors of it: the player must choose. */
function keyScarcity(level: CompiledLevel): boolean {
  const doors = new Map<string, number>();
  for (const row of level.terrain) for (const id of row) {
    const t = ConfigRegistry.getTile(id);
    if (t.requiredKey && t.consumesKey) doors.set(t.requiredKey, (doors.get(t.requiredKey) ?? 0) + 1);
  }
  const keys = new Map<string, number>();
  for (const row of level.items) for (const id of row) if (id && doors.has(id)) keys.set(id, (keys.get(id) ?? 0) + 1);
  return [...doors.entries()].some(([key, n]) => (keys.get(key) ?? 0) > 0 && (keys.get(key) ?? 0) < n);
}

function describePatterns(packs: Array<{ name: string; levels: CompiledLevel[] }>): string[] {
  const out = ['## Puzzle patterns', '', `| Pattern | ${packs.map((p) => p.name).join(' | ')} | First half / second half |`, `|---|${packs.map(() => '---|').join('')}---|`];
  const all = packs.flatMap((p) => p.levels);
  for (const [name, detect] of Object.entries(PATTERNS)) {
    const perPack = packs.map((p) => `${Math.round((100 * p.levels.filter(detect).length) / p.levels.length)}%`);
    const half = (levels: CompiledLevel[], second: boolean) => {
      const part = levels.filter((_, i) => (i >= levels.length / 2) === second);
      return part.filter(detect).length / Math.max(1, part.length);
    };
    const early = packs.reduce((sum, p) => sum + half(p.levels, false), 0) / packs.length;
    const late = packs.reduce((sum, p) => sum + half(p.levels, true), 0) / packs.length;
    out.push(`| ${name} | ${perPack.join(' | ')} | ${Math.round(100 * early)}% / ${Math.round(100 * late)}% |`);
  }
  out.push('', `Levels studied: ${all.length}`, '');
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
  const packs: Array<{ name: string; levels: CompiledLevel[] }> = [];
  for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
    const buffer = readFileSync(resolve(ROOT, 'public', pack.url));
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const levels = DatCodec.decodeBuffer(bytes, pack.prefix);
    packs.push({ name: pack.name, levels });
    lines.push(...describePack(pack.name, levels));
  }
  lines.push(...describePatterns(packs));
  lines.push(...describeCampaign(ConfigRegistry.getLevels()));
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`);
});
