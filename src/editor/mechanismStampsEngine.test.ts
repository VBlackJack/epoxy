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

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { LynxRig } from '../core/lynx/lynxTestRig';
import type { CompiledLevel, Direction, Ruleset } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { EditorMap } from './editorDocument';
import { MECHANISM_STAMPS, mechanismStampClip, type MechanismStamp } from './mechanismStamps';
import { pasteClip } from './selectionEdits';

/**
 * The stamps through the real engines: each one is pasted into a room and played, so a stamp that links the right cells
 * but does not work in play fails here.
 */

const WIDTH = 9;
const HEIGHT = 7;
const STAMP = { x: 3, y: 3 };
const START = { x: 2, y: 3, dir: 'E' as Direction };
const BUTTON = { x: 3, y: 3 };
const MIDDLE = { x: 4, y: 3 };
const DEVICE = { x: 5, y: 3 };
const MAX_WAIT_TICKS = 30;
const SHOT_TICKS = 6;
const LYNX_TICKS = 40;

const stampOf = (id: string): MechanismStamp => {
  const stamp = MECHANISM_STAMPS.find((candidate) => candidate.id === id);
  if (!stamp) throw new Error(`No stamp ${id}`);
  return stamp;
};

/** A walled room with the stamp pasted in a row at (3, 3) by the editor's own paste, as a level the engines load. */
function levelWith(id: string, ruleset: Ruleset): CompiledLevel {
  const terrain = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  const room: EditorMap = {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: START
  };
  const pasted = pasteClip(room, mechanismStampClip(stampOf(id), 'horizontal'), STAMP.x, STAMP.y, ruleset).map;
  return {
    id: `stamp_${id}`,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    ruleset,
    playerStart: START,
    terrain: pasted.terrain,
    items: pasted.items,
    entities: pasted.entities,
    trapLinks: pasted.trapLinks,
    cloneLinks: pasted.cloneLinks,
    ...(pasted.launcherLinks ? { launcherLinks: pasted.launcherLinks } : {})
  };
}

function load(id: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(levelWith(id, 'epoxy'));
  return engine;
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): void {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) {
      expect(engine.attemptPlayerMove(dir)).toBe(true);
      return;
    }
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

beforeEach(() => {
  loadTestConfigs();
});

describe('mechanism stamps in the Epoxy engine', () => {
  it('trap: closed until something holds the brown button, open while it is held', () => {
    const engine = load('trap');
    expect(engine.isCellClosedTrap(DEVICE.x, DEVICE.y)).toBe(true);
    step(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: BUTTON.x, y: BUTTON.y });
    expect(engine.isCellClosedTrap(DEVICE.x, DEVICE.y)).toBe(false);
    step(engine, 'W');
    expect(engine.isCellClosedTrap(DEVICE.x, DEVICE.y)).toBe(true);
  });

  it('clone: stepping on the red button puts a dirt block in the middle cell', () => {
    const engine = load('clone');
    expect(engine.getEntities().filter((e) => e.type === 'dirt_block')).toHaveLength(1);
    step(engine, 'E');
    for (let i = 0; i < SHOT_TICKS; i++) engine.tick();
    const blocks = engine.getEntities().filter((e) => e.type === 'dirt_block');
    expect(blocks.map((b) => [b.x, b.y]).sort()).toEqual([[MIDDLE.x, MIDDLE.y], [DEVICE.x, DEVICE.y]]);
  });

  it('shot: stepping on the trigger fires the launcher eastward and the player lives', () => {
    const engine = load('shot');
    step(engine, 'E');
    const seen: string[] = [];
    const note = (): void => void (engine.getShots() ?? []).forEach((s) => seen.push(s.dir));
    note();
    for (let i = 0; i < SHOT_TICKS; i++) {
      engine.tick();
      note();
    }
    expect(engine.getPlayer().alive).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['E']));
  });
});

describe('mechanism stamps in the Lynx engine', () => {
  it('trap: closed until the brown button is held, open while it is', () => {
    const rig = new LynxRig(levelWith('trap', 'lynx'));
    expect(rig.engine.isCellClosedTrap(DEVICE.x, DEVICE.y)).toBe(true);
    rig.press('E');
    rig.tick(LYNX_TICKS / 4);
    expect(rig.player).toMatchObject({ x: BUTTON.x, y: BUTTON.y });
    expect(rig.engine.isCellClosedTrap(DEVICE.x, DEVICE.y)).toBe(false);
  });

  it('clone: stepping on the red button clones the block', () => {
    const rig = new LynxRig(levelWith('clone', 'lynx'));
    expect(rig.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(1);
    rig.press('E');
    rig.tick(LYNX_TICKS);
    expect(rig.player).toMatchObject({ x: BUTTON.x, y: BUTTON.y });
    expect(rig.entities.filter((e) => e.type === 'dirt_block').length).toBeGreaterThan(1);
  });
});
