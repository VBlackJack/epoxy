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
 *   CC1_STEAM_DAT  optional path of the CC1 .DAT that matches the Steam levels (CHIPS_CC1_MS.DAT), with CC1_STEAM_DIR:
 *                  paired mode. Steam level n is paired with .DAT level n and the Steam solution is replayed on the
 *                  c2m conversion and on the .DAT level, each on the Epoxy (classic rules) and Lynx engines. Writes
 *                  `cc1-fidelity-dat-gaps.json` (the .DAT levels Lynx wins and Epoxy loses).
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
import {
  classifyMapPair,
  divergenceBucket,
  gatePasses,
  levelNumberOfFile,
  MAP_CLASSES,
  pairedWins,
  rankBuckets,
  titlesMatch,
  type FidelityGap,
  type MapClass
} from '../src/formats/cc1Fidelity';
import { convertC2mBytes } from '../src/ui/cc2Import';
import { listLevels, pct, table } from './reportUtil';

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
const LYNX_RULESET = 'lynx';
const DAT_PREFIX = 'cc1';
const PAIRED_GAPS_NAME = 'cc1-fidelity-dat-gaps.json';

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
  const ranked = rankBuckets(lynxOnly.map((r): FidelityGap => ({ path: r.path, divergence: firstDivergence(r.checks.epoxy) })));
  lines.push(...table(['cause', 'levels'], ranked.map((c) => [c.bucket, c.levels])), '');
  for (const bucket of ranked) lines.push(`- ${bucket.bucket}: ${bucket.paths.join(', ')}`);
  lines.push('');
  return { lines, gaps };
}

interface PairedRun {
  path: string;
  number: number;
  mapClass: MapClass | null;
  titleMatch: boolean;
  /** Engine -> best result of the Steam solution on the c2m conversion. */
  c2m: Partial<Record<Cc2ReplayEngine, Cc2ReplayBestResult>>;
  /** Engine -> best result of the same solution on the paired .DAT level (Epoxy engine: classic rules). */
  dat: Partial<Record<Cc2ReplayEngine, Cc2ReplayBestResult>>;
  error?: string;
}

