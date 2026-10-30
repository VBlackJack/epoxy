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
import { beforeAll, describe, expect, it } from 'vitest';
import { CompiledLevel } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { findSimilarPairs, fingerprintGrid, LevelFingerprint, toCellGrid } from '../generator/OriginalityGuard';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
/** The first run fingerprints every bundled pack, which takes a few seconds. */
const FINGERPRINT_TIMEOUT_MS = 60000;

describe('campaign originality', () => {
  let campaign: LevelFingerprint[];
  let packs: Array<{ name: string; levels: LevelFingerprint[] }>;

  beforeAll(() => {
    loadTestConfigs();
    const config = ConfigRegistry.getGame().campaignGuard;
    const fingerprint = (level: CompiledLevel, label: string) =>
      fingerprintGrid(label, toCellGrid(level, (id) => ConfigRegistry.getTile(id)), config);
    campaign = ConfigRegistry.getLevels().map((level) => fingerprint(level, `campaign #${level.number} ${level.id}`));
    packs = (ConfigRegistry.getGame().ultimatePacks ?? []).map((pack) => {
      const buffer = readFileSync(resolve(PUBLIC_DIR, pack.url));
      const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const levels = DatCodec.decodeBuffer(bytes, pack.prefix);
      return { name: pack.name, levels: levels.map((level) => fingerprint(level, `${pack.name} #${level.number}`)) };
    });
  }, FINGERPRINT_TIMEOUT_MS);

  it('has campaign levels and bundled packs to compare', () => {
    expect(campaign.length).toBeGreaterThan(0);
    expect(packs.length).toBeGreaterThan(0);
  });

  it('keeps every campaign map unlike every bundled community level', () => {
    const config = ConfigRegistry.getGame().campaignGuard;
    const size = `${config.largeWindowSize}x${config.largeWindowSize}`;
    const offenders = packs.flatMap((pack) =>
      findSimilarPairs(campaign, pack.levels, config, { flaggedOnly: true }).map(
        (p) => `${p.candidate} ~ ${p.reference}: jaccard ${p.jaccard.toFixed(3)}, shared ${size} windows ${p.sharedLargeWindows}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
