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
 * A transmogrifier switches the player between Chip and Melinda on arrival, as Lexy's Labyrinth does (tiletypes.js:
 * `transmogrifier.on_arrive` turns a `player` into `player2` and back through `transmogrifies_into`). The character
 * is runtime state: the level's character at load, kept in the undo snapshot and the search key only while it differs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { CompiledLevel, Direction, PlayerCharacter } from '../types';

const TRANSMOG = 'transmogrifier';
const SIGN_CHIP = 'sign_chip_only';
const SIGN_MELINDA = 'sign_melinda_only';
const ROOM_WIDTH = 9;
const ROOM_HEIGHT = 5;
const PAD_X = 2;
const COOLDOWN_TICKS = 20;
const SETTLE_TICKS = 200;

/** A walled room with the player at (1, 2) facing east. */
function room(character?: PlayerCharacter): CompiledLevel {
  return {
    id: 'player_transmogrify_room',
    number: 1,
    password: 'PTMG',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 2, dir: 'E' },
    terrain: Array.from({ length: ROOM_HEIGHT }, (_, y) =>
      Array.from({ length: ROOM_WIDTH }, (_, x) => (x === 0 || y === 0 || x === ROOM_WIDTH - 1 || y === ROOM_HEIGHT - 1 ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(character !== undefined ? { character } : {})
  };
}

/** A room with a transmogrifier right after the start cell. */
function padRoom(character?: PlayerCharacter): CompiledLevel {
  const level = room(character);
  level.terrain[2][PAD_X] = TRANSMOG;
  return level;
}

function start(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  const moved = engine.attemptPlayerMove(dir);
  engine.tick();
  return moved;
}

function settle(engine: GameEngine): void {
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

describe('player on a transmogrifier', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('turns Chip into Melinda on arrival', () => {
    const engine = start(padRoom());
    expect(engine.getPlayerCharacter()).toBe('chip');
    step(engine, 'E');
    expect(engine.getPlayerCharacter()).toBe('melinda');
  });

  it('turns Melinda into Chip on arrival', () => {
    const engine = start(padRoom('melinda'));
    step(engine, 'E');
    expect(engine.getPlayerCharacter()).toBe('chip');
  });

  it('switches back on the next arrival, and does not switch while merely standing there', () => {
    const level = padRoom();
    level.terrain[2][PAD_X + 1] = TRANSMOG;
    const engine = start(level);
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayerCharacter()).toBe('melinda');
    step(engine, 'E');
    expect(engine.getPlayerCharacter()).toBe('chip');
  });

  it('applies the gender signs of the new character', () => {
    const chipThenMelindaSign = padRoom();
    chipThenMelindaSign.terrain[2][PAD_X + 1] = SIGN_MELINDA;
    const engine = start(chipThenMelindaSign);
    step(engine, 'E');
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(PAD_X + 1);

    const chipThenChipSign = padRoom();
    chipThenChipSign.terrain[2][PAD_X + 1] = SIGN_CHIP;
    const blocked = start(chipThenChipSign);
    step(blocked, 'E');
    expect(step(blocked, 'E')).toBe(false);
    expect(blocked.getPlayer().x).toBe(PAD_X);
  });

  it('stops the slide of the new Melinda on ice and starts the slide of the new Chip', () => {
    const asChip = padRoom();
    for (let x = PAD_X + 1; x <= 6; x++) asChip.terrain[2][x] = 'ice';
    const melinda = start(asChip);
    step(melinda, 'E');
    step(melinda, 'E');
    settle(melinda);
    expect(melinda.getPlayer().x).toBe(PAD_X + 1);

    const asMelinda = padRoom('melinda');
    for (let x = PAD_X + 1; x <= 6; x++) asMelinda.terrain[2][x] = 'ice';
    const chip = start(asMelinda);
    step(chip, 'E');
    step(chip, 'E');
    settle(chip);
    expect(chip.getPlayer().x).toBe(7);
  });

  it('asks the new Melinda for hiking boots on dirt, and lets the new Chip over it', () => {
    const chipLevel = padRoom();
    chipLevel.terrain[2][PAD_X + 1] = 'dirt';
    const melinda = start(chipLevel);
    step(melinda, 'E');
    expect(step(melinda, 'E')).toBe(false);
    melinda.getPlayer().boots.add('hiking_boots');
    expect(step(melinda, 'E')).toBe(true);

    const melindaLevel = padRoom('melinda');
    melindaLevel.terrain[2][PAD_X + 1] = 'dirt';
    const chip = start(melindaLevel);
    step(chip, 'E');
    expect(step(chip, 'E')).toBe(true);
  });

  it('puts the character back on undo and keeps it out of snapshots that never switched', () => {
    const engine = start(padRoom());
    const before = engine.captureState();
    expect(before.playerCharacter).toBeUndefined();
    step(engine, 'E');
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.captureState().playerCharacter).toBe('melinda');
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayerCharacter()).toBe('chip');
    expect(engine.getPlayerCharacterSwitch()).toBeUndefined();
  });

  it('restores a switched character from a saved state and a plain one from a state without it', () => {
    const engine = start(padRoom('melinda'));
    const initial = engine.captureState();
    step(engine, 'E');
    const switched = engine.captureState();
    engine.restoreState(initial);
    expect(engine.getPlayerCharacter()).toBe('melinda');
    engine.restoreState(switched);
    expect(engine.getPlayerCharacter()).toBe('chip');
  });

  it('tells search states apart only once the character differs from the level character', () => {
    const plain = start(padRoom());
    const baseKey = plain.getRuntimeKeyExtra();
    expect(baseKey).toBe('');
    step(plain, 'E');
    expect(plain.getRuntimeKeyExtra()).not.toBe(baseKey);
    expect(plain.getPlayerCharacterSwitch()).toBe('melinda');

    const native = start(room());
    expect(native.getRuntimeKeyExtra()).toBe('');
    expect(native.getPlayerCharacterSwitch()).toBeUndefined();
  });

  it('keeps a character the level names when no transmogrifier is stepped on', () => {
    const engine = start(padRoom('melinda'));
    settle(engine);
    expect(engine.getPlayerCharacter()).toBe('melinda');
    expect(engine.getPlayerCharacterSwitch()).toBeUndefined();
  });
});

