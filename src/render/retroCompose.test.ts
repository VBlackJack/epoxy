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

import { describe, expect, it } from 'vitest';
import composeSource from './retroCompose.ts?raw';
import { createTestBundle } from '../test/loadTestConfigs';
import { NEIGHBOUR } from './tileNeighbours';
import {
  applyRetroShadow,
  composeRetroLayers,
  RETRO_FRAME_COUNTS,
  retroBonusLabel,
  retroItemLayers,
  retroLabelLayers,
  retroLayersKey,
  retroMonsterSprite,
  retroPlayerSprite,
  retroShadowExtent,
  retroShadowSignature,
  retroThinLayers,
  retroTileLayers,
  retroWallLayers,
  RetroPass,
  RetroTileInput
} from './retroCompose';
import { resolveRetroRamps, RETRO_SHEET, RETRO_SPRITE_NAMES, RETRO_SPRITE_SIZE } from './retroSprites';
import { RETRO_SPRITE } from './retroSpriteNames';

const bundle = createTestBundle();
const tiles = bundle.tiles.tiles;
const resolve = (id: string) => tiles[id] ?? tiles.floor;
const BYTES = 4;
const OPEN = 0;
const ALL_JOINED = NEIGHBOUR.N | NEIGHBOUR.E | NEIGHBOUR.S | NEIGHBOUR.W;
/** A hash that shows no floor detail with floorDetailEvery 5, and one that shows kind 1 (2560 / 256 = 10, 10 % 3 = 1). */
const NO_DETAIL_HASH = 1;
const DETAIL_HASH = 2560;
const EVERY = 5;

function layersOf(tileId: string, over: Partial<RetroTileInput> = {}): string[] {
  const input: RetroTileInput = {
    tileId,
    def: resolve(tileId),
    resolve,
    pass: 'all',
    hash: NO_DETAIL_HASH,
    wallMask: OPEN,
    floorDetailEvery: EVERY,
    isEditor: false,
    revealHiddenWalls: false,
    isClosedTrap: true,
    phase: 0,
    reducedMotion: false,
    ...over
  };
  return retroTileLayers(input).map((l) => l.name);
}

