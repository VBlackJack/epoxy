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
 * Measures where the map area of an endless level goes: hub outline, hub
 * region, wing floor, piece boxes, walls, and the free land the hub region
 * could still have grown into. For a sample of seeds at three level numbers,
 * writes local/hub-area-study.<tag>.json and ASCII maps of the first seeds to
 * local/hub-area-maps.<tag>.txt (the folder is not versioned).
 *
 * Run with: npm run report:hub
 * HUB_STUDY_VARIANT may hold a JSON object merged over `procedural.hub`, and
 * HUB_STUDY_TAG names the output files (default "baseline"), so levers are
 * compared on the same seeds; HUB_STUDY_SEEDS and HUB_STUDY_LEVELS set the sample.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { ORDERED_DIRECTIONS } from '../src/config/constants';
import { LevelMetrics } from '../src/core/LevelMetrics';
import { GeneratedLevel, ProceduralGenerator } from '../src/core/ProceduralGenerator';
import { GridPoint } from '../src/core/types';
import { isPlayerWalkable } from '../src/core/Walkability';
import { profileFor } from '../src/generator/DifficultyProfile';
import { HUB_FLOOR_CHAR } from '../src/generator/HubOutline';
import { MAP_MARGIN } from '../src/generator/HubTypes';
import { cellReachableWithout, replays } from '../src/test/levelChecks';
import { createTestBundle } from '../src/test/loadTestConfigs';
import { measureOpenArea } from '../src/test/openAreaMetrics';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.env.HUB_STUDY_TAG ?? 'baseline';
const OUTPUT_FILE = resolve(ROOT, 'local', `hub-area-study.${TAG}.json`);
const MAPS_FILE = resolve(ROOT, 'local', `hub-area-maps.${TAG}.txt`);
const SEEDS = Array.from({ length: Number(process.env.HUB_STUDY_SEEDS ?? 20) }, (_, i) => i + 1);
const LEVEL_NUMBERS = (process.env.HUB_STUDY_LEVELS ?? '1,10,20').split(',').map(Number);
const MAPPED_SEEDS = 4;
/** The last entry of pieceMotifs is the finale, not a planned puzzle. */
const FINALE_PIECES = 1;
const P95 = 0.95;
const JSON_INDENT = 2;
const WALL_TILE_ID = 'wall';

