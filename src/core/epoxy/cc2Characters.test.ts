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
 * The Chip's Challenge 2 items and characters of the Epoxy rules: the green chip and bomb that the green button swaps,
 * the steel wall, Melinda (no sliding on ice, hiking boots on dirt and gravel) and the gender signs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findCharacterItemConfigErrors, stripInvalidTextFields } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13, PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import { datRefusalReason } from '../../formats/DatCodec';
import { serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { CompiledLevel, Direction, PlayerCharacter, TileDefinition } from '../types';

const SIGN_CHIP = 'sign_chip_only';
const SIGN_MELINDA = 'sign_melinda_only';
const GREEN_BUTTON = 'button_green';
const ROOM_WIDTH = 9;
const ROOM_HEIGHT = 5;
/** Ticks that outlast the move cooldown of the player. */
const COOLDOWN_TICKS = 20;
/** Ticks that outlast any slide or fuse of these rooms. */
const SETTLE_TICKS = 200;

/** A walled room with the player at (1, 2) facing east. */
function room(character?: PlayerCharacter): CompiledLevel {
  return {
    id: 'cc2_room',
    number: 1,
    password: 'CC2R',
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

function start(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** One step: waits out the move cooldown, tries the move and ticks once. Returns what the move reported. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  const moved = engine.attemptPlayerMove(dir);
  engine.tick();
  return moved;
}

/** Lets slides and fuses run out. */
function settle(engine: GameEngine): void {
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
}

describe('green chip and green bomb', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('counts a green chip toward the chips required and takes it off the floor', () => {
    const level = room();
    level.chipsRequired = 1;
    level.items[2][2] = 'green_chip';
    const engine = start(level);
    expect(engine.getChipsRemaining()).toBe(1);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
    expect(engine.getItems()[2][2]).toBeNull();
  });

  it('keeps a chip that does not count as a chip out of the total', () => {
    const level = room();
    level.chipsRequired = 1;
    level.items[2][2] = 'green_chip';
    const engine = start(level);
    const tile = ConfigRegistry.getTile('green_chip') as TileDefinition;
    const original = tile.countsAsChip;
    tile.countsAsChip = false;
    try {
      step(engine, 'E');
      expect(engine.getChipsRemaining()).toBe(1);
      expect(engine.getItems()[2][2]).toBeNull();
    } finally {
      tile.countsAsChip = original;
    }
  });

  it('kills the player on a green bomb, as a bomb does', () => {
    const level = room();
    level.items[2][2] = 'green_bomb';
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('swaps every green chip and green bomb of the level at each press of a green button, and nothing else', () => {
    const level = room();
    level.terrain[2][2] = GREEN_BUTTON;
    level.items[1][5] = 'green_chip';
    level.items[3][6] = 'green_bomb';
    level.items[1][7] = 'chip';
    level.items[3][3] = 'bomb';
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getItems()[1][5]).toBe('green_bomb');
    expect(engine.getItems()[3][6]).toBe('green_chip');
    expect(engine.getItems()[1][7]).toBe('chip');
    expect(engine.getItems()[3][3]).toBe('bomb');
    step(engine, 'W');
    step(engine, 'E');
    expect(engine.getItems()[1][5]).toBe('green_chip');
    expect(engine.getItems()[3][6]).toBe('green_bomb');
  });

  it('turns a green bomb into a safe green chip when the button is pressed first', () => {
    const level = room();
    level.chipsRequired = 1;
    level.terrain[2][2] = GREEN_BUTTON;
    level.items[2][3] = 'green_bomb';
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getItems()[2][3]).toBe('green_chip');
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getChipsRemaining()).toBe(0);
  });

  it('names a partner that names it back, in the shipped config', () => {
    expect(ConfigRegistry.getTile('green_chip').itemTogglesTo).toBe('green_bomb');
    expect(ConfigRegistry.getTile('green_bomb').itemTogglesTo).toBe('green_chip');
    expect(findCharacterItemConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
  });
});

describe('config checks of the items and character fields', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('refuses a toggling item whose partner does not toggle back', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    tiles.green_bomb.itemTogglesTo = 'chip';
    expect(findCharacterItemConfigErrors(tiles).join()).toContain('green_chip.itemTogglesTo');
  });

  it('refuses a chip flag off a chip, a character bar off a boot and an unknown character', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    tiles.bomb.countsAsChip = true;
    tiles.dirt.bootsForCharacter = { melinda: 'chip' };
    tiles.wall.characterOnly = 'nobody' as PlayerCharacter;
    const errors = findCharacterItemConfigErrors(tiles).join();
    expect(errors).toContain('bomb.countsAsChip');
    expect(errors).toContain('dirt.bootsForCharacter.melinda');
    expect(errors).toContain('wall.characterOnly');
  });
});

