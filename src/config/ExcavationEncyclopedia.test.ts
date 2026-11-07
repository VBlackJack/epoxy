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
import { CompiledLevel, UndoSnapshot } from '../core/types';
import { ALL_ORIENTATIONS, compilePiece, orientPiece } from '../generator/PieceCompiler';
import {
  decodeActions,
  DROP_CHARGE_ACTION,
  DROP_GATE_ACTION,
  DROP_STONE_ACTION,
  encodeActions,
  SolverAction,
  PieceSolver,
  WAIT_ACTION
} from '../generator/PieceSolver';
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
const PUZZLE_ITEMS = ['boots_pull', 'boots_fire', 'charge', 'ward', 'hurl_stone', 'pocket_gate'] as const;

function candidateActionsFor(level: CompiledLevel): SolverAction[] {
  const actions: SolverAction[] = [...ORDERED_DIRECTIONS];
  const flatItems = level.items.flat();
  const hasMovingMonster = level.entities.some(
    (e) => ConfigRegistry.getEntityDef(e.type)?.kind === 'monster'
  );
  if (hasMovingMonster || flatItems.includes('charge') || flatItems.includes('hurl_stone')) {
    actions.push(WAIT_ACTION);
  }
  if (flatItems.includes('charge')) actions.push(DROP_CHARGE_ACTION);
  if (flatItems.includes('pocket_gate')) actions.push(DROP_GATE_ACTION);
  if (flatItems.includes('hurl_stone')) actions.push(DROP_STONE_ACTION);
  return actions;
}

