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
 * CC2 engine, wave 11 (FJK): a flame jet that a wire lights under a block kills it and leaves the floor as it is, an ice block
 * included (Lexy flame_jet_on on_stand kill_actor, tiletypes.js:2163-2168); real fire still melts an ice block into water
 * (tiletypes.js:941-969). Levels outside the CC2 engine keep the melt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { flipWiredCellAt, triggerButton } from './epoxyDevices';
import type { EpoxyContext } from './epoxyWorld';

const JET_X = 5;
const UNLIT_WIRED_JET = 'flame_jet_cc2_off';
const LIT_WIRED_JET = 'flame_jet_cc2_on';
const UNLIT_FIRE_JET = 'flame_jet_off';
const ICE_BLOCK = 'ice_block';
const WATER = 'water';
const BUTTON_X = 3;

const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(mode: RoomMode, jet: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, terrain: { [`${JET_X},${ROOM_ROW}`]: jet }, entities: [{ type: ICE_BLOCK, x: JET_X, y: ROOM_ROW, dir: 'E' }] })
  );
  return engine;
}

const iceBlockOf = (engine: GameEngine) => engine.getEntities().find((e) => e.type === ICE_BLOCK);
const jetCell = (engine: GameEngine) => engine.getTerrain()[ROOM_ROW][JET_X];

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: a wire lights a flame jet under an ice block', () => {
  it('destroys the block, keeps the jet, and makes no water', () => {
    const engine = load('cc2', UNLIT_WIRED_JET);
    flipWiredCellAt(ctxOf(engine), JET_X, ROOM_ROW);
    expect(iceBlockOf(engine)).toBeUndefined();
    expect(jetCell(engine)).toBe(LIT_WIRED_JET);
  });

  it.each(['cc', 'native'] as RoomMode[])('still melts the block into water outside the CC2 engine (%s)', (mode) => {
    const engine = load(mode, UNLIT_WIRED_JET);
    flipWiredCellAt(ctxOf(engine), JET_X, ROOM_ROW);
    expect(iceBlockOf(engine)).toBeUndefined();
    expect(jetCell(engine)).toBe(WATER);
  });

  it('still melts an ice block into water on real fire, in the CC2 engine too', () => {
    const engine = load('cc2', UNLIT_FIRE_JET);
    triggerButton(ctxOf(engine), BUTTON_X, ROOM_ROW, 'toggle_flames');
    expect(iceBlockOf(engine)).toBeUndefined();
    expect(jetCell(engine)).toBe(WATER);
  });
});