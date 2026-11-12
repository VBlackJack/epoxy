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
 * Turn in place: the player faces a direction without stepping, at no cost, so a thrown stone can be aimed. The
 * engine refuses it on the classic and converted CC3D rules, and the play aid (featuresFor) agrees with that gate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { compilePiece } from '../../generator/PieceCompiler';
import {
  decodeActions,
  encodeActions,
  isMoveAction,
  PieceSolver,
  TURN_E_ACTION,
  TURN_N_ACTION,
  TURN_S_ACTION,
  TURN_W_ACTION,
  DROP_STONE_ACTION,
  type SolverAction
} from '../../generator/PieceSolver';
import { timedSolution } from '../../generator/SolutionReplay';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { applyTimedMove, sanitizeTimedMoves } from '../../ui/replaySchedule';
import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { STONE_ITEM_ID } from '../coreConstants';
import { engineSimulationRun } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { featuresFor } from '../RulesetFeatures';
import type { CompiledLevel, Direction, EntityPlacement, TimedMove } from '../types';

const SIZE = 13;
const START = { x: 5, y: 5 };
const STEP_COOLDOWN_TICKS = 20;
const FLIGHT_TICKS = 40;
const SETTLE_TICKS = 10;
const MAX_REPLAY_TICKS = 2000;
const STONE = STONE_ITEM_ID;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  dir?: Direction;
  extra?: Partial<CompiledLevel>;
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'turn_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? START), dir: setup.dir ?? 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.extra ?? {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function itemCount(engine: GameEngine, id: string): number {
  return engine.getItems().flat().filter((item) => item === id).length;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('turnPlayer: the turn itself', () => {
  it('changes the facing and costs no tick, no cooldown, no step and no undo snapshot', () => {
    const engine = load(room());
    const tick = engine.getTick();
    expect(engine.turnPlayer('N')).toBe(true);
    expect(engine.getPlayer().dir).toBe('N');
    expect(engine.getPlayer()).toMatchObject({ x: START.x, y: START.y, moveCooldown: 0 });
    expect(engine.getTick()).toBe(tick);
    expect(engine.getStepsCount()).toBe(0);
    expect(engine.getMoveHistory()).toEqual([]);
    expect(engine.canUndo()).toBe(false);
    expect(engine.getTimedMoveHistory()).toEqual([{ tick, dir: 'N', turn: true }]);
  });

  it('refuses the direction already faced, recording nothing', () => {
    const engine = load(room());
    expect(engine.turnPlayer('E')).toBe(false);
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });

  it('refuses while sliding', () => {
    const engine = load(room());
    engine.getPlayer().isSliding = true;
    expect(engine.turnPlayer('N')).toBe(false);
    expect(engine.getPlayer().dir).toBe('E');
  });

  it('refuses on a force floor that carries the player', () => {
    const engine = load(room({ terrain: [[START.x, START.y, 'force_e']] }));
    expect(engine.turnPlayer('N')).toBe(false);
    expect(engine.getPlayer().dir).toBe('E');
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });

  it('refuses when dead, once the level is completed, and while paused', () => {
    const dead = load(room());
    dead.getPlayer().alive = false;
    expect(dead.turnPlayer('N')).toBe(false);

    const won = load(room({ terrain: [[START.x + 1, START.y, 'exit']] }));
    won.attemptPlayerMove('E');
    expect(won.isLevelCompleted()).toBe(true);
    expect(won.turnPlayer('N')).toBe(false);

    const paused = load(room());
    paused.setPaused(true);
    expect(paused.turnPlayer('N')).toBe(false);
  });

  it('refuses on the classic rules and on a level converted from CC3D, and works on a native one', () => {
    expect(load(room({ extra: { rulesFlavor: 'cc' } })).turnPlayer('N')).toBe(false);
    expect(load(room({ extra: { id: `lane${CONVERTED_ID_SUFFIX}` } })).turnPlayer('N')).toBe(false);
    expect(load(room()).turnPlayer('N')).toBe(true);
  });

  it('is allowed during the cooldown of a step and inside a closed trap', () => {
    const stepping = load(room());
    expect(stepping.attemptPlayerMove('E')).toBe(true);
    expect(stepping.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(stepping.turnPlayer('N')).toBe(true);
    expect(stepping.getPlayer().dir).toBe('N');

    const trapped = load(room({ terrain: [[START.x, START.y, 'trap_sealed']] }));
    expect(trapped.isCellClosedTrap(START.x, START.y)).toBe(true);
    expect(trapped.turnPlayer('S')).toBe(true);
    expect(trapped.getPlayer().dir).toBe('S');
  });

  it('does not move the mirror players, which copy step attempts only', () => {
    const level = room({
      entities: [
        { type: 'mirror_chip', x: 8, y: 5, dir: 'N' },
        { type: 'mirror_chip', x: 3, y: 8, dir: 'N' }
      ]
    });
    const engine = load(level);
    const before = engine.getEntities().map((e) => ({ x: e.x, y: e.y, dir: e.dir }));
    expect(engine.turnPlayer('N')).toBe(true);
    expect(engine.turnPlayer('S')).toBe(true);
    tickN(engine, SETTLE_TICKS);
    expect(engine.getEntities().map((e) => ({ x: e.x, y: e.y, dir: e.dir }))).toEqual(before);
  });

  it('is undone with the step before it: the facing returns and the turn entries are cut', () => {
    const engine = load(room());
    tickN(engine, STEP_COOLDOWN_TICKS);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.turnPlayer('N')).toBe(true);
    expect(engine.turnPlayer('W')).toBe(true);
    expect(engine.getTimedMoveHistory().filter((m) => m.turn === true)).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: START.x, y: START.y, dir: 'E' });
    expect(engine.getTimedMoveHistory()).toEqual([]);
  });
});

