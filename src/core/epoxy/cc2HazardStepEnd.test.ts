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
 * Wave 12, HZE + HZE3 + HZF + HZG: on the CC2 engine water, slime and fire tiles kill a monster when its step ends (Lexy on_arrive:
 * fire.on_arrive tiletypes.js:954-972, water 980-1010, slime 1123-1137), so the removal is due at the start of the pass after the one
 * its step ended in, whatever the step length. A lit jet and a bomb keep their old arithmetic. A removal never outlives the end of the
 * step by more than the safety margin. A yellow tank records its step end like any monster, so a brown button it stepped on holds from
 * the next pass (Lexy brown button on_arrive adds the press: tiletypes.js:1764-1779).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement, RuntimeEntity, TrapLink } from '../types';
import { isButtonPressed, mapWidth, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const HAZARD_CELL = { x: 8, y: 8 };
const CLONER_CELL = { x: 7, y: 8 };
const BUTTON_CELL = { x: 3, y: ROOM_ROW };
const PRESSER_COOLDOWN = 50;
const RUN_TICKS = 40;
/** The ticks a clone's step is made to last beyond what its queued removal counted. */
const LONGER_STEP_TICKS = 2;
/** The most passes a removal may stay due after its step ended (the safety margin of the rule). */
const MARGIN_PASSES = 2;
/** Passes ahead the old arithmetic of a hand-queued removal is set. */
const FALLBACK_DUE_PASSES = 3;
/** A cooldown that is refilled every tick, as a monster whose countdown never runs (a steered monster at rest) would hold. */
const NEVER_COUNTING_COOLDOWN = 5;
const TANK = 'golem_yellow';
const YELLOW_BUTTON = 'puppet_control';
const TANK_START = { x: 6, y: 2 };
const TANK_TARGET = { x: 7, y: 2 };
const TRAP_CELL = { x: 10, y: 8 };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

interface Frame {
  tick: number;
  monster: { x: number; y: number; cooldownTicks: number } | undefined;
  removalsQueued: number;
}

function snapshot(engine: GameEngine, type: string, tick: number, exclude?: { x: number; y: number }): Frame {
  const found = engine.getEntities().find((e: RuntimeEntity) => e.type === type && !(e.x === exclude?.x && e.y === exclude.y));
  return {
    tick,
    monster: found === undefined ? undefined : { x: found.x, y: found.y, cooldownTicks: found.cooldownTicks },
    removalsQueued: world(engine).ccArrivals.filter((a) => a.removal !== undefined).length
  };
}

function trace(engine: GameEngine, type: string, exclude?: { x: number; y: number }, afterTick?: (tick: number) => void): Frame[] {
  const frames: Frame[] = [];
  for (let tick = 1; tick <= RUN_TICKS; tick++) {
    engine.tick();
    afterTick?.(tick);
    frames.push(snapshot(engine, type, tick, exclude));
  }
  return frames;
}

/** A monster walking east into the hazard cell on its own, the player far away. */
function walkInto(mode: RoomMode, type: string, hazard: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: 1, terrain: { [`${HAZARD_CELL.x},${HAZARD_CELL.y}`]: hazard }, entities: [{ type, x: HAZARD_CELL.x - 2, y: HAZARD_CELL.y, dir: 'E' }] })
  );
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  return engine;
}

