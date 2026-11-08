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

// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import game from '../../public/configs/game.json';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, Direction, KeybindingsConfig, PlayerCharacter, TimedMove } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  PLAYER_CURRENT_KEY,
  PLAYER_SUMMARY_KEY,
  playersState,
  renderPlayersHud,
  SWAP_DONE_KEY,
  SWAP_REFUSED_KEY,
  swapPlayers,
  type PlayersHudElements
} from './playerSwap';
import { applyTimedMove, collectDueMoves } from './replaySchedule';

const ROOM_WIDTH = 12;
const ROOM_HEIGHT = 6;
const COOLDOWN_TICKS = 20;
const REPLAY_TICK_CAP = 4000;
const INDEX_PATH = resolve(__dirname, '../../index.html');
const SWAP_KEY_CODE = 'KeyV';

type Messages = Record<string, unknown>;

/** Looks a dotted key up in a locale file. */
function lookup(messages: Messages, key: string): string {
  let node: unknown = messages;
  for (const part of key.split('.')) node = (node as Messages | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`Missing locale key: ${key}`);
  return node;
}

function textOf(messages: Messages): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => lookup(messages, key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
}

/** A walled room; the first player starts at (2, 2) and the others are parked in order. */
function room(others: Array<{ x: number; y: number; character: PlayerCharacter }>): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_HEIGHT }, (_, y) =>
    Array.from({ length: ROOM_WIDTH }, (_, x) => (x === 0 || y === 0 || x === ROOM_WIDTH - 1 || y === ROOM_HEIGHT - 1 ? 'wall' : 'floor'))
  );
  const items: Array<Array<string | null>> = Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => null));
  return {
    id: 'swap_ui_room',
    number: 1,
    password: 'SWAP',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'E' },
    extraPlayers: others.length === 0 ? undefined : others.map((o) => ({ ...o, dir: 'E' as Direction })),
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function start(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const TWO_PLAYERS = [{ x: 8, y: 3, character: 'melinda' as PlayerCharacter }];

/** Mounts the players HUD and the swap buttons exactly as index.html writes them. */
function mountHud(): PlayersHudElements {
  const html = readFileSync(INDEX_PATH, 'utf8');
  // The head is left out: happy-dom would try to load the stylesheet.
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  const source = new DOMParser().parseFromString(`<body>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</body>`, 'text/html');
  document.body.innerHTML = '';
  for (const id of ['hud-players', 'touch-btn-swap']) {
    const node = source.getElementById(id);
    if (!node) throw new Error(`Not in index.html: ${id}`);
    document.body.appendChild(document.importNode(node, true));
  }
  return {
    container: document.getElementById('hud-players'),
    portrait: document.getElementById('hud-players-portrait') as HTMLImageElement,
    current: document.getElementById('hud-players-current'),
    summary: document.getElementById('hud-players-summary'),
    swapButtons: [document.getElementById('hud-btn-swap'), document.getElementById('touch-btn-swap')]
  };
}

const PORTRAIT = 'data:image/png;base64,AAAA';

describe('swap key binding', () => {
  const keybindings = game.keybindings as KeybindingsConfig;

  it('is bound to a key no other play action uses', () => {
    expect(keybindings.swapPlayer).toEqual([SWAP_KEY_CODE]);
    const others = Object.entries(keybindings)
      .filter(([action]) => action !== 'swapPlayer')
      .flatMap(([, codes]) => codes as string[]);
    expect(others).not.toContain(SWAP_KEY_CODE);
  });

  it('is described in the help of both languages', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    expect(html).toContain('hud.help_modal.kb_swap.label');
    for (const messages of [en, fr]) {
      expect(lookup(messages, 'hud.help_modal.kb_swap.label')).toContain('V');
      for (const key of [SWAP_DONE_KEY, SWAP_REFUSED_KEY, PLAYER_CURRENT_KEY, PLAYER_SUMMARY_KEY, 'hud.touch_overlay.swap.action']) {
        expect(lookup(messages, key)).not.toBe('');
      }
    }
  });
});

