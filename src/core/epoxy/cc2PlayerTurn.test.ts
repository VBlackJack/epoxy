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
 * CC2 engine, actor order (wave 9): the player's input is stored between ticks and played by his turn in the entity pass. These tests
 * pin the engine side: what an input returns, the stored tick of the history, the undo step, the drop and cycle that share the stored
 * input, the trap step that is not a move, the mirror memory and the decision hook. Where a monster stands in the list is the monster
 * batch's to test; here the turn runs after the pass, which is where a player listed first acts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

// The monster batch calls the two hooks at the player's place in the list; here they are called around the pass so the engine side
// is tested whoever calls them. Both play once per tick, so a call made by the pass itself finds them done.
const probe: { afterDecision?: () => void } = vi.hoisted(() => ({}));
vi.mock('./epoxyMonsters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epoxyMonsters')>();
  return {
    ...actual,
    updateEntities: (ctx: import('./epoxyWorld').EpoxyContext): void => {
      ctx.cc2PlayerDecides?.();
      probe.afterDecision?.();
      actual.updateEntities(ctx);
    }
  };
});

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { idleTicks, playCycle, playDrop, playHeld, playMove } from '../../test/cc2Play';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { CC2_DYNAMITE_LIGHT_TICK_OFFSET, DYNAMITE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  probe.afterDecision = undefined;
});

const START_X = 2;
const WALL_AHEAD_X = 3;
const BOOT_WATER = 'boots_water';
const BOOT_FIRE = 'boots_fire';
const BLOCK_TYPE = 'dirt_block';
const MAX_TICKS = 200;
const FAR_CELL = 11;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, opts: { terrain?: Record<string, string>; entities?: EntityPlacement[]; startX?: number } = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, ...opts }));
  return engine;
}

describe('a move given before the tick', () => {
  it('is stored on a CC2 level and played by the turn of the tick', () => {
    const engine = load('cc2');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(START_X);
    expect(world(engine).cc2PendingDecision).toMatchObject({ dirs: ['E'], held: false, tick: 0 });
    engine.tick();
    expect(engine.getPlayer().x).toBe(START_X + 1);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
    expect(engine.getLastPlayerTurn()).toEqual({ dir: 'E', moved: true });
  });

  it('is stored even when the turn then refuses it, and the turn says so', () => {
    const engine = load('cc2', { terrain: { [`${WALL_AHEAD_X},${ROOM_ROW}`]: 'wall' } });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    engine.tick();
    expect(engine.getPlayer().x).toBe(START_X);
    expect(engine.getLastPlayerTurn()).toEqual({ dir: 'E', moved: false });
  });

  it('turns the player to the key it stored, moved or not', () => {
    const engine = load('cc2', { terrain: { [`${START_X},${ROOM_ROW + 1}`]: 'wall' } });
    expect(engine.attemptPlayerMove('S')).toBe(true);
    engine.tick();
    expect(engine.getLastPlayerTurn()).toEqual({ dir: 'S', moved: false });
    expect(engine.getPlayer().dir).toBe('S');
  });

  it('keeps the last input of the tick', () => {
    const engine = load('cc2');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    engine.tick();
    expect(engine.getPlayer()).toMatchObject({ x: START_X, y: ROOM_ROW + 1 });
  });

  it('has no turn to report before the first tick or after a tick without input', () => {
    const engine = load('cc2');
    expect(engine.getLastPlayerTurn()).toBeUndefined();
    engine.tick();
    expect(engine.getLastPlayerTurn()).toBeUndefined();
  });

  it('plays a held pair as one input', () => {
    const engine = load('cc2');
    expect(engine.attemptPlayerMoveHeld(['S', 'E'])).toBe(true);
    expect(world(engine).cc2PendingDecision).toMatchObject({ dirs: ['S', 'E'], held: true });
    engine.tick();
    expect(engine.getLastPlayerTurn()?.moved).toBe(true);
    expect(engine.getPlayer().x + engine.getPlayer().y).toBe(START_X + ROOM_ROW + 1);
  });
});

