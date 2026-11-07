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
import { findRelayPadConfigErrors, normalizeUnderlays } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V11, PACK_JSON_VERSION_V11_IDS } from '../../config/constants';
import { connectionRows } from '../../editor/connectionRows';
import { signalTileHoldsEnd, signalTileTakesOneInput } from '../../editor/editorSignalLinks';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import {
  featuresFor,
  hasRelayPadContent,
  isEpoxyOnlyItemId,
  isEpoxyOnlyTileId,
  isRelayPadTileId
} from '../RulesetFeatures';
import { CHARGE_ITEM_ID, GATE_ITEM_ID, RELAY_TELEPORT_GROUP, STONE_ITEM_ID } from '../coreConstants';
import { engineSimulationHash } from '../engineSimHash';
import { compileSignalSpec, idSetVersionOf, signalSinkOf, usesV7Ids } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, LauncherLink, SignalLink, SignalSpec } from '../types';
import { SignalWiringError, createSignalRuntime, registryTileLookup } from './epoxySignals';
import type { EpoxyContext } from './epoxyWorld';

const DARK = 'relay_pad_dark';
const LIT = 'relay_pad_lit';
const PLATE = 'signal_plate';
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const MAX_WAIT_TICKS = 40;
const BLOCK_ID = 'dirt_block';
const MONSTER_ID = 'pink_ball';
const WISP = 'wisp';
/** Ticks that outlast the fuse of a charge once the player stands clear. */
const BLAST_WAIT_TICKS = 70;
/** Ticks that let a monster take its first step. */
const MONSTER_WAIT_TICKS = 80;
/** Ticks that let a shot or a stone cross the whole room. */
const FLIGHT_TICKS = 80;
/** Ticks that outlast any monster step: a monster given this cooldown stands still for the test. */
const STILL_COOLDOWN_TICKS = 100000;
/** Ticks that are always enough for a wisp to take one step. */
const ONE_STEP_TICKS = 40;
const SCRIPT_REPEATS = 2;
const START = { x: 2, y: 5 };
const PLATE_CELL = { x: 3, y: 5 };
/** The pad that the plate powers, and a pad that is lit as placed and wired to nothing. */
const POWERED_PAD = { x: 6, y: 3 };
const FAR_PAD = { x: 10, y: 9 };
/** Column of the wall that splits the validator room in two. */
const SPLIT_COLUMN = 7;
const FAR_CELL = { x: 11, y: 1 };

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[Cell, string]>;
  items?: Array<[Cell, string]>;
  entities?: EntityPlacement[];
  player?: Cell;
  signalLinks?: SignalLink[];
  launcherLinks?: LauncherLink[];
  underlays?: CompiledLevel['underlays'];
}

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [cell, id] of setup.items ?? []) items[cell.y][cell.x] = id;
  return {
    id: 'relay_pad_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks }),
    ...(setup.launcherLinks === undefined ? {} : { launcherLinks: setup.launcherLinks }),
    ...(setup.underlays === undefined ? {} : { underlays: setup.underlays })
  };
}

/** A plate beside the start, wired to a dark pad, with a second pad lit as placed far away. */
function wiredRoom(extra: Setup = {}): CompiledLevel {
  return room({
    terrain: [
      [PLATE_CELL, PLATE],
      [POWERED_PAD, DARK],
      [FAR_PAD, LIT],
      ...(extra.terrain ?? [])
    ],
    signalLinks: [link(PLATE_CELL, POWERED_PAD)],
    ...(extra.entities === undefined ? {} : { entities: extra.entities }),
    ...(extra.items === undefined ? {} : { items: extra.items }),
    ...(extra.player === undefined ? {} : { player: extra.player })
  });
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

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];
const at = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });

/** Gives every monster a cooldown so long that it stands where it was placed. */
function freezeMonsters(engine: GameEngine): void {
  for (const entity of engine.getEntities()) {
    if (entity.kind === 'monster') entity.cooldownTicks = STILL_COOLDOWN_TICKS;
  }
}

