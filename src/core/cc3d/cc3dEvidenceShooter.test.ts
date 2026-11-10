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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { Cc3dRig } from './cc3dTestRig';
import { cc3dLevel, cc3dModel } from './cc3dTestMaps';
import type { GlyphMeaning } from './cc3dTestMaps';
import { convertCc3dLevel } from './cc3dToEpoxy';
import { classifyLevel, EPOXY_COVERAGE, SHOOTER_INERT_KINDS } from './epoxyCoverage';
import { device, room, withMob } from './cc3dEvidenceRig';
import type { Cc3dTerrain } from './model';

/**
 * Coverage evidence for the laser shooter: it never moves, cannot be pushed and presses nothing, so the layer under it
 * does nothing. A shooter on water does not sink and on ice does not slide, and the other ground layers stay as they
 * are. Played on the CC3D engine alone, since the Epoxy launcher is a wall-like tile that replaces the cell.
 */

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 1;
const SETTLE_TICKS = 160;
const SHOOTER_X = 3;
const SHOOTER_Y = 2;
/** The layers a shooter may stand on without the layer acting. */
const INERT_LAYERS: Array<[string, Cc3dTerrain]> = [
  ['gravel', { kind: 'gravel' }],
  ['dirt', { kind: 'dirt' }],
  ['ice', { kind: 'ice' }],
  ['ice corner', { kind: 'ice_corner', corner: ['S', 'E'] }],
  ['sand', { kind: 'sand' }],
  ['water', { kind: 'water' }],
  ['laser controller', { kind: 'laser_controller' }]
];

interface MobProbe {
  kind: string;
  x: number;
  y: number;
  dir: string;
}

const mobsOf = (rig: Cc3dRig): MobProbe[] => (rig.engine as unknown as { sim: { world: { mobs: MobProbe[] } } }).sim.world.mobs;

/** A room with the player in the top row and a shooter facing east on the given layer, one cell from the east wall's row. */
function shooterOn(layer: Cc3dTerrain): GlyphMeaning {
  return withMob({ stack: [layer] }, { kind: 'laser_shooter', dir: 'E' });
}

function rows(): string[] {
  return room('@.....', '..S...', '......');
}

describe('a laser shooter on ground that does nothing under it', () => {
  it.each(INERT_LAYERS)('stays in place on %s and fires nothing by itself', (_name, layer) => {
    const source = cc3dLevel(rows(), { glyphs: { S: shooterOn(layer) } });
    const rig = new Cc3dRig(source, SEED);
    const before = rig.engine.getTerrain()[SHOOTER_Y][SHOOTER_X];
    let shots = 0;
    for (let tick = 0; tick < SETTLE_TICKS; tick++) {
      rig.tick(1);
      shots += mobsOf(rig).filter((mob) => mob.kind === 'shot').length;
    }
    const shooters = mobsOf(rig).filter((mob) => mob.kind === 'laser_shooter');
    expect(shooters).toHaveLength(1);
    expect(shooters[0]).toMatchObject({ x: SHOOTER_X, y: SHOOTER_Y, dir: 'E' });
    expect(rig.engine.getTerrain()[SHOOTER_Y][SHOOTER_X]).toBe(before);
    expect(shots).toBe(0);
    expect(rig.player.alive).toBe(true);
  });

  it('is the case of every layer the coverage lists as inert, and of no other', () => {
    expect([...SHOOTER_INERT_KINDS].sort()).toEqual(INERT_LAYERS.map(([, layer]) => layer.kind).sort());
  });

  it('is converted to the launcher alone, with no loss and no drop', () => {
    for (const [name, layer] of INERT_LAYERS) {
      const source = cc3dLevel(rows(), { glyphs: { S: shooterOn(layer) } });
      const { level, report } = convertCc3dLevel(source);
      expect(level.terrain[SHOOTER_Y][SHOOTER_X], name).toBe('shot_launcher_e');
      expect(level.underlays, name).toBeUndefined();
      expect(report.drops, name).toEqual([]);
      expect(report.lost, name).toEqual([]);
      expect(classifyLevel(cc3dModel(rows(), { S: shooterOn(layer) })).lost, name).toEqual([]);
    }
  });

  it('still fires when a controller works it, so the stillness above is not a dead shooter', () => {
    const glyphs: Record<string, GlyphMeaning> = { S: shooterOn({ kind: 'water' }), c: device('laser_controller') };
    const source = cc3dLevel(room('@c....', '..S...', '......'), { glyphs });
    const rig = new Cc3dRig(source, SEED);
    let shots = 0;
    rig.press('E');
    for (let tick = 0; tick < SETTLE_TICKS; tick++) {
      rig.tick(1);
      shots += mobsOf(rig).filter((mob) => mob.kind === 'shot').length;
    }
    expect(shots).toBeGreaterThan(0);
  });
});

describe('a laser shooter on a layer or an item that does something', () => {
  it('stays a loss, and so does a second shooter in the same cell', () => {
    const live: Array<[string, GlyphMeaning]> = [
      ['a red door', withMob({ stack: [{ kind: 'door', color: 'red' }] }, { kind: 'laser_shooter', dir: 'E' })],
      ['fire', withMob({ stack: [{ kind: 'fire' }] }, { kind: 'laser_shooter', dir: 'E' })],
      ['a force floor', withMob({ stack: [{ kind: 'force', dir: 'E' }] }, { kind: 'laser_shooter', dir: 'E' })],
      ['an item', { ...shooterOn({ kind: 'ice' }), item: { kind: 'fish' } }]
    ];
    for (const [name, glyph] of live) {
      const source = cc3dLevel(rows(), { glyphs: { S: glyph } });
      expect(convertCc3dLevel(source).report.lost.map((entry) => entry.key), name).toContain('laser_shooter_covered');
      expect(classifyLevel(cc3dModel(rows(), { S: glyph })).lost, name).toContain('laser_shooter_covered');
    }
    expect(EPOXY_COVERAGE.laser_shooter_covered.level).toBe('lost');
    expect(EPOXY_COVERAGE.laser_shooter_covered.reason).toContain('cc3dEvidenceShooter.test.ts');
  });
});
