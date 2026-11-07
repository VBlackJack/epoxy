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

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import { CompiledLevel, UndoSnapshot } from '../core/types';
import {
  decodeActions,
  DROP_CHARGE_ACTION,
  DROP_GATE_ACTION,
  DROP_STONE_ACTION,
  PieceSolver,
  SolverAction
} from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { BUILTIN_PACK_IDS, CITADEL_LEVEL_ID_PREFIX, ORDERED_DIRECTIONS } from './constants';
import { ConfigRegistry } from './ConfigRegistry';

const DEFAULT_MAX_BFS_STATES = 2500;
const MIN_SOLUTION_ACTIONS = 20;

function isLevelWinnable(level: CompiledLevel, maxStates = DEFAULT_MAX_BFS_STATES): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const queue: UndoSnapshot[] = [engine.captureState()];
  const visited = new Set<string>();

  const sigOf = (s: UndoSnapshot): string => {
    const p = `${s.player.x},${s.player.y},${s.player.dir},${Array.from(s.player.boots).sort().join('+')}`;
    const k = Object.entries(s.player.keys)
      .filter(([, v]) => v > 0)
      .map(([key, val]) => `${key}:${val}`)
      .sort()
      .join(',');
    const ents = s.entities
      .map((e) => `${e.type}@${e.x},${e.y}:${e.dir}`)
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
    return `${p}|${s.chipsRemaining}|${s.forceCycleTurn}|${k}|${ents}|${diffs.join(',')}`;
  };

  visited.add(sigOf(queue[0]));
  let head = 0;
  while (head < queue.length && visited.size < maxStates) {
    const snap = queue[head++];
    const actions: SolverAction[] = [...ORDERED_DIRECTIONS];
    if ((snap.player.keys.charge ?? 0) > 0) actions.push(DROP_CHARGE_ACTION);
    if ((snap.player.keys.pocket_gate ?? 0) > 0) actions.push(DROP_GATE_ACTION);
    if ((snap.player.keys.hurl_stone ?? 0) > 0) actions.push(DROP_STONE_ACTION);

    for (const action of actions) {
      engine.restoreState(snap);
      if (!PieceSolver.play(engine, action)) continue;
      if (engine.isLevelCompleted()) return true;
      const nextSnap = engine.captureState();
      const sig = sigOf(nextSnap);
      if (!visited.has(sig)) {
        visited.add(sig);
        queue.push(nextSnap);
      }
    }
  }
  return false;
}

function lookupLocaleKey(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, seg) => {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      return (cur as Record<string, unknown>)[seg];
    }
    return undefined;
  }, root);
}