beforeEach(() => {
  loadTestConfigs();
});

describe('relay pad: configuration', () => {
  it('is a dark floor and a lit teleporter of one group, each naming the other', () => {
    const dark = ConfigRegistry.getTile(DARK);
    const lit = ConfigRegistry.getTile(LIT);
    expect([dark.relayPad, lit.relayPad]).toEqual(['dark', 'lit']);
    expect([dark.relayTwin, lit.relayTwin]).toEqual([LIT, DARK]);
    expect(dark.isTeleporter).toBeUndefined();
    expect(lit.isTeleporter).toBe(true);
    expect([dark.teleportGroup, lit.teleportGroup]).toEqual([RELAY_TELEPORT_GROUP, RELAY_TELEPORT_GROUP]);
    for (const tile of [dark, lit]) {
      expect(tile.layer).toBe('terrain');
      expect(tile.passableByPlayer && tile.passableByMonster && tile.passableByBlock).toBe(true);
      expect(tile.laserTransparent).toBe(true);
    }
    expect(findRelayPadConfigErrors(ConfigRegistry.getTiles().tiles)).toEqual([]);
  });

  it('is named in both languages, with its validator and editor messages', () => {
    for (const locale of [en, fr] as unknown as Array<{
      tiles: Record<string, { name: string; desc: { label: string } }>;
      validator: { issues: Record<string, { label: string }> };
      editor: { connections: { needs: Record<string, { label: string }>; fallback: Record<string, string> } };
    }>) {
      for (const id of [DARK, LIT]) {
        expect(locale.tiles[id].name).toBeTruthy();
        expect(locale.tiles[id].desc.label).toBeTruthy();
      }
      expect(locale.validator.issues.relay_pad_dark_unlinked.label).toBeTruthy();
      expect(locale.validator.issues.relay_group_alone.label).toBeTruthy();
      expect(locale.editor.connections.needs.relay_pad.label).toBeTruthy();
      expect(locale.editor.connections.fallback.signal_powers).toBeTruthy();
    }
  });

  it('refuses a broken pair of pads in the config check', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    tiles[LIT].relayTwin = 'floor';
    expect(findRelayPadConfigErrors(tiles).join(';')).toContain(`${LIT}.relayTwin`);
    const notTeleporter = structuredClone(ConfigRegistry.getTiles().tiles);
    notTeleporter[LIT].isTeleporter = undefined;
    expect(findRelayPadConfigErrors(notTeleporter).join(';')).toContain(`${LIT}.isTeleporter`);
    const stray = structuredClone(ConfigRegistry.getTiles().tiles);
    stray.wall.relayTwin = LIT;
    expect(findRelayPadConfigErrors(stray).join(';')).toContain('wall.relayTwin');
  });

  it('is Epoxy-only: hidden under Lynx, refused by the DAT export, listed among the Epoxy-only ids', () => {
    for (const id of [DARK, LIT]) {
      expect(tileAvailability('lynx', id).available).toBe(false);
      expect(tileAvailability('epoxy', id).available).toBe(true);
      expect(isEpoxyOnlyItemId(id)).toBe(true);
      expect(isEpoxyOnlyTileId(id)).toBe(true);
      expect(isRelayPadTileId(id)).toBe(true);
    }
    expect(isRelayPadTileId('teleport')).toBe(false);
    for (const placed of [room({ terrain: [[{ x: 3, y: 3 }, DARK]] }), room({ terrain: [[{ x: 3, y: 3 }, LIT]] })]) {
      expect(datRefusalReason(placed)).toBe('epoxy_only_items');
      const encoded = DatCodec.encodeLevelsWithReport([placed, room()]);
      expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
      expect(encoded.levelCount).toBe(1);
    }
  });

  it('is never kept hidden under a removable top', () => {
    const level = room({ terrain: [[{ x: 4, y: 4 }, 'door_red']] });
    expect(normalizeUnderlays([{ x: 4, y: 4, terrain: DARK }], level.terrain, 'epoxy')).toBeNull();
    expect(normalizeUnderlays([{ x: 4, y: 4, terrain: LIT }], level.terrain, 'epoxy')).toBeNull();
  });
});

