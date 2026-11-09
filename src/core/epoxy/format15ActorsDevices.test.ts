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
 * Format 15 actors and devices: the CC2 pop-up wall, the open trap, the CC3D appearing wall that monsters reveal, the CC3D
 * slime that boots spare, and the CC2 powered teleporter and transmogrifier, checked against Lexy's Labyrinth (tiletypes.js)
 * and the CC3D evidence harness.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { signalSinkOf } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, SignalLink, TrapLink } from '../types';
import { canMonsterEnter, resolveMonsterArrival } from './epoxyMonsters';
import { leaveCell } from './epoxyWorld';
import type { EpoxyContext } from './epoxyWorld';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const TILE_X = 4;
const MAX_TICKS = 120;
const MAX_WAIT_TICKS = 40;
const FAR_CORNER = { x: 9, y: 9 };
const POPUP = 'popup_wall_cc2';
const TRAP_OPEN = 'trap_open';
const TRAP = 'trap';
const TRAP_WIRED = 'trap_wired';
const BUTTON = 'button_brown';
const PLATE = 'signal_plate';
const APPEARING_ANY = 'appearing_wall_any';
const SLIME_3D = 'slime_3d';
const TELEPORT_ON = 'teleport_red_cc2';
const TELEPORT_OFF = 'teleport_red_cc2_off';
const TRANSMOG_ON = 'transmogrifier_cc2';
const TRANSMOG_OFF = 'transmogrifier_cc2_off';
const BOOTS_FIRE = 'boots_fire';
const BOOTS_WATER = 'boots_water';

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: Cell;
  signalLinks?: SignalLink[];
  trapLinks?: TrapLink[];
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'format15_actors_devices_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? FAR_CORNER), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: setup.trapLinks ?? [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks })
  };
}

/** A one-cell-wide lane along the row, so a monster can only go forward or back. */
function lane(setup: Setup = {}): CompiledLevel {
  const level = room(setup);
  for (let y = 1; y < SIZE - 1; y++) {
    if (y === ROW) continue;
    for (let x = 1; x < SIZE - 1; x++) level.terrain[y][x] = 'wall';
  }
  for (const [x, y, id] of setup.terrain ?? []) level.terrain[y][x] = id;
  return level;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function placed(type: string, x: number, y: number, dir: Direction = 'E'): EntityPlacement {
  return { type, x, y, dir };
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function terrainAt(engine: GameEngine, x: number, y: number): string {
  return engine.getTerrain()[y][x];
}

function tickFor(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.tick();
}

function giveBoots(engine: GameEngine, ...boots: string[]): void {
  for (const id of boots) contextOf(engine).world.player.boots.add(id);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('popup_wall_cc2: who enters', () => {
  it('lets a rover walk in', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('rover', TILE_X - 1, ROW)] }));
    tickFor(engine, MAX_TICKS);
    expect(engine.getEntities().find((e) => e.kind === 'monster')!.x).toBeGreaterThanOrEqual(TILE_X);
  });

  it.each([
    ['rover', true],
    ['ghost', true],
    ['walker', false],
    ['bug', false],
    ['fireball', false],
    ['blob', false]
  ])('answers a probe of a %s with %s', (type, enters) => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed(type, TILE_X - 1, ROW)] }));
    const world = contextOf(engine).world;
    expect(canMonsterEnter(world, world.entities[0], 'E')).toBe(enters);
  });

  it.each(['walker', 'bug', 'glider'])('keeps a %s off', (type) => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed(type, TILE_X - 1, ROW)] }));
    tickFor(engine, MAX_TICKS);
    expect(engine.getEntities().find((e) => e.kind === 'monster')!.x, type).toBeLessThan(TILE_X);
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
  });

  it('lets the player in', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], player: { x: TILE_X - 1, y: ROW } }));
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: TILE_X, y: ROW });
  });
});

