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

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';
import { playerWalkCooldown } from './epoxyPlayer';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SIZE = 13;
const ROW = 5;
const START_X = 2;
const NEAR_PAD = 3;
const FAR_PAD = 8;
const TIME_LIMIT_SECONDS = 200;
const IDLE_TICKS = 12;
const MAX_WAIT_TICKS = 40;

function room(opts: { cc: boolean }): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[ROW][NEAR_PAD] = 'teleport';
  terrain[ROW][FAR_PAD] = 'teleport';
  return {
    id: 'cc_teleport_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { x: START_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(opts.cc ? { rulesFlavor: 'cc' as const } : {})
  };
}

function load(level: CompiledLevel): { engine: GameEngine; walk: number } {
  const engine = new GameEngine();
  engine.loadLevel(level);
  const world = (engine as unknown as { w: EpoxyWorld }).w;
  return { engine, walk: playerWalkCooldown(world) };
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

/** Ticks until the player's wait is over. */
function waitOut(engine: GameEngine): void {
  for (let i = 0; i < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; i++) engine.tick();
}

describe('classic teleport landing', () => {
  it('lands the player on the destination pad and leaves by a forced step after the walking wait', () => {
    const { engine, walk } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    let p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD);
    expect(p.y).toBe(ROW);
    expect(p.teleportExit).toBe('E');
    expect(p.moveCooldown).toBe(walk);
    // No move of his own while he waits on the pad.
    expect(engine.attemptPlayerMove('N')).toBe(false);
    for (let i = 0; i < walk - 1; i++) engine.tick();
    expect(engine.getPlayer().x).toBe(FAR_PAD);
    engine.tick();
    p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD + 1);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(walk);
  });

  it('leaves a native level jumping straight to the exit cell', () => {
    const { engine, walk } = load(room({ cc: false }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD + 1);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(walk);
  });

  it('stays on the pad when the forced exit is blocked, and takes input again', () => {
    const { engine } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    world(engine).terrain[ROW][FAR_PAD + 1] = 'wall';
    waitOut(engine);
    const p = engine.getPlayer();
    expect(p.x).toBe(FAR_PAD);
    expect(p.teleportExit).toBeUndefined();
    expect(engine.attemptPlayerMove('N')).toBe(true);
  });

  it('tries only the entered direction when picking a pad', () => {
    const { engine } = load(room({ cc: true }));
    const w = world(engine);
    // Wall the far pad's east exit: the pad is refused (only the entered direction counts) and the entered pad is used.
    w.terrain[ROW][FAR_PAD + 1] = 'wall';
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
    expect(engine.getPlayer().teleportExit).toBe('E');
  });

  it('rolls the first step back with undo', () => {
    const { engine } = load(room({ cc: true }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.undo()).toBe(true);
    const p = engine.getPlayer();
    expect(p.x).toBe(START_X);
    expect(p.teleportExit).toBeUndefined();
    expect(p.moveCooldown).toBe(0);
  });

  it('restores the post-exit state when undoing a later move', () => {
    const { engine } = load(room({ cc: true }));
    engine.attemptPlayerMove('E');
    waitOut(engine);
    waitOut(engine);
    expect(engine.attemptPlayerMove('S')).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
  });

  it('plays the same way twice', () => {
    const run = (): string[] => {
      const { engine } = load(room({ cc: true }));
      engine.attemptPlayerMove('E');
      const trace: string[] = [];
      for (let i = 0; i < IDLE_TICKS; i++) {
        engine.tick();
        const p = engine.getPlayer();
        trace.push(`${p.x},${p.y},${p.moveCooldown}`);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});

interface Extra {
  entities?: EntityPlacement[];
  others?: Array<{ x: number; y: number }>;
  terrain?: Array<[number, number, string]>;
}

function roomWith(extra: Extra): CompiledLevel {
  const level = room({ cc: true });
  for (const [x, y, id] of extra.terrain ?? []) level.terrain[y][x] = id;
  return {
    ...level,
    entities: extra.entities ?? [],
    ...(extra.others === undefined
      ? {}
      : { extraPlayers: extra.others.map((o) => ({ x: o.x, y: o.y, dir: 'E' as Direction, character: 'chip' as const })) })
  };
}

describe('classic teleport landing: occupied pads and other players', () => {
  it.each([['dirt_block'], ['pink_ball']])('skips a pad where a %s stands', (type) => {
    const { engine } = load(roomWith({ entities: [{ type, x: FAR_PAD, y: ROW, dir: 'E' }] }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    // The far pad is taken: the entered pad is the only one left.
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
    expect(engine.getPlayer().teleportExit).toBe('E');
  });

  it('skips a pad where a parked player stands', () => {
    const { engine } = load(roomWith({ others: [{ x: FAR_PAD, y: ROW }] }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
  });

  it('skips a pad where a parked player waits for his forced exit', () => {
    const { engine } = load(roomWith({ others: [{ x: FAR_PAD, y: ROW }] }));
    const w = world(engine);
    w.parked[0].teleportExit = 'E';
    w.parked[0].moveCooldown = MAX_WAIT_TICKS;
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().x).toBe(NEAR_PAD);
  });

  it('lets a parked player leave his pad on his own wait, and undo restores his waiting state', () => {
    const { engine } = load(roomWith({ others: [{ x: FAR_PAD, y: ROW }] }));
    const w = world(engine);
    w.parked[0].teleportExit = 'E';
    w.parked[0].moveCooldown = 2;
    // A swap saves an undo snapshot that holds the parked player waiting.
    expect(engine.swapPlayer()).toBe(true);
    expect(world(engine).player.teleportExit).toBe('E');
    engine.tick();
    engine.tick();
    expect(world(engine).player.x).toBe(FAR_PAD + 1);
    expect(engine.undo()).toBe(true);
    const back = world(engine);
    expect([back.player.x, back.parked[0]?.teleportExit]).toEqual([2, 'E']);
  });

  it('holds the swap key input of a player waiting on a pad: the swapped-in waiting player takes no move', () => {
    const { engine } = load(roomWith({ others: [{ x: FAR_PAD, y: ROW }] }));
    const w = world(engine);
    w.parked[0].teleportExit = 'E';
    w.parked[0].moveCooldown = MAX_WAIT_TICKS;
    expect(engine.swapPlayer()).toBe(true);
    expect(engine.attemptPlayerMove('N')).toBe(false);
  });
});

describe('classic teleport landing: where the forced exit leads', () => {
  const exitOnto = (id: string, parked: boolean): { x: number; slide: number; sliding: boolean } => {
    const { engine } = load(
      roomWith({ terrain: [[FAR_PAD + 1, ROW, id]], ...(parked ? { others: [{ x: FAR_PAD, y: ROW }] } : {}) })
    );
    const w = world(engine);
    const who = parked ? w.parked[0] : w.player;
    who.x = FAR_PAD;
    who.y = ROW;
    who.teleportExit = 'E';
    who.moveCooldown = 1;
    engine.tick();
    const after = parked ? world(engine).parked[0] : world(engine).player;
    return { x: after.x, slide: after.slideCooldown, sliding: after.isSliding };
  };

  it('starts a slide on ice the same way for the active and a parked player', () => {
    const active = exitOnto('ice', false);
    const parked = exitOnto('ice', true);
    expect(active.x).toBe(FAR_PAD + 1);
    expect(active.sliding).toBe(true);
    expect(parked).toEqual(active);
  });

  it('starts a carry on a force floor the same way for the active and a parked player', () => {
    const active = exitOnto('force_e', false);
    expect(active.x).toBe(FAR_PAD + 1);
    expect(exitOnto('force_e', true)).toEqual(active);
  });

  it('lands on a second pad when the exit cell is a pad, with a new forced exit', () => {
    const { engine } = load(roomWith({ terrain: [[FAR_PAD + 1, ROW, 'teleport']] }));
    const w = world(engine);
    w.player.x = FAR_PAD;
    w.player.y = ROW;
    w.player.teleportExit = 'E';
    w.player.moveCooldown = 1;
    engine.tick();
    const p = engine.getPlayer();
    expect(p.teleportExit).toBe('E');
    expect(p.x).not.toBe(FAR_PAD + 1);
  });
});
