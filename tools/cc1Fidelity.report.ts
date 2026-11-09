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
 * CC1 fidelity gate: how well the Epoxy engine plays Chip's Challenge 1 levels compared with the Lynx engine. Local
 * only; the report holds counts, file names, coordinates and entity kinds, never maps.
 *
 * Every .c2m level of a folder (the CC1 Steam release) is converted to Epoxy and its stored winning replay is played on
 * the Epoxy engine and on the Lynx engine (the same replay check as tools/cc2Replay.report.ts). The gate is
 * "Epoxy wins >= Lynx wins". The levels Lynx wins and Epoxy loses are listed with the Epoxy divergence cause, then
 * ranked by cause so the fidelity work can start with the biggest bucket.
 *
 *   CC1_STEAM_DIR  the folder of CC1 .c2m levels (required for the replay part)
 *   CC1_DAT_DIR    optional folder of .DAT packs: each level is decoded with the Epoxy ruleset and run through the
 *                  level validator. This is a LINT (error issues by key), not a solvability measure.
 *   CC1_OUT_DIR    where the reports go (default: local/cc1 under the repository)
 *
 * Writes `cc1-fidelity.md` and `cc1-fidelity-gaps.json` (the levels Lynx wins and Epoxy loses, to diff against a later
 * run).
 *
 * Run with:
 *   CC1_STEAM_DIR=<folder> [CC1_DAT_DIR=<folder>] npx vitest run --config vitest.report.config.ts tools/cc1Fidelity.report.ts
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { loadTestConfigs } from '../src/test/loadTestConfigs';
import { LevelValidator } from '../src/core/LevelValidator';
import { decodeC2m } from '../src/formats/C2mCodec';
import { cc2ReplaySections } from '../src/formats/cc2Model';
import { decodeCc2Replay } from '../src/formats/cc2Replay';
import { checkCc2ReplayBest, type Cc2Divergence, type Cc2ReplayBestResult, type Cc2ReplayEngine } from '../src/formats/cc2ReplayCheck';
import { DatCodec } from '../src/formats/DatCodec';
import { divergenceBucket, gatePasses, rankBuckets, type FidelityGap } from '../src/formats/cc1Fidelity';
import { convertC2mBytes } from '../src/ui/cc2Import';
import { listLevels, pct, table } from './cc2Replay.report';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = resolve(ROOT, 'local', 'cc1');
const REPORT_NAME = 'cc1-fidelity.md';
const GAPS_NAME = 'cc1-fidelity-gaps.json';
const DAT_EXTENSION = '.dat';
const ENGINES: readonly Cc2ReplayEngine[] = ['epoxy', 'lynx'];
const NEWLINE = String.fromCharCode(10);
const PATH_SEPARATOR = '/';
const SPLIT_PATTERN = /[\\/]/;
const JSON_INDENT = 2;
const DECODE_ERROR = 'decode error';
const NONE = '-';
const EPOXY_RULESET = 'epoxy';

interface LevelRun {
  path: string;
  /** Engine -> best result; absent for a level without a stored replay or that failed to convert. */
  checks: Partial<Record<Cc2ReplayEngine, Cc2ReplayBestResult>>;
  error?: string;
}

interface GapRecord {
  path: string;
  bucket: string;
  kind: string | null;
  reasonKey: string | null;
  tick: number | null;
  move: number | null;
  x: number | null;
  y: number | null;
  tile: string | null;
  monsters: string[];
}

interface LintRow {
  pack: string;
  levels: number;
  withError: number;
  byKey: Map<string, number>;
}

/** The divergence of the first strategy, the one the cc2 replay report ranks. */
function firstDivergence(check: Cc2ReplayBestResult | undefined): Cc2Divergence | null {
  return check?.results[0]?.divergence ?? null;
}

function gapRecord(path: string, d: Cc2Divergence | null): GapRecord {
  return {
    path,
    bucket: divergenceBucket(d),
    kind: d?.kind ?? null,
    reasonKey: d?.reasonKey ?? null,
    tick: d?.tick ?? null,
    move: d?.move ?? null,
    x: d?.x ?? null,
    y: d?.y ?? null,
    tile: d?.tile ?? null,
    monsters: d?.monsters ?? []
  };
}

