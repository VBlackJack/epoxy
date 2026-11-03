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
import { validateCc3dLevel } from '../core/cc3d/cc3dValidator';
import { cellAt, topTerrain } from '../core/cc3d/model';
import { emptyCc3dRoom } from './cc3dRoom';
import { cloneDocument, displayLayersOf } from './editorDocument';
import { metadataForDocument } from './editorLevelIo';

describe('empty CC3D room', () => {
  it('has a wall ring, floor inside, a player start and an exit, and the validator finds nothing wrong', () => {
    const room = emptyCc3dRoom(10, 8);
    expect(room.cells).toHaveLength(80);
    expect(validateCc3dLevel(room)).toEqual([]);
    for (let x = 0; x < 10; x++) {
      expect(topTerrain(cellAt(room, x, 0)!).kind).toBe('wall');
      expect(topTerrain(cellAt(room, x, 7)!).kind).toBe('wall');
    }
    for (let y = 0; y < 8; y++) {
      expect(topTerrain(cellAt(room, 0, y)!).kind).toBe('wall');
      expect(topTerrain(cellAt(room, 9, y)!).kind).toBe('wall');
    }
    expect(cellAt(room, 4, 4)?.terrain).toEqual([{ kind: 'floor' }]);
    const exits = room.cells.filter((cell) => cell.terrain.some((layer) => layer.kind === 'exit'));
    expect(exits).toHaveLength(1);
    expect(topTerrain(cellAt(room, room.player.x, room.player.y)!).kind).toBe('floor');
    expect(room.mobs).toEqual([]);
  });

  it('keeps the start, the exit and a floor apart whatever size is asked', () => {
    const room = emptyCc3dRoom(1, 1);
    expect(room.width).toBeGreaterThanOrEqual(4);
    expect(validateCc3dLevel(room)).toEqual([]);
  });

  it('refuses the cc3d engine in the form of a level that has no cc3d data', () => {
    const room = emptyCc3dRoom(6, 6);
    const doc = {
      ...displayLayersOf(room),
      cc3d: room,
      title: '',
      hint: '',
      author: '',
      password: '',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      winRule: 'exit' as const,
      ruleset: 'cc3d' as const
    };
    const meta = { ...doc, ruleset: undefined };
    expect(metadataForDocument(doc, meta).ruleset).toBe('cc3d');
    const plain = { ...cloneDocument({ ...doc, cc3d: undefined as never }), cc3d: undefined, ruleset: undefined };
    expect(metadataForDocument(plain, { ...meta, ruleset: 'cc3d' }).ruleset).toBeUndefined();
    expect(metadataForDocument(plain, { ...meta, ruleset: 'lynx' }).ruleset).toBe('lynx');
  });
});
