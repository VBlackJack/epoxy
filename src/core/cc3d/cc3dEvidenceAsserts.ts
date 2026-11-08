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

import { expect } from 'vitest';
import { playScenario } from './cc3dEvidenceRig';
import type { EvidenceScenario } from './cc3dEvidenceRig';
import type { DiffMismatch, DifferentialPair } from './cc3dToEpoxyDifferential';

/**
 * Assertions of the coverage evidence tests. A scenario that agrees must also prove it did something (its check
 * reads the CC3D side), or an empty scenario would agree with anything.
 */

/** Asserts that both engines agree after every move, then runs the checks that prove the scenario did something. */
export function expectAgree(scenario: EvidenceScenario, check?: (pair: DifferentialPair) => void): void {
  const outcome = playScenario(scenario);
  expect(outcome.mismatch, JSON.stringify(outcome.mismatch)).toBeNull();
  check?.(outcome.pair);
}

/**
 * Asserts the documented disagreement: the engines first differ on `field`. The checks run on the state at that
 * moment, so they can name what CC3D did.
 */
export function expectDisagree(scenario: EvidenceScenario, field: DiffMismatch['field'], check?: (pair: DifferentialPair) => void): void {
  const outcome = playScenario(scenario);
  expect(outcome.mismatch, 'the engines no longer differ here').not.toBeNull();
  expect(outcome.mismatch?.field).toBe(field);
  check?.(outcome.pair);
}
