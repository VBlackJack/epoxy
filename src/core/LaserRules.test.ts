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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelMetrics, MECHANICS } from './LevelMetrics';
import { LevelValidator } from './LevelValidator';
import { BeamCell, CompiledLevel, Direction, EntityPlacement, WinRule } from './types';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  '~': 'water',
  '>': 'laser_emitter_e',
  '<': 'laser_emitter_w',
  '^': 'laser_emitter_n',
  v: 'laser_emitter_s',
  R: 'laser_receiver_red',
  L: 'laser_receiver_blue',
  g: 'laser_gate_red_closed',
  G: 'laser_gate_red_open',
  b: 'laser_gate_blue_closed',
  h: 'laser_gate_blue_open',
  '1': 'force_n',
  '2': 'force_e',
  t: 'thin_wall_e',
  u: 'thin_wall_w',
  T: 'teleport',
  E: 'exit',
  // An open red gate that also holds the player, or a dirt block.
  p: 'laser_gate_red_open',
  q: 'laser_gate_red_open',
  i: 'ice',
  F: 'fire',
  C: 'clone_machine',
  B: 'button_red',
  n: 'ice_nw'
};
const ENTITY_CODES: Record<string, string> = {
  '/': 'mirror_slash',
  '\\': 'mirror_backslash',
  $: 'dirt_block',
  '@': 'bug',
  q: 'dirt_block'
};
/** Ticks run before each move so the player's move cooldown has elapsed. */
const COOLDOWN_TICKS = 8;
/** Upper bound of ticks a mirror needs to slide down a short ice lane, bounce off the end and come back. */
const BOUNCE_TICKS = 200;
/** Upper bound of ticks a slide needs to settle in these small rooms. */
const SETTLE_TICKS = 40;

/**
 * Builds a level from rows. Terrain: # wall, . floor, P player, ~ water,
 * > < ^ v emitters (east, west, north, south), R L red and blue receivers,
 * g G red gate (closed, open), b h blue gate (closed, open), 1 2 force floors
 * (north, east), t u thin walls (east edge, west edge), T teleporter, E exit,
 * p player on an open red gate, q dirt block on an open red gate, i ice, n ice corner (nw), F fire,
 * C clone machine, B red button.
 * Entities: / \ mirrors, $ dirt block, @ bug.
 */
function room(rows: string[], winRule?: WinRule): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P' || ch === 'p') start = { x, y };
      const entityType = ENTITY_CODES[ch];
      if (entityType) entities.push({ type: entityType, x, y, dir: 'S' });
      return TERRAIN_CODES[ch] ?? 'floor';
    })
  );
  return {
    id: 'laser_room',
    ...(winRule ? { winRule } : {}),
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function engineFor(rows: string[], winRule?: WinRule): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(rows, winRule));
  return engine;
}

