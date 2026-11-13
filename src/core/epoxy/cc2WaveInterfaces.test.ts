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
 * The state and hooks the CC2 wave 3 rules stand on: the pending steer of a tank, the blob modifier of the generators,
 * the deferred wire-fired sink edges, the cycle key and the new configuration fields. None of them changes a play by itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findCharacterItemConfigErrors, isCc2LevelData } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import { applyTimedMove, sanitizeTimedMoves } from '../../ui/replaySchedule';
import { GameEngine } from '../GameEngine';
import type { TileDefinition } from '../types';
import { newCcGenerators } from './ccGenerators';
import type { EpoxyWorld } from './epoxyWorld';
import { SIGNAL_PHASE_MOVE, SIGNAL_PHASE_TICK, settleWorldSignals } from './epoxySignals';

beforeEach(() => {
  loadTestConfigs();
});

const FIRST_BOOTS = 'boots_water';
const SECOND_BOOTS = 'boots_fire';
const THIRD_BOOTS = 'boots_ice';
const BLOB_MODIFIER = 2;
const OTHER_BLOB_MODIFIER = 3;
const BYTE_MAX = 255;
const BLOCK_CELL_X = 6;
const EDGE_CELL = 17;
const OTHER_EDGE_CELL = 23;
const PENDING_DUE = 12;
const CC2_RECORD_FIELDS = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x', coverage: { verdict: 'exact', lost: [], approx: [] } };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: 'cc2' | 'native', extra: Partial<Parameters<typeof room>[0]> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, ...extra }));
  return engine;
}

describe('cycle key', () => {
  it('turns the oldest pair of boots to the end, once per call, and records it', () => {
    const engine = load('cc2');
    engine.getPlayer().boots = new Set([FIRST_BOOTS, SECOND_BOOTS, THIRD_BOOTS]);
    expect(engine.cycleInventory()).toBe(true);
    expect([...engine.getPlayer().boots]).toEqual([SECOND_BOOTS, THIRD_BOOTS, FIRST_BOOTS]);
    expect(engine.getTimedMoveHistory().at(-1)).toMatchObject({ cycle: true });
  });

  it('is one undo step that puts the order back and drops the record', () => {
    const engine = load('cc2');
    engine.getPlayer().boots = new Set([FIRST_BOOTS, SECOND_BOOTS]);
    const recordedBefore = engine.getTimedMoveHistory().length;
    engine.cycleInventory();
    expect(engine.undo()).toBe(true);
    expect([...engine.getPlayer().boots]).toEqual([FIRST_BOOTS, SECOND_BOOTS]);
    expect(engine.getTimedMoveHistory()).toHaveLength(recordedBefore);
  });

  it('is refused with fewer than two pairs, off a CC2-engine level, and records nothing', () => {
    const one = load('cc2');
    one.getPlayer().boots = new Set([FIRST_BOOTS]);
    expect(one.cycleInventory()).toBe(false);
    expect(one.canUndo()).toBe(false);
    expect(one.getTimedMoveHistory()).toEqual([]);
    const native = load('native');
    native.getPlayer().boots = new Set([FIRST_BOOTS, SECOND_BOOTS]);
    expect(native.cycleInventory()).toBe(false);
    expect([...native.getPlayer().boots]).toEqual([FIRST_BOOTS, SECOND_BOOTS]);
    expect(native.getTimedMoveHistory()).toEqual([]);
  });

  it('replays from the timed history and survives a stored-solution round trip', () => {
    const engine = load('cc2');
    engine.getPlayer().boots = new Set([FIRST_BOOTS, SECOND_BOOTS]);
    engine.cycleInventory();
    const recorded = engine.getTimedMoveHistory();
    expect(sanitizeTimedMoves(JSON.parse(JSON.stringify(recorded)))).toEqual(recorded);
    const replay = load('cc2');
    replay.getPlayer().boots = new Set([FIRST_BOOTS, SECOND_BOOTS]);
    for (const move of recorded) applyTimedMove(replay, move);
    expect([...replay.getPlayer().boots]).toEqual([SECOND_BOOTS, FIRST_BOOTS]);
  });
});

describe('deferred wire-fired sink edges', () => {
  it('start empty and read as no CC2 wave state', () => {
    const engine = load('cc2');
    expect(world(engine).cc2DeferredSinkEdges).toEqual([]);
    expect(engine.getCc2WaveState()).toBeUndefined();
  });

  it('are reset when another level loads in the same world', () => {
    const engine = load('cc2');
    world(engine).cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).cc2DeferredSinkEdges).toEqual([]);
  });

  it('are saved with the undo snapshot as a copy, and dropped by an undo to a snapshot without them', () => {
    const engine = load('cc2');
    const w = world(engine);
    w.cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    expect(engine.attemptPlayerMove('E')).toBe(true);
    w.cc2DeferredSinkEdges[0].cell = OTHER_EDGE_CELL;
    w.cc2DeferredSinkEdges.push({ cell: OTHER_EDGE_CELL, rising: false });
    expect(engine.undo()).toBe(true);
    expect(w.cc2DeferredSinkEdges).toEqual([{ cell: EDGE_CELL, rising: true }]);

    const empty = load('cc2');
    expect(empty.attemptPlayerMove('E')).toBe(true);
    world(empty).cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    expect(empty.undo()).toBe(true);
    expect(world(empty).cc2DeferredSinkEdges).toEqual([]);
  });

  it('appear in the CC2 wave state only while non-empty', () => {
    const engine = load('cc2');
    world(engine).cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    expect(engine.getCc2WaveState()).toEqual({ deferredSinkEdges: [{ cell: EDGE_CELL, rising: true }] });
  });

  it('are dropped when the level completes', () => {
    const engine = load('cc2');
    world(engine).cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    (engine as unknown as { completeLevel(): void }).completeLevel();
    expect(world(engine).cc2DeferredSinkEdges).toEqual([]);
  });
});

