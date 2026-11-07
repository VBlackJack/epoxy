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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { entityAvailability, tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { STATIONARY_PATTERN } from '../coreConstants';
import { engineSimulationHash } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import {
  hasEpoxyOnlyContent,
  isEpoxyOnlyEntityType,
  isEpoxyOnlyItemId,
  isLurkerEntityType,
  isWardTileId
} from '../RulesetFeatures';
import { usesV7Ids } from '../signalLinks';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext } from './epoxyWorld';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';

const WARD = 'ward';
const DORMANT = 'lurker_dormant';
const AWAKE = 'lurker';
const SIZE = 13;
const TIME_LIMIT_SECONDS = 100;
const PLAYER_START = { x: 2, y: 5 };
const MAX_WAIT_TICKS = 40;
const SCRIPT_REPEATS = 2;
/** Ticks between two steps of a monster whose interval is `interval`: the countdown, then the move. */
const stepSpacing = (interval: number): number => interval + 1;
const LURKER_INTERVAL = 16;
const CHASE_TICKS = 120;

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'ward_lurker_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? PLAYER_START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function wearsWard(engine: GameEngine): boolean {
  return engine.getPlayer().boots.has(WARD);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('ward: configuration', () => {
  it('is a boot that absorbs a monster contact, named in both languages, Epoxy-only', () => {
    const tile = ConfigRegistry.getTile(WARD);
    expect(tile.collectible).toBe('boot');
    expect(tile.layer).toBe('item');
    expect(tile.absorbsMonsterContact).toBe(true);
    expect(isWardTileId(WARD)).toBe(true);
    expect(isWardTileId('boots_fire')).toBe(false);
    expect(isEpoxyOnlyItemId(WARD)).toBe(true);
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      expect(locale.tiles[WARD].name).toBeTruthy();
      expect(locale.tiles[WARD].desc.label).toBeTruthy();
    }
    expect(en.tiles.ward.name).toBe('Ward');
    expect(fr.tiles.ward.name).toBe('Égide');
  });
});

