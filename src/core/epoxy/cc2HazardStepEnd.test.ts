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
import { mapWidth, type EpoxyWorld } from './epoxyWorld';

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

  it('removes a clone let out onto water when its step ends, not when the queued arithmetic says', () => {
    // The queued due time counts the wait the clone had on arrival. A step that lasts longer than counted (here two ticks more, as a
    // slowed or retried step does) must hold the removal: Lexy kills on arrival once the step has ended, whatever its length.
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

describe('a removal never outlives the end of its step (HZG)', () => {
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
