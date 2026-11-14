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
import { buildTestLevel } from '../../test/buildTestLevel';
import {
  CC_BLOB_BUTTON_DELAY_PASSES,
  CC_MONSTER_BUTTON_DELAY_PASSES,
  CC_QUEUED_TANK_TURN_DELAY_PASSES,
  CC_TELEPORT_SLIDE_WAIT_TICKS
} from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement } from '../types';
import { resolveMonsterArrival } from './epoxyMonsters';
import { playerWalkCooldown } from './epoxyPlayer';
import { addClonedEntity, removeEntity, type EpoxyContext, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

type Origin = 'dat' | 'cc2' | 'native';

function level(rows: string[], entities: EntityPlacement[], origin: Origin = 'dat'): CompiledLevel {
  const base = buildTestLevel(rows, { entities });
  if (origin === 'native') return base;
  return origin === 'cc2' ? { ...base, rulesFlavor: 'cc', cc2: {} as never } : { ...base, rulesFlavor: 'cc' };
}

function start(lvl: CompiledLevel): { engine: GameEngine; w: EpoxyWorld; ctx: EpoxyContext } {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const internals = engine as unknown as { w: EpoxyWorld; ctx: EpoxyContext };
  return { engine, w: internals.w, ctx: internals.ctx };
}

function monsters(w: EpoxyWorld): EpoxyWorld['entities'] {
  return w.entities.filter((e) => e.kind === 'monster');
}

// A one-cell-wide corridor on row 1, the player far away at the east end.
const CORRIDOR = ['#################', '#.............@.#', '#################'];
// The same corridor with the cell under x=3 open (a side pocket under the west monster).
const CORRIDOR_POCKET = ['#################', '#.............@.#', '###.#############'];

describe('classic two-phase monster turn', () => {
  it('moves the entities in reverse list order: of two aiming at one cell, the later listed wins', () => {
    const { engine, w } = start(
      level(CORRIDOR, [
        { type: 'bug', x: 3, y: 1, dir: 'E' },
        { type: 'bug', x: 5, y: 1, dir: 'W' }
      ])
    );
    engine.tick();
    const [first, second] = monsters(w);
    expect(second.x).toBe(4);
    expect(first.x).toBe(3);
  });

  it('keeps the list order on a native level', () => {
    const { engine, w } = start(
      level(
        CORRIDOR,
        [
          { type: 'bug', x: 3, y: 1, dir: 'E' },
          { type: 'bug', x: 5, y: 1, dir: 'W' }
        ],
        'native'
      )
    );
    expect(w.ccRules).toBe(false);
    // A native bug waits out its move interval first; the first tick any monster moves is the one that counts.
    for (let i = 0; i < 20 && monsters(w).every((m, k) => m.x === [3, 5][k]); i++) engine.tick();
    expect(w.ccArrivals).toEqual([]);
    expect(w.ccPlans.size).toBe(0);
    // The first listed bug moves first and takes the cell.
    expect(monsters(w)[0].x).toBe(4);
  });

  it('only turns a monster whose planned step is refused, without deciding again', () => {
    // The west bug plans east; the east bug (moving first) takes that cell. Deciding again would send the west bug
    // down the pocket below it; the refused plan only turns it.
    const { engine, w } = start(
      level(CORRIDOR_POCKET, [
        { type: 'bug', x: 3, y: 1, dir: 'E' },
        { type: 'bug', x: 5, y: 1, dir: 'W' }
      ])
    );
    engine.tick();
    const [first, second] = monsters(w);
    expect(second.x).toBe(4);
    expect(first.x).toBe(3);
    expect(first.y).toBe(1);
    expect(first.dir).toBe('E');
  });

  it('plans the fallback facing of a boxed-in monster and steps there once the blocker moved away', () => {
    // The west bug is walled in on three sides and faces west; boxed in at the decision, it plans its last candidate
    // (back, east). The east bug, listed after it, moves first and frees the cell, so the plan succeeds on the same tick.
    const { engine, w } = start(
      level(CORRIDOR, [
        { type: 'bug', x: 3, y: 1, dir: 'W' },
        { type: 'bug', x: 4, y: 1, dir: 'E' }
      ])
    );
    w.terrain[1][2] = 'wall';
    engine.tick();
    const [walled, free] = monsters(w);
    expect(free.x).toBe(5);
    expect(walled.x).toBe(4);
  });
});

describe('classic held monster', () => {
  it('keeps its facing when the trap opens during the movement pass, deciding nothing', () => {
    // The trapped bug has an open cell on its left; the later-listed bug moves first onto the brown button and frees it.
    const rows = ['#####.###########', '#.............@.#', '#################'];
    const base = level(rows, [
      { type: 'bug', x: 5, y: 1, dir: 'E' },
      { type: 'bug', x: 8, y: 1, dir: 'W' }
    ]);
    const terrain = base.terrain.map((row) => [...row]);
    terrain[1][5] = 'trap';
    terrain[1][7] = 'button_brown';
    const { engine, w } = start({ ...base, terrain, trapLinks: [{ buttonX: 7, buttonY: 1, trapX: 5, trapY: 1 }] });
    engine.tick();
    const [held, presser] = monsters(w);
    expect(presser.x).toBe(7);
    expect(held.x).toBe(6);
    expect(held.dir).toBe('E');
  });
});

describe('classic creature slots', () => {
  const THREE = [
    { type: 'bug', x: 3, y: 1, dir: 'E' as const },
    { type: 'bug', x: 6, y: 1, dir: 'E' as const },
    { type: 'bug', x: 9, y: 1, dir: 'E' as const }
  ];

  function cloneOf(w: EpoxyWorld, x: number): EpoxyWorld['entities'][number] {
    return { ...w.entities[0], uid: w.nextEntityUid++, x };
  }

  it('puts a clone into the first freed slot, not at the end of the list', () => {
    const { w } = start(level(CORRIDOR, THREE));
    const [a, b, c] = w.entities.map((e) => e.uid);
    removeEntity(w, b);
    const clone = cloneOf(w, 12);
    addClonedEntity(w, clone);
    expect(w.entities.map((e) => e.uid)).toEqual([a, clone.uid, c]);
    // No slot is free any more: the next clone goes to the end.
    const next = cloneOf(w, 13);
    addClonedEntity(w, next);
    expect(w.entities.map((e) => e.uid)).toEqual([a, clone.uid, c, next.uid]);
  });

  it('puts a clone at the end of the list on a native level', () => {
    const { w } = start(level(CORRIDOR, THREE, 'native'));
    const [a, b, c] = w.entities.map((e) => e.uid);
    removeEntity(w, b);
    const clone = cloneOf(w, 12);
    addClonedEntity(w, clone);
    expect(w.entities.map((e) => e.uid)).toEqual([a, c, clone.uid]);
  });

  it('puts the slots back with an undo', () => {
    const { engine, w } = start(level(CORRIDOR, THREE));
    const [a, b, c] = w.entities.map((e) => e.uid);
    const saved = engine.captureState();
    removeEntity(w, b);
    addClonedEntity(w, cloneOf(w, 12));
    engine.restoreState(saved);
    expect(w.entities.map((e) => e.uid)).toEqual([a, b, c]);
    expect(w.ccSlots).toEqual([a, b, c]);
    removeEntity(w, a);
    const clone = cloneOf(w, 12);
    addClonedEntity(w, clone);
    expect(w.entities.map((e) => e.uid)).toEqual([clone.uid, b, c]);
  });
});

describe('classic queued monster button arrivals', () => {
  const GREEN_CELL = { x: 4, y: 1 };
  const WALL_CELL = { x: 10, y: 1 };

  function buttonLevel(origin: Origin, monster: string, action: 'button_green' | 'button_blue', entities?: EntityPlacement[]) {
    const lvl = level(CORRIDOR, entities ?? [{ type: monster, x: 3, y: 1, dir: 'E' }], origin);
    const state = start(lvl);
    state.w.terrain[GREEN_CELL.y][GREEN_CELL.x] = action;
    state.w.terrain[WALL_CELL.y][WALL_CELL.x] = 'toggle_wall_closed';
    return state;
  }

  /** Steps the monster onto the button by the arrival routine, inside an entity pass. */
  function stepOntoButton(state: ReturnType<typeof buttonLevel>, type: string, passOpen = true): void {
    const { w, ctx } = state;
    const monster = monsters(w).find((e) => e.type === type)!;
    monster.x = GREEN_CELL.x;
    monster.y = GREEN_CELL.y;
    w.inTick = true;
    w.ccPassOpen = passOpen;
    resolveMonsterArrival(ctx, monster, true);
    w.ccPassOpen = false;
    w.inTick = false;
  }

  it('delays the press by two passes for a bug and six for a blob', () => {
    const bug = buttonLevel('dat', 'bug', 'button_green');
    stepOntoButton(bug, 'bug');
    expect(bug.w.ccArrivals).toHaveLength(1);
    expect(bug.w.ccArrivals[0].due - bug.w.ccMonsterClock).toBe(CC_MONSTER_BUTTON_DELAY_PASSES);
    expect(bug.w.terrain[WALL_CELL.y][WALL_CELL.x]).toBe('toggle_wall_closed');

    const blob = buttonLevel('dat', 'blob', 'button_green');
    stepOntoButton(blob, 'blob');
    expect(blob.w.ccArrivals[0].due - blob.w.ccMonsterClock).toBe(CC_BLOB_BUTTON_DELAY_PASSES);
  });

  it('counts the pass of the tick when the arrival comes before the pass has started', () => {
    const state = buttonLevel('dat', 'bug', 'button_green');
    stepOntoButton(state, 'bug', false);
    expect(state.w.ccArrivals[0].due - state.w.ccMonsterClock).toBe(CC_MONSTER_BUTTON_DELAY_PASSES + 1);
  });

  it('fires the action the button has when the press is applied, or nothing if it is no button any more', () => {
    const state = buttonLevel('dat', 'bug', 'button_green');
    const { engine, w } = state;
    const monster = monsters(w)[0];
    monster.cooldownTicks = 50;
    monster.x = GREEN_CELL.x;
    monster.y = GREEN_CELL.y;
    w.ccArrivals.push({ uid: monster.uid, x: GREEN_CELL.x, y: GREEN_CELL.y, action: 'toggle_walls', due: w.ccMonsterClock });
    w.terrain[GREEN_CELL.y][GREEN_CELL.x] = 'floor';
    engine.tick();
    expect(w.terrain[WALL_CELL.y][WALL_CELL.x]).toBe('toggle_wall_closed');
    expect(w.ccArrivals).toEqual([]);
  });

  it('presses the button when the delay is over, not before', () => {
    const state = buttonLevel('dat', 'bug', 'button_green');
    const { engine, w } = state;
    const monster = monsters(w)[0];
    // Keep the bug on the button for the whole run.
    monster.x = GREEN_CELL.x;
    monster.y = GREEN_CELL.y;
    monster.cooldownTicks = 50;
    w.ccArrivals.push({ uid: monster.uid, x: GREEN_CELL.x, y: GREEN_CELL.y, action: 'toggle_walls', due: w.ccMonsterClock + CC_MONSTER_BUTTON_DELAY_PASSES });
    const toggled: boolean[] = [];
    for (let i = 0; i < CC_MONSTER_BUTTON_DELAY_PASSES + 2; i++) {
      engine.tick();
      toggled.push(w.terrain[WALL_CELL.y][WALL_CELL.x] !== 'toggle_wall_closed');
    }
    expect(toggled).toEqual([false, false, true, true]);
    expect(w.ccArrivals).toEqual([]);
  });

  it('voids a queued press whose monster left the button', () => {
    const state = buttonLevel('dat', 'bug', 'button_green');
    const { engine, w } = state;
    const monster = monsters(w)[0];
    monster.cooldownTicks = 50;
    w.ccArrivals.push({ uid: monster.uid, x: GREEN_CELL.x, y: GREEN_CELL.y, action: 'toggle_walls', due: w.ccMonsterClock });
    engine.tick();
    expect(w.terrain[WALL_CELL.y][WALL_CELL.x]).toBe('toggle_wall_closed');
    expect(w.ccArrivals).toEqual([]);
  });

  it('defers the green button press to the end of the step on a level imported from Chip\'s Challenge 2', () => {
    const state = buttonLevel('cc2', 'bug', 'button_green');
    stepOntoButton(state, 'bug');
    expect(state.w.ccArrivals).toHaveLength(1);
    expect(state.w.terrain[WALL_CELL.y][WALL_CELL.x]).toBe('toggle_wall_closed');
  });

  it('still delays the other buttons on a level imported from Chip\'s Challenge 2', () => {
    const state = buttonLevel('cc2', 'bug', 'button_blue');
    stepOntoButton(state, 'bug');
    expect(state.w.ccArrivals).toHaveLength(1);
  });

  it('applies a monster press at once on a native level', () => {
    const state = buttonLevel('native', 'bug', 'button_green');
    stepOntoButton(state, 'bug');
    expect(state.w.ccArrivals).toEqual([]);
    expect(state.w.terrain[WALL_CELL.y][WALL_CELL.x]).not.toBe('toggle_wall_closed');
  });

  it('turns a tank one pass after a queued press is applied', () => {
    const state = buttonLevel('dat', 'bug', 'button_blue', [
      { type: 'bug', x: 3, y: 1, dir: 'E' },
      { type: 'tank', x: 8, y: 1, dir: 'E' }
    ]);
    const { engine, w } = state;
    w.terrain[1][9] = 'wall';
    const bug = monsters(w).find((e) => e.type === 'bug')!;
    const tank = monsters(w).find((e) => e.type === 'tank')!;
    bug.x = GREEN_CELL.x;
    bug.y = GREEN_CELL.y;
    bug.cooldownTicks = 50;
    const applyPass = w.ccMonsterClock;
    w.ccArrivals.push({ uid: bug.uid, x: GREEN_CELL.x, y: GREEN_CELL.y, action: 'reverse_tanks', due: applyPass });
    engine.tick();
    expect(tank.tankTurn).toBe(applyPass + CC_QUEUED_TANK_TURN_DELAY_PASSES);
    expect(tank.dir).toBe('E');
    engine.tick();
    expect(tank.dir).toBe('W');
  });

  it('keeps the queue through an undo and replays identically', () => {
    const run = (withUndo: boolean): string[] => {
      const state = buttonLevel('dat', 'bug', 'button_green');
      const { engine, w } = state;
      const monster = monsters(w)[0];
      monster.cooldownTicks = 50;
      monster.x = GREEN_CELL.x;
      monster.y = GREEN_CELL.y;
      w.ccArrivals.push({ uid: monster.uid, x: GREEN_CELL.x, y: GREEN_CELL.y, action: 'toggle_walls', due: w.ccMonsterClock + 3 });
      engine.tick();
      engine.attemptPlayerMove('W');
      const queued = JSON.stringify(w.ccArrivals);
      if (withUndo) {
        for (let i = 0; i < 4; i++) engine.tick();
        expect(engine.undo()).toBe(true);
        expect(JSON.stringify(w.ccArrivals)).toBe(queued);
        expect(w.ccArrivals).toHaveLength(1);
        engine.attemptPlayerMove('W');
      }
      const out: string[] = [];
      for (let i = 0; i < 8; i++) {
        engine.tick();
        out.push(`${w.terrain[WALL_CELL.y][WALL_CELL.x]}/${w.ccArrivals.length}/${w.ccMonsterClock}`);
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('classic generators on a level imported from Chip\'s Challenge 2', () => {
  it('gives walkers and blobs the classic generators on every classic-rules level', () => {
    for (const origin of ['dat', 'cc2'] as const) {
      const { w } = start(level(CORRIDOR, [{ type: 'walker', x: 3, y: 1, dir: 'E' }], origin));
      expect(w.ccGenerators).not.toBeNull();
    }
    expect(start(level(CORRIDOR, [{ type: 'walker', x: 3, y: 1, dir: 'E' }], 'native')).w.ccGenerators).toBeNull();
  });
});

describe('classic teleporter reached by a slide', () => {
  const SIZE = 13;
  const ROW = 5;
  const PAD = 6;
  const FAR_PAD = 10;

  function slideLevel(): CompiledLevel {
    const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
      Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
    );
    terrain[ROW][4] = 'ice';
    terrain[ROW][5] = 'ice';
    terrain[ROW][PAD] = 'teleport';
    terrain[ROW][FAR_PAD] = 'teleport';
    return {
      id: 'cc_slide_teleport',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 200,
      chipsRequired: 0,
      playerStart: { x: 3, y: ROW, dir: 'E' },
      terrain,
      items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
      entities: [],
      trapLinks: [],
      cloneLinks: [],
      rulesFlavor: 'cc'
    };
  }

  it('waits the time of a slide step before the forced exit, not the walking wait', () => {
    const engine = new GameEngine();
    engine.loadLevel(slideLevel());
    const w = (engine as unknown as { w: EpoxyWorld }).w;
    expect(playerWalkCooldown(w)).toBeGreaterThan(CC_TELEPORT_SLIDE_WAIT_TICKS);
    engine.attemptPlayerMove('E');
    let landed = -1;
    for (let t = 1; t <= 30 && landed < 0; t++) {
      engine.tick();
      if (engine.getPlayer().x === FAR_PAD && engine.getPlayer().teleportExit !== undefined) landed = t;
    }
    expect(landed).toBeGreaterThan(0);
    expect(engine.getPlayer().moveCooldown).toBeLessThanOrEqual(CC_TELEPORT_SLIDE_WAIT_TICKS);
    let waited = 0;
    while (engine.getPlayer().x === FAR_PAD && waited < 30) {
      engine.tick();
      waited++;
    }
    expect(waited).toBeLessThanOrEqual(CC_TELEPORT_SLIDE_WAIT_TICKS);
    expect(engine.getPlayer().x).toBe(FAR_PAD + 1);
  });
});
