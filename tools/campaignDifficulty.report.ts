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
 * Objective difficulty numbers for the hand-written campaign, read from
 * replaying each level's own solution, next to the same numbers for
 * generated endless levels as an outside baseline. Writes
 * local/campaign-difficulty.json and local/campaign-difficulty.md.
 *
 * Run with: npm run report:difficulty
 * The pilot pack: npm run report:difficulty:pilot (the same tool with
 * EPOXY_DIFFICULTY_PACK=pilot)
 * (writes local/pilot-difficulty.json and local/pilot-difficulty.md).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import {
  DEFAULT_DIFFICULTY_CONFIG,
  DifficultyMetrics,
  DifficultyReport,
  IRREVERSIBLE_KINDS
} from '../src/core/DifficultyMetrics';
import { CompiledLevel } from '../src/core/types';
import { LevelMetrics, Mechanic } from '../src/core/LevelMetrics';
import { ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { encodeActions } from '../src/generator/PieceSolver';
import { DESIGN_PACK_VARIABLES, designPackFromEnv } from '../src/test/designPacks';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(ROOT, 'local');
/** The campaign keeps its historical file names; any other pack is prefixed with its id. */
const CAMPAIGN_PACK_ID = 'campaign';
const OUTPUT_BASE_NAME = 'campaign-difficulty';

/** Endless level numbers and fixed seeds of the baseline sample. */
const ENDLESS_LEVEL_NUMBERS = [1, 5, 10, 20, 30, 50];
const ENDLESS_SEEDS = [1, 2, 3];

/** Decimals shown in the markdown tables. */
const SECONDS_DECIMALS = 1;
const MEAN_DECIMALS = 1;
const PERCENT = 100;

/** Metrics a campaign level is placed against the endless baseline on. */
const BASELINE_METRICS = ['moves', 'pushes', 'irreversibleEvents', 'dangerSteps'] as const;
type BaselineMetric = (typeof BASELINE_METRICS)[number];

const GENERATION_TIMEOUT_MS = 1_800_000;

interface CampaignRhythm {
  chapters: Array<{ titleKey: string; levels: number[] }>;
  introduces: Record<string, string[]>;
  baseline: string[];
}

interface CampaignRow {
  number: number;
  titleKey: string;
  introduces: string[];
  report: DifficultyReport;
  closestEndless: Record<BaselineMetric, number>;
}

interface EndlessRow {
  levelNumber: number;
  seeds: number;
  failures: number;
  unsolved: number;
  means: Record<string, number | null>;
  reports: DifficultyReport[];
}

/** Numeric fields averaged for each endless level number. */
const MEAN_FIELDS = [
  'moves',
  'waits',
  'pushes',
  'reversals',
  'revisitRatio',
  'distinctCells',
  'stepsPerWalkableCell',
  'irreversibleEvents',
  'shareAfterFirstIrreversible',
  'dangerSteps',
  'minMonsterDistance',
  'timeMarginSeconds',
  'timeRatio',
  'mechanicCount',
  'deadShare',
  'junctionShare',
  'playfieldFill',
  'walkableCells'
] as const;

function mean(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((sum, v) => sum + v, 0) / present.length : null;
}

function fieldOf(report: DifficultyReport, field: string): number | null {
  return (report as unknown as Record<string, number | null>)[field];
}

function fmt(value: number | null, decimals: number): string {
  return value === null ? '-' : value.toFixed(decimals);
}

function percent(value: number | null): string {
  return value === null ? '-' : `${(value * PERCENT).toFixed(0)}%`;
}

/** Mechanics of a list of element ids (tile or entity ids). */
function mechanicsOf(ids: readonly string[]): Set<Mechanic> {
  const found = new Set<Mechanic>();
  for (const id of ids) for (const m of LevelMetrics.mechanicsOfElement(id)) found.add(m);
  return found;
}

function measureCampaign(
  levelsInOrder: readonly CompiledLevel[],
  rhythm: CampaignRhythm
): Array<Omit<CampaignRow, 'closestEndless'>> {
  const levels = [...levelsInOrder].sort((a, b) => a.number - b.number);
  const prior = mechanicsOf(rhythm.baseline);
  return levels.map((level) => {
    const introduces = rhythm.introduces[String(level.number)] ?? [];
    const report = DifficultyMetrics.measure(level, new Set(prior));
    for (const m of mechanicsOf(introduces)) prior.add(m);
    return { number: level.number, titleKey: level.titleKey ?? level.id, introduces, report };
  });
}

const failureMessages: string[] = [];

function measureEndless(): EndlessRow[] {
  const rows: EndlessRow[] = [];
  for (const levelNumber of ENDLESS_LEVEL_NUMBERS) {
    const reports: DifficultyReport[] = [];
    let failures = 0;
    for (const seed of ENDLESS_SEEDS) {
      try {
        const generated = ProceduralGenerator.generateEndlessLevel(levelNumber, seed);
        reports.push(DifficultyMetrics.measure({ ...generated.level, solution: encodeActions(generated.solution) }));
      } catch (error) {
        failures++;
        failureMessages.push(
          `endless ${levelNumber} seed ${seed}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const means: Record<string, number | null> = {};
    for (const field of MEAN_FIELDS) means[field] = mean(reports.map((r) => fieldOf(r, field)));
    rows.push({
      levelNumber,
      seeds: ENDLESS_SEEDS.length,
      failures,
      unsolved: reports.filter((r) => !r.solved).length,
      means,
      reports
    });
  }
  return rows;
}

/** Endless level number whose mean of `metric` is nearest to `value`; ties go to the lower number. */
function closestEndless(rows: EndlessRow[], metric: BaselineMetric, value: number): number {
  let best = rows[0].levelNumber;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const m = row.means[metric];
    if (m === null) continue;
    const gap = Math.abs(m - value);
    if (gap < bestGap) {
      best = row.levelNumber;
      bestGap = gap;
    }
  }
  return best;
}

function irreversibleSummary(report: DifficultyReport): string {
  const parts = IRREVERSIBLE_KINDS.filter((k) => report.irreversibleByKind[k] > 0).map(
    (k) => `${k}:${report.irreversibleByKind[k]}`
  );
  return parts.length > 0 ? parts.join(' ') : '-';
}

function campaignTable(rows: CampaignRow[]): string[] {
  const lines = [
    '| # | title key | introduces | moves | waits | pushes | irrev. | after 1st | danger | min dist | time margin s | concepts (new) | dead-end | junction | solved |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  ];
  for (const { number, titleKey, introduces, report: r } of rows) {
    lines.push(
      `| ${number} | ${titleKey} | ${introduces.join(', ') || '-'} | ${r.moves} | ${r.waits} | ${r.pushes} | ${r.irreversibleEvents} | ${percent(r.shareAfterFirstIrreversible)} | ${r.dangerSteps} | ${r.minMonsterDistance ?? '-'} | ${fmt(r.timeMarginSeconds, SECONDS_DECIMALS)} | ${r.mechanicCount} (${r.newMechanics.length}) | ${percent(r.deadShare)} | ${percent(r.junctionShare)} | ${r.solved ? 'yes' : 'NO'} |`
    );
  }
  return lines;
}

function chapterSection(rhythm: CampaignRhythm, rows: CampaignRow[]): string[] {
  const lines = [
    '| chapter | levels | moves mean (min-max) | pushes mean | irrev. mean | danger mean | concepts mean | new concepts total | dead-end mean |',
    '|---|---|---|---|---|---|---|---|---|'
  ];
  for (const chapter of rhythm.chapters) {
    const inChapter = rows.filter((r) => chapter.levels.includes(r.number));
    if (inChapter.length === 0) continue;
    const moves = inChapter.map((r) => r.report.moves);
    const col = (pick: (r: DifficultyReport) => number): string =>
      fmt(mean(inChapter.map((r) => pick(r.report))), MEAN_DECIMALS);
    lines.push(
      `| ${chapter.titleKey} | ${chapter.levels[0]}-${chapter.levels[chapter.levels.length - 1]} | ${fmt(mean(moves), MEAN_DECIMALS)} (${Math.min(...moves)}-${Math.max(...moves)}) | ${col((r) => r.pushes)} | ${col((r) => r.irreversibleEvents)} | ${col((r) => r.dangerSteps)} | ${col((r) => r.mechanicCount)} | ${inChapter.reduce((s, r) => s + r.report.newMechanics.length, 0)} | ${percent(mean(inChapter.map((r) => r.report.deadShare)))} |`
    );
  }
  return lines;
}

function endlessTable(rows: EndlessRow[]): string[] {
  const lines = [
    `| endless level | seeds ok | moves | waits | pushes | irrev. | danger | min dist | time margin s | concepts | dead-end | junction |`,
    '|---|---|---|---|---|---|---|---|---|---|---|---|'
  ];
  for (const row of rows) {
    const m = row.means;
    lines.push(
      `| ${row.levelNumber} | ${row.seeds - row.failures - row.unsolved}/${row.seeds} | ${fmt(m.moves, MEAN_DECIMALS)} | ${fmt(m.waits, MEAN_DECIMALS)} | ${fmt(m.pushes, MEAN_DECIMALS)} | ${fmt(m.irreversibleEvents, MEAN_DECIMALS)} | ${fmt(m.dangerSteps, MEAN_DECIMALS)} | ${fmt(m.minMonsterDistance, MEAN_DECIMALS)} | ${fmt(m.timeMarginSeconds, SECONDS_DECIMALS)} | ${fmt(m.mechanicCount, MEAN_DECIMALS)} | ${percent(m.deadShare)} | ${percent(m.junctionShare)} |`
    );
  }
  return lines;
}

/** Nearest endless level number, marked "<" or ">" when the value lies outside every endless mean. */
function placement(endless: EndlessRow[], row: CampaignRow, metric: BaselineMetric): string {
  const value = row.report[metric];
  const means = endless.map((e) => e.means[metric]).filter((m): m is number => m !== null);
  const marker = value < Math.min(...means) ? '<' : value > Math.max(...means) ? '>' : '';
  return `${marker}${row.closestEndless[metric]}`;
}

function placementTable(rows: CampaignRow[], endless: EndlessRow[]): string[] {
  const lines = [
    '| # | moves -> endless | pushes -> endless | irrev. -> endless | danger -> endless |',
    '|---|---|---|---|---|'
  ];
  for (const row of rows) {
    const cells = BASELINE_METRICS.map((metric) => placement(endless, row, metric));
    lines.push(`| ${row.number} | ${cells.join(' | ')} |`);
  }
  return lines;
}

const METRIC_DOCS: Array<[string, string]> = [
  ['moves, waits', 'Solution actions that are moves or waits. Proxy for length and timing; the solution is one winning route, not the shortest.'],
  ['pushes', 'Moves that shifted a block. Proxy for planning load; also counts blocks carried by ice or force floors.'],
  ['reversals', 'Consecutive moves in opposite directions. Proxy for backtracking; blind to other detours.'],
  ['revisit ratio, distinct cells', 'Positions sampled after each action over distinct positions. Slides are sampled only where they stop.'],
  ['steps per walkable cell', 'Solution actions over walkable cells of the map. Proxy for how much of the map the route uses.'],
  ['irreversible events', `Terrain or entity changes that cannot be undone, by kind (${IRREVERSIBLE_KINDS.join(', ')}). Toggle walls, flame jets and laser gates are reversible and skipped; a hidden wall turning into floor is free and skipped, one that closes a cell for good (wall_raised) counts; item pickups are not counted; a block sinking into water counts once as water_filled, and walking over the dirt it leaves counts as dirt_cleared.`],
  ['after 1st', 'Share of the solution after the action holding the first irreversible event. Proxy for how long a commitment lasts.'],
  ['danger', `Actions after which a monster is within Chebyshev distance ${DEFAULT_DIFFICULTY_CONFIG.dangerDistance} of the player. Sampled once per action, so a brush between two actions is missed.`],
  ['min dist', 'Smallest Chebyshev distance to a monster seen after an action.'],
  ['time margin', 'Time limit plus bonus time minus the solution own seconds. Proxy for the slack a slower player has; the solution has no hesitation.'],
  ['concepts (new)', 'Mechanic families present (LevelMetrics classes) and, in parentheses, how many no earlier level introduced according to campaign-rhythm.json.'],
  ['dead-end, junction', 'Share of playfield cells with one, or three or more, walkable neighbours. Structural proxies, blind to hazards and doors.']
];

function buildMarkdown(rhythm: CampaignRhythm, campaign: CampaignRow[], endless: EndlessRow[]): string {
  const lines: string[] = [
    '# Campaign difficulty report',
    '',
    'Raw numbers only: there is no composite score and no ranking, by design. Every figure comes from replaying the level\'s own solution in the real engine, so it describes that route, not a player. Endless levels (same metrics) are an external baseline, not a target.',
    '',
    `Endless sample: levels ${ENDLESS_LEVEL_NUMBERS.join(', ')} over seeds ${ENDLESS_SEEDS.join(', ')}; values are means over the seeds.`,
    '',
    '## Metrics',
    '',
    ...METRIC_DOCS.map(([name, doc]) => `- **${name}**: ${doc}`),
    '',
    '## Campaign levels',
    '',
    ...campaignTable(campaign),
    '',
    'Irreversible events by kind:',
    '',
    ...campaign.filter((r) => r.report.irreversibleEvents > 0).map((r) => `- ${r.number}: ${irreversibleSummary(r.report)}`),
    '',
    '## Chapters',
    '',
    ...chapterSection(rhythm, campaign),
    '',
    '## Endless baseline',
    '',
    ...endlessTable(endless),
    '',
    '## Campaign against the endless baseline',
    '',
    'Each cell is the endless level number whose mean of that metric is closest to the campaign level value. A "<" prefix means the value is below every endless mean, ">" above every one: the nearest number is then only the edge of the sampled range.',
    '',
    ...placementTable(campaign, endless),
    '',
    ...(failureMessages.length > 0
      ? ['## Endless generation errors', '', ...failureMessages.map((m) => `- ${m}`), '']
      : [])
  ];
  return lines.join('\n');
}

it('writes the campaign difficulty report', { timeout: GENERATION_TIMEOUT_MS }, () => {
  loadTestConfigs();
  const pack = designPackFromEnv(DESIGN_PACK_VARIABLES.DIFFICULTY);
  const packLevels = pack.levels();
  const numberOf = new Map(packLevels.map((level) => [level.id, level.number]));
  const rhythm: CampaignRhythm = {
    ...(JSON.parse(readFileSync(pack.rhythmFile, 'utf-8')) as Omit<CampaignRhythm, 'chapters'>),
    // Chapters live in the pack's chapter file, by level id; the tables below group by level number.
    chapters: pack.chapters().map((chapter) => ({
      titleKey: chapter.titleKey,
      levels: chapter.levels.map((id) => {
        const number = numberOf.get(id);
        if (number === undefined) throw new Error(`${pack.id} chapters name an unknown level: ${id}`);
        return number;
      })
    }))
  };
  const endless = measureEndless();
  const campaign: CampaignRow[] = measureCampaign(packLevels, rhythm).map((row) => ({
    ...row,
    closestEndless: Object.fromEntries(
      BASELINE_METRICS.map((metric) => [metric, closestEndless(endless, metric, row.report[metric])])
    ) as Record<BaselineMetric, number>
  }));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputBase = resolve(OUTPUT_DIR, pack.id === CAMPAIGN_PACK_ID ? OUTPUT_BASE_NAME : `${pack.id}-difficulty`);
  writeFileSync(
    `${outputBase}.json`,
    `${JSON.stringify({ config: DEFAULT_DIFFICULTY_CONFIG, campaign, endless }, null, 2)}\n`
  );
  writeFileSync(`${outputBase}.md`, buildMarkdown(rhythm, campaign, endless));
});