function readArrayBuffer(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** Plays each Steam solution on the c2m conversion and on the .DAT level of the same number, on both engines. */
async function playPaired(root: string, datPath: string): Promise<PairedRun[]> {
  const files = listLevels(root);
  expect(files.length, 'no CC1 level found').toBeGreaterThan(0);
  const buffer = readArrayBuffer(datPath);
  const epoxyLevels = DatCodec.decodeBuffer(buffer, DAT_PREFIX, EPOXY_RULESET);
  const lynxLevels = DatCodec.decodeBuffer(buffer, DAT_PREFIX, LYNX_RULESET);
  const runs: PairedRun[] = [];
  let order = 0;
  for (const full of files) {
    order += 1;
    const path = relative(root, full).split(SPLIT_PATTERN).join(PATH_SEPARATOR);
    const number = levelNumberOfFile(basename(full)) ?? 0;
    const run: PairedRun = { path, number, mapClass: null, titleMatch: false, c2m: {}, dat: {} };
    try {
      const bytes = new Uint8Array(readFileSync(full));
      const level = (await convertC2mBytes(bytes, { file: basename(full), order })).level;
      const sections = cc2ReplaySections(decodeC2m(bytes));
      const index = number <= 0 ? -1 : epoxyLevels.findIndex((l) => l.number === number);
      const datEpoxy = index >= 0 ? epoxyLevels[index] : null;
      const datLynx = index >= 0 ? lynxLevels[index] : null;
      if (datEpoxy) {
        run.mapClass = classifyMapPair(datEpoxy, level);
        run.titleMatch = titlesMatch(datEpoxy.customTitle, level.customTitle);
      }
      if (sections.length > 0) {
        const replay = decodeCc2Replay(sections[0]);
        for (const engine of ENGINES) run.c2m[engine] = checkCc2ReplayBest(level, replay, engine);
        if (datEpoxy) run.dat.epoxy = checkCc2ReplayBest(datEpoxy, replay, 'epoxy');
        if (datLynx) run.dat.lynx = checkCc2ReplayBest(datLynx, replay, 'lynx');
      }
    } catch (error) {
      run.error = `${DECODE_ERROR}: ${(error as Error).message}`;
    }
    runs.push(run);
  }
  return runs;
}

function reportPaired(runs: readonly PairedRun[], stem: string): { lines: string[]; gaps: GapRecord[] } {
  const replayed = runs.filter((r) => r.c2m.epoxy !== undefined);
  const played = replayed.filter((r) => r.mapClass !== null);
  const outcomes = played.map((r) => ({
    mapClass: r.mapClass ?? 'differs',
    c2mEpoxy: !!r.c2m.epoxy?.won,
    c2mLynx: !!r.c2m.lynx?.won,
    datEpoxy: !!r.dat.epoxy?.won,
    datLynx: !!r.dat.lynx?.won
  }));
  const total = pairedWins(outcomes);
  const unpaired = replayed.filter((r) => r.mapClass === null);
  const mismatched = played.filter((r) => !r.titleMatch);
  const mismatchWins = pairedWins(outcomes.filter((_, i) => !played[i].titleMatch));

  const lines: string[] = [`## Paired replay wins (${stem} against the .DAT)`, ''];
  lines.push(
    `Steam levels: ${runs.length}; with a replay: ${replayed.length}; paired: ${played.length}; left out (no .DAT level or no number in the file name): ${unpaired.length}${unpaired.length > 0 ? ` (${unpaired.map((r) => r.path).join(", ")})` : ""}; conversion errors: ${runs.filter((r) => r.error).length}.`,
    ''
  );
  lines.push(
    `Title mismatches (${mismatched.length}): ${mismatched.length > 0 ? mismatched.map((r) => `${r.path} (level ${r.number})`).join(', ') : NONE}`,
    ''
  );
  lines.push(
    ...table(
      ['source / engine', 'wins', 'rate'],
      [
        ['c2m Epoxy+cc', total.c2mEpoxy, pct(total.c2mEpoxy, total.levels)],
        ['c2m Lynx', total.c2mLynx, pct(total.c2mLynx, total.levels)],
        ['DAT Epoxy+cc', total.datEpoxy, pct(total.datEpoxy, total.levels)],
        ['DAT Lynx', total.datLynx, pct(total.datLynx, total.levels)],
        [`(of which on title-mismatch levels: ${mismatched.length}; DAT Epoxy+cc ${mismatchWins.datEpoxy}, DAT Lynx ${mismatchWins.datLynx})`, '', '']
      ]
    ),
    ''
  );
  lines.push(
    `Wins in that order: ${total.c2mEpoxy} / ${total.c2mLynx} / ${total.datEpoxy} / ${total.datLynx}.`,
    '',
    `GATE: DAT Epoxy+cc >= DAT Lynx: ${gatePasses(total.datEpoxy, total.datLynx) ? 'yes' : 'no'} (Epoxy ${total.datEpoxy}, Lynx ${total.datLynx}).`,
    ''
  );

  lines.push('## Wins per map class', '');
  lines.push(
    ...table(
      ['map class', 'levels', 'c2m Epoxy+cc', 'c2m Lynx', 'DAT Epoxy+cc', 'DAT Lynx'],
      MAP_CLASSES.map((c) => {
        const w = pairedWins(outcomes, c);
        return [c, w.levels, w.c2mEpoxy, w.c2mLynx, w.datEpoxy, w.datLynx];
      })
    ),
    ''
  );

  const withDat = played.filter((r) => r.dat.epoxy !== undefined);
  const lynxOnly = withDat.filter((r) => r.dat.lynx?.won && !r.dat.epoxy?.won);
  const epoxyOnly = withDat.filter((r) => r.dat.epoxy?.won && !r.dat.lynx?.won);
  lines.push(`DAT levels won by Lynx only: ${lynxOnly.length}. DAT levels won by Epoxy+cc only: ${epoxyOnly.length}.`, '');
  const gaps = lynxOnly.map((r) => gapRecord(`${r.path} (level ${r.number}, ${r.mapClass}${r.titleMatch ? "" : ", TITLE MISMATCH"})`, firstDivergence(r.dat.epoxy)));
  lines.push('## DAT levels won by Lynx only', '');
  lines.push('Divergence of the DAT Epoxy+cc run (first strategy); the monsters are the ones on the death cell or next to it, nearest first.', '');
  lines.push(...(gaps.length > 0 ? gaps.map(gapLine) : [NONE]), '');

  lines.push('## Divergence causes over those levels, biggest first', '');
  const ranked = rankBuckets(lynxOnly.map((r): FidelityGap => ({ path: `${r.path} (level ${r.number})`, divergence: firstDivergence(r.dat.epoxy) })));
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
  const pairedDat = process.env.CC1_STEAM_DAT;
  if (hasSteam && pairedDat && existsSync(pairedDat)) {
    const root = resolve(steamDir as string);
    const part = reportPaired(await playPaired(root, resolve(pairedDat)), basename(root));
    lines.push(...part.lines);
    writeFileSync(join(outDir, PAIRED_GAPS_NAME), JSON.stringify(part.gaps, null, JSON_INDENT), 'utf8');
  }
  if (hasDat) lines.push(...lintLines(lintDatFolder(resolve(datDir as string))));
  writeFileSync(join(outDir, REPORT_NAME), lines.join(NEWLINE), 'utf8');
  console.log(`CC1 fidelity report: ${join(outDir, REPORT_NAME)}`);
});
