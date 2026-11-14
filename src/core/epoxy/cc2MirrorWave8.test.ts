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
 * CC2 wave 8, mirror players: on the CC2 engine a mirror is an actor with its own walking cadence that reads the move the
 * player last decided (MC), in an order set by the actor list (MC2), holds the tools and keys it takes (MI) and is barred by
 * lit dynamite (LD). A native level keeps the copy of each input.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { CompiledLevel, Direction, EntityPlacement, RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const MIRROR_CHIP = 'mirror_chip';
const MIRROR_MELINDA = 'mirror_melinda';
const BROWN_BUTTON = 'button_brown';
const TRAP = 'trap';

/** A mirror's walking step in ticks (the move tick and three of cooldown). */
const MIRROR_STEP_TICKS = 4;
/** The player's start cell in the test rooms. */
const START_X = 2;

const mirrorOf = (engine: GameEngine, type = MIRROR_CHIP): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === type);
  if (found === undefined) throw new Error('the room has the mirror');
  return found;
};

const cellOf = (engine: GameEngine, type = MIRROR_CHIP): string => {
  const e = mirrorOf(engine, type);
  return `${e.x},${e.y}`;
};

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function mirrorRoom(mode: RoomMode, entities: EntityPlacement[], extra: { terrain?: Record<string, string>; items?: Record<string, string> } = {}): CompiledLevel {
  return room({ mode, startX: START_X, entities, ...extra });
}

/** Every tick the player tries `dir` against a wall, then the tick runs; returns the mirror's cell after each tick. */
function cellsWhileBlocked(mode: RoomMode, ticks: number, dir: Direction): string[] {
  const engine = load(mirrorRoom(mode, [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }], { terrain: { [`${START_X},${ROOM_ROW - 1}`]: 'wall' } }));
  const cells: string[] = [];
  for (let t = 0; t < ticks; t++) {
    engine.attemptPlayerMove(dir);
    engine.tick();
    cells.push(cellOf(engine));
  }
  return cells;
}

