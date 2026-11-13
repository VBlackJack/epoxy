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
 * Lexy's Labyrinth starts every circuit off (game.js recalculate_circuitry), so a cloner or launcher whose source is
 * held when the level loads rises on the first settle and fires on tick 0. Epoxy primes the network at load, which
 * hid that edge; a CC2-engine level now starts its wired sinks off. Other levels keep the primed start.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import { normalizeSignalLinks } from '../signalLinks';
import type { Cc2LevelData, CompiledLevel, Direction, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const PLAYER_X = 1;
const PLATE_X = 2;
const CLONER_X = 5;
const CLONE_X = CLONER_X + 1;
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
const BLOCK = 'dirt_block';
const EMPTY_ROWS = ['#########', '#@......#', '#########'];
/** Ticks run after the load; the first one is tick 0. */
const SETTLE_TICKS = 3;

type Mode = 'cc2' | 'cc' | 'native';

const LINK: SignalLink = { fromX: PLATE_X, fromY: ROW, toX: CLONER_X, toY: ROW };

/** A lane with a plate, a clone machine holding a block template facing east, and the plate wired to the machine. */
function lane(mode: Mode, held: boolean): CompiledLevel {
  const entities = [{ type: BLOCK, x: CLONER_X, y: ROW, dir: 'E' as Direction }, ...(held ? [{ type: BLOCK, x: PLATE_X, y: ROW, dir: 'E' as Direction }] : [])];
  const built = buildTestLevel(EMPTY_ROWS, { entities });
  built.terrain[ROW][PLATE_X] = PLATE;
  built.terrain[ROW][CLONER_X] = CLONE_MACHINE;
  const wired: CompiledLevel = { ...built, signalLinks: [LINK] };
  if (mode === 'cc2') return { ...wired, cc2: CC2_RECORD };
  return mode === 'cc' ? { ...wired, rulesFlavor: 'cc' } : wired;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const clonesAt = (engine: GameEngine): number => engine.getEntities().filter((e) => e.x === CLONE_X && e.y === ROW).length;

describe('CC2 engine: a cloner wired to a source held at load', () => {
  // The edge of tick 0 is a wire edge: the clone machine acts one tick later (see cc2SignalSinksWave3.test.ts).
  it('clones from the edge of tick 0, one tick later', () => {
    const engine = load(lane('cc2', true));
    expect(clonesAt(engine)).toBe(0);
    engine.tick();
    expect(clonesAt(engine)).toBe(0);
    engine.tick();
    expect(clonesAt(engine)).toBe(1);
  });

  it.each(['cc', 'native'] as const)('does not clone at load on a %s level', (mode) => {
    const engine = load(lane(mode, true));
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(clonesAt(engine)).toBe(0);
  });

  it('does not clone when nothing holds the source', () => {
    const engine = load(lane('cc2', false));
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(clonesAt(engine)).toBe(0);
  });

  it('clones once, not on every tick, while the source stays held', () => {
    const engine = load(lane('cc2', true));
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(clonesAt(engine)).toBe(1);
  });

  it('clones nothing when the player steps off the held source before tick 0', () => {
    const level = lane('cc2', false);
    level.playerStart = { x: PLATE_X, y: ROW, dir: 'W' };
    const engine = load(level);
    expect(engine.attemptPlayerMove('W')).toBe(true);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(clonesAt(engine)).toBe(0);
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });
});

describe('a firing sink never feeds another node', () => {
  it('drops a wire that leaves a clone machine, so its stored output has no reader', () => {
    const level = lane('cc2', true);
    const fromSink: SignalLink = { fromX: CLONER_X, fromY: ROW, toX: PLATE_X, toY: ROW };
    const kept = normalizeSignalLinks([LINK, fromSink], level.terrain, 'epoxy', null, (id) => ConfigRegistry.getTile(id));
    expect(kept).toEqual([LINK]);
  });
});