function gapLine(g: GapRecord): string {
  const monsters = g.monsters.length > 0 ? `, monsters: ${g.monsters.join(', ')}` : '';
  if (g.kind === null) return `- ${g.path} | no divergence recorded`;
  const reason = g.reasonKey ? ` (${g.reasonKey})` : '';
  const tile = g.tile ? `, tile ${g.tile}` : '';
  return `- ${g.path} | ${g.kind}${reason} | tick ${g.tick}, move ${g.move}, cell ${g.x},${g.y}${tile}${monsters}`;
}

function winsOf(runs: readonly LevelRun[], engine: Cc2ReplayEngine): number {
  return runs.filter((r) => r.checks[engine]?.won).length;
}

async function playSteamFolder(root: string): Promise<LevelRun[]> {
  const files = listLevels(root);
  expect(files.length, 'no CC1 level found').toBeGreaterThan(0);
  const runs: LevelRun[] = [];
  let order = 0;
  for (const full of files) {
    order += 1;
    const path = relative(root, full).split(SPLIT_PATTERN).join(PATH_SEPARATOR);
    const bytes = new Uint8Array(readFileSync(full));
    try {
      const level = await convertC2mBytes(bytes, { file: basename(full), order });
      const sections = cc2ReplaySections(decodeC2m(bytes));
      const checks: LevelRun['checks'] = {};
      if (sections.length > 0) {
        const replay = decodeCc2Replay(sections[0]);
        for (const engine of ENGINES) checks[engine] = checkCc2ReplayBest(level.level, replay, engine);
      }
      runs.push({ path, checks });
    } catch (error) {
      runs.push({ path, checks: {}, error: `${DECODE_ERROR}: ${(error as Error).message}` });
    }
  }
  return runs;
}

function reportReplays(runs: readonly LevelRun[], stem: string): { lines: string[]; gaps: GapRecord[] } {
  const withReplay = runs.filter((r) => Object.keys(r.checks).length > 0);
  const epoxyWins = winsOf(runs, 'epoxy');
  const lynxWins = winsOf(runs, 'lynx');
  const lynxOnly = withReplay.filter((r) => r.checks.lynx?.won && !r.checks.epoxy?.won);
  const epoxyOnly = withReplay.filter((r) => r.checks.epoxy?.won && !r.checks.lynx?.won);
  const gaps = lynxOnly.map((r) => gapRecord(r.path, firstDivergence(r.checks.epoxy)));
  const failedEpoxy = withReplay.filter((r) => !r.checks.epoxy?.won);

  const lines: string[] = [`## Replay wins (${stem})`, ''];
  lines.push(`Levels: ${runs.length}; with a replay: ${withReplay.length}; conversion errors: ${runs.filter((r) => r.error).length}.`, '');
  lines.push(
    ...table(
      ['engine', 'wins', 'rate'],
      ENGINES.map((e) => [e, winsOf(runs, e), pct(winsOf(runs, e), withReplay.length)])
    ),
    ''
  );
  lines.push(`GATE: Epoxy wins >= Lynx wins: ${gatePasses(epoxyWins, lynxWins) ? 'yes' : 'no'} (Epoxy ${epoxyWins}, Lynx ${lynxWins}).`, '');
  lines.push(`Won by Lynx and lost by Epoxy: ${lynxOnly.length}. Won by Epoxy and lost by Lynx: ${epoxyOnly.length}.`, '');

  lines.push('## Epoxy failures, all levels (first strategy)', '');
  const allCauses = rankBuckets(failedEpoxy.map((r) => ({ path: r.path, divergence: firstDivergence(r.checks.epoxy) })));
  lines.push(...table(['cause', 'levels'], allCauses.map((c) => [c.bucket, c.levels])), '');

  lines.push('## Levels won by Lynx and lost by Epoxy', '');
  lines.push('Divergence of the Epoxy run (first strategy); the monsters are the ones on the death cell or next to it, nearest first.', '');
  lines.push(...(gaps.length > 0 ? gaps.map(gapLine) : [NONE]), '');

  lines.push('## Divergence causes over those levels, biggest first', '');
  const ranked = rankBuckets(gaps.map((g): FidelityGap => ({ path: g.path, divergence: lynxOnly.find((r) => r.path === g.path)?.checks.epoxy?.results[0]?.divergence ?? null })));
  lines.push(...table(['cause', 'levels'], ranked.map((c) => [c.bucket, c.levels])), '');
  for (const bucket of ranked) lines.push(`- ${bucket.bucket}: ${bucket.paths.join(', ')}`);
  lines.push('');
  return { lines, gaps };
}

function listDatFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(DAT_EXTENSION))
    .map((e) => join(root, e.name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function lintDatFolder(root: string): LintRow[] {
  return listDatFiles(root).map((file) => {
    const pack = basename(file);
    const buffer = readFileSync(file);
    const levels = DatCodec.decodeBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, pack.replace(/\.[^.]*$/, '').toLowerCase(), EPOXY_RULESET);
    const byKey = new Map<string, number>();
    let withError = 0;
    for (const level of levels) {
      const keys = new Set(
        LevelValidator.validate(level)
          .issues.filter((i) => i.severity === 'error')
          .map((i) => i.i18nKey)
      );
      if (keys.size > 0) withError += 1;
      for (const key of keys) byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    return { pack, levels: levels.length, withError, byKey };
  });
}

function lintLines(rows: readonly LintRow[]): string[] {
  const lines = ['## DAT lint (Epoxy ruleset, LevelValidator errors)', '', 'This is a lint of the decoded levels, NOT a solvability measure: a level with no error can still be unsolvable.', ''];
  lines.push(
    ...table(
      ['pack', 'levels', 'levels with an error', 'rate'],
      rows.map((r) => [r.pack, r.levels, r.withError, pct(r.withError, r.levels)])
    ),
    ''
  );
  const total = new Map<string, number>();
  for (const row of rows) for (const [key, n] of row.byKey) total.set(key, (total.get(key) ?? 0) + n);
  lines.push('Levels per error key (a level counts once per key):', '');
  lines.push(...table(['error key', 'levels', ...rows.map((r) => r.pack)], [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => [key, n, ...rows.map((r) => r.byKey.get(key) ?? 0)])), '');
  return lines;
}

it('measures the CC1 fidelity of the Epoxy engine against Lynx and writes a report', async () => {
  const steamDir = process.env.CC1_STEAM_DIR;
  const datDir = process.env.CC1_DAT_DIR;
  const hasSteam = !!steamDir && existsSync(steamDir);
  const hasDat = !!datDir && existsSync(datDir);
  if (!hasSteam && !hasDat) {
    console.warn('Set CC1_STEAM_DIR to a folder of CC1 .c2m levels and/or CC1_DAT_DIR to a folder of .DAT packs.');
    return;
  }
  const outDir = process.env.CC1_OUT_DIR ? resolve(process.env.CC1_OUT_DIR) : DEFAULT_OUT_DIR;
  loadTestConfigs();
  mkdirSync(outDir, { recursive: true });

  const lines: string[] = ['# CC1 fidelity: Epoxy engine vs Lynx engine', ''];
  let gaps: GapRecord[] = [];
  if (hasSteam) {
    const root = resolve(steamDir as string);
    const part = reportReplays(await playSteamFolder(root), basename(root));
    gaps = part.gaps;
    lines.push(...part.lines);
    writeFileSync(join(outDir, GAPS_NAME), JSON.stringify(gaps, null, JSON_INDENT), 'utf8');
  }
  if (hasDat) lines.push(...lintLines(lintDatFolder(resolve(datDir as string))));
  writeFileSync(join(outDir, REPORT_NAME), lines.join(NEWLINE), 'utf8');
  console.log(`CC1 fidelity report: ${join(outDir, REPORT_NAME)}`);
});
