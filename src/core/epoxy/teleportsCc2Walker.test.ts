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
 * The green teleporter of the Chip's Challenge 2 engine draws its pad and its side from the walker generator (pad
 * index = byte % (others), side = byte % 4), searching only the pads that hold no actor, as Lexy's Labyrinth does. A
 * native or classic level keeps the level generator.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Direction, EntityPlacement } from '../types';
import { drawWalkerByte, type CcGenerators } from './ccGenerators';
import type { EpoxyWorld } from './epoxyWorld';

const GREEN = 'teleport_random';
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 20;
/** Reading order: B, A (the one the player enters), C. From A the ring reads C, then B. */
const PAD_A = { x: 3, y: ROOM_ROW };
const PAD_B = { x: 8, y: 3 };
const PAD_C = { x: 8, y: 9 };
const OTHER_PADS = 2;
/** How many walker draws are burnt before the jump, so that several pad and side pairs are met. */
const BURNT_DRAWS = Array.from({ length: 40 }, (_, i) => i);
const UNDO_BURNT_DRAWS = 5;
const LONE_BURNT_DRAWS = 3;

type Cell = { x: number; y: number };

const key = (cell: Cell): string => `${cell.x},${cell.y}`;
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const generators = (engine: GameEngine): CcGenerators => {
  const g = world(engine).ccGenerators;
  if (g === null) throw new Error('the level has no generators');
  return g;
};
const state = (g: CcGenerators): number[] => [g.walkerHigh, g.walkerLow, g.main];

function pads(mode: RoomMode, count: number, entities: EntityPlacement[] = []): GameEngine {
  const terrain: Record<string, string> = {};
  for (const cell of [PAD_A, PAD_B, PAD_C].slice(0, count)) terrain[key(cell)] = GREEN;
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain, entities }));
  return engine;
}

/** Burns draws of the walker generator of the engine; returns a copy of the state it is left in. */
function burn(engine: GameEngine, draws: number): CcGenerators {
  const g = generators(engine);
  for (let i = 0; i < draws; i++) drawWalkerByte(g);
  return { ...g };
}

/** The pad index and the side the next two draws of a generator hold, read from a copy so the real one is untouched. */
function nextDraws(g: CcGenerators, others: number): { index: number; side: Direction; after: CcGenerators } {
  const copy = { ...g };
  const index = drawWalkerByte(copy) % others;
  const side = ORDERED_DIRECTIONS[drawWalkerByte(copy) % ORDERED_DIRECTIONS.length];
  return { index, side, after: copy };
}

function jump(engine: GameEngine): Cell {
  for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return { x: engine.getPlayer().x, y: engine.getPlayer().y };
}

const exitOf = (pad: Cell, side: Direction): Cell => ({
  x: pad.x + DIRECTION_VECTORS[side].dx,
  y: pad.y + DIRECTION_VECTORS[side].dy
});

beforeEach(() => {
  loadTestConfigs();
});

describe('green teleporter on the CC2 engine', () => {
  it('leaves the pad and the side drawn from the walker generator, never the level generator', () => {
    const ring = [PAD_C, PAD_B];
    for (const burnt of BURNT_DRAWS) {
      const engine = pads('cc2', 3);
      const rng = vi.spyOn(world(engine).rng, 'nextInt');
      const { index, side, after } = nextDraws(burn(engine, burnt), OTHER_PADS);
      expect(jump(engine)).toEqual(exitOf(ring[index], side));
      expect(rng).not.toHaveBeenCalled();
      expect(state(generators(engine))).toEqual(state(after));
    }
  });

  it('meets both pads and several sides over many burnt draws', () => {
    const indexes = new Set<number>();
    const pairs = new Set<string>();
    for (const burnt of BURNT_DRAWS) {
      const { index, side } = nextDraws(burn(pads('cc2', 3), burnt), OTHER_PADS);
      indexes.add(index);
      pairs.add(`${index}${side}`);
    }
    expect(indexes.size).toBe(OTHER_PADS);
    expect(pairs.size).toBeGreaterThan(OTHER_PADS);
  });

  it('with a pad clogged by a block, searches only the free pads from the drawn index, and leaves its own pad forward past the end', () => {
    const block: EntityPlacement = { type: 'dirt_block', x: PAD_B.x, y: PAD_B.y, dir: 'S' };
    // Free ring: C, then the entered pad A last. A drawn index of 1 lands on A itself, so the mover leaves A forward.
    let leftOwnPad = false;
    let leftFreePad = false;
    for (const burnt of BURNT_DRAWS) {
      const engine = pads('cc2', 3, [block]);
      const { index, side } = nextDraws(burn(engine, burnt), OTHER_PADS);
      const landed = jump(engine);
      if (index === 0) {
        expect(landed).toEqual(exitOf(PAD_C, side));
        leftFreePad = true;
      } else {
        expect(landed).toEqual(exitOf(PAD_A, 'E'));
        expect(engine.getPlayer().dir).toBe('E');
        leftOwnPad = true;
      }
    }
    expect(leftOwnPad).toBe(true);
    expect(leftFreePad).toBe(true);
  });

  it('a lone pad leaves forward and leaves the bytes unchanged', () => {
    const engine = pads('cc2', 1);
    burn(engine, LONE_BURNT_DRAWS);
    const before = state(generators(engine));
    expect(jump(engine)).toEqual(exitOf(PAD_A, 'E'));
    expect(state(generators(engine))).toEqual(before);
  });

  it('an undo brings back the bytes and the same destination', () => {
    const engine = pads('cc2', 3);
    burn(engine, UNDO_BURNT_DRAWS);
    const before = state(generators(engine));
    const first = jump(engine);
    expect(state(generators(engine))).not.toEqual(before);
    expect(engine.undo()).toBe(true);
    expect(state(generators(engine))).toEqual(before);
    expect(jump(engine)).toEqual(first);
  });
});

describe('green teleporter outside the CC2 engine', () => {
  it.each<RoomMode>(['native', 'cc'])('keeps drawing from the level generator on a %s level', (mode) => {
    const engine = pads(mode, 3);
    const rng = vi.spyOn(world(engine).rng, 'nextInt');
    const before = world(engine).ccGenerators === null ? null : state(generators(engine));
    jump(engine);
    expect(rng).toHaveBeenCalledTimes(2);
    if (before !== null) expect(state(generators(engine))).toEqual(before);
  });
});
