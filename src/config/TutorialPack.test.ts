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

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import type { CompiledLevel } from '../core/types';
import { CELL_EDGE_BRUSH_ID } from '../editor/editorTools';
import { descriptionKeyFor } from '../editor/paletteDescriptions';
import { PieceSolver } from '../generator/PieceSolver';
import { storedSolutionWins } from '../generator/SolutionReplay';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import { BUILTIN_PACK_IDS, ORDERED_DIRECTIONS, PLAYTEST_ONLY_PACK_IDS, TUTORIAL_LEVEL_ID_PREFIX } from './constants';
import {
  CHAPTERS,
  EXEMPTIONS,
  FAMILIES,
  INFO_ISSUE_ALLOWLIST,
  MAX_EXEMPTIONS,
  MAX_HINT_LENGTH,
  MAX_ROOM_HEIGHT,
  MAX_ROOM_WIDTH,
  PENDING,
  SYNTHETIC_CELL_EDGES,
  SYNTHETIC_MEMBERS,
  SYNTHETIC_PREFIX,
  TEACHES,
  familiesUsedBy,
  familyByMember,
  orderViolations
} from './tutorialSyllabus';

/** Plain text of a dotted locale key, or undefined when a segment is missing. */
function lookupLocaleKey(root: unknown, path: string): string | undefined {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function tutorialLevels(): CompiledLevel[] {
  return ConfigRegistry.getTutorialLevels();
}

function levelById(id: string): CompiledLevel {
  const level = tutorialLevels().find((l) => l.id === id);
  if (!level) throw new Error(`no tutorial level ${id}`);
  return level;
}

/** Every tile id and entity id the game defines, from the shipped configs. */
function definedIds(): { tiles: string[]; entities: string[] } {
  const bundle = createTestBundle();
  return { tiles: Object.keys(bundle.tiles.tiles), entities: Object.keys(bundle.monsters.entities) };
}

const MAX_BFS_STATES = 20000;

/** Breadth-first search over positions, chips and the board; true when some move sequence wins. */
function isWinnable(level: CompiledLevel): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const start = engine.captureState();
  const key = (s: ReturnType<GameEngine['captureState']>): string =>
    JSON.stringify([s.player.x, s.player.y, s.chipsRemaining, s.terrain, s.items]);
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let head = 0; head < queue.length && seen.size < MAX_BFS_STATES; head++) {
    for (const dir of ORDERED_DIRECTIONS) {
      engine.restoreState(queue[head]);
      if (!PieceSolver.play(engine, dir)) continue;
      if (engine.isLevelCompleted()) return true;
      const next = engine.captureState();
      const id = key(next);
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(next);
      }
    }
  }
  return false;
}

const ROOM_IDS = CHAPTERS.flatMap((chapter) => [...chapter.rooms]);
/** Rooms replayed more than once, for a stored solution that must not depend on a random draw. */
const REPLAY_COUNT = 2;

describe('tutorial pack: plumbing', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
  });

  it('loads every room of the syllabus, each with the tutorial id prefix', () => {
    expect(tutorialLevels().map((l) => l.id)).toEqual(ROOM_IDS);
    expect(tutorialLevels().every((l) => l.id.startsWith(TUTORIAL_LEVEL_ID_PREFIX))).toBe(true);
  });

  it('lists the chapters of the campaign file in the order of the syllabus', () => {
    expect(ConfigRegistry.getTutorialChapters().map((c) => c.levels)).toEqual(CHAPTERS.map((c) => [...c.rooms]));
  });

  it('keeps the pack out of the pack list until Playtest mode shows it, then lists it second', () => {
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.TUTORIAL);
    ConfigRegistry.setPilotPackVisible(true);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id).slice(0, 2)).toEqual([
      BUILTIN_PACK_IDS.CAMPAIGN,
      BUILTIN_PACK_IDS.TUTORIAL
    ]);
  });

  it('falls back to the campaign when Playtest mode ends while the tutorial is the active pack', () => {
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.TUTORIAL);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.TUTORIAL);
    expect(ConfigRegistry.getActivePackChapters()).toEqual(ConfigRegistry.getTutorialChapters());
    ConfigRegistry.setPilotPackVisible(false);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
  });

  it('gives the tutorial a save slot of its own', () => {
    const slot = ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.TUTORIAL);
    expect(slot).toContain(BUILTIN_PACK_IDS.TUTORIAL);
    expect(slot).not.toBe(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.CAMPAIGN));
    expect(slot).not.toBe(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.PILOT));
    expect(slot).not.toBe(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.EXCAVATION));
  });

  it('ignores a tutorial pack whose level id has the wrong prefix, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundle = createTestBundle();
    bundle.tutorialLevels = { levels: [{ ...bundle.levels.levels[0] }] };
    bundle.tutorialCampaign = {
      chapters: [{ id: 'c', titleKey: 't', subtitleKey: 's', levels: [bundle.levels.levels[0].id] }]
    };
    ConfigRegistry.applyConfigs(bundle);
    expect(ConfigRegistry.getTutorialLevels()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    loadTestConfigs();
  });

  it('ignores a tutorial pack that reuses an excavation level id, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundle = createTestBundle();
    const excavationId = bundle.excavationLevels!.levels[0].id;
    bundle.tutorialLevels = { levels: [{ ...bundle.tutorialLevels!.levels[0], id: excavationId }] };
    bundle.tutorialCampaign = { chapters: [{ id: 'c', titleKey: 't', subtitleKey: 's', levels: [excavationId] }] };
    ConfigRegistry.applyConfigs(bundle);
    expect(ConfigRegistry.getTutorialLevels()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    loadTestConfigs();
  });
});