describe('citadel campaign pack ("Clockwork Citadel")', () => {
  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
    vi.restoreAllMocks();
  });

  it('is listed as a built-in pack alongside the campaign and excavation packs', () => {
    loadTestConfigs();
    const defaultIds = ConfigRegistry.getAllPacks().map((p) => p.id);
    expect(defaultIds).toContain(BUILTIN_PACK_IDS.CITADEL);
    expect(defaultIds.slice(0, 3)).toEqual([
      BUILTIN_PACK_IDS.CAMPAIGN,
      BUILTIN_PACK_IDS.EXCAVATION,
      BUILTIN_PACK_IDS.CITADEL
    ]);

    ConfigRegistry.setPilotPackVisible(true);
    const playtestIds = ConfigRegistry.getAllPacks().map((p) => p.id);
    expect(playtestIds.slice(0, 4)).toEqual([
      BUILTIN_PACK_IDS.CAMPAIGN,
      BUILTIN_PACK_IDS.PILOT,
      BUILTIN_PACK_IDS.EXCAVATION,
      BUILTIN_PACK_IDS.CITADEL
    ]);
  });

  it('activates all 50 citadel levels across 5 chapters of 10 levels', () => {
    loadTestConfigs();
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CITADEL);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CITADEL);

    const levels = ConfigRegistry.getLevels();
    expect(levels).toHaveLength(50);
    expect(levels.every((level) => level.id.startsWith(CITADEL_LEVEL_ID_PREFIX))).toBe(true);
    expect(ConfigRegistry.getCitadelBlueprints()).toHaveLength(50);

    const chapters = ConfigRegistry.getActivePackChapters();
    expect(chapters).toHaveLength(5);
    for (const ch of chapters) {
      expect(ch.levels).toHaveLength(10);
    }
    expect(chapters.flatMap((c) => c.levels)).toEqual(levels.map((l) => l.id));
  });

  it('allocates a dedicated save slot key distinct from campaign, pilot, and excavation', () => {
    loadTestConfigs();
    const campaignSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.CAMPAIGN);
    const pilotSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.PILOT);
    const excavationSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.EXCAVATION);
    const citadelSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.CITADEL);

    expect(citadelSlot).not.toBe(campaignSlot);
    expect(citadelSlot).not.toBe(pilotSlot);
    expect(citadelSlot).not.toBe(excavationSlot);
    expect(citadelSlot).toContain(BUILTIN_PACK_IDS.CITADEL);
  });

  it('ignores a citadel pack with an invalid level prefix and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundle = createTestBundle();
    bundle.citadelLevels = { levels: [{ ...bundle.levels.levels[0] }] };
    bundle.citadelCampaign = {
      chapters: [{ id: 'c', titleKey: 't', subtitleKey: 's', levels: [bundle.levels.levels[0].id] }]
    };
    ConfigRegistry.applyConfigs(bundle);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.CITADEL);
    expect(ConfigRegistry.getCitadelLevels()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it.each([0, 1, 2, 3, 4])(
    'validates chapter index %i (10 levels) with 0 LevelValidator issues and replays stored solutions to victory',
    (chapterIdx) => {
      loadTestConfigs();
      const levels = ConfigRegistry.getCitadelLevels().slice(chapterIdx * 10, (chapterIdx + 1) * 10);
      expect(levels).toHaveLength(10);

      for (const level of levels) {
        const report = LevelValidator.validate(level);
        expect(report.valid, `${level.id} validator valid`).toBe(true);
        expect(report.issues, `${level.id} validator issues`).toEqual([]);
        expect(
          level.terrain.flat().some((id) => ConfigRegistry.getTile(id).showsHint === true),
          `${level.id} has hint terrain`
        ).toBe(true);
        expect(
          level.items.flat().every((id) => id === null || ConfigRegistry.getTile(id).layer === 'item'),
          `${level.id} items have item layer`
        ).toBe(true);

        expect(typeof level.solution).toBe('string');
        const actions = decodeActions(level.solution!);
        expect(actions.length).toBeGreaterThanOrEqual(MIN_SOLUTION_ACTIONS);
        expect(storedSolutionWins(level), `${level.id} storedSolutionWins`).toBe(true);
      }
    }
  );

  it.each([0, 1, 2, 3, 4])(
    'proves puzzle entities cannot be bypassed in chapter index %i',
    (chapterIdx) => {
      loadTestConfigs();
      const levels = ConfigRegistry.getCitadelLevels().slice(chapterIdx * 10, (chapterIdx + 1) * 10);
      expect(levels).toHaveLength(10);
      for (const level of levels) {
        expect(level.entities.length, `${level.id} has puzzle entities`).toBeGreaterThan(0);
        for (let i = 0; i < level.entities.length; i++) {
          const ent = level.entities[i];
          const withoutOne = structuredClone(level);
          withoutOne.entities.splice(i, 1);
          if (level.terrain[ent.y]?.[ent.x] === 'clone_machine') {
            withoutOne.cloneLinks = withoutOne.cloneLinks.filter(
              (l) => l.clonerX !== ent.x || l.clonerY !== ent.y
            );
          }
          expect(
            storedSolutionWins(withoutOne),
            `${level.id} solution should require entity ${i} (${ent.type})`
          ).toBe(false);
        }
        const withoutEntities = structuredClone(level);
        withoutEntities.solution = undefined;
        withoutEntities.entities = [];
        withoutEntities.cloneLinks = [];
        const bypassable =
          LevelValidator.validate(withoutEntities).valid && isLevelWinnable(withoutEntities);
        expect(bypassable, `${level.id} should be unsolvable without entities`).toBe(false);
      }
    }
  );

  it.each([
    ['epoxy_k_14', 'boots_fire'],
    ['epoxy_k_15', 'boots_fire'],
    ['epoxy_k_16', 'boots_pull'],
    ['epoxy_k_17', 'boots_pull'],
    ['epoxy_k_18', 'boots_fire'],
    ['epoxy_k_18', 'boots_pull'],
    ['epoxy_k_19', 'boots_pull'],
    ['epoxy_k_20', 'boots_fire'],
    ['epoxy_k_20', 'boots_pull'],
    ['epoxy_k_29', 'boots_pull'],
    ['epoxy_k_32', 'boots_pull'],
    ['epoxy_k_35', 'pocket_gate'],
    ['epoxy_k_38', 'pocket_gate'],
    ['epoxy_k_39', 'pocket_gate'],
    ['epoxy_k_41', 'charge'],
    ['epoxy_k_42', 'hurl_stone'],
    ['epoxy_k_43', 'ward'],
    ['epoxy_k_43', 'boots_fire'],
    ['epoxy_k_45', 'charge'],
    ['epoxy_k_45', 'hurl_stone'],
    ['epoxy_k_46', 'ward'],
    ['epoxy_k_47', 'hurl_stone'],
    ['epoxy_k_48', 'charge'],
    ['epoxy_k_49', 'ward'],
    ['epoxy_k_50', 'hurl_stone']
  ])('proves puzzle item %s on %s cannot be bypassed', (levelId, itemId) => {
    loadTestConfigs();
    const level = ConfigRegistry.getCitadelLevels().find((l) => l.id === levelId)!;
    expect(level).toBeDefined();
    const withoutItem = structuredClone(level);
    let removed = 0;
    for (let y = 0; y < withoutItem.items.length; y++) {
      for (let x = 0; x < withoutItem.items[y].length; x++) {
        if (withoutItem.items[y][x] === itemId) {
          withoutItem.items[y][x] = null;
          removed++;
        }
      }
    }
    expect(removed, `${levelId} should contain ${itemId}`).toBeGreaterThan(0);
    expect(storedSolutionWins(withoutItem), `${levelId} solution should require ${itemId}`).toBe(false);
    withoutItem.solution = undefined;
    const bypassable = LevelValidator.validate(withoutItem).valid && isLevelWinnable(withoutItem);
    expect(bypassable, `${levelId} should be unsolvable without ${itemId}`).toBe(false);
  });

  it('provides complete English and French translations with clean ASCII punctuation and no external IP references', () => {
    loadTestConfigs();
    const forbidden = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00a0\u0152\u0153\u00c6\u00e6]|diggy/i;

    const enPackLabel = lookupLocaleKey(en as Record<string, unknown>, 'app.packs.citadel.label');
    const frPackLabel = lookupLocaleKey(fr as Record<string, unknown>, 'app.packs.citadel.label');
    expect(typeof enPackLabel).toBe('string');
    expect(typeof frPackLabel).toBe('string');
    expect(enPackLabel).not.toMatch(forbidden);
    expect(frPackLabel).not.toMatch(forbidden);

    const chapters = ConfigRegistry.getCitadelChapters();
    expect(chapters).toHaveLength(5);
    for (const chapter of chapters) {
      for (const key of [chapter.titleKey, chapter.subtitleKey]) {
        const enVal = lookupLocaleKey(en as Record<string, unknown>, key);
        const frVal = lookupLocaleKey(fr as Record<string, unknown>, key);
        expect(typeof enVal, `en ${key}`).toBe('string');
        expect(typeof frVal, `fr ${key}`).toBe('string');
        expect(String(enVal)).not.toMatch(forbidden);
        expect(String(frVal)).not.toMatch(forbidden);
      }
    }

    const levels = ConfigRegistry.getCitadelLevels();
    expect(levels).toHaveLength(50);
    for (const level of levels) {
      for (const key of [level.titleKey, level.hintKey]) {
        expect(typeof key).toBe('string');
        const enVal = lookupLocaleKey(en as Record<string, unknown>, key!);
        const frVal = lookupLocaleKey(fr as Record<string, unknown>, key!);
        expect(typeof enVal, `en ${key}`).toBe('string');
        expect(typeof frVal, `fr ${key}`).toBe('string');
        expect(String(enVal)).not.toMatch(forbidden);
        expect(String(frVal)).not.toMatch(forbidden);
      }
    }
  });
});