describe('relay pad: following its input', () => {
  it('lights while its input is on and darkens when it is off', () => {
    const engine = load(wiredRoom());
    expect(tileAt(engine, POWERED_PAD)).toBe(DARK);
    expect(step(engine, 'E')).toBe(true);
    expect(at(engine)).toEqual(PLATE_CELL);
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    // The pad follows the level of the signal, not its edges: stepping off darkens it again.
    expect(step(engine, 'W')).toBe(true);
    expect(tileAt(engine, POWERED_PAD)).toBe(DARK);
    expect(step(engine, 'E')).toBe(true);
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
  });

  it('follows the input at load: a lit pad with its input off starts dark, a dark pad with its input on starts lit', () => {
    const litAsPlaced = load(room({ terrain: [[PLATE_CELL, PLATE], [POWERED_PAD, LIT], [FAR_PAD, LIT]], signalLinks: [link(PLATE_CELL, POWERED_PAD)] }));
    expect(tileAt(litAsPlaced, POWERED_PAD)).toBe(DARK);
    const standingOnPlate = load(wiredRoom({ player: PLATE_CELL }));
    expect(tileAt(standingOnPlate, POWERED_PAD)).toBe(LIT);
    // A block on the plate holds it down from the start too, and the player has not moved.
    const blockOnPlate = load(wiredRoom({ entities: [{ type: BLOCK_ID, x: PLATE_CELL.x, y: PLATE_CELL.y, dir: 'E' }] }));
    expect(tileAt(blockOnPlate, POWERED_PAD)).toBe(LIT);
    expect(at(blockOnPlate)).toEqual(START);
  });

  it('keeps the form an unlinked pad was placed in, whatever else the signals do', () => {
    const engine = load(
      room({
        terrain: [
          [PLATE_CELL, PLATE],
          [POWERED_PAD, DARK],
          [FAR_PAD, LIT],
          [{ x: 9, y: 3 }, DARK],
          [{ x: 4, y: 9 }, LIT]
        ],
        signalLinks: [link(PLATE_CELL, POWERED_PAD)]
      })
    );
    step(engine, 'E');
    expect(tileAt(engine, { x: 9, y: 3 })).toBe(DARK);
    expect(tileAt(engine, { x: 4, y: 9 })).toBe(LIT);
    expect(tileAt(engine, FAR_PAD)).toBe(LIT);
    step(engine, 'W');
    expect(tileAt(engine, { x: 9, y: 3 })).toBe(DARK);
    expect(tileAt(engine, { x: 4, y: 9 })).toBe(LIT);
  });

  it('settles on the tick too: a monster that presses the plate lights the pad', () => {
    const engine = load(
      wiredRoom({ player: { x: 1, y: 11 }, entities: [{ type: MONSTER_ID, x: PLATE_CELL.x - 1, y: PLATE_CELL.y, dir: 'E' }] })
    );
    let ticks = 0;
    while (tileAt(engine, POWERED_PAD) === DARK && ticks < MONSTER_WAIT_TICKS) {
      engine.tick();
      ticks++;
    }
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
  });
});

