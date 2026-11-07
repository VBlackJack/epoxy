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

import { ConfigRegistry } from './ConfigRegistry';
import { DEFAULT_FACING, DEFAULT_LEVEL_PASSWORD } from './constants';
import { isDirection, isInBounds, isRecord } from './ConfigValidation';
import {
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  SignalLink,
  TrapLink,
  WinRule
} from '../core/types';

export type EncyclopediaFamilyId =
  | 'sluice'
  | 'extraction'
  | 'optics'
  | 'kinetic'
  | 'network'
  | 'automata'
  | 'transit'
  | 'ballistics'
  | 'parity';

export interface EncyclopediaFamily {
  id: EncyclopediaFamilyId;
  title: string;
  titleFr: string;
  summary: string;
  summaryFr: string;
}

export interface EncyclopediaLegendEntry {
  terrain: string;
  item?: string;
  entity?: string;
  entityDir?: Direction;
  start?: Direction;
}

export interface EncyclopediaChaining {
  imports: string[];
  exports: string[];
  combinesWith: string[];
}

export interface EncyclopediaBlueprint {
  winRule: WinRule;
  chipsRequired: number;
  legend: Record<string, EncyclopediaLegendEntry>;
  rows: string[];
  trapLinks?: TrapLink[];
  cloneLinks?: CloneLink[];
  signalLinks?: SignalLink[];
  solution: string;
}

export interface EncyclopediaArchetype {
  id: string;
  family: EncyclopediaFamilyId;
  tier: number;
  title: string;
  titleFr: string;
  summary: string;
  summaryFr: string;
  mechanics: string[];
  invariants: string[];
  deadEndTraps: string[];
  chaining: EncyclopediaChaining;
  blueprint: EncyclopediaBlueprint;
}

export interface ExcavationEncyclopedia {
  version: string;
  families: EncyclopediaFamily[];
  archetypes: EncyclopediaArchetype[];
}

const VALID_FAMILIES: readonly EncyclopediaFamilyId[] = [
  'sluice',
  'extraction',
  'optics',
  'kinetic',
  'network',
  'automata',
  'transit',
  'ballistics',
  'parity'
];
const VALID_WIN_RULES: readonly WinRule[] = ['exit', 'targets', 'receivers'];
const SOLUTION_PATTERN = /^[NESW.XGT]+$/;
const MIN_ARCHETYPE_TIER = 1;
const MAX_ARCHETYPE_TIER = 5;
const ARCHETYPE_LEVEL_PREFIX = 'encyclopedia_';

function validateLegend(id: string, legend: unknown): string[] {
  if (!isRecord(legend)) return [`${id}: legend must be an object`];
  const errors: string[] = [];
  const tiles = ConfigRegistry.getTiles().tiles;
  for (const [glyph, raw] of Object.entries(legend)) {
    if ([...glyph].length !== 1) {
      errors.push(`${id}: legend key "${glyph}" must be a single character`);
      continue;
    }
    if (!isRecord(raw) || typeof raw.terrain !== 'string' || !(raw.terrain in tiles)) {
      errors.push(`${id}: legend "${glyph}" references an unknown terrain`);
      continue;
    }
    if (tiles[raw.terrain].layer !== 'terrain') {
      errors.push(`${id}: legend "${glyph}" terrain "${raw.terrain}" must have layer "terrain"`);
    }
    if (raw.item !== undefined) {
      if (typeof raw.item !== 'string' || !(raw.item in tiles) || tiles[raw.item].layer !== 'item') {
        errors.push(`${id}: legend "${glyph}" references an invalid item`);
      }
    }
    if (raw.entity !== undefined) {
      if (typeof raw.entity !== 'string' || !ConfigRegistry.getEntityDef(raw.entity)) {
        errors.push(`${id}: legend "${glyph}" references an unknown entity`);
      }
    }
    if (raw.entityDir !== undefined && !isDirection(raw.entityDir)) {
      errors.push(`${id}: legend "${glyph}" has an invalid entityDir`);
    }
    if (raw.start !== undefined && !isDirection(raw.start)) {
      errors.push(`${id}: legend "${glyph}" has an invalid start direction`);
    }
  }
  return errors;
}

