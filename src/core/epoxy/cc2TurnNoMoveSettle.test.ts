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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

// The pass is wrapped so the world can be read right after the player's turn, before any other actor of the pass acts. Both hooks
// play once per tick, so the calls the pass makes itself find them done.
const probe: { afterTurn?: () => void } = vi.hoisted(() => ({}));
vi.mock('./epoxyMonsters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epoxyMonsters')>();
  return {
    ...actual,
    updateEntities: (ctx: import('./epoxyWorld').EpoxyContext): void => {
      ctx.cc2PlayerDecides?.();
      ctx.cc2PlayerActs?.();
      probe.afterTurn?.();
      actual.updateEntities(ctx);
    }
  };
});

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
  probe.afterTurn = undefined;
});

const BLACK_BUTTON = 'black_button';
const PURPLE_WALL = 'purple_wall';
const PURPLE_FLOOR = 'purple_floor';
const BUTTON = { x: 3, y: ROOM_ROW };
const SINK = { x: 8, y: 3 };

function load(mode: RoomMode): GameEngine {
  const level = room({ mode, terrain: { [`${BUTTON.x},${BUTTON.y}`]: BLACK_BUTTON, [`${SINK.x},${SINK.y}`]: PURPLE_WALL } });
  const engine = new GameEngine();
  engine.loadLevel({ ...level, signalLinks: [{ fromX: BUTTON.x, fromY: BUTTON.y, toX: SINK.x, toY: SINK.y }] });
  return engine;
}

const sinkTile = (engine: GameEngine): string => engine.getTerrain()[SINK.y][SINK.x];

describe('CC2 engine, actor order: the move of the player\'s turn settles no wire', () => {
  it('leaves the wire it pressed as it was for the rest of the pass, and the settle of the tick reads it', () => {
    const engine = load('cc2');
    expect(engine.playsInActorOrder()).toBe(true);
    // A CC2 wired sink starts off: the black button, powered while nothing presses it, flips the wall at the first settle.
    engine.tick();
    engine.tick();
    expect(sinkTile(engine)).toBe(PURPLE_FLOOR);
    let afterTurn: string | undefined;
    let movedAtTurn = false;
    probe.afterTurn = (): void => {
      afterTurn = sinkTile(engine);
      movedAtTurn = engine.getPlayer().x === BUTTON.x;
    };
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(movedAtTurn).toBe(true);
    // Lexy runs no wire phase between the actions of a frame: the black button the step pressed cuts the wire at the wire phase.
    expect(afterTurn).toBe(PURPLE_FLOOR);
    expect(sinkTile(engine)).toBe(PURPLE_WALL);
  });
});

describe('a level that does not play in actor order', () => {
  it('settles the wires with the move itself, as before', () => {
    const engine = load('native');
    expect(engine.playsInActorOrder()).toBe(false);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(sinkTile(engine)).toBe(PURPLE_FLOOR);
  });
});
