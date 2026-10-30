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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GeneratedLevel, ProceduralGenerationError, ProceduralGenerator } from '../core/ProceduralGenerator';
import { loadTestConfigs } from '../test/loadTestConfigs';

type CandidateFn = (levelNumber: number, seed: number, candidate: number, ...rest: unknown[]) => GeneratedLevel;

const SEED = 11;
const LEVEL = 2;
const SUITE_TIMEOUT_MS = 60000;

describe('candidate fallback', { timeout: SUITE_TIMEOUT_MS }, () => {
  let candidates: number;
  let original: CandidateFn;
  let spy: ReturnType<typeof vi.spyOn>;
  /** Candidate indexes asked for, in order. */
  let asked: number[];

  /** Makes every candidate whose index is in `failing` fail the way an unbuildable layout does. */
  function failCandidates(failing: (k: number) => boolean): void {
    const host = ProceduralGenerator as unknown as { generateCandidate: CandidateFn };
    original = host.generateCandidate.bind(ProceduralGenerator);
    spy = vi.spyOn(host, 'generateCandidate').mockImplementation((levelNumber, seed, k, ...rest) => {
      asked.push(k);
      if (failing(k)) throw new ProceduralGenerationError(levelNumber, 'forced failure');
      return original(levelNumber, seed, k, ...rest);
    });
  }

  beforeEach(() => {
    loadTestConfigs();
    candidates = ConfigRegistry.getGame().procedural!.scoring.candidates;
    asked = [];
  });

  afterEach(() => {
    spy?.mockRestore();
  });

  it('builds the first candidate that works after the regular ones all failed', () => {
    failCandidates((k) => k < candidates);
    const generated = ProceduralGenerator.generateEndlessLevel(LEVEL, SEED);
    expect(asked).toEqual([...Array(candidates + 1).keys()]);
    expect(generated.level.number).toBe(LEVEL);
  });

  it('gives each fallback candidate its own stream, the same level every time', () => {
    failCandidates((k) => k < candidates);
    const again = ProceduralGenerator.generateEndlessLevel(LEVEL, SEED);
    const first = ProceduralGenerator.generateEndlessLevel(LEVEL, SEED);
    expect(first.level).toEqual(again.level);
    spy.mockRestore();
    // The kept level is candidate `candidates` itself, not one of the regular candidates.
    const regular = ProceduralGenerator.generateEndlessLevel(LEVEL, SEED);
    expect(first.level.solution).not.toEqual(regular.level.solution);
  });

  it('does not try a fallback candidate while a regular one builds', () => {
    failCandidates((k) => k === 0);
    ProceduralGenerator.generateEndlessLevel(LEVEL, SEED);
    expect(asked).toEqual([...Array(candidates).keys()]);
  });

  it('stops at the configured number of fallback candidates', () => {
    const extra = ConfigRegistry.getGame().procedural!.scoring.fallbackCandidates;
    failCandidates(() => true);
    expect(() => ProceduralGenerator.generateEndlessLevel(LEVEL, SEED)).toThrow(ProceduralGenerationError);
    expect(asked).toEqual([...Array(candidates + extra).keys()]);
  });

  it('keeps the old behaviour when the fallback is turned off', () => {
    ConfigRegistry.getGame().procedural!.scoring.fallbackCandidates = 0;
    failCandidates(() => true);
    expect(() => ProceduralGenerator.generateEndlessLevel(LEVEL, SEED)).toThrow(ProceduralGenerationError);
    expect(asked).toEqual([...Array(candidates).keys()]);
  });

  it('leaves the level id alone, so scores of existing levels stay attached', () => {
    const withFallback = ProceduralGenerator.generateEndlessLevel(1, SEED).level.id;
    ConfigRegistry.getGame().procedural!.scoring.fallbackCandidates = 0;
    expect(ProceduralGenerator.generateEndlessLevel(1, SEED).level.id).toBe(withFallback);
  });

  it('does not swallow an error that is not a generation failure', () => {
    const host = ProceduralGenerator as unknown as { generateCandidate: CandidateFn };
    spy = vi.spyOn(host, 'generateCandidate').mockImplementation(() => {
      throw new TypeError('bug');
    });
    expect(() => ProceduralGenerator.generateEndlessLevel(LEVEL, SEED)).toThrow(TypeError);
  });
});
