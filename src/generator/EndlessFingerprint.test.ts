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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GeneratedLevel, ProceduralGenerator } from '../core/ProceduralGenerator';
import { loadTestConfigs } from '../test/loadTestConfigs';

/**
 * Determinism fingerprint: players keep endless seeds and saved runs, so a
 * (seed, level) pair must keep producing the very same level. The hashes were
 * recorded from the generator as it stood before the endless performance and
 * resilience work; a change here means existing runs no longer replay.
 */
const SUITE_TIMEOUT_MS = 120000;

interface Case {
  seed: number;
  level: number;
  hash: string;
}

const ENDLESS_CASES: Case[] = [
  { seed: 1, level: 1, hash: '21a379d97f827' },
  { seed: 1, level: 2, hash: '1564865e3facca' },
  { seed: 1, level: 7, hash: '1bd64c93986cef' },
  { seed: 1, level: 25, hash: '10320bc4ea57fc' },
  { seed: 42, level: 1, hash: 'f43ca9bef0cf0' },
  { seed: 42, level: 2, hash: '1e055ffd283b5a' },
  { seed: 42, level: 7, hash: 'cc6c5e7bf0c0a' },
  { seed: 987654321, level: 1, hash: '2dadc79687cc0' },
  { seed: 987654321, level: 2, hash: 'd2ac2d76ff139' },
  { seed: 987654321, level: 7, hash: '123492abffdec3' }
];

const PACK_CASES: Case[] = [
  { seed: 5, level: 3, hash: '4617d2856a0eb' },
  { seed: 5, level: 12, hash: 'd0e27dafefe1e' }
];

/** 53-bit string hash (cyrb53), enough to tell two serialized levels apart. */
function hashText(text: string): string {
  const SEED_A = 0xdeadbeef;
  const SEED_B = 0x41c6ce57;
  let h1 = SEED_A;
  let h2 = SEED_B;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function fingerprint(generated: GeneratedLevel): string {
  const { level, solution, motifs, pieceMotifs, layout, hubShape, score, attempts } = generated;
  const payload = JSON.stringify({ level, solution, motifs, pieceMotifs, layout, hubShape, score, attempts });
  return hashText(payload);
}

describe('endless and pack determinism fingerprint', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it(
    'endless levels keep their recorded fingerprint',
    () => {
      const actual = ENDLESS_CASES.map((c) => ({ ...c, hash: fingerprint(ProceduralGenerator.generateEndlessLevel(c.level, c.seed)) }));
      expect(actual).toEqual(ENDLESS_CASES);
    },
    SUITE_TIMEOUT_MS
  );

  it(
    'pack levels built the way the editor does keep their recorded fingerprint',
    () => {
      const actual = PACK_CASES.map((c) => ({ ...c, hash: fingerprint(ProceduralGenerator.generateDetailed(c.level, c.seed)) }));
      expect(actual).toEqual(PACK_CASES);
    },
    SUITE_TIMEOUT_MS
  );
});
