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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { compilePiece } from './PieceCompiler';
import { PieceSolver } from './PieceSolver';

// Recorded from the analysis before its speed-up: the search must keep reaching the very same states.
const RECORDED_ANALYSIS: Record<string, string> = {
  sanctuary_alchemy_fire_water_sluice: '{"reachableStates":12517,"deadStates":10883,"deadExits":0,"unreturnableGoals":0,"blockEscapes":0,"winnable":true,"truncated":false}',
  sanctuary_sluice_double_trench: '{"reachableStates":7880,"deadStates":6064,"deadExits":0,"unreturnableGoals":0,"blockEscapes":0,"winnable":true,"truncated":false}',
  sanctuary_counterweight_trap_bridge: '{"reachableStates":7871,"deadStates":5125,"deadExits":0,"unreturnableGoals":0,"blockEscapes":0,"winnable":true,"truncated":false}'
};

describe('PieceSolver.analyze digest', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each(Object.entries(RECORDED_ANALYSIS))('keeps the recorded analysis of %s', (pieceId, recorded) => {
    const def = ConfigRegistry.getMotifs().pieces.find((p) => p.id === pieceId)!;
    const compiled = compilePiece(def, ConfigRegistry.getPieceLegend(), ConfigRegistry.getMotifAnnotations()[def.id]);
    expect(JSON.stringify(PieceSolver.analyze(compiled))).toBe(recorded);
  });
});
