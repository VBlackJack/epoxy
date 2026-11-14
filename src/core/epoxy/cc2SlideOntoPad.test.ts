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
 * A player who slides onto a teleporter pad of a CC2-engine level takes a walking step to reach it: the step time comes from
 * the cell entered (Lexy's Labyrinth game.js:2177-2194) and a pad is plain floor. The classic rules keep the shorter slide
 * wait before the forced exit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { CC_TELEPORT_SLIDE_WAIT_TICKS } from '../coreConstants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 3;
const NEAR_PAD = 6;
const FAR_PAD = 10;
/** Ticks that outlast the slide onto the pad and the jump. */
const MAX_SLIDE_TICKS = 40;

/** The cooldown the player holds the tick he lands on the far pad after sliding onto the near one. */
function cooldownOnLanding(mode: RoomMode): { cooldown: number; walk: number } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: START_X,
      terrain: { [`4,${ROOM_ROW}`]: 'ice', [`5,${ROOM_ROW}`]: 'ice', [`${NEAR_PAD},${ROOM_ROW}`]: 'teleport', [`${FAR_PAD},${ROOM_ROW}`]: 'teleport' }
    })
  );
  const walk = playerWalkCooldown((engine as unknown as { w: EpoxyWorld }).w);
  engine.attemptPlayerMove('E');
  for (let t = 0; t < MAX_SLIDE_TICKS; t++) {
    engine.tick();
    const p = engine.getPlayer();
    if (p.x === FAR_PAD && p.teleportExit !== undefined) return { cooldown: p.moveCooldown, walk };
  }
  throw new Error('the player never landed on the far pad');
}

describe('a slide onto a teleporter pad', () => {
  it('lasts a walking step on a CC2-engine level', () => {
    const { cooldown, walk } = cooldownOnLanding('cc2');
    expect(cooldown).toBe(walk);
  });

  it('keeps the shorter slide wait on a classic-rules level', () => {
    const { cooldown, walk } = cooldownOnLanding('cc');
    expect(walk).toBeGreaterThan(CC_TELEPORT_SLIDE_WAIT_TICKS);
    expect(cooldown).toBeLessThanOrEqual(CC_TELEPORT_SLIDE_WAIT_TICKS);
  });

  it('leaves the pad one walking step after the landing', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: START_X,
        terrain: { [`4,${ROOM_ROW}`]: 'ice', [`5,${ROOM_ROW}`]: 'ice', [`${NEAR_PAD},${ROOM_ROW}`]: 'teleport', [`${FAR_PAD},${ROOM_ROW}`]: 'teleport' }
      })
    );
    const walk = playerWalkCooldown((engine as unknown as { w: EpoxyWorld }).w);
    engine.attemptPlayerMove('E');
    let landed = -1;
    for (let t = 1; t <= MAX_SLIDE_TICKS && landed < 0; t++) {
      engine.tick();
      if (engine.getPlayer().x === FAR_PAD && engine.getPlayer().teleportExit !== undefined) landed = t;
    }
    expect(landed).toBeGreaterThan(0);
    let waited = 0;
    while (engine.getPlayer().x === FAR_PAD && waited < MAX_SLIDE_TICKS) {
      engine.tick();
      waited++;
    }
    expect(waited).toBe(walk);
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
  });
});
