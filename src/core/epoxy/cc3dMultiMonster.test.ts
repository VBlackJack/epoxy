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
import type { CompiledLevel, EntityPlacement } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

/**
 * The rules several monsters share on a converted CC3D level: a monster's button press acts in that monster's own turn, a
 * monster that enters a bomb, water or fire stays in its cell for the whole step and is removed when the step ends, a
 * trap is recomputed once at the end of each tick and a monster works a brown button only at rest, and a clone machine lets
 * its template itself out and keeps a new template. Native levels and levels of the classic rules are unchanged.
 */

beforeEach(() => {
  loadTestConfigs();
});

type Flavor = 'native' | 'converted' | 'cc';

const FLOOR = 'floor';
const WALL = 'wall';
const ROW_Y = 1;
const RUN_TICKS = 60;
const STEP_TICKS = 4;

interface Layout {
  cells: string[];
  entities: EntityPlacement[];
  items?: Array<[number, string]>;
  trapLinks?: CompiledLevel['trapLinks'];
  cloneLinks?: CompiledLevel['cloneLinks'];
  /** The player starts in the corridor at this x instead of in the pocket. */
  playerX?: number;
}

/** One corridor row between walls, the player sealed in a pocket below it. */
function build(layout: Layout, flavor: Flavor): { engine: GameEngine; w: EpoxyWorld } {
  const row = [WALL, ...layout.cells, WALL];
  const wall = row.map(() => WALL);
  const pocket = row.map((_, x) => (x === 1 || x === 2 ? FLOOR : WALL));
  const terrain = [wall, row, wall, pocket, wall];
  const items = terrain.map((r) => r.map((): string | null => null));
  for (const [x, id] of layout.items ?? []) items[ROW_Y][x] = id;
  const level: CompiledLevel = {
    id: 'multi_monster',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: layout.playerX !== undefined ? { x: layout.playerX, y: ROW_Y, dir: 'W' } : { x: 1, y: 3, dir: 'E' },
    terrain,
    items,
    entities: layout.entities,
    trapLinks: layout.trapLinks ?? [],
    cloneLinks: layout.cloneLinks ?? []
  };
  const flavored = flavor === 'converted' ? ({ ...level, cc3dSource: {} } as unknown as CompiledLevel) : flavor === 'cc' ? { ...level, rulesFlavor: 'cc' as const } : level;
  const engine = new GameEngine();
  engine.loadLevel(flavored);
  return { engine, w: (engine as unknown as { w: EpoxyWorld }).w };
}

describe('a button press by a monster', () => {
  // x:  1       2                 3      4         5      6
  //     A       toggle(closed)    floor  button    floor  B
  const CELLS = [FLOOR, 'toggle_wall_closed', FLOOR, 'button_green', FLOOR, FLOOR, FLOOR];
  const A: EntityPlacement = { type: 'bouncer', x: 1, y: ROW_Y, dir: 'E' };
  const B: EntityPlacement = { type: 'bouncer', x: 7, y: ROW_Y, dir: 'W' };

  /** The tick the wall opened and the tick monster A (the one in the pocket) first left its cell. */
  function ticks(flavor: Flavor, entities: EntityPlacement[]): { flip: number; moved: number } {
    const { engine, w } = build({ cells: CELLS, entities }, flavor);
    let flip = -1;
    let moved = -1;
    for (let t = 1; t <= RUN_TICKS && (flip < 0 || moved < 0); t++) {
      engine.tick();
      if (flip < 0 && engine.getTerrain()[ROW_Y][2] !== 'toggle_wall_closed') flip = t;
      const a = w.entities.find((e) => e.type === 'bouncer' && e.x <= 2 && e.dir === 'E');
      if (moved < 0 && a !== undefined && a.x === 2) moved = t;
    }
    return { flip, moved };
  }

  it('is applied in the owner turn: a monster ahead of it in the list acts on the old state', () => {
    const { flip, moved } = ticks('converted', [A, B]);
    expect(flip).toBeGreaterThan(0);
    expect(moved - flip).toBe(1);
  });

  it('is seen by a monster behind it in the list in the same tick', () => {
    const { flip, moved } = ticks('converted', [B, A]);
    expect(flip).toBeGreaterThan(0);
    expect(moved - flip).toBe(0);
  });

  it('keeps the native timing on a native level and a level of the classic rules', () => {
    for (const flavor of ['native', 'cc'] as const) {
      const first = ticks(flavor, [A, B]);
      const second = ticks(flavor, [B, A]);
      expect(first.flip, flavor).toBeGreaterThan(0);
      expect(first.flip, flavor).toBe(second.flip);
    }
  });

  it('plays the same after an undo with a press waiting', () => {
    const trace = (withUndo: boolean): string => {
      const { engine, w } = build({ cells: CELLS, entities: [A, B] }, 'converted');
      const out: string[] = [];
      const run = (n: number): void => {
        for (let i = 0; i < n; i++) {
          engine.tick();
          out.push(`${w.entities.map((e) => `${e.uid}@${e.x}:${e.cooldownTicks}`).join(',')}|${w.ccArrivals.length}|${engine.getTerrain()[ROW_Y].join('')}`);
        }
      };
      run(6);
      if (withUndo) {
        engine.attemptPlayerMove('E');
        run(5);
        engine.undo();
        out.length = 6;
      }
      run(30);
      return out.join(';');
    };
    expect(trace(true)).toBe(trace(false));
  });
});

