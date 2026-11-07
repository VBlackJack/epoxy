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

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findGateConfigErrors } from '../../config/ConfigValidation';
import {
  PACK_JSON_ID_SET_VERSIONS,
  PACK_JSON_MAX_VERSION,
  PACK_JSON_VERSION_V7,
  PACK_JSON_VERSION_V8,
  PACK_JSON_VERSION_V8_IDS,
  PACK_JSON_VERSION_V9,
  PACK_JSON_VERSION_V10
} from '../../config/constants';
import { tileAvailability } from '../../editor/paletteAvailability';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import { parseSegment } from '../../generator/CampaignRoute';
import {
  decodeActions,
  DROP_ACTION_ITEMS,
  DROP_CHARGE_ACTION,
  DROP_GATE_ACTION,
  encodeActions,
  PieceSolver
} from '../../generator/PieceSolver';
import { storedSolutionWins, timedSolution } from '../../generator/SolutionReplay';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { collectDueMoves } from '../../ui/replaySchedule';
import { BlockPuzzleSolver } from '../BlockPuzzleSolver';
import { CHARGE_ITEM_ID, GATE_ITEM_ID, GATE_PAD_TILE_ID } from '../coreConstants';
import { DifficultyMetrics } from '../DifficultyMetrics';
import { engineSimulationHash } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import {
  featuresFor,
  hasEpoxyOnlyContent,
  hasPocketGateContent,
  isEpoxyOnlyItemId,
  isEpoxyOnlyTileId,
  isPocketGateTileId
} from '../RulesetFeatures';
import { idSetVersionOf, usesV7Ids } from '../signalLinks';
import type { CompiledLevel, Direction, EntityPlacement, TileDefinition } from '../types';
import type { EpoxyContext } from './epoxyWorld';

const GATE = GATE_ITEM_ID;
const PAD = GATE_PAD_TILE_ID;
const CHARGE = CHARGE_ITEM_ID;
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const PLAYER_START = { x: 2, y: 5 };
const MAX_WAIT_TICKS = 40;
const KEY_THIEF_ID = 'thief_keys';
const STRAIGHT_MONSTER = 'pink_ball';
const BLOCK_ID = 'dirt_block';
/** Ticks a straight monster is given to make its first move. */
const MONSTER_WAIT_TICKS = 80;
/** Waits that outlast the fuse of a charge once the player stands clear. */
const BLAST_WAIT_TICKS = 70;
const SCRIPT_REPEATS = 2;
/** Column of the wall that splits the room of the reach tests in two. */
const SPLIT_COLUMN = 6;
/** Solution of the split room: pick the gate up, set it down, step off and back on to jump. */
const SPLIT_SOLUTION = 'EGWE';
/** Cell the tests move the player to, far from any pad. */
const FAR_CELL = { x: 11, y: 1 };

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  solution?: string;
}

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'pocket_gate_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? PLAYER_START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    ...(setup.solution === undefined ? {} : { solution: setup.solution })
  };
}

/**
 * A room split in two by a wall: the gate lies on the left with the player, a single placed pad and the exit are on
 * the right. The exit can be reached only by setting the gate down and stepping onto it, which jumps to the placed pad.
 */
function splitRoom(options: { gate?: boolean; pad?: boolean; solution?: string } = {}): CompiledLevel {
  const wall: Array<[number, number, string]> = Array.from({ length: SIZE - 2 }, (_, i): [number, number, string] => [SPLIT_COLUMN, i + 1, 'wall']);
  const terrain: Array<[number, number, string]> = [...wall, [10, 5, 'exit']];
  if (options.pad !== false) terrain.push([9, 5, PAD]);
  return room({
    terrain,
    items: options.gate === false ? [] : [[3, 5, GATE]],
    ...(options.solution === undefined ? {} : { solution: options.solution })
  });
}

/**
 * Two halves joined by a one-way force floor. The start half holds a gate and, behind water, the exit; the far half
 * holds a second gate and the water boots. Only a pad set down on each half lets the player come back with the boots.
 */