describe('an input the engine can refuse at once', () => {
  it('is refused while the step before it is waited out, and nothing is stored', () => {
    const engine = load('cc2');
    expect(playMove(engine, 'E').moved).toBe(true);
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });

  it('is refused for an opposing pair and for more than two keys', () => {
    const engine = load('cc2');
    expect(engine.attemptPlayerMoveHeld(['E', 'W'])).toBe(false);
    expect(engine.attemptPlayerMoveHeld(['E', 'S', 'W'])).toBe(false);
    expect(engine.attemptPlayerMoveHeld([])).toBe(false);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });

  it('is refused while paused', () => {
    const engine = load('cc2');
    engine.setPaused(true);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });

  it('is refused for a drop or a cycle that has nothing to do', () => {
    const engine = load('cc2');
    expect(engine.cycleInventory()).toBe(false);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
  });
});

describe('a level not on the CC2 engine', () => {
  it.each(['cc', 'native'] as const)('%s level steps at the input, as ever', (mode) => {
    const engine = load(mode);
    expect(engine.playsInActorOrder()).toBe(false);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(START_X + 1);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
    engine.tick();
    expect(engine.getLastPlayerTurn()).toBeUndefined();
  });

  it('is read the same way through the test helper', () => {
    const engine = load('native');
    expect(playMove(engine, 'E')).toEqual({ accepted: true, moved: true });
    const blocked = load('native', { terrain: { [`${WALL_AHEAD_X},${ROOM_ROW}`]: 'wall' } });
    expect(playMove(blocked, 'E').moved).toBe(false);
  });
});

describe('the move history of a stored input', () => {
  it('carries the tick the input was given in, not the one the pass ran in', () => {
    const engine = load('cc2');
    idleTicks(engine, 3);
    playMove(engine, 'E');
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: 3, dir: 'E' }]);
    expect(engine.getMoveHistory()).toEqual(['E']);
  });

  it('records a drop with the tick of its input too', () => {
    const engine = load('cc2');
    engine.getPlayer().boots.add(BOOT_WATER);
    idleTicks(engine, 2);
    playDrop(engine, BOOT_WATER);
    expect(engine.getTimedMoveHistory()).toEqual([{ tick: 2, dir: 'E', drop: BOOT_WATER }]);
  });

  it('lights a dynamite left behind on the same tick whether the engine steps at the input or at the turn', () => {
    const blastTick = (mode: RoomMode): number => {
      const engine = load(mode);
      engine.getPlayer().keys[DYNAMITE_ITEM_ID] = 1;
      playDrop(engine, DYNAMITE_ITEM_ID);
      playMove(engine, 'E');
      for (let t = 1; t <= MAX_TICKS; t++) {
        engine.tick();
        if (world(engine).litCharges.length === 0) return t;
      }
      throw new Error('the dynamite never blasted');
    };
    expect(blastTick('cc2') - blastTick('native')).toBe(CC2_DYNAMITE_LIGHT_TICK_OFFSET);
  });
});

describe('the undo step of a stored input', () => {
  it('is one step for the whole input, taken before it was stored', () => {
    const engine = load('cc2');
    expect(engine.canUndo()).toBe(false);
    engine.attemptPlayerMove('E');
    expect(engine.canUndo()).toBe(true);
    engine.tick();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(START_X);
    expect(engine.getTick()).toBe(0);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
    expect(engine.canUndo()).toBe(false);
  });

  it('takes a stored input back before the tick', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    expect(engine.undo()).toBe(true);
    expect(world(engine).cc2PendingDecision).toBeUndefined();
    engine.tick();
    expect(engine.getPlayer().x).toBe(START_X);
    expect(engine.getLastPlayerTurn()).toBeUndefined();
  });

  it('is kept once for two inputs of the same tick', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    engine.attemptPlayerMove('S');
    engine.tick();
    expect(engine.undo()).toBe(true);
    expect(engine.canUndo()).toBe(false);
  });

  it('is dropped when the turn refused the move and changed nothing', () => {
    const engine = load('cc2', { terrain: { [`${WALL_AHEAD_X},${ROOM_ROW}`]: 'wall' } });
    playMove(engine, 'E');
    expect(engine.canUndo()).toBe(false);
  });

  it('survives a snapshot taken while an input is stored', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    const snap = engine.captureState();
    expect(snap.cc2PendingDecision).toMatchObject({ dirs: ['E'] });
    engine.tick();
    engine.restoreState(snap);
    expect(world(engine).cc2PendingDecision).toMatchObject({ dirs: ['E'] });
    engine.tick();
    expect(engine.getPlayer().x).toBe(START_X + 1);
  });
});

