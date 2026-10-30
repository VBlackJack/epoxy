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

/**
 * Compares the Epoxy campaign with the levels of a reference .DAT file and
 * writes the closest pairs to local/originality.md. The reference file is
 * given by EPOXY_REFERENCE_DAT and must never be added to the repository;
 * only the pair labels and scores are written, into the git-ignored local/.
 *
 * Run with: EPOXY_REFERENCE_DAT=<path to a .DAT> npm run report:originality
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { CompiledLevel } from '../src/core/types';
import { DatCodec } from '../src/formats/DatCodec';
import { findSimilarPairs, fingerprintGrid, isSimilar, toCellGrid } from '../src/generator/OriginalityGuard';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'originality.md');
const REFERENCE_ENV = 'EPOXY_REFERENCE_DAT';
const REFERENCE_PREFIX = 'reference';
const TOP_PAIRS = 20;

it('writes the originality comparison', () => {
  const referencePath = process.env[REFERENCE_ENV];
  expect(referencePath, `set ${REFERENCE_ENV} to the path of a .DAT file`).toBeTruthy();
  loadTestConfigs();
  const config = ConfigRegistry.getGame().campaignGuard;
  const fingerprint = (level: CompiledLevel, label: string) =>
    fingerprintGrid(label, toCellGrid(level, (id) => ConfigRegistry.getTile(id)), config);

  const buffer = readFileSync(resolve(referencePath as string));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const reference = DatCodec.decodeBuffer(bytes, REFERENCE_PREFIX).map((level) => fingerprint(level, `reference #${level.number}`));
  const campaign = ConfigRegistry.getLevels().map((level) => fingerprint(level, `campaign #${level.number} ${level.id}`));

  const pairs = findSimilarPairs(campaign, reference, config, { flaggedOnly: false }).slice(0, TOP_PAIRS);
  const lines = [
    '# Originality comparison',
    '',
    `Campaign levels: ${campaign.length}. Reference levels: ${reference.length}.`,
    `Flag threshold: Jaccard >= ${config.maxJaccard} on ${config.windowSize}x${config.windowSize} windows, or any shared ${config.largeWindowSize}x${config.largeWindowSize} window.`,
    '',
    '| Campaign level | Reference level | Jaccard | Shared large windows | Flagged |',
    '|---|---|---|---|---|',
    ...pairs.map(
      (p) => `| ${p.candidate} | ${p.reference} | ${p.jaccard.toFixed(3)} | ${p.sharedLargeWindows} | ${isSimilar(p, config) ? 'yes' : 'no'} |`
    )
  ];
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`);
});
