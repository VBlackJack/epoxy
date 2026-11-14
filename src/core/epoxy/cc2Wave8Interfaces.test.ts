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
 * The state the CC2 wave 8 rules stand on: the mirror players' remembered decision, the blasted walls, the ghost bar, the
 * actor order and the config flags. None of it changes a play by itself; absent, every key and hash is what it was.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { isCc2LevelData } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD, room, ROOM_SIZE } from '../../test/cc2Room';
import { CC2_DYNAMITE_LIGHT_TICK_OFFSET, effectiveDynamiteFuseTicks } from '../coreConstants';
import type { CompiledLevel } from '../types';
import { GameEngine } from '../GameEngine';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

const BAR_CELL = 4 * ROOM_SIZE + 4;
const WALL_CELL = 5 * ROOM_SIZE + 5;

function load(extra: Partial<CompiledLevel> = {}, mirror = false): GameEngine {
  const engine = new GameEngine();
  const level = room({ mode: 'cc2', entities: mirror ? [{ type: 'mirror_chip', x: 3, y: 3, dir: 'N' }] : [] });
  engine.loadLevel({ ...level, ...extra });
  return engine;
}

describe('mirror move memory', () => {
  it('starts absent and enters the key, the snapshot and the hash state only when set', () => {
    const engine = load();
    const unset = cc2HiddenStateKey(world(engine));
    expect(world(engine).mirrorMove).toBeUndefined();
    expect(engine.getCc2WaveState()?.mirrorMove).toBeUndefined();
    world(engine).mirrorMove = { remembered: 'E', snapshot: null, attempted: true };
    expect(cc2HiddenStateKey(world(engine))).not.toBe(unset);
    expect(engine.getCc2WaveState()?.mirrorMove).toEqual({ remembered: 'E', snapshot: null, attempted: true });
    const snap = engine.captureState();
    world(engine).mirrorMove = undefined;
    engine.restoreState(snap);
    expect(world(engine).mirrorMove).toEqual({ remembered: 'E', snapshot: null, attempted: true });
    engine.restoreState({ ...snap, mirrorMove: undefined });
    expect(world(engine).mirrorMove).toBeUndefined();
  });

  it('is reset when another level loads in the same world', () => {
    const engine = load();
    world(engine).mirrorMove = { remembered: 'N', snapshot: 'N', attempted: false };
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).mirrorMove).toBeUndefined();
  });

  it('keeps the two tick hooks silent: a tick leaves no memory behind', () => {
    const engine = load({}, true);
    engine.tick();
    expect(world(engine).mirrorMove).toBeUndefined();
  });
});

describe('ghost bar', () => {
  it('is built at load from the listed cells, bounds-checked, on a CC2-engine level only', () => {
    const cc2 = { ...CC2_TEST_RECORD, ghostBarCells: [BAR_CELL, ROOM_SIZE * ROOM_SIZE, ROOM_SIZE * ROOM_SIZE + 5] };
    const engine = load({ cc2 });
    expect([...(world(engine).ghostBar as Set<number>)]).toEqual([BAR_CELL]);
    expect(world(load()).ghostBar).toBeUndefined();
  });

  it('stays out of the key and the hash until a cell leaves it, then is saved and restored', () => {
    const cc2 = { ...CC2_TEST_RECORD, ghostBarCells: [BAR_CELL, BAR_CELL + 1] };
    const engine = load({ cc2 });
    const loaded = cc2HiddenStateKey(world(engine));
    expect(loaded).toBe(cc2HiddenStateKey(world(load())));
    expect(engine.getCc2WaveState()?.ghostBar).toBeUndefined();
    const snapLoaded = engine.captureState();
    expect(snapLoaded.ghostBar).toBeUndefined();
    (world(engine).ghostBar as Set<number>).delete(BAR_CELL);
    expect(cc2HiddenStateKey(world(engine))).not.toBe(loaded);
    expect(engine.getCc2WaveState()?.ghostBar).toEqual([BAR_CELL + 1]);
    const snapEdited = engine.captureState();
    expect(snapEdited.ghostBar).toEqual([BAR_CELL + 1]);
    engine.restoreState(snapLoaded);
    expect([...(world(engine).ghostBar as Set<number>)].sort((a, b) => a - b)).toEqual([BAR_CELL, BAR_CELL + 1]);
    engine.restoreState(snapEdited);
    expect([...(world(engine).ghostBar as Set<number>)]).toEqual([BAR_CELL + 1]);
  });

  it('checks the list shape in a CC2 record', () => {
    const ok = (list: unknown): boolean => isCc2LevelData({ ...CC2_TEST_RECORD, coverage: { verdict: 'exact', lost: [], approx: [] }, ghostBarCells: list });
    expect(ok(undefined)).toBe(true);
    expect(ok([])).toBe(true);
    expect(ok([0, 4, 9])).toBe(true);
    expect(ok([4, 4])).toBe(false);
    expect(ok([5, 4])).toBe(false);
    expect(ok([-1])).toBe(false);
    expect(ok([1.5])).toBe(false);
    expect(ok('1')).toBe(false);
  });
});