function move(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

function ticks(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** Beam cells as sorted "x,y,axes" strings, h for horizontal and v for vertical. */
function beam(engine: GameEngine): string[] {
  return engine
    .getBeamCells()
    .map((c) => `${c.x},${c.y},${c.horizontal ? 'h' : ''}${c.vertical ? 'v' : ''}`)
    .sort();
}

function cellsOf(engine: GameEngine): string[] {
  return engine.getBeamCells().map((c) => `${c.x},${c.y}`).sort();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('laser tiles and mirrors in the configuration', () => {
  it('gives every emitter its direction and keeps emitters, receivers and closed gates opaque', () => {
    const directions: Record<string, Direction> = {
      laser_emitter_n: 'N',
      laser_emitter_e: 'E',
      laser_emitter_s: 'S',
      laser_emitter_w: 'W'
    };
    for (const [id, dir] of Object.entries(directions)) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.laserEmitter, id).toBe(dir);
      expect(tile.laserTransparent, id).toBe(false);
      expect(tile.passableByPlayer, id).toBe(false);
    }
    for (const id of ['laser_receiver_red', 'laser_receiver_blue', 'laser_gate_red_closed', 'laser_gate_blue_closed']) {
      expect(ConfigRegistry.getTile(id).laserTransparent, id).toBe(false);
      expect(ConfigRegistry.getTile(id).passableByPlayer, id).toBe(false);
    }
    for (const id of ['laser_gate_red_open', 'laser_gate_blue_open']) {
      expect(ConfigRegistry.getTile(id).laserTransparent, id).toBe(true);
      expect(ConfigRegistry.getTile(id).passableByPlayer, id).toBe(true);
    }
  });

  it('declares two pushable block mirrors that refuse water and survive fire', () => {
    for (const id of ['mirror_slash', 'mirror_backslash']) {
      const def = ConfigRegistry.getEntityDef(id);
      expect(def?.kind, id).toBe('block');
      expect(def?.pushable, id).toBe(true);
      expect(def?.slidesOnIce, id).toBe(true);
      expect(def?.slidesOnForce, id).toBe(true);
      expect(def?.refusesHazards, id).toEqual(['water']);
      expect(def?.destroyedByFire, id).toBe(false);
      expect(def?.destroyedByBomb, id).toBe(true);
    }
    expect(ConfigRegistry.getEntityDef('mirror_slash')?.mirrorAxis).toBe('slash');
    expect(ConfigRegistry.getEntityDef('mirror_backslash')?.mirrorAxis).toBe('backslash');
  });
});

describe('beam tracing', () => {
  it('runs straight from the emitter and stops before a wall', () => {
    const engine = engineFor(['#######', '#>...##', '#P....#', '#######']);
    expect(beam(engine)).toEqual(['2,1,h', '3,1,h', '4,1,h']);
  });

  it('is empty on a level without emitters', () => {
    const engine = engineFor(['#####', '#P..#', '#####']);
    expect(engine.getBeamCells()).toEqual([]);
  });

  // A '/' mirror turns an east-moving beam to the north and a backslash mirror
  // turns it to the south. Both are double-sided: the table gives the outgoing
  // direction for the four incoming ones.
  const OUTGOING: Record<'/' | '\\', Record<Direction, Direction>> = {
    '/': { E: 'N', W: 'S', S: 'W', N: 'E' },
    '\\': { E: 'S', W: 'N', S: 'E', N: 'W' }
  };
  const EMITTER_FOR_INCOMING: Record<Direction, { x: number; y: number; code: string }> = {
    E: { x: 1, y: 3, code: '>' },
    W: { x: 5, y: 3, code: '<' },
    S: { x: 3, y: 1, code: 'v' },
    N: { x: 3, y: 5, code: '^' }
  };
  const STEP: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 },
    S: { dx: 0, dy: 1 },
    E: { dx: 1, dy: 0 },
    W: { dx: -1, dy: 0 }
  };

  for (const mirror of ['/', '\\'] as const) {
    for (const incoming of ['E', 'W', 'S', 'N'] as const) {
      it(`reflects a ${incoming}-moving beam off a ${mirror} mirror to the ${OUTGOING[mirror][incoming]}`, () => {
        const grid: string[][] = Array.from({ length: 7 }, (_, y) =>
          Array.from({ length: 7 }, (_, x) => (x === 0 || y === 0 || x === 6 || y === 6 ? '#' : '.'))
        );
        grid[1][5] = 'P';
        grid[3][3] = mirror;
        const emitter = EMITTER_FOR_INCOMING[incoming];
        grid[emitter.y][emitter.x] = emitter.code;
        const engine = engineFor(grid.map((row) => row.join('')));

        const cells = new Map(engine.getBeamCells().map((c) => [`${c.x},${c.y}`, c] as const));
        const hit = cells.get('3,3');
        expect(hit, 'mirror cell').toBeDefined();
        expect(hit?.horizontal).toBe(true);
        expect(hit?.vertical).toBe(true);

        const out = OUTGOING[mirror][incoming];
        const outCell = cells.get(`${3 + STEP[out].dx},${3 + STEP[out].dy}`);
        expect(outCell, 'cell after the mirror').toBeDefined();
        expect(outCell?.horizontal).toBe(out === 'E' || out === 'W');
        expect(outCell?.vertical).toBe(out === 'N' || out === 'S');
        // Nothing leaves on the side the beam would take with the other mirror.
        const wrongOut = OUTGOING[mirror === '/' ? '\\' : '/'][incoming];
        expect(cells.has(`${3 + STEP[wrongOut].dx},${3 + STEP[wrongOut].dy}`)).toBe(false);
      });
    }
  }

  it('is stopped by a thin wall on the edge it crosses, leaving a cell and entering one', () => {
    // thin_wall_e blocks leaving cell 3 to the east; thin_wall_w blocks entering cell 3 from the west.
    expect(cellsOf(engineFor(['#######', '#>.t..#', '#P....#', '#######']))).toEqual(['2,1', '3,1']);
    expect(cellsOf(engineFor(['#######', '#>.u..#', '#P....#', '#######']))).toEqual(['2,1']);
  });

  it('is stopped by a block that is not a mirror and by a closed gate, and passes an open gate', () => {
    expect(cellsOf(engineFor(['#######', '#>.$..#', '#P....#', '#######']))).toEqual(['2,1']);
    expect(cellsOf(engineFor(['#######', '#>.g..#', '#P....#', '#######']))).toEqual(['2,1']);
    expect(cellsOf(engineFor(['#######', '#>.G..#', '#P....#', '#######']))).toEqual(['2,1', '3,1', '4,1', '5,1']);
  });

  it('does not teleport at a teleporter and does not stop for a monster', () => {
    const engine = engineFor(['#######', '#>.T.@#', '#PT...#', '#######']);
    expect(cellsOf(engine)).toEqual(['2,1', '3,1', '4,1', '5,1']);
  });

  it('follows a closed ring of four mirrors back to the emitter in a bounded trace', () => {
    // Emitter (1,1) east; a backslash at (4,1) turns it south, a slash at (4,4) west, a backslash at (1,4) north, up to the emitter.
    const engine = engineFor(['######', '#>..\\#', '#.P..#', '#....#', '#\\../#', '######']);
    expect(cellsOf(engine)).toEqual(
      ['2,1', '3,1', '4,1', '4,2', '4,3', '4,4', '3,4', '2,4', '1,4', '1,3', '1,2'].sort()
    );
  });
});