describe('steel wall', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('is a solid wall that no blast can destroy', () => {
    const tile = ConfigRegistry.getTile('steel_wall');
    expect(tile.blastProof).toBe(true);
    expect(tile.passableByPlayer).toBe(false);
    expect(tile.passableByMonster).toBe(false);
    expect(tile.passableByBlock).toBe(false);
    expect(tile.laserTransparent).toBe(false);
  });

  it('stays in place when a blast charge goes off beside it, and stops the player', () => {
    const level = room();
    level.terrain[1][3] = 'steel_wall';
    level.items[2][2] = 'charge';
    const engine = start(level);
    step(engine, 'E');
    expect(engine.dropItem('charge')).toBe(true);
    // Out of the blast: it reaches one cell around the charge.
    step(engine, 'E');
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getTerrain()[1][3]).toBe('steel_wall');
    step(engine, 'W');
    expect(engine.getPlayer()).toMatchObject({ x: 3, y: 2 });
    expect(step(engine, 'N')).toBe(false);
    expect(engine.getPlayer().y).toBe(2);
  });
});

describe('Melinda on ice', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function iceRoom(character?: PlayerCharacter): CompiledLevel {
    const level = room(character);
    for (let x = 2; x <= 6; x++) level.terrain[2][x] = 'ice';
    return level;
  }

  it('slides Chip across the ice to the end of the strip', () => {
    const engine = start(iceRoom());
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer().x).toBe(7);
  });

  it('walks Melinda over the ice one cell per step, as the ice skates do for Chip', () => {
    const engine = start(iceRoom('melinda'));
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer().x).toBe(2);
    expect(engine.getPlayer().isSliding).toBe(false);
  });

  it('treats an ice corner as plain floor for Melinda', () => {
    const level = room('melinda');
    level.terrain[2][2] = 'ice_se';
    const engine = start(level);
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: 2, y: 2 });
  });

  it('keeps the slide of Chip when the level names Chip', () => {
    const engine = start(iceRoom('chip'));
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer().x).toBe(7);
  });
});

describe('Melinda on dirt and gravel', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('walks Chip over dirt and gravel with no boots', () => {
    for (const tile of ['dirt', 'gravel']) {
      const level = room();
      level.terrain[2][2] = tile;
      const engine = start(level);
      expect(step(engine, 'E'), tile).toBe(true);
      expect(engine.getPlayer().x, tile).toBe(2);
    }
  });

  it('stops Melinda at dirt and gravel until she wears hiking boots', () => {
    for (const tile of ['dirt', 'gravel']) {
      const level = room('melinda');
      level.terrain[2][2] = tile;
      const engine = start(level);
      expect(step(engine, 'E'), tile).toBe(false);
      expect(engine.getPlayer().x, tile).toBe(1);
      engine.getPlayer().boots.add('hiking_boots');
      expect(step(engine, 'E'), tile).toBe(true);
      expect(engine.getPlayer().x, tile).toBe(2);
    }
  });

  it('lets Melinda pick the hiking boots up and cross the dirt', () => {
    const level = room('melinda');
    level.items[2][2] = 'hiking_boots';
    level.terrain[2][3] = 'dirt';
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getPlayer().boots.has('hiking_boots')).toBe(true);
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer().x).toBe(3);
  });

  it('does nothing for Chip: the boots change neither his slide nor his steps', () => {
    const level = room();
    for (let x = 2; x <= 6; x++) level.terrain[2][x] = 'ice';
    const engine = start(level);
    engine.getPlayer().boots.add('hiking_boots');
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer().x).toBe(7);
  });
});

describe('gender signs', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('lets only the character it names step on a sign', () => {
    const cases: Array<[PlayerCharacter | undefined, string, boolean]> = [
      [undefined, SIGN_CHIP, true],
      [undefined, SIGN_MELINDA, false],
      ['melinda', SIGN_MELINDA, true],
      ['melinda', SIGN_CHIP, false]
    ];
    for (const [character, sign, walks] of cases) {
      const level = room(character);
      level.terrain[2][2] = sign;
      const engine = start(level);
      expect(step(engine, 'E'), `${character ?? 'chip'} on ${sign}`).toBe(walks);
      expect(engine.getPlayer().x).toBe(walks ? 2 : 1);
    }
  });

  it('does not bar a monster or a block: a sign is a wall for the other character only', () => {
    for (const sign of [SIGN_CHIP, SIGN_MELINDA]) {
      const tile = ConfigRegistry.getTile(sign);
      expect(tile.passableByMonster, sign).toBe(true);
      expect(tile.passableByBlock, sign).toBe(true);
    }
  });

  it('lets a block pushed by Chip cross a sign for Melinda', () => {
    const level = room();
    level.terrain[2][3] = SIGN_MELINDA;
    level.entities = [{ type: 'dirt_block', x: 2, y: 2, dir: 'E' }];
    const engine = start(level);
    step(engine, 'E');
    expect(engine.getEntities()[0]).toMatchObject({ x: 3, y: 2 });
  });
});

