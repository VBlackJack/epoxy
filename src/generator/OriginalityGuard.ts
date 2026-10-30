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

import { CampaignGuardConfig, CompiledLevel, TileDefinition } from '../core/types';

/** Coarse role of a cell, the only thing the originality fingerprints keep. */
export enum CellClass {
  Wall = 0,
  Floor = 1,
  Hazard = 2,
  Door = 3,
  Item = 4,
  Other = 5
}

/** Number of cell classes. */
const CLASS_COUNT = 6;
/** Rotations and mirrors of a square window. */
const SYMMETRY_COUNT = 8;
/** Multipliers and seeds of the two independent 32-bit hashes folded into one 53-bit key. */
const HASH_MULTIPLIER_A = 0x01000193;
const HASH_MULTIPLIER_B = 0x85ebca6b;
const HASH_SEED_A = 0x811c9dc5;
const HASH_SEED_B = 0x9e3779b9;
const HASH_B_FEEDBACK_SHIFT = 15;
/** Bits of the second hash kept in the key; with the 32 bits of the first they stay below 2^53. */
const SECOND_HASH_BITS = 21;
const SECOND_HASH_MASK = (1 << SECOND_HASH_BITS) - 1;
const FIRST_HASH_SHIFT = 2 ** SECOND_HASH_BITS;

/** A level reduced to one class per cell. */
export interface CellGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

/** Canonical window shapes of one level. */
export interface LevelFingerprint {
  label: string;
  windows: Set<number>;
  largeWindows: Set<number>;
}

export interface FingerprintComparison {
  jaccard: number;
  sharedLargeWindows: number;
}

export interface SimilarPair extends FingerprintComparison {
  candidate: string;
  reference: string;
}

/** Classifies one cell from its terrain tile and, when present, its item tile. */
export function classifyCell(terrain: TileDefinition, item: TileDefinition | null): CellClass {
  if (item) {
    if (item.hazard) return CellClass.Hazard;
    if (item.collectible) return CellClass.Item;
  }
  if (terrain.hazard || terrain.slideType) return CellClass.Hazard;
  if (terrain.requiredKey || terrain.requiresAllChips || terrain.togglesTo) return CellClass.Door;
  if (
    terrain.isLevelExit ||
    terrain.isTeleporter ||
    terrain.isTrap ||
    terrain.isCloneMachine ||
    terrain.buttonAction ||
    terrain.showsHint
  ) {
    return CellClass.Other;
  }
  return terrain.passableByPlayer === false ? CellClass.Wall : CellClass.Floor;
}

/** Reduces a compiled level to its cell classes; monsters and blocks are ignored. */
export function toCellGrid(level: CompiledLevel, getTile: (id: string) => TileDefinition): CellGrid {
  const height = level.terrain.length;
  const width = height > 0 ? level.terrain[0].length : 0;
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const itemId = level.items[y]?.[x] ?? null;
      cells[y * width + x] = classifyCell(getTile(level.terrain[y][x]), itemId ? getTile(itemId) : null);
    }
  }
  return { width, height, cells };
}

/** For each symmetry, the source index of every window cell, row-major. */
function buildOrientations(size: number): Int32Array[] {
  const orientations: Int32Array[] = [];
  const last = size - 1;
  for (let mirror = 0; mirror < 2; mirror++) {
    for (let turns = 0; turns < SYMMETRY_COUNT / 2; turns++) {
      const order = new Int32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sx = mirror ? last - x : x;
          let sy = y;
          for (let t = 0; t < turns; t++) {
            const nx = last - sy;
            sy = sx;
            sx = nx;
          }
          order[y * size + x] = sy * size + sx;
        }
      }
      orientations.push(order);
    }
  }
  return orientations;
}

const orientationCache = new Map<number, Int32Array[]>();

function orientationsFor(size: number): Int32Array[] {
  let cached = orientationCache.get(size);
  if (!cached) {
    cached = buildOrientations(size);
    orientationCache.set(size, cached);
  }
  return cached;
}

/**
 * Canonical key of the window whose top-left corner is (x0, y0), or -1 when it
 * is uniform, holds fewer than `minContent` cells that are neither wall nor
 * floor, or has one class covering more than `maxShare` of its cells.
 */
