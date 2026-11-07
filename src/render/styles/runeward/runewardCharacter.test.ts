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
 * The three Runeward characters: every facing, state and character draws its own picture, in both
 * variants, and the pose is read from the engine state the way the renderer reads it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { GameEngine } from '../../../core/GameEngine';
import type { CompiledLevel, Direction, RunewardArtConfig, RunewardBootsKind } from '../../../core/types';
import { createRecordedContext } from '../../../test/runewardTestContext';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import {
  RUNEWARD_CHARACTERS,
  bootKindsOfItems,
  completePose,
  deathCauseOf,
  footBoots,
  paintCharacter,
  poseExtrasOf,
  type PlayerPoseExtras,
  type RunewardCharacterId
} from './runewardCharacter';

const TILE = 64;
const SMALL_TILE = 24;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const BOOTS: readonly RunewardBootsKind[] = ['ice', 'fire', 'water', 'force'];

function plainArt(): RunewardArtConfig {
  return structuredClone(ConfigRegistry.getGame().runewardArt) as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return structuredClone(ConfigRegistry.getGame().runewardArtVariants?.parchment) as RunewardArtConfig;
}

interface Scene {
  readonly dir?: Direction;
  readonly frame?: number;
  readonly inWater?: boolean;
  readonly alive?: boolean;
  readonly hop?: number;
  readonly extras?: PlayerPoseExtras;
}

function draw(art: RunewardArtConfig, character: RunewardCharacterId, scene: Scene = {}, size = TILE, timeMs = 0): string[] {
  const { ctx, lines } = createRecordedContext();
  const pose = completePose(
    { dir: scene.dir ?? 'S', inWater: scene.inWater ?? false, alive: scene.alive ?? true, frame: scene.frame ?? 0, hop: scene.hop ?? 0 },
    { ...scene.extras, character }
  );
  paintCharacter(ctx, size, art, pose, timeMs);
  return lines;
}

function key(lines: readonly string[]): string {
  return lines.join('\n');
}

/** Asserts that every scene draws a picture of its own. */
function expectAllDistinct(pictures: ReadonlyMap<string, string[]>): void {
  const seen = new Map<string, string>();
  for (const [name, lines] of pictures) {
    expect(lines.length, name).toBeGreaterThan(10);
    const text = key(lines);
    expect(seen.get(text), `${name} draws the same as ${seen.get(text)}`).toBeUndefined();
    seen.set(text, name);
  }
}

const VARIANTS: readonly (readonly [string, () => RunewardArtConfig])[] = [['plain', plainArt], ['parchment', parchmentArt]];