describe('the character of a level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('drops an unknown character from a stored level and keeps a known one', () => {
    const stripped = stripInvalidTextFields({ ...room(), character: 'nobody' as PlayerCharacter });
    expect('character' in stripped).toBe(false);
    expect('character' in stripInvalidTextFields({ ...room(), character: 'melinda' })).toBe(true);
  });

  it('refuses a DAT export of a level played by Melinda and not of one played by Chip', () => {
    expect(datRefusalReason(room('melinda'))).toBe('melinda_character');
    expect(datRefusalReason(room('chip'))).toBeNull();
    expect(datRefusalReason(room())).toBeNull();
  });

  it('writes a pack at format 13 only when a level is played by Melinda or holds the new ids', () => {
    const versionOf = (level: CompiledLevel): number => (JSON.parse(serializePack('N', [level])) as { version: number }).version;
    expect(versionOf(room())).toBeLessThan(PACK_JSON_VERSION_V13);
    expect(versionOf(room('chip'))).toBeLessThan(PACK_JSON_VERSION_V13);
    expect(versionOf(room('melinda'))).toBe(PACK_JSON_VERSION_V13);
    for (const id of ['green_chip', 'green_bomb', 'steel_wall', 'hiking_boots', SIGN_CHIP, SIGN_MELINDA]) {
      expect(PACK_JSON_VERSION_V13_IDS.has(id), id).toBe(true);
    }
    const withItem = room();
    withItem.items[1][1] = 'hiking_boots';
    expect(versionOf(withItem)).toBe(PACK_JSON_VERSION_V13);
  });
});

describe('the validator and the new content', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const UNREACHABLE = ['validator.issues.unreachable_exit.label', 'validator.issues.unreachable_exit_proven.label'];

  /** A room split by a wall column whose only gap holds `tile`, with the exit on the far side. */
  function exitBehind(tile: string, character?: PlayerCharacter, boots = false): CompiledLevel {
    const level = room(character);
    for (let y = 1; y <= 3; y++) level.terrain[y][4] = 'wall';
    level.terrain[2][4] = tile;
    level.terrain[2][7] = 'exit';
    if (boots) level.items[1][2] = 'hiking_boots';
    return level;
  }

  const unreachable = (level: CompiledLevel): boolean =>
    LevelValidator.validate(level).issues.some((issue) => UNREACHABLE.includes(issue.i18nKey));

  it('reaches an exit behind dirt for Chip but not for Melinda without hiking boots', () => {
    expect(unreachable(exitBehind('dirt'))).toBe(false);
    expect(unreachable(exitBehind('dirt', 'melinda'))).toBe(true);
    expect(unreachable(exitBehind('gravel', 'melinda'))).toBe(true);
  });

  it('reaches the exit behind dirt once Melinda can reach hiking boots', () => {
    expect(unreachable(exitBehind('dirt', 'melinda', true))).toBe(false);
    expect(unreachable(exitBehind('gravel', 'melinda', true))).toBe(false);
  });

  it('takes a sign of the other character as a wall and the sign of her own as floor', () => {
    expect(unreachable(exitBehind(SIGN_MELINDA, 'melinda'))).toBe(false);
    expect(unreachable(exitBehind(SIGN_CHIP, 'melinda'))).toBe(true);
    expect(unreachable(exitBehind(SIGN_CHIP))).toBe(false);
    expect(unreachable(exitBehind(SIGN_MELINDA))).toBe(true);
  });

  it('reaches an exit that only a stop on the ice leads to, for Melinda, whom the ice does not carry off', () => {
    const build = (character?: PlayerCharacter): CompiledLevel => {
      const level = room(character);
      // The ice strip runs into water; the exit lies below its first cell and has no other way in.
      level.terrain[2][2] = 'ice';
      level.terrain[2][3] = 'ice';
      level.terrain[2][4] = 'water';
      for (const [x, y] of [[2, 1], [3, 1], [4, 1], [1, 3], [3, 3], [4, 3]]) level.terrain[y][x] = 'wall';
      level.terrain[3][2] = 'exit';
      return level;
    };
    expect(unreachable(build())).toBe(true);
    expect(unreachable(build('melinda'))).toBe(false);
  });

  it('counts a green bomb as a chip when the level has a green button, since the button may turn it into one', () => {
    const level = room();
    level.chipsRequired = 2;
    level.terrain[1][1] = GREEN_BUTTON;
    level.items[1][2] = 'green_chip';
    level.items[1][3] = 'green_bomb';
    level.terrain[3][7] = 'exit';
    const issues = LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);
    expect(issues).not.toContain('validator.issues.missing_chips.label');
  });

  it('keeps a green bomb a bomb when the level has no green button', () => {
    const level = room();
    level.chipsRequired = 2;
    level.items[1][2] = 'green_chip';
    level.items[1][3] = 'green_bomb';
    level.terrain[3][7] = 'exit';
    const issues = LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);
    expect(issues).toContain('validator.issues.missing_chips.label');
  });
});