describe('blob modifier of the generators', () => {
  it('is absent by default and does not reach the CC2 wave state', () => {
    expect(newCcGenerators(1).blobModifier).toBeUndefined();
    const engine = load('cc2');
    expect(world(engine).ccGenerators).not.toBeNull();
    expect(world(engine).ccGenerators?.blobModifier).toBeUndefined();
    expect(engine.getCc2WaveState()).toBeUndefined();
  });

  it('is saved and restored by undo, and removed when the snapshot had none', () => {
    const engine = load('cc2');
    const generators = world(engine).ccGenerators;
    if (generators === null) throw new Error('a CC2 level has generators');
    generators.blobModifier = BLOB_MODIFIER;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    generators.blobModifier = OTHER_BLOB_MODIFIER;
    expect(engine.getCc2WaveState()).toEqual({ blobModifier: OTHER_BLOB_MODIFIER });
    expect(engine.undo()).toBe(true);
    expect(generators.blobModifier).toBe(BLOB_MODIFIER);

    const plain = load('cc2');
    const plainGenerators = world(plain).ccGenerators;
    if (plainGenerators === null) throw new Error('a CC2 level has generators');
    expect(plain.attemptPlayerMove('E')).toBe(true);
    plainGenerators.blobModifier = BLOB_MODIFIER;
    expect(plain.undo()).toBe(true);
    expect(plainGenerators.blobModifier).toBeUndefined();
    expect(plain.getCc2WaveState()).toBeUndefined();
  });
});

describe('pending steer of a tank', () => {
  it('is copied into the undo snapshot with the entity, and absent from a fresh entity', () => {
    const engine = load('cc2', { entities: [{ type: 'dirt_block', x: BLOCK_CELL_X, y: ROOM_ROW, dir: 'E' }] });
    const block = engine.getEntities()[0];
    expect(block.pendingSteer).toBeUndefined();
    expect(block.pendingSteerDue).toBeUndefined();
    block.pendingSteer = 'N';
    block.pendingSteerDue = PENDING_DUE;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    delete block.pendingSteer;
    delete block.pendingSteerDue;
    expect(engine.undo()).toBe(true);
    expect(engine.getEntities()[0]).toMatchObject({ pendingSteer: 'N', pendingSteerDue: PENDING_DUE });
  });
});

describe('signal phase parameter', () => {
  it('is accepted by the settle and changes nothing without signals', () => {
    const engine = load('cc2');
    expect(SIGNAL_PHASE_MOVE).not.toBe(SIGNAL_PHASE_TICK);
    expect(settleWorldSignals(world(engine), false, SIGNAL_PHASE_MOVE)).toEqual([]);
    expect(settleWorldSignals(world(engine), false, SIGNAL_PHASE_TICK)).toEqual([]);
  });
});

describe('configuration fields', () => {
  it('accepts a CC2 record without a blob behavior or with a byte, and refuses anything else', () => {
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS })).toBe(true);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: 0 })).toBe(true);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: BYTE_MAX })).toBe(true);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: -1 })).toBe(false);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: BYTE_MAX + 1 })).toBe(false);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: 1.5 })).toBe(false);
    expect(isCc2LevelData({ ...CC2_RECORD_FIELDS, blobBehavior: '1' })).toBe(false);
  });

  it('accepts blocksDirtBlock on an item only, as a boolean', () => {
    const tiles: Record<string, TileDefinition> = JSON.parse(JSON.stringify(ConfigRegistry.getTiles().tiles));
    const item = Object.keys(tiles).find((id) => tiles[id].layer === 'item') as string;
    tiles[item].blocksDirtBlock = true;
    expect(findCharacterItemConfigErrors(tiles).join('\n')).not.toContain('blocksDirtBlock');
    tiles.wall.blocksDirtBlock = true;
    (tiles[item] as unknown as Record<string, unknown>).blocksDirtBlock = 'yes';
    const errors = findCharacterItemConfigErrors(tiles).join('\n');
    expect(errors).toContain('wall.blocksDirtBlock: only an item');
    expect(errors).toContain(`${item}.blocksDirtBlock: expected a boolean`);
  });
});