function oneWayRoom(options: { startGate?: boolean; farGate?: boolean } = {}): CompiledLevel {
  const wall: Array<[number, number, string]> = Array.from({ length: SIZE - 2 }, (_, i): [number, number, string] => [4, i + 1, i + 1 === 5 ? 'force_e' : 'wall']);
  const items: Array<[number, number, string]> = [[8, 5, 'boots_water']];
  if (options.startGate !== false) items.push([3, 5, GATE]);
  if (options.farGate !== false) items.push([9, 5, GATE]);
  return room({ terrain: [...wall, [1, 4, 'wall'], [3, 4, 'wall'], [2, 4, 'water'], [2, 3, 'exit']], items });
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

function hold(engine: GameEngine, id: string, count: number): void {
  engine.getPlayer().keys[id] = count;
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function at(engine: GameEngine): { x: number; y: number } {
  const { x, y } = engine.getPlayer();
  return { x, y };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('pocket gate: configuration', () => {
  it('is a carried item that sets down a portable pad, named in both languages', () => {
    const gate = ConfigRegistry.getTile(GATE);
    expect(gate.collectible).toBe('gate');
    expect(gate.layer).toBe('item');
    expect(gate.dropsAsTerrain).toBe(PAD);
    const pad = ConfigRegistry.getTile(PAD);
    expect(pad.layer).toBe('terrain');
    expect(pad.isTeleporter).toBe(true);
    expect(pad.teleportGroup).toBe('pocket');
    expect(pad.portableTeleporter).toBe(true);
    expect(pad.passableByPlayer && pad.passableByMonster && pad.passableByBlock).toBe(true);
    expect(ConfigRegistry.getTile('teleport_yellow').portableTeleporter).toBeUndefined();
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      for (const id of [GATE, PAD]) {
        expect(locale.tiles[id].name).toBeTruthy();
        expect(locale.tiles[id].desc.label).toBeTruthy();
      }
    }
    expect([en.tiles.pocket_gate.name, en.tiles.pocket_gate_pad.name]).toEqual(['Pocket Gate', 'Pocket Gate (placed)']);
    expect([fr.tiles.pocket_gate.name, fr.tiles.pocket_gate_pad.name]).toEqual(['Porte de poche', 'Porte de poche (posée)']);
  });

  it('has the refusal message and the phone strip label in both languages', () => {
    for (const locale of [en, fr] as unknown as Array<{
      hud: { messages: Record<string, { label: string }>; touch_overlay: Record<string, { action?: string }> };
    }>) {
      expect(locale.hud.messages.drop_not_floor.label).toBeTruthy();
      expect(locale.hud.touch_overlay.gate.action).toBeTruthy();
    }
  });

  it('puts a phone strip button after the charge button, labelled by a key both languages define', () => {
    const page = readFileSync('index.html', 'utf8');
    const button = /<button id="touch-btn-gate"[^>]*>/.exec(page)?.[0] ?? '';
    expect(button).toContain('data-i18n-aria-label="hud.touch_overlay.gate.action"');
    expect(button).toContain('data-i18n-title="hud.touch_overlay.gate.action"');
    expect(page.indexOf('touch-btn-gate')).toBeGreaterThan(page.indexOf('touch-btn-charge'));
    expect(page.indexOf('touch-btn-gate')).toBeLessThan(page.indexOf('touch-btn-menu'));
  });

  it('reports a gate that names no pad, a stray dropsAsTerrain, and a portable flag on a non-teleporter', () => {
    const tiles = ConfigRegistry.getTiles().tiles as Record<string, TileDefinition>;
    expect(findGateConfigErrors(tiles)).toEqual([]);
    expect(findGateConfigErrors({ ...tiles, [GATE]: { ...tiles[GATE], dropsAsTerrain: 'teleport' } })).toHaveLength(1);
    expect(findGateConfigErrors({ ...tiles, [GATE]: { ...tiles[GATE], dropsAsTerrain: undefined } })).toHaveLength(1);
    expect(findGateConfigErrors({ ...tiles, chip: { ...tiles.chip, dropsAsTerrain: PAD } })).toHaveLength(1);
    expect(findGateConfigErrors({ ...tiles, floor: { ...tiles.floor, portableTeleporter: true } })).toHaveLength(1);
  });
});

describe('pocket gate: pickup, drop and refusal', () => {
  it('is picked up into the inventory as a count and shown among the held items', () => {
    const engine = load(
      room({
        items: [
          [3, 5, GATE],
          [4, 5, GATE]
        ]
      })
    );
    expect(engine.getHeldItems()).not.toContain(GATE);
    step(engine, 'E');
    expect(engine.getItems()[5][3]).toBeNull();
    expect(engine.getPlayer().keys[GATE]).toBe(1);
    expect(engine.holdsItem(GATE)).toBe(true);
    expect(engine.getHeldItems()).toContain(GATE);
    step(engine, 'E');
    expect(engine.getPlayer().keys[GATE]).toBe(2);
  });

  it('sets a pad down on the player cell without a jump, even when another pad exists', () => {
    const engine = load(room({ terrain: [[9, 9, PAD]] }));
    hold(engine, GATE, 2);
    expect(engine.dropItem(GATE)).toBe(true);
    expect(engine.getTerrain()[5][2]).toBe(PAD);
    expect(at(engine)).toEqual(PLAYER_START);
    expect(engine.getPlayer().keys[GATE]).toBe(1);
    expect(engine.getTimedMoveHistory().at(-1)).toMatchObject({ drop: GATE });
    // The last one: the entry leaves the inventory.
    step(engine, 'E');
    expect(engine.dropItem(GATE)).toBe(true);
    expect(engine.getPlayer().keys[GATE]).toBeUndefined();
    expect(engine.holdsItem(GATE)).toBe(false);
    expect(engine.getTerrain()[5][3]).toBe(PAD);
  });

  it('refuses on a cell that is not plain floor, with the floor message, and keeps the gate', () => {
    for (const under of [PAD, 'hint', 'ice', 'trap']) {
      const engine = load(room({ terrain: [[2, 5, under]] }));
      hold(engine, GATE, 1);
      expect(engine.dropItem(GATE)).toBe(false);
      expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_not_floor');
      expect(engine.getTerrain()[5][2]).toBe(under);
      expect(engine.getPlayer().keys[GATE]).toBe(1);
      expect(engine.getTimedMoveHistory()).toEqual([]);
    }
  });

  it('refuses on a cell that holds an item and when nothing is held', () => {
    const engine = load(room({ items: [[2, 5, 'chip']] }));
    expect(engine.dropItem(GATE)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_nothing');
    hold(engine, GATE, 1);
    expect(engine.dropItem(GATE)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_cell_occupied');
    expect(engine.getTerrain()[5][2]).toBe('floor');
  });

  it('brings the floor and the gate back on undo', () => {
    const engine = load(room({ items: [[3, 5, GATE]] }));
    step(engine, 'E');
    expect(engine.dropItem(GATE)).toBe(true);
    expect(engine.getTerrain()[5][3]).toBe(PAD);
    expect(engine.undo()).toBe(true);
    expect(engine.getTerrain()[5][3]).toBe('floor');
    expect(engine.getPlayer().keys[GATE]).toBe(1);
  });

  it('is left in the pocket by a key thief, which still empties the keys', () => {
    const engine = load(room({ terrain: [[3, 5, KEY_THIEF_ID]] }));
    hold(engine, GATE, 2);
    hold(engine, CHARGE, 1);
    engine.getPlayer().keys.key_red = 1;
    step(engine, 'E');
    expect(engine.getPlayer().keys).toEqual({ [GATE]: 2, [CHARGE]: 1 });
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole_keys');
  });

  it('does not trigger the thief message when only gates are held', () => {
    const engine = load(room({ terrain: [[3, 5, KEY_THIEF_ID]] }));
    hold(engine, GATE, 1);
    step(engine, 'E');
    expect(engine.getPlayer().keys).toEqual({ [GATE]: 1 });
    expect(engine.getStatusBannerKey()).toBeNull();
  });
});

describe('pocket gate: the pads', () => {
  it('jumps from a set-down pad to a placed pad, leaving by the facing direction', () => {
    const engine = load(room({ terrain: [[9, 9, PAD]] }));
    hold(engine, GATE, 1);
    step(engine, 'E');
    engine.dropItem(GATE);
    step(engine, 'W');
    expect(at(engine)).toEqual(PLAYER_START);
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 10, y: 9 });
    expect(engine.getPlayer().dir).toBe('E');
    // The pads stay: nothing was picked up.
    expect(engine.getTerrain()[5][3]).toBe(PAD);
    expect(engine.getTerrain()[9][9]).toBe(PAD);
  });

  it('links two set-down pads with each other', () => {
    const engine = load(room({ items: [[3, 5, GATE]] }));
    step(engine, 'E');
    hold(engine, GATE, 2);
    engine.dropItem(GATE);
    step(engine, 'E');
    step(engine, 'S');
    step(engine, 'S');
    engine.dropItem(GATE);
    expect(engine.getTerrain()[7][4]).toBe(PAD);
    step(engine, 'N');
    step(engine, 'N');
    // Back on the first pad's row, the step west lands on it and jumps to the second, leaving westward.
    step(engine, 'W');
    expect(at(engine)).toEqual({ x: 3, y: 7 });
    expect(engine.getTerrain()[5][3]).toBe(PAD);
    expect(engine.getTerrain()[7][4]).toBe(PAD);
  });

  it('does nothing when it is the only pad, and picks nothing up', () => {
    const engine = load(room({ terrain: [[3, 5, PAD]] }));
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 3, y: 5 });
    expect(engine.getTerrain()[5][3]).toBe(PAD);
    expect(engine.getPlayer().keys).toEqual({});
    step(engine, 'E');
    step(engine, 'W');
    expect(at(engine)).toEqual({ x: 3, y: 5 });
  });

  it('goes to the previous pad in reading order, wrapping from the first to the last', () => {
    const pads: Array<[number, number, string]> = [
      [3, 3, PAD],
      [7, 3, PAD],
      [5, 8, PAD]
    ];
    // From the second pad the previous one in reading order is the first.
    const second = load(room({ terrain: pads, player: { x: 6, y: 3 } }));
    step(second, 'E');
    expect(at(second)).toEqual({ x: 4, y: 3 });
    // From the first pad the walk wraps to the last, which is read live from the terrain.
    const first = load(room({ terrain: pads, player: { x: 2, y: 3 } }));
    step(first, 'E');
    expect(at(first)).toEqual({ x: 6, y: 8 });
  });

  it('reads the pads live: one set down later joins the list', () => {
    const engine = load(room({ terrain: [[3, 3, PAD], [7, 3, PAD]], items: [[3, 5, GATE]] }));
    step(engine, 'E');
    engine.dropItem(GATE);
    expect(engine.getTerrain()[5][3]).toBe(PAD);
    // Reading order is now (3,3), (7,3), (3,5): stepping onto (3,3) wraps to the pad just set down.
    contextOf(engine).world.player.x = 2;
    contextOf(engine).world.player.y = 3;
    engine.tick();
    tickN(engine, MAX_WAIT_TICKS);
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 4, y: 5 });
  });

  it('does not mix with the other teleporters, in either direction', () => {
    const engine = load(room({ terrain: [[3, 5, PAD], [9, 9, 'teleport'], [9, 3, 'teleport_yellow']] }));
    step(engine, 'E');
    expect(at(engine)).toEqual({ x: 3, y: 5 });
    const other = load(room({ terrain: [[3, 5, 'teleport'], [9, 9, PAD]] }));
    step(other, 'E');
    expect(at(other)).toEqual({ x: 3, y: 5 });
  });

  it('carries a block pushed onto a pad to the other pad', () => {
    const engine = load(
      room({
        terrain: [[5, 5, PAD], [9, 9, PAD]],
        entities: [{ type: BLOCK_ID, x: 4, y: 5, dir: 'E' }],
        player: { x: 3, y: 5 }
      })
    );
    step(engine, 'E');
    const block = engine.getEntities().find((e) => e.type === BLOCK_ID);
    expect(block).toMatchObject({ x: 10, y: 9 });
    expect(engine.getTerrain()[5][5]).toBe(PAD);
  });

  it('carries a monster that walks onto a pad to the other pad', () => {
    const engine = load(
      room({
        terrain: [[5, 3, PAD], [9, 9, PAD]],
        entities: [{ type: STRAIGHT_MONSTER, x: 4, y: 3, dir: 'E' }],
        player: { x: 1, y: 11 }
      })
    );
    let ticks = 0;
    while (engine.getEntities()[0].x === 4 && ticks < MONSTER_WAIT_TICKS) {
      engine.tick();
      ticks++;
    }
    expect(engine.getEntities()[0]).toMatchObject({ x: 10, y: 9 });
  });

  it('leaves the pads standing after a blast', () => {
    const engine = load(room({ terrain: [[4, 5, PAD], [9, 9, PAD]], items: [[3, 5, CHARGE]] }));
    step(engine, 'E');
    expect(engine.dropItem(CHARGE)).toBe(true);
    contextOf(engine).world.player.x = FAR_CELL.x;
    contextOf(engine).world.player.y = FAR_CELL.y;
    tickN(engine, BLAST_WAIT_TICKS);
    expect(engine.getLitCharges()).toBeUndefined();
    expect(engine.getTerrain()[5][4]).toBe(PAD);
    expect(engine.getTerrain()[9][9]).toBe(PAD);
  });
});

