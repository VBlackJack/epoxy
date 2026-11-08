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
 * A level with several players, after Lexy's Labyrinth (game.js `remaining_players`, `swap_players`; tiletypes.js
 * `exit.on_arrive`): every real player on the map counts, the swap key hands control to the next one, a player not
 * controlled takes no voluntary move but still finishes forced ones, any player's death fails the level, a player
 * that reaches an exit while others remain leaves play and control passes on, and the level is won when no player
 * remains. Each player keeps its own keys, boots and character; the chips are shared.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { normalizeExtraPlayers, stripInvalidTextFields } from '../../config/ConfigValidation';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { collectDueMoves } from '../../ui/replaySchedule';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, ExtraPlayerStart, PlayerCharacter, TimedMove } from '../types';

const ROOM_WIDTH = 12;
const ROOM_HEIGHT = 6;
const COOLDOWN_TICKS = 20;
const SETTLE_TICKS = 200;
const SLIDE_TICKS = 40;
const REPLAY_TICK_CAP = 4000;

interface RoomSetup {
  chip: { x: number; y: number };
  others: Array<{ x: number; y: number; character: PlayerCharacter }>;
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: Array<{ type: string; x: number; y: number; dir: Direction }>;
  chipsRequired?: number;
}

/** A walled room; Chip starts at `chip` facing east and the others are parked, in order. */
function room(setup: RoomSetup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_HEIGHT }, (_, y) =>
    Array.from({ length: ROOM_WIDTH }, (_, x) => (x === 0 || y === 0 || x === ROOM_WIDTH - 1 || y === ROOM_HEIGHT - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'several_players_room',
    number: 1,
    password: 'SEVP',
    timeLimitSeconds: 0,
    chipsRequired: setup.chipsRequired ?? 0,
    playerStart: { ...setup.chip, dir: 'E' },
    extraPlayers: setup.others.map((o) => ({ x: o.x, y: o.y, dir: 'E' as Direction, character: o.character })),
    terrain,
    items,
    entities: (setup.entities ?? []).map((e) => ({ ...e })),
    trapLinks: [],
    cloneLinks: []
  };
}

function start(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function wait(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.tick();
}

function step(engine: GameEngine, dir: Direction): boolean {
  wait(engine, COOLDOWN_TICKS);
  const moved = engine.attemptPlayerMove(dir);
  engine.tick();
  return moved;
}

const TWO_PLAYERS: RoomSetup = { chip: { x: 2, y: 2 }, others: [{ x: 8, y: 3, character: 'melinda' }] };

describe('swapping between players', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('hands control to the next player and back', () => {
    const engine = start(room(TWO_PLAYERS));
    expect(engine.getPlayerCharacter()).toBe('chip');
    expect(engine.swapPlayer()).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 3 });
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.getParkedPlayers()?.map((p) => [p.x, p.y])).toEqual([[2, 2]]);
    expect(engine.swapPlayer()).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 2 });
    expect(engine.getPlayerCharacter()).toBe('chip');
  });

  it('is refused on a level with one player', () => {
    const level = room(TWO_PLAYERS);
    delete level.extraPlayers;
    const engine = start(level);
    expect(engine.swapPlayer()).toBe(false);
    expect(engine.getParkedPlayers()).toBeUndefined();
    expect(engine.captureState().parked).toBeUndefined();
  });

  it('cycles through three players in order', () => {
    const engine = start(
      room({
        chip: { x: 2, y: 2 },
        others: [
          { x: 5, y: 2, character: 'melinda' },
          { x: 8, y: 2, character: 'chip' }
        ]
      })
    );
    const order: number[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(engine.getPlayer().x);
      engine.swapPlayer();
    }
    expect(order).toEqual([2, 5, 8, 2]);
  });

  it('moves only the controlled player and leaves the other where it stands', () => {
    const engine = start(room(TWO_PLAYERS));
    engine.swapPlayer();
    expect(step(engine, 'W')).toBe(true);
    wait(engine, SETTLE_TICKS);
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 3 });
    expect(engine.getParkedPlayers()?.[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('refuses a step into the cell of another player', () => {
    const engine = start(room({ chip: { x: 2, y: 2 }, others: [{ x: 3, y: 2, character: 'melinda' }] }));
    expect(step(engine, 'E')).toBe(false);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 2 });
  });
});

