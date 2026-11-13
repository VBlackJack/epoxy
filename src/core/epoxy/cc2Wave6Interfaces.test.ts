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
 * The interfaces the CC2 wave 6 rules stand on: the rolling ball entity and the yellow pad item (config), the keys an actor
 * holds, the set of buttons toggled by a ball, the yellow pad latch and the cadence flags. None of them changes a play by
 * itself; absent, every key and hash is what it was.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findGateConfigErrors, findSteeringConfigErrors } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room } from '../../test/cc2Room';
import { CC_MONSTER_STEP_TICKS, ccStepTicks, followsCcCadence } from '../coreConstants';
import { GameEngine, copyEntity } from '../GameEngine';
import type { EntityDefinition, RuntimeEntity, TileDefinition } from '../types';
import { launchRollingBall } from './epoxyRollingBall';
import { toggleHeldButton } from './epoxySignals';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const ROLLING_BALL_ID = 'rolling_ball';
const YELLOW_ITEM_ID = 'teleport_yellow_item';
const YELLOW_PAD_ID = 'teleport_forward';
const BLOB_STEP_TICKS = 8;
const FIRST_PAD = '3,3';
const SECOND_PAD = '9,9';
const BUTTON_POINT = { x: 4, y: 7 };
const OTHER_BUTTON_POINT = { x: 6, y: 7 };
const ROOM_WIDTH = 13;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(opts: Parameters<typeof room>[0] = { mode: 'cc2' }): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(opts));
  return engine;
}

const tiles = (): Record<string, TileDefinition> => ConfigRegistry.getTiles().tiles;
const entities = (): Record<string, EntityDefinition> => ConfigRegistry.getMonsters().entities;

describe('runtime-only config', () => {
  it('flags the rolling ball and the picked-up yellow pad, and validates the config as shipped', () => {
    expect(entities()[ROLLING_BALL_ID].runtimeOnly).toBe(true);
    expect(entities()[ROLLING_BALL_ID].killsShieldedPlayer).toBe(true);
    expect(tiles()[YELLOW_ITEM_ID].runtimeOnly).toBe(true);
    expect(tiles()[YELLOW_ITEM_ID].cc2YellowPadItem).toBe(true);
    expect(tiles()[YELLOW_ITEM_ID].dropsAsTerrain).toBe(YELLOW_PAD_ID);
    expect(tiles()[YELLOW_PAD_ID].portableTeleporter).toBeUndefined();
    expect(findGateConfigErrors(tiles())).toEqual([]);
    expect(findSteeringConfigErrors(tiles(), entities())).toEqual([]);
  });

  it('refuses a flag of the wrong type or on the wrong kind of entity or tile', () => {
    const ball = entities()[ROLLING_BALL_ID];
    const bad = (patch: Partial<EntityDefinition>): string[] => findSteeringConfigErrors(tiles(), { ...entities(), [ROLLING_BALL_ID]: { ...ball, ...patch } });
    expect(bad({ runtimeOnly: false as unknown as true })).toHaveLength(1);
    expect(bad({ killsShieldedPlayer: 'yes' as unknown as true })).toHaveLength(1);
    expect(bad({ ccStepTicks: 0 })).toHaveLength(1);
    expect(bad({ ccStepTicks: 2.5 })).toHaveLength(1);
    // The shipped ball keeps the default step ticks: the step ticks field is set here to see it refused off the classic cadence.
    expect(bad({ ccCadence: undefined, cc2Cadence: undefined, ccStepTicks: 4 })).toHaveLength(1);
    expect(bad({ epoxyOnly: undefined })).toHaveLength(1);
    expect(bad({ kind: 'block' })).not.toEqual([]);

    const yellow = tiles()[YELLOW_ITEM_ID];
    const badTile = (patch: Partial<TileDefinition>): string[] => findGateConfigErrors({ ...tiles(), [YELLOW_ITEM_ID]: { ...yellow, ...patch } });
    expect(badTile({ cc2YellowPadItem: 'yes' as unknown as true })).not.toEqual([]);
    expect(badTile({ runtimeOnly: undefined })).not.toEqual([]);
    expect(badTile({ collectible: 'chip' })).not.toEqual([]);
  });

  it('relaxes the gate rule only for the yellow pad item, and only toward a teleporter', () => {
    const yellow = tiles()[YELLOW_ITEM_ID];
    expect(findGateConfigErrors({ ...tiles(), [YELLOW_ITEM_ID]: { ...yellow, dropsAsTerrain: 'floor' } })).not.toEqual([]);
    const plainGate = { ...yellow, id: 'plain_gate', cc2YellowPadItem: undefined, runtimeOnly: undefined };
    expect(findGateConfigErrors({ ...tiles(), plain_gate: plainGate })).not.toEqual([]);
  });

  it('keeps the rolling ball and the yellow pad item out of the editor palette tiles and entities', () => {
    const placeableTiles = Object.values(tiles()).filter((tile) => tile.runtimeOnly !== true);
    const placeableEntities = Object.values(entities()).filter((entity) => entity.runtimeOnly !== true);
    expect(placeableTiles.map((tile) => tile.id)).not.toContain(YELLOW_ITEM_ID);
    expect(placeableEntities.map((entity) => entity.id)).not.toContain(ROLLING_BALL_ID);
    expect(placeableEntities.length).toBe(Object.keys(entities()).length - 1);
  });
});

