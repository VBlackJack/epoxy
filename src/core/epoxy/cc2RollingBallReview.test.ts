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
 * CC2 rolling ball: the review fixes of wave 6 (stale removals after an undo, a ball spent at launch on a button, the player
 * who walks into a ball).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findDroppedActorConfigErrors, findGateConfigErrors, findSteeringConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, ROOM_SIZE } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { STONE_DEATH_REASON_KEY, STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { resolveMonsterArrival } from './epoxyMonsters';
import { checkBallWay, droppedActorId, isRollingBall, launchRollingBall } from './epoxyRollingBall';
import { isHeldSignalButton } from './epoxySignals';
import { cc2HiddenStateKey, type EpoxyContext, type EpoxyWorld } from './epoxyWorld';

const LAST_FLOOR_X = ROOM_SIZE - 2;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function bowler(opts: Partial<RoomOptions> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', ...opts }));
  engine.getPlayer().keys[STONE_ITEM_ID] = 1;
  return engine;
}

const ballOf = (engine: GameEngine) => engine.getEntities().find(isRollingBall);

describe('a ball set down after an undo', () => {
  it('leaves the cell at once, although a ball spent against a wall took the same uid before the undo', () => {
    const engine = bowler({ startX: LAST_FLOOR_X });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().keys[STONE_ITEM_ID]).toBe(1);
    world(engine).player.dir = 'W';
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toMatchObject({ x: LAST_FLOOR_X - 1, y: ROOM_ROW });
  });
});

