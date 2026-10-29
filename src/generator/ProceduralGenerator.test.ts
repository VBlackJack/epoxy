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
import { GeneratedLevel, ProceduralGenerator } from '../core/ProceduralGenerator';
import { resolveMessage } from '../i18n/messageFormat';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { LevelMetrics } from '../core/LevelMetrics';
import { isPlayerWalkable } from '../core/Walkability';
import { reachableCells } from '../core/PlayfieldMetrics';
import { budgetFor } from './ProgressionPlanner';
import { cellReachableWithout, replays } from '../test/levelChecks';
import { loadTestConfigs } from '../test/loadTestConfigs';

const SAMPLE_SEEDS = [1, 2, 3];
const SAMPLE_LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);
const SAMPLE_TIMEOUT_MS = 120000;
/** Variety expected over the sample: levels must not all look alike. */
const MIN_DISTINCT_HUB_SHAPES = 4;
const MIN_DISTINCT_THEMES = 3;
/** Regression floors on the sample, with slack under what the generator reaches. */
const MAX_MEDIAN_DEAD_SHARE = 0.04;
const MIN_MEDIAN_OPEN_SHARE = 0.55;
const MIN_MEDIAN_FILL = 0.27;

describe('ProceduralGenerator', () => {
  let sample: GeneratedLevel[] = [];

  beforeAll(() => {
    loadTestConfigs();
    sample = SAMPLE_SEEDS.flatMap((seed) =>
      SAMPLE_LEVELS.map((n) => ProceduralGenerator.generateDetailed(n, seed))
    );
  }, SAMPLE_TIMEOUT_MS);

  it('gives the same level for the same seed and level number', () => {
    const again = ProceduralGenerator.generateDetailed(4, SAMPLE_SEEDS[0]);
    expect(again.level).toEqual(sample[3].level);
    expect(again.level.id).toMatch(new RegExp(`^proc_[0-9a-f]+_${SAMPLE_SEEDS[0]}_4$`));
  });

  it('an exported level compiles back unchanged, so it can be pasted into levels.json', () => {
    const exported = JSON.parse(JSON.stringify(sample[5].level));
    const recompiled = ConfigRegistry.compileBlueprint(exported);
    expect(recompiled).toEqual(sample[5].level);
  });

  it('every level is won by replaying its solution in a fresh engine', () => {
    for (const g of sample) expect(replays(g.level, g.solution), g.level.id).toBe(true);
  });

  it('no puzzle can be walked around', () => {
    for (const g of sample) {
      expect(g.guards.length, g.level.id).toBeGreaterThan(0);
      for (const guard of g.guards) {
        expect(
          cellReachableWithout(g.level, guard.box, guard.guarded),
          `${g.level.id} ${g.layout} ${JSON.stringify(guard)}`
        ).toBe(false);
      }
    }
  });

  it('varies hub outlines and themes across levels', () => {
    const shapes = new Set(sample.map((g) => g.hubShape).filter(Boolean));
    const themes = new Set(sample.map((g) => g.level.theme).filter(Boolean));
    expect(shapes.size).toBeGreaterThanOrEqual(MIN_DISTINCT_HUB_SHAPES);
    expect(themes.size).toBeGreaterThanOrEqual(MIN_DISTINCT_THEMES);
  });

  it('builds hub levels from the configured level on', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    for (const g of sample) {
      expect(g.layout, g.level.id).toBe(g.level.number >= cfg.hub.fromLevel ? 'hub' : 'chain');
    }
  });

  it('respects the level budget: piece count and focused motifs', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    for (const g of sample) {
      const budget = budgetFor(g.level.number, cfg);
      expect(g.motifs.length, g.level.id).toBeLessThanOrEqual(budget.motifCount);
      const puzzles = g.pieceMotifs.filter((m) => g.motifs.includes(m));
      expect(puzzles.length, g.level.id).toBeLessThanOrEqual(budget.pieceCount);
    }
  });

  it('never gives two consecutive levels of a pack the same lead motif or hub outline', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    for (const seed of SAMPLE_SEEDS) {
      const pack = sample.filter((g) => g.level.id.includes(`_${seed}_`));
      expect(pack.length).toBe(SAMPLE_LEVELS.length);
      for (let i = 1; i < pack.length; i++) {
        for (let back = 1; back <= cfg.noRepeatWindow && i - back >= 0; back++) {
          expect(pack[i].motifs[0], `${pack[i].level.id} lead motif`).not.toBe(pack[i - back].motifs[0]);
          if (pack[i].hubShape && pack[i - back].hubShape) {
            expect(pack[i].hubShape, `${pack[i].level.id} hub outline`).not.toBe(pack[i - back].hubShape);
          }
        }
      }
    }
  });

  it('makes level 1 one puzzle and the finale', () => {
    for (const g of sample.filter((l) => l.level.number === 1)) {
      expect(g.pieceBoxes, g.level.id).toHaveLength(2);
      expect(g.motifs, g.level.id).toHaveLength(1);
    }
  });

  it('hands boots over on the corridor: no item outside a piece sits in a dead end', () => {
    for (const g of sample) {
      const level = g.level;
      const walkable = level.terrain.map((row) => row.map((id) => isPlayerWalkable(ConfigRegistry.getTile(id))));
      const field = reachableCells(walkable, level.playerStart);
      const open = (x: number, y: number): boolean => Boolean(field[y]?.[x]);
      const inPiece = (x: number, y: number): boolean =>
        g.pieceBoxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      level.items.forEach((row, y) =>
        row.forEach((item, x) => {
          if (!item || !open(x, y) || inPiece(x, y)) return;
          const neighbours = [open(x, y - 1), open(x + 1, y), open(x, y + 1), open(x - 1, y)].filter(Boolean).length;
          expect(neighbours, `${level.id} ${item} at ${x},${y}`).toBeGreaterThanOrEqual(2);
        })
      );
    }
  });

  it('keeps the playfield open: few dead ends, many open squares', () => {
    const reports = sample.map((g) => LevelMetrics.measure(g.level));
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
    expect(median(reports.map((r) => r.deadShare))).toBeLessThanOrEqual(MAX_MEDIAN_DEAD_SHARE);
    expect(median(reports.map((r) => r.openShare))).toBeGreaterThanOrEqual(MIN_MEDIAN_OPEN_SHARE);
    expect(median(reports.map((r) => r.playfieldFill))).toBeGreaterThanOrEqual(MIN_MEDIAN_FILL);
  });

  it('reports how much of the proven run is walking between pieces', () => {
    for (const g of sample) {
      expect(g.walkPerDecision, g.level.id).toBeGreaterThan(0);
      expect(Number.isFinite(g.walkPerDecision), g.level.id).toBe(true);
    }
  });

  it('leaves the first levels untimed and later ones above the proven solution time', () => {
    const timing = ConfigRegistry.getGame().timing;
    const cfg = ConfigRegistry.getGame().procedural!;
    for (const g of sample) {
      if (g.level.number <= cfg.untimedUpToLevel) {
        expect(g.level.timeLimitSeconds, g.level.id).toBe(0);
        continue;
      }
      const minimumSeconds = (g.solution.length * timing.playerMoveCooldownTicks) / timing.ticksPerSecond;
      expect(g.level.timeLimitSeconds, g.level.id).toBeGreaterThan(minimumSeconds);
    }
  });

  it('every playable motif has a translated level title and hint', () => {
    const rules = ConfigRegistry.getMotifs().motifRules ?? {};
    const motifs = new Set(
      ConfigRegistry.getMotifs()
        .pieces.map((p) => p.motif)
        .filter((m) => rules[m]?.role === undefined)
    );
    for (const motif of motifs) {
      for (const key of [`levels.procedural.${motif}.title`, `levels.procedural.${motif}.hint`]) {
        expect(resolveMessage(en, key), key).toBeDefined();
        expect(resolveMessage(fr, key), key).toBeDefined();
      }
    }
  });
});

describe('budgetFor', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('starts with one motif and grows the piece count with the level', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    expect(budgetFor(1, cfg).motifCount).toBe(1);
    expect(budgetFor(1, cfg).maxTier).toBe(1);
    expect(budgetFor(50, cfg).pieceCount).toBe(cfg.maxPieceCount);
    expect(budgetFor(5, cfg).pieceCount).toBeGreaterThan(budgetFor(1, cfg).pieceCount);
  });
});