describe('turn timing, players and flight', () => {
  it('records the current tick during a cooldown, and a replay applies it at that tick', () => {
    const engine = load(room());
    expect(engine.attemptPlayerMove('E')).toBe(true);
    tickN(engine, 2);
    const tick = engine.getTick();
    expect(engine.getPlayer().moveCooldown).toBeGreaterThan(0);
    expect(engine.turnPlayer('N')).toBe(true);
    const recorded = engine.getTimedMoveHistory();
    expect(recorded[recorded.length - 1]).toEqual({ tick, dir: 'N', turn: true });

    const replay = load(room());
    for (let i = 0; i <= tick; i++) {
      for (const move of recorded.filter((m) => m.tick === replay.getTick())) applyTimedMove(replay, move);
      if (replay.getTick() < tick) replay.tick();
    }
    expect(replay.getTick()).toBe(tick);
    expect(replay.getPlayer().dir).toBe('N');
    expect(replay.getPlayer()).toMatchObject({ x: engine.getPlayer().x, y: engine.getPlayer().y });
  });

  it('changes only the controlled player on a level with several', () => {
    const engine = load(room({ extra: { extraPlayers: [{ x: 8, y: 8, dir: 'E', character: 'melinda' }] } }));
    const parked = engine.getParkedPlayers();
    expect(parked).toHaveLength(1);
    const parkedBefore = { x: parked![0].x, y: parked![0].y, dir: parked![0].dir };
    expect(engine.turnPlayer('S')).toBe(true);
    expect(engine.getPlayer().dir).toBe('S');
    expect(engine.getParkedPlayers()![0]).toMatchObject(parkedBefore);
  });

  it('sends a stone thrown after a turn along the new facing', () => {
    const engine = load(room({ items: [[5, 8, 'bomb'], [8, 5, 'bomb']] }));
    engine.getPlayer().keys[STONE] = 1;
    expect(engine.turnPlayer('S')).toBe(true);
    expect(engine.dropItem(STONE)).toBe(true);
    const shot = engine.getShots()?.[0];
    if (shot !== undefined) expect(shot).toMatchObject({ x: START.x, dir: 'S' });
    tickN(engine, FLIGHT_TICKS);
    expect(engine.getItems()[8][5]).toBeNull();
    expect(engine.getItems()[5][8]).toBe('bomb');
  });
});

describe('turn then throw', () => {
  it('throws a hurl stone across water to the far side once the player faces it', () => {
    const level = room({
      terrain: [
        [4, 5, 'water'],
        [3, 5, 'water']
      ],
      items: [[2, 5, 'bomb']]
    });
    const withoutTurn = load(level);
    withoutTurn.getPlayer().keys[STONE] = 1;
    expect(withoutTurn.dropItem(STONE)).toBe(true);
    tickN(withoutTurn, FLIGHT_TICKS);
    expect(itemCount(withoutTurn, 'bomb')).toBe(1);

    const engine = load(level);
    engine.getPlayer().keys[STONE] = 1;
    expect(engine.turnPlayer('W')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: START.x, y: START.y });
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, FLIGHT_TICKS);
    expect(itemCount(engine, 'bomb')).toBe(0);
    expect(engine.getPlayer().alive).toBe(true);
  });
});