describe('popup_wall_cc2: what it becomes when left', () => {
  it('turns into a wall behind the player who leaves it', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], player: { x: TILE_X, y: ROW } }));
    expect(step(engine, 'E')).toBe(true);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
  });

  it('turns into a wall behind a rover that leaves it', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('rover', TILE_X - 1, ROW)] }));
    for (let i = 0; i < MAX_TICKS; i++) {
      engine.tick();
      const monster = engine.getEntities().find((e) => e.kind === 'monster');
      if (monster !== undefined && monster.x > TILE_X) break;
    }
    expect(engine.getEntities().find((e) => e.kind === 'monster')!.x).toBeGreaterThan(TILE_X);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
  });

  it('turns into a wall behind a block pushed off it', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('dirt_block', TILE_X, ROW)], player: { x: TILE_X - 1, y: ROW } })
    );
    // The block leaves, the cell becomes a wall, and the player's step into it is refused (the push re-check).
    expect(step(engine, 'E')).toBe(false);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
    expect(engine.getEntities()[0].x).toBeGreaterThan(TILE_X);
    expect(engine.getPlayer().x).toBe(TILE_X - 1);
  });

  it('turns into a wall behind a player who stands on it and pushes a block away', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('dirt_block', TILE_X + 1, ROW)], player: { x: TILE_X, y: ROW } })
    );
    expect(step(engine, 'E')).toBe(true);
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
    expect(engine.getPlayer().x).toBe(TILE_X + 1);
  });

  it('holds while a block stands on the cell, whoever leaves it', () => {
    const engine = load(
      room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('rover', TILE_X, ROW), placed('ice_block', TILE_X, ROW)] })
    );
    const world = contextOf(engine).world;
    const rover = world.entities[0];
    leaveCell(world, TILE_X, ROW, { leaver: rover });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
    world.entities.splice(1, 1);
    leaveCell(world, TILE_X, ROW, { leaver: rover });
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
  });

  it('is not popped by a ghost that leaves it (Lexy), though a ghost standing on it still holds it', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('ghost', TILE_X, ROW)] }));
    const world = contextOf(engine).world;
    leaveCell(world, TILE_X, ROW, { leaver: world.entities[0] });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
    world.entities.push({ ...world.entities[0], uid: 999, type: 'rover' });
    world.entities[0].type = 'ghost';
    leaveCell(world, TILE_X, ROW, { leavingPlayer: world.player });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
  });

  it('holds while the player stands on the cell and a monster or a block leaves it', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('rover', TILE_X, ROW)], player: { x: TILE_X, y: ROW } }));
    const world = contextOf(engine).world;
    leaveCell(world, TILE_X, ROW, { leaver: world.entities[0] });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
  });

  it('holds while a block or a monster stays and the player leaves', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], entities: [placed('ice_block', TILE_X, ROW)], player: { x: TILE_X, y: ROW } }));
    const world = contextOf(engine).world;
    leaveCell(world, TILE_X, ROW, { leavingPlayer: world.player });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
    world.entities.length = 0;
    leaveCell(world, TILE_X, ROW, { leavingPlayer: world.player });
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
  });

  it('holds while a parked player stays and the controlled one leaves', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, POPUP]], player: { x: TILE_X, y: ROW } }));
    const world = contextOf(engine).world;
    world.parked.push({ ...world.player, boots: new Set(), keys: {} });
    leaveCell(world, TILE_X, ROW, { leavingPlayer: world.player });
    expect(terrainAt(engine, TILE_X, ROW)).toBe(POPUP);
  });

  it('keeps the CC2 turtle behaviour: a player who stays does not hold it for the player who leaves', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, 'turtle_cc2']], player: { x: TILE_X, y: ROW } }));
    expect(step(engine, 'E')).toBe(true);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('water');
  });
});

