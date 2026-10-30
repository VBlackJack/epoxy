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

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel } from '../core/types';
import { exitReachableWithout } from '../generator/GuardCheck';
import { decodeActions, PieceSolver } from '../generator/PieceSolver';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { resolveMessage, TranslationNode } from '../i18n/messageFormat';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES_FILE = resolve(ROOT, 'tools', 'campaign-routes.json');
const RHYTHM_FILE = resolve(ROOT, 'tools', 'campaign-rhythm.json');
/** An item id no level holds, to prove an exit does not depend on what is not there. */
const UNRELATED_ITEM = 'no_such_item';
const EN = enLocale as TranslationNode;
const FR = frLocale as TranslationNode;

interface CampaignRoutes {
  levels: Record<string, { segments: string[]; requires?: string[] }>;
}

interface CampaignRhythm {
  chapters: Array<{ titleKey: string; levels: number[] }>;
  introduces: Record<string, string[]>;
  firstTimedLevel: number;
  minTimeMargin: number;
  raceLevels: number[];
  minRaceMargin: number;
  baseline: string[];
}

interface DesignInput {
  levels: CompiledLevel[];
  routes: CampaignRoutes;
  rhythm: CampaignRhythm;
  locales: TranslationNode[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

/** Seconds a level's own solution takes, replayed in a fresh engine. */
function solutionSeconds(level: CompiledLevel): number | null {
  if (!level.solution) return null;
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const action of decodeActions(level.solution)) {
    if (!PieceSolver.play(engine, action)) return null;
  }
  return engine.getTick() / ConfigRegistry.getGame().timing.ticksPerSecond;
}

/** Every terrain id, item id and entity type a level uses. */
function idsIn(level: CompiledLevel): Set<string> {
  const ids = new Set<string>();
  level.terrain.forEach((row) => row.forEach((id) => ids.add(id)));
  level.items.forEach((row) => row.forEach((id) => id && ids.add(id)));
  level.entities.forEach((e) => ids.add(e.type));
  level.cloneLinks.forEach((l) => ids.add(l.templateType));
  return ids;
}

function coverageProblems({ levels, routes }: DesignInput): string[] {
  const problems: string[] = [];
  const known = new Set(levels.map((l) => l.id));
  for (const level of levels) if (!routes.levels[level.id]) problems.push(`${level.id}: no route`);
  for (const id of Object.keys(routes.levels)) if (!known.has(id)) problems.push(`${id}: route without a level`);
  return problems;
}

function requirementProblems({ levels, routes }: DesignInput): string[] {
  const problems: string[] = [];
  for (const level of levels) {
    if (!exitReachableWithout(level, UNRELATED_ITEM)) problems.push(`${level.id}: exit unreachable at all`);
    for (const item of routes.levels[level.id]?.requires ?? []) {
      if (exitReachableWithout(level, item)) problems.push(`${level.id}: exit reachable without ${item}`);
    }
  }
  return problems;
}

function introductionProblems({ levels, rhythm }: DesignInput): string[] {
  const problems: string[] = [];
  const baseline = new Set(rhythm.baseline);
  const firstSeen = new Map<string, number>();
  for (const level of levels) {
    for (const id of idsIn(level)) if (!baseline.has(id) && !firstSeen.has(id)) firstSeen.set(id, level.number);
  }
  for (const [id, number] of firstSeen) {
    if (!(rhythm.introduces[String(number)] ?? []).includes(id)) {
      problems.push(`level ${number}: ${id} appears first here but is not declared`);
    }
  }
  for (const [number, ids] of Object.entries(rhythm.introduces)) {
    for (const id of ids) {
      const seen = firstSeen.get(id);
      if (seen === undefined) problems.push(`level ${number}: declares ${id}, which is in no level`);
      else if (seen !== Number(number)) problems.push(`level ${number}: declares ${id}, first seen at level ${seen}`);
    }
  }
  return problems;
}

function timingProblems({ levels, rhythm }: DesignInput): string[] {
  const problems: string[] = [];
  for (const level of levels) {
    if (level.number < rhythm.firstTimedLevel) {
      if (level.timeLimitSeconds !== 0) problems.push(`${level.id}: timed before level ${rhythm.firstTimedLevel}`);
      continue;
    }
    const seconds = solutionSeconds(level);
    if (seconds === null) {
      problems.push(`${level.id}: no replayable solution to measure`);
      continue;
    }
    const margin = rhythm.raceLevels.includes(level.number) ? rhythm.minRaceMargin : rhythm.minTimeMargin;
    if (level.timeLimitSeconds < margin * seconds) {
      problems.push(`${level.id}: ${level.timeLimitSeconds}s allowed, solution takes ${seconds}s, margin ${margin} needed`);
    }
  }
  return problems;
}

function hintProblems({ levels, rhythm, locales }: DesignInput): string[] {
  const problems: string[] = [];
  const hasText = (tree: TranslationNode, key: string | undefined): boolean => Boolean(key && resolveMessage(tree, key));
  for (const level of levels) {
    if (!level.terrain.flat().some((id) => ConfigRegistry.getTile(id).showsHint)) {
      problems.push(`${level.id}: no hint tile`);
    }
    const keys: Array<[string, string | undefined]> = [
      ['titleKey', level.titleKey],
      ['hintKey', level.hintKey]
    ];
    for (const [name, key] of keys) {
      if (locales.some((tree) => !hasText(tree, key))) problems.push(`${level.id}: ${name} ${key} missing in a locale`);
    }
  }
  for (const chapter of rhythm.chapters) {
    if (locales.some((tree) => !hasText(tree, chapter.titleKey))) {
      problems.push(`chapter ${chapter.titleKey}: missing in a locale`);
    }
  }
  return problems;
}

function chapterProblems({ levels, rhythm }: DesignInput): string[] {
  const listed = rhythm.chapters.flatMap((c) => c.levels);
  const expected = levels.map((l) => l.number);
  return JSON.stringify(listed) === JSON.stringify(expected)
    ? []
    : [`chapters list levels ${listed.join()} but the campaign runs ${expected.join()}`];
}

const CHECKS: Array<[string, (input: DesignInput) => string[]]> = [
  ['every level has a route and every route a level', coverageProblems],
  ['every required item is needed to reach the exit', requirementProblems],
  ['every tile, item and entity is introduced where declared', introductionProblems],
  ['time limits keep their margin over the solution', timingProblems],
  ['every level has a hint tile and its texts in both languages', hintProblems],
  ['chapters cover every level once, in order', chapterProblems]
];

describe('campaign design', () => {
  let input: DesignInput;

  beforeAll(() => {
    loadTestConfigs();
    input = {
      levels: ConfigRegistry.getLevels(),
      routes: readJson<CampaignRoutes>(ROUTES_FILE),
      rhythm: readJson<CampaignRhythm>(RHYTHM_FILE),
      locales: [EN, FR]
    };
  });

  for (const [name, check] of CHECKS) {
    it(name, () => {
      expect(check(input)).toEqual([]);
    });
  }
});

describe('campaign design checks on a fixture', () => {
  const FIXTURE_LOCALES: TranslationNode[] = [
    {
      levels: { level_1: { title: 'One', hint: 'First' }, level_2: { title: 'Two', hint: 'Second' } },
      chapter: { one: 'Chapter' }
    }
  ];

  function fixture(): DesignInput {
    const first: CompiledLevel = {
      ...buildTestLevel(['@HCSE'], { chipsRequired: 1 }),
      id: 'fix_1',
      number: 1,
      titleKey: 'levels.level_1.title',
      hintKey: 'levels.level_1.hint',
      solution: 'EEEE'
    };
    const second: CompiledLevel = {
      ...buildTestLevel(['@HrRE'], { timeLimitSeconds: 60 }),
      id: 'fix_2',
      number: 2,
      titleKey: 'levels.level_2.title',
      hintKey: 'levels.level_2.hint',
      solution: 'EEEE'
    };
    return {
      levels: [first, second],
      routes: { levels: { fix_1: { segments: ['EEEE'] }, fix_2: { segments: ['EEEE'], requires: ['key_red'] } } },
      rhythm: {
        chapters: [{ titleKey: 'chapter.one', levels: [1, 2] }],
        introduces: { '1': ['hint', 'chip', 'socket', 'exit'], '2': ['door_red', 'key_red'] },
        firstTimedLevel: 2,
        minTimeMargin: 3,
        raceLevels: [],
        minRaceMargin: 1.5,
        baseline: ['floor', 'wall']
      },
      locales: FIXTURE_LOCALES
    };
  }

  beforeAll(() => {
    loadTestConfigs();
  });

  it('accepts a consistent campaign', () => {
    const input = fixture();
    for (const [name, check] of CHECKS) expect(check(input), name).toEqual([]);
  });

  it('reports a missing route and a route without a level', () => {
    const input = fixture();
    delete input.routes.levels.fix_1;
    input.routes.levels.ghost = { segments: [] };
    expect(coverageProblems(input)).toEqual(['fix_1: no route', 'ghost: route without a level']);
  });

  it('reports a required item the exit does not depend on', () => {
    const input = fixture();
    input.routes.levels.fix_2.requires = ['key_blue'];
    expect(requirementProblems(input)).toEqual(['fix_2: exit reachable without key_blue']);
  });

  it('reports undeclared and misdeclared introductions', () => {
    const input = fixture();
    input.rhythm.introduces['2'] = ['door_red', 'boots_fire'];
    input.rhythm.introduces['1'].push('key_red');
    const problems = introductionProblems(input);
    expect(problems).toContain('level 2: key_red appears first here but is not declared');
    expect(problems).toContain('level 2: declares boots_fire, which is in no level');
    expect(problems).toContain('level 1: declares key_red, first seen at level 2');
  });

  it('reports a thin time margin and a timed level before the first timed one', () => {
    const input = fixture();
    input.levels[1].timeLimitSeconds = 1;
    input.levels[0].timeLimitSeconds = 30;
    const problems = timingProblems(input);
    expect(problems[0]).toContain('fix_1: timed before level 2');
    expect(problems[1]).toContain('fix_2: 1s allowed');
    input.rhythm.raceLevels = [2];
    const seconds = solutionSeconds(input.levels[1]) as number;
    input.levels[1].timeLimitSeconds = Math.ceil(input.rhythm.minRaceMargin * seconds);
    expect(timingProblems(input)).toEqual(['fix_1: timed before level 2']);
  });

  it('reports a missing hint tile and missing texts', () => {
    const input = fixture();
    input.levels[1] = {
      ...buildTestLevel(['@.rRE']),
      id: 'fix_2',
      number: 2,
      titleKey: 'levels.level_3.title',
      hintKey: 'levels.level_2.hint'
    };
    input.rhythm.chapters[0].titleKey = 'chapter.two';
    const problems = hintProblems(input);
    expect(problems).toContain('fix_2: no hint tile');
    expect(problems).toContain('fix_2: titleKey levels.level_3.title missing in a locale');
    expect(problems).toContain('chapter chapter.two: missing in a locale');
  });

  it('reports chapters that skip, repeat or reorder levels', () => {
    const input = fixture();
    input.rhythm.chapters = [{ titleKey: 'chapter.one', levels: [2, 1] }];
    expect(chapterProblems(input)).toHaveLength(1);
    input.rhythm.chapters = [{ titleKey: 'chapter.one', levels: [1] }];
    expect(chapterProblems(input)).toHaveLength(1);
  });
});