function validateBlueprint(id: string, bp: unknown): string[] {
  if (!isRecord(bp)) return [`${id}: blueprint must be an object`];
  const errors: string[] = [];
  if (!VALID_WIN_RULES.includes(bp.winRule as WinRule)) {
    errors.push(`${id}: blueprint has an invalid winRule`);
  }
  if (typeof bp.chipsRequired !== 'number' || !Number.isInteger(bp.chipsRequired) || bp.chipsRequired < 0) {
    errors.push(`${id}: blueprint.chipsRequired must be a non-negative integer`);
  }
  if (typeof bp.solution !== 'string' || bp.solution.length === 0 || !SOLUTION_PATTERN.test(bp.solution)) {
    errors.push(`${id}: blueprint.solution must be a non-empty string of N/E/S/W/./X/G/T actions`);
  }
  const legendErrors = validateLegend(id, bp.legend);
  errors.push(...legendErrors);
  if (legendErrors.length > 0) return errors;

  const legend = bp.legend as Record<string, EncyclopediaLegendEntry>;
  if (!Array.isArray(bp.rows) || bp.rows.length === 0 || !bp.rows.every((r) => typeof r === 'string')) {
    errors.push(`${id}: blueprint.rows must be a non-empty string array`);
    return errors;
  }
  const rows = bp.rows as string[];
  const width = [...rows[0]].length;
  const height = rows.length;
  let starts = 0;
  rows.forEach((row, y) => {
    const chars = [...row];
    if (chars.length !== width) errors.push(`${id}: row ${y} is not ${width} wide`);
    for (const ch of chars) {
      const entry = legend[ch];
      if (!entry) errors.push(`${id}: row ${y} uses "${ch}", missing from legend`);
      else if (entry.start !== undefined) starts++;
    }
  });
  if (starts !== 1) errors.push(`${id}: blueprint needs exactly 1 start cell, found ${starts}`);

  for (const link of (bp.trapLinks as TrapLink[] | undefined) ?? []) {
    if (!isInBounds(link.buttonX, link.buttonY, width, height) || !isInBounds(link.trapX, link.trapY, width, height)) {
      errors.push(`${id}: trapLink out of bounds`);
    }
  }
  for (const link of (bp.cloneLinks as CloneLink[] | undefined) ?? []) {
    if (!isInBounds(link.buttonX, link.buttonY, width, height) || !isInBounds(link.clonerX, link.clonerY, width, height)) {
      errors.push(`${id}: cloneLink out of bounds`);
    }
  }
  for (const link of (bp.signalLinks as SignalLink[] | undefined) ?? []) {
    if (!isInBounds(link.fromX, link.fromY, width, height) || !isInBounds(link.toX, link.toY, width, height)) {
      errors.push(`${id}: signalLink out of bounds`);
    }
  }
  return errors;
}

/**
 * Validates the structural and referential integrity of the excavation puzzle
 * encyclopedia JSON. Returns an empty array when valid.
 */