describe('trap_open: closes on the first release of a linked brown button', () => {
  const BUTTON_CELL: Cell = { x: 3, y: ROW };
  const TRAP_CELL: Cell = { x: 7, y: ROW };
  const linked = (extra: Setup = {}): CompiledLevel =>
    room({
      terrain: [
        [BUTTON_CELL.x, BUTTON_CELL.y, BUTTON],
        [TRAP_CELL.x, TRAP_CELL.y, TRAP_OPEN]
      ],
      trapLinks: [{ buttonX: BUTTON_CELL.x, buttonY: BUTTON_CELL.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y }],
      player: { x: PLAYER_X, y: ROW },
      ...extra
    });

  it('plays as an open trap: nothing is held, whatever the button does', () => {
    const engine = load(linked());
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
  });

  it('lets a walker cross while it is open', () => {
    const level = linked({ entities: [placed('walker', TRAP_CELL.x - 1, ROW)] });
    const engine = load(level);
    tickFor(engine, MAX_TICKS);
    expect(engine.getEntities().find((e) => e.kind === 'monster')).toBeDefined();
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
  });

  it('becomes a closed trap when the player steps off the button', () => {
    const engine = load(linked());
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
  });

  it('does not close while another actor still presses the button', () => {
    const engine = load(linked({ entities: [placed('dirt_block', BUTTON_CELL.x, BUTTON_CELL.y)], player: BUTTON_CELL }));
    const world = contextOf(engine).world;
    leaveCell(world, BUTTON_CELL.x, BUTTON_CELL.y, { leavingPlayer: world.player });
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    world.entities.length = 0;
    leaveCell(world, BUTTON_CELL.x, BUTTON_CELL.y, { leavingPlayer: world.player });
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP);
  });

  it('is not closed by a monster that never worked the button, and is by one that did', () => {
    for (const [type, closes] of [
      ['wisp', false],
      ['pink_ball', true]
    ] as const) {
      const engine = load(linked({ entities: [placed(type, BUTTON_CELL.x, BUTTON_CELL.y)] }));
      const world = contextOf(engine).world;
      leaveCell(world, BUTTON_CELL.x, BUTTON_CELL.y, { leaver: world.entities[0] });
      expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y), type).toBe(closes ? TRAP : TRAP_OPEN);
    }
  });

  it('closes into a trap that stays open while the other linked button is held', () => {
    const other: Cell = { x: 3, y: 7 };
    const engine = load(
      linked({
        terrain: [
          [BUTTON_CELL.x, BUTTON_CELL.y, BUTTON],
          [other.x, other.y, BUTTON],
          [TRAP_CELL.x, TRAP_CELL.y, TRAP_OPEN]
        ],
        trapLinks: [
          { buttonX: BUTTON_CELL.x, buttonY: BUTTON_CELL.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y },
          { buttonX: other.x, buttonY: other.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y }
        ],
        entities: [placed('dirt_block', other.x, other.y)],
        player: BUTTON_CELL
      })
    );
    const world = contextOf(engine).world;
    leaveCell(world, BUTTON_CELL.x, BUTTON_CELL.y, { leavingPlayer: world.player });
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    world.entities.length = 0;
    world.player.x = FAR_CORNER.x;
    world.player.y = FAR_CORNER.y;
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
  });

  it('closes when a block slides off the button', () => {
    const engine = load(
      linked({ entities: [placed('ice_block', BUTTON_CELL.x, BUTTON_CELL.y)], player: { x: BUTTON_CELL.x - 1, y: ROW } })
    );
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    step(engine, 'E');
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP);
  });

  it('holds an actor that stands on it at that moment', () => {
    const engine = load(linked({ entities: [placed('walker', TRAP_CELL.x, TRAP_CELL.y)] }));
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
    const walker = engine.getEntities().find((e) => e.kind === 'monster')!;
    tickFor(engine, MAX_TICKS);
    expect(engine.getEntities().find((e) => e.uid === walker.uid)).toMatchObject({ x: TRAP_CELL.x, y: TRAP_CELL.y });
  });

  it('opens the closed trap again while the button is pressed, as a trap does', () => {
    const engine = load(linked());
    step(engine, 'E');
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP);
    step(engine, 'W');
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
  });
});

