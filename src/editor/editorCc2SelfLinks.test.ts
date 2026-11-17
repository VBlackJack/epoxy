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
 * A CC2 self-latch level opened and saved through the editor document path (wave 17 review). The editor holds no cc2 record: the document
 * carries the map layers (the signal links among them) and nothing else, so saving drops the whole record, the self links with it. This
 * is the behaviour the editor had before self links existed (any imported level loses its cc2 record there); the test names it and
 * checks that every other link survives.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ROOM_ROW, ROOM_SIZE, room } from '../test/cc2Room';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { CompiledLevel, SignalLink } from '../core/types';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';

const PLATE_X = 3;
const GATE_X = 5;
const SINK_X = 8;
const link = (fromX: number, toX: number): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW });
const LINKS: SignalLink[] = [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)];
const CONTEXT = { id: 'saved', number: 1, password: 'TEST', fallbackTitle: 'Saved' };

/** A CC2 level with an OR gate wired to its own output (a latch): its self link is the gate cell, in the cc2 record only. */
function selfLatchLevel(): CompiledLevel {
  const level = room({ mode: 'cc2', terrain: { [`${PLATE_X},${ROOM_ROW}`]: 'signal_plate', [`${GATE_X},${ROOM_ROW}`]: 'signal_gate_or_cc2', [`${SINK_X},${ROOM_ROW}`]: 'hold_door_red_closed' } });
  level.signalLinks = LINKS.map((entry) => ({ ...entry }));
  level.cc2 = { ...(level.cc2 as NonNullable<CompiledLevel['cc2']>), selfLinks: [ROOM_ROW * ROOM_SIZE + GATE_X] };
  return level;
}

describe('a CC2 self-latch level through the editor document', () => {
  beforeEach(() => loadTestConfigs());

  it('keeps every other signal link when it is opened and saved', () => {
    const saved = levelFromDocument(documentFromLevel(selfLatchLevel(), { title: 'Latch', hint: '' }), CONTEXT);
    expect(saved.signalLinks).toEqual(LINKS);
  });

  it('loses only the self link: the editor has no cc2 record, so the record goes with it (pre-existing behaviour)', () => {
    const doc = documentFromLevel(selfLatchLevel(), { title: 'Latch', hint: '' });
    expect('cc2' in doc).toBe(false);
    const saved = levelFromDocument(doc, CONTEXT);
    expect(saved.cc2).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('selfLinks');
  });
});