describe('players not controlled', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('finish a forced move: a force floor carries a parked player on', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 1, y: 4, character: 'melinda' }],
      terrain: [
        [2, 2, 'force_e'],
        [3, 2, 'force_e'],
        [4, 2, 'force_e'],
        [5, 2, 'force_e'],
        [6, 2, 'force_e']
      ]
    });
    const engine = start(level);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().isSliding).toBe(true);
    engine.swapPlayer();
    const before = engine.getParkedPlayers()?.[0].x ?? 0;
    wait(engine, SLIDE_TICKS);
    const after = engine.getParkedPlayers()?.[0].x ?? 0;
    expect(after).toBeGreaterThan(before);
    // The player controlled now did not move at all.
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 4 });
  });

  it('take no voluntary move: ticks alone never move an idle parked player', () => {
    const engine = start(room(TWO_PLAYERS));
    engine.swapPlayer();
    wait(engine, SETTLE_TICKS);
    expect(engine.getParkedPlayers()?.[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('die to a monster: the level is lost when a monster reaches a parked player', () => {
    const level = room({
      chip: { x: 1, y: 1 },
      others: [{ x: 5, y: 3, character: 'melinda' }],
      entities: [{ type: 'teeth', x: 10, y: 3, dir: 'W' }]
    });
    const engine = start(level);
    // Teeth chase the controlled player (Chip, north west) and meet Melinda on the way.
    wait(engine, SETTLE_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_monster');
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('die to a hazard they are carried into: the level is lost', () => {
    const level = room({
      chip: { x: 1, y: 1 },
      others: [{ x: 2, y: 3, character: 'melinda' }],
      terrain: [
        [3, 3, 'force_e'],
        [4, 3, 'water']
      ]
    });
    const engine = start(level);
    engine.swapPlayer();
    expect(step(engine, 'E')).toBe(true);
    engine.swapPlayer();
    wait(engine, SLIDE_TICKS);
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_water');
  });

  it('are protected from a pushed block: the push is refused', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 4, y: 2, character: 'melinda' }],
      entities: [{ type: 'dirt_block', x: 3, y: 2, dir: 'E' }]
    });
    const engine = start(level);
    wait(engine, COOLDOWN_TICKS);
    engine.attemptPlayerMove('E');
    wait(engine, COOLDOWN_TICKS);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getParkedPlayers()?.[0].alive).toBe(true);
  });
});

describe('leaving through the exit', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const exitRoom = (): CompiledLevel =>
    room({ chip: { x: 1, y: 2 }, others: [{ x: 3, y: 2, character: 'melinda' }], terrain: [[2, 2, 'exit']] });

  it('removes the player and swaps control, without winning while another remains', () => {
    const engine = start(exitRoom());
    expect(step(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
    expect(engine.getExitedPlayers()).toBe(1);
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 2 });
    expect(engine.getParkedPlayers()).toEqual([]);
    expect(engine.swapPlayer()).toBe(false);
  });

  it('wins once the last player has left', () => {
    const engine = start(exitRoom());
    step(engine, 'E');
    expect(step(engine, 'W')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('needs both players to exit: one alone is not a win', () => {
    const engine = start(exitRoom());
    engine.swapPlayer();
    expect(step(engine, 'W')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
    expect(engine.getPlayerCharacter()).toBe('chip');
  });

  it('lets a parked player leave when its forced move ends on an exit', () => {
    const level = room({
      chip: { x: 1, y: 4 },
      others: [{ x: 1, y: 1, character: 'melinda' }],
      terrain: [
        [2, 1, 'force_e'],
        [3, 1, 'force_e'],
        [4, 1, 'exit']
      ]
    });
    const engine = start(level);
    engine.swapPlayer();
    expect(step(engine, 'E')).toBe(true);
    engine.swapPlayer();
    wait(engine, SLIDE_TICKS);
    // Melinda slid out through the exit; Chip, controlled again, is the only one left.
    expect(engine.getExitedPlayers()).toBe(1);
    expect(engine.getParkedPlayers()).toEqual([]);
    expect(engine.getPlayerCharacter()).toBe('chip');
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('gates the exits on the shared chips', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 5, y: 3, character: 'melinda' }],
      items: [[4, 3, 'chip']],
      chipsRequired: 1,
      terrain: [[2, 2, 'socket']]
    });
    const engine = start(level);
    expect(engine.getChipsRemaining()).toBe(1);
    // Chip cannot pass the socket while the chip is uncollected.
    expect(step(engine, 'E')).toBe(false);
    engine.swapPlayer();
    expect(step(engine, 'W')).toBe(true);
    // Melinda collected the chip, and it counts for Chip too.
    expect(engine.getChipsRemaining()).toBe(0);
    engine.swapPlayer();
    expect(step(engine, 'E')).toBe(true);
  });
});

