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

import { Cc3dEngine } from './cc3d/Cc3dEngine';
import { decodeCc3dLevel } from '../formats/Cc3dXmlCodec';
import { EngineSelector } from './EngineSelector';
import { GameEngine } from './GameEngine';
import { LynxEngine } from './lynx/LynxEngine';
import { lynxLevel } from './lynx/lynxTestMaps';
import { featuresFor, hasLaserContent } from './RulesetFeatures';
import { CompiledLevel } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';

beforeAll(() => {
  loadTestConfigs();
});

const CC3D_CELL = 64;
const CC3D_PLAYER_TYPE = 22;

function cc3dLevel(mapId: string): CompiledLevel {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?><map name="T" author="A" width="5" height="5" background="0"><tiles>' +
    `<tile image_index="${CC3D_PLAYER_TYPE}" x="${CC3D_CELL}" y="${CC3D_CELL}" direction="0" type="${CC3D_PLAYER_TYPE}"><attributes flags="0" editor_category="0" name="Stored" /></tile>` +
    '</tiles></map>';
  return decodeCc3dLevel(xml, { packName: 'pack', mapId, number: 1 });
}

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

  it('gives the cc3d engine to a cc3d level and builds it only once', () => {
    const selector = new EngineSelector();
    const first = selector.forLevel(cc3dLevel('1'));
    expect(first).toBeInstanceOf(Cc3dEngine);
    expect(selector.current).toBe(first);
    expect(selector.forLevel(cc3dLevel('2'))).toBe(first);
  });

  it('forwards the callbacks to the cc3d engine, given before or after it is built', () => {
    const early = new EngineSelector();
    early.setOnWinCallback(vi.fn());
    early.setOnVisualEventCallback(vi.fn());
    const engine = early.forLevel(cc3dLevel('1')) as unknown as { onWin: unknown; onVisual: unknown };
    expect(engine.onWin).not.toBeNull();
    expect(engine.onVisual).not.toBeNull();

    const late = new EngineSelector();
    const lateEngine = late.forLevel(cc3dLevel('1')) as unknown as { onWin: unknown; onVisual: unknown };
    expect(lateEngine.onWin).toBeNull();
    late.setOnWinCallback(vi.fn());
    late.setOnVisualEventCallback(vi.fn());
    expect(lateEngine.onWin).not.toBeNull();
    expect(lateEngine.onVisual).not.toBeNull();
  });

  it('carries the total score across a switch to the cc3d engine and back', () => {
    const selector = new EngineSelector();
    const epoxy = selector.forLevel(epoxyLevel());
    epoxy.loadLevel(epoxyLevel());
    epoxy.carryTotalScore(321);
    const cc3d = selector.forLevel(cc3dLevel('1'));
    expect(cc3d.getTotalScore()).toBe(321);
    expect(selector.forLevel(epoxyLevel())).toBe(epoxy);
  });

  it('refuses a ruleset it does not know', () => {
    const selector = new EngineSelector();
    expect(() => selector.forLevel({ ruleset: 'unknown' as never })).toThrow(/Unknown ruleset/);
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

  it('turns the block hint and the dead end watch off on a level with lasers', () => {
    const base = epoxyLevel();
    const withEmitter: CompiledLevel = {
      ...base,
      terrain: base.terrain.map((row, y) => (y === 1 ? [...row.slice(0, 3), 'laser_emitter_e', ...row.slice(4)] : row))
    };
    const features = featuresFor(withEmitter);
    expect(features.blockHint).toBe(false);
    expect(features.deadEndWatch).toBe(false);
    expect(features.objectiveMarker).toBe(true);
    expect(features.tapToPath).toBe(true);
    expect(hasLaserContent(withEmitter)).toBe(true);
    expect(hasLaserContent(base)).toBe(false);
  });

  it('detects a mirror as laser content', () => {
    const base = epoxyLevel();
    const withMirror: CompiledLevel = { ...base, entities: [{ type: 'mirror_slash', x: 2, y: 1, dir: 'S' }] };
    expect(featuresFor(withMirror).blockHint).toBe(false);
  });

  it('also turns the objective marker off on a receivers level', () => {
    const features = featuresFor({ ...epoxyLevel(), winRule: 'receivers' });
    expect(features.objectiveMarker).toBe(false);
    expect(features.blockHint).toBe(false);
    expect(features.deadEndWatch).toBe(false);
    expect(features.tapToPath).toBe(true);
  });

  it('never gives a Lynx level more than its own aids because of a win rule', () => {
    expect(featuresFor({ ...lynxLevel(['###', '#@#', '###']), winRule: 'receivers' }).tapToPath).toBe(false);
  });
});