/** A clone let out onto the hazard cell by a clone button a monster's queued press works at the start of the pass. */
function cloneOnto(type: string, hazard: string): GameEngine {
  const level = room({
    mode: 'cc2',
    startX: 10,
    terrain: { [`${BUTTON_CELL.x},${BUTTON_CELL.y}`]: 'button_red', [`${CLONER_CELL.x},${CLONER_CELL.y}`]: 'clone_machine', [`${HAZARD_CELL.x},${HAZARD_CELL.y}`]: hazard },
    entities: [
      { type, x: CLONER_CELL.x, y: CLONER_CELL.y, dir: 'E' },
      { type: 'bug', x: BUTTON_CELL.x, y: BUTTON_CELL.y, dir: 'E' }
    ]
  });
  level.cloneLinks = [{ buttonX: BUTTON_CELL.x, buttonY: BUTTON_CELL.y, clonerX: CLONER_CELL.x, clonerY: CLONER_CELL.y, templateType: type, templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = world(engine);
  const presser = w.entities.find((e) => e.type === 'bug');
  if (presser === undefined) throw new Error('the presser is missing');
  presser.cooldownTicks = PRESSER_COOLDOWN;
  w.ccArrivals.push({ uid: presser.uid, x: BUTTON_CELL.x, y: BUTTON_CELL.y, action: 'trigger_cloner', due: w.ccMonsterClock });
  return engine;
}

/** A yellow tank steered east by a monster on the yellow button; `target` is the tile it drives onto, `extra` more placements. */
function steeredTank(target: string, extra: EntityPlacement[] = [], terrain: Record<string, string> = {}, trapLinks: TrapLink[] = []): GameEngine {
  const level = room({
    mode: 'cc2',
    startX: 1,
    terrain: { [`4,${ROOM_ROW}`]: YELLOW_BUTTON, [`${TANK_TARGET.x},${TANK_TARGET.y}`]: target, ...terrain },
    entities: [
      { type: 'glider', x: 3, y: ROOM_ROW, dir: 'E' },
      { type: TANK, x: TANK_START.x, y: TANK_START.y, dir: 'N' },
      ...extra
    ]
  });
  level.trapLinks = trapLinks;
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  return engine;
}

/** The tick the monster first stands on the cell, the tick its step there ends (cooldown 0, still alive), and the tick it is gone. */
function lifeAt(frames: Frame[], cell: { x: number; y: number }): { arrived?: number; stepEnded?: number; gone?: number } {
  const arrived = frames.find((f) => f.monster?.x === cell.x && f.monster.y === cell.y)?.tick;
  if (arrived === undefined) return {};
  const stepEnded = frames.find((f) => f.tick >= arrived && f.monster?.cooldownTicks === 0)?.tick;
  const gone = frames.find((f) => f.tick > arrived && f.monster === undefined)?.tick;
  return { arrived, stepEnded, gone };
}

describe('water, slime and fire kill a monster when its step ends (CC2 engine)', () => {
  it.each([
    ['fireball', 'water'],
    ['fireball', 'slime'],
    ['rolling_ball', 'fire']
  ])('%s onto %s stays through its step and is removed at the start of the pass after it', (type, hazard) => {
    const life = lifeAt(trace(walkInto('cc2', type, hazard), type), HAZARD_CELL);
    expect(life.arrived).toBeDefined();
    expect(life.stepEnded).toBeDefined();
    // Not removed on arrival (the old immediate removal): it still stands there with its step running.
    expect(life.stepEnded as number).toBeGreaterThan(life.arrived as number);
    // Removed in the pass after its step ended (water 980-1010, slime 1123-1137, fire 954-972).
    expect(life.gone).toBe((life.stepEnded as number) + 1);
  });

  it('removes a clone let out onto water when its step ends, whatever the queued arithmetic counted (forced invariant)', () => {
    // A forced invariant, not a natural case: a clone released by a queued press, by the button of a player or by a wire always has
    // the arithmetic and stepEndedPass agree (measured on every release path of the room). The step is lengthened by hand, as a
    // slowed or retried step would be, so the two disagree: Lexy kills on arrival once the step has ended, whatever its length.
    const engine = cloneOnto('fireball', 'water');
    const frames = trace(engine, 'fireball', CLONER_CELL, (tick) => {
      const clone = engine.getEntities().find((e) => e.type === 'fireball' && e.x === HAZARD_CELL.x && e.y === HAZARD_CELL.y);
      if (tick === 1 && clone !== undefined) clone.cooldownTicks += LONGER_STEP_TICKS;
    });
    const life = lifeAt(frames, HAZARD_CELL);
    expect(life.arrived).toBe(1);
    expect(life.stepEnded).toBeDefined();
    expect(life.gone).toBe((life.stepEnded as number) + 1);
  });

  it('removes a yellow tank driven into water in the pass after its step ended', () => {
    const life = lifeAt(trace(steeredTank('water'), TANK), TANK_TARGET);
    expect(life.arrived).toBeDefined();
    expect(life.stepEnded).toBeDefined();
    expect(life.gone).toBe((life.stepEnded as number) + 1);
  });

  it.each(['cc', 'native'] as RoomMode[])('keeps the immediate removal on a %s level', (mode) => {
    const frames = trace(walkInto(mode, 'fireball', 'water'), 'fireball');
    // Never seen standing in the water: it is removed as it arrives.
    expect(frames.some((f) => f.monster?.x === HAZARD_CELL.x && f.monster.y === HAZARD_CELL.y)).toBe(false);
    expect(frames[frames.length - 1].monster).toBeUndefined();
  });
});

describe('a yellow tank records its step end (HZE3)', () => {
  it('holds a brown button from the pass after its step ended: the trapped monster leaves one pass later', () => {
    const link = { buttonX: TANK_TARGET.x, buttonY: TANK_TARGET.y, trapX: TRAP_CELL.x, trapY: TRAP_CELL.y };
    const engine = steeredTank('button_brown', [{ type: 'bug', x: TRAP_CELL.x, y: TRAP_CELL.y, dir: 'E' }], { [`${TRAP_CELL.x},${TRAP_CELL.y}`]: 'trap' }, [link]);
    const tankFrames: Frame[] = [];
    const bugFrames: Frame[] = [];
    let recorded: { pass: number | undefined; cell: number | undefined; clock: number } | undefined;
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      engine.tick();
      const tank = engine.getEntities().find((e) => e.type === TANK);
      if (recorded === undefined && tank?.x === TANK_TARGET.x && tank.y === TANK_TARGET.y && tank.cooldownTicks === 0) {
        recorded = { pass: tank.stepEndedPass, cell: tank.stepEndedCell, clock: world(engine).ccMonsterClock };
      }
      tankFrames.push(snapshot(engine, TANK, tick));
      bugFrames.push(snapshot(engine, 'bug', tick));
    }
    const stepEnded = lifeAt(tankFrames, TANK_TARGET).stepEnded as number;
    const bugLeft = bugFrames.find((f) => f.monster !== undefined && (f.monster.x !== TRAP_CELL.x || f.monster.y !== TRAP_CELL.y))?.tick;
    expect(stepEnded).toBeDefined();
    // The step end is recorded as any monster's: the pass it ended in and the cell (isButtonPressed and restsOnButton read it).
    expect(recorded?.pass).toBe(recorded?.clock);
    expect(recorded?.cell).toBe(TANK_TARGET.y * mapWidth(world(engine)) + TANK_TARGET.x);
    // The tank's step ends in pass T; the press holds from pass T + 1, where the trapped bug (listed after the tank) leaves.
    expect(bugLeft).toBe(stepEnded + 1);
  });
});

describe('a due hazard removal is applied before the wire phase of its pass', () => {
  it('lets the clone machine fire onto the cell the dead monster stood on, in the same pass', () => {
    const plate = { x: 3, y: ROOM_ROW };
    const level = room({
      mode: 'cc2',
      startX: 1,
      terrain: { [`${plate.x},${plate.y}`]: 'signal_plate', [`${CLONER_CELL.x},${CLONER_CELL.y}`]: 'clone_machine',
        [`${HAZARD_CELL.x + 1},${HAZARD_CELL.y}`]: 'wall',
        [`${HAZARD_CELL.x},${HAZARD_CELL.y - 1}`]: 'wall',
        [`${HAZARD_CELL.x},${HAZARD_CELL.y + 1}`]: 'wall'
      },
      entities: [
        { type: 'fireball', x: CLONER_CELL.x, y: CLONER_CELL.y, dir: 'E' },
        { type: 'fireball', x: HAZARD_CELL.x, y: HAZARD_CELL.y, dir: 'E' }
      ]
    });
    level.signalLinks = [{ fromX: plate.x, fromY: plate.y, toX: CLONER_CELL.x, toY: CLONER_CELL.y }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    engine.tick();
    const w = world(engine);
    w.terrain[HAZARD_CELL.y][HAZARD_CELL.x] = 'water';
    // The victim's step has just ended on the water: its removal is due in the pass about to run (Lexy water on_arrive 980-1010).
    const victim = w.entities.find((e) => e.x === HAZARD_CELL.x && e.y === HAZARD_CELL.y) as RuntimeEntity;
    victim.cooldownTicks = 0;
    victim.stepEndedPass = w.ccMonsterClock;
    victim.stepEndedCell = HAZARD_CELL.y * mapWidth(w) + HAZARD_CELL.x;
    w.ccArrivals.push({ uid: victim.uid, x: HAZARD_CELL.x, y: HAZARD_CELL.y, removal: 'splash', due: w.ccMonsterClock });
    // The plate's press fires the machine before the decisions of the next pass (game.js:869-888).
    w.cc2DeferredSinkEdges = [{ cell: CLONER_CELL.y * mapWidth(w) + CLONER_CELL.x, rising: true }];
    const uidsBefore = new Set(w.entities.map((e) => e.uid));
    engine.tick();
    expect(w.entities.some((e) => e.uid === victim.uid)).toBe(false);
    const clone = w.entities.find((e) => !uidsBefore.has(e.uid) && e.type === 'fireball');
    // The dead monster no longer blocks the release: the clone stands where it stood, in the pass the victim died in.
    expect(clone).toBeDefined();
  });
});

describe('a due hazard removal is applied at the input of a level without actor order', () => {
  /** A fireball boxed in on the water east of the player, its removal due in the pass about to run; a second player parked far away (no actor order). */
  function waterNextToPlayer(): { engine: GameEngine; victim: RuntimeEntity } {
    const next = { x: 2, y: ROOM_ROW };
    const level = room({ mode: 'cc2', startX: 1, terrain: { [`${next.x},${next.y}`]: 'water' }, entities: [{ type: 'fireball', x: next.x, y: next.y, dir: 'E' }] });
    level.extraPlayers = [{ x: 11, y: 11, dir: 'W', character: 'chip' }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    const w = world(engine);
    const victim = w.entities.find((e) => e.type === 'fireball') as RuntimeEntity;
    victim.cooldownTicks = 0;
    victim.stepEndedPass = w.ccMonsterClock;
    victim.stepEndedCell = next.y * mapWidth(w) + next.x;
    w.ccArrivals.push({ uid: victim.uid, x: next.x, y: next.y, removal: 'splash', due: w.ccMonsterClock });
    engine.getPlayer().boots.add('boots_water');
    return { engine, victim };
  }

  it('has no actor order, so the player steps at the input', () => {
    expect(waterNextToPlayer().engine.playsInActorOrder()).toBe(false);
  });

  it('lets the player step onto the cell of a monster the water kills in the pass about to run', () => {
    const { engine, victim } = waterNextToPlayer();
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getPlayer().x).toBe(2);
    expect(world(engine).entities.some((e) => e.uid === victim.uid)).toBe(false);
  });
});

describe('a yellow tank holds a brown button from the pass after its step ended (HZE3 probe)', () => {
  it('isButtonPressed is false right after the tank turn that ends its step, true one pass later', () => {
    const engine = steeredTank('button_brown');
    const w = world(engine);
    const pressed: boolean[] = [];
    const resting: boolean[] = [];
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      engine.tick();
      const tank = engine.getEntities().find((e) => e.type === TANK);
      resting.push(tank?.x === TANK_TARGET.x && tank.y === TANK_TARGET.y && tank.cooldownTicks === 0);
      // Read as an actor of the pass just played would read it: with the pass open, the clock being that pass.
      w.ccPassOpen = true;
      try {
        pressed.push(isButtonPressed(w, TANK_TARGET.x, TANK_TARGET.y));
      } finally {
        w.ccPassOpen = false;
      }
    }
    const stepEnded = resting.indexOf(true);
    expect(stepEnded).toBeGreaterThan(0);
    // Lexy tiletypes.js:1764-1779: the press is added when the step ends, seen by the actors of the next pass. Without the line that
    // records the yellow tank's step end it reads true here, in the very pass the step ended in.
    expect(pressed[stepEnded]).toBe(false);
    expect(pressed[stepEnded + 1]).toBe(true);
  });
});

describe('a removal never outlives the end of its step (HZG)', () => {
  /** A fireball boxed in on a water cell, its hazard removal queued at `due`, the step end record erased: only the margin can remove it. */
  function boxedInWater(cooldownTicks: number): { engine: GameEngine; due: number } {
    const walls: Record<string, string> = {
      [`${HAZARD_CELL.x},${HAZARD_CELL.y}`]: 'water',
      [`${HAZARD_CELL.x - 1},${HAZARD_CELL.y}`]: 'wall',
      [`${HAZARD_CELL.x + 1},${HAZARD_CELL.y}`]: 'wall',
      [`${HAZARD_CELL.x},${HAZARD_CELL.y - 1}`]: 'wall',
      [`${HAZARD_CELL.x},${HAZARD_CELL.y + 1}`]: 'wall'
    };
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: 1, terrain: walls, entities: [{ type: 'fireball', x: HAZARD_CELL.x, y: HAZARD_CELL.y, dir: 'E' }] }));
    const w = world(engine);
    const monster = w.entities.find((e) => e.type === 'fireball') as RuntimeEntity;
    delete monster.atLoadCell;
    monster.cooldownTicks = cooldownTicks;
    const due = w.ccMonsterClock + FALLBACK_DUE_PASSES;
    w.ccArrivals.push({ uid: monster.uid, x: HAZARD_CELL.x, y: HAZARD_CELL.y, removal: 'splash', due });
    return { engine, due };
  }

  /** The pass clock after the tick in which the monster was found gone, and the clock after the tick before it. */
  function goneAtClock(engine: GameEngine): { before: number; after: number } {
    const w = world(engine);
    for (let tick = 1; tick <= RUN_TICKS; tick++) {
      const before = w.ccMonsterClock;
      const monster = w.entities.find((e) => e.type === 'fireball');
      if (monster !== undefined) delete monster.stepEndedPass;
      engine.tick();
      if (!w.entities.some((e) => e.type === 'fireball')) return { before, after: w.ccMonsterClock };
    }
    throw new Error('the monster was never removed');
  }

  it('removes a boxed-in monster that arrived at rest, with no step end record, at the old due pass', () => {
    const { engine, due } = boxedInWater(0);
    const clocks = goneAtClock(engine);
    // An arrival at rest cannot escape by deciding: with no recorded step end the old arithmetic applies, so it is removed at the start
    // of the pass whose clock is `due` and still stands in the pass before.
    expect(clocks.before).toBe(due);
    expect(clocks.after).toBe(due + 1);
  });

  it('removes a monster whose cooldown never counts down exactly the margin after the old due pass, not before (immortality)', () => {
    const { engine, due } = boxedInWater(NEVER_COUNTING_COOLDOWN);
    const w = world(engine);
    const monster = w.entities.find((e) => e.type === 'fireball') as RuntimeEntity;
    let goneAfter: number | undefined;
    for (let tick = 1; tick <= RUN_TICKS && goneAfter === undefined; tick++) {
      monster.cooldownTicks = NEVER_COUNTING_COOLDOWN;
      engine.tick();
      if (!w.entities.includes(monster)) goneAfter = w.ccMonsterClock;
    }
    // Removed at the start of the pass whose clock is due + margin (gone once that pass ran), and still standing in every pass before.
    expect(goneAfter).toBe(due + MARGIN_PASSES + 1);
  });

  it('leaves no hazard removal queued more than the margin after the monster stopped', () => {
    const scenes: Array<[GameEngine, string]> = [
      [walkInto('cc2', 'fireball', 'water'), 'fireball'],
      [walkInto('cc2', 'fireball', 'slime'), 'fireball'],
      [walkInto('cc2', 'rolling_ball', 'fire'), 'rolling_ball'],
      [cloneOnto('fireball', 'water'), 'fireball'],
      [steeredTank('water'), TANK]
    ];
    for (const [engine, type] of scenes) {
      let restingPasses = 0;
      for (let tick = 1; tick <= RUN_TICKS; tick++) {
        engine.tick();
        const queued = world(engine).ccArrivals.filter((a) => a.removal !== undefined);
        const resting = queued.some((a) => engine.getEntities().some((e) => e.uid === a.uid && e.cooldownTicks === 0));
        restingPasses = resting ? restingPasses + 1 : 0;
        expect(restingPasses, `${type} tick ${tick}`).toBeLessThanOrEqual(MARGIN_PASSES);
      }
      expect(world(engine).ccArrivals.filter((a) => a.removal !== undefined)).toHaveLength(0);
    }
  });
});
