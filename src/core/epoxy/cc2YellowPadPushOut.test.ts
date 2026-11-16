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
 * The no-jump, key, direct-pad and classic tests below are pins of what stays unchanged (the direct-pad one counts the jump visuals,
 * so a double jump fails it); the Venice shape, which fails without the rule, carries it.
 *
 * A yellow pad pushed off a full tool belt onto the cell the player arrives on is a teleporter under him (Lexy's Labyrinth
 * game.js:2310-2333 step_on_cell: the item is taken first, the pad is set down by attempt_take, then the terrain is read and
 * marks the actor as just stepped on a teleporter; game.js:1371-1372 attempt_teleport at idle): he jumps when the step ends.
 * Not modelled: a monster or a block never pushes a pad out, as they hold no belt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const PAD_ITEM = 'teleport_yellow_item';
const BOOTS = ['boots_water', 'boots_fire', 'boots_ice'];
const NEW_BOOTS = 'boots_force';
const KEY = 'key_red';
const FLOOR = 'floor';
const SETTLE_TICKS = 30;
/** The 'teleport' visuals one jump emits (to be checked against a real jump). */
const ONE_JUMP_VISUALS = 2;
const MAX_WAIT_TICKS = 40;
const START_X = 2;
/** The cell he steps onto, the free pad he is sent to, and the cell he leaves it by (east of the pad). */
const TARGET = { x: START_X + 1, y: ROOM_ROW };
const PAD_B = { x: 9, y: 3 };
const B_EXIT = { x: PAD_B.x + 1, y: PAD_B.y };
/** A third pad: with two pads or more at load the yellow pads are items, and the pad set down joins the list read live. */
const PAD_C = { x: 6, y: 9 };

type Cell = { x: number; y: number };
const key = (cell: Cell): string => `${cell.x},${cell.y}`;
/** Counts the 'teleport' visuals the engine emits from now on: one jump emits a fixed number, so a double jump doubles it. */
function countTeleportVisuals(engine: GameEngine): () => number {
  let count = 0;
  engine.setOnVisualEventCallback((kind) => {
    if (kind === 'teleport') count++;
  });
  return () => count;
}
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const at = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });

beforeEach(() => {
  loadTestConfigs();
});

/** A full belt with the yellow pad the oldest tool, one step west of TARGET, which holds `item`; a free pad B waits elsewhere. */
function load(mode: RoomMode, item: string, opts: { terrain?: Record<string, string> } = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: START_X,
      terrain: { [key(PAD_B)]: PAD, [key(PAD_C)]: PAD, ...opts.terrain },
      items: { [key(TARGET)]: item }
    })
  );
  const p = world(engine).player;
  p.keys[PAD_ITEM] = 1;
  p.belt = [PAD_ITEM, ...BOOTS];
  p.boots = new Set(BOOTS);
  return engine;
}

function stepEast(engine: GameEngine): void {
  for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
  expect(playMove(engine, 'E').accepted).toBe(true);
  for (let t = 0; t < SETTLE_TICKS; t++) engine.tick();
}

describe('a yellow pad pushed off the belt under the arriving player', () => {
  it('sets the pad down and jumps to the free pad when the step ends (Venice shape)', () => {
    const engine = load('cc2', NEW_BOOTS);
    const jumpVisuals = countTeleportVisuals(engine);
    stepEast(engine);
    expect(jumpVisuals()).toBe(ONE_JUMP_VISUALS);
    expect(world(engine).terrain[TARGET.y][TARGET.x]).toBe(PAD);
    expect(engine.getPlayer().keys[PAD_ITEM]).toBeUndefined();
    expect(engine.getPlayer().belt).toEqual([...BOOTS, NEW_BOOTS]);
    expect(at(engine)).toEqual(B_EXIT);
  });

  it('refuses the pickup, so no jump, when the pad cannot be set down (not plain floor)', () => {
    const engine = load('cc2', NEW_BOOTS, { terrain: { [key(TARGET)]: 'gravel' } });
    stepEast(engine);
    expect(at(engine)).toEqual(TARGET);
    expect(world(engine).items[TARGET.y][TARGET.x]).toBe(NEW_BOOTS);
    expect(engine.getPlayer().keys[PAD_ITEM]).toBe(1);
  });

  it('gives no jump for a key pickup: keys are not belt tools and push nothing out', () => {
    const engine = load('cc2', KEY);
    stepEast(engine);
    expect(at(engine)).toEqual(TARGET);
    expect(world(engine).terrain[TARGET.y][TARGET.x]).toBe(FLOOR);
    expect(engine.getPlayer().keys[PAD_ITEM]).toBe(1);
  });

  it('jumps once for a pad stepped onto directly: the pushed-out tool is no second teleport', () => {
    const engine = load('cc2', NEW_BOOTS, { terrain: { [key(TARGET)]: PAD } });
    const jumpVisuals = countTeleportVisuals(engine);
    // The oldest tool is a boot here, so it is pushed out onto the pad cell and the pad under him jumps him once.
    const p = world(engine).player;
    delete p.keys[PAD_ITEM];
    p.belt = [...BOOTS, 'boots_speed'];
    p.boots = new Set([...BOOTS, 'boots_speed']);
    stepEast(engine);
    expect(world(engine).terrain[TARGET.y][TARGET.x]).toBe(PAD);
    expect(at(engine)).toEqual(B_EXIT);
    // Counted visuals catch a double jump (the guard of the pushed-out pad is idempotent with the arrival flag: measured, reverting it
    // changes nothing here, so this is a pin of the single jump, not a proof of the guard).
    expect(jumpVisuals()).toBe(ONE_JUMP_VISUALS);
  });

  it('is a CC2-engine rule: a classic level has no belt, so no pad is set down', () => {
    const engine = load('cc', NEW_BOOTS);
    stepEast(engine);
    expect(world(engine).terrain[TARGET.y][TARGET.x]).toBe(FLOOR);
    expect(at(engine)).toEqual(TARGET);
  });
});
