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

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { EngineSelector } from './EngineSelector';
import { GameEngine } from './GameEngine';
import { LynxEngine } from './lynx/LynxEngine';
import { lynxLevel } from './lynx/lynxTestMaps';
import { featuresFor } from './RulesetFeatures';
import { CompiledLevel } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';

beforeAll(() => {
  loadTestConfigs();
});

function epoxyLevel(): CompiledLevel {
  const level = lynxLevel(['#####', '#@.X#', '#####'], { id: 'epoxy_test' });
  const { ruleset: _ruleset, ...rest } = level;
  return rest;
}

describe('EngineSelector', () => {
  it('gives the Epoxy engine to a level without a ruleset', () => {
    const selector = new EngineSelector();
    expect(selector.forLevel(epoxyLevel())).toBeInstanceOf(GameEngine);
    expect(selector.current).toBeInstanceOf(GameEngine);
  });

  it('gives the Epoxy engine to a level marked epoxy', () => {
    const selector = new EngineSelector();
    expect(selector.forLevel({ ...epoxyLevel(), ruleset: 'epoxy' })).toBeInstanceOf(GameEngine);
  });

  it('gives the Lynx engine to a Lynx level and builds it only once', () => {
    const selector = new EngineSelector();
    const first = selector.forLevel(lynxLevel(['###', '#@#', '###']));
    expect(first).toBeInstanceOf(LynxEngine);
    expect(selector.forLevel(lynxLevel(['###', '#@#', '###'], { id: 'other' }))).toBe(first);
  });

  it('binds the callbacks to both engines, whenever they were given', () => {
    const selector = new EngineSelector();
    const onWin = vi.fn();
    selector.setOnWinCallback(onWin);
    const level = lynxLevel(['####', '#@X#', '####']);
    const lynx = selector.forLevel(level);
    lynx.loadLevel(level);
    for (let i = 0; i < 20; i++) {
      lynx.attemptPlayerMove('E');
      lynx.tick();
    }
    expect(onWin).toHaveBeenCalledTimes(1);
  });

  it('carries the total score over when the engine changes', () => {
    const selector = new EngineSelector();
    const epoxy = selector.forLevel(epoxyLevel());
    epoxy.loadLevel(epoxyLevel());
    epoxy.carryTotalScore(1234);
    const level = lynxLevel(['###', '#@#', '###']);
    const lynx = selector.forLevel(level);
    expect(lynx.getTotalScore()).toBe(1234);
    lynx.loadLevel(level);
    expect(lynx.getTotalScore()).toBe(1234);
    expect(selector.forLevel(epoxyLevel()).getTotalScore()).toBe(1234);
  });
});

describe('featuresFor', () => {
  it('keeps every play aid on an Epoxy level', () => {
    for (const level of [epoxyLevel(), { ...epoxyLevel(), ruleset: 'epoxy' as const }]) {
      expect(Object.values(featuresFor(level)).every(Boolean)).toBe(true);
    }
  });

  it('keeps only the high score replay on a Lynx level', () => {
    const features = featuresFor(lynxLevel(['###', '#@#', '###']));
    expect(features.highScoreReplay).toBe(true);
    const { highScoreReplay: _kept, ...others } = features;
    expect(Object.values(others).some(Boolean)).toBe(false);
  });
});