describe('lethality of the beam', () => {
  const corridor = ['#######', '#>....#', '#.....#', '#..P..#', '#######'];

  it('kills a player who walks into the beam, with the laser reason', () => {
    const engine = engineFor(corridor);
    expect(move(engine, 'N')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(move(engine, 'N')).toBe(true);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
  });

  it('kills a standing player a tick after a sliding mirror redirects the beam onto them', () => {
    // The mirror is pushed onto the force floors, slides north into the beam row, and its backslash turns the beam south.
    const engine = engineFor([
      '#########',
      '#>..1...#',
      '#...1...#',
      '#...1...#',
      '#...\\...#',
      '#...P...#',
      '#########'
    ]);
    expect(move(engine, 'N')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
  });

  it('kills a monster on a beam cell', () => {
    const engine = engineFor(['#######', '#>.@..#', '#P....#', '#######']);
    expect(engine.getEntities()).toHaveLength(1);
    engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getPlayer().alive).toBe(true);
  });
});

describe('receivers and gates', () => {
  it('opens a gate while its receiver is lit and closes it when the beam is cut', () => {
    const engine = engineFor(['#########', '#>.....R#', '#...$...#', '#...P.g.#', '#########']);
    expect(engine.getTerrain()[3][6]).toBe('laser_gate_red_closed');
    engine.tick();
    expect(engine.getTerrain()[3][6]).toBe('laser_gate_red_open');
    expect(engine.getLitReceivers()).toEqual([{ x: 7, y: 1 }]);

    // Pushing the block north puts it in the beam.
    expect(move(engine, 'N')).toBe(true);
    expect(engine.getTerrain()[3][6]).toBe('laser_gate_red_closed');
    expect(engine.getLitReceivers()).toEqual([]);
  });

  it('only lets a receiver drive the gates of its own group', () => {
    const engine = engineFor(['#########', '#>....L.#', '#.......#', '#P.g.b..#', '#########']);
    engine.tick();
    expect(engine.getTerrain()[3][3]).toBe('laser_gate_red_closed');
    expect(engine.getTerrain()[3][5]).toBe('laser_gate_blue_open');
  });

  it('keeps a gate open while any receiver of its group is lit', () => {
    const engine = engineFor([
      '#########',
      '#>.....R#',
      '#.......#',
      '#>#...R.#',
      '#.......#',
      '#P.g....#',
      '#########'
    ]);
    engine.tick();
    expect(engine.getLitReceivers()).toEqual([{ x: 7, y: 1 }]);
    expect(engine.getTerrain()[5][3]).toBe('laser_gate_red_open');
  });

  it('does not close a gate on a cell the player occupies', () => {
    const engine = engineFor(['#######', '#>#p.R#', '#.....#', '#######']);
    ticks(engine, 5);
    expect(engine.getTerrain()[1][3]).toBe('laser_gate_red_open');
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[1][3]).toBe('laser_gate_red_closed');
  });

  it('does not close a gate on a cell an entity occupies', () => {
    const engine = engineFor(['#######', '#>#q.R#', '#P....#', '#######']);
    ticks(engine, 5);
    expect(engine.getTerrain()[1][3]).toBe('laser_gate_red_open');
  });

  it('keeps a closed gate that cuts its own beam closed, and an open one open', () => {
    const closed = engineFor(['#######', '#>.g.R#', '#P....#', '#######']);
    ticks(closed, 20);
    expect(closed.getTerrain()[1][3]).toBe('laser_gate_red_closed');
    expect(closed.getLitReceivers()).toEqual([]);

    const open = engineFor(['#######', '#>.G.R#', '#P....#', '#######']);
    ticks(open, 20);
    expect(open.getTerrain()[1][3]).toBe('laser_gate_red_open');
    expect(open.getLitReceivers()).toHaveLength(1);
  });

  it('plays a deterministic one-pass-lag sequence when two gates feed each other', () => {
    // Each receiver is lit only through the other group's gate: the pair swaps state every pass, forever, the same way each run.
    const rows = ['#########', '#>.h.R..#', '#.......#', '#>.g.L..#', '#.....P.#', '#########'];
    const run = (): string[] => {
      const engine = engineFor(rows);
      const states: string[] = [];
      for (let i = 0; i < 12; i++) {
        engine.tick();
        states.push(`${engine.getTerrain()[1][3]}|${engine.getTerrain()[3][3]}`);
      }
      return states;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first)).toEqual(new Set(['laser_gate_blue_closed|laser_gate_red_open', 'laser_gate_blue_open|laser_gate_red_closed']));
    for (let i = 2; i < first.length; i++) expect(first[i]).toBe(first[i - 2]);
  });
});

