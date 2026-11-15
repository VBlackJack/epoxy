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
 * CC2 engine, wave 11 (FTM): the frame tag a clone carries (cc2Frame, the Lexy frame at which its first move ends) ends with the
 * monster's own step: runEntityPass deletes it once the monster's position changed on its own step (game.js:2218-2242, one
 * out-of-turn rule for every actor). Classic and native levels never read the tag and leave it alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const WALKER = 'glider';
const START_X = 4;
const FRAME_TAG = 2;
const CLEAR_TICKS = 12;

function walkerOf(engine: GameEngine): RuntimeEntity {
  const found = engine.getEntities().find((e) => e.type === WALKER);
  if (found === undefined) throw new Error('the room has a glider');
  return found;
}

/** A tagged glider walking east; the tag it still carries after each of the first ticks, with its column. */
function tagsAfter(mode: RoomMode): { x: number; tag: number | undefined }[] {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 1, entities: [{ type: WALKER, x: START_X, y: ROOM_ROW, dir: 'E' }] }));
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  walkerOf(engine).cc2Frame = FRAME_TAG;
  const out: { x: number; tag: number | undefined }[] = [];
  for (let t = 0; t < CLEAR_TICKS; t++) {
    engine.tick();
    out.push({ x: walkerOf(engine).x, tag: walkerOf(engine).cc2Frame });
  }
  return out;
}

describe('the frame tag of a monster', () => {
  it('is deleted by the first step the monster takes on its own (CC2 engine)', () => {
    const seen = tagsAfter('cc2');
    const moved = seen.findIndex((s) => s.x !== START_X);
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(seen[moved].tag).toBeUndefined();
    expect(seen.every((s) => s.tag === undefined)).toBe(true);
  });

  it.each(['cc', 'native'] as RoomMode[])('is left alone on a %s level', (mode) => {
    const seen = tagsAfter(mode);
    expect(seen.some((s) => s.x !== START_X)).toBe(true);
    expect(seen.every((s) => s.tag === FRAME_TAG)).toBe(true);
  });
});
