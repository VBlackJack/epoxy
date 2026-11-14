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
 * The use_cc1_boots byte of the options section of a CC2 file (OPTN byte 23) is kept in the level record: a level that sets it
 * plays with the CC1 boot rules and has no four-tool belt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { isCc2LevelData } from '../../config/ConfigValidation';
import { convertCc2File } from '../../formats/cc2ToEpoxy';
import { makeMap, player } from '../../formats/cc2TestMaps';
import type { Cc2File } from '../../formats/cc2Model';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD } from '../../test/cc2Room';

beforeEach(() => {
  loadTestConfigs();
});

const OPTIONS_USE_CC1_BOOTS_BYTE = 23;
const OPTIONS_BLOB_BYTE = 24;
const OPTIONS_LENGTH = 25;

describe('the use_cc1_boots byte of a converted file', () => {
  const file = (optionsBytes: number[] | undefined): Cc2File => ({
    sections: [
      ...(optionsBytes !== undefined ? [{ kind: 'options' as const, tag: 'OPTN' as const, raw: new Uint8Array(optionsBytes), options: { timeLimit: 0, flags: [] } }] : []),
      { kind: 'map', tag: 'PACK', map: makeMap(3, 3, [player(1, 1)]) }
    ],
    trailing: new Uint8Array(0)
  });
  const source = { file: 'a.c2m', order: 1, sha256: '00'.repeat(32) };

  it('is read from byte 23 of the options section', () => {
    const bytes = new Array<number>(OPTIONS_LENGTH).fill(0);
    bytes[OPTIONS_USE_CC1_BOOTS_BYTE] = 1;
    expect(convertCc2File(file(bytes), source).level.cc2?.useCc1Boots).toBe(true);
    bytes[OPTIONS_USE_CC1_BOOTS_BYTE] = 0;
    expect(convertCc2File(file(bytes), source).level.cc2?.useCc1Boots).toBe(false);
  });

  it('does not disturb the blob behavior byte next to it', () => {
    const bytes = new Array<number>(OPTIONS_LENGTH).fill(0);
    bytes[OPTIONS_USE_CC1_BOOTS_BYTE] = 1;
    bytes[OPTIONS_BLOB_BYTE] = 2;
    const record = convertCc2File(file(bytes), source).level.cc2;
    expect(record?.useCc1Boots).toBe(true);
    expect(record?.blobBehavior).toBe(2);
  });

  it('stays absent when the options section is short or missing', () => {
    expect(convertCc2File(file(new Array<number>(OPTIONS_USE_CC1_BOOTS_BYTE).fill(0)), source).level.cc2?.useCc1Boots).toBeUndefined();
    expect(convertCc2File(file(undefined), source).level.cc2?.useCc1Boots).toBeUndefined();
  });

  it('is accepted as a boolean by the record check and refused as anything else', () => {
    expect(isCc2LevelData({ ...CC2_TEST_RECORD, coverage: convertCc2File(file(undefined), source).coverage, useCc1Boots: true })).toBe(true);
    expect(isCc2LevelData({ ...CC2_TEST_RECORD, coverage: convertCc2File(file(undefined), source).coverage, useCc1Boots: 1 })).toBe(false);
  });
});
