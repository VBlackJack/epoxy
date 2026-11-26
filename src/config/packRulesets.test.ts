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
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULESET } from '../core/coreConstants';
import { CompiledLevel, Ruleset, UltimatePackDescriptor } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import { decodeImportedDat, passwordSignature } from '../packs/datProfiles';

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');

/** Rulesets the bundled packs must declare; a pack missing here stays on the default ruleset. */
const EXPECTED_PACK_RULESETS: Record<string, Ruleset | undefined> = {
  ccup_tw_intro: 'lynx',
  ccup_cclp1: 'lynx',
  ccup_cclp2: 'lynx',
  ccup_cclp3: 'lynx',
  ccup_cclp4: 'lynx',
  ccup_cclp5: 'lynx'
};

/** Every bundled .DAT pack plays the CCLP engine (no official CC1 set is bundled). */
const CCLP_PROFILED_PACKS = ['ccup_tw_intro', 'ccup_cclp1', 'ccup_cclp2', 'ccup_cclp3', 'ccup_cclp4', 'ccup_cclp5'];

describe('bundled pack rulesets', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('declares the expected ruleset on every bundled pack', () => {
    const packs = ConfigRegistry.getGame().ultimatePacks ?? [];
    expect(packs.map((pack) => pack.id).sort()).toEqual(Object.keys(EXPECTED_PACK_RULESETS).sort());
    for (const pack of packs) {
      expect(pack.ruleset, pack.id).toBe(EXPECTED_PACK_RULESETS[pack.id]);
    }
  });

  it('tags the levels decoded from each bundled pack accordingly', () => {
    for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
      const file = readFileSync(resolve(PUBLIC_DIR, pack.url));
      const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      const levels = DatCodec.decodeBuffer(bytes, pack.prefix, pack.ruleset ?? DEFAULT_RULESET);
      expect(levels.length, pack.id).toBeGreaterThan(0);
      for (const level of levels) {
        expect(level.ruleset, `${pack.id} ${level.id}`).toBe(EXPECTED_PACK_RULESETS[pack.id]);
      }
    }
  });

  it('gives the CCLP profile to every bundled pack, and the same to an import of the same file', async () => {
    for (const pack of ConfigRegistry.getGame().ultimatePacks ?? []) {
      expect(pack.rulesProfile, pack.id).toBe(CCLP_PROFILED_PACKS.includes(pack.id) ? 'cclp' : undefined);
      const file = readFileSync(resolve(PUBLIC_DIR, pack.url));
      const levels = await decodeImportedDat(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), 'imported');
      expect(levels.every((level) => level.ruleset === 'lynx' && level.rulesProfile === 'cclp'), pack.id).toBe(true);
    }
  });

  it('keeps an official CC1 set (listed password signature) on the classic Epoxy rules', async () => {
    const file = readFileSync(resolve(PUBLIC_DIR, 'packs', 'CCLP2.DAT'));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    // CCLP2 stands in for the official file, which is not in the repository: its signature is listed for this test only.
    const signature = await passwordSignature(DatCodec.decodeBuffer(buffer, 'x', DEFAULT_RULESET));
    const real = ConfigRegistry.getGame();
    const spy = vi.spyOn(ConfigRegistry, 'getGame').mockReturnValue({ ...real, officialCc1Signatures: [signature] });
    try {
      const levels = await decodeImportedDat(buffer, 'imported');
      expect(levels.length).toBeGreaterThan(0);
      expect(levels.some((level) => level.ruleset !== undefined || level.rulesProfile !== undefined)).toBe(false);
      expect(levels.every((level) => level.rulesFlavor === 'cc')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('lists the official signatures as SHA-256 hex', () => {
    const listed = ConfigRegistry.getGame().officialCc1Signatures ?? [];
    expect(listed.length).toBeGreaterThan(0);
    for (const signature of listed) expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets the profile on the bundled levels when the game decodes the packs', () => {
    const registry = ConfigRegistry as unknown as {
      decodeUltimatePacks(fetched: { descriptor: UltimatePackDescriptor; buffer: ArrayBuffer }[]): { id: string; levels: CompiledLevel[] }[];
    };
    const fetched = (ConfigRegistry.getGame().ultimatePacks ?? []).map((descriptor) => {
      const file = readFileSync(resolve(PUBLIC_DIR, descriptor.url));
      return { descriptor, buffer: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
    });
    for (const pack of registry.decodeUltimatePacks(fetched)) {
      const profiled = CCLP_PROFILED_PACKS.includes(pack.id);
      expect(pack.levels.every((level) => level.rulesProfile === (profiled ? 'cclp' : undefined)), pack.id).toBe(true);
    }
  });
});