describe('pocket gate: simulation', () => {
  it('replays to the same simulation hash, and a level without a gate keeps no trace of one', () => {
    const level = splitRoom();
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'scripted'));
    expect(new Set(hashes).size).toBe(1);
    expect(load(room()).getRuntimeKeyExtra()).toBe('');
  });
});

describe('pocket gate: solutions with the G action', () => {
  it('reads and writes G as setting a gate down, next to X', () => {
    expect(decodeActions('EG.X')).toEqual(['E', DROP_GATE_ACTION, 'WAIT', DROP_CHARGE_ACTION]);
    expect(encodeActions(['E', DROP_GATE_ACTION, 'WAIT', DROP_CHARGE_ACTION])).toBe('EG.X');
    expect(encodeActions(decodeActions(SPLIT_SOLUTION))).toBe(SPLIT_SOLUTION);
    expect(DROP_ACTION_ITEMS[DROP_GATE_ACTION]).toBe(GATE);
    expect(DROP_ACTION_ITEMS[DROP_CHARGE_ACTION]).toBe(CHARGE);
  });

  it('cannot be won without setting the gate down: the wall splits the room', () => {
    const engine = load(splitRoom());
    for (const dir of ['E', 'E', 'E', 'E'] as Direction[]) PieceSolver.play(engine, dir);
    expect(engine.isLevelCompleted()).toBe(false);
  });

  it('replays a stored solution that uses G to a win, in the solver, the timed replay and the game loop', () => {
    const level = splitRoom({ solution: SPLIT_SOLUTION });
    const engine = load(level);
    for (const action of decodeActions(SPLIT_SOLUTION)) expect(PieceSolver.play(engine, action)).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
    expect(storedSolutionWins(level)).toBe(true);

    const moves = timedSolution(level) ?? [];
    const drops = moves.filter((m) => m.drop !== undefined);
    expect(drops).toHaveLength(1);
    expect(drops[0].drop).toBe(GATE);

    const replay = load(level);
    let index = 0;
    for (let i = 0; i < 5000 && !replay.isLevelCompleted(); i++) {
      const { due, nextIndex } = collectDueMoves(moves, index, replay.getTick());
      for (const move of due) {
        if (move.drop !== undefined) replay.dropItem(move.drop);
        else replay.attemptPlayerMove(move.dir);
      }
      index = nextIndex;
      replay.tick();
      expect(replay.getPlayer().alive).toBe(true);
    }
    expect(replay.isLevelCompleted()).toBe(true);
  });

  it('counts the drop as a move in the difficulty measure', () => {
    const report = DifficultyMetrics.measure(splitRoom({ solution: SPLIT_SOLUTION }));
    expect(report.moves).toBe(SPLIT_SOLUTION.length);
    expect(report.solved).toBe(true);
  });

  it('gives the same simulation hash twice for a level whose solution sets a gate down', () => {
    const level = splitRoom({ solution: SPLIT_SOLUTION });
    const hashes = Array.from({ length: SCRIPT_REPEATS }, () => engineSimulationHash(level, 'solution'));
    expect(new Set(hashes).size).toBe(1);
  });

  it('rejects a stored solution whose drop cannot happen, so a stale list is never shown', () => {
    expect(timedSolution(splitRoom({ solution: 'GEE' }))).toBeNull();
    expect(storedSolutionWins(splitRoom({ solution: 'EGGWE' }))).toBe(false);
  });

  it('is refused as a campaign route segment, like X', () => {
    expect(() => parseSegment('EG')).toThrow();
    expect(() => parseSegment('G')).toThrow();
  });
});