describe('turn actions in a written solution', () => {
  it('round trips n e s w beside the other letters, and is no step', () => {
    const actions = decodeActions('NnT.eSsPwX');
    expect(actions[1]).toBe(TURN_N_ACTION);
    expect(actions[4]).toBe(TURN_E_ACTION);
    expect(actions[6]).toBe(TURN_S_ACTION);
    expect(actions[8]).toBe(TURN_W_ACTION);
    expect(encodeActions(actions)).toBe('NnT.eSsPwX');
    expect(encodeActions(decodeActions('NnT'))).toBe('NnT');
    expect(isMoveAction('TURN_E')).toBe(false);
    expect(isMoveAction('E')).toBe(true);
  });

  it('is refused by the piece compiler', () => {
    const def = ConfigRegistry.getMotifs().pieces[0];
    expect(() => compilePiece(def, ConfigRegistry.getPieceLegend(), { solution: 'eE', reversible: true })).toThrow(/turn in place/);
  });

  it('plays a turn through PieceSolver and breaks the list on a turn that cannot happen', () => {
    const engine = load(room());
    expect(PieceSolver.play(engine, TURN_N_ACTION as SolverAction)).toBe(true);
    expect(engine.getPlayer().dir).toBe('N');
    expect(PieceSolver.play(engine, TURN_N_ACTION)).toBe(false);
  });
});

describe('turn entries in a recording', () => {
  it('survive sanitizeTimedMoves', () => {
    const moves: TimedMove[] = [
      { tick: 0, dir: 'N', turn: true },
      { tick: 3, dir: 'E' },
      { tick: 3, dir: 'E', swap: true },
      { tick: 4, dir: 'S', drop: STONE }
    ];
    expect(sanitizeTimedMoves(moves)).toEqual(moves);
  });

  it('are dispatched by applyTimedMove to turnPlayer and not to a step', () => {
    const engine = load(room());
    applyTimedMove(engine, { tick: 0, dir: 'S', turn: true });
    expect(engine.getPlayer()).toMatchObject({ x: START.x, y: START.y, dir: 'S' });
    expect(engine.getStepsCount()).toBe(0);
  });
});

describe('a turn-then-throw solution', () => {
  /** The player walks onto the stone, turns east without stepping, throws it at the bomb, waits, then walks out. */
  const SOLUTION = 'WeT.EEEEEEE';
  const level = (): CompiledLevel =>
    room({
      player: { x: 4, y: 5 },
      dir: 'N',
      terrain: [
        [10, 5, 'exit'],
        ...Array.from({ length: 11 }, (_, i): [number, number, string] => [i + 1, 4, 'wall']),
        ...Array.from({ length: 11 }, (_, i): [number, number, string] => [i + 1, 6, 'wall'])
      ],
      items: [
        [3, 5, STONE],
        [6, 5, 'bomb']
      ],
      extra: { solution: SOLUTION }
    });

  it('replays to a win through timedSolution', () => {
    const moves = timedSolution(level());
    expect(moves).not.toBeNull();
    expect(moves?.filter((m) => m.turn === true)).toEqual([{ tick: expect.any(Number), dir: 'E', turn: true }]);
    const engine = load(level());
    let index = 0;
    for (let i = 0; i < MAX_REPLAY_TICKS && !engine.isLevelCompleted(); i++) {
      while (moves !== null && index < (moves?.length ?? 0) && (moves as TimedMove[])[index].tick <= engine.getTick()) {
        applyTimedMove(engine, (moves as TimedMove[])[index]);
        index++;
      }
      engine.tick();
    }
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('wins in the simulation hash run, which replays through applyTimedMove', () => {
    const run = engineSimulationRun(level(), 'solution');
    expect(run.hasSolution).toBe(true);
    expect(run.won).toBe(true);
    expect(engineSimulationRun(level(), 'solution').hash).toBe(run.hash);
  });

  it('keeps the stone throw action letter T', () => {
    expect(encodeActions([TURN_W_ACTION, DROP_STONE_ACTION, TURN_S_ACTION])).toBe('wTs');
  });
});

describe('featuresFor turnInPlace', () => {
  const converted = (): CompiledLevel => room({ extra: { id: `lane${CONVERTED_ID_SUFFIX}` } });

  it('is on for Epoxy and off for cc, cc2, lynx, cc3d and converted CC3D levels', () => {
    expect(featuresFor(room()).turnInPlace).toBe(true);
    expect(featuresFor(room({ extra: { rulesFlavor: 'cc' } })).turnInPlace).toBe(false);
    expect(featuresFor(room({ extra: { cc2: {} as never } })).turnInPlace).toBe(false);
    expect(featuresFor(room({ extra: { ruleset: 'lynx' } })).turnInPlace).toBe(false);
    expect(featuresFor(room({ extra: { ruleset: 'cc3d' } })).turnInPlace).toBe(false);
    expect(featuresFor(converted()).turnInPlace).toBe(false);
    expect(featuresFor(undefined).turnInPlace).toBe(true);
  });

  it('agrees with the engine gate for each kind of level', () => {
    const matrix: Array<[string, CompiledLevel, boolean]> = [
      ['epoxy', room(), true],
      ['cc', room({ extra: { rulesFlavor: 'cc' } }), false],
      ['converted', converted(), false]
    ];
    for (const [name, level, expected] of matrix) {
      const engine = load(level);
      expect(engine.turnPlayer('N'), name).toBe(expected);
      expect(featuresFor(level).turnInPlace, name).toBe(expected);
    }
  });
});