function canonicalWindow(
  grid: CellGrid,
  x0: number,
  y0: number,
  size: number,
  minContent: number,
  maxShare: number,
  orientations: Int32Array[],
  buffer: Uint8Array
): number {
  const first = grid.cells[y0 * grid.width + x0];
  let uniform = true;
  let content = 0;
  const perClass = new Array<number>(CLASS_COUNT).fill(0);
  for (let y = 0; y < size; y++) {
    const base = (y0 + y) * grid.width + x0;
    for (let x = 0; x < size; x++) {
      const value = grid.cells[base + x];
      buffer[y * size + x] = value;
      if (value !== first) uniform = false;
      if (value !== CellClass.Wall && value !== CellClass.Floor) content++;
      perClass[value]++;
    }
  }
  if (uniform || content < minContent) return -1;
  if (Math.max(...perClass) > maxShare * size * size) return -1;
  let best = Number.POSITIVE_INFINITY;
  for (const order of orientations) {
    let a = HASH_SEED_A;
    let b = HASH_SEED_B;
    for (let i = 0; i < order.length; i++) {
      const v = buffer[order[i]] + 1;
      a = Math.imul(a ^ v, HASH_MULTIPLIER_A);
      b = Math.imul(b + v, HASH_MULTIPLIER_B) ^ (b >>> HASH_B_FEEDBACK_SHIFT);
    }
    const key = (a >>> 0) * FIRST_HASH_SHIFT + (b & SECOND_HASH_MASK);
    if (key < best) best = key;
  }
  return best;
}

function windowSet(grid: CellGrid, size: number, minContent: number, maxShare: number): Set<number> {
  const found = new Set<number>();
  if (size <= 0 || grid.width < size || grid.height < size) return found;
  const orientations = orientationsFor(size);
  const buffer = new Uint8Array(size * size);
  for (let y = 0; y + size <= grid.height; y++) {
    for (let x = 0; x + size <= grid.width; x++) {
      const key = canonicalWindow(grid, x, y, size, minContent, maxShare, orientations, buffer);
      if (key >= 0) found.add(key);
    }
  }
  return found;
}

/**
 * Fingerprints a grid: every non-uniform window, canonical under the 8
 * symmetries. Large windows also need some content and some variety, so two
 * levels are not flagged for sharing a stretch of bare floor or a plain ice field.
 */
export function fingerprintGrid(label: string, grid: CellGrid, config: CampaignGuardConfig): LevelFingerprint {
  return {
    label,
    windows: windowSet(grid, config.windowSize, 0, 1),
    largeWindows: windowSet(grid, config.largeWindowSize, config.largeWindowMinContent, config.largeWindowMaxShare)
  };
}

function countShared(a: Set<number>, b: Set<number>): number {
  const [fewer, more] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const key of fewer) if (more.has(key)) shared++;
  return shared;
}

export function compareFingerprints(a: LevelFingerprint, b: LevelFingerprint): FingerprintComparison {
  const shared = countShared(a.windows, b.windows);
  const union = a.windows.size + b.windows.size - shared;
  return {
    jaccard: union === 0 ? 0 : shared / union,
    sharedLargeWindows: countShared(a.largeWindows, b.largeWindows)
  };
}

export function isSimilar(comparison: FingerprintComparison, config: CampaignGuardConfig): boolean {
  return comparison.jaccard >= config.maxJaccard || comparison.sharedLargeWindows > 0;
}

/** Compares every candidate with every reference; returns the pairs sorted by decreasing similarity. */
export function findSimilarPairs(
  candidates: LevelFingerprint[],
  references: LevelFingerprint[],
  config: CampaignGuardConfig,
  options: { flaggedOnly: boolean }
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (const candidate of candidates) {
    for (const reference of references) {
      const comparison = compareFingerprints(candidate, reference);
      if (options.flaggedOnly && !isSimilar(comparison, config)) continue;
      pairs.push({ candidate: candidate.label, reference: reference.label, ...comparison });
    }
  }
  return pairs.sort((x, y) => y.jaccard - x.jaccard || y.sharedLargeWindows - x.sharedLargeWindows);
}