describe('pocket gate: validator', () => {
  it('sees the exit as reachable once the gate can be set down and a pad is placed on the far side', () => {
    expect(LevelValidator.validate(splitRoom()).stats.reachableExit).toBe(true);
  });

  it('keeps the exit unreachable without the gate, and without a placed pad to jump to', () => {
    expect(LevelValidator.validate(splitRoom({ gate: false })).stats.reachableExit).toBe(false);
    expect(LevelValidator.validate(splitRoom({ pad: false })).stats.reachableExit).toBe(false);
  });

  it('lets two gates and no placed pad bring the boots back across a one-way floor, whatever the order', () => {
    expect(LevelValidator.validate(oneWayRoom()).stats.reachableExit).toBe(true);
    // One gate cannot make a pair, so the water stays shut to the start half.
    expect(LevelValidator.validate(oneWayRoom({ startGate: false })).stats.reachableExit).toBe(false);
    expect(LevelValidator.validate(oneWayRoom({ farGate: false })).stats.reachableExit).toBe(false);
  });

  it('warns about a gate that cannot make a pair, and about nothing once it can', () => {
    const key = 'validator.issues.gate_no_pair.label';
    const keys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);
    expect(keys(oneWayRoom({ farGate: false }))).toContain(key);
    expect(keys(oneWayRoom())).not.toContain(key);
    expect(keys(splitRoom())).not.toContain(key);
    expect(en.validator.issues.gate_no_pair.label).toBeTruthy();
    expect(fr.validator.issues.gate_no_pair.label).toBeTruthy();
  });

  it('does not warn about a single placed pad on a level that gives a gate', () => {
    const alone = 'validator.issues.teleport_alone_plain.label';
    const withGate = LevelValidator.validate(splitRoom()).issues.map((issue) => issue.i18nKey);
    expect(withGate).not.toContain(alone);
    const noGate = LevelValidator.validate(splitRoom({ gate: false })).issues.map((issue) => issue.i18nKey);
    expect(noGate).toContain(alone);
  });
});

