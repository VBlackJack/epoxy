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

import type { CompiledLevel, Direction } from '../types';
import { displayItemId, displayTerrainId } from './display';
import type { Cc3dCell, Cc3dColor, Cc3dItem, Cc3dLevel, Cc3dMob, Cc3dMobKind, Cc3dTerrain, Cc3dTerrainKind } from './model';

/**
 * Helpers that build tiny CC3D levels from rows of glyphs, for tests.
 *
 * Base glyphs: # wall, . floor, @ player on floor, W water, F fire, X exit,
 * I ice, L slime, T turtle, D dirt, G gravel, A sand, O bomb, S socket,
 * ^ > v < force floors, ? random force floor, t red teleport, k blue teleport,
 * P push up wall, Q appearing wall, V false wall, N tools gate, n keys gate,
 * H closed hold door, h open hold door, J closed toggle door, j open toggle door,
 * 1 2 3 4 red/blue/yellow/green doors, r u y g red/blue/yellow/green keys,
 * i FISH, e extra FISH, a ice orb, o force orb, f fire orb, w water orb, s speed orb,
 * K dirt block, Z ice block, C blue colour block, M walker (a monster, still in C1).
 * Rows shorter than the widest are padded with wall. A test adds or replaces
 * glyphs with `glyphs`.
 */

/** What a glyph stands for. */
export interface GlyphMeaning {
  /** The terrain stack, bottom first; plain floor when absent. */
  stack?: Cc3dTerrain[];
  item?: Cc3dItem;
  /** A mob standing on the cell (a block or a monster). */
  mob?: { kind: Cc3dMobKind; dir?: Direction; color?: Cc3dColor; mirror?: string };
  panels?: Direction[];
}

export interface Cc3dLevelOptions {
  id?: string;
  number?: number;
  timeLimitSeconds?: number;
  glyphs?: Record<string, GlyphMeaning>;
}

const DEFAULT_LEVEL_ID = 'cc3d_test';
const DEFAULT_LEVEL_NUMBER = 1;
const TEST_PASSWORD = 'TEST';
const PLAYER_GLYPH = '@';
const DEFAULT_MOB_DIR: Direction = 'N';
const PLAYER_START_DIR: Direction = 'S';

/** A one-terrain stack. */
export function terrain(kind: Cc3dTerrainKind, extra: Partial<Cc3dTerrain> = {}): GlyphMeaning {
  return { stack: [{ kind, ...extra }] };
}

/** A stack: floor-like at the bottom, blockers or devices above. */
export function stacked(...layers: Cc3dTerrain[]): GlyphMeaning {
  return { stack: layers };
}

/** A floor with panels (thin walls) on the given sides. */
export function panelled(...sides: Direction[]): GlyphMeaning {
  return { stack: [{ kind: 'floor' }], panels: sides };
}

const DOOR_COLORS: Record<string, Cc3dColor> = { '1': 'red', '2': 'blue', '3': 'yellow', '4': 'green' };

