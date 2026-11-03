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

import { describe, expect, it } from 'vitest';
import { parseXsbCollection } from '../formats/XsbCodec';
import { compareRooms, findSimilarRooms, layoutFromXsb, orientations, RoomLayout } from './RoomFingerprint';

/** Tiny original puzzles written for these tests. */
const ROOM_A = ['#######', '#.  $ #', '# $ . #', '#  @  #', '#######'];
/** ROOM_A turned a quarter turn. */
const ROOM_A_TURNED = ['#####', '#  .#', '# $ #', '#@  #', '# .$#', '#   #', '#####'];
const ROOM_B = ['######', '#@ $.#', '#    #', '######'];
const ROOM_B_SHIFTED = ['    ######', '    #@ $.#', '    #    #', '    ######'];
const ROOM_B_MOVED_BLOCK = ['######', '#@  .#', '# $  #', '######'];
const NEAR_IDENTICAL = 1 - 1e-9;
const MIN_PARTIAL_SIMILARITY = 0.5;
const STRICT_FLOOR = 0.95;

function room(label: string, lines: string[]): RoomLayout {
  return layoutFromXsb(label, { title: label, lines });
}

describe('RoomFingerprint', () => {
  it('crops a room to its playable cells and counts blocks and targets', () => {
    const layout = room('a', ROOM_A);
    expect(layout.width).toBe(5);
    expect(layout.height).toBe(3);
    expect(layout.targets).toBe(2);
    expect(layout.blocks).toBe(2);
  });

  it('produces 8 orientations of a layout', () => {
    expect(orientations(room('a', ROOM_A))).toHaveLength(8);
  });

  it('scores an identical room 1', () => {
    expect(compareRooms(room('a', ROOM_B), room('b', ROOM_B))?.similarity).toBeGreaterThan(NEAR_IDENTICAL);
  });

  it('ignores translation and padding', () => {
    expect(compareRooms(room('a', ROOM_B), room('b', ROOM_B_SHIFTED))?.similarity).toBeGreaterThan(NEAR_IDENTICAL);
  });

  it('ignores rotation and reflection', () => {
    expect(compareRooms(room('a', ROOM_A), room('b', ROOM_A_TURNED))?.similarity).toBeGreaterThan(NEAR_IDENTICAL);
  });

  it('scores a room with another block layout below the same room', () => {
    const moved = compareRooms(room('a', ROOM_B), room('b', ROOM_B_MOVED_BLOCK))?.similarity ?? 0;
    expect(moved).toBeLessThan(NEAR_IDENTICAL);
    expect(moved).toBeGreaterThan(MIN_PARTIAL_SIMILARITY);
  });

  it('skips a pair whose size alone rules out the floor', () => {
    expect(compareRooms(room('a', ROOM_B), room('b', ROOM_A), STRICT_FLOOR)).toBeNull();
  });

  it('lists the pairs at or above the threshold, closest first', () => {
    const pairs = findSimilarRooms(
      [room('b', ROOM_B)],
      [room('a', ROOM_A), room('moved', ROOM_B_MOVED_BLOCK), room('shifted', ROOM_B_SHIFTED)],
      MIN_PARTIAL_SIMILARITY
    );
    expect(pairs.map((p) => p.reference)).toEqual(['shifted', 'moved']);
  });

  it('reads each puzzle of a collection', () => {
    const levels = parseXsbCollection(`${ROOM_B.join('\n')}\n\n${ROOM_A.join('\n')}\n`);
    expect(levels.map((l) => room('x', l.lines).targets)).toEqual([1, 2]);
  });
});
