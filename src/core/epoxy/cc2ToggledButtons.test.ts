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
 * CC2 engine: an actor removed in place on a button with no departure (a rolling ball that blew up there) leaves the button
 * toggled for good. An orange button reads the exclusive or of what stands on it and the toggle; a brown button stays pressed
 * (Lexy add_press without remove_press).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import { toggleHeldButton } from './epoxySignals';
import { mapWidth, type EpoxyWorld } from './epoxyWorld';

const ORANGE = 'button_orange_cc2';
const BROWN = 'button_brown';
const JET_OFF = 'flame_jet_cc2_off';
const JET_ON = 'flame_jet_cc2_on';
const TRAP = 'trap';
const BUTTON = { x: 5, y: 8 };
const JET = { x: 9, y: 8 };
const BROWN_BUTTON = { x: 3, y: ROOM_ROW };
const TRAP_CELL = { x: 9, y: 9 };
const SETTLE_TICKS = 5;
const STILL_COOLDOWN_TICKS = 100000;
const SEED = 5;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const tick = (engine: GameEngine, count: number): void => {
  for (let i = 0; i < count; i++) engine.tick();
};
const jet = (engine: GameEngine): string => engine.getTerrain()[JET.y][JET.x];

function orangeLevel(mode: RoomMode, entities: CompiledLevel['entities'] = []): CompiledLevel {
  const level = room({ mode, terrain: { [`${BUTTON.x},${BUTTON.y}`]: ORANGE, [`${JET.x},${JET.y}`]: JET_OFF }, entities });
  level.signalLinks = [{ fromX: BUTTON.x, fromY: BUTTON.y, toX: JET.x, toY: JET.y }];
  return level;
}

function brownLevel(mode: RoomMode): CompiledLevel {
  const level = room({ mode, terrain: { [`${BROWN_BUTTON.x},${BROWN_BUTTON.y}`]: BROWN, [`${TRAP_CELL.x},${TRAP_CELL.y}`]: TRAP } });
  level.trapLinks = [{ buttonX: BROWN_BUTTON.x, buttonY: BROWN_BUTTON.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y }];
  return level;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('toggleHeldButton: an orange button toggled with nothing on it', () => {
  it('keeps the flame jet on, and a later visitor toggles it off on arrival and back on when he leaves', () => {
    const engine = load(orangeLevel('cc2', [{ type: 'glider', x: BUTTON.x, y: BUTTON.y + 1, dir: 'E' }]));
    const visitor = engine.getEntities()[0];
    visitor.cooldownTicks = STILL_COOLDOWN_TICKS;
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_OFF);

    expect(toggleHeldButton(worldOf(engine), BUTTON.x, BUTTON.y)).toBe(true);
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_ON);
    expect(worldOf(engine).cc2ToggledButtonCells).toEqual([BUTTON.y * mapWidth(worldOf(engine)) + BUTTON.x]);

    visitor.x = BUTTON.x;
    visitor.y = BUTTON.y;
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_OFF);

    visitor.y = BUTTON.y + 1;
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_ON);
  });

  it('releases the button on a second toggle', () => {
    const engine = load(orangeLevel('cc2'));
    toggleHeldButton(worldOf(engine), BUTTON.x, BUTTON.y);
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_ON);
    expect(toggleHeldButton(worldOf(engine), BUTTON.x, BUTTON.y)).toBe(false);
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_OFF);
    expect(worldOf(engine).cc2ToggledButtonCells).toEqual([]);
  });

  it('changes nothing while the set is empty', () => {
    const engine = load(orangeLevel('cc2'));
    tick(engine, SETTLE_TICKS);
    expect(jet(engine)).toBe(JET_OFF);
    expect(worldOf(engine).cc2ToggledButtonCells).toEqual([]);
  });

  it('does nothing on a level that is not on the CC2 engine', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(orangeLevel(mode));
      expect(toggleHeldButton(worldOf(engine), BUTTON.x, BUTTON.y)).toBe(false);
      tick(engine, SETTLE_TICKS);
      expect(jet(engine)).toBe(JET_OFF);
      expect(worldOf(engine).cc2ToggledButtonCells).toEqual([]);
    }
  });
});

describe('toggleHeldButton: a brown button toggled with nothing on it', () => {
  it('holds the linked trap open for good', () => {
    const engine = load(brownLevel('cc2'));
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
    toggleHeldButton(worldOf(engine), BROWN_BUTTON.x, BROWN_BUTTON.y);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    tick(engine, SETTLE_TICKS);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
  });

  it('counts presses: a second removal on the cell never releases the trap, and nothing changes outside the CC2 engine', () => {
    const engine = load(brownLevel('cc2'));
    toggleHeldButton(worldOf(engine), BROWN_BUTTON.x, BROWN_BUTTON.y);
    expect(toggleHeldButton(worldOf(engine), BROWN_BUTTON.x, BROWN_BUTTON.y)).toBe(true);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    expect(worldOf(engine).cc2ToggledButtonCells).toEqual([BROWN_BUTTON.y * mapWidth(worldOf(engine)) + BROWN_BUTTON.x]);

    const classic = load(brownLevel('cc'));
    toggleHeldButton(worldOf(classic), BROWN_BUTTON.x, BROWN_BUTTON.y);
    expect(classic.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
  });
});