describe('swapping from the page', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('does nothing on a level with one player', () => {
    const engine = start(room([]));
    expect(playersState(engine)).toBeNull();
    expect(swapPlayers(engine)).toEqual({ kind: 'unavailable' });
    expect(engine.getTimedMoveHistory().some((m) => m.swap === true)).toBe(false);
  });

  it('hands control to the next player and says who plays', () => {
    const engine = start(room(TWO_PLAYERS));
    const outcome = swapPlayers(engine);
    expect(outcome.kind).toBe('swapped');
    if (outcome.kind !== 'swapped') return;
    expect(outcome.state).toMatchObject({ character: 'melinda', remaining: 2, exited: 0 });
    expect(engine.getPlayer()).toMatchObject({ x: 8, y: 3 });
  });

  it('is blocked, without a refusal message, while the engine is paused', () => {
    const engine = start(room(TWO_PLAYERS));
    engine.setPaused(true);
    expect(swapPlayers(engine)).toEqual({ kind: 'blocked' });
  });

  it('reads the inventory of the controlled player', () => {
    const level = room(TWO_PLAYERS);
    level.items[2][3] = 'key_red';
    const engine = start(level);
    for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
    engine.attemptPlayerMove('E');
    for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
    expect(engine.holdsItem('key_red')).toBe(true);
    swapPlayers(engine);
    expect(engine.holdsItem('key_red')).toBe(false);
    swapPlayers(engine);
    expect(engine.holdsItem('key_red')).toBe(true);
  });
});

describe('players HUD', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('shows the swap buttons and the HUD only on a level with several players', () => {
    const els = mountHud();
    const text = textOf(en);

    expect(renderPlayersHud(els, playersState(start(room([]))), text, PORTRAIT)).toBe(false);
    expect(els.container?.classList.contains('hidden')).toBe(true);
    for (const button of els.swapButtons) expect(button?.classList.contains('hidden')).toBe(true);

    expect(renderPlayersHud(els, playersState(start(room(TWO_PLAYERS))), text, PORTRAIT)).toBe(true);
    expect(els.container?.classList.contains('hidden')).toBe(false);
    for (const button of els.swapButtons) expect(button?.classList.contains('hidden')).toBe(false);
  });

  it('names the controlled player and counts those remaining and out', () => {
    const els = mountHud();
    const text = textOf(en);
    const engine = start(room(TWO_PLAYERS));

    renderPlayersHud(els, playersState(engine), text, PORTRAIT);
    expect(els.current?.textContent).toBe('Player: Chip');
    expect(els.summary?.textContent).toBe('2 on the map, 0 out');
    expect(els.portrait?.getAttribute('src')).toBe(PORTRAIT);

    swapPlayers(engine);
    renderPlayersHud(els, playersState(engine), text, PORTRAIT);
    expect(els.current?.textContent).toBe('Player: Melinda');
  });

  it('is written in French too', () => {
    const els = mountHud();
    renderPlayersHud(els, playersState(start(room(TWO_PLAYERS))), textOf(fr), PORTRAIT);
    expect(els.current?.textContent).toBe('Joueur : Chip');
    expect(els.summary?.textContent).toBe('2 sur la carte, 0 sortis');
  });

  it('counts a player that left through an exit', () => {
    const level = room(TWO_PLAYERS);
    level.terrain[2][3] = 'exit';
    const els = mountHud();
    const engine = start(level);
    for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
    engine.attemptPlayerMove('E');
    for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
    const state = playersState(engine);
    expect(state).toMatchObject({ remaining: 1, exited: 1, character: 'melinda' });
    renderPlayersHud(els, state, textOf(en), PORTRAIT);
    expect(els.summary?.textContent).toBe('1 on the map, 1 out');
    // Nobody else is on the map: the swap buttons stay but cannot be pressed.
    for (const button of els.swapButtons) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(swapPlayers(engine)).toEqual({ kind: 'refused' });
  });
});

describe('replay across a swap', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('replays a recorded swap through the page helper', () => {
    const level = room(TWO_PLAYERS);
    const recorded = start(level);
    const move = (engine: GameEngine, dir: Direction): void => {
      for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
      engine.attemptPlayerMove(dir);
      engine.tick();
    };
    move(recorded, 'E');
    swapPlayers(recorded);
    move(recorded, 'W');
    swapPlayers(recorded);
    move(recorded, 'S');
    const history: TimedMove[] = recorded.getTimedMoveHistory();
    expect(history.filter((m) => m.swap === true)).toHaveLength(2);

    const replay = start(level);
    let index = 0;
    for (let i = 0; i < REPLAY_TICK_CAP && index < history.length; i++) {
      const { due, nextIndex } = collectDueMoves(history, index, replay.getTick());
      for (const timed of due) applyTimedMove(replay, timed);
      index = nextIndex;
      replay.tick();
    }
    expect(replay.getPlayer()).toMatchObject({ x: recorded.getPlayer().x, y: recorded.getPlayer().y });
    expect(replay.getParkedPlayers()?.map((p) => [p.x, p.y])).toEqual(recorded.getParkedPlayers()?.map((p) => [p.x, p.y]));
  });
});