describe('a monster entering a bomb (water and fire work the same way, but a monster never steps in by choice)', () => {
  const CASES: Array<{ name: string; cells: string[]; items?: Array<[number, string]> }> = [
    { name: 'bomb', cells: [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR], items: [[4, 'bomb']] }
  ];
  const LANE = 2;

  for (const c of CASES) {
    it(`stays in the cell for the whole step on a converted level, then goes (${c.name})`, () => {
      const { engine, w } = build({ cells: c.cells, items: c.items, entities: [{ type: 'bouncer', x: LANE, y: ROW_Y, dir: 'E' }] }, 'converted');
      const hazardX = 4;
      let arrival = -1;
      let gone = -1;
      for (let t = 1; t <= RUN_TICKS && gone < 0; t++) {
        engine.tick();
        const m = w.entities.find((e) => e.kind === 'monster');
        if (arrival < 0 && m?.x === hazardX) arrival = t;
        if (arrival >= 0 && m === undefined) gone = t;
      }
      expect(arrival).toBeGreaterThan(0);
      expect(gone - arrival).toBe(STEP_TICKS - 1);
      if (c.name === 'bomb') expect(w.items[ROW_Y][hazardX]).toBeNull();
    });

    it(`removes it at once on a native level (${c.name})`, () => {
      const { engine, w } = build({ cells: c.cells, items: c.items, entities: [{ type: 'bouncer', x: LANE, y: ROW_Y, dir: 'E' }] }, 'native');
      let gone = -1;
      let arrival = -1;
      for (let t = 1; t <= RUN_TICKS * 2 && gone < 0; t++) {
        engine.tick();
        const m = w.entities.find((e) => e.kind === 'monster');
        if (arrival < 0 && m?.x === 4) arrival = t;
        if (m === undefined) gone = t;
      }
      expect(gone).toBeGreaterThan(0);
      expect(arrival < 0 || gone === arrival).toBe(true);
    });
  }

  it('still kills the player who steps into its cell while it waits to be removed', () => {
    const { engine, w } = build(
      { cells: [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR], items: [[4, 'bomb']], playerX: 5, entities: [{ type: 'bouncer', x: 2, y: ROW_Y, dir: 'E' }] },
      'converted'
    );
    for (let t = 0; t < RUN_TICKS && !w.entities.some((e) => e.x === 4); t++) engine.tick();
    expect(w.entities.find((e) => e.kind === 'monster')?.x).toBe(4);
    expect(w.ccArrivals.some((a) => a.removal === 'bomb')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    // The player walks west into the monster's cell: the contact is lethal, the monster is still there.
    engine.attemptPlayerMove('W');
    engine.tick();
    expect(engine.getPlayer().alive).toBe(false);
  });
});

describe('a brown button worked by a monster', () => {
  // x: 1 monster, 2 floor, 3 button, 4 floor, 5 trap
  const CELLS = [FLOOR, FLOOR, 'button_brown', FLOOR, 'trap', FLOOR, FLOOR];
  const LINKS = [{ buttonX: 3, buttonY: ROW_Y, trapX: 5, trapY: ROW_Y }];

  function openTicks(flavor: Flavor): { arrival: number; open: number } {
    const { engine, w } = build({ cells: CELLS, trapLinks: LINKS, entities: [{ type: 'bouncer', x: 1, y: ROW_Y, dir: 'E' }] }, flavor);
    let arrival = -1;
    let open = -1;
    for (let t = 1; t <= RUN_TICKS && open < 0; t++) {
      engine.tick();
      const m = w.entities.find((e) => e.kind === 'monster');
      if (arrival < 0 && m?.x === 3) arrival = t;
      if (open < 0 && !engine.isCellClosedTrap(5, ROW_Y)) open = t;
    }
    return { arrival, open };
  }

  it('opens the trap only once the monster rests, and not before the end of that tick', () => {
    const { arrival, open } = openTicks('converted');
    expect(arrival).toBeGreaterThan(0);
    expect(open - arrival).toBeGreaterThanOrEqual(STEP_TICKS - 1);
  });

  it('opens the trap while the monster is still stepping onto the button on a native level', () => {
    const { arrival, open } = openTicks('native');
    expect(open).toBe(arrival);
  });

  it('keeps the latch through an undo: the trap that opened is closed again once the move is undone', () => {
    const { engine, w } = build({ cells: CELLS, trapLinks: LINKS, entities: [{ type: 'bouncer', x: 1, y: ROW_Y, dir: 'E' }] }, 'converted');
    engine.tick();
    expect(engine.isCellClosedTrap(5, ROW_Y)).toBe(true);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    for (let t = 0; t < RUN_TICKS && engine.isCellClosedTrap(5, ROW_Y); t++) engine.tick();
    expect(engine.isCellClosedTrap(5, ROW_Y)).toBe(false);
    expect(engine.undo()).toBe(true);
    expect(engine.isCellClosedTrap(5, ROW_Y)).toBe(true);
    expect(w.trapLatch?.get(ROW_Y * (CELLS.length + 2) + 5)).toBe(true);
  });

  it('has no latch off a converted level', () => {
    expect(build({ cells: CELLS, trapLinks: LINKS, entities: [] }, 'native').w.trapLatch).toBeNull();
    expect(build({ cells: CELLS, trapLinks: LINKS, entities: [] }, 'cc').w.trapLatch).toBeNull();
  });
});

describe('a clone machine with a monster template', () => {
  // x: 1 button, 2 floor, 3 machine (template on it, facing E), 4.. floor; the player presses by a monster-free path: a second monster presses.
  const CELLS = [FLOOR, FLOOR, 'clone_machine', FLOOR, FLOOR, FLOOR, FLOOR];
  const LINK = [{ buttonX: 6, buttonY: ROW_Y, clonerX: 3, clonerY: ROW_Y, templateType: 'bouncer', templateDir: 'E' as const }];
  const TEMPLATE: EntityPlacement = { type: 'bouncer', x: 3, y: ROW_Y, dir: 'E' };

  function cloned(flavor: Flavor): { engine: GameEngine; w: EpoxyWorld; templateUid: number } {
    const cells = [...CELLS];
    cells[5] = 'button_red';
    const { engine, w } = build({ cells, cloneLinks: LINK, entities: [TEMPLATE, { type: 'bouncer', x: 7, y: ROW_Y, dir: 'W' }] }, flavor);
    const templateUid = w.entities.find((e) => e.x === 3 && e.type === 'bouncer')?.uid ?? -1;
    return { engine, w, templateUid };
  }

  it('lets the template itself out and puts a new one on the machine', () => {
    const { engine, w, templateUid } = cloned('converted');
    const before = w.entities.length;
    for (let t = 0; t < RUN_TICKS && w.entities.length === before; t++) engine.tick();
    expect(w.entities.length).toBe(before + 1);
    const machineHolder = w.entities.find((e) => e.x === 3 && e.y === ROW_Y);
    expect(machineHolder).toBeDefined();
    expect(machineHolder?.uid).not.toBe(templateUid);
    expect(w.entities.find((e) => e.uid === templateUid)?.x).not.toBe(3);
    // The new template is at the end of the list and keeps the template's place for the one let out.
    expect(w.entities[w.entities.length - 1].uid).toBe(machineHolder?.uid);
  });

  it('keeps the template on the machine and adds a mover on a native level', () => {
    const { engine, w, templateUid } = cloned('native');
    const before = w.entities.length;
    for (let t = 0; t < RUN_TICKS * 2 && w.entities.length === before; t++) engine.tick();
    expect(w.entities.length).toBe(before + 1);
    expect(w.entities.find((e) => e.uid === templateUid)?.x).toBe(3);
  });

  it('plays the same twice', () => {
    const run = (): string => {
      const { engine, w } = cloned('converted');
      const out: string[] = [];
      for (let i = 0; i < RUN_TICKS; i++) {
        engine.tick();
        out.push(w.entities.map((e) => `${e.uid}@${e.x}:${e.cooldownTicks}`).join(','));
      }
      return out.join(';');
    };
    expect(run()).toBe(run());
  });
});

describe('the step of a template let out of a clone machine', () => {
  const TEMPLATE_X = 3;
  const link = (): NonNullable<CompiledLevel['cloneLinks']> => [{ buttonX: 9, buttonY: ROW_Y, clonerX: TEMPLATE_X, clonerY: ROW_Y, templateType: 'bouncer', templateDir: 'E' }];

  /** The ticks at which the first template (uid 1 or the first of the list) changes cell, from the start. */
  function templateMoves(cells: string[], type: string, firstInList: 'template' | 'presser'): number[] {
    const template: EntityPlacement = { type, x: TEMPLATE_X, y: ROW_Y, dir: 'E' };
    const presser: EntityPlacement = { type: 'bouncer', x: 10, y: ROW_Y, dir: 'W' };
    const links = [{ ...link()[0], templateType: type }];
    const { engine, w } = build({ cells, cloneLinks: links, entities: firstInList === 'template' ? [template, presser] : [presser, template] }, 'converted');
    const uid = w.entities.find((e) => e.type === type && e.x === TEMPLATE_X)?.uid ?? -1;
    const out: number[] = [];
    let last = TEMPLATE_X;
    for (let t = 1; t <= RUN_TICKS; t++) {
      engine.tick();
      const e = w.entities.find((q) => q.uid === uid);
      if (e !== undefined && e.x !== last) out.push(t);
      last = e?.x ?? last;
    }
    return out;
  }

  const PLAIN = [FLOOR, FLOOR, 'clone_machine', FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, 'button_red', FLOOR];

  it('lasts four ticks whether the template had its turn already or not', () => {
    for (const order of ['template', 'presser'] as const) {
      const moves = templateMoves(PLAIN, 'bouncer', order);
      expect(moves.length, order).toBeGreaterThan(1);
      expect(moves[1] - moves[0], order).toBe(STEP_TICKS);
    }
  });

  it('lasts two ticks onto ice', () => {
    const cells = [FLOOR, FLOOR, 'clone_machine', 'ice', 'ice', FLOOR, FLOOR, FLOOR, 'button_red', FLOOR];
    for (const order of ['template', 'presser'] as const) {
      const moves = templateMoves(cells, 'bouncer', order);
      expect(moves[1] - moves[0], order).toBe(2);
    }
  });

  it('lasts eight ticks for an omni: the cooldown left after the tick it was let out in', () => {
    for (const order of ['template', 'presser'] as const) {
      const template: EntityPlacement = { type: 'omni', x: TEMPLATE_X, y: ROW_Y, dir: 'E' };
      const presser: EntityPlacement = { type: 'bouncer', x: 10, y: ROW_Y, dir: 'W' };
      const links = [{ ...link()[0], templateType: 'omni' }];
      const { engine, w } = build({ cells: PLAIN, cloneLinks: links, entities: order === 'template' ? [template, presser] : [presser, template] }, 'converted');
      const uid = w.entities.find((e) => e.type === 'omni')?.uid ?? -1;
      let left = -1;
      for (let t = 1; t <= RUN_TICKS && left < 0; t++) {
        engine.tick();
        if (w.entities.find((e) => e.uid === uid)?.x !== TEMPLATE_X) left = t;
      }
      expect(left, order).toBeGreaterThan(0);
      expect(w.entities.find((e) => e.uid === uid)?.cooldownTicks, order).toBe(7);
    }
  });

  it('keeps the pending removal when the machine is worked between two ticks', () => {
    const cells = [FLOOR, FLOOR, 'clone_machine', 'floor', FLOOR, FLOOR, FLOOR, FLOOR, 'button_red', FLOOR];
    const { engine, w } = build(
      { cells, items: [[4, 'bomb']], playerX: 10, cloneLinks: link(), entities: [{ type: 'bouncer', x: TEMPLATE_X, y: ROW_Y, dir: 'E' }] },
      'converted'
    );
    expect(w.inTick).toBe(false);
    expect(engine.attemptPlayerMove('W')).toBe(true);
    // Re-baselined: the player's press of a clone switch now acts when his step ends (inside a tick), not between two ticks,
    // so the template is let out by a tick and its removal is queued inside the tick that pressed.
    expect(w.ccArrivals).toHaveLength(0);
    let queued = false;
    for (let t = 0; t < RUN_TICKS && !queued; t++) {
      engine.tick();
      queued = w.ccArrivals.some((a) => a.removal === 'bomb');
    }
    expect(queued).toBe(true);
    expect(w.entities.some((e) => e.x === 4 && e.kind === 'monster')).toBe(true);
    for (let t = 0; t < RUN_TICKS && w.entities.some((e) => e.x === 4 && e.kind === 'monster'); t++) engine.tick();
    expect(w.entities.some((e) => e.x === 4 && e.kind === 'monster')).toBe(false);
    expect(w.items[ROW_Y][4]).toBeNull();
  });
});