describe('ward: contact with a monster', () => {
  it('is used up by the player walking into a monster, which is removed while the player lives', () => {
    const engine = load(room({ items: [[3, 5, WARD]], entities: [{ type: 'walker', x: 5, y: 5, dir: 'E' }] }));
    expect(step(engine, 'E')).toBe(true);
    expect(wearsWard(engine)).toBe(true);
    expect(engine.getHeldItems()).toContain(WARD);
    expect(step(engine, 'E')).toBe(true);
    // Now one cell short of the monster; the next step goes into it.
    contextOf(engine).world.entities.forEach((e) => {
      e.x = 5;
      e.y = 5;
      e.cooldownTicks = MAX_WAIT_TICKS * MAX_WAIT_TICKS;
    });
    expect(step(engine, 'E')).toBe(true);
    expect(engine.getPlayer()).toMatchObject({ x: 5, y: 5, alive: true });
    expect(engine.getEntities()).toHaveLength(0);
    expect(wearsWard(engine)).toBe(false);
    expect(engine.getHeldItems()).not.toContain(WARD);
  });

  it('is used up by a monster stepping onto the player, which is removed while the player lives', () => {
    const engine = load(room({ entities: [{ type: 'teeth', x: 8, y: 5, dir: 'W' }] }));
    contextOf(engine).world.player.boots.add(WARD);
    for (let tick = 0; tick < CHASE_TICKS && engine.getEntities().length > 0; tick++) engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getPlayer().alive).toBe(true);
    expect(wearsWard(engine)).toBe(false);
  });

  it('is used up by a monster arriving on the player by a direct arrival call', () => {
    const engine = load(room({ entities: [{ type: 'bug', x: 7, y: 7, dir: 'N' }] }));
    const ctx = contextOf(engine);
    ctx.world.player.boots.add(WARD);
    const bug = engine.getEntities()[0];
    bug.x = ctx.world.player.x;
    bug.y = ctx.world.player.y;
    expect(resolveMonsterArrival(ctx, bug, false)).toBe(true);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getEntities()).toHaveLength(0);
    expect(wearsWard(engine)).toBe(false);
  });

  it('kills the player without a ward, from both sides', () => {
    const walkInto = load(room({ entities: [{ type: 'walker', x: 3, y: 5, dir: 'E' }] }));
    contextOf(walkInto).world.entities[0].cooldownTicks = MAX_WAIT_TICKS * MAX_WAIT_TICKS;
    step(walkInto, 'E');
    expect(walkInto.getPlayer().alive).toBe(false);

    const comesToYou = load(room({ entities: [{ type: 'teeth', x: 8, y: 5, dir: 'W' }] }));
    for (let tick = 0; tick < CHASE_TICKS && comesToYou.getPlayer().alive; tick++) comesToYou.tick();
    expect(comesToYou.getPlayer().alive).toBe(false);
  });

  it('absorbs one contact only: the second monster kills', () => {
    const engine = load(
      room({ entities: [{ type: 'walker', x: 3, y: 5, dir: 'E' }, { type: 'walker', x: 4, y: 5, dir: 'E' }] })
    );
    contextOf(engine).world.player.boots.add(WARD);
    contextOf(engine).world.entities.forEach((e) => (e.cooldownTicks = MAX_WAIT_TICKS * MAX_WAIT_TICKS));
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(true);
    expect(wearsWard(engine)).toBe(false);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('is used up by a monster that teleports onto the player', () => {
    const engine = load(
      room({
        terrain: [[3, 3, 'teleport'], [9, 9, 'teleport']],
        entities: [{ type: 'tank', x: 3, y: 2, dir: 'S' }],
        player: { x: 9, y: 10 }
      })
    );
    contextOf(engine).world.player.boots.add(WARD);
    contextOf(engine).world.entities[0].cooldownTicks = 0;
    for (let tick = 0; tick < CHASE_TICKS && engine.getEntities().length > 0; tick++) engine.tick();
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.getPlayer().alive).toBe(true);
    expect(wearsWard(engine)).toBe(false);
  });

  it('does not absorb a shot or a laser beam', () => {
    const shot = load(room({ player: { x: 6, y: 4 } }));
    contextOf(shot).world.player.boots.add(WARD);
    contextOf(shot).world.shots.push({ x: 6, y: 3, dir: 'E', cooldown: 5 });
    step(shot, 'N');
    expect(shot.getPlayer().alive).toBe(false);

    const beam = load(room({ terrain: [[3, 3, 'laser_emitter_e']], player: { x: 6, y: 4 } }));
    contextOf(beam).world.player.boots.add(WARD);
    step(beam, 'N');
    expect(beam.getPlayer().alive).toBe(false);
    expect(beam.getPlayer().deathReasonKey).toBe('hud.messages.death_laser');
  });

  it('gives no protection from water, fire or a bomb', () => {
    for (const [terrain, items] of [
      [[[3, 5, 'water']], []],
      [[[3, 5, 'fire']], []],
      [[], [[3, 5, 'bomb']]]
    ] as Array<[Array<[number, number, string]>, Array<[number, number, string]>]>) {
      const engine = load(room({ terrain, items }));
      contextOf(engine).world.player.boots.add(WARD);
      step(engine, 'E');
      expect(engine.getPlayer().alive).toBe(false);
    }
  });
});

