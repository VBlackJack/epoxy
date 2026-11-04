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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import laserShowcase from '../../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../../test/fixtures/mechanicsShowcase.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { ProceduralGenerator } from '../ProceduralGenerator';
import { hasLaserContent } from '../RulesetFeatures';
import type { BeamCell, CellEdge, CompiledLevel, Direction, EntityPlacement, LevelBlueprint } from '../types';
import { traceLevelBeams } from './epoxyBeamTrace';
import { mergeBeamCells } from './epoxyTurrets';

const SIZE = 11;
const LANE_Y = 5;
const TURRET_X = 3;
const TURRET_REACH = 3;
const MIRROR_X = 5;
const ARMED_PLAY_START_TICK = 0;
const GENERATED_LEVEL_COUNT = 20;
const GENERATOR_SEED = 7;
const SKIPPED_RULESETS: readonly string[] = ['lynx', 'cc3d'];
const OUT_OF_RANGE_INDEX = 99;
const NEGATIVE_INDEX = -1;
const FRACTIONAL_INDEX = 0.5;
/** Floor on the laser levels the sweep compares: the count today, so a filter that drops levels fails loudly. */
const MIN_LASER_LEVEL_COUNT = 4;
/** Collecting and generating the levels takes seconds. */
const LEVEL_SWEEP_TIMEOUT_MS = 120_000;

interface Setup {
  entities?: EntityPlacement[];
  /** Terrain edits: x, y, tile id. */
  terrain?: Array<[number, number, string]>;
  cellEdges?: CellEdge[];
  underlays?: CompiledLevel['underlays'];
}

/** Walled floor room with the player in a corner, away from every lane. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'beam_trace_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: SIZE - 2, dir: 'N' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    ...(setup.cellEdges ? { cellEdges: setup.cellEdges } : {}),
    ...(setup.underlays ? { underlays: setup.underlays } : {}),
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

const placed = (type: string, x: number, y: number, dir: Direction): EntityPlacement => ({ type, x, y, dir });
const key = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;
const keys = (cells: readonly { x: number; y: number }[]): string[] => cells.map(key).sort();
const sorted = <T extends { x: number; y: number }>(cells: readonly T[]): T[] =>
  [...cells].sort((a, b) => a.y - b.y || a.x - b.x);

/** An engine with the level loaded, the facings given set and, when asked, every turret made to fire. */
function engineOf(level: CompiledLevel, armTurrets: boolean, facings?: ReadonlyMap<number, Direction>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  // Armed through restoreState({ playStartTick: 0 }) rather than a real first step: the world state is equivalent and no move is taken.
  const snapshot = engine.captureState();
  const entities = snapshot.entities.map((entity, index) => {
    const facing = facings?.get(index);
    return facing === undefined ? entity : { ...entity, facing };
  });
  engine.restoreState({
    ...snapshot,
    entities,
    ...(armTurrets ? { playStartTick: ARMED_PLAY_START_TICK } : {})
  });
  return engine;
}

/** The trace of a level and the engine it is compared to, cell by cell and axis by axis. */
function expectSameAsEngine(level: CompiledLevel, armTurrets: boolean, facings?: ReadonlyMap<number, Direction>): void {
  const engine = engineOf(level, armTurrets, facings);
  const trace = traceLevelBeams(level, { armTurrets, ...(facings ? { turretFacings: facings } : {}) });
  expect(sorted(trace.emitterCells)).toEqual(sorted(engine.getEmitterBeamCells()));
  expect(sorted(mergeBeamCells(trace.emitterCells, trace.turretCells))).toEqual(sorted(engine.getBeamCells()));
  expect(sorted(trace.litReceivers)).toEqual(sorted(engine.getLitReceivers()));
}

function showcaseLevels(): CompiledLevel[] {
  return [laserShowcase, mechanicsShowcase].flatMap((pack) =>
    (pack as { levels: LevelBlueprint[] }).levels.map((blueprint) => ConfigRegistry.compileBlueprint(blueprint))
  );
}

function generatedLevels(): CompiledLevel[] {
  return Array.from({ length: GENERATED_LEVEL_COUNT }, (_, index) =>
    ProceduralGenerator.generateLevel(index + 1, GENERATOR_SEED)
  );
}

/** Every level the engine simulation test enumerates that the engine plays and that holds laser content. */
let collectedLevels: CompiledLevel[] | null = null;
function laserLevels(): CompiledLevel[] {
  if (collectedLevels) return collectedLevels;
  const seen = new Set<string>();
  const all = [...ConfigRegistry.getLevels(), ...ConfigRegistry.getPilotLevels(), ...showcaseLevels(), ...generatedLevels()];
  collectedLevels = all.filter((level) => {
    if (SKIPPED_RULESETS.includes(level.ruleset ?? 'epoxy') || seen.has(level.id) || !hasLaserContent(level)) return false;
    seen.add(level.id);
    return true;
  });
  return collectedLevels;
}