describe('what each player keeps', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps keys and boots per player', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 1, y: 4, character: 'melinda' }],
      items: [
        [2, 2, 'key_red'],
        [2, 4, 'boots_water']
      ],
      terrain: [[3, 4, 'door_red']]
    });
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getHeldItems()).toEqual(['key_red']);
    engine.swapPlayer();
    expect(engine.getHeldItems()).toEqual([]);
    step(engine, 'E');
    expect(engine.getHeldItems()).toEqual(['boots_water']);
    // Melinda has no red key: the door stays shut for her.
    expect(step(engine, 'E')).toBe(false);
    engine.swapPlayer();
    expect(engine.getHeldItems()).toEqual(['key_red']);
  });

  it('applies the rules of each own character: Melinda grips the ice that carries Chip', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 1, y: 4, character: 'melinda' }],
      terrain: [
        [2, 2, 'ice'],
        [2, 4, 'ice']
      ]
    });
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getPlayer().isSliding).toBe(true);
    engine.swapPlayer();
    step(engine, 'E');
    expect(engine.getPlayer().isSliding).toBe(false);
    expect(engine.getPlayer().x).toBe(2);
  });

  it('applies the gender signs to the player that meets them', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 1, y: 4, character: 'melinda' }],
      terrain: [
        [2, 2, 'sign_melinda_only'],
        [2, 4, 'sign_melinda_only']
      ]
    });
    const engine = start(level);
    expect(step(engine, 'E')).toBe(false);
    engine.swapPlayer();
    expect(step(engine, 'E')).toBe(true);
  });

  it('switches only the character that arrives on a transmogrifier', () => {
    const level = room({
      chip: { x: 1, y: 2 },
      others: [{ x: 1, y: 4, character: 'melinda' }],
      terrain: [[2, 2, 'transmogrifier']]
    });
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getPlayerCharacter()).toBe('melinda');
    engine.swapPlayer();
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.getParkedPlayers()?.[0].character).toBe('melinda');
  });
});