describe('ward: pickup, drop and undo', () => {
  it('leaves a second ward on the floor while one is worn, and takes it once the first is used', () => {
    const engine = load(room({ items: [[3, 5, WARD], [4, 5, WARD]], entities: [{ type: 'walker', x: 6, y: 5, dir: 'E' }] }));
    contextOf(engine).world.entities[0].cooldownTicks = MAX_WAIT_TICKS * MAX_WAIT_TICKS;
    step(engine, 'E');
    expect(wearsWard(engine)).toBe(true);
    step(engine, 'E');
    expect(engine.getItems()[5][4]).toBe(WARD);
    expect(engine.getPlayer().boots.size).toBe(1);
    // Spend the first ward on the monster, then come back for the one left behind.
    step(engine, 'E');
    step(engine, 'E');
    expect(wearsWard(engine)).toBe(false);
    expect(engine.getEntities()).toHaveLength(0);
    step(engine, 'W');
    step(engine, 'W');
    expect(engine.getPlayer()).toMatchObject({ x: 4, y: 5 });
    expect(wearsWard(engine)).toBe(true);
    expect(engine.getItems()[5][4]).toBeNull();
  });

  it('can be dropped like any boots and picked up again', () => {
    const engine = load(room({ items: [[3, 5, WARD]] }));
    step(engine, 'E');
    expect(wearsWard(engine)).toBe(true);
    expect(engine.dropItem(WARD)).toBe(true);
    expect(wearsWard(engine)).toBe(false);
    expect(engine.getItems()[5][3]).toBe(WARD);
    // Dropping does not pick it up again; stepping off and back does.
    step(engine, 'E');
    step(engine, 'W');
    expect(wearsWard(engine)).toBe(true);
  });

  it('restores the ward and the monster on undo', () => {
    const engine = load(room({ entities: [{ type: 'walker', x: 3, y: 5, dir: 'E' }] }));
    contextOf(engine).world.player.boots.add(WARD);
    contextOf(engine).world.entities[0].cooldownTicks = MAX_WAIT_TICKS * MAX_WAIT_TICKS;
    step(engine, 'E');
    expect(wearsWard(engine)).toBe(false);
    expect(engine.getEntities()).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(wearsWard(engine)).toBe(true);
    expect(engine.getEntities()).toHaveLength(1);
    expect(engine.getPlayer()).toMatchObject({ x: PLAYER_START.x, y: PLAYER_START.y });
  });

  it('works on a lurker as on any monster', () => {
    const engine = load(room({ entities: [{ type: DORMANT, x: 3, y: 5, dir: 'E' }] }));
    contextOf(engine).world.player.boots.add(WARD);
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('shows in the held items, which the simulation hash reads, and replays to the same hash', () => {
    const level = room({ items: [[3, 5, WARD]], entities: [{ type: 'bug', x: 9, y: 9, dir: 'N' }] });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
  });
});

describe('lurker: configuration', () => {
  it('is a stationary sleeper that becomes a slow chaser, named in both languages', () => {
    const sleeper = ConfigRegistry.getEntityDef(DORMANT)!;
    const chaser = ConfigRegistry.getEntityDef(AWAKE)!;
    expect(sleeper.movementPattern).toBe(STATIONARY_PATTERN);
    expect(sleeper.wakesTo).toBe(AWAKE);
    expect(chaser.movementPattern).toBe('chase_player');
    expect(chaser.moveIntervalTicks).toBe(LURKER_INTERVAL);
    expect(chaser.wakesTo).toBeUndefined();
    for (const id of [DORMANT, AWAKE]) {
      expect(isLurkerEntityType(id)).toBe(true);
      expect(isEpoxyOnlyEntityType(id)).toBe(true);
    }
    expect(isLurkerEntityType('teeth')).toBe(false);
    for (const locale of [en, fr] as unknown as Array<{ entities: Record<string, { name: string; desc: { label: string } }> }>) {
      for (const id of [DORMANT, AWAKE]) {
        expect(locale.entities[id].name).toBeTruthy();
        expect(locale.entities[id].desc.label).toBeTruthy();
      }
    }
    expect(en.entities.lurker_dormant.name).toBe('Lurker (Sleeping)');
    expect(en.entities.lurker.name).toBe('Lurker (Chases Slowly)');
    expect(fr.entities.lurker_dormant.name).toBe('Guetteur (Endormi)');
    expect(fr.entities.lurker.name).toBe('Guetteur (Traque Lentement)');
  });
});

describe('lurker: sleeping and waking', () => {
  const LURKER = { x: 8, y: 5 };
  const sleeper = (extra: Setup = {}): GameEngine =>
    load(room({ entities: [{ type: DORMANT, x: LURKER.x, y: LURKER.y, dir: 'S' }], ...extra }));

  it('stays put and asleep while the player is away', () => {
    const engine = sleeper();
    for (let tick = 0; tick < CHASE_TICKS; tick++) engine.tick();
    expect(engine.getEntities()[0]).toMatchObject({ type: DORMANT, x: LURKER.x, y: LURKER.y });
  });

  it('wakes when a step ends orthogonally next to it', () => {
    const engine = sleeper({ player: { x: 5, y: 5 } });
    step(engine, 'E');
    expect(engine.getEntities()[0].type).toBe(DORMANT);
    step(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 5 });
    expect(engine.getEntities()[0]).toMatchObject({ type: AWAKE, x: LURKER.x, y: LURKER.y });
  });

  it('does not wake for a player on a diagonal', () => {
    const engine = sleeper({ player: { x: 6, y: 3 } });
    step(engine, 'E');
    step(engine, 'S');
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 4 });
    expect(engine.getEntities()[0].type).toBe(DORMANT);
    step(engine, 'S');
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 5 });
    expect(engine.getEntities()[0].type).toBe(AWAKE);
  });

  it('wakes when a slide ends next to it', () => {
    const engine = load(
      room({
        terrain: [[3, 5, 'ice'], [4, 5, 'ice'], [5, 5, 'ice']],
        entities: [{ type: DORMANT, x: 6, y: 4, dir: 'S' }]
      })
    );
    step(engine, 'E');
    // The slide runs along the ice and stops on the floor past it, below the sleeper.
    for (let tick = 0; tick < MAX_WAIT_TICKS && engine.getPlayer().isSliding; tick++) engine.tick();
    expect(engine.getPlayer()).toMatchObject({ x: 6, y: 5, isSliding: false });
    expect(engine.getEntities()[0].type).toBe(AWAKE);
  });

  it('wakes when a teleport lands next to it', () => {
    const engine = load(
      room({
        terrain: [[3, 5, 'teleport'], [9, 9, 'teleport']],
        entities: [{ type: DORMANT, x: 10, y: 8, dir: 'S' }]
      })
    );
    step(engine, 'E');
    const { x, y } = engine.getPlayer();
    expect(Math.abs(x - 10) + Math.abs(y - 8)).toBe(1);
    expect(engine.getEntities()[0].type).toBe(AWAKE);
  });

  it('wakes when a slide passes next to it and ends further away', () => {
    const engine = load(
      room({
        terrain: [[3, 5, 'ice'], [4, 5, 'ice'], [5, 5, 'ice'], [6, 5, 'ice']],
        entities: [{ type: DORMANT, x: 5, y: 4, dir: 'S' }]
      })
    );
    step(engine, 'E');
    for (let tick = 0; tick < MAX_WAIT_TICKS && engine.getPlayer().isSliding; tick++) engine.tick();
    expect(engine.getPlayer()).toMatchObject({ x: 7, y: 5, isSliding: false });
    expect(engine.getEntities()[0].type).toBe(AWAKE);
  });

  it('stretches the pause before the first chase step by slow time', () => {
    const slowdown = ConfigRegistry.getTile('slow_time').slowsMonsters as number;
    expect(slowdown).toBeGreaterThan(1);
    const plain = sleeper({ player: { x: 6, y: 5 } });
    step(plain, 'E');
    expect(plain.getEntities()[0].cooldownTicks).toBe(LURKER_INTERVAL);
    const slowed = sleeper({ player: { x: 6, y: 5 } });
    contextOf(slowed).world.player.boots.add('slow_time');
    step(slowed, 'E');
    expect(slowed.getEntities()[0].cooldownTicks).toBe((LURKER_INTERVAL + 1) * slowdown - 1);
  });

  it('kills the player who steps into it while it sleeps', () => {
    const engine = load(room({ entities: [{ type: DORMANT, x: 3, y: 5, dir: 'S' }] }));
    step(engine, 'E');
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('chases at an interval of 16 once awake, and never sleeps again', () => {
    const engine = sleeper({ player: { x: 6, y: 5 } });
    step(engine, 'E');
    const lurker = engine.getEntities()[0];
    expect(lurker.type).toBe(AWAKE);
    // The player walks away along the row and the lurker follows in steps spaced interval + 1 ticks apart.
    const moveTicks: number[] = [];
    let lastX = lurker.x;
    for (let tick = 1; tick <= stepSpacing(LURKER_INTERVAL) * 3 + 1; tick++) {
      engine.tick();
      if (lurker.x !== lastX) {
        moveTicks.push(tick);
        lastX = lurker.x;
      }
      if (engine.getPlayer().moveCooldown === 0 && tick % 2 === 0 && engine.getPlayer().x > 3) engine.attemptPlayerMove('W');
    }
    expect(moveTicks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < moveTicks.length; i++) {
      expect(moveTicks[i] - moveTicks[i - 1]).toBe(stepSpacing(LURKER_INTERVAL));
    }
    expect(lurker.type).toBe(AWAKE);
    expect(engine.getEntities()[0].type).toBe(AWAKE);
  });

  it('restores the sleeper on undo', () => {
    const engine = sleeper({ player: { x: 6, y: 5 } });
    step(engine, 'E');
    expect(engine.getEntities()[0].type).toBe(AWAKE);
    expect(engine.undo()).toBe(true);
    expect(engine.getEntities()[0].type).toBe(DORMANT);
  });

  it('replays to the same hash', () => {
    const level = room({ entities: [{ type: DORMANT, x: 8, y: 5, dir: 'S' }] });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
  });
});