interface Sample {
  seed: number;
  level: number;
  shape: string;
  outlineCells: number;
  planned: number;
  kept: number;
  ms: number;
  walkable: number;
  boxArea: number;
  boxCount: number;
  walkableInBoxes: number;
  regionCells: number;
  regionBare: number;
  wingFloor: number;
  wallCells: number;
  pocketCells: number;
  expandable: number;
  expandableFrontier: number;
  boundsArea: number;
  contentShare: number;
  hubMonsters: number;
  proven: boolean;
  bypassable: boolean;
  junction: number;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function summarize(values: number[]): Record<string, number | null> {
  return { median: median(values), p10: quantile(values, 0.1), p90: quantile(values, 0.9), p95: quantile(values, P95), mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
}

function outlineCellsOf(shape: string): number {
  const def = ConfigRegistry.getGame().procedural?.hub.shapes.find((s) => s.id === shape);
  return def ? def.rows.reduce((sum, row) => sum + [...row].filter((ch) => ch === HUB_FLOOR_CHAR).length, 0) : 0;
}

/** Classifies every interior cell and measures the free land the hub region could still join. */
function analyze(generated: GeneratedLevel): { sample: Omit<Sample, 'seed' | 'level' | 'planned' | 'ms'>; map: string } {
  const { level, pieceBoxes, open } = generated;
  const height = level.terrain.length;
  const width = level.terrain[0].length;
  const key = (p: GridPoint): number => p.y * width + p.x;
  const inMap = (p: GridPoint): boolean => p.x >= MAP_MARGIN && p.y >= MAP_MARGIN && p.x < width - MAP_MARGIN && p.y < height - MAP_MARGIN;
  const inBox = (p: GridPoint): boolean => pieceBoxes.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
  const region = new Set((open?.region ?? []).map(key));
  const aprons = new Set((open?.aprons ?? []).map(key));
  const hazards = new Set((open?.hazards ?? []).map(key));
  const isWall = (p: GridPoint): boolean => level.terrain[p.y][p.x] === WALL_TILE_ID;
  const walkableAt = (p: GridPoint): boolean => isPlayerWalkable(ConfigRegistry.getTile(level.terrain[p.y][p.x]));
  const step = (p: GridPoint, d: string): GridPoint => ({ x: p.x + (d === 'E' ? 1 : d === 'W' ? -1 : 0), y: p.y + (d === 'S' ? 1 : d === 'N' ? -1 : 0) });

  let walkable = 0;
  let walkableInBoxes = 0;
  let wallCells = 0;
  let pocketCells = 0;
  let wingFloor = 0;
  let regionBare = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  // A free cell may join the hub region when it lies in no box and touches, besides walls, hub cells only.
  const joinable = (p: GridPoint): boolean => {
    if (!inMap(p) || !isWall(p) || inBox(p)) return false;
    return ORDERED_DIRECTIONS.every((d) => {
      const n = step(p, d);
      if (region.has(key(n))) return true;
      return isWall(n) || (inBox(n) && !walkableAt(n));
    });
  };
  for (let y = MAP_MARGIN; y < height - MAP_MARGIN; y++) {
    for (let x = MAP_MARGIN; x < width - MAP_MARGIN; x++) {
      const p = { x, y };
      const k = key(p);
      const boxed = inBox(p);
      if (walkableAt(p) || !isWall(p)) {
        if (!isWall(p)) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        if (walkableAt(p)) walkable++;
        if (boxed) {
          if (walkableAt(p)) walkableInBoxes++;
        } else if (region.has(k)) {
          if (!hazards.has(k) && !level.items[y][x]) regionBare++;
        } else if (walkableAt(p)) {
          wingFloor++;
        }
        continue;
      }
      if (boxed) continue;
      wallCells++;
      const nearOpen = ORDERED_DIRECTIONS.some((d) => {
        const n = step(p, d);
        return !isWall(n) || inBox(n);
      });
      if (!nearOpen) pocketCells++;
    }
  }
  // Free land the fringe could still have added, grown layer by layer from the region as the assembler does.
  const grown = new Set(region);
  const frontier: GridPoint[] = [];
  const joinableNow = (p: GridPoint): boolean => {
    if (!inMap(p) || !isWall(p) || inBox(p) || grown.has(key(p))) return false;
    return ORDERED_DIRECTIONS.every((d) => {
      const n = step(p, d);
      if (grown.has(key(n))) return true;
      return isWall(n) || (inBox(n) && !walkableAt(n));
    });
  };
  for (const k of region) {
    const p = { x: k % width, y: Math.floor(k / width) };
    for (const d of ORDERED_DIRECTIONS) {
      const n = step(p, d);
      if (joinableNow(n)) frontier.push(n);
    }
  }
  let expandableFrontier = 0;
  for (const p of frontier) if (!grown.has(key(p)) && joinable(p)) { grown.add(key(p)); expandableFrontier++; }
  // Keep growing to see how much the region would reach without any cap.
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = MAP_MARGIN; y < height - MAP_MARGIN; y++) {
      for (let x = MAP_MARGIN; x < width - MAP_MARGIN; x++) {
        const p = { x, y };
        if (grown.has(key(p)) || !joinableNow(p)) continue;
        if (!ORDERED_DIRECTIONS.some((d) => grown.has(key(step(p, d))))) continue;
        grown.add(key(p));
        changed = true;
      }
    }
  }
  const expandable = grown.size - region.size;

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const p = { x, y };
      const k = key(p);
      const item = level.items[y][x];
      if (p.x === level.playerStart.x && p.y === level.playerStart.y) row += '@';
      else if (level.entities.some((e) => e.x === x && e.y === y && region.has(k))) row += 'M';
      else if (aprons.has(k)) row += 'g';
      else if (hazards.has(k)) row += '~';
      else if (region.has(k)) row += item ? 'c' : '.';
      else if (inBox(p)) row += isWall(p) ? '#' : walkableAt(p) ? '+' : 'x';
      else if (!isWall(p)) row += ':';
      else if (grown.has(k)) row += ',';
      else row += ' ';
    }
    rows.push(row);
  }
  const metrics = LevelMetrics.measure(level);
  const sample = {
    shape: generated.hubShape ?? '',
    outlineCells: outlineCellsOf(generated.hubShape ?? ''),
    kept: generated.pieceMotifs.length - FINALE_PIECES,
    walkable,
    boxArea: pieceBoxes.reduce((sum, b) => sum + (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1), 0),
    boxCount: pieceBoxes.length,
    walkableInBoxes,
    regionCells: region.size,
    regionBare,
    wingFloor,
    wallCells,
    pocketCells,
    expandable,
    expandableFrontier,
    boundsArea: maxX >= minX ? (maxX - minX + 1) * (maxY - minY + 1) : 0,
    contentShare: measureOpenArea(generated).contentShare,
    hubMonsters: open?.monsters.length ?? 0,
    proven: replays(generated.level, generated.solution),
    bypassable: generated.guards.some((g) => cellReachableWithout(generated.level, g.box, g.guarded)),
    junction: metrics.junctionShare
  };
  return { sample, map: rows.join('\n') };
}

