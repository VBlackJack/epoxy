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

import { CloneLink, CompiledLevel, Direction, EntityPlacement, TrapLink } from '../types';
import { ENTITY, TILE } from './lynxConstants';

/**
 * Helpers that build tiny Lynx levels from rows of glyphs, for tests.
 *
 * Base glyphs: # wall, . floor, @ Chip on floor, W water, F fire, X exit,
 * S socket, H hint, G gravel, D dirt, 1 2 3 4 red/blue/yellow/green doors,
 * r u y g red/blue/yellow/green keys, i chip item, m bomb, p fire boots,
 * q water boots, B block facing north. Rows shorter than the widest are
 * padded with wall. A test adds or replaces glyphs with `glyphs`.
 */

/** What a glyph stands for. A plain string is a terrain id. */
export interface GlyphMeaning {
  terrain?: string;
  item?: string;
  /** A creature standing on the cell (a block or a monster). */
  entity?: { type: string; dir?: Direction };
}

export type GlyphOverride = string | GlyphMeaning;

export interface LynxLevelOptions {
  id?: string;
  number?: number;
  timeLimitSeconds?: number;
  chipsRequired?: number;
  /** The `playerStart.dir` written in the level; Lynx ignores it and Chip faces south. */
  playerDir?: Direction;
  glyphs?: Record<string, GlyphOverride>;
  /** Monsters and blocks placed by coordinates. */
  entities?: EntityPlacement[];
  trapLinks?: TrapLink[];
  cloneLinks?: CloneLink[];
}

const DEFAULT_LEVEL_ID = 'lynx_test';
const DEFAULT_LEVEL_NUMBER = 1;
const TEST_PASSWORD = 'TEST';
const BLOCK_DRAWN_FACING: Direction = 'N';
const CHIP_GLYPH = '@';

const BASE_GLYPHS: Record<string, GlyphMeaning> = {
  '#': { terrain: TILE.wall },
  '.': { terrain: TILE.floor },
  [CHIP_GLYPH]: { terrain: TILE.floor },
  W: { terrain: TILE.water },
  F: { terrain: TILE.fire },
  X: { terrain: TILE.exit },
  S: { terrain: TILE.socket },
  H: { terrain: TILE.hint },
  G: { terrain: TILE.gravel },
  D: { terrain: TILE.dirt },
  '1': { terrain: 'door_red' },
  '2': { terrain: 'door_blue' },
  '3': { terrain: 'door_yellow' },
  '4': { terrain: 'door_green' },
  r: { item: 'key_red' },
  u: { item: 'key_blue' },
  y: { item: 'key_yellow' },
  g: { item: 'key_green' },
  i: { item: TILE.chip },
  m: { item: TILE.bomb },
  p: { item: 'boots_fire' },
  q: { item: 'boots_water' },
  B: { entity: { type: ENTITY.block, dir: BLOCK_DRAWN_FACING } }
};

/** A monster or block placed by coordinates. */
export function monster(type: string, x: number, y: number, dir: Direction): EntityPlacement {
  return { type, x, y, dir };
}

function meaningOf(glyph: string, overrides: Record<string, GlyphOverride>): GlyphMeaning {
  const override = overrides[glyph];
  if (override !== undefined) return typeof override === 'string' ? { terrain: override } : override;
  const base = BASE_GLYPHS[glyph];
  if (!base) throw new Error(`Unknown test map glyph "${glyph}"`);
  return base;
}

/** Builds a Lynx level from rows of glyphs. */
export function lynxLevel(rows: string[], options: LynxLevelOptions = {}): CompiledLevel {
  const overrides = options.glyphs ?? {};
  const width = Math.max(...rows.map((row) => row.length));
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  const entities: EntityPlacement[] = [];
  let start: { x: number; y: number } | null = null;

  for (const [y, row] of rows.entries()) {
    const terrainRow: string[] = [];
    const itemRow: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const glyph = row[x] ?? '#';
      const meaning = meaningOf(glyph, overrides);
      terrainRow.push(meaning.terrain ?? TILE.floor);
      itemRow.push(meaning.item ?? null);
      if (meaning.entity) entities.push({ x, y, type: meaning.entity.type, dir: meaning.entity.dir ?? BLOCK_DRAWN_FACING });
      if (glyph === CHIP_GLYPH && start === null) start = { x, y };
    }
    terrain.push(terrainRow);
    items.push(itemRow);
  }
  if (start === null) throw new Error('A test map needs a Chip glyph');

  return {
    id: options.id ?? DEFAULT_LEVEL_ID,
    ruleset: 'lynx',
    number: options.number ?? DEFAULT_LEVEL_NUMBER,
    password: TEST_PASSWORD,
    timeLimitSeconds: options.timeLimitSeconds ?? 0,
    chipsRequired: options.chipsRequired ?? 0,
    playerStart: { ...start, dir: options.playerDir ?? 'S' },
    terrain,
    items,
    entities: [...entities, ...(options.entities ?? [])],
    trapLinks: options.trapLinks ?? [],
    cloneLinks: options.cloneLinks ?? []
  };
}