describe('relay pad: jumping', () => {
  it('jumps on arrival on a lit pad, to the previous lit relay pad in reading order, and not otherwise', () => {
    const engine = load(room({ terrain: [[{ x: 4, y: 3 }, LIT], [{ x: 8, y: 3 }, LIT], [{ x: 5, y: 9 }, LIT]], player: { x: 3, y: 3 } }));
    // From the first pad in reading order, the previous one wraps round to the last: (5, 9), leaving by the way it came.
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 6, y: 9 });
    // Walking back onto the last pad goes to the one before it in reading order, (8, 3), and leaves west.
    step(engine, 'W');
    expect(at(engine)).toEqual({ x: 7, y: 3 });
    // Walking east onto that pad goes to the first one, (4, 3), and leaves east.
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 5, y: 3 });
  });

  it('reads the pads live: a dark pad is skipped, and a pad that lit in the meantime joins', () => {
    const skipped = load(room({ terrain: [[{ x: 4, y: 3 }, LIT], [{ x: 8, y: 3 }, DARK], [{ x: 5, y: 9 }, LIT]], player: { x: 4, y: 9 } }));
    step(skipped, 'E');
    expect(at(skipped)).toEqual({ x: 5, y: 3 });
    // A block holds the plate down at load, so the wired pad is lit and joins the ring.
    const joined = load(
      room({
        terrain: [[PLATE_CELL, PLATE], [{ x: 4, y: 3 }, LIT], [{ x: 8, y: 3 }, DARK], [{ x: 5, y: 9 }, LIT]],
        signalLinks: [link(PLATE_CELL, { x: 8, y: 3 })],
        entities: [{ type: BLOCK_ID, x: PLATE_CELL.x, y: PLATE_CELL.y, dir: 'N' }],
        player: { x: 4, y: 9 }
      })
    );
    expect(tileAt(joined, { x: 8, y: 3 })).toBe(LIT);
    step(joined, 'E');
    expect(at(joined)).toEqual({ x: 9, y: 3 });
  });

  it('does nothing for a lone lit pad, and stays apart from the other teleporters', () => {
    const lone = load(room({ terrain: [[{ x: 4, y: 3 }, LIT]], player: { x: 3, y: 3 } }));
    step(lone, 'E');
    expect(at(lone)).toEqual({ x: 4, y: 3 });
    const mixed = load(room({ terrain: [[{ x: 4, y: 3 }, LIT], [{ x: 9, y: 9 }, 'teleport'], [{ x: 9, y: 5 }, 'pocket_gate_pad']], player: { x: 3, y: 3 } }));
    step(mixed, 'E');
    expect(at(mixed)).toEqual({ x: 4, y: 3 });
  });

  it('makes no jump when a pad lights under an actor, and jumps on the next arrival', () => {
    const engine = load(
      room({
        terrain: [[{ x: 4, y: 7 }, PLATE], [POWERED_PAD, DARK], [FAR_PAD, LIT]],
        signalLinks: [link({ x: 4, y: 7 }, POWERED_PAD)],
        entities: [{ type: MONSTER_ID, x: 2, y: 7, dir: 'E' }],
        player: POWERED_PAD
      })
    );
    expect(at(engine)).toEqual(POWERED_PAD);
    let ticks = 0;
    while (tileAt(engine, POWERED_PAD) === DARK && ticks < MONSTER_WAIT_TICKS) {
      engine.tick();
      ticks++;
    }
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    expect(at(engine)).toEqual(POWERED_PAD);
    // Leaving the pad and coming back is an arrival on a lit pad. Freeze the monster on the plate first.
    for (const entity of engine.getEntities()) entity.cooldownTicks = STILL_COOLDOWN_TICKS;
    const stillLit = tileAt(engine, POWERED_PAD) === LIT;
    expect(stillLit).toBe(true);
    step(engine, 'S');
    step(engine, 'N');
    expect(at(engine)).toEqual({ x: FAR_PAD.x, y: FAR_PAD.y - 1 });
  });

  it('leaves the actor standing when the pad darkens under it', () => {
    const engine = load(wiredRoom({ player: PLATE_CELL }));
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    const blocker = load(
      room({
        terrain: [[PLATE_CELL, PLATE], [POWERED_PAD, DARK], [FAR_PAD, LIT]],
        signalLinks: [link(PLATE_CELL, POWERED_PAD)],
        player: { x: 2, y: 5 },
        entities: [{ type: BLOCK_ID, x: POWERED_PAD.x, y: POWERED_PAD.y, dir: 'E' }]
      })
    );
    expect(tileAt(blocker, POWERED_PAD)).toBe(DARK);
    step(blocker, 'E');
    expect(tileAt(blocker, POWERED_PAD)).toBe(LIT);
    expect(blocker.getEntities().some((e) => e.x === POWERED_PAD.x && e.y === POWERED_PAD.y)).toBe(true);
    step(blocker, 'W');
    expect(tileAt(blocker, POWERED_PAD)).toBe(DARK);
    expect(blocker.getEntities().some((e) => e.x === POWERED_PAD.x && e.y === POWERED_PAD.y)).toBe(true);
  });

  it('carries a block pushed onto a lit pad, and a monster that walks onto one', () => {
    const block = load(
      room({
        terrain: [[{ x: 5, y: 5 }, LIT], [{ x: 9, y: 9 }, LIT]],
        entities: [{ type: BLOCK_ID, x: 4, y: 5, dir: 'E' }],
        player: { x: 3, y: 5 }
      })
    );
    step(block, 'E');
    expect(block.getEntities().find((e) => e.type === BLOCK_ID)).toMatchObject({ x: 10, y: 9 });
    expect(tileAt(block, { x: 5, y: 5 })).toBe(LIT);
    const monster = load(
      room({
        terrain: [[{ x: 5, y: 3 }, LIT], [{ x: 9, y: 9 }, LIT]],
        entities: [{ type: MONSTER_ID, x: 4, y: 3, dir: 'E' }],
        player: { x: 1, y: 11 }
      })
    );
    let ticks = 0;
    while (monster.getEntities()[0].x === 4 && ticks < MONSTER_WAIT_TICKS) {
      monster.tick();
      ticks++;
    }
    expect(monster.getEntities()[0]).toMatchObject({ x: 10, y: 9 });
  });

  it('does not carry a block pushed onto a dark pad', () => {
    const engine = load(
      room({
        terrain: [[{ x: 5, y: 5 }, DARK], [{ x: 9, y: 9 }, LIT]],
        entities: [{ type: BLOCK_ID, x: 4, y: 5, dir: 'E' }],
        player: { x: 3, y: 5 }
      })
    );
    step(engine, 'E');
    expect(engine.getEntities().find((e) => e.type === BLOCK_ID)).toMatchObject({ x: 5, y: 5 });
  });
});

