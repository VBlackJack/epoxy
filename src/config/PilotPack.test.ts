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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { FLAG_ON } from '../playtest/PlaytestStore';
import { resolveSavedLevel } from '../storage/persistedState';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { BUILTIN_PACK_IDS, PILOT_LEVEL_ID_PREFIX } from './constants';
import { ConfigRegistry } from './ConfigRegistry';
import { findPilotConfigErrors } from './ConfigValidation';

const PILOT_CHAPTER = { id: 'p', titleKey: 't', subtitleKey: 's' };

describe('pilot pack config', () => {
  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
    vi.restoreAllMocks();
  });

  it('is hidden until it is made visible, and then sits right after the campaign', () => {
    loadTestConfigs();
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.PILOT);
    expect(ConfigRegistry.setPilotPackVisible(true)).toBe(true);
    const ids = ConfigRegistry.getAllPacks().map((p) => p.id);
    expect(ids.slice(0, 2)).toEqual([BUILTIN_PACK_IDS.CAMPAIGN, BUILTIN_PACK_IDS.PILOT]);
    expect(ConfigRegistry.setPilotPackVisible(true)).toBe(false);
  });

  it('plays the pilot levels and chapters once the pack is active', () => {
    loadTestConfigs();
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.PILOT);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.PILOT);
    const levels = ConfigRegistry.getLevels();
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((level) => level.id.startsWith(PILOT_LEVEL_ID_PREFIX))).toBe(true);
    expect(ConfigRegistry.getActivePackChapters().flatMap((c) => c.levels)).toEqual(levels.map((l) => l.id));
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CAMPAIGN);
    expect(ConfigRegistry.getActivePackChapters()).toBe(ConfigRegistry.getCampaignChapters());
  });

  it('falls back to the campaign when hidden while active', () => {
    loadTestConfigs();
    ConfigRegistry.setPilotPackVisible(true);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.PILOT);
    ConfigRegistry.setPilotPackVisible(false);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
    expect(ConfigRegistry.getLevels()).toEqual(ConfigRegistry.getAllPacks()[0].levels);
  });

  it('ignores a pilot with a wrongly prefixed level, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundle = createTestBundle();
    bundle.pilotLevels = { levels: [{ ...bundle.levels.levels[0] }] };
    bundle.pilotCampaign = { chapters: [{ ...PILOT_CHAPTER, levels: [bundle.levels.levels[0].id] }] };
    ConfigRegistry.applyConfigs(bundle);
    ConfigRegistry.setPilotPackVisible(true);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.PILOT);
    expect(ConfigRegistry.getPilotLevels()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('has no pilot pack when the bundle carries none', () => {
    const bundle = createTestBundle();
    delete bundle.pilotLevels;
    delete bundle.pilotCampaign;
    ConfigRegistry.applyConfigs(bundle);
    ConfigRegistry.setPilotPackVisible(true);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.PILOT);
    expect(ConfigRegistry.getPilotChapters()).toEqual([]);
  });
});

describe('save slot per pack', () => {
  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
  });

  it('keeps the historical slot for the campaign and gives the pilot its own', () => {
    loadTestConfigs();
    const base = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.saveSlotKey);
    expect(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.CAMPAIGN)).toBe(base);
    expect(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.PILOT)).not.toBe(base);
    expect(ConfigRegistry.getSaveSlotKey(BUILTIN_PACK_IDS.PILOT)).toContain(BUILTIN_PACK_IDS.PILOT);
  });
});

