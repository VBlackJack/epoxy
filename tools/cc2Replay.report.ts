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
 * Plays the winning replay stored in every Chip's Challenge 2 level of a folder (read recursively) on the Epoxy
 * engine, with both strategies of the replay check, and writes a report. Local only; the report holds counts, file
 * names and coordinates, never maps.
 *
 *   CC2_GAME_DIR   the folder to check (required)
 *   CC2_OUT_DIR    where the report goes (default: local/cc2 under the repository)
 *   CC2_REPLAY_ENGINE  epoxy (default), lynx, cc2, both (epoxy and lynx) or all (epoxy, lynx and cc2); one report per
 *                  engine, file suffix -replay-<engine>.md
 *
 * Writes `<folder-name>-replay.md`: a summary (replay wins by coverage verdict, by strategy, divergence causes, wins
 * per approximate key) followed by one line per level.
 *
 * Run with:
 *   CC2_GAME_DIR=<folder> npm run report:cc2replay
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { loadTestConfigs } from '../src/test/loadTestConfigs';
import { decodeC2m } from '../src/formats/C2mCodec';
import { cc2ReplaySections } from '../src/formats/cc2Model';
import { decodeCc2Replay } from '../src/formats/cc2Replay';
import { checkCc2ReplayBest, type Cc2ReplayBestResult, type Cc2ReplayEngine } from '../src/formats/cc2ReplayCheck';
import { convertC2mBytes } from '../src/ui/cc2Import';
import { listLevels, pct, table } from './reportUtil';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = resolve(ROOT, 'local', 'cc2');
const REPORT_SUFFIX = '-replay';
const ENGINE_ENV = 'CC2_REPLAY_ENGINE';
const ENGINE_BOTH = 'both';
const ENGINE_ALL = 'all';
const LYNX_BASED: readonly Cc2ReplayEngine[] = ['lynx', 'cc2'];
const NEWLINE = String.fromCharCode(10);
const PATH_SEPARATOR = '/';
const SPLIT_PATTERN = /[\\/]/;
const VERDICTS = ['exact', 'approx', 'lost'] as const;
const EXACT = 'exact';
const NO_REPLAY = 'no replay';
const DECODE_ERROR = 'decode error';
const UNLISTED = '-';
const KEY_BIT_NAMES: ReadonlyArray<readonly [number, string]> = [
  [0x01, 'drop'],
  [0x20, 'switch'],
  [0x40, 'cycle'],
  [0x80, 'p2']
];

interface Row {
  path: string;
  verdict: (typeof VERDICTS)[number];
  approx: string[];
  lost: string[];
  check: Cc2ReplayBestResult | null;
  error?: string;
}

function keyBitNames(bits: number): string {
  const names = KEY_BIT_NAMES.filter(([bit]) => (bits & bit) !== 0).map(([, name]) => name);
  return names.length > 0 ? names.join('+') : UNLISTED;
}

/** One clause per strategy: where its run ended. */
function failureText(check: Cc2ReplayBestResult): string {
  return check.results
    .map((r) => {
      const d = r.divergence;
      if (!d) return `${r.strategy}: ok`;
      const cause = d.reasonKey ? ` (${d.reasonKey})` : '';
      const blocked = d.blockedSinceTick !== undefined ? `, blocked from tick ${d.blockedSinceTick}` : '';
      return `${r.strategy}: ${d.kind}${cause} at tick ${d.tick}, move ${d.move}, cell ${d.x},${d.y}${blocked}`;
    })
    .join('; ');
}

function levelLine(row: Row): string {
  const approx = row.approx.length > 0 ? ` [approx: ${row.approx.join(', ')}]` : '';
  const lost = row.lost.length > 0 ? ` [lost: ${row.lost.join(', ')}]` : '';
  const coverage = `${row.verdict}${approx}${lost}`;
  if (row.error) return `- ${row.path} | ${coverage} | ${row.error}`;
  if (!row.check) return `- ${row.path} | ${coverage} | ${NO_REPLAY}`;
  const outcome = row.check.won ? `WIN (${row.check.winner})` : `FAIL ${failureText(row.check)}`;
  const unsupported = row.check.unsupported.length > 0 ? ` | unsupported: ${row.check.unsupported.join(', ')}` : '';
  return `- ${row.path} | ${coverage} | ${outcome} | ignored keys: ${keyBitNames(row.check.ignoredKeyBits)}${unsupported}`;
}

function tally<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}