describe('blasted walls', () => {
  it('keep the level mask untouched, are saved with the snapshot and part of the key and the hash state', () => {
    const cellEdges = [{ x: 5, y: 5, sides: ['N'] }];
    const engine = load({ cellEdges } as unknown as Partial<CompiledLevel>);
    const levelMask = world(engine).edgeMask as Uint8Array;
    expect(levelMask[WALL_CELL]).not.toBe(0);
    const unset = cc2HiddenStateKey(world(engine));
    const snapBefore = engine.captureState();
    expect(snapBefore.blastedEdgeMask).toBeUndefined();
    const blasted = Uint8Array.from(levelMask);
    blasted[WALL_CELL] = 0;
    world(engine).blastedEdgeMask = blasted;
    world(engine).edgeMask = blasted;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(unset);
    expect(engine.getCc2WaveState()?.blastedEdges).toEqual([`${WALL_CELL}:0`]);
    const snap = engine.captureState();
    expect(snap.blastedEdgeMask?.[WALL_CELL]).toBe(0);
    engine.restoreState(snapBefore);
    expect(world(engine).blastedEdgeMask).toBeUndefined();
    expect(world(engine).edgeMask).toBe(levelMask);
    engine.restoreState(snap);
    expect(world(engine).edgeMask).toBe(world(engine).blastedEdgeMask);
    expect((world(engine).edgeMask as Uint8Array)[WALL_CELL]).toBe(0);
    expect(levelMask[WALL_CELL]).not.toBe(0);
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).blastedEdgeMask).toBeUndefined();
  });
});

describe('actor order', () => {
  it('numbers the actors of a level with a mirror in reading order, players included', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: 2,
        entities: [
          { type: 'mirror_chip', x: 9, y: 7, dir: 'N' },
          { type: 'bug', x: 3, y: 2, dir: 'N' }
        ]
      })
    );
    const w = world(engine);
    const bug = w.entities.find((e) => e.type === 'bug');
    const mirror = w.entities.find((e) => e.type === 'mirror_chip');
    expect([bug?.listOrdinal, w.player.listOrdinal, mirror?.listOrdinal]).toEqual([0, 1, 2]);
    const snap = engine.captureState();
    expect(snap.player.listOrdinal).toBe(1);
    engine.restoreState(snap);
    expect(world(engine).player.listOrdinal).toBe(1);
  });

  it('leaves a level without a mirror, and any other ruleset, without ordinals', () => {
    for (const mode of ['cc2', 'cc', 'native'] as const) {
      const engine = new GameEngine();
      engine.loadLevel(room({ mode, entities: [{ type: 'bug', x: 3, y: 2, dir: 'N' }] }));
      expect(world(engine).player.listOrdinal).toBeUndefined();
      expect(world(engine).entities[0].listOrdinal).toBeUndefined();
    }
    const native = new GameEngine();
    native.loadLevel(room({ mode: 'native', entities: [{ type: 'mirror_chip', x: 3, y: 2, dir: 'N' }] }));
    expect(world(native).player.listOrdinal).toBeUndefined();
  });
});

describe('config flags and constants', () => {
  it('marks the dirt as cleared at step end and the monsters that pass hints', () => {
    expect(ConfigRegistry.getTile('dirt').clearsOnArriveCc2).toBe(true);
    expect(ConfigRegistry.getTile('dirt_cc2').clearsOnArriveCc2).toBe(true);
    expect(ConfigRegistry.getTile('blue_wall_fake').clearsOnArriveCc2).toBeUndefined();
    const passing = ['ghost', 'rover', 'rolling_ball', 'mirror_chip', 'mirror_melinda'];
    for (const id of passing) expect(ConfigRegistry.getEntityDef(id)?.passesCc2Hints).toBe(true);
    expect(ConfigRegistry.getEntityDef('bug')?.passesCc2Hints).toBeUndefined();
  });

  it('adds the lighting offset to the dynamite fuse on the CC2 engine only', () => {
    expect(CC2_DYNAMITE_LIGHT_TICK_OFFSET).toBe(1);
    expect(effectiveDynamiteFuseTicks(85, true)).toBe(85 + CC2_DYNAMITE_LIGHT_TICK_OFFSET);
    expect(effectiveDynamiteFuseTicks(85, false)).toBe(85);
  });
});
