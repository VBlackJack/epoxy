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
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { LevelValidator } from '../core/LevelValidator';
import { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { evaluateBlocks } from './blockCheck';
import { EMPTY_TEMPLATE_ID, findTemplateErrors, LevelTemplate, templateContent } from './levelTemplates';

const templates = (templatesJson as unknown as { templates: LevelTemplate[] }).templates;

function compile(template: LevelTemplate): CompiledLevel {
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

function lookup(locale: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('templates.json', () => {
  it('is structurally valid and references known tiles and entities', () => {
    expect(findTemplateErrors(templatesJson)).toEqual([]);
  });

  it('offers a Sokoban room and a laser puzzle', () => {
    expect(templates.map((template) => template.id)).toEqual(['sokoban', 'laser']);
  });

  it('labels every template in both languages', () => {
    for (const template of templates) {
      expect(typeof lookup(en, template.labelKey), template.labelKey).toBe('string');
      expect(typeof lookup(fr, template.labelKey), template.labelKey).toBe('string');
    }
  });

  it.each(templates.map((template) => [template.id, template] as const))(
    'the %s template passes the validator with no issue at all',
    (_id, template) => {
      const report = LevelValidator.validate(compile(template));
      expect(report.issues).toEqual([]);
      expect(report.valid).toBe(true);
    }
  );

  it('the Sokoban template is solved by the block check', () => {
    const sokoban = templates.find((template) => template.id === 'sokoban') as LevelTemplate;
    const verdict = evaluateBlocks(compile(sokoban));
    expect(verdict?.kind).toBe('solved');
  });

  it('rejects a Lynx template that is won by targets or receivers', () => {
    const raw = structuredClone(templatesJson) as unknown as { templates: Array<Record<string, unknown>> };
    raw.templates[0].ruleset = 'lynx';
    expect(findTemplateErrors(raw)).toContainEqual(expect.stringContaining('lynx'));
  });

  it('the laser template wins by receivers and keeps the default ruleset field absent', () => {
    const laser = templates.find((template) => template.id === 'laser') as LevelTemplate;
    const level = compile(laser);
    expect(level.winRule).toBe('receivers');
    expect(level.ruleset).toBeUndefined();
  });
});

describe('templateContent', () => {
  it('places the start, the entities and the terrain of the rows', () => {
    const sokoban = templates.find((template) => template.id === 'sokoban') as LevelTemplate;
    const content = templateContent(sokoban);
    expect(content.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
    expect(content.map.entities).toHaveLength(2);
    expect(content.map.terrain.flat().filter((id) => id === 'block_target')).toHaveLength(2);
    expect(content.map.items.length).toBe(content.map.terrain.length);
  });
});

describe('findTemplateErrors', () => {
  function broken(change: (template: Record<string, unknown>) => void): unknown {
    const copy = structuredClone(templatesJson) as unknown as { templates: Array<Record<string, unknown>> };
    change(copy.templates[0]);
    return copy;
  }

  it('rejects a row of the wrong width', () => {
    const raw = broken((t) => ((t.rows as string[])[2] = '#..'));
    expect(findTemplateErrors(raw).length).toBeGreaterThan(0);
  });

  it('rejects a character missing from the legend', () => {
    const raw = broken((t) => ((t.rows as string[])[2] = '#..?....#'));
    expect(findTemplateErrors(raw)).toContainEqual(expect.stringContaining('missing from the legend'));
  });

  it('rejects an unknown tile, a missing start and a reserved id', () => {
    expect(
      findTemplateErrors(broken((t) => ((t.legend as Record<string, { terrain: string }>)['.'].terrain = 'nope')))
    ).toContainEqual(expect.stringContaining('known terrain'));
    expect(
      findTemplateErrors(broken((t) => ((t.rows as string[])[1] = '#.......#')))
    ).toContainEqual(expect.stringContaining('one start'));
    expect(findTemplateErrors(broken((t) => (t.id = EMPTY_TEMPLATE_ID)))).toContainEqual(
      expect.stringContaining('reserved')
    );
  });

  it('rejects a file that is not a list of templates', () => {
    expect(findTemplateErrors({})).not.toEqual([]);
    expect(findTemplateErrors(null)).not.toEqual([]);
  });
});