describe('receivers win rule', () => {
  it('completes once every receiver is lit', () => {
    const engine = engineFor(['#######', '#>...R#', '#P....#', '#######'], 'receivers');
    expect(engine.isLevelCompleted()).toBe(false);
    engine.tick();
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('needs every receiver lit, not just one', () => {
    const engine = engineFor(['#######', '#>...R#', '#>#..L#', '#P....#', '#######'], 'receivers');
    ticks(engine, 5);
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('waits for the mirrors on a lit path to come to rest', () => {
    // Pushed east onto the force floors, the backslash mirror sinks into the column of the emitter and lights the receiver while still sliding.
    const engine = engineFor(['########', '#...v..#', '#......#', '#P\\22R.#', '########'], 'receivers');
    expect(move(engine, 'E')).toBe(true);
    const mirror = engine.getEntities()[0];
    let litAt = -1;
    let completedAt = -1;
    for (let i = 0; i < SETTLE_TICKS; i++) {
      engine.tick();
      if (litAt < 0 && engine.getLitReceivers().length === 1) {
        litAt = i;
        expect(mirror.isSliding).toBe(true);
        expect(engine.isLevelCompleted()).toBe(false);
      }
      if (engine.isLevelCompleted()) {
        completedAt = i;
        break;
      }
    }
    expect(litAt).toBeGreaterThanOrEqual(0);
    expect(completedAt).toBeGreaterThan(litAt);
    expect(mirror.isSliding).toBe(false);
  });

  it('never completes for a player killed by the beam', () => {
    // The player starts on the beam that lights the receiver: the kill comes first.
    const engine = engineFor(['#######', '#>.P.R#', '#.....#', '#######'], 'receivers');
    engine.tick();
    expect(engine.getLitReceivers()).toHaveLength(1);
    expect(engine.getPlayer().alive).toBe(false);
    ticks(engine, 5);
    expect(engine.isLevelCompleted()).toBe(false);
  });
});

describe('mirror blocks', () => {
  it('refuses to be pushed into water', () => {
    const engine = engineFor(['#####', '#P/~#', '#####']);
    expect(move(engine, 'E')).toBe(false);
    expect(engine.getEntities()[0].x).toBe(2);
    expect(engine.getTerrain()[1][3]).toBe('water');
  });

  it('is pushed like any other block', () => {
    const engine = engineFor(['#####', '#P/.#', '#####']);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getEntities()[0].x).toBe(3);
  });
});

describe('mirror blocks and hazards', () => {
  it('is refused by water at a teleporter exit', () => {
    // The exit cell east of each pad is water: the mirror stays on the pad it was pushed onto.
    const engine = engineFor(['#P/T~.T~#']);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getEntities()[0].x).toBe(3);
    expect(engine.getTerrain()[0][4]).toBe('water');
    expect(engine.getTerrain()[0][7]).toBe('water');
  });

  it('is refused by water when a clone machine spawns it, and spawns on dry ground', () => {
    const cloneRoom = (spawn: string): GameEngine => {
      const level = room([`#PBC${spawn}#`]);
      level.cloneLinks = [{ buttonX: 2, buttonY: 0, clonerX: 3, clonerY: 0, templateType: 'mirror_slash', templateDir: 'E' }];
      const engine = new GameEngine();
      engine.loadLevel(level);
      return engine;
    };
    const wet = cloneRoom('~');
    expect(move(wet, 'E')).toBe(true);
    ticks(wet, SETTLE_TICKS);
    expect(wet.getEntities()).toHaveLength(0);
    expect(wet.getTerrain()[0][4]).toBe('water');

    const dry = cloneRoom('.');
    expect(move(dry, 'E')).toBe(true);
    ticks(dry, SETTLE_TICKS);
    expect(dry.getEntities()).toHaveLength(1);
    expect(dry.getEntities()[0].x).toBe(4);
  });

  it('is refused by water at the end of an ice slide and bounces back instead', () => {
    const engine = engineFor(['#P/iiii~#', '#.......#']);
    expect(move(engine, 'E')).toBe(true);
    // Step out of the lane so the mirror bouncing back cannot land on the player.
    expect(move(engine, 'S')).toBe(true);
    ticks(engine, BOUNCE_TICKS);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getTerrain()[0][7]).toBe('water');
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getEntities()[0].isSliding).toBe(false);
  });

  it('is refused by water at the end of a force-floor slide and stops before it', () => {
    const engine = engineFor(['#P/222~#', '#......#']);
    expect(move(engine, 'E')).toBe(true);
    ticks(engine, SETTLE_TICKS);
    expect(engine.getTerrain()[0][6]).toBe('water');
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getEntities()[0].x).toBe(5);
    expect(engine.getEntities()[0].isSliding).toBe(false);
  });

  it('is destroyed by a bomb', () => {
    const level = room(['#P/.#']);
    level.items[0][3] = 'bomb';
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(engine.getEntities()).toHaveLength(1);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getItems()[0][3]).toBeNull();
  });

  it('survives fire', () => {
    const engine = engineFor(['#P/F.#']);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getEntities()[0].x).toBe(3);
    expect(engine.getTerrain()[0][3]).toBe('fire');
  });
});