describe('pocket gate: play aids and block searches', () => {
  it('turns off the push hint and the dead-end watch on a level with a gate or a pad, and keeps the other aids', () => {
    const plain = featuresFor(room());
    expect(plain.blockHint).toBe(true);
    expect(plain.deadEndWatch).toBe(true);
    for (const level of [room({ items: [[3, 3, GATE]] }), room({ terrain: [[3, 3, PAD]] })]) {
      const features = featuresFor(level);
      expect(features.blockHint).toBe(false);
      expect(features.deadEndWatch).toBe(false);
      expect(features.itemDrop).toBe(true);
      expect(features.solutionReplay).toBe(true);
      expect(features.objectiveMarker).toBe(true);
    }
  });

  it('gives no verdict on a targets level that holds a gate or a pad', () => {
    const level = room({ terrain: [[4, 4, 'block_target']], entities: [{ type: BLOCK_ID, x: 6, y: 6, dir: 'S' }] });
    level.winRule = 'targets';
    expect(BlockPuzzleSolver.verdict(load(level)).kind).not.toBe('not_checked');
    const withGate = { ...level, items: level.items.map((row) => [...row]) };
    withGate.items[2][2] = GATE;
    expect(BlockPuzzleSolver.verdict(load(withGate)).kind).toBe('not_checked');
    const withPad = { ...level, terrain: level.terrain.map((row) => [...row]) };
    withPad.terrain[2][2] = PAD;
    expect(BlockPuzzleSolver.verdict(load(withPad)).kind).toBe('not_checked');
  });
});