describe('cadence from config', () => {
  it('reads the classic cadence and the step ticks from the monster definitions', () => {
    expect(followsCcCadence('bug', false)).toBe(true);
    expect(followsCcCadence('blob', false)).toBe(true);
    expect(ccStepTicks('blob')).toBe(BLOB_STEP_TICKS);
    expect(ccStepTicks('bug')).toBe(CC_MONSTER_STEP_TICKS);
    expect(followsCcCadence('ghost', false)).toBe(false);
    expect(followsCcCadence('ghost', true)).toBe(true);
    expect(followsCcCadence('timid_teeth', true)).toBe(true);
    expect(followsCcCadence('rover', true)).toBe(true);
    expect(ccStepTicks('rover')).toBe(8);
  });

  it('gives the rolling ball the classic step on a CC2-engine level only', () => {
    expect(followsCcCadence(ROLLING_BALL_ID, true)).toBe(true);
    expect(followsCcCadence(ROLLING_BALL_ID, false)).toBe(false);
    expect(ccStepTicks(ROLLING_BALL_ID)).toBe(CC_MONSTER_STEP_TICKS);
  });
});

describe('heldKeys', () => {
  const entity = (): RuntimeEntity => world(load()).entities[0] ?? ({ uid: 1, type: 'bug', kind: 'monster', x: 1, y: 1, dir: 'N', cooldownTicks: 0, isSliding: false } as RuntimeEntity);

  it('is copied by copyEntity without sharing the array', () => {
    const original = { ...entity(), heldKeys: ['key_blue'] };
    const copy = copyEntity(original);
    expect(copy.heldKeys).toEqual(['key_blue']);
    copy.heldKeys?.push('key_green');
    expect(original.heldKeys).toEqual(['key_blue']);
  });

  it('enters the search key only when set and non-empty, with the held tools', () => {
    const engine = load({ mode: 'cc2', entities: [{ type: 'bug', x: 8, y: 5, dir: 'W' }] });
    const w = world(engine);
    const bare = cc2HiddenStateKey(w);
    w.entities[0].heldKeys = [];
    expect(cc2HiddenStateKey(w)).toBe(bare);
    w.entities[0].heldKeys = ['key_blue'];
    const withKey = cc2HiddenStateKey(w);
    expect(withKey).not.toBe(bare);
    w.entities[0].heldKeys = undefined;
    w.entities[0].heldTools = [];
    expect(cc2HiddenStateKey(w)).toBe(bare);
    w.entities[0].heldTools = ['flippers'];
    const withTool = cc2HiddenStateKey(w);
    expect(withTool).not.toBe(bare);
    expect(withTool).not.toBe(withKey);
  });

  it('survives an undo round trip', () => {
    const engine = load({ mode: 'cc2', entities: [{ type: 'bug', x: 8, y: 5, dir: 'W' }] });
    world(engine).entities[0].heldKeys = ['key_blue'];
    expect(engine.attemptPlayerMove('E')).toBe(true);
    world(engine).entities[0].heldKeys = undefined;
    expect(engine.undo()).toBe(true);
    expect(world(engine).entities[0].heldKeys).toEqual(['key_blue']);
  });
});