describe('ice corners', () => {
  // ice_nw is walled on its north and west edges: a beam stops at those walls and enters through the open east and south edges.
  it('stops a beam at a walled edge, before entering from it and when leaving through it', () => {
    expect(beam(engineFor(['#####', '#>n.#', '#P..#', '#####']))).toEqual([]);
    expect(beam(engineFor(['#####', '#.v.#', '#Pn.#', '#####']))).toEqual([]);
    expect(beam(engineFor(['#####', '#.n<#', '#P..#', '#####']))).toEqual(['2,1,h']);
    expect(beam(engineFor(['#####', '#.n.#', '#P^.#', '#####']))).toEqual(['2,1,v']);
  });

  it('lets a beam in through an open edge', () => {
    const entered = engineFor(['#####', '#.n<#', '#P..#', '#####']);
    expect(cellsOf(entered)).toContain('2,1');
  });
});

describe('beam cells and undo', () => {
  it('restores the beam with the state', () => {
    const engine = engineFor(['#########', '#>.....R#', '#...$...#', '#...P.g.#', '#########']);
    engine.tick();
    const before: BeamCell[] = engine.getBeamCells().map((c) => ({ ...c }));
    expect(before.length).toBeGreaterThan(0);

    expect(move(engine, 'N')).toBe(true);
    expect(engine.getBeamCells()).not.toEqual(before);

    expect(engine.undo()).toBe(true);
    expect(engine.getBeamCells()).toEqual(before);
    expect(engine.getTerrain()[3][6]).toBe('laser_gate_red_open');
  });

  it('reflects a mirror that slid into place in the tick the player died', () => {
    // The mirror is pushed onto ice, bounces off the emitter at the far end and comes back onto the player,
    // who dies in that same tick: the beam must follow the mirror to its last cell, not the one before.
    const engine = engineFor(['###########', '#P/iiiiii<#', '#.........#', '###########']);
    expect(move(engine, 'E')).toBe(true);
    for (let i = 0; i < BOUNCE_TICKS && engine.getPlayer().alive; i++) engine.tick();
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_block');
    expect(engine.getEntities()[0].x).toBe(2);
    expect(beam(engine)).toEqual(['2,1,hv', '2,2,v', '3,1,h', '4,1,h', '5,1,h', '6,1,h', '7,1,h', '8,1,h']);
  });

  it('is rebuilt when the level is reloaded', () => {
    const level = room(['#######', '#>...##', '#P....#', '#######']);
    const engine = new GameEngine();
    engine.loadLevel(level);
    const first = beam(engine);
    engine.loadLevel(room(['#####', '#P..#', '#####']));
    expect(engine.getBeamCells()).toEqual([]);
    engine.loadLevel(level);
    expect(beam(engine)).toEqual(first);
  });
});