const BASE_GLYPHS: Record<string, GlyphMeaning> = {
  '#': terrain('wall'),
  '.': terrain('floor'),
  [PLAYER_GLYPH]: terrain('floor'),
  W: terrain('water'),
  F: terrain('fire'),
  X: terrain('exit'),
  I: terrain('ice'),
  L: terrain('slime'),
  T: terrain('turtle'),
  D: terrain('dirt'),
  G: terrain('gravel'),
  A: terrain('sand'),
  O: stacked({ kind: 'floor' }, { kind: 'bomb' }),
  S: stacked({ kind: 'floor' }, { kind: 'socket' }),
  '^': terrain('force', { dir: 'N' }),
  '>': terrain('force', { dir: 'E' }),
  v: terrain('force', { dir: 'S' }),
  '<': terrain('force', { dir: 'W' }),
  '?': terrain('force_random'),
  t: terrain('teleport_red'),
  k: terrain('teleport_blue'),
  P: stacked({ kind: 'floor' }, { kind: 'push_up_wall' }),
  Q: stacked({ kind: 'floor' }, { kind: 'appearing_wall' }),
  V: stacked({ kind: 'floor' }, { kind: 'false_wall' }),
  N: stacked({ kind: 'floor' }, { kind: 'gate_tools' }),
  n: stacked({ kind: 'floor' }, { kind: 'gate_keys' }),
  H: stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: false }),
  h: stacked({ kind: 'floor' }, { kind: 'hold_door', color: 'green', open: true }),
  J: stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'green', open: false }),
  j: stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'green', open: true }),
  r: { item: { kind: 'key', color: 'red' } },
  u: { item: { kind: 'key', color: 'blue' } },
  y: { item: { kind: 'key', color: 'yellow' } },
  g: { item: { kind: 'key', color: 'green' } },
  i: { item: { kind: 'fish' } },
  e: { item: { kind: 'fish_extra' } },
  a: { item: { kind: 'orb_ice' } },
  o: { item: { kind: 'orb_force' } },
  f: { item: { kind: 'orb_fire' } },
  w: { item: { kind: 'orb_water' } },
  s: { item: { kind: 'orb_speed' } },
  K: { mob: { kind: 'block_dirt' } },
  Z: { mob: { kind: 'block_ice' } },
  C: { mob: { kind: 'block_color', color: 'blue' } },
  M: { mob: { kind: 'walker' } }
};
for (const [glyph, color] of Object.entries(DOOR_COLORS)) {
  BASE_GLYPHS[glyph] = stacked({ kind: 'floor' }, { kind: 'door', color });
}

function meaningOf(glyph: string, overrides: Record<string, GlyphMeaning>): GlyphMeaning {
  const found = overrides[glyph] ?? BASE_GLYPHS[glyph];
  if (!found) throw new Error(`Unknown test map glyph "${glyph}"`);
  return found;
}

/** Builds the CC3D model of a level from rows of glyphs. */
export function cc3dModel(rows: string[], overrides: Record<string, GlyphMeaning> = {}): Cc3dLevel {
  const width = Math.max(...rows.map((row) => row.length));
  const cells: Cc3dCell[] = [];
  const mobs: Cc3dMob[] = [];
  let player: { x: number; y: number } | null = null;
  for (const [y, row] of rows.entries()) {
    for (let x = 0; x < width; x++) {
      const glyph = row[x] ?? '#';
      const meaning = meaningOf(glyph, overrides);
      cells.push({
        terrain: structuredClone(meaning.stack ?? [{ kind: 'floor' }]),
        panels: [...(meaning.panels ?? [])],
        item: meaning.item ? { ...meaning.item } : null
      });
      if (meaning.mob) {
        mobs.push({
          kind: meaning.mob.kind,
          x,
          y,
          dir: meaning.mob.dir ?? DEFAULT_MOB_DIR,
          color: meaning.mob.color,
          mirror: meaning.mob.mirror
        });
      }
      if (glyph === PLAYER_GLYPH && player === null) player = { x, y };
    }
  }
  if (player === null) throw new Error('A test map needs a player glyph');
  return { width, height: rows.length, cells, mobs, player };
}

/** Builds a playable CompiledLevel from rows of glyphs. */
export function cc3dLevel(rows: string[], options: Cc3dLevelOptions = {}): CompiledLevel {
  const model = cc3dModel(rows, options.glyphs);
  const terrainRows: string[][] = [];
  const itemRows: (string | null)[][] = [];
  for (let y = 0; y < model.height; y++) {
    const cellsOfRow = model.cells.slice(y * model.width, (y + 1) * model.width);
    terrainRows.push(cellsOfRow.map((c) => displayTerrainId(c)));
    itemRows.push(cellsOfRow.map((c) => displayItemId(c.item)));
  }
  return {
    id: options.id ?? DEFAULT_LEVEL_ID,
    ruleset: 'cc3d',
    cc3d: model,
    number: options.number ?? DEFAULT_LEVEL_NUMBER,
    password: TEST_PASSWORD,
    timeLimitSeconds: options.timeLimitSeconds ?? 0,
    chipsRequired: model.cells.filter((c) => c.item?.kind === 'fish').length,
    playerStart: { ...model.player, dir: PLAYER_START_DIR },
    terrain: terrainRows,
    items: itemRows,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}
