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
 * The self links of a CC2 record (Cc2LevelData.selfLinks, wave 17) through a pack file and the stored-level sanitizer. The four official
 * self-latch levels are licensed and kept on the developer's machine only, so no repository fixture is one of them: the levels here are
 * built by hand with the same record shape.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from './ConfigRegistry';
import { sanitizeStoredLevels } from './ConfigValidation';
import { parsePackJson, serializePack } from '../packs/packJson';
import { ROOM_ROW, ROOM_SIZE, room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { Cc2LevelData, CompiledLevel } from '../core/types';

const PLATE_X = 3;
const GATE_X = 5;
const SINK_X = 8;
const SELF_LINKS = [ROOM_ROW * ROOM_SIZE + GATE_X];
/** A well formed CC2 record: the stored-level checks read a record without a coverage as no record. */
const RECORD: Cc2LevelData = { v: 1, sha256: 'ab'.repeat(32), file: 'latch.c2m', order: 1, gridHash: 'x', coverage: { verdict: 'exact', lost: [], approx: [] } };

function selfLatchLevel(): CompiledLevel {
  const level = room({ mode: 'cc2', terrain: { [`${PLATE_X},${ROOM_ROW}`]: 'signal_plate', [`${GATE_X},${ROOM_ROW}`]: 'signal_gate_or_cc2', [`${SINK_X},${ROOM_ROW}`]: 'hold_door_red_closed' } });
  level.signalLinks = [
    { fromX: PLATE_X, fromY: ROOM_ROW, toX: GATE_X, toY: ROOM_ROW },
    { fromX: GATE_X, fromY: ROOM_ROW, toX: SINK_X, toY: ROOM_ROW }
  ];
  level.cc2 = { ...RECORD, selfLinks: [...SELF_LINKS] };
  return level;
}

describe('cc2.selfLinks through a pack file', () => {
  beforeEach(() => loadTestConfigs());

  it('survives an export and a re-import', () => {
    const written = serializePack('Latches', [selfLatchLevel()]);
    const read = parsePackJson(written, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 0);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.levels).toHaveLength(1);
    expect(read.levels[0].cc2?.selfLinks).toEqual(SELF_LINKS);
    expect(read.levels[0].signalLinks).toEqual(selfLatchLevel().signalLinks);
  });

  it('survives the stored-level sanitizer, and drops a malformed list alone', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const [kept] = sanitizeStoredLevels([selfLatchLevel()], bounds);
    expect(kept.cc2?.selfLinks).toEqual(SELF_LINKS);
    const bad = { ...selfLatchLevel(), cc2: { ...selfLatchLevel().cc2, selfLinks: [5, 5] } };
    const [cleaned] = sanitizeStoredLevels([bad], bounds);
    expect(cleaned.cc2).toBeDefined();
    expect(cleaned.cc2?.selfLinks).toBeUndefined();
  });
});