describe('retro tile composition', () => {
  it('stacks wall rims and front by open sides', () => {
    expect(retroWallLayers(OPEN).map((l) => l.name)).toEqual([
      'wall_top',
      'wall_rim_n',
      'wall_rim_w',
      'wall_rim_e',
      'wall_front'
    ]);
    expect(retroWallLayers(ALL_JOINED).map((l) => l.name)).toEqual(['wall_top']);
    expect(retroWallLayers(ALL_JOINED & ~NEIGHBOUR.S).map((l) => l.name)).toEqual(['wall_top', 'wall_front']);
    expect(retroWallLayers(ALL_JOINED & ~NEIGHBOUR.E).map((l) => l.name)).toEqual(['wall_top', 'wall_rim_e']);
  });

  it('draws one thin panel per blocked edge over the floor', () => {
    expect(layersOf('thin_wall_ne')).toEqual(['floor', 'thin_n', 'thin_e']);
    expect(layersOf('thin_wall_nesw')).toEqual(['floor', 'thin_n', 'thin_e', 'thin_s', 'thin_w']);
    expect(retroThinLayers(['W']).map((l) => l.name)).toEqual(['floor', 'thin_w']);
  });

  it('picks the floor detail from the hash as the old renderer did', () => {
    expect(layersOf('floor')).toEqual(['floor']);
    expect(layersOf('floor', { hash: DETAIL_HASH })).toEqual(['floor', 'floor_detail_1']);
  });

  it('makes hidden walls look like floor, with a marker in the editor only', () => {
    expect(layersOf('invisible_wall')).toEqual(layersOf('floor'));
    expect(layersOf('invisible_wall', { isEditor: true })).toEqual(['floor', 'hidden_wall_marker']);
    expect(layersOf('appearing_wall', { isEditor: true })).toEqual(['floor', 'appearing_wall_marker']);
    expect(layersOf('blue_wall_fake')).toEqual(['blue_wall']);
    expect(layersOf('blue_wall_fake', { isEditor: true })).toEqual(['blue_wall', 'blue_wall_fake_marker']);
    expect(layersOf('blue_wall_real', { isEditor: true })).toEqual(['blue_wall']);
  });

  it('marks the invisible and appearing walls, but never the fake blue wall, while the eye boots are held', () => {
    const revealed = { revealHiddenWalls: true };
    expect(layersOf('invisible_wall', revealed)).toEqual(['floor', 'hidden_wall_marker']);
    expect(layersOf('appearing_wall', revealed)).toEqual(['floor', 'appearing_wall_marker']);
    expect(layersOf('blue_wall_fake', revealed)).toEqual(['blue_wall']);
    expect(layersOf('blue_wall_fake', revealed)).toEqual(layersOf('blue_wall_real', revealed));
    expect(layersOf('invisible_wall', { revealHiddenWalls: false })).toEqual(layersOf('floor'));
  });

  it('colours doors, buttons and keys by swap ramp and stamps the glyph at the centre', () => {
    const door = retroTileLayers({
      tileId: 'door_blue',
      def: tiles.door_blue,
      resolve,
      pass: 'all',
      hash: 0,
      wallMask: 0,
      floorDetailEvery: EVERY,
      isEditor: false,
      revealHiddenWalls: false,
      isClosedTrap: true,
      phase: 0,
      reducedMotion: false
    });
    expect(door.map((l) => l.name)).toEqual(['floor', 'door', 'glyph_blue']);
    expect(door[1].swap).toBe('blue');
    const centre = Math.floor((RETRO_SPRITE_SIZE - 5) / 2);
    expect(door[2]).toMatchObject({ x: centre, y: centre });
    expect(layersOf('button_brown')).toEqual(['floor', 'button', 'glyph_yellow']);
    const key = retroItemLayers('key_green', tiles.key_green);
    expect(key.map((l) => l.name)).toEqual(['key', 'glyph_green']);
    expect(key[0].swap).toBe('green');
  });

  it('colours boots by element and force boots green', () => {
    expect(retroItemLayers('boots_water', tiles.boots_water)[0].swap).toBe('water');
    expect(retroItemLayers('boots_force', tiles.boots_force)[0].swap).toBe('green');
  });

  it('draws forbid tiles as floor, the forbidden item and the sign', () => {
    expect(layersOf('forbid_key_red')).toEqual(['floor', 'key', 'glyph_red', 'forbid_sign']);
    expect(layersOf('forbid_boots_ice')).toEqual(['floor', 'boots', 'forbid_sign']);
  });

  it('colours teleporters and only glyphs the coloured ones', () => {
    const plain = retroTileLayers({
      tileId: 'teleport',
      def: tiles.teleport,
      resolve,
      pass: 'all',
      hash: 0,
      wallMask: 0,
      floorDetailEvery: EVERY,
      isEditor: false,
      revealHiddenWalls: false,
      isClosedTrap: true,
      phase: 1,
      reducedMotion: false
    });
    expect(plain.map((l) => l.name)).toEqual(['floor', 'teleport_1']);
    expect(plain[1].swap).toBe('teleport');
    expect(layersOf('teleport_red', { phase: 2 })).toEqual(['floor', 'teleport_0', 'glyph_red']);
  });

  it('shows the trap state and the flame jet nozzle', () => {
    expect(layersOf('trap', { isClosedTrap: true })).toEqual(['floor', 'trap_closed']);
    expect(layersOf('trap', { isClosedTrap: false })).toEqual(['floor', 'trap_open']);
    expect(layersOf('flame_jet_off')).toEqual(['floor', 'flame_jet_nozzle']);
    expect(layersOf('flame_jet_on', { phase: 4 })).toEqual(['fire_1', 'flame_jet_nozzle']);
  });

  it('keeps only the floor of animated tiles in the static pass and draws frames in the animated pass', () => {
    for (const id of ['water', 'fire', 'exit', 'turtle', 'force_n', 'force_random', 'teleport_blue']) {
      expect(layersOf(id, { pass: 'static' as RetroPass }), id).toEqual(['floor']);
      expect(layersOf(id, { pass: 'animated' as RetroPass }).length, id).toBeGreaterThan(0);
    }
    expect(layersOf('wall', { pass: 'animated' })).toEqual([]);
    expect(layersOf('dirt', { pass: 'animated' })).toEqual([]);
    expect(layersOf('water', { pass: 'animated', phase: 3 })).toEqual(['water_3']);
    expect(layersOf('turtle', { pass: 'animated', phase: 1 })).toEqual(['water_1', 'turtle']);
    expect(layersOf('exit', { pass: 'animated', phase: 3 })).toEqual(['floor', 'exit_1']);
  });

  it('scrolls force floors with the phase and freezes them under reduced motion', () => {
    expect(layersOf('force_e', { phase: 2 })).toEqual(['floor', 'force_e_2']);
    expect(layersOf('force_e', { phase: 2, reducedMotion: true })).toEqual(['floor', 'force_e_0']);
    expect(layersOf('force_random', { phase: 3, reducedMotion: true })).toEqual(['floor', 'force_random_0']);
    expect(RETRO_FRAME_COUNTS.force).toBe(4);
  });

  it('uses the bend sprite of each ice tile', () => {
    expect(layersOf('ice')).toEqual(['floor', 'ice']);
    expect(layersOf('ice_se')).toEqual(['floor', 'ice_se']);
  });

  it('names the score text from the tile definition', () => {
    expect(retroBonusLabel(tiles.score_10)).toBe('10');
    expect(retroBonusLabel(tiles.score_100)).toBe('100');
    expect(retroBonusLabel(tiles.score_1000)).toBe('1K');
    expect(retroBonusLabel(tiles.score_2x)).toBe('x2');
    expect(retroLabelLayers('1K').map((l) => l.name)).toEqual(['digit_1', 'char_k']);
    expect(retroLabelLayers('x2').map((l) => l.name)).toEqual(['char_x', 'digit_2']);
    const flag = retroItemLayers('score_100', tiles.score_100);
    expect(flag.map((l) => l.name)).toEqual(['flag', 'digit_1', 'digit_0', 'digit_0']);
    // Characters are 3 wide with a one pixel gap.
    expect((flag[2].x ?? 0) - (flag[1].x ?? 0)).toBe(4);
  });

  it('names monster and player sprites', () => {
    expect(retroMonsterSprite('pink_ball', 'E', 1)).toBe('pink_ball_E_1');
    expect(retroPlayerSprite('N', false, true, 2)).toBe('player_N_2');
    expect(retroPlayerSprite('W', true, true, 1)).toBe('player_swim_W');
    expect(retroPlayerSprite('S', true, false, 0)).toBe('player_dead');
  });

  it('keys equal stacks alike and different swaps apart', () => {
    const a = retroItemLayers('key_red', tiles.key_red);
    const b = retroItemLayers('key_blue', tiles.key_blue);
    expect(retroLayersKey(a)).toBe(retroLayersKey(retroItemLayers('key_red', tiles.key_red)));
    expect(retroLayersKey(a)).not.toBe(retroLayersKey(b));
  });
});