describe('trap_open: closes on the first fall of its wire input', () => {
  const PLATE_CELL: Cell = { x: 3, y: ROW };
  const TRAP_CELL: Cell = { x: 7, y: ROW };
  const wired = (): CompiledLevel =>
    room({
      terrain: [
        [PLATE_CELL.x, PLATE_CELL.y, PLATE],
        [TRAP_CELL.x, TRAP_CELL.y, TRAP_OPEN]
      ],
      signalLinks: [{ fromX: PLATE_CELL.x, fromY: PLATE_CELL.y, toX: TRAP_CELL.x, toY: TRAP_CELL.y }],
      player: { x: PLAYER_X, y: ROW }
    });

  it('stays open through the rise and closes into a wired trap on the fall', () => {
    const engine = load(wired());
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_WIRED);
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
  });

  it('then keeps answering the wire: open while the input is on', () => {
    const engine = load(wired());
    step(engine, 'E');
    step(engine, 'E');
    step(engine, 'W');
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(false);
    step(engine, 'W');
    expect(engine.isCellClosedTrap(TRAP_CELL.x, TRAP_CELL.y)).toBe(true);
  });

  it('is not closed by the plate that nothing presses', () => {
    const engine = load(wired());
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_OPEN);
  });

  it('closes into a wired trap on a release of the button too, when a wire ends on it', () => {
    const BUTTON_CELL: Cell = { x: 3, y: 7 };
    const engine = load(
      room({
        terrain: [
          [PLATE_CELL.x, PLATE_CELL.y, PLATE],
          [BUTTON_CELL.x, BUTTON_CELL.y, BUTTON],
          [TRAP_CELL.x, TRAP_CELL.y, TRAP_OPEN]
        ],
        signalLinks: [{ fromX: PLATE_CELL.x, fromY: PLATE_CELL.y, toX: TRAP_CELL.x, toY: TRAP_CELL.y }],
        trapLinks: [{ buttonX: BUTTON_CELL.x, buttonY: BUTTON_CELL.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y }],
        player: { x: BUTTON_CELL.x, y: BUTTON_CELL.y }
      })
    );
    step(engine, 'E');
    expect(terrainAt(engine, TRAP_CELL.x, TRAP_CELL.y)).toBe(TRAP_WIRED);
  });
});

describe('appearing_wall_any: monsters reveal it', () => {
  it('turns into a wall when a monster that walks into it tries to enter, and the monster stays', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, APPEARING_ANY]], entities: [placed('walker', TILE_X - 1, ROW)] }));
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
    expect(engine.getEntities().find((e) => e.kind === 'monster')!.x).toBeLessThan(TILE_X);
  });

  it('is revealed by the player as the plain appearing wall is', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, APPEARING_ANY]], player: { x: TILE_X - 1, y: ROW } }));
    expect(step(engine, 'E')).toBe(false);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('wall');
  });

  it('is not revealed by a probe: asking whether a monster may enter changes nothing and says no', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, APPEARING_ANY]], entities: [placed('walker', TILE_X - 1, ROW)] }));
    const world = contextOf(engine).world;
    expect(canMonsterEnter(world, world.entities[0], 'E')).toBe(false);
    expect(terrainAt(engine, TILE_X, ROW)).toBe(APPEARING_ANY);
  });

  it('is not revealed by a monster that goes another way', () => {
    // A pink ball bounces: forward is the wall only when it faces it. Facing away, it never touches the wall.
    const engine = load(
      lane({ terrain: [[TILE_X, ROW, APPEARING_ANY]], entities: [placed('pink_ball', TILE_X - 2, ROW, 'W')] })
    );
    tickFor(engine, 3);
    expect(terrainAt(engine, TILE_X, ROW)).toBe(APPEARING_ANY);
  });

  it('leaves the plain appearing wall to the player alone', () => {
    const engine = load(lane({ terrain: [[TILE_X, ROW, 'appearing_wall']], entities: [placed('walker', TILE_X - 1, ROW)] }));
    tickFor(engine, MAX_TICKS);
    expect(terrainAt(engine, TILE_X, ROW)).toBe('appearing_wall');
  });
});