describe('Runeward characters', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  for (const [variant, makeArt] of VARIANTS) {
    for (const character of RUNEWARD_CHARACTERS) {
      describe(`${character}, ${variant}`, () => {
        it('draws each of the four facings differently', () => {
          const art = makeArt();
          const pictures = new Map(DIRECTIONS.map((dir) => [dir, draw(art, character, { dir })] as const));
          expectAllDistinct(pictures);
        });

        it('mirrors east to draw west', () => {
          const art = makeArt();
          expect(draw(art, character, { dir: 'W' }).some((line) => line.startsWith('scale(-1, 1)'))).toBe(true);
          expect(draw(art, character, { dir: 'E' }).some((line) => line.startsWith('scale(-1, 1)'))).toBe(false);
        });

        it('draws the standing, the two strides, swimming and skating poses differently', () => {
          const art = makeArt();
          const pictures = new Map<string, string[]>([
            ['standing', draw(art, character)],
            ['stride 1', draw(art, character, { frame: 1 })],
            ['stride 2', draw(art, character, { frame: 2 })],
            ['profile stride', draw(art, character, { dir: 'E', frame: 1 })],
            ['swimming', draw(art, character, { inWater: true })],
            ['skating', draw(art, character, { extras: { skating: true } })],
            ['skating in profile', draw(art, character, { dir: 'E', extras: { skating: true } })]
          ]);
          expectAllDistinct(pictures);
        });

        it('draws the three deaths and the living figure differently', () => {
          const art = makeArt();
          const dead = (deathCause: 'fire' | 'water' | 'other', inWater = false): string[] =>
            draw(art, character, { alive: false, inWater, extras: { deathCause } });
          const pictures = new Map<string, string[]>([
            ['alive', draw(art, character)],
            ['fire', dead('fire')],
            ['water', dead('water', true)],
            ['other', dead('other')]
          ]);
          expectAllDistinct(pictures);
          // A drowned figure leaves no ground shadow; the others keep theirs.
          const shadow = art.mage.shadow;
          expect(dead('water', true).includes(`fillStyle = ${JSON.stringify(shadow)}`)).toBe(false);
          expect(dead('other').includes(`fillStyle = ${JSON.stringify(shadow)}`)).toBe(true);
        });

        it('shows every boots kind, none and the ward differently', () => {
          const art = makeArt();
          const pictures = new Map<string, string[]>([['bare', draw(art, character)]]);
          for (const kind of BOOTS) pictures.set(kind, draw(art, character, { extras: { boots: [kind] } }));
          pictures.set('two pairs', draw(art, character, { extras: { boots: ['water', 'force'] } }));
          pictures.set('ward', draw(art, character, { extras: { wardActive: true } }));
          expectAllDistinct(pictures);
          for (const kind of BOOTS) {
            expect(key(draw(art, character, { extras: { boots: [kind] } }))).toContain(art.item.boots[kind].main);
          }
        });

        it('does not show the ward ring on a dead figure', () => {
          const art = makeArt();
          const dead = draw(art, character, { alive: false, extras: { wardActive: true, deathCause: 'other' } });
          expect(key(dead)).toBe(key(draw(art, character, { alive: false, extras: { deathCause: 'other' } })));
        });

        it('lifts with the hop, bobs with the clock and draws at a small size', () => {
          const art = makeArt();
          expect(key(draw(art, character, { hop: 0.2 }))).not.toBe(key(draw(art, character)));
          expect(key(draw(art, character, {}, TILE, 700))).not.toBe(key(draw(art, character)));
          expect(key(draw(art, character, {}, TILE, 700))).toBe(key(draw(art, character, {}, TILE, 700)));
          expect(draw(art, character, {}, SMALL_TILE).length).toBeGreaterThan(10);
        });
      });
    }

    it(`draws three different characters in every scene, ${variant}`, () => {
      const art = makeArt();
      const scenes: Scene[] = [
        {},
        { dir: 'N' },
        { dir: 'E', frame: 1 },
        { inWater: true },
        { extras: { skating: true } },
        { alive: false, extras: { deathCause: 'other' } },
        { extras: { boots: ['ice'] } }
      ];
      for (const scene of scenes) {
        const pictures = new Map<string, string[]>(RUNEWARD_CHARACTERS.map((character) => [character, draw(art, character, scene)] as const));
        expectAllDistinct(pictures);
      }
    });
  }

  it('outlines the three characters in ink on Parchment', () => {
    const art = parchmentArt();
    for (const character of RUNEWARD_CHARACTERS) {
      const text = key(draw(art, character));
      expect(text).toContain(`strokeStyle = ${JSON.stringify(art.ink!.line)}`);
      expect(text).toContain(`strokeStyle = ${JSON.stringify(art.ink!.wood)}`);
      expect(text).toContain(`fillStyle = ${JSON.stringify(art.ink!.gold)}`);
    }
  });

  it('rims the scribe hood in the dark cloak edge, heavier on Parchment', () => {
    const plain = plainArt();
    const parchment = parchmentArt();
    expect(key(draw(plain, 'scribe'))).toContain(`strokeStyle = ${JSON.stringify(plain.character.cloak.edge)}`);
    expect(key(draw(parchment, 'scribe'))).toContain(`strokeStyle = ${JSON.stringify(parchment.character.cloak.edge)}`);
    const rims = (art: RunewardArtConfig, character: RunewardCharacterId): number =>
      draw(art, character).filter((line) => line === `strokeStyle = ${JSON.stringify(art.character.cloak.edge)}`).length;
    expect(rims(plain, 'scribe')).toBeGreaterThan(rims(plain, 'mage'));
    const rimWidth = (art: RunewardArtConfig): number => {
      const lines = draw(art, 'scribe', {}, TILE);
      const at = lines.findIndex((line) => line === `strokeStyle = ${JSON.stringify(art.character.cloak.edge)}`);
      return Number(/lineWidth = ([\d.]+)/.exec(lines[at + 1])![1]);
    };
    expect(rimWidth(parchment)).toBeGreaterThan(rimWidth(plain));
  });

  it('draws only inside the cell and keeps the context balanced', () => {
    const art = plainArt();
    for (const character of RUNEWARD_CHARACTERS) {
      for (const scene of [{}, { alive: false, extras: { deathCause: 'other' as const } }, { inWater: true }]) {
        const lines = draw(art, character, scene);
        const saves = lines.filter((line) => line.startsWith('save(')).length;
        const restores = lines.filter((line) => line.startsWith('restore(')).length;
        expect(saves).toBe(restores);
      }
    }
  });
});