describe('resume points of the campaign and the pilot', () => {
  it('resumes each pack only from a record written for it', () => {
    const campaignLevels = [{ id: 'epoxy_c_1' }, { id: 'epoxy_c_2' }, { id: 'epoxy_c_3' }];
    const pilotLevels = [{ id: 'epoxy_p_1' }, { id: 'epoxy_p_2' }];
    const campaignSave = { packId: BUILTIN_PACK_IDS.CAMPAIGN, levelIndex: 2, levelId: 'epoxy_c_3' };
    const pilotSave = { packId: BUILTIN_PACK_IDS.PILOT, levelIndex: 1, levelId: 'epoxy_p_2' };
    expect(resolveSavedLevel(campaignSave, BUILTIN_PACK_IDS.CAMPAIGN, campaignLevels)).toBe(2);
    expect(resolveSavedLevel(pilotSave, BUILTIN_PACK_IDS.PILOT, pilotLevels)).toBe(1);
    // Leaving the pilot must not resume the campaign from a pilot record, nor the reverse.
    expect(resolveSavedLevel(pilotSave, BUILTIN_PACK_IDS.CAMPAIGN, campaignLevels)).toBeNull();
    expect(resolveSavedLevel(campaignSave, BUILTIN_PACK_IDS.PILOT, pilotLevels)).toBeNull();
  });
});

describe('pilot config validation', () => {
  const ok = { chapters: [{ ...PILOT_CHAPTER, levels: ['epoxy_p_1'] }] };

  it('accepts a prefixed pilot', () => {
    expect(findPilotConfigErrors([{ id: 'epoxy_p_1' }], ok, ['epoxy_c_1'], PILOT_LEVEL_ID_PREFIX)).toEqual([]);
  });

  it('accepts an empty pilot', () => {
    expect(findPilotConfigErrors([], { chapters: [] }, ['epoxy_c_1'], PILOT_LEVEL_ID_PREFIX)).toEqual([]);
  });

  it('refuses a missing prefix, a campaign id, a duplicate and an unknown chapter level', () => {
    const errors = findPilotConfigErrors(
      [{ id: 'epoxy_p_1' }, { id: 'epoxy_p_1' }, { id: 'other' }, { id: 'epoxy_p_2' }],
      { chapters: [{ ...PILOT_CHAPTER, levels: ['epoxy_p_1', 'ghost'] }] },
      ['epoxy_p_2'],
      PILOT_LEVEL_ID_PREFIX
    );
    expect(errors).toEqual([
      'levels[1]: duplicate id epoxy_p_1',
      'levels[2]: id must start with epoxy_p_',
      'levels[3]: id epoxy_p_2 is a campaign level',
      'chapters[0]: unknown level ghost'
    ]);
  });
});

describe('pilot pack at load time', () => {
  afterEach(() => {
    ConfigRegistry.setPilotPackVisible(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Serves the shipped configs from disk, except the files named in `missing`, which answer 404; `stored` seeds localStorage. */
  function stubFetch(missing: string[], stored: Record<string, string> = {}): void {
    const store = new Map(Object.entries(stored));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    });
    vi.stubGlobal('fetch', async (url: string) => {
      const file = url.split('/').pop() ?? '';
      if (missing.includes(file)) return { ok: false, status: 404, json: async () => ({}) };
      const path = resolve(__dirname, '../../public/configs', file);
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf-8')) };
    });
  }

  function playtestKey(): string {
    loadTestConfigs();
    return ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.playtestEnabledKey);
  }

  it('loads the game without the pilot files and offers no pilot pack', async () => {
    stubFetch(['pilot-levels.json', 'pilot-campaign.json'], { [playtestKey()]: FLAG_ON });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getLevels().length).toBeGreaterThan(0);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.PILOT);
  });

  it('keeps the pilot hidden while Playtest mode is off', async () => {
    stubFetch([]);
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getPilotLevels().length).toBeGreaterThan(0);
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).not.toContain(BUILTIN_PACK_IDS.PILOT);
  });

  it('forgets a saved pilot pack when Playtest mode is off', async () => {
    loadTestConfigs();
    const activeKey = ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.activePackKey);
    stubFetch([], { [activeKey]: BUILTIN_PACK_IDS.PILOT });
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
    expect(localStorage.getItem(activeKey)).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
  });

  it('lists the pilot when Playtest mode was left on', async () => {
    stubFetch([], { [playtestKey()]: FLAG_ON });
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getAllPacks().map((p) => p.id)).toContain(BUILTIN_PACK_IDS.PILOT);
  });
});