function solveLevelBfs(level: CompiledLevel, maxStates = MAX_BFS_STATES): string | null {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const actions = candidateActionsFor(level);
  const queue: Array<{ snap: UndoSnapshot; path: SolverAction[] }> = [
    { snap: engine.captureState(), path: [] }
  ];
  const visited = new Set<string>();

  const sigOf = (eng: GameEngine): string => {
    const s = eng.captureState();
    const p = `${s.player.x},${s.player.y},${s.player.dir},${Array.from(s.player.boots).sort().join('+')}`;
    const k = Object.entries(s.player.keys)
      .filter(([, v]) => v > 0)
      .map(([key, val]) => `${key}:${val}`)
      .sort()
      .join(',');
    const ents = s.entities
      .map((e) => `${e.type}@${e.x},${e.y}:${e.dir}:${e.cooldownTicks}`)
      .sort()
      .join(';');
    const charges = (s.litCharges ?? []).map((c) => `${c.x},${c.y}:${c.detonateTick}`).join(';');
    const shots = (s.shots ?? []).map((sh) => `${sh.x},${sh.y}:${sh.dir}`).join(';');
    const diffs: string[] = [];
    for (let y = 0; y < s.terrain.length; y++) {
      for (let x = 0; x < s.terrain[y].length; x++) {
        const t = s.terrain[y][x];
        if (t !== 'floor' && t !== 'wall') diffs.push(`${x},${y}:${t}`);
        const it = s.items[y][x];
        if (it) diffs.push(`i${x},${y}:${it}`);
      }
    }
    return `${p}|${s.chipsRemaining}|${s.forceCycleTurn}|${k}|${ents}|${charges}|${shots}|${diffs.join(',')}`;
  };

  visited.add(sigOf(engine));
  while (queue.length > 0 && visited.size < maxStates) {
    const { snap, path } = queue.shift()!;
    for (const act of actions) {
      engine.restoreState(snap);
      if (!PieceSolver.play(engine, act)) continue;
      const nextPath = [...path, act];
      if (engine.isLevelCompleted()) return encodeActions(nextPath);
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
  it('passes structural and referential validation with 9 families and 25 canonical archetypes', () => {
    expect(findEncyclopediaErrors(encyclopediaJson)).toEqual([]);
    expect(encyclopedia.families).toHaveLength(9);
    expect(encyclopedia.archetypes).toHaveLength(25);
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
      const actions = decodeActions(archetype.blueprint.solution);
      expect(actions, `${archetype.id} decodeActions`).not.toBeNull();
      for (const step of actions!) {
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

  it('proves every archetype requires every puzzle entity, link, and puzzle item when present', () => {
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
          `${archetype.id} should not be solvable without entity #${entIdx} (${ent.type})`
        ).toBeNull();
      }

      if (level.trapLinks && level.trapLinks.length > 0) {
        const withoutTrapLinks = structuredClone(level);
        withoutTrapLinks.solution = undefined;
        for (const link of withoutTrapLinks.trapLinks) {
          withoutTrapLinks.terrain[link.buttonY][link.buttonX] = 'floor';
        }
        withoutTrapLinks.trapLinks = [];
        expect(
          solveLevelBfs(withoutTrapLinks),
          `${archetype.id} should not be solvable without trapLinks`
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

      for (const itemId of PUZZLE_ITEMS) {
        const hasItem = level.items.some((row) => row.includes(itemId));
        if (!hasItem) continue;
        const withoutItem = structuredClone(level);
        withoutItem.solution = undefined;
        for (let y = 0; y < withoutItem.items.length; y++) {
          for (let x = 0; x < withoutItem.items[y].length; x++) {
            if (withoutItem.items[y][x] === itemId) {
              withoutItem.items[y][x] = null;
            }
          }
        }
        expect(
          solveLevelBfs(withoutItem),
          `${archetype.id} should not be solvable without ${itemId}`
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
      expect(enDoc, `EN doc title mismatch for ${archetype.id}`).toContain(archetype.title);
      expect(enDoc, `EN doc summary mismatch for ${archetype.id}`).toContain(archetype.summary);
      expect(enDoc, `EN doc ASCII mismatch for ${archetype.id}`).toContain(asciiBlock);
      expect(enDoc, `EN doc solution mismatch for ${archetype.id}`).toContain(archetype.blueprint.solution);

      expect(frDoc, `FR doc missing ${archetype.id}`).toContain(archetype.id);
      expect(frDoc, `FR doc titleFr mismatch for ${archetype.id}`).toContain(archetype.titleFr);
      expect(frDoc, `FR doc summaryFr mismatch for ${archetype.id}`).toContain(archetype.summaryFr);
      expect(frDoc, `FR doc ASCII mismatch for ${archetype.id}`).toContain(asciiBlock);
      expect(frDoc, `FR doc solution mismatch for ${archetype.id}`).toContain(archetype.blueprint.solution);

      for (const mechanic of archetype.mechanics) {
        expect(enDoc, `EN doc missing mechanic ${mechanic} for ${archetype.id}`).toContain(mechanic);
        expect(frDoc, `FR doc missing mechanic ${mechanic} for ${archetype.id}`).toContain(mechanic);
      }
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

  it('proves the 10 sanctuary procedural pieces in motifs.json win in all 8 orientations with 0 block escapes and cannot bypass their entities', () => {
    const definitions = ConfigRegistry.getMotifs().pieces.filter((p) => p.id.startsWith('sanctuary_'));
    expect(definitions.map((d) => d.id)).toEqual([
      'sanctuary_sluice_double_trench',
      'sanctuary_alchemy_fire_water_sluice',
      'sanctuary_counterweight_trap_bridge',
      'sanctuary_glacier_corner_sluice',
      'sanctuary_conveyor_sluice',
      'sanctuary_portal_ferry_sluice',
      'sanctuary_toggle_parity_sluice',
      'sanctuary_thief_fire_sluice',
      'sanctuary_tank_reversal_bridge',
      'sanctuary_trap_release_sluice'
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
        const actions = oriented.solution ?? PieceSolver.solve(oriented).moves ?? [];
        expect(PieceSolver.wins(oriented, actions), `${def.id} ${JSON.stringify(o)}`).toBe(true);
      }
    }
  });
});
