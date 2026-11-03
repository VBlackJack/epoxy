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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CONFIG_ENDPOINTS, ORDERED_DIRECTIONS } from '../config/constants';
import { Direction, EntityPlacement, Ruleset, WinRule } from '../core/types';
import { EditorMap } from './editorDocument';

/** What one character of a template's rows stands for. */
export interface TemplateLegendEntry {
  terrain: string;
  entity?: string;
  item?: string;
  /** The player starts on this cell, facing this way. */
  start?: Direction;
}

/** A level to start a new editor session from, defined as data in templates.json. */
export interface LevelTemplate {
  id: string;
  labelKey: string;
  winRule: WinRule;
  ruleset: Ruleset;
  timeLimitSeconds: number;
  chipsRequired: number;
  legend: Record<string, TemplateLegendEntry>;
  rows: string[];
}

export interface TemplatesConfig {
  templates: LevelTemplate[];
}

/** What a template sets in the editor document besides the map itself. */
export interface TemplateContent {
  map: EditorMap;
  winRule: WinRule;
  ruleset: Ruleset | undefined;
  timeLimitSeconds: number;
  chipsRequired: number;
}

/** Id of the empty room choice of the New dialog; no template may take it. */
export const EMPTY_TEMPLATE_ID = 'empty';

const WIN_RULES: readonly WinRule[] = ['exit', 'targets', 'receivers'];
/** The rulesets a template may name: Epoxy and Lynx (the empty CC3D room is built by the editor, not read from data). */
const TEMPLATE_RULESETS: readonly Ruleset[] = ['epoxy', 'lynx'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function legendErrors(id: string, legend: unknown): string[] {
  if (!isRecord(legend)) return [`${id}: legend must be an object`];
  const errors: string[] = [];
  for (const [char, raw] of Object.entries(legend)) {
    if ([...char].length !== 1) {
      errors.push(`${id}: legend key "${char}" must be one character`);
      continue;
    }
    if (!isRecord(raw) || typeof raw.terrain !== 'string' || !(raw.terrain in ConfigRegistry.getTiles().tiles)) {
      errors.push(`${id}: legend "${char}" needs a known terrain`);
      continue;
    }
    if (raw.entity !== undefined && (typeof raw.entity !== 'string' || !ConfigRegistry.getEntityDef(raw.entity))) {
      errors.push(`${id}: legend "${char}" names an unknown entity`);
    }
    if (raw.item !== undefined && (typeof raw.item !== 'string' || !(raw.item in ConfigRegistry.getTiles().tiles))) {
      errors.push(`${id}: legend "${char}" names an unknown item`);
    }
    if (raw.start !== undefined && !ORDERED_DIRECTIONS.includes(raw.start as Direction)) {
      errors.push(`${id}: legend "${char}" has an invalid start direction`);
    }
  }
  return errors;
}

function rowsErrors(id: string, rows: unknown, legend: Record<string, unknown>): string[] {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((row) => typeof row === 'string')) {
    return [`${id}: rows must be a non-empty list of strings`];
  }
  const errors: string[] = [];
  const width = [...(rows[0] as string)].length;
  let starts = 0;
  for (const [y, row] of (rows as string[]).entries()) {
    const chars = [...row];
    if (chars.length !== width) errors.push(`${id}: row ${y} is not ${width} wide`);
    for (const char of chars) {
      const entry = legend[char];
      if (entry === undefined) errors.push(`${id}: row ${y} uses "${char}", missing from the legend`);
      else if (isRecord(entry) && entry.start !== undefined) starts++;
    }
  }
  if (starts !== 1) errors.push(`${id}: exactly one start cell is needed, found ${starts}`);
  return errors;
}

/** Every structural or reference problem of a parsed templates.json; empty when it is usable. */
export function findTemplateErrors(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.templates)) return ['templates must be a list'];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.templates.entries()) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') {
      errors.push(`template ${index}: id is missing`);
      continue;
    }
    const id = entry.id;
    if (seen.has(id) || id === EMPTY_TEMPLATE_ID) errors.push(`${id}: duplicate or reserved id`);
    seen.add(id);
    if (typeof entry.labelKey !== 'string' || entry.labelKey === '') errors.push(`${id}: labelKey is missing`);
    if (!WIN_RULES.includes(entry.winRule as WinRule)) errors.push(`${id}: invalid winRule`);
    if (!TEMPLATE_RULESETS.includes(entry.ruleset as Ruleset)) errors.push(`${id}: invalid ruleset`);
    if (entry.ruleset === 'lynx' && entry.winRule !== 'exit') {
      errors.push(`${id}: the lynx ruleset cannot use the ${String(entry.winRule)} win rule`);
    }
    for (const field of ['timeLimitSeconds', 'chipsRequired'] as const) {
      const value = entry[field];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        errors.push(`${id}: ${field} must be a non-negative integer`);
      }
    }
    const legendProblems = legendErrors(id, entry.legend);
    errors.push(...legendProblems);
    if (legendProblems.length === 0) errors.push(...rowsErrors(id, entry.rows, entry.legend as Record<string, unknown>));
  }
  return errors;
}

/** Builds the map and rules a template stands for; the template must already have passed `findTemplateErrors`. */
export function templateContent(template: LevelTemplate): TemplateContent {
  const entities: EntityPlacement[] = [];
  let playerStart: EditorMap['playerStart'] = { x: 0, y: 0, dir: 'S' };
  const items: (string | null)[][] = [];
  const terrain = template.rows.map((row, y) => {
    items.push([]);
    return [...row].map((char, x) => {
      const entry = template.legend[char];
      items[y].push(entry.item ?? null);
      if (entry.entity) entities.push({ type: entry.entity, x, y, dir: 'S' });
      if (entry.start) playerStart = { x, y, dir: entry.start };
      return entry.terrain;
    });
  });
  return {
    map: { terrain, items, entities, trapLinks: [], cloneLinks: [], playerStart },
    winRule: template.winRule,
    // Epoxy is the default ruleset: a level that follows it carries no ruleset field.
    ruleset: template.ruleset === 'epoxy' ? undefined : template.ruleset,
    timeLimitSeconds: template.timeLimitSeconds,
    chipsRequired: template.chipsRequired
  };
}

let cachedTemplates: LevelTemplate[] | null = null;

/**
 * The shipped templates, fetched once. A file that cannot be loaded or does
 * not validate yields null, and is tried again at the next call.
 */
export async function loadLevelTemplates(): Promise<LevelTemplate[] | null> {
  if (cachedTemplates) return cachedTemplates;
  try {
    const response = await fetch(CONFIG_ENDPOINTS.TEMPLATES);
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    if (findTemplateErrors(parsed).length > 0) return null;
    cachedTemplates = (parsed as TemplatesConfig).templates;
    return cachedTemplates;
  } catch {
    return null;
  }
}