describe('tutorial pack: rooms', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it.each(ROOM_IDS)('wins the stored solution of %s in the real engine, every time', (id) => {
    const level = levelById(id);
    expect(typeof level.solution, `${id} has a stored solution`).toBe('string');
    expect(level.solution).toMatch(/^[NESW.XGT]+$/);
    for (let run = 0; run < REPLAY_COUNT; run++) {
      expect(storedSolutionWins(level), `${id} replay ${run + 1}`).toBe(true);
    }
  });

  it.each(ROOM_IDS)('reports no validator error or warning for %s, and only allowed info issues', (id) => {
    const level = levelById(id);
    const report = LevelValidator.validate(level, storedSolutionWins);
    expect(report.valid, `${id} valid`).toBe(true);
    const blocking = report.issues.filter((issue) => issue.severity !== 'info');
    expect(blocking, `${id} errors and warnings`).toEqual([]);
    const allowed = INFO_ISSUE_ALLOWLIST[id] ?? [];
    const unexpected = report.issues.filter((issue) => issue.severity === 'info' && !allowed.includes(issue.i18nKey));
    expect(unexpected, `${id} info issues outside the allowlist`).toEqual([]);
  });

  it('allows info issues only for rooms of the syllabus', () => {
    for (const room of Object.keys(INFO_ISSUE_ALLOWLIST)) expect(ROOM_IDS).toContain(room);
  });

  it.each(ROOM_IDS)('keeps %s within the room size limit and its hint within the length limit', (id) => {
    const level = levelById(id);
    expect(level.terrain.length, `${id} height`).toBeLessThanOrEqual(MAX_ROOM_HEIGHT);
    expect(level.terrain[0].length, `${id} width`).toBeLessThanOrEqual(MAX_ROOM_WIDTH);
    for (const locale of [en, fr]) {
      const hint = lookupLocaleKey(locale, level.hintKey ?? '');
      expect(hint, `${id} hint text`).toBeDefined();
      expect(hint!.length, `${id} hint length`).toBeLessThanOrEqual(MAX_HINT_LENGTH);
    }
  });

  it.each(ROOM_IDS)('has a hint tile and no custom text in %s', (id) => {
    const level = levelById(id);
    expect(level.terrain.flat().some((tile) => ConfigRegistry.getTile(tile).showsHint === true)).toBe(true);
    expect(level.customHint).toBeUndefined();
    expect(level.customTitle).toBeUndefined();
  });

  it('has the title, hint and chapter keys in English and French, with ASCII punctuation', () => {
    const forbidden = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00a0\u0152\u0153\u00c6\u00e6]/;
    const keys = [
      'app.packs.tutorial.label',
      ...ConfigRegistry.getTutorialChapters().flatMap((c) => [c.titleKey, c.subtitleKey]),
      ...tutorialLevels().flatMap((l) => [l.titleKey ?? '', l.hintKey ?? ''])
    ];
    for (const key of keys) {
      for (const [name, locale] of [
        ['en', en],
        ['fr', fr]
      ] as const) {
        const text = lookupLocaleKey(locale, key);
        expect(text, `${name} ${key}`).toBeTypeOf('string');
        expect(text!.length, `${name} ${key} is not empty`).toBeGreaterThan(0);
        expect(text!, `${name} ${key} punctuation`).not.toMatch(forbidden);
      }
    }
  });

  it('keeps the room titles and hints distinct from one another', () => {
    const titles = tutorialLevels().map((l) => lookupLocaleKey(en, l.titleKey ?? ''));
    const hints = tutorialLevels().map((l) => lookupLocaleKey(en, l.hintKey ?? ''));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(hints).size).toBe(hints.length);
  });
});