describe('a player who walks into a ball', () => {
  it('dies of the stone and the ball blows up with him, without a helmet', () => {
    const engine = bowler();
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    engine.tick();
    while (engine.getPlayer().moveCooldown > 0) engine.tick();
    expect(ballOf(engine)).toBeDefined();
    engine.attemptPlayerMove('E');
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe(STONE_DEATH_REASON_KEY);
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is killed through a helmet by a ball whose step was planned before he stood in its way', () => {
    const engine = bowler({ startX: 8 });
    engine.getPlayer().boots.add('helmet');
    const w = world(engine);
    const ctx = (engine as unknown as { ctx: EpoxyContext }).ctx;
    expect(launchRollingBall(ctx, 4, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    const ball = ballOf(engine) as RuntimeEntity;
    // The step toward the player was planned while the cell was free; the arrival then reaches the helmet bypass of the arrival rule.
    w.ccPlans.set(ball.uid, 'E');
    ball.x = w.player.x;
    expect(resolveMonsterArrival(ctx, ball, false)).toBe(false);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe(STONE_DEATH_REASON_KEY);
  });
});

const ORANGE_BUTTON = 'button_orange_cc2';
const BROWN_BUTTON = 'button_brown';
const START_X = 2;
const FACED_X = START_X + 1;

describe('a ball spent at launch and the button under the player', () => {
  for (const button of [ORANGE_BUTTON, BROWN_BUTTON]) {
    it(`does not toggle the ${button} the player stands on`, () => {
      const engine = bowler({ terrain: { [`${START_X},${ROOM_ROW}`]: button, [`${FACED_X},${ROOM_ROW}`]: 'wall' } });
      expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
      expect(ballOf(engine)).toBeUndefined();
      expect(engine.getCc2WaveState()?.toggledButtons).toBeUndefined();
    });

    it(`still toggles the ${button} of the actor it kills at launch`, () => {
      const engine = bowler({
        terrain: { [`${FACED_X},${ROOM_ROW}`]: button },
        entities: [{ type: 'lurker_dormant', x: FACED_X, y: ROOM_ROW, dir: 'N' }]
      });
      expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
      expect(engine.getEntities()).toEqual([]);
      expect(engine.getCc2WaveState()?.toggledButtons).toEqual([ROOM_ROW * ROOM_SIZE + FACED_X]);
    });
  }
});

describe('config fields of the dropped actor and the step-start jump', () => {
  const tiles = () => ConfigRegistry.getTiles().tiles;
  const entities = () => ConfigRegistry.getMonsters().entities;

  it('names the rolling ball as the actor the stone becomes, and validates as shipped', () => {
    expect(droppedActorId(STONE_ITEM_ID)).toBe('rolling_ball');
    expect(droppedActorId('chip')).toBeUndefined();
    expect(findSteeringConfigErrors(tiles(), entities())).toEqual([]);
    expect(findDroppedActorConfigErrors(tiles(), entities())).toEqual([]);
    expect(findGateConfigErrors(tiles())).toEqual([]);
  });

  it('refuses an actor that is not a monster, and the field on another item', () => {
    const stone = tiles()[STONE_ITEM_ID];
    const bad = (patch: Record<string, unknown>) => findDroppedActorConfigErrors({ ...tiles(), [STONE_ITEM_ID]: { ...stone, ...patch } }, entities());
    expect(bad({ dropsAsActorCc2: 'no_such_entity' })).toHaveLength(1);
    expect(bad({ dropsAsActorCc2: 'dirt_block' })).toHaveLength(1);
    expect(bad({ collectible: 'chip' })).not.toEqual([]);
  });

  it('flags the CC2 green pad (teleport_random) as jumping at the start of a step, and only a teleporter', () => {
    expect(tiles().teleport_random.teleportJumpsAtStepStartCc2).toBe(true);
    expect(tiles().teleport_green.teleportJumpsAtStepStartCc2).toBeUndefined();
    expect(tiles().teleport_blue.teleportJumpsAtStepStartCc2).toBeUndefined();
    const bad = (patch: Record<string, unknown>) => findGateConfigErrors({ ...tiles(), teleport_random: { ...tiles().teleport_random, ...patch } });
    expect(bad({ teleportJumpsAtStepStartCc2: 'yes' })).toHaveLength(1);
    expect(bad({ isTeleporter: undefined })).toHaveLength(1);
  });

  it('shares one predicate for a button an actor holds down', () => {
    expect(isHeldSignalButton(tiles().button_orange_cc2)).toBe(true);
    expect(isHeldSignalButton(tiles().button_brown)).toBe(true);
    expect(isHeldSignalButton(tiles().floor)).toBe(false);
    expect(isHeldSignalButton(tiles().button_green)).toBe(false);
  });
});

describe('the search key of a teleport waiting for its monster', () => {
  it('holds the pending teleports only while there are some', () => {
    const w = world(bowler());
    const empty = cc2HiddenStateKey(w);
    w.ccArrivals.push({ uid: 7, x: 3, y: ROOM_ROW, teleport: true, due: 4 });
    const waiting = cc2HiddenStateKey(w);
    expect(waiting).not.toBe(empty);
    // A button press waiting is not a teleport: it is not part of this key.
    w.ccArrivals.splice(0, 1, { uid: 7, x: 3, y: ROOM_ROW, action: 'hold_trap', due: 4 });
    expect(cc2HiddenStateKey(w)).toBe(empty);
    w.ccArrivals.splice(0, 1, { uid: 7, x: 3, y: ROOM_ROW, teleport: true, due: 5 });
    expect(cc2HiddenStateKey(w)).not.toBe(waiting);
  });
});

describe('a ball that does not blow up on terrain', () => {
  it('is erased with no sound and no blast when set down on ice against a wall', () => {
    const engine = bowler({ startX: LAST_FLOOR_X, terrain: { [`${LAST_FLOOR_X},${ROOM_ROW}`]: 'ice' } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
    expect(world(engine).blockSplashes.size).toBe(0);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().keys[STONE_ITEM_ID] ?? 0).toBe(0);
  });

  it('leaves no blast when it is spent against a wall as it is set down on plain floor', () => {
    const engine = bowler({ startX: LAST_FLOOR_X });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
    expect(world(engine).blockSplashes.size).toBe(0);
  });

  /** A ball on the last floor cell of the row, facing the wall, with the given terrain under it. */
  function ballAtWall(terrain?: string): { engine: GameEngine; ball: RuntimeEntity } {
    const engine = bowler({ terrain: terrain === undefined ? {} : { [`${LAST_FLOOR_X},${ROOM_ROW}`]: terrain } });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    const ball = ballOf(engine) as RuntimeEntity;
    ball.x = LAST_FLOOR_X;
    ball.y = ROOM_ROW;
    ball.dir = 'E';
    return { engine, ball };
  }

  const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

  it('blows up against terrain on plain floor', () => {
    const { engine, ball } = ballAtWall();
    expect(checkBallWay(ctxOf(engine), ball, 'E')).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is spared against terrain when a teleporter sent it to its pad', () => {
    const { engine, ball } = ballAtWall();
    ball.teleportExit = 'E';
    expect(checkBallWay(ctxOf(engine), ball, 'E')).toBe(true);
    expect(ballOf(engine)).toBe(ball);
  });

  it('is spared against terrain while it is released from a clone machine', () => {
    const { engine, ball } = ballAtWall('clone_machine');
    expect(checkBallWay(ctxOf(engine), ball, 'E')).toBe(true);
    expect(ballOf(engine)).toBe(ball);
  });
});
