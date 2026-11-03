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

import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import { ConfigLoadError, findCampaignConfigErrors } from './ConfigValidation';

describe('campaign chapters config', () => {
  it('exposes the shipped chapters in play order', () => {
    loadTestConfigs();
    const chapters = ConfigRegistry.getCampaignChapters();
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters.flatMap((c) => c.levels)).toEqual(ConfigRegistry.getLevels().map((l) => l.id));
  });

  it('reports no problem for the shipped chapters', () => {
    const bundle = createTestBundle();
    const ids = bundle.levels.levels.map((l) => l.id);
    expect(findCampaignConfigErrors(bundle.campaign, ids)).toEqual([]);
  });

  it('names an unknown level, a repeated level, a duplicate id and empty fields', () => {
    const errors = findCampaignConfigErrors(
      {
        chapters: [
          { id: 'a', titleKey: 't', subtitleKey: 's', levels: ['x', 'ghost'] },
          { id: 'a', titleKey: '', subtitleKey: 's', levels: ['x'] },
          { id: 'c', titleKey: 't', subtitleKey: 's', levels: [] }
        ]
      },
      ['x']
    );
    expect(errors).toEqual([
      'chapters[0]: unknown level ghost',
      'chapters[1]: duplicate id a',
      'chapters[1]: titleKey must be a non-empty string',
      'chapters[1]: level x is already in a',
      'chapters[2]: levels must be a non-empty list'
    ]);
  });

  it('refuses a bundle whose chapters name a missing level', () => {
    const bundle = createTestBundle();
    bundle.campaign.chapters[0].levels.push('no_such_level');
    expect(() => ConfigRegistry.applyConfigs(bundle)).toThrow(ConfigLoadError);
  });

  it('refuses a malformed chapter list', () => {
    expect(findCampaignConfigErrors({ chapters: 'oops' } as never, [])).toEqual(['chapters: expected a list']);
  });
});

describe('campaign chapters at load time', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Serves the shipped configs from disk, except the files named in `missing`, which answer 404. */
  function stubFetch(missing: string[]): void {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('fetch', async (url: string) => {
      const file = url.split('/').pop() ?? '';
      if (missing.includes(file)) return { ok: false, status: 404, json: async () => ({}) };
      const path = resolve(__dirname, '../../public/configs', file);
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf-8')) };
    });
  }

  it('loads the game without campaign.json and lists no chapters', async () => {
    stubFetch(['campaign.json']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getCampaignChapters()).toEqual([]);
    expect(ConfigRegistry.getLevels().length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });

  it('loads the chapters when campaign.json is served', async () => {
    stubFetch([]);
    await ConfigRegistry.loadAll();
    expect(ConfigRegistry.getCampaignChapters().length).toBeGreaterThan(0);
  });
});
