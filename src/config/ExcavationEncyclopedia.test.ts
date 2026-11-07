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

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import encyclopediaJson from '../../public/configs/excavation-encyclopedia.json';
import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import { CompiledLevel, Direction, UndoSnapshot } from '../core/types';
import { ALL_ORIENTATIONS, compilePiece, orientPiece } from '../generator/PieceCompiler';
import { PieceSolver } from '../generator/PieceSolver';
import { ConfigRegistry } from './ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ORDERED_DIRECTIONS } from './constants';
import {
  compileArchetypeBlueprint,
  EncyclopediaArchetype,
  ExcavationEncyclopedia,
  findEncyclopediaErrors
} from './excavationEncyclopedia';

const encyclopedia = encyclopediaJson as unknown as ExcavationEncyclopedia;
const MAX_BFS_STATES = 6000;
const FORBIDDEN_TEXT = /[\u2010-\u2015\u2212\u2018-\u201f\u00ab\u00bb\u2026\u00a0\u202f\u2009\u200b\ufeff\u0152\u0153\u00c6\u00e6]|diggy/i;

function solveLevelBfs(level: CompiledLevel, maxStates = MAX_BFS_STATES): string | null {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const queue: Array<{ snap: UndoSnapshot; path: string }> = [{ snap: engine.captureState(), path: '' }];
  const visited = new Set<string>();

  const sigOf = (eng: GameEngine): string => {
    const s = eng.captureState();
    const p = `${s.player.x},${s.player.y},${Array.from(s.player.boots).sort().join('+')}`;
    const k = Object.entries(s.player.keys)
      .filter(([, v]) => v > 0)
      .map(([key, val]) => `${key}:${val}`)
      .sort()
      .join(',');
    const ents = s.entities
      .map((e) => `${e.type}@${e.x},${e.y}`)
      .sort()
      .join(';');
    const diffs: string[] = [];
    for (let y = 0; y < s.terrain.length; y++) {
      for (let x = 0; x < s.terrain[y].length; x++) {
        const t = s.terrain[y][x];
        if (t !== 'floor' && t !== 'wall') diffs.push(`${x},${y}:${t}`);
        const it = s.items[y][x];
        if (it) diffs.push(`i${x},${y}:${it}`);
      }
    }
    return `${p}|${s.chipsRemaining}|${k}|${ents}|${diffs.join(',')}`;
  };

  visited.add(sigOf(engine));
  while (queue.length > 0 && visited.size < maxStates) {
    const { snap, path } = queue.shift()!;
    for (const dir of ORDERED_DIRECTIONS) {
      engine.restoreState(snap);
      if (!PieceSolver.play(engine, dir)) continue;
      const nextPath = path + dir;
      if (engine.isLevelCompleted()) return nextPath;
      const sig = sigOf(engine);
      if (!visited.has(sig)) {
        visited.add(sig);
        queue.push({ snap: engine.captureState(), path: nextPath });
      }
    }
  }
  return null;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('excavation-encyclopedia.json', () => {
  it('passes structural and referential validation with 5 families and 14 canonical archetypes', () => {
    expect(findEncyclopediaErrors(encyclopediaJson)).toEqual([]);
    expect(encyclopedia.families).toHaveLength(5);
    expect(encyclopedia.archetypes).toHaveLength(14);
  });

  it('contains no forbidden typography or external IP references in any field', () => {
    const serialized = JSON.stringify(encyclopediaJson);
    expect(serialized).not.toMatch(FORBIDDEN_TEXT);
  });

  it.each(encyclopedia.archetypes.map((a, idx) => [a.id, a, idx + 1] as const))(
    'archetype %s validates with 0 LevelValidator issues and replays its solution to victory',
    (_id, archetype: EncyclopediaArchetype, index: number) => {
      const level = compileArchetypeBlueprint(archetype, index);
      const report = LevelValidator.validate(level);
      expect(report.issues, `${archetype.id} issues`).toEqual([]);
      expect(report.valid, `${archetype.id} valid`).toBe(true);

      const engine = new GameEngine();
      engine.loadLevel(level);
      for (const step of [...archetype.blueprint.solution] as Direction[]) {
        const ok = PieceSolver.play(engine, step);
        if (!ok) {
          expect(ok, `${archetype.id} step ${step} (bfs: ${solveLevelBfs(level)})`).toBe(true);
        }
        if (engine.isLevelCompleted()) break;
      }
      if (!engine.isLevelCompleted()) {
        expect(
          engine.isLevelCompleted(),
          `${archetype.id} completed (bfs: ${solveLevelBfs(level)})`
        ).toBe(true);
      }
      expect(engine.isLevelCompleted()).toBe(true);
    }
  );

  it('proves every archetype requires every puzzle entity, signal link, and grappling glove when present', () => {
    for (const [idx, archetype] of encyclopedia.archetypes.entries()) {
      const level = compileArchetypeBlueprint(archetype, idx + 1);
      for (let entIdx = 0; entIdx < level.entities.length; entIdx++) {
        const ent = level.entities[entIdx];
        if (level.terrain[ent.y]?.[ent.x] === 'clone_machine') continue;
        const withoutOneEntity = structuredClone(level);
        withoutOneEntity.solution = undefined;
        withoutOneEntity.entities = level.entities.filter((_, i) => i !== entIdx);
        expect(
          solveLevelBfs(withoutOneEntity),
          `${archetype.id} should not be solvable without entity #${entIdx}`
        ).toBeNull();
      }

      if (level.cloneLinks && level.cloneLinks.length > 0) {
        const withoutClones = structuredClone(level);
        withoutClones.solution = undefined;
        withoutClones.cloneLinks = [];
        withoutClones.entities = withoutClones.entities.filter(
          (ent) => withoutClones.terrain[ent.y]?.[ent.x] !== 'clone_machine'
        );
        expect(
          solveLevelBfs(withoutClones),
          `${archetype.id} should not be solvable without cloneLinks`
        ).toBeNull();
      }

      if (level.signalLinks && level.signalLinks.length > 0) {
        const withoutSignalLinks = structuredClone(level);
        withoutSignalLinks.solution = undefined;
        withoutSignalLinks.signalLinks = [];
        expect(
          solveLevelBfs(withoutSignalLinks),
          `${archetype.id} should not be solvable without signalLinks`
        ).toBeNull();
      }

      const usesPull = archetype.mechanics.includes('boots_pull');
      if (usesPull) {
        const withoutPull = structuredClone(level);
        withoutPull.solution = undefined;
        for (let y = 0; y < withoutPull.items.length; y++) {
          for (let x = 0; x < withoutPull.items[y].length; x++) {
            if (withoutPull.items[y][x] === 'boots_pull') {
              withoutPull.items[y][x] = null;
            }
          }
        }
        expect(
          solveLevelBfs(withoutPull),
          `${archetype.id} should not be solvable without boots_pull`
        ).toBeNull();
      }
    }
  });

  it('keeps bilingual Markdown encyclopedia docs synchronized and enforces recursive docs typography guard', () => {
    const docsRoot = path.resolve(__dirname, '../../docs');
    const enDocPath = path.join(docsRoot, 'puzzle-encyclopedia.md');
    const frDocPath = path.join(docsRoot, 'fr', 'puzzle-encyclopedia.md');

    const enDoc = fs.readFileSync(enDocPath, 'utf8');
    const frDoc = fs.readFileSync(frDocPath, 'utf8');

    expect(enDoc).toContain('./fr/puzzle-encyclopedia.md');
    expect(frDoc).toContain('../puzzle-encyclopedia.md');

    for (const archetype of encyclopedia.archetypes) {
      const asciiBlock = archetype.blueprint.rows.join('\n');
      expect(enDoc, `EN doc missing ${archetype.id}`).toContain(archetype.id);
      expect(enDoc, `EN doc ASCII mismatch for ${archetype.id}`).toContain(asciiBlock);
      expect(enDoc, `EN doc solution mismatch for ${archetype.id}`).toContain(archetype.blueprint.solution);

      expect(frDoc, `FR doc missing ${archetype.id}`).toContain(archetype.id);
      expect(frDoc, `FR doc ASCII mismatch for ${archetype.id}`).toContain(asciiBlock);
      expect(frDoc, `FR doc solution mismatch for ${archetype.id}`).toContain(archetype.blueprint.solution);
    }

    const collectMarkdownFiles = (dir: string): string[] => {
      const result: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          result.push(...collectMarkdownFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          result.push(full);
        }
      }
      return result;
    };

    const mdFiles = collectMarkdownFiles(docsRoot);
    const hasSubdirFile = mdFiles.some((f) => path.dirname(f) !== docsRoot);
    expect(hasSubdirFile).toBe(true);

    for (const mdFile of mdFiles) {
      const content = fs.readFileSync(mdFile, 'utf8');
      expect(content, mdFile).not.toMatch(FORBIDDEN_TEXT);
    }
  });

  it('proves the 6 sanctuary procedural pieces in motifs.json win in all 8 orientations with 0 block escapes and cannot bypass their boulders', () => {
    const definitions = ConfigRegistry.getMotifs().pieces.filter((p) => p.id.startsWith('sanctuary_'));
    expect(definitions.map((d) => d.id)).toEqual([
      'sanctuary_sluice_double_trench',
      'sanctuary_alchemy_fire_water_sluice',
      'sanctuary_counterweight_trap_bridge',
      'sanctuary_glacier_corner_sluice',
      'sanctuary_conveyor_sluice',
      'sanctuary_portal_ferry_sluice'
    ]);
    const annotations = ConfigRegistry.getMotifAnnotations();
    for (const def of definitions) {
      const compiled = compilePiece(def, ConfigRegistry.getPieceLegend(), annotations[def.id]);
      expect(compiled.solution, `${def.id} annotated`).toBeDefined();
      const analysis = PieceSolver.analyze(compiled);
      expect(analysis.truncated, `${def.id} truncated`).toBe(false);
      expect(analysis.winnable, `${def.id} winnable`).toBe(true);
      expect(analysis.blockEscapes, `${def.id} blockEscapes`).toBe(0);
      expect(analysis.deadExits, `${def.id} deadExits`).toBe(0);
      expect(compiled.reversible, `${def.id} reversible`).toBe(analysis.unreturnableGoals === 0);
      for (let entIdx = 0; entIdx < compiled.entities.length; entIdx++) {
        const withoutOneEntity = {
          ...compiled,
          entities: compiled.entities.filter((_, i) => i !== entIdx)
        };
        expect(
          PieceSolver.analyze(withoutOneEntity).winnable,
          `${def.id} should not be winnable without entity #${entIdx}`
        ).toBe(false);
      }
      for (const o of ALL_ORIENTATIONS) {
        const oriented = orientPiece(compiled, o);
        expect(PieceSolver.wins(oriented, oriented.solution ?? []), `${def.id} ${JSON.stringify(o)}`).toBe(true);
      }
    }
  });
});