describe('lurker: validator warning', () => {
  const warningKey = 'validator.issues.lurker_not_on_floor.label';
  const keysOf = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((i) => i.i18nKey);

  it('warns for a sleeper off plain floor, and not for one on plain floor or an awake lurker', () => {
    const exit: Array<[number, number, string]> = [[SIZE - 2, SIZE - 2, 'exit']];
    expect(keysOf(room({ terrain: exit, entities: [{ type: DORMANT, x: 6, y: 6, dir: 'S' }] }))).not.toContain(warningKey);
    expect(keysOf(room({ terrain: [...exit, [6, 6, 'dirt']], entities: [{ type: DORMANT, x: 6, y: 6, dir: 'S' }] }))).toContain(warningKey);
    expect(keysOf(room({ terrain: [...exit, [6, 6, 'ice']], entities: [{ type: DORMANT, x: 6, y: 6, dir: 'S' }] }))).toContain(warningKey);
    expect(keysOf(room({ terrain: [...exit, [6, 6, 'dirt']], entities: [{ type: AWAKE, x: 6, y: 6, dir: 'S' }] }))).not.toContain(warningKey);
  });

  it('has the warning text in both languages', () => {
    for (const locale of [en, fr] as unknown as Array<{ validator: { issues: Record<string, { label: string }> } }>) {
      expect(locale.validator.issues.lurker_not_on_floor.label).toContain('{x}');
    }
  });
});

