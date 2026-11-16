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
 * CC2 engine, wave 13, blocks:
 * - BBP: a block a bomb kills on arrival still presses the button under it (Lexy step_on_cell walks every layer, game.js:2316-2365;
 *   bomb.on_stand, tiletypes.js:1161-1180). Partial: buttons only.
 * - CLB: a block other than the dirt block enters an empty clone machine (cloner blocks_collision holds block_cc1 only,
 *   tiletypes.js:1693; defs.js:104-107) and a clone machine holds the block on it (cloner traps, tiletypes.js:1700-1702).
 * Outside the CC2 engine nothing changes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext } from './epoxyWorld';

const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
const PLAYER_X = 2;
const BLOCK_X = 3;
const TARGET_X = 4;
const BEYOND_X = 5;
const DIRT_BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
const BOMB = 'bomb';
const GREEN_BUTTON = 'button_green';
const RED_BUTTON = 'button_red';
const CLONER = 'clone_machine';
const WALL_CLOSED = 'toggle_wall_closed';
const WALL_OPEN = 'toggle_wall_open';
const WALL_CELL = { x: 8, y: 8 };
const BUTTON_CELL = { x: 9, y: 9 };

beforeEach(() => {
  loadTestConfigs();
});

function waitForMove(engine: GameEngine): void {
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
}

function pushBlockOntoBombButton(mode: RoomMode, blockType: string): { block: boolean; wall: string } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${TARGET_X},${ROOM_ROW}`]: GREEN_BUTTON, [`${WALL_CELL.x},${WALL_CELL.y}`]: WALL_CLOSED },
      items: { [`${TARGET_X},${ROOM_ROW}`]: BOMB },
      entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  waitForMove(engine);
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return {
    block: engine.getEntities().some((e) => e.type === blockType),
    wall: engine.getTerrain()[WALL_CELL.y][WALL_CELL.x]
  };
}

describe('CC2 engine, BBP: a block a bomb kills on arrival', () => {
  // Fails without the rule: the wall stays closed (the bomb branch returned before the button).
  it.each([DIRT_BLOCK, ICE_BLOCK])('still presses the green button under it (%s)', (blockType) => {
    const result = pushBlockOntoBombButton('cc2', blockType);
    expect(result.block).toBe(false);
    expect(result.wall).toBe(WALL_OPEN);
  });

  it.each(['cc', 'native'] as RoomMode[])('leaves the button alone outside the CC2 engine (%s)', (mode) => {
    const result = pushBlockOntoBombButton(mode, DIRT_BLOCK);
    expect(result.block).toBe(false);
    expect(result.wall).toBe(WALL_CLOSED);
  });
});

/** A block on row ROOM_ROW pushed east by the player, the cell at TARGET_X holding the clone machine. */
function pushIntoCloner(mode: RoomMode, blockType: string, template?: { type: string }): GameEngine {
  const entities = [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' as const }];
  if (template !== undefined) entities.push({ type: template.type, x: TARGET_X, y: ROOM_ROW, dir: 'E' as const });
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: PLAYER_X,
      terrain: { [`${TARGET_X},${ROOM_ROW}`]: CLONER, [`${BUTTON_CELL.x},${BUTTON_CELL.y}`]: RED_BUTTON },
      entities
    })
  );
  waitForMove(engine);
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine;
}

const blocksAt = (engine: GameEngine, x: number) => engine.getEntities().filter((e) => e.kind === 'block' && e.x === x && e.y === ROOM_ROW);

describe('CC2 engine, CLB: a block entering a clone machine', () => {
  it('lets an ice block into an empty clone machine, where it becomes the template', () => {
    const engine = pushIntoCloner('cc2', ICE_BLOCK);
    expect(blocksAt(engine, TARGET_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
    // The press of the button clones the occupant onto the cell beyond (Lexy cloner, tiletypes.js:1704-1706).
    (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_CELL.x, BUTTON_CELL.y, 'trigger_cloner');
    expect(blocksAt(engine, BEYOND_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
    expect(blocksAt(engine, TARGET_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
  });

  it('refuses the dirt block, which stays where it was', () => {
    const engine = pushIntoCloner('cc2', DIRT_BLOCK);
    expect(blocksAt(engine, TARGET_X)).toHaveLength(0);
    expect(blocksAt(engine, BLOCK_X)).toHaveLength(1);
  });

  it('refuses an ice block when the clone machine already holds its template, which stays (fire_ice shape)', () => {
    const engine = pushIntoCloner('cc2', ICE_BLOCK, { type: DIRT_BLOCK });
    expect(blocksAt(engine, TARGET_X).map((e) => e.type)).toEqual([DIRT_BLOCK]);
    expect(blocksAt(engine, BLOCK_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
  });

  // Fails without the trap line: the chain push shoves the template out of the machine onto the cell beyond (fire_ice shape).
  it('holds the template on the clone machine against an ice block that chains into it', () => {
    const engine = pushIntoCloner('cc2', ICE_BLOCK, { type: ICE_BLOCK });
    expect(blocksAt(engine, TARGET_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
    expect(blocksAt(engine, BEYOND_X)).toHaveLength(0);
    expect(blocksAt(engine, BLOCK_X).map((e) => e.type)).toEqual([ICE_BLOCK]);
  });

  it.each(['cc', 'native'] as RoomMode[])('keeps every block out of a clone machine outside the CC2 engine (%s)', (mode) => {
    const engine = pushIntoCloner(mode, ICE_BLOCK);
    expect(blocksAt(engine, TARGET_X)).toHaveLength(0);
  });
});