export function findEncyclopediaErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ['encyclopedia must be an object'];
  const errors: string[] = [];
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    errors.push('version must be a non-empty string');
  }
  if (!Array.isArray(raw.families) || raw.families.length === 0) {
    errors.push('families must be a non-empty array');
    return errors;
  }
  const seenFamilies = new Set<string>();
  for (const fam of raw.families) {
    if (!isRecord(fam) || !VALID_FAMILIES.includes(fam.id as EncyclopediaFamilyId)) {
      errors.push('family has an invalid id');
      continue;
    }
    const famId = fam.id as EncyclopediaFamilyId;
    if (seenFamilies.has(famId)) errors.push(`duplicate family id "${famId}"`);
    seenFamilies.add(famId);
    for (const key of ['title', 'titleFr', 'summary', 'summaryFr'] as const) {
      if (typeof fam[key] !== 'string' || (fam[key] as string).length === 0) {
        errors.push(`family "${fam.id}": ${key} must be a non-empty string`);
      }
    }
  }

  if (!Array.isArray(raw.archetypes) || raw.archetypes.length === 0) {
    errors.push('archetypes must be a non-empty array');
    return errors;
  }
  const seenArchetypes = new Set<string>();
  for (const arch of raw.archetypes) {
    if (!isRecord(arch) || typeof arch.id !== 'string' || arch.id.length === 0) {
      errors.push('archetype is missing a valid id');
      continue;
    }
    const id = arch.id;
    if (seenArchetypes.has(id)) errors.push(`duplicate archetype id "${id}"`);
    seenArchetypes.add(id);
    if (!seenFamilies.has(String(arch.family))) {
      errors.push(`${id}: unknown family "${String(arch.family)}"`);
    }
    if (
      typeof arch.tier !== 'number' ||
      !Number.isInteger(arch.tier) ||
      arch.tier < MIN_ARCHETYPE_TIER ||
      arch.tier > MAX_ARCHETYPE_TIER
    ) {
      errors.push(`${id}: tier must be an integer between ${MIN_ARCHETYPE_TIER} and ${MAX_ARCHETYPE_TIER}`);
    }
    for (const key of ['title', 'titleFr', 'summary', 'summaryFr'] as const) {
      if (typeof arch[key] !== 'string' || (arch[key] as string).length === 0) {
        errors.push(`${id}: ${key} must be a non-empty string`);
      }
    }
    for (const listKey of ['mechanics', 'invariants', 'deadEndTraps'] as const) {
      const list = arch[listKey];
      if (!Array.isArray(list) || list.length === 0 || !list.every((s) => typeof s === 'string' && s.length > 0)) {
        errors.push(`${id}: ${listKey} must be a non-empty string array`);
      }
    }
    if (!isRecord(arch.chaining)) {
      errors.push(`${id}: chaining must be an object`);
    } else {
      for (const cKey of ['imports', 'exports', 'combinesWith'] as const) {
        const list = arch.chaining[cKey];
        if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
          errors.push(`${id}: chaining.${cKey} must be a string array`);
        }
      }
    }
    errors.push(...validateBlueprint(id, arch.blueprint));
  }
  return errors;
}

/**
 * Compiles an encyclopedia archetype's reference blueprint into a playable
 * CompiledLevel ready for GameEngine and LevelValidator.
 */
export function compileArchetypeBlueprint(
  archetype: EncyclopediaArchetype,
  index: number = 1
): CompiledLevel {
  const { blueprint } = archetype;
  const entities: EntityPlacement[] = [];
  let playerStart: CompiledLevel['playerStart'] = { x: 1, y: 1, dir: DEFAULT_FACING };
  const items: (string | null)[][] = [];
  const terrain = blueprint.rows.map((row, y) => {
    items.push([]);
    return [...row].map((ch, x) => {
      const entry = blueprint.legend[ch];
      items[y].push(entry.item ?? null);
      if (entry.entity) {
        entities.push({
          type: entry.entity,
          x,
          y,
          dir: entry.entityDir ?? DEFAULT_FACING
        });
      }
      if (entry.start) {
        playerStart = { x, y, dir: entry.start };
      }
      return entry.terrain;
    });
  });

  return {
    id: `${ARCHETYPE_LEVEL_PREFIX}${archetype.id}`,
    number: index,
    password: DEFAULT_LEVEL_PASSWORD,
    timeLimitSeconds: 0,
    chipsRequired: blueprint.chipsRequired,
    ...(blueprint.winRule === 'exit' ? {} : { winRule: blueprint.winRule }),
    playerStart,
    terrain,
    items,
    entities,
    trapLinks: (blueprint.trapLinks ?? []).map((l) => ({ ...l })),
    cloneLinks: (blueprint.cloneLinks ?? []).map((l) => ({ ...l })),
    ...(blueprint.signalLinks && blueprint.signalLinks.length > 0
      ? { signalLinks: blueprint.signalLinks.map((l) => ({ ...l })) }
      : {}),
    solution: blueprint.solution
  };
}