describe('CC2 engine: a mirror walks at its own cadence (MC)', () => {
  it('moves once per four ticks while the player keeps trying a blocked move', () => {
    const cells = cellsWhileBlocked('cc2', MIRROR_STEP_TICKS * 3, 'N');
    const movedAt: number[] = [];
    let previous = '7,9';
    cells.forEach((cell, tick) => {
      if (cell !== previous) movedAt.push(tick);
      previous = cell;
    });
    expect(movedAt.length).toBe(3);
    expect(movedAt[1] - movedAt[0]).toBe(MIRROR_STEP_TICKS);
    expect(movedAt[2] - movedAt[1]).toBe(MIRROR_STEP_TICKS);
  });

  it('copies each input at once on a native level (no cadence of its own)', () => {
    const engine = load(mirrorRoom('native', [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    expect(cellOf(engine)).toBe('8,9');
    for (let i = 0; i < 6; i++) engine.tick();
    engine.attemptPlayerMove('E');
    expect(cellOf(engine)).toBe('9,9');
  });

  it('leaves a decision nobody makes alone: a mirror does not walk on after the player stops', () => {
    const engine = load(mirrorRoom('cc2', [{ type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 3; i++) engine.tick();
    expect(cellOf(engine)).toBe('8,9');
  });

  it('ejects a mirror from a trap forward when it opens, whoever the player is', () => {
    const level = mirrorRoom('cc2', [{ type: MIRROR_CHIP, x: 9, y: 3, dir: 'S' }], {
      terrain: { [`${START_X + 1},${ROOM_ROW}`]: BROWN_BUTTON, '9,3': TRAP }
    });
    level.trapLinks = [{ buttonX: START_X + 1, buttonY: ROOM_ROW, trapX: 9, trapY: 3 }];
    // The player is Melinda, so the mirror of Chip copies nothing: only the opening trap moves it.
    level.character = 'melinda';
    const engine = load(level);
    for (let i = 0; i < MIRROR_STEP_TICKS; i++) engine.tick();
    expect(cellOf(engine)).toBe('9,3');
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 2; i++) engine.tick();
    expect(cellOf(engine)).toBe('9,4');
  });

  it('keeps a mirror whose character is not the player idle without a trap', () => {
    const engine = load(mirrorRoom('cc2', [{ type: MIRROR_MELINDA, x: 7, y: 9, dir: 'N' }]));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < MIRROR_STEP_TICKS * 2; i++) engine.tick();
    expect(cellOf(engine, MIRROR_MELINDA)).toBe('7,9');
  });
});

/** The player decides one step east in the first tick; returns the tick (1-based) in which each mirror first moves, or 0. */
function firstMoveTicks(mode: RoomMode, mirrors: EntityPlacement[]): number[] {
  const engine = load(mirrorRoom(mode, mirrors));
  engine.attemptPlayerMove('E');
  const first = mirrors.map(() => 0);
  const starts = mirrors.map((m) => `${m.x},${m.y}`);
  for (let tick = 1; tick <= MIRROR_STEP_TICKS; tick++) {
    engine.tick();
    engine.getEntities().filter((e) => e.type === MIRROR_CHIP).forEach((e, i) => {
      if (first[i] === 0 && `${e.x},${e.y}` !== starts[i]) first[i] = tick;
    });
  }
  return first;
}

describe('CC2 engine: the actor order decides which tick a mirror reads (MC2)', () => {
  // The player starts at (2, 5): a mirror above him is listed before him, one below him after.
  const BEFORE: EntityPlacement = { type: MIRROR_CHIP, x: 7, y: 2, dir: 'N' };
  const AFTER: EntityPlacement = { type: MIRROR_CHIP, x: 7, y: 9, dir: 'N' };

  it('moves a mirror listed before the player in the tick of his decision, one listed after him a tick later', () => {
    const [before] = firstMoveTicks('cc2', [BEFORE]);
    const [after] = firstMoveTicks('cc2', [AFTER]);
    expect(after - before).toBe(1);
  });

  it('numbers the mirror and the player so that the comparison reads the load order', () => {
    const engine = load(mirrorRoom('cc2', [BEFORE, AFTER]));
    const ordinals = engine.getEntities().map((e) => e.listOrdinal);
    const player = engine.getPlayer().listOrdinal;
    expect(ordinals[0]).toBeLessThan(player ?? -1);
    expect(ordinals[1]).toBeGreaterThan(player ?? Infinity);
  });

  it('counts a mirror without an ordinal (a clone spawned later) as listed after the player', () => {
    const engine = load(mirrorRoom('cc2', [BEFORE]));
    const w = (engine as unknown as { w: { entities: RuntimeEntity[] } }).w;
    delete w.entities[0].listOrdinal;
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(cellOf(engine)).toBe('7,2');
    engine.tick();
    expect(cellOf(engine)).toBe('8,2');
  });

  it('does not move a mirror in the first tick on a native level, which copies at once', () => {
    const engine = load(mirrorRoom('native', [BEFORE]));
    engine.attemptPlayerMove('E');
    expect(cellOf(engine)).toBe('8,2');
  });
});

const FLIPPERS = 'boots_water';
const BOOT_ITEMS = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force', 'boots_speed'];
const PAD_ITEM = 'teleport_yellow_item';
const MIRROR_Y = 9;
/** The player's walking step plus a margin: ticks to wait between two decisions. */
const DECISION_GAP_TICKS = 6;

/** The player decides one step east, then the world runs until the mirror has had time to take it. */
function eastSteps(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) {
    engine.attemptPlayerMove('E');
    for (let t = 0; t < DECISION_GAP_TICKS; t++) engine.tick();
  }
}

const heldTools = (engine: GameEngine, type = MIRROR_CHIP): string[] => mirrorOf(engine, type).heldTools ?? [];
const heldKeys = (engine: GameEngine, type = MIRROR_CHIP): string[] => mirrorOf(engine, type).heldKeys ?? [];

function mirrorWalk(mode: RoomMode, extra: { terrain?: Record<string, string>; items?: Record<string, string> }, type = MIRROR_CHIP): GameEngine {
  return load(mirrorRoom(mode, [{ type, x: 6, y: MIRROR_Y, dir: 'E' }], extra));
}

describe('CC2 engine: a mirror keeps what it picks up (MI)', () => {
  it('crosses water with the flippers it took', () => {
    const engine = mirrorWalk('cc2', { items: { [`7,${MIRROR_Y}`]: FLIPPERS }, terrain: { [`8,${MIRROR_Y}`]: 'water' } });
    eastSteps(engine, 3);
    expect(cellOf(engine)).toBe(`9,${MIRROR_Y}`);
    expect(heldTools(engine)).toEqual([FLIPPERS]);
  });

  it('drowns in the same water on a native level, which keeps no belt', () => {
    const engine = mirrorWalk('native', { items: { [`7,${MIRROR_Y}`]: FLIPPERS }, terrain: { [`8,${MIRROR_Y}`]: 'water' } });
    eastSteps(engine, 3);
    expect(engine.getEntities().some((e) => e.type === MIRROR_CHIP)).toBe(false);
  });

  it('holds four tools at most and puts the oldest down where it stands', () => {
    const items: Record<string, string> = {};
    BOOT_ITEMS.forEach((id, i) => {
      items[`${7 + i},${MIRROR_Y}`] = id;
    });
    const engine = mirrorWalk('cc2', { items });
    eastSteps(engine, BOOT_ITEMS.length);
    expect(heldTools(engine)).toEqual(BOOT_ITEMS.slice(1));
    expect(engine.getItems()[MIRROR_Y][7 + BOOT_ITEMS.length - 1]).toBe(BOOT_ITEMS[0]);
  });

  it('keeps no cap under the CC1 boot rules: it takes the four boots and leaves anything else on the floor', () => {
    const items: Record<string, string> = {};
    ['boots_ice', 'boots_force', 'boots_fire', 'boots_water', 'boots_speed'].forEach((id, i) => {
      items[`${7 + i},${MIRROR_Y}`] = id;
    });
    const level = mirrorRoom('cc2', [{ type: MIRROR_CHIP, x: 6, y: MIRROR_Y, dir: 'E' }], { items });
    level.cc2 = { ...(level.cc2 as NonNullable<typeof level.cc2>), useCc1Boots: true };
    const engine = load(level);
    eastSteps(engine, 5);
    expect(heldTools(engine)).toEqual(['boots_ice', 'boots_force', 'boots_fire', 'boots_water']);
    expect(engine.getItems()[MIRROR_Y][11]).toBe('boots_speed');
  });

  it('refuses a pickup that would put a yellow teleporter pad down off plain floor', () => {
    const items: Record<string, string> = { [`7,${MIRROR_Y}`]: PAD_ITEM };
    ['boots_water', 'boots_fire', 'boots_ice'].forEach((id, i) => {
      items[`${8 + i},${MIRROR_Y}`] = id;
    });
    items[`11,${MIRROR_Y}`] = 'boots_force';
    const engine = mirrorWalk('cc2', { items, terrain: { [`11,${MIRROR_Y}`]: 'hint' } });
    eastSteps(engine, 5);
    expect(heldTools(engine)[0]).toBe(PAD_ITEM);
    expect(heldTools(engine)).toHaveLength(4);
    expect(engine.getItems()[MIRROR_Y][11]).toBe('boots_force');
  });

  it('opens a door only with a key it holds, and keeps the key of its own colour', () => {
    const doorAt = `9,${MIRROR_Y}`;
    const without = mirrorWalk('cc2', { terrain: { [doorAt]: 'door_green' } });
    eastSteps(without, 4);
    expect(cellOf(without)).toBe(`8,${MIRROR_Y}`);
    const withKey = mirrorWalk('cc2', { terrain: { [doorAt]: 'door_green' }, items: { [`7,${MIRROR_Y}`]: 'key_green' } });
    eastSteps(withKey, 4);
    expect(cellOf(withKey)).toBe(`10,${MIRROR_Y}`);
    expect(heldKeys(withKey)).toEqual(['key_green']);
  });

  it('spends a key of another colour on the door it opens', () => {
    const engine = mirrorWalk('cc2', { terrain: { [`9,${MIRROR_Y}`]: 'door_yellow' }, items: { [`7,${MIRROR_Y}`]: 'key_yellow' } });
    eastSteps(engine, 4);
    expect(cellOf(engine)).toBe(`10,${MIRROR_Y}`);
    expect(heldKeys(engine)).toEqual([]);
  });

  it('opens the door of its own colour without a key on a native level', () => {
    const engine = mirrorWalk('native', { terrain: { [`8,${MIRROR_Y}`]: 'door_green' } });
    eastSteps(engine, 2);
    expect(cellOf(engine)).toBe(`8,${MIRROR_Y}`);
  });

  it('lets the mirror of Melinda onto dirt with the hiking boots it took, and not without', () => {
    const level = (items: Record<string, string>): CompiledLevel => {
      const l = mirrorRoom('cc2', [{ type: MIRROR_MELINDA, x: 6, y: MIRROR_Y, dir: 'E' }], { terrain: { [`8,${MIRROR_Y}`]: 'dirt' }, items });
      l.character = 'melinda';
      return l;
    };
    const without = load(level({}));
    eastSteps(without, 3);
    expect(cellOf(without, MIRROR_MELINDA)).toBe(`7,${MIRROR_Y}`);
    const withBoots = load(level({ [`7,${MIRROR_Y}`]: 'hiking_boots' }));
    eastSteps(withBoots, 3);
    expect(cellOf(withBoots, MIRROR_MELINDA)).toBe(`9,${MIRROR_Y}`);
  });
});

describe('validator: the door rule of a mirror follows the engine (MI)', () => {
  const errorsOf = (level: CompiledLevel): string[] =>
    LevelValidator.validate(level)
      .issues.filter((issue) => issue.severity === 'error')
      .map((issue) => issue.i18nKey);
  const sealed = (mode: RoomMode, items: Record<string, string> = {}): CompiledLevel => {
    const terrain: Record<string, string> = { '7,1': 'wall', '7,3': 'wall', '7,2': 'door_green', '8,2': 'exit' };
    for (let y = 1; y < 4; y++) terrain[`9,${y}`] = 'wall';
    const level = room({ mode, startX: 2, terrain, items, entities: [{ type: MIRROR_CHIP, x: 3, y: 2, dir: 'E' }] });
    level.playerStart = { x: 2, y: 2, dir: 'E' };
    return level;
  };

  it('lets a native mirror open the door of its colour without a key, as before', () => {
    expect(errorsOf(sealed('native'))).toEqual([]);
  });

  it('leaves a CC2 door shut to a mirror when no key of its colour lies on the map', () => {
    expect(errorsOf(sealed('cc2')).length).toBeGreaterThan(0);
  });

  it('opens it in the reach walk when the map holds a key of the colour', () => {
    expect(errorsOf(sealed('cc2', { '4,2': 'key_green' }))).toEqual([]);
  });
});