describe('slime_3d: boots spare the player', () => {
  const onSlime = (boots: string[]): GameEngine => {
    const engine = load(room({ terrain: [[TILE_X, ROW, SLIME_3D]], player: { x: TILE_X - 1, y: ROW } }));
    giveBoots(engine, ...boots);
    return engine;
  };

  it('lets a player with every listed boot survive, and cleans the cell', () => {
    const engine = onSlime([BOOTS_FIRE, BOOTS_WATER]);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ alive: true, x: TILE_X, y: ROW });
    expect(terrainAt(engine, TILE_X, ROW)).toBe('floor');
  });

  it.each([[[BOOTS_FIRE]], [[BOOTS_WATER]], [[]]])('kills a player holding %j', (boots) => {
    const engine = onSlime(boots);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
    expect(terrainAt(engine, TILE_X, ROW)).toBe(SLIME_3D);
  });

  it('keeps the classic slime deadly to a player with both boots', () => {
    const engine = load(room({ terrain: [[TILE_X, ROW, 'slime']], player: { x: TILE_X - 1, y: ROW } }));
    giveBoots(engine, BOOTS_FIRE, BOOTS_WATER);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('treats a monster as the slime does: a bug dies, a blob lives, the cell stays', () => {
    for (const [type, survives] of [
      ['bug', false],
      ['blob', true]
    ] as const) {
      const engine = load(room({ terrain: [[TILE_X, ROW, SLIME_3D]], entities: [placed(type, TILE_X, ROW)] }));
      resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
      expect(engine.getEntities().length === 1, type).toBe(survives);
      expect(terrainAt(engine, TILE_X, ROW), type).toBe(SLIME_3D);
    }
  });
});

describe('powered twins: teleporter', () => {
  const PLATE_CELL: Cell = { x: 3, y: ROW };
  const PAD_A: Cell = { x: 6, y: 3 };
  const PAD_B: Cell = { x: 6, y: 7 };

  const tiles = (a: string, b: string): Array<[number, number, string]> => [
    [PLATE_CELL.x, PLATE_CELL.y, PLATE],
    [PAD_A.x, PAD_A.y, a],
    [PAD_B.x, PAD_B.y, b]
  ];
  const links = (...pads: Cell[]): SignalLink[] =>
    pads.map((pad) => ({ fromX: PLATE_CELL.x, fromY: PLATE_CELL.y, toX: pad.x, toY: pad.y }));

  it('is a powers sink in both forms, for the pair', () => {
    for (const id of [TELEPORT_ON, TELEPORT_OFF, TRANSMOG_ON, TRANSMOG_OFF]) {
      expect(signalSinkOf(ConfigRegistry.getTile(id)), id).toEqual({ powers: true });
      expect(signalSinkOf(ConfigRegistry.getTile(id), { hidden: true }), id).toBeNull();
    }
  });

  it('takes the form of its input at load, whatever was placed', () => {
    const off = load(room({ terrain: tiles(TELEPORT_ON, TELEPORT_ON), signalLinks: links(PAD_A, PAD_B), player: { x: PLAYER_X, y: ROW } }));
    expect(terrainAt(off, PAD_A.x, PAD_A.y)).toBe(TELEPORT_OFF);
    expect(terrainAt(off, PAD_B.x, PAD_B.y)).toBe(TELEPORT_OFF);
    const on = load(room({ terrain: tiles(TELEPORT_OFF, TELEPORT_OFF), signalLinks: links(PAD_A, PAD_B), player: PLATE_CELL }));
    expect(terrainAt(on, PAD_A.x, PAD_A.y)).toBe(TELEPORT_ON);
    expect(terrainAt(on, PAD_B.x, PAD_B.y)).toBe(TELEPORT_ON);
  });

  it('keeps the placed form when no wire ends on it', () => {
    const engine = load(room({ terrain: tiles(TELEPORT_OFF, TELEPORT_ON), signalLinks: links(PAD_B), player: { x: PLAYER_X, y: ROW } }));
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_OFF);
    step(engine, 'E');
    tickFor(engine, 3);
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_OFF);
    expect(terrainAt(engine, PAD_B.x, PAD_B.y)).toBe(TELEPORT_ON);
  });

  it('shows the on form while the input is on and the off form while it is off', () => {
    const engine = load(room({ terrain: tiles(TELEPORT_OFF, TELEPORT_ON), signalLinks: links(PAD_A, PAD_B), player: { x: PLAYER_X, y: ROW } }));
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_OFF);
    step(engine, 'E');
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_ON);
    expect(terrainAt(engine, PAD_B.x, PAD_B.y)).toBe(TELEPORT_ON);
    step(engine, 'E');
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_OFF);
    expect(terrainAt(engine, PAD_B.x, PAD_B.y)).toBe(TELEPORT_OFF);
  });

  it('sends the player back out of an off pad forward', () => {
    const engine = load(
      room({
        terrain: [[PAD_A.x, PAD_A.y, TELEPORT_OFF], [PAD_B.x, PAD_B.y, TELEPORT_ON]],
        player: { x: PAD_A.x - 1, y: PAD_A.y }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: PAD_A.x + 1, y: PAD_A.y });
  });

  it('is not a destination while off: a lone live pad and an off pad send nowhere else', () => {
    const engine = load(
      room({
        terrain: [[PAD_A.x, PAD_A.y, TELEPORT_OFF], [PAD_B.x, PAD_B.y, TELEPORT_ON]],
        player: { x: PAD_B.x - 1, y: PAD_B.y }
      })
    );
    expect(step(engine, 'E')).toBe(true);
    // A lone live pad leaves the player forward of itself; the off pad is never the landing.
    expect(engine.getPlayer()).toMatchObject({ x: PAD_B.x + 1, y: PAD_B.y });
  });

  it('becomes a destination when it powers on, in reading order', () => {
    const engine = load(
      room({
        terrain: [
          [PLATE_CELL.x, PLATE_CELL.y, PLATE],
          [PAD_A.x, PAD_A.y, TELEPORT_OFF],
          [PAD_B.x, PAD_B.y, TELEPORT_ON]
        ],
        signalLinks: links(PAD_A),
        player: { x: PLAYER_X, y: ROW }
      })
    );
    step(engine, 'E');
    expect(terrainAt(engine, PAD_A.x, PAD_A.y)).toBe(TELEPORT_ON);
    // Walk from the plate to the second pad: the powered first pad is now the other end of the ring.
    const world = contextOf(engine).world;
    world.player.x = PAD_B.x - 1;
    world.player.y = PAD_B.y;
    world.player.moveCooldown = 0;
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: PAD_A.x + 1, y: PAD_A.y });
  });
});