describe('retro tile pixels', () => {
  const ramps = resolveRetroRamps(bundle.game.retroPalettes, 'cyber_neon');

  it('composes the floor sprite and skips sprites the sheet lacks', () => {
    const floor = composeRetroLayers([{ name: 'floor' }], ramps);
    const withMissing = composeRetroLayers([{ name: 'floor' }, { name: 'no_such_sprite' }], ramps);
    expect(floor.length).toBe(RETRO_SPRITE_SIZE * RETRO_SPRITE_SIZE * BYTES);
    expect(Array.from(withMissing)).toEqual(Array.from(floor));
    expect(composeRetroLayers([{ name: 'no_such_sprite' }], ramps).every((v) => v === 0)).toBe(true);
  });

  it('dithers the north shadow as a checkerboard on the top rows only', () => {
    const buffer = new Uint8ClampedArray(RETRO_SPRITE_SIZE * RETRO_SPRITE_SIZE * BYTES);
    const { depth, side } = retroShadowExtent(0.34);
    applyRetroShadow(buffer, RETRO_SPRITE_SIZE, retroShadowSignature(NEIGHBOUR.N), ramps, depth, side);
    const alphaAt = (x: number, y: number) => buffer[(y * RETRO_SPRITE_SIZE + x) * BYTES + 3];
    expect(depth).toBe(5);
    expect(alphaAt(0, 0)).toBe(255);
    expect(alphaAt(1, 0)).toBe(0);
    expect(alphaAt(1, 1)).toBe(255);
    expect(alphaAt(0, depth)).toBe(0);
    expect(alphaAt(0, depth + 1)).toBe(0);
    let painted = 0;
    for (let i = 3; i < buffer.length; i += BYTES) if (buffer[i]) painted++;
    expect(painted).toBe(Math.ceil((RETRO_SPRITE_SIZE * depth) / 2));
  });

  it('dithers the west shadow below the north rows and the corner only when nothing else shades', () => {
    const { depth, side } = retroShadowExtent(0.34);
    const filled = (signature: number): Set<string> => {
      const buffer = new Uint8ClampedArray(RETRO_SPRITE_SIZE * RETRO_SPRITE_SIZE * BYTES);
      applyRetroShadow(buffer, RETRO_SPRITE_SIZE, signature, ramps, depth, side);
      const out = new Set<string>();
      for (let y = 0; y < RETRO_SPRITE_SIZE; y++) {
        for (let x = 0; x < RETRO_SPRITE_SIZE; x++) if (buffer[(y * RETRO_SPRITE_SIZE + x) * BYTES + 3]) out.add(`${x},${y}`);
      }
      return out;
    };
    const west = filled(retroShadowSignature(NEIGHBOUR.W));
    expect(side).toBe(3);
    expect(west.has('0,0')).toBe(true);
    expect(west.has('0,14')).toBe(true);
    expect(west.has('4,0')).toBe(false);
    const corner = filled(retroShadowSignature(NEIGHBOUR.NW));
    expect(corner.has('0,0')).toBe(true);
    expect(corner.has('0,depth')).toBe(false);
    expect(corner.has('0,14')).toBe(false);
    // The corner is ignored once a north caster shades the row.
    expect(retroShadowSignature(NEIGHBOUR.N | NEIGHBOUR.NW)).toBe(retroShadowSignature(NEIGHBOUR.N));
    expect(retroShadowSignature(0)).toBe(0);
  });

  it('keeps colour literals out of the module', () => {
    expect(composeSource.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
  });
});

describe('every in-game id maps to existing sprites', () => {
  const DIRECTIONS = ['N', 'E', 'S', 'W'] as const;
  const PHASES = [0, 1, 2, 3];
  const HASHES = [0, 1280, 2560, 5120];
  const PASSES: RetroPass[] = ['all', 'static', 'animated'];
  const WALL_MASKS = [OPEN, ALL_JOINED, NEIGHBOUR.N | NEIGHBOUR.W, NEIGHBOUR.S | NEIGHBOUR.E];
  const MONSTER_FRAMES = [0, 1];
  const PLAYER_FRAMES = [0, 1, 2];
  const produced = new Set<string>();

  function collect(names: readonly string[]): void {
    for (const name of names) produced.add(name);
  }

  it('composes only sprites the sheet defines, for every terrain id and every variant', () => {
    const terrainIds = Object.entries(tiles).filter(([, def]) => def.layer === 'terrain').map(([id]) => id);
    expect(terrainIds.length).toBeGreaterThan(50);
    for (const tileId of terrainIds) {
      for (const pass of PASSES) {
        for (const isEditor of [false, true]) {
          for (const isClosedTrap of [false, true]) {
            for (const reducedMotion of [false, true]) {
              for (const phase of PHASES) {
                for (const hash of HASHES) {
                  for (const wallMask of WALL_MASKS) {
                    const layers = retroTileLayers({
                      tileId,
                      def: tiles[tileId],
                      resolve,
                      pass,
                      hash,
                      wallMask,
                      floorDetailEvery: EVERY,
                      isEditor,
                      revealHiddenWalls: isEditor,
                      isClosedTrap,
                      phase,
                      reducedMotion
                    });
                    collect(layers.map((l) => l.name));
                  }
                }
              }
            }
          }
        }
      }
    }
    const missing = [...produced].filter((name) => !(name in RETRO_SHEET.sprites));
    expect(missing).toEqual([]);
  });

  it('composes only sprites the sheet defines, for every item id', () => {
    const itemIds = Object.entries(tiles).filter(([, def]) => def.layer === 'item').map(([id]) => id);
    expect(itemIds.length).toBeGreaterThan(10);
    for (const itemId of itemIds) {
      const names = retroItemLayers(itemId, tiles[itemId]).map((l) => l.name);
      expect(names.length, itemId).toBeGreaterThan(0);
      collect(names);
      expect(names.filter((n) => !(n in RETRO_SHEET.sprites)), itemId).toEqual([]);
    }
  });

  it('names existing sprites for every monster, block and player state', () => {
    const entities = Object.entries(bundle.monsters.entities);
    expect(entities.length).toBeGreaterThan(5);
    for (const [id, def] of entities) {
      if (def.kind === 'block') {
        collect([id]);
        expect(id in RETRO_SHEET.sprites, id).toBe(true);
        continue;
      }
      for (const dir of DIRECTIONS) {
        for (const frame of MONSTER_FRAMES) {
          const name = retroMonsterSprite(id, dir, frame);
          collect([name]);
          expect(name in RETRO_SHEET.sprites, name).toBe(true);
        }
      }
    }
    for (const dir of DIRECTIONS) {
      for (const inWater of [false, true]) {
        for (const alive of [false, true]) {
          for (const frame of PLAYER_FRAMES) {
            const name = retroPlayerSprite(dir, inWater, alive, frame);
            collect([name]);
            expect(name in RETRO_SHEET.sprites, name).toBe(true);
          }
        }
      }
    }
    collect([RETRO_SPRITE.blockOnTarget]);
  });

  it('keeps the composed names and RETRO_SPRITE_NAMES in step both ways', () => {
    // Digits and signs not used by any score flag are the only names allowed to go unused.
    const unusedAllowed = (name: string): boolean => name.startsWith('digit_') || name.startsWith('char_');
    const unknown = [...produced].filter((name) => !RETRO_SPRITE_NAMES.includes(name));
    const unused = RETRO_SPRITE_NAMES.filter((name) => !produced.has(name) && !unusedAllowed(name));
    expect(unknown).toEqual([]);
    expect(unused).toEqual([]);
  });

  it('defines every named constant in the sprite names module', () => {
    for (const name of Object.values(RETRO_SPRITE)) expect(RETRO_SPRITE_NAMES).toContain(name);
  });
});

describe('reduced motion', () => {
  const ANIMATED = [
    'water', 'turtle', 'fire', 'flame_jet_on', 'exit', 'teleport', 'teleport_red', 'teleport_blue',
    'teleport_yellow', 'teleport_green', 'force_n', 'force_e', 'force_s', 'force_w', 'force_random'
  ];

  it('shows frame 0 of every animated family, whatever the phase', () => {
    for (const tileId of ANIMATED) {
      for (const phase of [0, 1, 2, 3]) {
        const names = layersOf(tileId, { pass: 'animated', phase, reducedMotion: true });
        expect(names.length, tileId).toBeGreaterThan(0);
        const frameNames = names.filter((n) => /_\d$/.test(n));
        expect(frameNames.length, tileId).toBeGreaterThan(0);
        for (const name of frameNames) expect(name.endsWith('_0'), `${tileId} ${name}`).toBe(true);
      }
    }
  });

  it('still animates every family when motion is allowed', () => {
    for (const tileId of ANIMATED) {
      const frames = new Set([0, 1, 2, 3].map((phase) => layersOf(tileId, { pass: 'animated', phase }).join('+')));
      expect(frames.size, tileId).toBeGreaterThan(1);
    }
  });
});