describe('relay pad: what ignores it', () => {
  it('lets a flying stone and a launcher shot cross a lit pad', () => {
    const stone = load(
      room({
        terrain: [[{ x: 5, y: 5 }, LIT], [FAR_PAD, LIT]],
        entities: [{ type: MONSTER_ID, x: 8, y: 5, dir: 'E' }]
      })
    );
    freezeMonsters(stone);
    stone.getPlayer().keys[STONE_ITEM_ID] = 1;
    expect(stone.dropItem(STONE_ITEM_ID)).toBe(true);
    tickN(stone, FLIGHT_TICKS);
    expect(stone.getEntities().filter((e) => e.type === MONSTER_ID)).toEqual([]);
    expect(at(stone)).toEqual(START);

    const shot = load(
      room({
        terrain: [[{ x: 3, y: 5 }, 'shot_trigger'], [{ x: 4, y: 5 }, 'shot_launcher_e'], [{ x: 6, y: 5 }, LIT], [FAR_PAD, LIT]],
        launcherLinks: [{ buttonX: 3, buttonY: 5, launcherX: 4, launcherY: 5 }],
        entities: [{ type: MONSTER_ID, x: 9, y: 5, dir: 'E' }]
      })
    );
    freezeMonsters(shot);
    step(shot, 'E');
    tickN(shot, FLIGHT_TICKS);
    expect(shot.getEntities().filter((e) => e.type === MONSTER_ID)).toEqual([]);
  });

  it('lets a laser beam through a lit pad', () => {
    const engine = load(
      room({
        terrain: [[{ x: 2, y: 3 }, 'laser_emitter_e'], [{ x: 5, y: 3 }, LIT], [{ x: 8, y: 3 }, 'laser_receiver_red'], [FAR_PAD, LIT]]
      })
    );
    expect(engine.getLitReceivers()).toHaveLength(1);
  });

  it('does not jump a wisp, which walks across a lit pad', () => {
    const engine = load(
      room({
        terrain: [[{ x: 6, y: 5 }, LIT], [FAR_PAD, LIT]],
        entities: [{ type: WISP, x: 5, y: 5, dir: 'E' }],
        player: { x: 11, y: 11 }
      })
    );
    const wispOf = (): EntityPlacement | undefined => engine.getEntities().find((e) => e.type === WISP);
    for (let i = 0; i < ONE_STEP_TICKS && wispOf()?.x === 5; i++) engine.tick();
    expect(wispOf()).toMatchObject({ x: 6, y: 5 });
  });

  it('leaves the pads standing after a blast', () => {
    const engine = load(room({ terrain: [[{ x: 4, y: 5 }, LIT], [FAR_PAD, LIT], [{ x: 8, y: 5 }, DARK]], items: [[{ x: 3, y: 5 }, CHARGE_ITEM_ID]] }));
    step(engine, 'E');
    // The step onto the lit pad at (4, 5) jumped the player; the charge was picked up on the way.
    expect(engine.dropItem(CHARGE_ITEM_ID)).toBe(true);
    contextOf(engine).world.player.x = FAR_CELL.x;
    contextOf(engine).world.player.y = FAR_CELL.y;
    tickN(engine, BLAST_WAIT_TICKS);
    expect(engine.getLitCharges()).toBeUndefined();
    expect(tileAt(engine, { x: 4, y: 5 })).toBe(LIT);
    expect(tileAt(engine, FAR_PAD)).toBe(LIT);
    expect(tileAt(engine, { x: 8, y: 5 })).toBe(DARK);
  });

  it('refuses to set a pocket gate down on a pad, lit or dark', () => {
    for (const id of [DARK, LIT]) {
      const engine = load(room({ terrain: [[START, id], [FAR_PAD, LIT]] }));
      engine.getPlayer().keys[GATE_ITEM_ID] = 1;
      expect(engine.dropItem(GATE_ITEM_ID)).toBe(false);
      expect(engine.getPlayer().keys[GATE_ITEM_ID]).toBe(1);
      expect(tileAt(engine, START)).toBe(id);
    }
  });
});