/** Per unsupported id: the levels with a replay that carry it, and how many of those are exact. */
function unsupportedLines(withReplay: readonly Row[]): string[] {
  const byId = new Map<string, Row[]>();
  for (const row of withReplay) for (const id of row.check?.unsupported ?? []) byId.set(id, [...(byId.get(id) ?? []), row]);
  const rows = [...byId.entries()]
    .map(([id, list]) => [id, list.length, list.filter((r) => r.verdict === EXACT).length] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ['## Unsupported ids on levels with a replay', '', ...table(['id', 'levels', 'of which exact'], rows), ''];
}

function summaryLines(rows: readonly Row[], lynxBased: boolean): string[] {
  const withReplay = rows.filter((r) => r.check !== null);
  const wins = (list: readonly Row[]): number => list.filter((r) => r.check?.won).length;
  const lines: string[] = [];
  lines.push(
    `Levels: ${rows.length}; with a replay: ${withReplay.length}; replay wins: ${wins(withReplay)} (${pct(wins(withReplay), withReplay.length)}).`,
    ''
  );

  lines.push('## Replay wins by coverage verdict', '');
  lines.push(
    ...table(
      ['verdict', 'levels with replay', 'wins', 'rate'],
      VERDICTS.map((v) => {
        const list = withReplay.filter((r) => r.verdict === v);
        return [v, list.length, wins(list), pct(wins(list), list.length)];
      })
    ),
    ''
  );

  lines.push('## Winning strategy', '');
  const winners = tally(
    withReplay.filter((r) => r.check?.won),
    (r) => r.check?.winner ?? UNLISTED
  );
  const bothWin = withReplay.filter((r) => r.check?.results.every((x) => x.won)).length;
  lines.push(...table(['strategy', 'first to win'], [...winners.entries()].sort()), '');
  lines.push(`Levels won by every strategy: ${bothWin}.`, '');
  for (const strategy of ['held', 'steps'] as const) {
    const n = withReplay.filter((r) => r.check?.results.find((x) => x.strategy === strategy)?.won).length;
    lines.push(`- ${strategy} alone wins ${n} of ${withReplay.length}`);
  }
  lines.push('');

  lines.push('## Divergence causes (failed levels, first strategy)', '');
  const failed = withReplay.filter((r) => !r.check?.won);
  const causes = tally(failed, (r) => {
    const d = r.check?.results[0].divergence;
    return d ? `${d.kind}${d.reasonKey ? ` / ${d.reasonKey}` : ''}` : UNLISTED;
  });
  lines.push(...table(['cause', 'levels'], [...causes.entries()].sort((a, b) => b[1] - a[1])), '');

  lines.push('## Wins by approximate key', '');
  lines.push('A level is "solo" for a key when that key is its only approximate key and it has no lost key.', '');
  const approxKeys = [...new Set(rows.flatMap((r) => r.approx))].sort();
  const keyRows = approxKeys.map((key) => {
    const having = withReplay.filter((r) => r.approx.includes(key) && r.lost.length === 0);
    const solo = having.filter((r) => r.approx.length === 1);
    return [key, having.length, wins(having), solo.length, wins(solo)];
  });
  lines.push(...table(['approx key', 'levels', 'wins', 'solo levels', 'solo wins'], keyRows), '');

  if (lynxBased) lines.push(...unsupportedLines(withReplay));

  const unplayed = withReplay.filter((r) => (r.check?.ignoredKeyBits ?? 0) !== 0);
  lines.push(
    `Levels whose replay uses keys the check does not play (drop, switch, cycle, p2): ${unplayed.length}, wins among them: ${wins(unplayed)}.`,
    ''
  );
  return lines;
}

function enginesToRun(): Cc2ReplayEngine[] {
  const wanted = process.env[ENGINE_ENV] ?? 'epoxy';
  if (wanted === ENGINE_BOTH) return ['epoxy', 'lynx'];
  if (wanted === ENGINE_ALL) return ['epoxy', 'lynx', 'cc2'];
  if (wanted === 'epoxy' || wanted === 'lynx' || wanted === 'cc2') return [wanted];
  throw new Error(`${ENGINE_ENV} must be epoxy, lynx, cc2, ${ENGINE_BOTH} or ${ENGINE_ALL}`);
}

it('plays the stored replays of a folder of CC2 levels and writes a report', async () => {
  const dirName = process.env.CC2_GAME_DIR;
  if (!dirName || !existsSync(dirName)) {
    console.warn('Set CC2_GAME_DIR to a folder of .c2m levels.');
    return;
  }
  const outDir = process.env.CC2_OUT_DIR ? resolve(process.env.CC2_OUT_DIR) : DEFAULT_OUT_DIR;
  const root = resolve(dirName);
  const stem = basename(root);
  loadTestConfigs();
  mkdirSync(outDir, { recursive: true });

  const files = listLevels(root);
  expect(files.length, 'no CC2 level found').toBeGreaterThan(0);
  const converted = [];
  let order = 0;
  for (const full of files) {
    order += 1;
    const path = relative(root, full).split(SPLIT_PATTERN).join(PATH_SEPARATOR);
    const bytes = new Uint8Array(readFileSync(full));
    try {
      const level = await convertC2mBytes(bytes, { file: basename(full), order });
      converted.push({ path, level, sections: cc2ReplaySections(decodeC2m(bytes)) });
    } catch (error) {
      converted.push({ path, error: `${DECODE_ERROR}: ${(error as Error).message}` });
    }
  }

  const engines = enginesToRun();
  for (const engine of engines) {
    const rows: Row[] = converted.map((c) => {
      if (!('level' in c) || !c.level) return { path: c.path, verdict: 'lost', approx: [], lost: [], check: null, error: c.error };
      const row: Row = {
        path: c.path,
        verdict: c.level.report.verdict,
        approx: c.level.report.approx.map((a) => a.key),
        lost: c.level.report.lost.map((l) => l.key),
        check: null
      };
      if (c.sections.length > 0) row.check = checkCc2ReplayBest(c.level.level, decodeCc2Replay(c.sections[0]), engine);
      return row;
    });
    const markdown = [`# CC2 replay check: ${stem} (${engine} engine)`, '', ...summaryLines(rows, LYNX_BASED.includes(engine)), '## Levels', '', ...rows.map(levelLine), ''].join(NEWLINE);
    const suffix = engines.length > 1 || engine !== 'epoxy' ? `${REPORT_SUFFIX}-${engine}` : REPORT_SUFFIX;
    writeFileSync(join(outDir, `${stem}${suffix}.md`), markdown, 'utf8');
    const played = rows.filter((r) => r.check !== null);
    console.log(`${stem} [${engine}]: ${played.filter((r) => r.check?.won).length} of ${played.length} replays win`);
  }
});