describe('validator with a transmogrifier', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const UNREACHABLE = ['validator.issues.unreachable_exit.label', 'validator.issues.unreachable_exit_proven.label'];

  /** A room split by a wall column whose only gap holds `tile`, the exit on the far side, a transmogrifier before the gap. */
  function exitBehind(tile: string, character?: PlayerCharacter, withPad = true): CompiledLevel {
    const level = room(character);
    for (let y = 1; y <= 3; y++) level.terrain[y][4] = 'wall';
    level.terrain[2][4] = tile;
    level.terrain[2][7] = 'exit';
    if (withPad) level.terrain[2][PAD_X] = TRANSMOG;
    return level;
  }

  const unreachable = (level: CompiledLevel): boolean =>
    LevelValidator.validate(level).issues.some((issue) => UNREACHABLE.includes(issue.i18nKey));

  it('does not call a Melinda sign unwinnable for a Chip who can cross a transmogrifier', () => {
    expect(unreachable(exitBehind(SIGN_MELINDA, undefined, false))).toBe(true);
    expect(unreachable(exitBehind(SIGN_MELINDA))).toBe(false);
    expect(unreachable(exitBehind(SIGN_CHIP))).toBe(false);
  });

  it('relaxes the dirt rule of a Melinda level that holds a transmogrifier', () => {
    expect(unreachable(exitBehind('dirt', 'melinda', false))).toBe(true);
    expect(unreachable(exitBehind('dirt', 'melinda'))).toBe(false);
  });
});
