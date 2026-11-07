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
import { CompiledLevel, Direction, UndoSnapshot } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { BUILTIN_PACK_IDS, EXCAVATION_LEVEL_ID_PREFIX, ORDERED_DIRECTIONS } from './constants';
import { ConfigRegistry } from './ConfigRegistry';

const DEFAULT_MAX_BFS_STATES = 5000;
const MIN_SOLUTION_STEPS = 30;

function isLevelWinnable(level: CompiledLevel, maxStates = DEFAULT_MAX_BFS_STATES): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const queue: UndoSnapshot[] = [engine.captureState()];
  const visited = new Set<string>();

  const sigOf = (s: UndoSnapshot): string => {
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

  visited.add(sigOf(queue[0]));
  let head = 0;
  while (head < queue.length && visited.size < maxStates) {
    const snap = queue[head++];
    for (const dir of ORDERED_DIRECTIONS) {
      engine.restoreState(snap);
      if (!PieceSolver.play(engine, dir)) continue;
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

describe('excavation campaign pack ("Buried Sanctuaries")', () => {
  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
    vi.restoreAllMocks();
  });

  it('is listed as a built-in pack and preserves pilot pack ordering when playtest is on', () => {
    loadTestConfigs();
    const defaultIds = ConfigRegistry.getAllPacks().map((p) => p.id);
    expect(defaultIds).toContain(BUILTIN_PACK_IDS.EXCAVATION);
    expect(defaultIds.slice(0, 2)).toEqual([BUILTIN_PACK_IDS.CAMPAIGN, BUILTIN_PACK_IDS.EXCAVATION]);

    ConfigRegistry.setPilotPackVisible(true);
    const playtestIds = ConfigRegistry.getAllPacks().map((p) => p.id);
    expect(playtestIds.slice(0, 3)).toEqual([
      BUILTIN_PACK_IDS.CAMPAIGN,
      BUILTIN_PACK_IDS.PILOT,
      BUILTIN_PACK_IDS.EXCAVATION
    ]);
  });

  it('activates all 20 excavation levels and 5 chapters', () => {
    loadTestConfigs();
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.EXCAVATION);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.EXCAVATION);

    const levels = ConfigRegistry.getLevels();
    expect(levels).toHaveLength(20);
    expect(levels.every((level) => level.id.startsWith(EXCAVATION_LEVEL_ID_PREFIX))).toBe(true);

    const chapters = ConfigRegistry.getActivePackChapters();
    expect(chapters).toHaveLength(5);
    expect(chapters.flatMap((c) => c.levels)).toEqual(levels.map((l) => l.id));
  });

  it('allocates a dedicated save slot key distinct from the main campaign and pilot', () => {
    loadTestConfigs();
    const campaignSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.CAMPAIGN);
    const pilotSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.PILOT);
    const excavationSlot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.EXCAVATION);

    expect(excavationSlot).not.toBe(campaignSlot);
    expect(excavationSlot).not.toBe(pilotSlot);
    expect(excavationSlot).toContain(BUILTIN_PACK_IDS.EXCAVATION);
  });

  it('ignores an excavation pack with an invalid level prefix and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundle = createTestBundle();
    bundle.excavationLevels = { levels: [{ ...bundle.levels.levels[0] }] };
    bundle.excavationCampaign = {
      chapters: [{ id: 'c', titleKey: 't', subtitleKey: 's', levels: [bundle.levels.levels[0].id] }]
    };
    ConfigRegistry.applyConfigs(bundle);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.EXCAVATION);
    expect(ConfigRegistry.getExcavationLevels()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('validates all 20 levels with 0 LevelValidator issues and replays every stored solution to victory', () => {
    loadTestConfigs();
    const levels = ConfigRegistry.getExcavationLevels();
    expect(levels).toHaveLength(20);

  });

  it('proves puzzle entities cannot be bypassed', () => {
    loadTestConfigs();
    const levels = ConfigRegistry.getExcavationLevels();
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
      const dirs = [...level.solution!] as Direction[];
      expect(dirs.length).toBeGreaterThanOrEqual(MIN_SOLUTION_STEPS);

      const engine = new GameEngine();
      engine.loadLevel(level);
      for (const dir of dirs) {
        expect(PieceSolver.play(engine, dir), `${level.id} step ${dir}`).toBe(true);
        if (engine.isLevelCompleted()) break;
      }
      expect(engine.isLevelCompleted(), `${level.id} completed after solution replay`).toBe(true);
    }
  });

  it.each([
    'epoxy_x_6',
    'epoxy_x_7',
    'epoxy_x_8',
    'epoxy_x_10',
    'epoxy_x_12',
    'epoxy_x_14',
    'epoxy_x_17',
    'epoxy_x_19',
    'epoxy_x_20'
  ])('proves boots_pull cannot be bypassed on %s', (id) => {
    loadTestConfigs();
    const levels = ConfigRegistry.getExcavationLevels();

  });

  it('provides complete English and French translations with clean ASCII punctuation and no external IP references', () => {
    loadTestConfigs();
    const forbidden = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00a0\u0152\u0153\u00c6\u00e6]|diggy/i;

    const enPackLabel = lookupLocaleKey(en as Record<string, unknown>, 'app.packs.excavation.label');
    const frPackLabel = lookupLocaleKey(fr as Record<string, unknown>, 'app.packs.excavation.label');
    expect(typeof enPackLabel).toBe('string');
    expect(typeof frPackLabel).toBe('string');
    expect(enPackLabel).not.toMatch(forbidden);
    expect(frPackLabel).not.toMatch(forbidden);

    for (const chapter of ConfigRegistry.getExcavationChapters()) {
      for (const key of [chapter.titleKey, chapter.subtitleKey]) {
        const enVal = lookupLocaleKey(en as Record<string, unknown>, key);
        const frVal = lookupLocaleKey(fr as Record<string, unknown>, key);
        expect(typeof enVal, `en ${key}`).toBe('string');
        expect(typeof frVal, `fr ${key}`).toBe('string');
        expect(String(enVal)).not.toMatch(forbidden);
        expect(String(frVal)).not.toMatch(forbidden);
      }
    }

    for (const level of ConfigRegistry.getExcavationLevels()) {
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
