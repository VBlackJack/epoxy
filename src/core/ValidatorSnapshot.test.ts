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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import templatesJson from '../../public/configs/templates.json';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { templateContent, LevelTemplate } from '../editor/levelTemplates';
import laserShowcase from '../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../test/fixtures/mechanicsShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, LevelBlueprint } from './types';

/** Generous per-test timeout: the whole shipped set is validated in a single test. */
const SNAPSHOT_TIMEOUT_MS = 120_000;

const templates = (templatesJson as unknown as { templates: LevelTemplate[] }).templates;

function templateLevel(template: LevelTemplate): CompiledLevel {
  const content = templateContent(template);
  return {
    id: `template_${template.id}`,
    ...(content.winRule === 'exit' ? {} : { winRule: content.winRule }),
    ...(content.ruleset ? { ruleset: content.ruleset } : {}),
    number: 1,
    password: 'TEST',
    timeLimitSeconds: content.timeLimitSeconds,
    chipsRequired: content.chipsRequired,
    ...content.map
  };
}

function showcaseLevels(label: string, pack: unknown): CompiledLevel[] {
  const blueprints = (pack as { levels: LevelBlueprint[] }).levels;
  return blueprints.map((bp, index) => ({ ...ConfigRegistry.compileBlueprint(bp), id: `${label}_${index}` }));
}

/** What the validator says about a level: issues in a stable order, plus its stats. */
function describeReport(level: CompiledLevel): unknown {
  const report = LevelValidator.validate(level);
  const issues = report.issues
    .map((issue) => ({ severity: issue.severity, i18nKey: issue.i18nKey, params: issue.params ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { valid: report.valid, issues, stats: report.stats };
}

function describeAll(levels: CompiledLevel[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const level of levels) out[level.id] = describeReport(level);
  return out;
}

describe('validator output of every shipped level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('campaign levels', { timeout: SNAPSHOT_TIMEOUT_MS }, () => {
    expect(describeAll(ConfigRegistry.getLevels())).toMatchSnapshot();
  });

  it('pilot levels', { timeout: SNAPSHOT_TIMEOUT_MS }, () => {
    expect(describeAll(ConfigRegistry.getPilotLevels())).toMatchSnapshot();
  });

  it('level templates', { timeout: SNAPSHOT_TIMEOUT_MS }, () => {
    expect(describeAll(templates.map(templateLevel))).toMatchSnapshot();
  });

  it('showcase packs', { timeout: SNAPSHOT_TIMEOUT_MS }, () => {
    const levels = [...showcaseLevels('mechanics', mechanicsShowcase), ...showcaseLevels('laser', laserShowcase)];
    expect(levels.length).toBeGreaterThan(0);
    expect(describeAll(levels)).toMatchSnapshot();
  });
});
