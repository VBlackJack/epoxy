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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { ORDERED_DIRECTIONS } from '../config/constants';
import { GeneratedLevel, ProceduralGenerator } from '../core/ProceduralGenerator';
import { SeededRandom } from '../core/Random';
import { GridPoint } from '../core/types';
import { isPlayerWalkable } from '../core/Walkability';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { profileFor } from './DifficultyProfile';
import { HubPlanner } from './HubPlanner';
import { compilePiece, monsterCount } from './PieceCompiler';
import { CompiledPiece } from './PieceTypes';

const LEVEL_NUMBERS = [10, 20];
const SEED_COUNT = 20;
const SUITE_TIMEOUT_MS = 900000;
const MIN_SHARE_WITH_HUB_MONSTERS = 0.75;
const MIN_SHARE_ALL_PIECES_KEPT = 0.8;
const MIN_OPEN_CHIPS = 3;
/** The finale is the last entry of pieceMotifs and is not a planned puzzle. */
const FINALE_PIECES = 1;

interface Sample {
  generated: GeneratedLevel;
  planned: number;
}

const key = (width: number, p: GridPoint): number => p.y * width + p.x;
const widthOf = (generated: GeneratedLevel): number => generated.level.terrain[0].length;

describe('hub open area of an endless level', () => {
  const samples: Sample[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const cfg = ConfigRegistry.getGame().procedural;
    if (!cfg) throw new Error('game.json has no procedural section');
    for (const n of LEVEL_NUMBERS) {
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        samples.push({
          generated: ProceduralGenerator.generateEndlessLevel(n, seed),
          planned: profileFor('endless', n, cfg).pieceCount
        });
      }
    }
  }, SUITE_TIMEOUT_MS);

  const openOf = (s: Sample) => s.generated.open as NonNullable<GeneratedLevel['open']>;

  it('replays every level and leaves no puzzle to walk around', () => {
    expect(samples).toHaveLength(LEVEL_NUMBERS.length * SEED_COUNT);
    for (const { generated } of samples) {
      expect(replays(generated.level, generated.solution), generated.level.id).toBe(true);
      for (const g of generated.guards) {
        expect(cellReachableWithout(generated.level, g.box, g.guarded), generated.level.id).toBe(false);
      }
    }
  });

  it('keeps the planned pieces in at least 80 percent of the levels', () => {
    const kept = samples.filter((s) => s.generated.pieceMotifs.length - FINALE_PIECES >= s.planned).length;
    expect(kept / samples.length).toBeGreaterThanOrEqual(MIN_SHARE_ALL_PIECES_KEPT);
  });

  it('puts one to three deterministic monsters in the hub region of at least 75 percent of the levels', () => {
    const cfg = ConfigRegistry.getGame().procedural!.hub;
    let withMonsters = 0;
    for (const s of samples) {
      const open = openOf(s);
      expect(open.monsters.length, s.generated.level.id).toBeLessThanOrEqual(cfg.openMonsters.max);
      if (open.monsters.length >= 1) withMonsters++;
      const width = widthOf(s.generated);
      const region = new Set(open.region.map((c) => key(width, c)));
      for (const m of open.monsters) {
        expect(cfg.openMonsters.types, s.generated.level.id).toContain(m.type);
        expect(region.has(key(width, m)), s.generated.level.id).toBe(true);
        expect(s.generated.level.entities.some((e) => e.x === m.x && e.y === m.y && e.type === m.type)).toBe(true);
      }
    }
    expect(withMonsters / samples.length).toBeGreaterThanOrEqual(MIN_SHARE_WITH_HUB_MONSTERS);
  });

  it('keeps the level under the monster cap, hub monsters counted with the pieces', () => {
    const cap = ConfigRegistry.getGame().procedural!.maxMonstersPerLevel;
    for (const s of samples) {
      const monsters = s.generated.level.entities.filter((e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster');
      expect(monsters.length, s.generated.level.id).toBeLessThanOrEqual(cap);
    }
  });

  it('scatters at least three chips over the open area and counts them as required', () => {
    for (const s of samples) {
      const { level } = s.generated;
      const open = openOf(s);
      expect(open.chips.length, level.id).toBeGreaterThanOrEqual(MIN_OPEN_CHIPS);
      for (const c of open.chips) {
        expect(ConfigRegistry.getTile(level.items[c.y][c.x] ?? '').collectible, level.id).toBe('chip');
      }
      const placed = level.items.flat().filter((id) => id && ConfigRegistry.getTile(id).collectible === 'chip').length;
      expect(level.chipsRequired, level.id).toBe(placed);
    }
  });

  it('closes the region: no monster can leave it, whatever its starting cell', () => {
    for (const s of samples) {
      const { level, pieceBoxes } = s.generated;
      const width = widthOf(s.generated);
      const open = openOf(s);
      const region = new Set(open.region.map((c) => key(width, c)));
      for (const monster of open.monsters) {
        const def = ConfigRegistry.getEntityDef(monster.type);
        const enter = (p: GridPoint): boolean => {
          if (p.x < 0 || p.y < 0 || p.y >= level.terrain.length || p.x >= width) return false;
          const tile = ConfigRegistry.getTile(level.terrain[p.y][p.x]);
          return Boolean(tile.passableByMonster) || (tile.hazard === 'fire' && Boolean(def?.immuneToFire));
        };
        const seen = new Set<number>([key(width, monster)]);
        const queue: GridPoint[] = [monster];
        for (let i = 0; i < queue.length; i++) {
          for (const d of ORDERED_DIRECTIONS) {
            const n = { x: queue[i].x + (d === 'E' ? 1 : d === 'W' ? -1 : 0), y: queue[i].y + (d === 'S' ? 1 : d === 'N' ? -1 : 0) };
            if (seen.has(key(width, n)) || !enter(n)) continue;
            seen.add(key(width, n));
            queue.push(n);
          }
        }
        for (const k of seen) {
          const cell = { x: k % width, y: Math.floor(k / width) };
          expect(region.has(k), `${level.id} ${monster.type} reaches ${cell.x},${cell.y}`).toBe(true);
          expect(pieceBoxes.some((b) => cell.x >= b.x0 && cell.x <= b.x1 && cell.y >= b.y0 && cell.y <= b.y1), level.id).toBe(false);
        }
      }
    }
  });

  it('lays gravel on every region cell that touches ground outside the region', () => {
    const apron = ConfigRegistry.getGame().procedural!.hub.apronTerrain;
    for (const s of samples) {
      const { level } = s.generated;
      const width = widthOf(s.generated);
      const open = openOf(s);
      const region = new Set(open.region.map((c) => key(width, c)));
      expect(open.aprons.length, level.id).toBeGreaterThan(0);
      for (const cell of open.region) {
        const leaks = ORDERED_DIRECTIONS.some((d) => {
          const n = { x: cell.x + (d === 'E' ? 1 : d === 'W' ? -1 : 0), y: cell.y + (d === 'S' ? 1 : d === 'N' ? -1 : 0) };
          return !region.has(key(width, n)) && isPlayerWalkable(ConfigRegistry.getTile(level.terrain[n.y][n.x]));
        });
        if (leaks) expect(level.terrain[cell.y][cell.x], `${level.id} ${cell.x},${cell.y}`).toBe(apron);
      }
    }
  });

  it('keeps trap and clone links out of the region', () => {
    for (const s of samples) {
      const { level } = s.generated;
      const width = widthOf(s.generated);
      const region = new Set(openOf(s).region.map((c) => key(width, c)));
      for (const l of level.trapLinks) {
        expect(region.has(key(width, { x: l.buttonX, y: l.buttonY })), level.id).toBe(false);
        expect(region.has(key(width, { x: l.trapX, y: l.trapY })), level.id).toBe(false);
      }
      for (const l of level.cloneLinks) {
        expect(region.has(key(width, { x: l.buttonX, y: l.buttonY })), level.id).toBe(false);
        expect(region.has(key(width, { x: l.clonerX, y: l.clonerY })), level.id).toBe(false);
      }
    }
  });

  it('keeps patches off the monster lanes and the region walkable without boots', () => {
    for (const s of samples) {
      const { level } = s.generated;
      const width = widthOf(s.generated);
      const open = openOf(s);
      const lanes = new Set(open.lanes.map((c) => key(width, c)));
      const hazards = new Set(open.hazards.map((c) => key(width, c)));
      for (const h of open.hazards) {
        expect(['fire', 'water'], level.id).toContain(level.terrain[h.y][h.x]);
        expect(lanes.has(key(width, h)), level.id).toBe(false);
      }
      // On foot, hazards and items left alone, every bare cell of the region stays reachable.
      const region = new Set(open.region.map((c) => key(width, c)));
      const bare = (p: GridPoint): boolean =>
        region.has(key(width, p)) && !hazards.has(key(width, p)) && !level.items[p.y][p.x];
      const start = { x: level.playerStart.x, y: level.playerStart.y };
      const seen = new Set<number>([key(width, start)]);
      const queue: GridPoint[] = [start];
      for (let i = 0; i < queue.length; i++) {
        for (const d of ORDERED_DIRECTIONS) {
          const n = { x: queue[i].x + (d === 'E' ? 1 : d === 'W' ? -1 : 0), y: queue[i].y + (d === 'S' ? 1 : d === 'N' ? -1 : 0) };
          if (seen.has(key(width, n)) || !bare(n)) continue;
          seen.add(key(width, n));
          queue.push(n);
        }
      }
      const bareCells = open.region.filter((c) => bare(c)).length;
      expect(seen.size, level.id).toBe(bareCells);
    }
  });
});

