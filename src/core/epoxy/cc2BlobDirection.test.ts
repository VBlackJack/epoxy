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
 * The way of a CC2 blob: the walker generator plus a modifier stepped by the level's blob behavior, the modifier a
 * replay hands over, and the blob behavior byte of a converted file. A classic (.DAT) blob keeps the main generator.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ORDERED_DIRECTIONS } from '../../config/constants';
import { convertCc2File } from '../../formats/cc2ToEpoxy';
import { makeMap, player } from '../../formats/cc2TestMaps';
import type { Cc2File } from '../../formats/cc2Model';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD, room } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import {
  CC2_BLOB_FIXED_MODIFIER,
  drawBlobDirection,
  drawCc2BlobDirection,
  drawWalkerByte,
  initialBlobModifier,
  newCcGenerators
} from './ccGenerators';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 77;
const DRAWS = 12;
const BEHAVIOR_DEFAULT = 1;
const BEHAVIOR_FIXED = 0;
const BEHAVIOR_EXTRA = 2;
const REPLAY_SEED = 0x5c;
const FOLDED_FIRST = 0xb7;
const FOLDED_SECOND = 110;
const OPTIONS_BLOB_BYTE = 24;
const OPTIONS_LENGTH = 25;
const MAX_TICKS = 200;
const BLOB_CELL = { x: 8, y: 5 };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

describe('CC2 blob draw', () => {
  it('adds the walker draw to a modifier that rotates through four patterns by default', () => {
    const blob = newCcGenerators(SEED);
    blob.blobModifier = 2;
    const shadow = newCcGenerators(SEED);
    let modifier = 2;
    for (let i = 0; i < DRAWS; i++) {
      modifier = (modifier + 1) % 4;
      expect(drawCc2BlobDirection(blob, BEHAVIOR_DEFAULT)).toBe(ORDERED_DIRECTIONS[(drawWalkerByte(shadow) + modifier) % 4]);
      expect(blob.blobModifier).toBe(modifier);
    }
  });

  it('doubles the modifier and folds in 0x1d while it is below 255 for the other behaviors', () => {
    const blob = newCcGenerators(SEED);
    blob.blobModifier = CC2_BLOB_FIXED_MODIFIER;
    drawCc2BlobDirection(blob, BEHAVIOR_FIXED);
    expect(blob.blobModifier).toBe(FOLDED_FIRST);
    drawCc2BlobDirection(blob, BEHAVIOR_EXTRA);
    expect(blob.blobModifier).toBe(FOLDED_SECOND);
  });

  it('does not touch the main generator, which a classic blob still draws from', () => {
    const blob = newCcGenerators(SEED);
    blob.blobModifier = 0;
    const mainBefore = blob.main;
    drawCc2BlobDirection(blob, BEHAVIOR_DEFAULT);
    expect(blob.main).toBe(mainBefore);
    const classic = newCcGenerators(SEED);
    drawBlobDirection(classic);
    expect(classic.main).not.toBe(mainBefore);
    expect(classic.blobModifier).toBeUndefined();
  });
});

describe('initial blob modifier', () => {
  it('is the replay byte for a replay, 0x55 for a fresh deterministic play, the level seed otherwise', () => {
    expect(initialBlobModifier(BEHAVIOR_FIXED, REPLAY_SEED, true)).toBe(REPLAY_SEED);
    expect(initialBlobModifier(BEHAVIOR_FIXED, SEED, false)).toBe(CC2_BLOB_FIXED_MODIFIER);
    expect(initialBlobModifier(BEHAVIOR_DEFAULT, SEED, false)).toBe(SEED);
    expect(initialBlobModifier(BEHAVIOR_EXTRA, 0x1234, false)).toBe(0x34);
  });

  it('is set at load: from the replay seed when given, 0x55 for behavior 0, absent on a classic level', () => {
    const level = (blobBehavior?: number): CompiledLevel => ({
      ...room({ mode: 'cc2' }),
      cc2: { ...CC2_TEST_RECORD, ...(blobBehavior !== undefined ? { blobBehavior } : {}) }
    });
    const engine = new GameEngine();
    engine.loadLevel(level(BEHAVIOR_FIXED), REPLAY_SEED);
    expect(world(engine).ccGenerators?.blobModifier).toBe(REPLAY_SEED);
    engine.loadLevel(level(BEHAVIOR_FIXED));
    expect(world(engine).ccGenerators?.blobModifier).toBe(CC2_BLOB_FIXED_MODIFIER);
    engine.loadLevel(level(BEHAVIOR_DEFAULT));
    expect(world(engine).ccGenerators?.blobModifier).toBeDefined();
    engine.loadLevel(room({ mode: 'cc' }));
    expect(world(engine).ccGenerators?.blobModifier).toBeUndefined();
  });
});

describe('blob in play', () => {
  function firstStep(mode: 'cc2' | 'cc'): { modifierBefore: number | undefined; modifierAfter: number | undefined } {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, startX: 2, entities: [{ type: 'blob', x: BLOB_CELL.x, y: BLOB_CELL.y, dir: 'N' }] }), REPLAY_SEED);
    const before = world(engine).ccGenerators?.blobModifier;
    for (let i = 0; i < MAX_TICKS && world(engine).ccGenerators?.blobModifier === before && mode === 'cc2'; i++) engine.tick();
    if (mode === 'cc') for (let i = 0; i < MAX_TICKS; i++) engine.tick();
    return { modifierBefore: before, modifierAfter: world(engine).ccGenerators?.blobModifier };
  }

  it('steps the modifier on a CC2 level at the first decision', () => {
    const { modifierBefore, modifierAfter } = firstStep('cc2');
    expect(modifierBefore).toBe(REPLAY_SEED);
    expect(modifierAfter).toBe((REPLAY_SEED + 1) % 4);
  });

  it('leaves a classic level without a modifier', () => {
    const { modifierBefore, modifierAfter } = firstStep('cc');
    expect(modifierBefore).toBeUndefined();
    expect(modifierAfter).toBeUndefined();
  });
});

describe('blob behavior in a converted file', () => {
  const file = (optionsBytes: number[] | undefined): Cc2File => ({
    sections: [
      ...(optionsBytes !== undefined ? [{ kind: 'options' as const, tag: 'OPTN' as const, raw: new Uint8Array(optionsBytes), options: { timeLimit: 0, flags: [] } }] : []),
      { kind: 'map', tag: 'PACK', map: makeMap(3, 3, [player(1, 1)]) }
    ],
    trailing: new Uint8Array(0)
  });
  const source = { file: 'a.c2m', order: 1, sha256: '00'.repeat(32) };

  it('reads byte 24 of the options section', () => {
    const bytes = new Array<number>(OPTIONS_LENGTH).fill(0);
    bytes[OPTIONS_BLOB_BYTE] = 2;
    expect(convertCc2File(file(bytes), source).level.cc2?.blobBehavior).toBe(2);
    bytes[OPTIONS_BLOB_BYTE] = 0;
    expect(convertCc2File(file(bytes), source).level.cc2?.blobBehavior).toBe(0);
  });

  it('leaves the behavior absent when the options section is short or missing', () => {
    expect(convertCc2File(file(new Array<number>(OPTIONS_BLOB_BYTE).fill(0)), source).level.cc2?.blobBehavior).toBeUndefined();
    expect(convertCc2File(file(undefined), source).level.cc2?.blobBehavior).toBeUndefined();
  });
});