describe('a drop and a cycle share the stored input', () => {
  it('plays the drop at the turn, before the move', () => {
    const engine = load('cc2');
    engine.getPlayer().boots.add(BOOT_WATER);
    expect(engine.dropItem(BOOT_WATER)).toBe(true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(world(engine).items[ROOM_ROW][START_X]).toBeNull();
    engine.tick();
    expect(world(engine).items[ROOM_ROW][START_X]).toBe(BOOT_WATER);
    expect(engine.getPlayer().x).toBe(START_X + 1);
    expect(engine.getPlayer().boots.has(BOOT_WATER)).toBe(false);
  });

  it('puts down the tool held longest as it stands at the turn, after a cycle of the same tick', () => {
    const engine = load('cc2');
    engine.getPlayer().boots.add(BOOT_WATER);
    engine.getPlayer().boots.add(BOOT_FIRE);
    expect(engine.getToolBelt()).toEqual([BOOT_WATER, BOOT_FIRE]);
    expect(engine.cycleInventory()).toBe(true);
    expect(engine.dropItem(null)).toBe(true);
    engine.tick();
    expect(world(engine).items[ROOM_ROW][START_X]).toBe(BOOT_FIRE);
    expect(engine.getToolBelt()).toEqual([BOOT_WATER]);
  });

  it('puts down the head of the belt for a drop without an item', () => {
    const engine = load('cc2');
    engine.getPlayer().boots.add(BOOT_WATER);
    expect(playDrop(engine, null)).toBe(true);
    expect(world(engine).items[ROOM_ROW][START_X]).toBe(BOOT_WATER);
  });

  it('drops nothing, with the message of an empty hand, when there is nothing to put down at the turn', () => {
    const engine = load('cc2');
    expect(playDrop(engine, null)).toBe(true);
    expect(world(engine).items[ROOM_ROW][START_X]).toBeNull();
    expect(world(engine).statusBannerKey).toBe('hud.messages.drop_nothing');
    expect(engine.canUndo()).toBe(false);
  });

  it('cycles the belt at the turn and keeps one undo step for the drop and the cycle', () => {
    const engine = load('cc2');
    engine.getPlayer().boots.add(BOOT_WATER);
    engine.getPlayer().boots.add(BOOT_FIRE);
    playCycle(engine);
    expect(engine.getToolBelt()).toEqual([BOOT_FIRE, BOOT_WATER]);
    expect(engine.undo()).toBe(true);
    expect(engine.getToolBelt()).toEqual([BOOT_WATER, BOOT_FIRE]);
    expect(engine.canUndo()).toBe(false);
  });

  it('does not store a drop for a level that is not on the CC2 engine', () => {
    const engine = load('cc');
    engine.getPlayer().boots.add(BOOT_WATER);
    expect(engine.dropItem(BOOT_WATER)).toBe(true);
    expect(world(engine).items[ROOM_ROW][START_X]).toBe(BOOT_WATER);
    expect(engine.dropItem(null)).toBe(false);
  });
});

describe('the decision of the player', () => {
  const ahead: EntityPlacement = { type: BLOCK_TYPE, x: START_X + 1, y: ROOM_ROW, dir: 'N' };

  it('pushes the block ahead before the pass, and the step then finds the way free', () => {
    const engine = load('cc2', { entities: [ahead] });
    const block = world(engine).entities[0];
    const seen: { blockX: number; playerX: number }[] = [];
    probe.afterDecision = () => seen.push({ blockX: block.x, playerX: engine.getPlayer().x });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(block.x).toBe(START_X + 1);
    engine.tick();
    expect(seen).toEqual([{ blockX: START_X + 2, playerX: START_X }]);
    expect(engine.getPlayer().x).toBe(START_X + 1);
    expect(block.x).toBe(START_X + 2);
  });

  it('keeps the undo step of an input whose block it pushed, and puts the block back', () => {
    const engine = load('cc2', { entities: [ahead] });
    playMove(engine, 'E');
    expect(engine.undo()).toBe(true);
    expect(world(engine).entities[0].x).toBe(START_X + 1);
    expect(engine.canUndo()).toBe(false);
  });

  it('pushes nothing when a wall holds the block, and drops the refused input', () => {
    const engine = load('cc2', { entities: [ahead], terrain: { [`${START_X + 2},${ROOM_ROW}`]: 'wall' } });
    expect(playMove(engine, 'E').moved).toBe(false);
    expect(world(engine).entities[0].x).toBe(START_X + 1);
    expect(engine.canUndo()).toBe(false);
  });

  it('plays no decision when nothing was stored', () => {
    const engine = load('cc2', { entities: [ahead] });
    engine.tick();
    expect(world(engine).entities[0].x).toBe(START_X + 1);
    expect(world(engine).cc2MovingAtDecision).toBeUndefined();
  });

  it('leaves no per-pass set behind at the end of the tick', () => {
    const engine = load('cc2');
    playMove(engine, 'E');
    const w = world(engine);
    expect([w.cc2TurnSeen, w.cc2MovingAtDecision, w.cc2PushedLate, w.cc2SkipTurn, w.cc2PendingDecision]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe('a trap that opens at the start of a pass', () => {
  const TRAP = { [`${START_X},${ROOM_ROW}`]: 'trap' };

  it('lets the player out the way he faces, with no move of his own on the record', () => {
    const engine = load('cc2', { terrain: TRAP });
    engine.tick();
    expect(world(engine).player.trapShutAtTurn).toBe(true);
    world(engine).terrain[ROOM_ROW][START_X] = 'trap_open';
    const steps = engine.getStepsCount();
    engine.tick();
    expect(engine.getPlayer().x).toBe(START_X + 1);
    expect(engine.getTimedMoveHistory()).toEqual([]);
    expect(engine.getMoveHistory()).toEqual([]);
    expect(engine.getStepsCount()).toBe(steps);
    expect(engine.canUndo()).toBe(false);
  });

  it('keeps him in while it is shut', () => {
    const engine = load('cc2', { terrain: TRAP });
    idleTicks(engine, 3);
    expect(engine.getPlayer().x).toBe(START_X);
    expect(world(engine).player.trapShutAtTurn).toBe(true);
  });

  it('sets no trap flag on a level that is not on the CC2 engine', () => {
    const engine = load('cc', { terrain: TRAP });
    idleTicks(engine, 3);
    expect(world(engine).player.trapShutAtTurn).toBeUndefined();
  });
});

describe('the mirror memory', () => {
  const MIRROR: EntityPlacement = { type: 'mirror_chip', x: 6, y: 3, dir: 'N' };

  it('counts a stored input as the decision of the tick, and forgets the move of the tick before without one', () => {
    const decided = load('cc2', { entities: [MIRROR] });
    world(decided).mirrorMove = { remembered: 'N', snapshot: 'N', attempted: false };
    decided.attemptPlayerMove('E');
    (decided as unknown as { beginMirrorTick(): void }).beginMirrorTick();
    expect(world(decided).mirrorMove).toMatchObject({ remembered: 'N', attempted: false });

    const idle = load('cc2', { entities: [MIRROR] });
    world(idle).mirrorMove = { remembered: 'N', snapshot: 'N', attempted: false };
    (idle as unknown as { beginMirrorTick(): void }).beginMirrorTick();
    expect(world(idle).mirrorMove).toMatchObject({ remembered: null });
  });
});

describe('the snapshot of a CC2 level', () => {
  it('holds no creature slots, which only a classic level has', () => {
    const cc2 = load('cc2', { entities: [{ type: BLOCK_TYPE, x: FAR_CELL, y: ROOM_ROW, dir: 'N' }] });
    expect(cc2.captureState().ccSlots).toBeUndefined();
    const classic = load('cc', { entities: [{ type: BLOCK_TYPE, x: FAR_CELL, y: ROOM_ROW, dir: 'N' }] });
    expect(classic.captureState().ccSlots).toBeDefined();
  });
});

describe('the held pair through the test helper', () => {
  it('reads the outcome after the tick', () => {
    const engine = load('cc2');
    expect(playHeld(engine, ['E', 'S'])).toMatchObject({ accepted: true, moved: true });
  });
});