describe('hub open area planning', () => {
  let library: CompiledPiece[] = [];

  beforeAll(() => {
    loadTestConfigs();
    const legend = ConfigRegistry.getPieceLegend();
    const annotations = ConfigRegistry.getMotifAnnotations();
    library = ConfigRegistry.getMotifs().pieces.map((def) => compilePiece(def, legend, annotations[def.id]));
  });

  const profile = (pieceCount: number) => ({
    ...profileFor('endless', 1, ConfigRegistry.getGame().procedural!),
    pieceCount
  });

  it('asks for no monster under the configured difficulty, then one more per step, up to the maximum', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const rule = cfg.hub.openMonsters;
    const quiet = library.find((p) => monsterCount(p) === 0) as CompiledPiece;
    const count = (pieces: number): number =>
      HubPlanner.openMonsterTypes([], quiet, profile(pieces), cfg.hub, new SeededRandom(1)).length;
    const cap = cfg.maxMonstersPerLevel;
    expect(count(rule.fromPieces - 1)).toBe(0);
    expect(count(rule.fromPieces)).toBe(Math.min(1, cap));
    expect(count(rule.fromPieces + rule.piecesPerMonster)).toBe(Math.min(2, rule.max, cap));
    expect(count(1000)).toBe(Math.min(rule.max, cap));
  });

  it('draws deterministic movers only, and leaves no room when the pieces already fill the cap', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const quiet = library.find((p) => monsterCount(p) === 0) as CompiledPiece;
    const types = HubPlanner.openMonsterTypes([], quiet, profile(1000), cfg.hub, new SeededRandom(2));
    for (const type of types) expect(cfg.hub.openMonsters.types).toContain(type);
    const crowded = library.filter((p) => monsterCount(p) > 0);
    const pieces: CompiledPiece[] = [];
    while (pieces.reduce((sum, p) => sum + monsterCount(p), 0) < cfg.maxMonstersPerLevel) pieces.push(crowded[0]);
    expect(HubPlanner.openMonsterTypes(pieces, quiet, profile(1000), cfg.hub, new SeededRandom(3))).toHaveLength(0);
  });

  it('asks for more chips as the level grows, between the configured bounds', () => {
    const cfg = ConfigRegistry.getGame().procedural!.hub;
    expect(HubPlanner.openChipCount(0, cfg)).toBe(cfg.openChips.min);
    expect(HubPlanner.openChipCount(1000, cfg)).toBe(cfg.openChips.max);
    const sizes = [6, 8, 10].map((n) => HubPlanner.openChipCount(n, cfg));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});