/** Freezes a value and everything it holds. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('traceLevelBeams against the engine', () => {
  it('finds laser levels to compare', () => {
    const levels = laserLevels();
    expect(levels.length).toBeGreaterThanOrEqual(MIN_LASER_LEVEL_COUNT);
    const traces = levels.map((level) => traceLevelBeams(level, { armTurrets: true }));
    expect(traces.some((trace) => trace.emitterCells.length > 0)).toBe(true);
    expect(traces.some((trace) => trace.turretCells.length > 0)).toBe(true);
  }, LEVEL_SWEEP_TIMEOUT_MS);

  it('matches a freshly loaded engine on every laser level, turrets not armed', () => {
    for (const level of laserLevels()) expectSameAsEngine(level, false);
  }, LEVEL_SWEEP_TIMEOUT_MS);

  it('matches an engine whose turrets fire on every laser level, turrets armed', () => {
    for (const level of laserLevels()) expectSameAsEngine(level, true);
  }, LEVEL_SWEEP_TIMEOUT_MS);

  it('keeps a turret silent when it waits for the first step and is not armed', () => {
    const level = room({ entities: [placed('turret_fixed', TURRET_X, LANE_Y, 'E')] });
    expect(traceLevelBeams(level, { armTurrets: false }).turretCells).toEqual([]);
    const armed = traceLevelBeams(level, { armTurrets: true });
    expect(keys(armed.turretCells)).toEqual(['4,5', '5,5', '6,5']);
    expect(armed.turretCells).toHaveLength(TURRET_REACH);
  });

  it('fires a turret that does not wait for the first step whether armed or not', () => {
    const turret = ConfigRegistry.getEntityDef('turret_fixed')?.turretBeam;
    if (!turret) throw new Error('turret_fixed is no turret');
    turret.firesAfterFirstStep = false;
    const level = room({ entities: [placed('turret_fixed', TURRET_X, LANE_Y, 'E')] });
    expect(keys(traceLevelBeams(level, { armTurrets: false }).turretCells)).toEqual(['4,5', '5,5', '6,5']);
    expect(keys(traceLevelBeams(level, { armTurrets: true }).turretCells)).toEqual(['4,5', '5,5', '6,5']);
    expectSameAsEngine(level, false);
    expectSameAsEngine(level, true);
  });
});

describe('traceLevelBeams with turret facings', () => {
  const turretLevel = (): CompiledLevel =>
    room({ entities: [placed('turret_cw', TURRET_X, LANE_Y, 'N'), placed('turret_fixed', 8, 8, 'W')] });

  it('turns the turret at the index given, as an engine with the same facing does', () => {
    const facings = new Map<number, Direction>([[0, 'E']]);
    expectSameAsEngine(turretLevel(), true, facings);
    const trace = traceLevelBeams(turretLevel(), { armTurrets: true, turretFacings: facings });
    expect(keys(trace.turretCells)).toEqual(expect.arrayContaining(['4,5', '5,5', '6,5']));
  });

  it('leaves a turret without a given facing the way it was placed', () => {
    const facings = new Map<number, Direction>([[1, 'N']]);
    expectSameAsEngine(turretLevel(), true, facings);
    const trace = traceLevelBeams(turretLevel(), { armTurrets: true, turretFacings: facings });
    expect(keys(trace.turretCells)).toEqual(expect.arrayContaining(['3,4', '3,3', '3,2', '8,7', '8,6', '8,5']));
  });

  it.each([OUT_OF_RANGE_INDEX, NEGATIVE_INDEX, FRACTIONAL_INDEX])('throws a RangeError for the index %s', (index) => {
    expect(() => traceLevelBeams(turretLevel(), { armTurrets: true, turretFacings: new Map([[index, 'E']]) })).toThrow(RangeError);
  });

  it('throws a RangeError for an entity that is no turret', () => {
    const level = room({ entities: [placed('mirror_slash', MIRROR_X, LANE_Y, 'N')] });
    expect(() => traceLevelBeams(level, { armTurrets: true, turretFacings: new Map([[0, 'E']]) })).toThrow(RangeError);
  });
});

describe('traceLevelBeams on built rooms', () => {
  const emitterAt = (extra: Setup = {}): CompiledLevel =>
    room({ ...extra, terrain: [[1, LANE_Y, 'laser_emitter_e'], ...(extra.terrain ?? [])] });

  it('stops a beam on the back of a one-sided mirror and turns it on its front', () => {
    // A beam travelling east meets the west side: the front of the south-west mirror, the back of the north-east one.
    const front = emitterAt({ entities: [placed('one_sided_mirror_sw', MIRROR_X, LANE_Y, 'N')] });
    const back = emitterAt({ entities: [placed('one_sided_mirror_ne', MIRROR_X, LANE_Y, 'N')] });
    expect(keys(traceLevelBeams(front, { armTurrets: false }).emitterCells)).toContain(key({ x: MIRROR_X, y: LANE_Y + 1 }));
    expect(keys(traceLevelBeams(back, { armTurrets: false }).emitterCells)).toEqual(['2,5', '3,5', '4,5']);
    expectSameAsEngine(front, false);
    expectSameAsEngine(back, false);
  });

  it('follows a mirror and lights the receiver', () => {
    const level = emitterAt({
      terrain: [[MIRROR_X, 2, 'laser_receiver_red']],
      entities: [placed('mirror_slash', MIRROR_X, LANE_Y, 'N')]
    });
    const trace = traceLevelBeams(level, { armTurrets: false });
    expect(keys(trace.emitterCells)).toEqual(['2,5', '3,5', '4,5', '5,3', '5,4', '5,5']);
    expect(trace.emitterCells.find((cell) => key(cell) === key({ x: MIRROR_X, y: LANE_Y }))).toMatchObject({
      horizontal: true,
      vertical: true
    });
    expect(trace.litReceivers).toEqual([{ x: MIRROR_X, y: 2 }]);
  });

  it('stops both an emitter beam and a turret beam on a cell edge', () => {
    const level = room({
      terrain: [[1, LANE_Y, 'laser_emitter_e']],
      entities: [placed('turret_fixed', 1, 3, 'E')],
      cellEdges: [
        { x: 4, y: LANE_Y, sides: ['E'] },
        { x: 3, y: 3, sides: ['E'] }
      ]
    });
    const trace = traceLevelBeams(level, { armTurrets: true });
    expect(keys(trace.emitterCells)).toEqual(['2,5', '3,5', '4,5']);
    expect(keys(trace.turretCells)).toEqual(['2,3', '3,3']);
    expectSameAsEngine(level, true);
  });

  it('does not fire an emitter hidden under a removable top', () => {
    const level = room({
      terrain: [[1, LANE_Y, 'wall']],
      underlays: [{ x: 1, y: LANE_Y, terrain: 'laser_emitter_e' }]
    });
    expect(traceLevelBeams(level, { armTurrets: false }).emitterCells).toEqual([]);
    expectSameAsEngine(level, false);
  });

  it('lets the beam through a hold door that its plate opens at load', () => {
    const closed = emitterAt({ terrain: [[4, LANE_Y, 'hold_door_red_closed']] });
    expect(keys(traceLevelBeams(closed, { armTurrets: false }).emitterCells)).toEqual(['2,5', '3,5']);
    const opened = emitterAt({
      terrain: [
        [4, LANE_Y, 'hold_door_red_closed'],
        [2, 2, 'pressure_plate_red']
      ],
      entities: [placed('dirt_block', 2, 2, 'N')]
    });
    const trace = traceLevelBeams(opened, { armTurrets: false });
    expect(keys(trace.emitterCells)).toEqual(expect.arrayContaining(['2,5', '3,5', '4,5', '5,5']));
    expectSameAsEngine(opened, false);
  });
});

describe('traceLevelBeams purity', () => {
  it('neither changes a deep-frozen level nor shares cells with it, and traces twice the same', () => {
    const level = room({
      terrain: [
        [1, LANE_Y, 'laser_emitter_e'],
        [MIRROR_X, 2, 'laser_receiver_red']
      ],
      entities: [placed('mirror_slash', MIRROR_X, LANE_Y, 'N'), placed('turret_cw', 8, 8, 'N')]
    });
    const before = JSON.stringify(level);
    deepFreeze(level);
    const options = { armTurrets: true, turretFacings: new Map<number, Direction>([[1, 'W']]) };
    const first = traceLevelBeams(level, options);
    expect(JSON.stringify(level)).toBe(before);
    expect(traceLevelBeams(level, options)).toEqual(first);
    const cell: BeamCell | undefined = first.emitterCells[0];
    expect(cell).toBeDefined();
    cell.horizontal = !cell.horizontal;
    expect(traceLevelBeams(level, options)).not.toEqual(first);
  });
});