describe('level validation and metrics', () => {
  it('asks a receivers level for an emitter and a receiver but not for an exit', () => {
    const missingBoth = LevelValidator.validate(room(['#####', '#P..#', '#####'], 'receivers'));
    const keys = missingBoth.issues.map((i) => i.i18nKey);
    expect(keys).toContain('validator.issues.no_emitter.label');
    expect(keys).toContain('validator.issues.no_receiver.label');
    expect(keys).not.toContain('validator.issues.no_exit.label');
    expect(missingBoth.valid).toBe(false);

    const complete = LevelValidator.validate(room(['#######', '#>...R#', '#P....#', '#######'], 'receivers'));
    expect(complete.issues).toEqual([]);
    expect(complete.valid).toBe(true);
  });

  it('warns when a receivers level holds an exit tile that would bypass the receivers', () => {
    const key = 'validator.issues.exit_on_receivers_level.label';
    const withExit = LevelValidator.validate(room(['#######', '#>...R#', '#P...E#', '#######'], 'receivers'));
    const warning = withExit.issues.find((i) => i.i18nKey === key);
    expect(warning?.severity).toBe('warning');
    expect(withExit.valid).toBe(true);
    const withoutExit = LevelValidator.validate(room(['#######', '#>...R#', '#P....#', '#######'], 'receivers'));
    expect(withoutExit.issues.map((i) => i.i18nKey)).not.toContain(key);
  });

  it('warns when a gate stands on a beam that lights its own group', () => {
    for (const gate of ['g', 'G']) {
      const report = LevelValidator.validate(room(['#######', `#>.${gate}.R#`, '#P....#', '#######'], 'receivers'));
      const warning = report.issues.find((i) => i.i18nKey === 'validator.issues.laser_gate_on_beam.label');
      expect(warning?.severity).toBe('warning');
      expect(warning?.params).toEqual({ group: 'red' });
    }
    // Cross-cut: each gate stands on the beam that lights the receiver of the other group.
    const cross = LevelValidator.validate(
      room(['#########', '#>.h.R..#', '#.......#', '#>.g.L..#', '#.....P.#', '#########'], 'receivers')
    );
    const crossGroups = cross.issues
      .filter((i) => i.i18nKey === 'validator.issues.laser_gate_on_beam.label')
      .map((i) => i.params?.group)
      .sort();
    expect(crossGroups).toEqual(['blue', 'red']);
    const clear = LevelValidator.validate(room(['#######', '#>...R#', '#Pg...#', '#######'], 'receivers'));
    expect(clear.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.laser_gate_on_beam.label');
  });

  it('counts lasers among the mechanics of a level', () => {
    expect(LevelMetrics.measure(room(['#######', '#>...R#', '#P....#', '#######'], 'receivers')).mechanics).toContain(
      MECHANICS.LASERS
    );
    expect(LevelMetrics.measure(room(['#####', '#P/.#', '#####'])).mechanics).toContain(MECHANICS.LASERS);
    expect(LevelMetrics.measure(room(['#####', '#P.E#', '#####'])).mechanics).not.toContain(MECHANICS.LASERS);
  });
});