describe('boots shown on the feet', () => {
  it('picks the first two held kinds by priority and doubles a single kind', () => {
    expect(footBoots([])).toEqual([null, null]);
    expect(footBoots(['ice'])).toEqual(['ice', 'ice']);
    expect(footBoots(['force', 'fire', 'water'])).toEqual(['fire', 'water']);
  });

  it('reads the boot kinds from the held item ids and ignores the rest', () => {
    expect(bootKindsOfItems(['boots_ice', 'key_red', 'ward', 'boots_ice', 'boots_unknown', 'boots_force'])).toEqual(['ice', 'ward', 'force']);
    expect(bootKindsOfItems(new Set(['boots_water']))).toEqual(['water']);
    expect(bootKindsOfItems([])).toEqual([]);
  });
});

describe('cause of death', () => {
  it('reads the reason the engine gives, then the tile under the player', () => {
    expect(deathCauseOf('hud.messages.death_fire')).toBe('fire');
    expect(deathCauseOf('hud.messages.death_water')).toBe('water');
    expect(deathCauseOf('hud.messages.death_monster', 'water')).toBe('other');
    expect(deathCauseOf(null, 'fire')).toBe('fire');
    expect(deathCauseOf(null, 'water')).toBe('water');
    expect(deathCauseOf(null, 'slime')).toBe('other');
    expect(deathCauseOf(null)).toBe('other');
  });
});

function openLevel(): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  return {
    id: 'character_level',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain: Array.from({ length: mapHeight }, (_, y) =>
      Array.from({ length: mapWidth }, (_, x) => (x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'))
    ),
    items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function walk(engine: GameEngine, dir: Direction, steps: number): void {
  const maxWaitTicks = 20;
  for (let step = 0; step < steps; step += 1) {
    let waited = 0;
    while (!engine.attemptPlayerMove(dir)) {
      engine.tick();
      waited += 1;
      if (waited > maxWaitTicks) throw new Error(`move ${dir} refused at step ${step}`);
    }
    engine.tick();
  }
}

describe('the pose read from the engine', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('reads the boots and the ward the player picked up', () => {
    const level = openLevel();
    level.items[2][3] = 'boots_ice';
    level.items[2][4] = 'ward';
    level.items[2][5] = 'boots_fire';
    const engine = new GameEngine();
    engine.loadLevel(level);
    expect(poseExtrasOf(engine.getPlayer())).toMatchObject({ boots: [], wardActive: false, skating: false });
    walk(engine, 'E', 3);
    const extras = poseExtrasOf(engine.getPlayer());
    expect(extras.boots).toEqual(['ice', 'fire']);
    expect(extras.wardActive).toBe(true);
    expect(extras.deathCause).toBeUndefined();
  });

  it('reads gliding on ice', () => {
    const level = openLevel();
    for (let x = 3; x < 9; x += 1) level.terrain[2][x] = 'ice';
    const engine = new GameEngine();
    engine.loadLevel(level);
    walk(engine, 'E', 1);
    expect(engine.getPlayer().isSliding).toBe(true);
    expect(poseExtrasOf(engine.getPlayer()).skating).toBe(true);
  });

  it('reads a death in water and in fire from the reason of the engine', () => {
    for (const [tile, cause] of [['water', 'water'], ['fire', 'fire']] as const) {
      const level = openLevel();
      level.terrain[2][3] = tile;
      const engine = new GameEngine();
      engine.loadLevel(level);
      walk(engine, 'E', 1);
      const player = engine.getPlayer();
      expect(player.alive, tile).toBe(false);
      expect(poseExtrasOf(player).deathCause, tile).toBe(cause);
    }
  });

  it('reads another death as other', () => {
    const level = openLevel();
    level.entities = [{ x: 3, y: 2, type: 'walker', dir: 'W' }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    for (let i = 0; i < 40 && engine.getPlayer().alive; i += 1) engine.tick();
    expect(engine.getPlayer().alive).toBe(false);
    expect(poseExtrasOf(engine.getPlayer()).deathCause).toBe('other');
  });
});