describe('ward and lurker: rulesets', () => {
  it('are Epoxy-only content, refused in the Lynx palette', () => {
    expect(hasEpoxyOnlyContent(room())).toBe(false);
    expect(hasEpoxyOnlyContent(room({ items: [[3, 3, WARD]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ entities: [{ type: DORMANT, x: 3, y: 3, dir: 'S' }] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ entities: [{ type: AWAKE, x: 3, y: 3, dir: 'S' }] }))).toBe(true);
    expect(tileAvailability('lynx', WARD).available).toBe(false);
    expect(tileAvailability('epoxy', WARD).available).toBe(true);
    for (const id of [DORMANT, AWAKE]) {
      expect(entityAvailability('lynx', id).available).toBe(false);
      expect(entityAvailability('epoxy', id).available).toBe(true);
    }
  });

  it('makes the pack writer pick format 7, but not for a CC3D level', () => {
    expect(usesV7Ids(room())).toBe(false);
    for (const level of [
      room({ items: [[3, 3, WARD]] }),
      room({ entities: [{ type: DORMANT, x: 3, y: 3, dir: 'S' }] }),
      room({ entities: [{ type: AWAKE, x: 3, y: 3, dir: 'S' }] })
    ]) {
      expect(usesV7Ids(level)).toBe(true);
      expect(usesV7Ids({ ...level, ruleset: 'cc3d' })).toBe(false);
    }
  });

  it('are refused by the .DAT export', () => {
    expect(datRefusalReason(room({ items: [[3, 3, WARD]] }))).toBe('epoxy_only_items');
    expect(datRefusalReason(room({ entities: [{ type: DORMANT, x: 3, y: 3, dir: 'S' }] }))).toBe('epoxy_only_monsters');
    expect(datRefusalReason(room({ entities: [{ type: AWAKE, x: 3, y: 3, dir: 'S' }] }))).toBe('epoxy_only_monsters');
    const encoded = DatCodec.encodeLevelsWithReport([room({ entities: [{ type: AWAKE, x: 3, y: 3, dir: 'S' }] })]);
    expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_monsters']);
  });
});