describe('relay pad: sinks', () => {
  it('is a powers sink, one of three exclusive kinds, taking one input and never an output', () => {
    const dark = ConfigRegistry.getTile(DARK);
    const lit = ConfigRegistry.getTile(LIT);
    expect(signalSinkOf(dark)).toEqual({ powers: true });
    expect(signalSinkOf(lit)).toEqual({ powers: true });
    expect(signalSinkOf(dark, { hidden: true })).toBeNull();
    expect(signalSinkOf(ConfigRegistry.getTile('hold_door_red_closed'))).toEqual({ color: 'red' });
    expect(signalSinkOf(ConfigRegistry.getTile('toggle_wall_closed'))).toEqual({ fires: 'flip' });
    expect(signalTileTakesOneInput(dark)).toBe(true);
    expect(signalTileHoldsEnd(dark, 'input')).toBe(true);
    expect(signalTileHoldsEnd(lit, 'output')).toBe(false);
    expect(signalTileHoldsEnd(ConfigRegistry.getTile('teleport'), 'input')).toBe(false);
  });

  it('compiles a link to a pad into a powers sink', () => {
    const spec = compileSignalSpec(wiredRoom(), registryTileLookup);
    expect(spec?.nodes.find((node) => node.kind === 'sink')).toMatchObject({ powers: true });
  });

  it('refuses a sink that has not exactly one kind', () => {
    const spec = (sink: Record<string, unknown>): SignalSpec => ({
      nodes: [
        { cell: 0, kind: 'source', sample: 'held' },
        { cell: 1, kind: 'sink', ...sink }
      ],
      links: [{ from: 0, to: 1 }]
    });
    expect(() => createSignalRuntime(spec({ powers: true }))).not.toThrow();
    expect(() => createSignalRuntime(spec({ powers: true, color: 'red' }))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec({ powers: true, fires: 'flip' }))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec({ color: 'red', fires: 'flip' }))).toThrow(SignalWiringError);
    expect(() => createSignalRuntime(spec({}))).toThrow(SignalWiringError);
  });

  it('refuses a second signal into a pad', () => {
    const level = wiredRoom();
    level.terrain[7][4] = PLATE;
    level.signalLinks = [link(PLATE_CELL, POWERED_PAD), link({ x: 4, y: 7 }, POWERED_PAD)];
    expect(LevelValidator.validate(level).issues.map((i) => i.i18nKey)).toContain('validator.issues.signal_sink_inputs.label');
  });
});