describe('buttons toggled by a rolling ball', () => {
  const cellOf = (point: { x: number; y: number }): number => point.y * ROOM_WIDTH + point.x;

  it('starts empty and reads as no CC2 wave state', () => {
    const engine = load();
    expect(world(engine).cc2ToggledButtonCells).toEqual([]);
    expect(engine.getCc2WaveState()?.toggledButtons).toBeUndefined();
  });

  it('toggles in ascending order as an exclusive or', () => {
    const w = world(load());
    expect(toggleHeldButton(w, OTHER_BUTTON_POINT.x, OTHER_BUTTON_POINT.y)).toBe(true);
    expect(toggleHeldButton(w, BUTTON_POINT.x, BUTTON_POINT.y)).toBe(true);
    expect(w.cc2ToggledButtonCells).toEqual([cellOf(BUTTON_POINT), cellOf(OTHER_BUTTON_POINT)]);
    expect(toggleHeldButton(w, OTHER_BUTTON_POINT.x, OTHER_BUTTON_POINT.y)).toBe(false);
    expect(w.cc2ToggledButtonCells).toEqual([cellOf(BUTTON_POINT)]);
  });

  it('enters the search key and the wave state only when non-empty', () => {
    const engine = load();
    const w = world(engine);
    const empty = cc2HiddenStateKey(w);
    toggleHeldButton(w, BUTTON_POINT.x, BUTTON_POINT.y);
    expect(cc2HiddenStateKey(w)).not.toBe(empty);
    expect(engine.getCc2WaveState()?.toggledButtons).toEqual([cellOf(BUTTON_POINT)]);
    toggleHeldButton(w, BUTTON_POINT.x, BUTTON_POINT.y);
    expect(cc2HiddenStateKey(w)).toBe(empty);
    expect(engine.getCc2WaveState()?.toggledButtons).toBeUndefined();
  });

  it('is reset when another level loads in the same world', () => {
    const engine = load();
    toggleHeldButton(world(engine), BUTTON_POINT.x, BUTTON_POINT.y);
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).cc2ToggledButtonCells).toEqual([]);
  });

  it('is saved with the undo snapshot and dropped by an undo to a snapshot without it', () => {
    const engine = load();
    toggleHeldButton(world(engine), BUTTON_POINT.x, BUTTON_POINT.y);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    world(engine).cc2ToggledButtonCells = [];
    expect(engine.undo()).toBe(true);
    expect(world(engine).cc2ToggledButtonCells).toEqual([cellOf(BUTTON_POINT)]);

    const plain = load();
    expect(plain.attemptPlayerMove('E')).toBe(true);
    toggleHeldButton(world(plain), BUTTON_POINT.x, BUTTON_POINT.y);
    expect(plain.undo()).toBe(true);
    expect(world(plain).cc2ToggledButtonCells).toEqual([]);
  });
});

describe('yellow pad latch', () => {
  const pads = (...cells: string[]): Record<string, string> => Object.fromEntries(cells.map((cell) => [cell, YELLOW_PAD_ID]));

  it('is true on a CC2-engine level with more than one yellow pad', () => {
    expect(world(load({ mode: 'cc2', terrain: pads(FIRST_PAD, SECOND_PAD) })).cc2YellowPadsAreItems).toBe(true);
  });

  it('is false with a single pad, with none, and off the CC2 engine', () => {
    expect(world(load({ mode: 'cc2', terrain: pads(FIRST_PAD) })).cc2YellowPadsAreItems).toBe(false);
    expect(world(load({ mode: 'cc2' })).cc2YellowPadsAreItems).toBe(false);
    expect(world(load({ mode: 'cc', terrain: pads(FIRST_PAD, SECOND_PAD) })).cc2YellowPadsAreItems).toBe(false);
    expect(world(load({ mode: 'native', terrain: pads(FIRST_PAD, SECOND_PAD) })).cc2YellowPadsAreItems).toBe(false);
  });

  it('is decided at load: a pad lost later does not change it, and the next load decides again', () => {
    const engine = load({ mode: 'cc2', terrain: pads(FIRST_PAD, SECOND_PAD) });
    world(engine).terrain[3][3] = 'floor';
    expect(world(engine).cc2YellowPadsAreItems).toBe(true);
    engine.loadLevel(room({ mode: 'cc2' }));
    expect(world(engine).cc2YellowPadsAreItems).toBe(false);
  });

  it('survives an undo round trip unchanged', () => {
    const engine = load({ mode: 'cc2', terrain: pads(FIRST_PAD, SECOND_PAD) });
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(world(engine).cc2YellowPadsAreItems).toBe(true);
  });
});

describe('rolling ball launch', () => {
  it('launches a rolling ball on a CC2 level, and none on any other', () => {
    const engine = load();
    const w = world(engine);
    const ctx = { world: w } as unknown as Parameters<typeof launchRollingBall>[0];
    expect(launchRollingBall(ctx, w.player.x, w.player.y, w.player.dir)).toBe(true);
    expect(w.entities.some((e) => e.type === ROLLING_BALL_ID)).toBe(true);
    const native = load({ mode: 'native' });
    const nativeWorld = world(native);
    const nativeCtx = { world: nativeWorld } as unknown as Parameters<typeof launchRollingBall>[0];
    expect(launchRollingBall(nativeCtx, nativeWorld.player.x, nativeWorld.player.y, nativeWorld.player.dir)).toBe(false);
    expect(nativeWorld.entities.some((e) => e.type === ROLLING_BALL_ID)).toBe(false);
  });
});
