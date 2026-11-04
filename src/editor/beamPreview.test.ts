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
import { GameEngine } from '../core/GameEngine';
import type { BeamCell, CompiledLevel, Direction, EntityPlacement, LevelBlueprint } from '../core/types';
import laserShowcase from '../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../test/fixtures/mechanicsShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { armTurretsAtTickZero, computeBeamPreview, EMPTY_BEAM_PREVIEW } from './beamPreview';

const SIZE = 11;
const LANE_Y = 5;
const TURRET_X = 3;
const TURRET_REACH = 3;
const TURRET_SHOWCASE_INDEX = 5;
const LASER_SHOWCASE_EMITTER_CELLS = 13;
const LASER_SHOWCASE_RECEIVERS = 2;
const MIRROR_X = 5;
const LATER_FACING_CELLS = 9;

interface Setup {
  entities?: EntityPlacement[];
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  ruleset?: CompiledLevel['ruleset'];
}

/** Walled floor room with the player in a corner, away from every lane. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'beam_preview_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    ...(setup.ruleset ? { ruleset: setup.ruleset } : {}),
    playerStart: { x: 1, y: SIZE - 2, dir: 'N' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

const placed = (type: string, x: number, y: number, dir: Direction): EntityPlacement => ({ type, x, y, dir });
const key = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;
const keys = (cells: readonly { x: number; y: number }[]): string[] => cells.map(key).sort();

function showcaseLevel(source: { levels: unknown }, index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((source.levels as LevelBlueprint[])[index]);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('computeBeamPreview on the laser showcase', () => {
  it('reports the emitter beams of the first level, no turret, no lit receiver yet', () => {
    const preview = computeBeamPreview(showcaseLevel(laserShowcase, 0));
    expect(preview.hasLasers).toBe(true);
    expect(preview.emitterCells).toHaveLength(LASER_SHOWCASE_EMITTER_CELLS);
    expect(preview.beamCells).toHaveLength(LASER_SHOWCASE_EMITTER_CELLS);
    expect(preview.turretCells).toEqual([]);
    expect(preview.dimTurretCells).toEqual([]);
    expect(preview.litReceivers).toEqual([]);
    expect(preview.totalReceivers).toBe(LASER_SHOWCASE_RECEIVERS);
  });

  it('matches what a freshly loaded engine reports for the same level', () => {
    const level = showcaseLevel(laserShowcase, 1);
    const engine = new GameEngine();
    engine.loadLevel(level);
    const preview = computeBeamPreview(level);
    expect(keys(preview.beamCells)).toEqual(keys(engine.getBeamCells()));
    expect(preview.litReceivers).toEqual([...engine.getLitReceivers()]);
  });
});

describe('computeBeamPreview on a built room', () => {
  const emitterRoom = (): CompiledLevel =>
    room({
      terrain: [
        [1, LANE_Y, 'laser_emitter_e'],
        [MIRROR_X, 2, 'laser_receiver_red'],
        [8, 8, 'laser_gate_red_closed']
      ],
      entities: [placed('mirror_slash', MIRROR_X, LANE_Y, 'N')]
    });

  it('follows a mirror, lights the receiver and marks the gate that opens', () => {
    const preview = computeBeamPreview(emitterRoom());
    expect(keys(preview.emitterCells)).toEqual(['2,5', '3,5', '4,5', '5,3', '5,4', '5,5']);
    const mirrorCell = preview.emitterCells.find((cell) => cell.x === MIRROR_X && cell.y === LANE_Y);
    expect(mirrorCell).toMatchObject({ horizontal: true, vertical: true });
    expect(preview.litReceivers).toEqual([{ x: MIRROR_X, y: 2 }]);
    expect(preview.totalReceivers).toBe(1);
    expect(preview.gatesOpening).toEqual([{ x: 8, y: 8 }]);
  });

  it('marks no gate while its receiver stays dark', () => {
    const level = emitterRoom();
    level.entities = [];
    const preview = computeBeamPreview(level);
    expect(preview.litReceivers).toEqual([]);
    expect(preview.gatesOpening).toEqual([]);
  });

  it('shows a fixed turret firing at tick 0 within its reach, and no later facing', () => {
    const preview = computeBeamPreview(room({ entities: [placed('turret_fixed', TURRET_X, LANE_Y, 'E')] }));
    expect(preview.emitterCells).toEqual([]);
    expect(keys(preview.turretCells)).toEqual(['4,5', '5,5', '6,5']);
    expect(preview.turretCells).toHaveLength(TURRET_REACH);
    expect(preview.beamCells).toHaveLength(TURRET_REACH);
    expect(preview.dimTurretCells).toEqual([]);
  });

  it.each(['turret_cw', 'turret_ccw'])('shows the three later facings of %s as dim cells', (type) => {
    const preview = computeBeamPreview(room({ entities: [placed(type, MIRROR_X, LANE_Y, 'E')] }));
    expect(keys(preview.turretCells)).toEqual(['6,5', '7,5', '8,5']);
    expect(preview.dimTurretCells).toHaveLength(LATER_FACING_CELLS);
    const tick0 = new Set(keys(preview.beamCells));
    for (const cell of preview.dimTurretCells) expect(tick0.has(key(cell))).toBe(false);
  });

  it('leaves the level untouched', () => {
    const level = room({ entities: [placed('turret_cw', MIRROR_X, LANE_Y, 'E')] });
    const before = JSON.stringify(level);
    computeBeamPreview(level);
    expect(JSON.stringify(level)).toBe(before);
  });

  it('keeps a cell a turning turret reaches later out of the dim list when an emitter beam already crosses it', () => {
    const level = room({
      terrain: [[1, LANE_Y, 'laser_emitter_e']],
      entities: [placed('turret_cw', MIRROR_X, 3, 'E')]
    });
    const preview = computeBeamPreview(level);
    const lane = preview.beamCells.find((cell: BeamCell) => cell.x === 4 && cell.y === LANE_Y);
    expect(lane?.horizontal).toBe(true);
    expect(preview.dimTurretCells.some((cell) => key(cell) === '4,5' && cell.horizontal)).toBe(false);
  });
});

describe('computeBeamPreview on the turret showcase', () => {
  it('shows the three turrets firing at tick 0', () => {
    const preview = computeBeamPreview(showcaseLevel(mechanicsShowcase, TURRET_SHOWCASE_INDEX));
    expect(preview.hasLasers).toBe(true);
    expect(preview.emitterCells).toEqual([]);
    expect(keys(preview.turretCells)).toEqual(['13,2', '5,2', '9,2']);
  });
});

describe('computeBeamPreview refusals', () => {
  it('is empty on a level without laser content', () => {
    expect(computeBeamPreview(room())).toBe(EMPTY_BEAM_PREVIEW);
    expect(EMPTY_BEAM_PREVIEW.hasLasers).toBe(false);
  });

  it('is empty on a Lynx level, whatever it holds', () => {
    const level = room({ ruleset: 'lynx', terrain: [[1, LANE_Y, 'laser_emitter_e']] });
    expect(computeBeamPreview(level)).toBe(EMPTY_BEAM_PREVIEW);
  });

  it('does not throw on a broken level and returns the empty preview', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const level = room({ terrain: [[1, LANE_Y, 'laser_emitter_e']] });
    level.terrain[3] = undefined as unknown as string[];
    expect(() => computeBeamPreview(level)).not.toThrow();
    expect(computeBeamPreview(level)).toBe(EMPTY_BEAM_PREVIEW);
    quiet.mockRestore();
  });
});

describe('the engine adapter', () => {
  it('arms the turrets through one restoreState call with play start at tick 0', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ entities: [placed('turret_fixed', TURRET_X, LANE_Y, 'E')] }));
    expect(engine.getBeamCells()).toEqual([]);
    const restore = vi.spyOn(engine, 'restoreState');
    armTurretsAtTickZero(engine);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0][0].playStartTick).toBe(0);
    expect(engine.getBeamCells()).toHaveLength(TURRET_REACH);
  });
});