describe('undo and replay across a swap', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('undoes the swap as one step, with each player as it was', () => {
    const engine = start(room(TWO_PLAYERS));
    engine.swapPlayer();
    step(engine, 'W');
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 3 });
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 3 });
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 2 });
    expect(engine.getPlayerCharacter()).toBe('chip');
    expect(engine.getParkedPlayers()?.map((p) => [p.x, p.y, p.character])).toEqual([[8, 3, 'melinda']]);
  });

  it('restores the players that left through an exit', () => {
    const engine = start(room({ chip: { x: 1, y: 2 }, others: [{ x: 3, y: 2, character: 'melinda' }], terrain: [[2, 2, 'exit']] }));
    step(engine, 'E');
    expect(engine.getExitedPlayers()).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getExitedPlayers()).toBe(0);
    expect(engine.getPlayer()).toMatchObject({ x: 1, y: 2 });
    expect(engine.getParkedPlayers()?.length).toBe(1);
  });

  it('replays a recorded solution that contains a swap', () => {
    const level = room(TWO_PLAYERS);
    const recorded = start(level);
    step(recorded, 'E');
    recorded.swapPlayer();
    step(recorded, 'W');
    recorded.swapPlayer();
    step(recorded, 'S');
    wait(recorded, COOLDOWN_TICKS);
    const history: TimedMove[] = recorded.getTimedMoveHistory();
    expect(history.some((m) => m.swap === true)).toBe(true);

    const replay = start(level);
    let index = 0;
    for (let i = 0; i < REPLAY_TICK_CAP && index < history.length; i++) {
      const { due, nextIndex } = collectDueMoves(history, index, replay.getTick());
      for (const move of due) {
        if (move.swap === true) replay.swapPlayer();
        else replay.attemptPlayerMove(move.dir);
      }
      index = nextIndex;
      replay.tick();
    }
    expect(replay.getPlayer()).toMatchObject({ x: 3, y: 3 });
    expect(replay.getPlayer()).toMatchObject({ x: recorded.getPlayer().x, y: recorded.getPlayer().y });
    expect(replay.getParkedPlayers()?.map((p) => [p.x, p.y])).toEqual(recorded.getParkedPlayers()?.map((p) => [p.x, p.y]));
  });

  it('keeps native levels as they were: no extra state in snapshots, keys or hashes', () => {
    const level = room(TWO_PLAYERS);
    delete level.extraPlayers;
    const engine = start(level);
    const snapshot = engine.captureState();
    expect(Object.keys(snapshot)).not.toContain('parked');
    expect(Object.keys(snapshot)).not.toContain('exitedPlayers');
    expect(snapshot.player.character).toBeUndefined();
    expect(engine.getParkedPlayers()).toBeUndefined();
    expect(engine.getExitedPlayers()).toBeUndefined();
    expect(engine.getRuntimeKeyExtra()).toBe('');
  });

  it('tells search states apart by the other players', () => {
    const engine = start(room(TWO_PLAYERS));
    const before = engine.getRuntimeKeyExtra();
    expect(before).not.toBe('');
    engine.swapPlayer();
    expect(engine.getRuntimeKeyExtra()).not.toBe(before);
  });
});

describe('the level data of several players', () => {
  it('keeps valid starts and drops the ones that break a rule', () => {
    const start0 = { x: 1, y: 1 };
    const kept = normalizeExtraPlayers(
      [
        { x: 2, y: 2, dir: 'N', character: 'melinda' },
        { x: 2, y: 2, dir: 'S', character: 'chip' },
        { x: 1, y: 1, dir: 'E', character: 'chip' },
        { x: 99, y: 1, dir: 'E', character: 'chip' },
        { x: 3, y: 3, dir: 'X', character: 'chip' },
        { x: 4, y: 4, dir: 'W', character: 'nobody' },
        { x: 5, y: 1, dir: 'W', character: 'chip' }
      ],
      start0,
      ROOM_WIDTH,
      ROOM_HEIGHT
    );
    expect(kept).toEqual<ExtraPlayerStart[]>([
      { x: 2, y: 2, dir: 'N', character: 'melinda' },
      { x: 5, y: 1, dir: 'W', character: 'chip' }
    ]);
  });

  it('carries no field when nothing valid remains or the value is not a list', () => {
    expect(normalizeExtraPlayers([], { x: 1, y: 1 }, ROOM_WIDTH, ROOM_HEIGHT)).toBeNull();
    expect(normalizeExtraPlayers('no', { x: 1, y: 1 }, ROOM_WIDTH, ROOM_HEIGHT)).toBeNull();
    expect(normalizeExtraPlayers(undefined, { x: 1, y: 1 }, ROOM_WIDTH, ROOM_HEIGHT)).toBeNull();
  });

  it('is cleaned in a stored level and left alone when valid', () => {
    loadTestConfigs();
    const level = room(TWO_PLAYERS);
    expect(stripInvalidTextFields(level)).toBe(level);
    const stale = { ...level, extraPlayers: [{ x: 8, y: 3, dir: 'E', character: 'nobody' }] } as unknown as CompiledLevel;
    expect(stripInvalidTextFields(stale).extraPlayers).toBeUndefined();
  });
});
