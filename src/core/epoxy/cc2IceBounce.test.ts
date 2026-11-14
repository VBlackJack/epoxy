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
 * A monster on ice of a CC2-engine level plans the slide way without a collision check; when the step is refused it turns
 * round, the ice corner deflects it, and it tries again at once. A classic level keeps its decision-time check.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const MONSTER = 'bug';
const CORNER = 'ice_nw';
const CELL_X = 6;
const FIRST_TICKS = 1;

/** A bug on the north-west ice corner facing north, a wall east of it: where it stands after its first step. */
function afterFirstStep(mode: RoomMode, terrain: Record<string, string> = {}): { x: number; y: number } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${CELL_X},${ROOM_ROW}`]: CORNER, [`${CELL_X + 1},${ROOM_ROW}`]: 'wall', ...terrain },
      entities: [{ type: MONSTER, x: CELL_X, y: ROOM_ROW, dir: 'N' }]
    })
  );
  // A monster loaded on ice decides normally on its load cell; this test is about the ice step of one that has moved on.
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  for (let i = 0; i < FIRST_TICKS; i++) engine.tick();
  const monster = engine.getEntities().find((e) => e.type === MONSTER);
  if (monster === undefined) throw new Error('the room has a bug');
  return { x: monster.x, y: monster.y };
}

describe('monster on ice, CC2 engine', () => {
  it('turns round and takes the corner deflection when the planned slide way is refused', () => {
    // Planned: north deflected east (wall). Turned round: west, deflected south by the corner.
    expect(afterFirstStep('cc2')).toEqual({ x: CELL_X, y: ROOM_ROW + 1 });
  });

  it('stays put when the bounce way is blocked as well', () => {
    expect(afterFirstStep('cc2', { [`${CELL_X},${ROOM_ROW + 1}`]: 'wall' })).toEqual({ x: CELL_X, y: ROOM_ROW });
  });

  it('keeps the decision-time check on a classic level, where the corner walls leave no way out', () => {
    expect(afterFirstStep('cc')).toEqual({ x: CELL_X, y: ROOM_ROW });
  });
});