describe('tutorial syllabus', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('places every tile and entity id in exactly one family', () => {
    const { tiles, entities } = definedIds();
    const seen = new Map<string, string[]>();
    for (const [family, members] of Object.entries(FAMILIES)) {
      for (const member of members) seen.set(member, [...(seen.get(member) ?? []), family]);
    }
    const unplaced = [...tiles, ...entities].filter((id) => !seen.has(id));
    expect(unplaced, 'ids without a family').toEqual([]);
    const doubled = [...seen.entries()].filter(([, families]) => families.length > 1);
    expect(doubled, 'members in several families').toEqual([]);
  });

  it('lists only members that exist: a tile, an entity, or a synthetic feature', () => {
    const { tiles, entities } = definedIds();
    const known = new Set([...tiles, ...entities]);
    const synthetic = new Set(SYNTHETIC_MEMBERS);
    expect(SYNTHETIC_MEMBERS.every((member) => member.startsWith(SYNTHETIC_PREFIX))).toBe(true);
    const strayPrefixed = Object.values(FAMILIES)
      .flat()
      .filter((member) => member.startsWith(SYNTHETIC_PREFIX) && !synthetic.has(member));
    expect(strayPrefixed, 'prefixed members that are not a known synthetic one').toEqual([]);
    const unknown = Object.values(FAMILIES)
      .flat()
      .filter((member) => !known.has(member) && !synthetic.has(member));
    expect(unknown, 'members that match no tile or entity').toEqual([]);
  });

  it('keeps cc3d-only tiles out of the families', () => {
    const cc3d = Object.keys(createTestBundle().cc3dTiles.tiles);
    const { tiles, entities } = definedIds();
    const shared = new Set([...tiles, ...entities]);
    const members = new Set(Object.values(FAMILIES).flat());
    const stray = cc3d.filter((id) => !shared.has(id) && members.has(id));
    expect(stray).toEqual([]);
  });

  it('has no empty family', () => {
    for (const [family, members] of Object.entries(FAMILIES)) expect(members.length, family).toBeGreaterThan(0);
  });

  it('gives every family with a palette description a place in the syllabus', () => {
    const lookup = familyByMember();
    const { tiles, entities } = definedIds();
    const described: string[] = [];
    for (const id of tiles) if (descriptionKeyFor('terrain', id) || descriptionKeyFor('item', id)) described.push(id);
    for (const id of entities) if (descriptionKeyFor('entity', id)) described.push(id);
    expect(described.length).toBeGreaterThan(0);
    const missing = described.filter((id) => !lookup.has(id));
    expect(missing, 'described ids outside every family').toEqual([]);
    const bundle = createTestBundle();
    const withoutKey = Object.values(FAMILIES)
      .flat()
      .filter((member) => !SYNTHETIC_MEMBERS.includes(member))
      .filter((member) => {
        const kind = member in bundle.monsters.entities ? 'entity' : bundle.tiles.tiles[member].layer === 'item' ? 'item' : 'terrain';
        return descriptionKeyFor(kind, member) === undefined;
      });
    expect(withoutKey, 'family members without a palette description key').toEqual([]);
    expect(descriptionKeyFor('cell_edge', CELL_EDGE_BRUSH_ID)).toBeDefined();
    expect(lookup.has(SYNTHETIC_CELL_EDGES)).toBe(true);
  });

  it('teaches every family in exactly one room, or exempts it, or lists it as pending', () => {
    const taughtBy = new Map<string, string[]>();
    for (const [room, families] of Object.entries(TEACHES)) {
      for (const family of families) taughtBy.set(family, [...(taughtBy.get(family) ?? []), room]);
    }
    for (const family of Object.keys(FAMILIES)) {
      const rooms = taughtBy.get(family) ?? [];
      const exempt = Object.hasOwn(EXEMPTIONS, family);
      const pending = PENDING.includes(family);
      expect(rooms.length, `${family} is taught by at most one room`).toBeLessThanOrEqual(1);
      const states = [rooms.length === 1, exempt, pending].filter(Boolean).length;
      expect(states, `${family} must be taught, exempt or pending, and only one of them`).toBe(1);
    }
    for (const family of [...taughtBy.keys(), ...Object.keys(EXEMPTIONS), ...PENDING]) {
      expect(Object.hasOwn(FAMILIES, family), `${family} is a family`).toBe(true);
    }
  });

  it('has nothing pending once the pack is shown to everyone', () => {
    if (!PLAYTEST_ONLY_PACK_IDS.includes(BUILTIN_PACK_IDS.TUTORIAL)) expect(PENDING).toEqual([]);
  });

  it('keeps exemptions few and each one explained', () => {
    const entries = Object.entries(EXEMPTIONS);
    expect(entries.length).toBeLessThanOrEqual(MAX_EXEMPTIONS);
    for (const [family, reason] of entries) expect(reason.trim().length, `${family} reason`).toBeGreaterThan(0);
  });

  it('teaches only rooms and chapters that exist', () => {
    for (const room of Object.keys(TEACHES)) expect(ROOM_IDS, `${room} is a room`).toContain(room);
    for (const room of ROOM_IDS) expect(Object.hasOwn(TEACHES, room), `${room} has a teaches entry`).toBe(true);
    expect(new Set(ROOM_IDS).size).toBe(ROOM_IDS.length);
    expect(CHAPTERS.map((c) => c.order)).toEqual(CHAPTERS.map((_, index) => index + 1));
  });

  it('puts a member of each taught family in the room that teaches it', () => {
    for (const [room, families] of Object.entries(TEACHES)) {
      const used = familiesUsedBy(levelById(room));
      for (const family of families) expect(used.has(family), `${room} contains ${family}`).toBe(true);
    }
  });

  it('lets a room use only the baseline, chapter 1, and what it or an earlier room of its chapter teaches', () => {
    expect(orderViolations(CHAPTERS, TEACHES, (room) => familiesUsedBy(levelById(room)))).toEqual([]);
  });

  it('reports a room that uses a family taught only by a later room', () => {
    const chapters = [{ id: 'fake', order: 1, rooms: ['a', 'b'] }];
    const teaches = { a: ['walk'], b: ['ice'] };
    const used: Record<string, Set<string>> = { a: new Set(['walk', 'ice']), b: new Set(['ice']) };
    expect(orderViolations(chapters, teaches, (room) => used[room])).toEqual(['a uses ice before it is taught']);
    const later = [...chapters, { id: 'fake2', order: 2, rooms: ['c'] }];
    // Chapter 1 families are known to a later chapter, so ice is fine in room c.
    expect(orderViolations(later, { ...teaches, c: [] }, (room) => (room === 'c' ? new Set(['ice']) : new Set()))).toEqual([]);
    expect(orderViolations(later, { ...teaches, c: [] }, (room) => (room === 'c' ? new Set(['rails']) : used[room]))).toEqual([
      'a uses ice before it is taught',
      'c uses rails before it is taught'
    ]);
  });

  it('proves a room cannot be won once the tiles it teaches are walled off', () => {
    let checked = 0;
    for (const room of ROOM_IDS) {
      const level = levelById(room);
      // A solution with drops, or a room with monsters or clone machines (which make them), is outside this proof.
      if (level.entities.length > 0 || level.cloneLinks.length > 0 || /[XGT]/.test(level.solution ?? '')) continue;
      const taught = new Set((TEACHES[room] ?? []).flatMap((family) => FAMILIES[family]));
      taught.delete('floor');
      taught.delete('wall');
      if (taught.size === 0) continue;
      const walled = structuredClone(level);
      walled.solution = undefined;
      for (let y = 0; y < walled.terrain.length; y++) {
        for (let x = 0; x < walled.terrain[y].length; x++) {
          const item = walled.items[y][x];
          if (taught.has(walled.terrain[y][x]) || (item !== null && taught.has(item))) {
            walled.terrain[y][x] = 'wall';
            walled.items[y][x] = null;
          }
        }
      }
      expect(isWinnable(walled), `${room} should be unsolvable without what it teaches`).toBe(false);
      expect(isWinnable(level), `${room} itself is solvable`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