describe('powered twins: transmogrifier', () => {
  const PLATE_CELL: Cell = { x: 3, y: ROW };
  const DEVICE: Cell = { x: 7, y: ROW };

  it('changes a monster that arrives only while powered', () => {
    for (const [placedForm, powered] of [
      [TRANSMOG_ON, true],
      [TRANSMOG_OFF, false]
    ] as const) {
      const engine = load(
        room({
          terrain: [[PLATE_CELL.x, PLATE_CELL.y, PLATE], [DEVICE.x, DEVICE.y, placedForm]],
          signalLinks: [{ fromX: PLATE_CELL.x, fromY: PLATE_CELL.y, toX: DEVICE.x, toY: DEVICE.y }],
          player: powered ? PLATE_CELL : { x: PLAYER_X, y: ROW },
          entities: [placed('bug', DEVICE.x, DEVICE.y)]
        })
      );
      resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
      expect(terrainAt(engine, DEVICE.x, DEVICE.y)).toBe(powered ? TRANSMOG_ON : TRANSMOG_OFF);
      expect(engine.getEntities()[0].type === 'bug', placedForm).toBe(!powered);
    }
  });

  it('keeps an unwired off form off for ever', () => {
    const engine = load(room({ terrain: [[DEVICE.x, DEVICE.y, TRANSMOG_OFF]], entities: [placed('bug', DEVICE.x, DEVICE.y)] }));
    resolveMonsterArrival(contextOf(engine), engine.getEntities()[0], false);
    expect(engine.getEntities()[0].type).toBe('bug');
    expect(terrainAt(engine, DEVICE.x, DEVICE.y)).toBe(TRANSMOG_OFF);
  });
});