describe('relay pad: the editor', () => {
  it('lists the pads of the relay group with each other, with a note for a lone pad', () => {
    const pair = wiredRoom();
    const rows = connectionRows(pair, POWERED_PAD.x, POWERED_PAD.y);
    expect(rows.controls?.rows.some((row) => row.system === 'teleport')).toBe(true);
    expect(rows.note?.key).toBe('editor.connections.fallback.signal_powers');
    const lone = room({ terrain: [[POWERED_PAD, DARK], [PLATE_CELL, PLATE]], signalLinks: [link(PLATE_CELL, POWERED_PAD)] });
    expect(connectionRows(lone, POWERED_PAD.x, POWERED_PAD.y).note?.key).toBe('editor.connections.needs.relay_pad.label');
    const loneLit = room({ terrain: [[FAR_PAD, LIT]] });
    expect(connectionRows(loneLit, FAR_PAD.x, FAR_PAD.y).note?.key).toBe('editor.connections.needs.relay_pad.label');
  });
});

describe('relay pad: the validator', () => {
  /** A wall splits the room: the player and the plate on the left, the lit pad and the exit on the right. */
  function splitRoom(options: { wired?: boolean; litLeft?: boolean } = {}): CompiledLevel {
    const wall: Array<[Cell, string]> = Array.from({ length: SIZE - 2 }, (_, i): [Cell, string] => [{ x: SPLIT_COLUMN, y: i + 1 }, 'wall']);
    const level = room({
      terrain: [...wall, [PLATE_CELL, PLATE], [{ x: 5, y: 5 }, options.litLeft === true ? LIT : DARK], [{ x: 9, y: 5 }, LIT], [{ x: 11, y: 5 }, 'exit']],
      ...(options.wired === false ? {} : { signalLinks: [link(PLATE_CELL, { x: 5, y: 5 })] })
    });
    return level;
  }

  it('does not report the exit unreachable when a pad is dark at the start and powered later', () => {
    const report = LevelValidator.validate(splitRoom());
    expect(report.stats.reachableExit).toBe(true);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(report.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.teleport_alone.label');
    expect(report.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.teleport_alone_plain.label');
  });

  it('keeps the exit unreachable when the dark pad has no wire', () => {
    const report = LevelValidator.validate(splitRoom({ wired: false }));
    expect(report.stats.reachableExit).toBe(false);
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.relay_pad_dark_unlinked.label');
  });

  it('reaches the exit through a lit pad placed that way, wired or not', () => {
    expect(LevelValidator.validate(splitRoom({ wired: false, litLeft: true })).stats.reachableExit).toBe(true);
  });

  it('says so for a dark pad nothing powers, and for a group of fewer than two pads', () => {
    const unlinked = LevelValidator.validate(room({ terrain: [[POWERED_PAD, DARK], [FAR_PAD, LIT]] }));
    const unlinkedKeys = unlinked.issues.map((i) => i.i18nKey);
    expect(unlinkedKeys).toContain('validator.issues.relay_pad_dark_unlinked.label');
    expect(unlinkedKeys).not.toContain('validator.issues.relay_group_alone.label');
    const unlinkedIssue = unlinked.issues.find((i) => i.i18nKey === 'validator.issues.relay_pad_dark_unlinked.label');
    expect(unlinkedIssue).toMatchObject({ severity: 'info', params: expect.objectContaining(POWERED_PAD) });

    const lone = LevelValidator.validate(room({ terrain: [[FAR_PAD, LIT]] }));
    const alone = lone.issues.find((i) => i.i18nKey === 'validator.issues.relay_group_alone.label');
    expect(alone).toMatchObject({ severity: 'info' });
    expect(lone.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.teleport_alone_plain.label');
    expect(lone.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.teleport_alone.label');

    const pair = LevelValidator.validate(room({ terrain: [[POWERED_PAD, LIT], [FAR_PAD, LIT]] }));
    expect(pair.issues.map((i) => i.i18nKey)).not.toContain('validator.issues.relay_group_alone.label');
  });

  it('turns the block hint and the dead-end watch off, and says nothing of them on a plain level', () => {
    const plain = featuresFor(room());
    const relay = featuresFor(wiredRoom());
    expect(plain.blockHint).toBe(true);
    expect(plain.deadEndWatch).toBe(true);
    expect(relay.blockHint).toBe(false);
    expect(relay.deadEndWatch).toBe(false);
    expect(hasRelayPadContent(wiredRoom())).toBe(true);
    expect(hasRelayPadContent(room())).toBe(false);
  });
});

describe('relay pad: pack format 11', () => {
  it('names its ids in a format 11 row of the id table, and detects them on the terrain only', () => {
    expect(PACK_JSON_VERSION_V11).toBe(11);
    expect([...PACK_JSON_VERSION_V11_IDS].sort()).toEqual([DARK, LIT].sort());
    for (const id of PACK_JSON_VERSION_V11_IDS) expect(ConfigRegistry.getTiles().tiles[id]).toBeDefined();
    expect(idSetVersionOf(room({ terrain: [[POWERED_PAD, DARK]] }))).toBe(PACK_JSON_VERSION_V11);
    expect(idSetVersionOf(room({ terrain: [[FAR_PAD, LIT]] }))).toBe(PACK_JSON_VERSION_V11);
    expect(usesV7Ids(room({ terrain: [[FAR_PAD, LIT]] }))).toBe(false);
    expect(idSetVersionOf(room())).toBe(0);
    const cc3d: CompiledLevel = { ...room({ terrain: [[FAR_PAD, LIT]] }), ruleset: 'cc3d' };
    expect(idSetVersionOf(cc3d)).toBe(0);
    // The reading and writing of format 11 itself is switched on with the rest of the release, in a later lot.
  });
});

describe('relay pad: undo and replay', () => {
  it('puts the pad back on undo and gives the same state on a replay', () => {
    const engine = load(wiredRoom());
    const darkSignals = engine.getSignalState();
    step(engine, 'E');
    const litSignals = engine.getSignalState();
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    expect(engine.undo()).toBe(true);
    expect(tileAt(engine, POWERED_PAD)).toBe(DARK);
    expect(engine.getSignalState()).toEqual(darkSignals);
    step(engine, 'E');
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    expect(engine.getSignalState()).toEqual(litSignals);
  });

  it('undoes a jump along with the pad that sent it', () => {
    // A block holds the plate down from the start, so the wired pad is lit when the player steps onto it.
    const engine = load(wiredRoom({ entities: [{ type: BLOCK_ID, x: PLATE_CELL.x, y: PLATE_CELL.y, dir: 'N' }], player: { x: POWERED_PAD.x - 1, y: POWERED_PAD.y } }));
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: FAR_PAD.x + 1, y: FAR_PAD.y });
    expect(engine.undo()).toBe(true);
    expect(tileAt(engine, POWERED_PAD)).toBe(LIT);
    expect(at(engine)).toEqual({ x: POWERED_PAD.x - 1, y: POWERED_PAD.y });
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: FAR_PAD.x + 1, y: FAR_PAD.y });
  });

  it('gives the same simulation hash twice, and a different terrain once the pad is lit', () => {
    const level = wiredRoom();
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
    const walked = load(level);
    const before = walked.getTerrain().map((row) => row.join(',')).join(';');
    step(walked, 'E');
    expect(walked.getTerrain().map((row) => row.join(',')).join(';')).not.toBe(before);
  });
});