function report(samples: Sample[]): Record<string, unknown> {
  const n = Math.max(1, samples.length);
  const field = (pick: (s: Sample) => number) => summarize(samples.map(pick));
  const shapes: Record<string, number> = {};
  for (const s of samples) shapes[s.shape] = (shapes[s.shape] ?? 0) + 1;
  return {
    levels: samples.length,
    shareAllPlannedPiecesKept: samples.filter((s) => s.kept >= s.planned).length / n,
    unproven: samples.filter((s) => !s.proven).length,
    bypassable: samples.filter((s) => s.bypassable).length,
    shareWithHubMonsters: samples.filter((s) => s.hubMonsters > 0).length / n,
    generationMs: field((s) => s.ms),
    planned: field((s) => s.planned),
    outlineCells: field((s) => s.outlineCells),
    regionCells: field((s) => s.regionCells),
    regionBare: field((s) => s.regionBare),
    wingFloor: field((s) => s.wingFloor),
    walkable: field((s) => s.walkable),
    walkableInBoxes: field((s) => s.walkableInBoxes),
    boxArea: field((s) => s.boxArea),
    boxCount: field((s) => s.boxCount),
    wallCells: field((s) => s.wallCells),
    pocketCells: field((s) => s.pocketCells),
    expandable: field((s) => s.expandable),
    expandableFrontier: field((s) => s.expandableFrontier),
    boundsArea: field((s) => s.boundsArea),
    contentShare: field((s) => s.contentShare),
    junction: field((s) => s.junction),
    shapes
  };
}

it('measures where the map area of endless levels goes', () => {
  const bundle = createTestBundle();
  const variant = process.env.HUB_STUDY_VARIANT;
  if (variant) Object.assign(bundle.game.procedural!.hub, JSON.parse(variant));
  ConfigRegistry.applyConfigs(bundle);
  const cfg = ConfigRegistry.getGame().procedural;
  if (!cfg) throw new Error('game.json has no procedural section');
  const samples: Sample[] = [];
  const maps: string[] = [];
  let failures = 0;
  for (const level of LEVEL_NUMBERS) {
    for (const seed of SEEDS) {
      const started = performance.now();
      try {
        const generated = ProceduralGenerator.generateEndlessLevel(level, seed);
        const ms = performance.now() - started;
        const { sample, map } = analyze(generated);
        const full: Sample = { seed, level, planned: profileFor('endless', level, cfg).pieceCount, ms, ...sample };
        samples.push(full);
        if (seed <= MAPPED_SEEDS) {
          maps.push(`level ${level} seed ${seed} shape ${full.shape} planned ${full.planned} kept ${full.kept} region ${full.regionCells} expandable ${full.expandable} pocket ${full.pocketCells} ms ${Math.round(ms)}\n${map}\n`);
        }
      } catch (error) {
        failures++;
        maps.push(`level ${level} seed ${seed}: failed (${(error as Error).message})\n`);
      }
    }
  }
  const byLevel: Record<string, unknown> = {};
  for (const level of LEVEL_NUMBERS) byLevel[`level${level}`] = report(samples.filter((s) => s.level === level));
  const result = { generatedAt: new Date().toISOString(), tag: TAG, variant: variant ? JSON.parse(variant) : null, seeds: SEEDS.length, levels: LEVEL_NUMBERS, failures, all: report(samples), byLevel, samples };
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(result, null, JSON_INDENT)}\n`);
  writeFileSync(MAPS_FILE, maps.join('\n'));
});