describe('pocket gate: rulesets and formats', () => {
  it('is Epoxy-only content, refused in the Lynx palette and by the .DAT export, pad included', () => {
    expect(isPocketGateTileId(GATE)).toBe(true);
    expect(isPocketGateTileId(PAD)).toBe(true);
    expect(isPocketGateTileId('teleport')).toBe(false);
    expect(isEpoxyOnlyItemId(GATE)).toBe(true);
    expect(isEpoxyOnlyItemId(PAD)).toBe(true);
    expect(isEpoxyOnlyTileId(PAD)).toBe(true);
    expect(hasPocketGateContent(room())).toBe(false);
    expect(hasPocketGateContent(room({ items: [[3, 3, GATE]] }))).toBe(true);
    expect(hasPocketGateContent(room({ terrain: [[3, 3, PAD]] }))).toBe(true);
    expect(hasEpoxyOnlyContent(room({ terrain: [[3, 3, PAD]] }))).toBe(true);
    for (const id of [GATE, PAD]) {
      expect(tileAvailability('lynx', id).available).toBe(false);
      expect(tileAvailability('epoxy', id).available).toBe(true);
    }
    for (const placed of [room({ items: [[3, 3, GATE]] }), room({ terrain: [[3, 3, PAD]] })]) {
      expect(datRefusalReason(placed)).toBe('epoxy_only_items');
      const encoded = DatCodec.encodeLevelsWithReport([placed, room()]);
      expect(encoded.refused.map((r) => r.reason)).toEqual(['epoxy_only_items']);
      expect(encoded.replaced).toEqual([]);
      expect(encoded.levelCount).toBe(1);
    }
  });

  it('writes pack format 8 for a level with either id, and keeps 7 for the format 7 ids alone', () => {
    const version = (levels: CompiledLevel[]): number => JSON.parse(serializePack('N', levels)).version;
    const gate = room({ items: [[3, 3, GATE]] });
    const pad = room({ terrain: [[3, 3, PAD]] });
    const underlay = { ...room(), underlays: [{ x: 3, y: 3, terrain: PAD }] };
    const charge = room({ items: [[3, 3, CHARGE]] });
    for (const level of [gate, pad, underlay]) {
      expect(idSetVersionOf(level)).toBe(PACK_JSON_VERSION_V8);
      expect(usesV7Ids(level)).toBe(false);
      expect(version([level])).toBe(PACK_JSON_VERSION_V8);
    }
    expect(idSetVersionOf(charge)).toBe(PACK_JSON_VERSION_V7);
    expect(version([charge])).toBe(PACK_JSON_VERSION_V7);
    expect(version([charge, gate])).toBe(PACK_JSON_VERSION_V8);
    expect(version([room()])).toBe(1);
    expect(idSetVersionOf(room())).toBe(0);
    const cc3d: CompiledLevel = { ...room({ items: [[3, 3, GATE]] }), ruleset: 'cc3d' };
    expect(idSetVersionOf(cc3d)).toBe(0);
  });

  it('lists every id set in the table, each with the ids in the shipped configs', () => {
    expect(PACK_JSON_ID_SET_VERSIONS.map((row) => row.version)).toEqual([PACK_JSON_VERSION_V7, PACK_JSON_VERSION_V8, PACK_JSON_VERSION_V9, PACK_JSON_VERSION_V10]);
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V10);
    expect([...PACK_JSON_VERSION_V8_IDS].sort()).toEqual([GATE, PAD].sort());
    for (const id of PACK_JSON_VERSION_V8_IDS) expect(ConfigRegistry.getTiles().tiles[id]).toBeDefined();
  });

  it('round-trips through a pack file written as format 8', () => {
    const level = splitRoom({ solution: SPLIT_SOLUTION });
    const text = serializePack('Gate', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V8);
    const result = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levels[0].items[5][3]).toBe(GATE);
    expect(result.levels[0].terrain[5][9]).toBe(PAD);
    expect(result.levels[0].solution).toBe(SPLIT_SOLUTION);
    expect(storedSolutionWins(result.levels[0])).toBe(true);
  });

  it('is refused by a build that reads pack format 7 at most', async () => {
    const text = serializePack('Gate', [splitRoom()]);
    expect(JSON.parse(text).version).toBeGreaterThan(PACK_JSON_VERSION_V7);
    vi.resetModules();
    vi.doMock('../../config/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../config/constants')>()),
      PACK_JSON_MAX_VERSION: PACK_JSON_VERSION_V7
    }));
    try {
      const older = await import('../../packs/packJson');
      expect(older.parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), () => 8000)).toEqual({
        ok: false,
        error: 'version'
      });
    } finally {
      vi.doUnmock('../../config/constants');
      vi.resetModules();
    }
  });
});
