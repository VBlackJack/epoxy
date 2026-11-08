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
import { findSignalConfigErrors, findWiredDeviceConfigErrors, normalizeUnderlays } from '../../config/ConfigValidation';
import { PACK_JSON_MAX_VERSION, PACK_JSON_VERSION_V13, PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import { connectionRows } from '../../editor/connectionRows';
import { signalTileHoldsEnd, signalTileTakesOneInput } from '../../editor/editorSignalLinks';
import { tileAvailability } from '../../editor/paletteAvailability';
import { tileMechanismGroup } from '../../editor/paletteGroups';
import { DatCodec, datRefusalReason } from '../../formats/DatCodec';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GRAY_BUTTON_RADIUS, NO_SIGN_ITEM_IDS, NO_SIGN_ITEM_PREFIX } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import { isEpoxyOnlyItemId, isEpoxyOnlyTileId, isWiredDeviceTileId } from '../RulesetFeatures';
import { compileSignalSpec, idSetVersionOf, signalSinkOf } from '../signalLinks';
import type { CompiledLevel, Direction, SignalLink } from '../types';
import { flipWiredCellAt } from './epoxyDevices';
import { registryTileLookup } from './epoxySignals';
import type { EpoxyContext } from './epoxyWorld';

const PURPLE_WALL = 'purple_wall';
const PURPLE_FLOOR = 'purple_floor';
const SWITCH_OFF = 'toggle_switch_off';
const SWITCH_ON = 'toggle_switch_on';
const BLACK = 'black_button';
const GRAY_AREA = 'button_gray_area';
const TRAP_WIRED = 'trap_wired';
const JET_OFF = 'flame_jet_wired_off';
const JET_ON = 'flame_jet_wired_on';
const PLATE = 'signal_plate';
const DOOR_CLOSED = 'hold_door_red_closed';
const DOOR_OPEN = 'hold_door_red_open';
const GREEN_WALL_CLOSED = 'toggle_wall_closed';
const GREEN_WALL_OPEN = 'toggle_wall_open';
/** Chip's Challenge 2 swivel doors, added to the same pack format. */
const CC2_SWIVEL_IDS = ['swivel_door_cc2_ne', 'swivel_door_cc2_se', 'swivel_door_cc2_sw', 'swivel_door_cc2_nw'];
/** Ids of the Chip's Challenge 2 items and characters, which share pack format 13. */
const CC2_ITEM_IDS = ['green_chip', 'green_bomb', 'steel_wall', 'hiking_boots', 'sign_chip_only', 'sign_melinda_only'];
const NEW_IDS = [PURPLE_WALL, PURPLE_FLOOR, SWITCH_OFF, SWITCH_ON, BLACK, GRAY_AREA, TRAP_WIRED, JET_OFF, JET_ON];

const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const MAX_WAIT_TICKS = 40;
const STILL_COOLDOWN_TICKS = 100000;
const START = { x: 2, y: 5 };
const SOURCE = { x: 3, y: 5 };
/** A cell far from the start where an idle plate sits, so a sink has an input that is never pressed. */
const IDLE_PLATE = { x: 11, y: 11 };
const FAR_SINK = { x: 8, y: 3 };
const MONSTER_ID = 'pink_ball';

type Cell = { x: number; y: number };

interface Setup {
  terrain?: Array<[Cell, string]>;
  entities?: CompiledLevel['entities'];
  player?: Cell;
  signalLinks?: SignalLink[];
  trapLinks?: CompiledLevel['trapLinks'];
}

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [cell, id] of setup.terrain ?? []) terrain[cell.y][cell.x] = id;
  const items: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  return {
    id: 'wired_devices_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? START), dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: setup.trapLinks ?? [],
    cloneLinks: [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks })
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function contextOf(engine: GameEngine): EpoxyContext {
  return (engine as unknown as { ctx: EpoxyContext }).ctx;
}

const tileAt = (engine: GameEngine, cell: Cell): string => engine.getTerrain()[cell.y][cell.x];
const tick = (engine: GameEngine, count = 1): void => {
  for (let i = 0; i < count; i++) engine.tick();
};

beforeEach(() => {
  loadTestConfigs();
});

describe('wired devices: configuration', () => {
  it('declares the nine tiles with their pairs and no config problem', () => {
    const tiles = ConfigRegistry.getTiles().tiles;
    for (const id of NEW_IDS) expect(tiles[id], id).toBeDefined();
    expect([tiles[PURPLE_WALL].wireTogglesTo, tiles[PURPLE_FLOOR].wireTogglesTo]).toEqual([PURPLE_FLOOR, PURPLE_WALL]);
    expect([tiles[JET_OFF].wireTogglesTo, tiles[JET_ON].wireTogglesTo]).toEqual([JET_ON, JET_OFF]);
    expect([tiles[SWITCH_OFF].signalToggleTwin, tiles[SWITCH_ON].signalToggleTwin]).toEqual([SWITCH_ON, SWITCH_OFF]);
    expect([tiles[SWITCH_OFF].signalToggleOn, tiles[SWITCH_ON].signalToggleOn]).toEqual([false, true]);
    expect(tiles[BLACK].signalSource).toBe('inverted');
    expect(tiles[GRAY_AREA].buttonAction).toBe('pulse_wired_area');
    expect(tiles[TRAP_WIRED]).toMatchObject({ isTrap: true, wiredTrap: true });
    expect(findWiredDeviceConfigErrors(tiles)).toEqual([]);
    expect(findSignalConfigErrors(tiles)).toEqual([]);
  });

  it('keeps the purple tiles out of every green button family', () => {
    for (const id of [PURPLE_WALL, PURPLE_FLOOR, JET_OFF, JET_ON]) {
      const tile = ConfigRegistry.getTile(id);
      expect(tile.togglesTo, id).toBeUndefined();
      expect(tile.flameTogglesTo, id).toBeUndefined();
      expect(tile.toggleChannel, id).toBeUndefined();
    }
  });

  it('refuses a broken pair and a stray field', () => {
    const tiles = structuredClone(ConfigRegistry.getTiles().tiles);
    tiles[PURPLE_FLOOR].wireTogglesTo = 'floor';
    expect(findWiredDeviceConfigErrors(tiles).join(';')).toContain(`${PURPLE_FLOOR}.wireTogglesTo`);
    const mixed = structuredClone(ConfigRegistry.getTiles().tiles);
    mixed[PURPLE_WALL].togglesTo = PURPLE_FLOOR;
    expect(findWiredDeviceConfigErrors(mixed).join(';')).toContain('button toggle families');
    const trap = structuredClone(ConfigRegistry.getTiles().tiles);
    trap.floor.wiredTrap = true;
    expect(findWiredDeviceConfigErrors(trap).join(';')).toContain('floor.wiredTrap');
    const switchBroken = structuredClone(ConfigRegistry.getTiles().tiles);
    switchBroken[SWITCH_ON].signalToggleOn = false;
    expect(findSignalConfigErrors(switchBroken).join(';')).toContain(`${SWITCH_ON}.signalToggleTwin`);
  });

  it('is named in both languages', () => {
    for (const locale of [en, fr] as unknown as Array<{ tiles: Record<string, { name: string; desc: { label: string } }> }>) {
      for (const id of NEW_IDS) {
        expect(locale.tiles[id].name, id).toBeTruthy();
        expect(locale.tiles[id].desc.label, id).toBeTruthy();
      }
    }
  });

  it('is Epoxy-only: hidden under Lynx, refused by the DAT export', () => {
    for (const id of NEW_IDS) {
      expect(tileAvailability('lynx', id).available, id).toBe(false);
      expect(tileAvailability('epoxy', id).available, id).toBe(true);
      expect(isEpoxyOnlyTileId(id), id).toBe(true);
    }
    for (const id of [PURPLE_WALL, PURPLE_FLOOR, TRAP_WIRED, JET_OFF, JET_ON, GRAY_AREA]) {
      expect(isWiredDeviceTileId(id), id).toBe(true);
      expect(isEpoxyOnlyItemId(id), id).toBe(true);
    }
    expect(isWiredDeviceTileId('trap')).toBe(false);
    for (const id of NEW_IDS) {
      const placed = room({ terrain: [[{ x: 3, y: 3 }, id]] });
      expect(datRefusalReason(placed), id).not.toBeNull();
      expect(DatCodec.encodeLevelsWithReport([placed, room()]).levelCount, id).toBe(1);
    }
  });

  it('sits in the toggles group of the palette for the purple tiles, with the buttons for the pulse button', () => {
    expect(tileMechanismGroup(ConfigRegistry.getTile(PURPLE_WALL))).toBe('toggles');
    expect(tileMechanismGroup(ConfigRegistry.getTile(JET_OFF))).toBe('toggles');
    expect(tileMechanismGroup(ConfigRegistry.getTile(GRAY_AREA))).toBe('buttons');
  });

  it('is never kept hidden under a removable top', () => {
    const level = room({ terrain: [[{ x: 4, y: 4 }, 'door_red']] });
    for (const id of NEW_IDS) expect(normalizeUnderlays([{ x: 4, y: 4, terrain: id }], level.terrain, 'epoxy'), id).toBeNull();
  });

  it('adds pack format 13 for exactly these ids', () => {
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V13);
    const noSigns = NO_SIGN_ITEM_IDS.map((id) => `${NO_SIGN_ITEM_PREFIX}${id}`);
    expect([...PACK_JSON_VERSION_V13_IDS].sort()).toEqual([...NEW_IDS, ...CC2_SWIVEL_IDS, ...CC2_ITEM_IDS, ...noSigns].sort());
    expect(idSetVersionOf(room({ terrain: [[{ x: 3, y: 3 }, PURPLE_WALL]] }))).toBe(PACK_JSON_VERSION_V13);
    expect(idSetVersionOf(room())).toBe(0);
  });
});

describe('wired devices: the sinks and sources of the compiler', () => {
  it('makes a flip_edges sink of a purple tile and a wired jet, a level sink of a wired trap', () => {
    expect(signalSinkOf(ConfigRegistry.getTile(PURPLE_WALL))).toEqual({ fires: 'flip_edges' });
    expect(signalSinkOf(ConfigRegistry.getTile(JET_OFF))).toEqual({ fires: 'flip_edges' });
    expect(signalSinkOf(ConfigRegistry.getTile(TRAP_WIRED))).toEqual({ powers: true });
    expect(signalSinkOf(ConfigRegistry.getTile('trap'))).toBeNull();
    // Hidden under a removable top a wired tile is no sink.
    expect(signalSinkOf(ConfigRegistry.getTile(PURPLE_WALL), { hidden: true })).toBeNull();
  });

  it('makes sources of the toggle switch and the black button', () => {
    const black = { x: 4, y: 5 };
    const floorTarget = { x: 5, y: 3 };
    const level = room({
      terrain: [[SOURCE, SWITCH_OFF], [black, BLACK], [FAR_SINK, PURPLE_WALL], [floorTarget, PURPLE_FLOOR]],
      signalLinks: [link(SOURCE, FAR_SINK), link(black, floorTarget)]
    });
    const spec = compileSignalSpec(level, registryTileLookup);
    expect(spec?.nodes.filter((node) => node.kind === 'source').map((node) => node.sample)).toEqual(['toggle', 'inverted']);
    expect(spec?.nodes.filter((node) => node.kind === 'sink').map((node) => node.fires)).toEqual(['flip_edges', 'flip_edges']);
  });

  it('accepts the wires in the editor: sources are outputs, wired devices are single inputs', () => {
    for (const id of [SWITCH_OFF, SWITCH_ON, BLACK]) {
      expect(signalTileHoldsEnd(ConfigRegistry.getTile(id), 'output'), id).toBe(true);
      expect(signalTileHoldsEnd(ConfigRegistry.getTile(id), 'input'), id).toBe(false);
    }
    for (const id of [PURPLE_WALL, PURPLE_FLOOR, TRAP_WIRED, JET_OFF, JET_ON]) {
      expect(signalTileHoldsEnd(ConfigRegistry.getTile(id), 'input'), id).toBe(true);
      expect(signalTileHoldsEnd(ConfigRegistry.getTile(id), 'output'), id).toBe(false);
      expect(signalTileTakesOneInput(ConfigRegistry.getTile(id)), id).toBe(true);
    }
    // The gray pulse button needs no wire and takes none.
    expect(signalTileHoldsEnd(ConfigRegistry.getTile(GRAY_AREA), 'input')).toBe(false);
    expect(signalTileHoldsEnd(ConfigRegistry.getTile(GRAY_AREA), 'output')).toBe(false);
  });

  it('lists the wire of a purple wall among the controllers of its cell', () => {
    const level = room({ terrain: [[SOURCE, PLATE], [FAR_SINK, PURPLE_WALL]], signalLinks: [link(SOURCE, FAR_SINK)] });
    const rows = connectionRows(level, FAR_SINK.x, FAR_SINK.y);
    expect(rows.controlledBy?.rows.some((row) => row.system === 'signal')).toBe(true);
  });

  it('refuses two inputs on a purple wall in the validator', () => {
    const level = room({
      terrain: [[SOURCE, PLATE], [{ x: 4, y: 5 }, PLATE], [FAR_SINK, PURPLE_WALL]],
      signalLinks: [link(SOURCE, FAR_SINK), link({ x: 4, y: 5 }, FAR_SINK)]
    });
    expect(LevelValidator.validate(level).issues.map((i) => i.i18nKey)).toContain('validator.issues.signal_sink_inputs.label');
  });
});

describe('wired devices: the purple wall flips on every change', () => {
  const wired = (extra: Array<[Cell, string]> = []): CompiledLevel =>
    room({ terrain: [[SOURCE, PLATE], [FAR_SINK, PURPLE_WALL], ...extra], signalLinks: [link(SOURCE, FAR_SINK)] });

  it('flips on the rising edge and again on the falling edge', () => {
    const engine = load(wired());
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
    expect(step(engine, 'E')).toBe(true);
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_FLOOR);
    expect(step(engine, 'W')).toBe(true);
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
    expect(step(engine, 'E')).toBe(true);
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_FLOOR);
  });

  it('flips nothing at load, even when its input is already on', () => {
    const engine = load(room({ terrain: [[SOURCE, PLATE], [FAR_SINK, PURPLE_WALL]], signalLinks: [link(SOURCE, FAR_SINK)], player: SOURCE }));
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
  });

  it('is not touched by the green button, which swaps every togglesTo tile', () => {
    const engine = load(room({ terrain: [[SOURCE, 'button_green'], [FAR_SINK, PURPLE_WALL], [{ x: 9, y: 3 }, GREEN_WALL_CLOSED]] }));
    step(engine, 'E');
    expect(tileAt(engine, { x: 9, y: 3 })).toBe(GREEN_WALL_OPEN);
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
  });

  it('is not touched by the orange button either', () => {
    const engine = load(room({ terrain: [[SOURCE, 'button_orange'], [FAR_SINK, JET_OFF], [{ x: 9, y: 3 }, 'flame_jet_off']] }));
    step(engine, 'E');
    expect(tileAt(engine, { x: 9, y: 3 })).toBe('flame_jet_on');
    expect(tileAt(engine, FAR_SINK)).toBe(JET_OFF);
  });

  it('keeps its simulation reproducible', () => {
    const first = load(wired());
    const second = load(wired());
    for (const engine of [first, second]) {
      step(engine, 'E');
      tick(engine, 3);
      step(engine, 'W');
    }
    expect(first.getTerrain()).toEqual(second.getTerrain());
    expect(first.getSignalState()).toEqual(second.getSignalState());
  });
});

describe('wired devices: the black button', () => {
  it('is powered unless pressed: a hold door it drives is open until the button is pressed', () => {
    const level = room({ terrain: [[SOURCE, BLACK], [FAR_SINK, DOOR_CLOSED]], signalLinks: [link(SOURCE, FAR_SINK)] });
    const engine = load(level);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_OPEN);
    step(engine, 'E');
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_CLOSED);
    step(engine, 'E');
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_OPEN);
  });

  it('is held, not a pulse: it keeps the wall flipped while something stands on it', () => {
    const engine = load(room({ terrain: [[SOURCE, BLACK], [FAR_SINK, PURPLE_WALL]], signalLinks: [link(SOURCE, FAR_SINK)] }));
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
    step(engine, 'E');
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_FLOOR);
    tick(engine, 10);
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_FLOOR);
    step(engine, 'E');
    expect(tileAt(engine, FAR_SINK)).toBe(PURPLE_WALL);
  });
});

describe('wired devices: the toggle switch', () => {
  const wired = (): CompiledLevel => room({ terrain: [[SOURCE, SWITCH_OFF], [FAR_SINK, DOOR_CLOSED]], signalLinks: [link(SOURCE, FAR_SINK)] });

  it('flips its state at every arrival and keeps it when the player leaves', () => {
    const engine = load(wired());
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_OFF);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_CLOSED);
    step(engine, 'E');
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_ON);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_OPEN);
    step(engine, 'E');
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_ON);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_OPEN);
    step(engine, 'W');
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_OFF);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_CLOSED);
  });

  it('starts powered when placed in its on form', () => {
    const engine = load(room({ terrain: [[SOURCE, SWITCH_ON], [FAR_SINK, DOOR_CLOSED]], signalLinks: [link(SOURCE, FAR_SINK)] }));
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_OPEN);
  });

  it('is flipped by a block that arrives on it too, and its state survives an undo', () => {
    const engine = load(
      room({
        terrain: [[SOURCE, SWITCH_OFF], [FAR_SINK, DOOR_CLOSED]],
        signalLinks: [link(SOURCE, FAR_SINK)],
        entities: [{ type: 'dirt_block', x: 4, y: 5, dir: 'E' }],
        player: { x: 5, y: 5 }
      })
    );
    step(engine, 'W');
    tick(engine, 40);
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_ON);
    expect(engine.undo()).toBe(true);
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_OFF);
    expect(tileAt(engine, FAR_SINK)).toBe(DOOR_CLOSED);
  });
});

describe('wired devices: an unwired toggle switch', () => {
  it('still changes form on every arrival, with no network on the level', () => {
    const engine = load(room({ terrain: [[SOURCE, SWITCH_OFF]] }));
    step(engine, 'E');
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_ON);
    step(engine, 'E');
    step(engine, 'W');
    expect(tileAt(engine, SOURCE)).toBe(SWITCH_OFF);
  });
});

describe('wired devices: the gray pulse button', () => {
  const BUTTON = { x: 3, y: 5 };
  const IN_REACH = { x: BUTTON.x + GRAY_BUTTON_RADIUS, y: BUTTON.y - GRAY_BUTTON_RADIUS };
  const TOO_FAR = { x: BUTTON.x + GRAY_BUTTON_RADIUS + 1, y: BUTTON.y };
  const TOO_FAR_ROW = { x: BUTTON.x, y: BUTTON.y - GRAY_BUTTON_RADIUS - 1 };

  /** The sinks in `linked` get a wire from an idle plate; the others have none: the button needs no wire. */
  function pulseRoom(sinkTiles: Array<[Cell, string]>, linked: Array<[Cell, string]> = []): CompiledLevel {
    return room({
      terrain: [[BUTTON, GRAY_AREA], ...(linked.length > 0 ? ([[IDLE_PLATE, PLATE]] as Array<[Cell, string]>) : []), ...sinkTiles, ...linked],
      ...(linked.length > 0 ? { signalLinks: linked.map(([cell]) => link(IDLE_PLATE, cell)) } : {})
    });
  }

  it('flips the wired flip tiles of the 5 by 5 square, with no wire from the button, and leaves the rest', () => {
    const engine = load(
      pulseRoom(
        [
          [IN_REACH, PURPLE_WALL],
          [TOO_FAR, PURPLE_WALL],
          [TOO_FAR_ROW, PURPLE_WALL]
        ],
        [[{ x: 4, y: 4 }, GREEN_WALL_CLOSED]]
      )
    );
    step(engine, 'E');
    expect(tileAt(engine, IN_REACH)).toBe(PURPLE_FLOOR);
    expect(tileAt(engine, { x: 4, y: 4 })).toBe(GREEN_WALL_OPEN);
    expect(tileAt(engine, TOO_FAR)).toBe(PURPLE_WALL);
    expect(tileAt(engine, TOO_FAR_ROW)).toBe(PURPLE_WALL);
    // Every arrival pulses again: a flip, not a hold.
    step(engine, 'E');
    step(engine, 'W');
    expect(tileAt(engine, IN_REACH)).toBe(PURPLE_WALL);
  });

  it('holds a level sink on for one settle only: a hold door and a wired trap open, then close', () => {
    const trap = { x: 5, y: 6 };
    const engine = load(pulseRoom([[trap, TRAP_WIRED]], [[IN_REACH, DOOR_CLOSED]]));
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(true);
    step(engine, 'E');
    expect(tileAt(engine, IN_REACH)).toBe(DOOR_OPEN);
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(false);
    tick(engine, 2);
    expect(tileAt(engine, IN_REACH)).toBe(DOOR_CLOSED);
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(true);
  });

  it('does not pulse a device that is out of reach', () => {
    const engine = load(pulseRoom([[TOO_FAR, PURPLE_WALL]], [[{ x: 4, y: 4 }, DOOR_CLOSED]]));
    step(engine, 'E');
    expect(tileAt(engine, TOO_FAR)).toBe(PURPLE_WALL);
  });

  it('keeps the held pulse in the snapshot and gives it back on undo', () => {
    const engine = load(pulseRoom([], [[IN_REACH, DOOR_CLOSED]]));
    expect(engine.getSignalPulses()).toBeUndefined();
    step(engine, 'E');
    expect(engine.getSignalPulses()?.lit).toEqual([IN_REACH.y * SIZE + IN_REACH.x]);
    expect(engine.undo()).toBe(true);
    expect(engine.getSignalPulses()).toBeUndefined();
    expect(tileAt(engine, IN_REACH)).toBe(DOOR_CLOSED);
  });

  it('pulses an unwired wired trap, launcher-free level included, for one settle', () => {
    const trap = { x: 4, y: 4 };
    const engine = load(pulseRoom([[trap, TRAP_WIRED]]));
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(true);
    step(engine, 'E');
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(false);
    tick(engine, 2);
    expect(engine.isCellClosedTrap(trap.x, trap.y)).toBe(true);
  });

  it('leaves the plain gray button alone: it still swaps chips and bombs', () => {
    expect(ConfigRegistry.getTile('button_gray').buttonAction).toBe('swap_chips_bombs');
  });
});

describe('wired devices: the wired trap', () => {
  const TRAP = { x: 6, y: 5 };
  const wired = (extra: Array<[Cell, string]> = [], links: SignalLink[] = [link(SOURCE, TRAP)]): CompiledLevel =>
    room({ terrain: [[SOURCE, PLATE], [TRAP, TRAP_WIRED], ...extra], signalLinks: links });

  it('is closed until its signal is on, open while it is on', () => {
    const engine = load(wired());
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(true);
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(false);
    step(engine, 'W');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(true);
  });

  it('is also open while a brown button is held', () => {
    const engine = load(wired([[{ x: 2, y: 6 }, 'button_brown']]));
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(true);
    step(engine, 'S');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(false);
  });

  it('is open while both are on and closes only when both are off', () => {
    const engine = load(wired([[{ x: 3, y: 6 }, 'button_brown']]));
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(false);
    step(engine, 'S');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(false);
    step(engine, 'W');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(true);
  });

  it('is a plain trap without a wire: only a brown button opens it', () => {
    const engine = load(wired([], []));
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP.x, TRAP.y)).toBe(true);
  });
});

describe('wired devices: the wired flame jet', () => {
  const JET = { x: 6, y: 5 };
  const wired = (extra: Setup = {}): CompiledLevel =>
    room({ terrain: [[SOURCE, PLATE], [JET, JET_OFF]], signalLinks: [link(SOURCE, JET)], ...extra });

  it('lights on the rising edge and goes out on the falling edge', () => {
    const engine = load(wired());
    expect(tileAt(engine, JET)).toBe(JET_OFF);
    step(engine, 'E');
    expect(tileAt(engine, JET)).toBe(JET_ON);
    step(engine, 'W');
    expect(tileAt(engine, JET)).toBe(JET_OFF);
  });

  it('burns a monster standing on it when it lights', () => {
    const engine = load(wired({ entities: [{ type: MONSTER_ID, x: JET.x, y: JET.y, dir: 'E' }] }));
    for (const entity of engine.getEntities()) entity.cooldownTicks = STILL_COOLDOWN_TICKS;
    expect(engine.getEntities()).toHaveLength(1);
    step(engine, 'E');
    expect(tileAt(engine, JET)).toBe(JET_ON);
    expect(engine.getEntities()).toHaveLength(0);
  });

  it('burns the player standing on a jet that lights', () => {
    const engine = load(wired({ player: JET }));
    expect(engine.getPlayer().alive).toBe(true);
    flipWiredCellAt(contextOf(engine), JET.x, JET.y);
    expect(tileAt(engine, JET)).toBe(JET_ON);
    expect(engine.getPlayer().alive).toBe(false);
  });

  it('does not burn the player who wears fire boots, and does not burn when the jet goes out', () => {
    const engine = load(wired({ player: JET }));
    engine.getPlayer().boots.add('boots_fire');
    flipWiredCellAt(contextOf(engine), JET.x, JET.y);
    expect(engine.getPlayer().alive).toBe(true);
    flipWiredCellAt(contextOf(engine), JET.x, JET.y);
    expect(tileAt(engine, JET)).toBe(JET_OFF);
    expect(engine.getPlayer().alive).toBe(true);
  });
});

describe('wired devices: the validator', () => {
  /** A wall splits the room: the exit is behind a purple wall that a plate may drive. */
  function sealed(wired: boolean): CompiledLevel {
    const split = Array.from({ length: SIZE - 2 }, (_, i): [Cell, string] => [{ x: 7, y: i + 1 }, 'wall']);
    return room({
      terrain: [...split, [{ x: 7, y: 5 }, PURPLE_WALL], [SOURCE, PLATE], [{ x: 11, y: 5 }, 'exit']],
      ...(wired ? { signalLinks: [link(SOURCE, { x: 7, y: 5 })] } : {})
    });
  }

  it('reads a wired purple wall as passable, so the exit behind it is reachable', () => {
    expect(LevelValidator.validate(sealed(true)).stats.reachableExit).toBe(true);
  });

  it('keeps an unwired purple wall shut', () => {
    expect(LevelValidator.validate(sealed(false)).stats.reachableExit).toBe(false);
  });

  it('reads a wired flame jet that is lit as walkable, since the signal can put it out', () => {
    const split = Array.from({ length: SIZE - 2 }, (_, i): [Cell, string] => [{ x: 7, y: i + 1 }, 'wall']);
    const lit = (wired: boolean): CompiledLevel =>
      room({
        terrain: [...split, [{ x: 7, y: 5 }, JET_ON], [SOURCE, PLATE], [{ x: 11, y: 5 }, 'exit']],
        ...(wired ? { signalLinks: [link(SOURCE, { x: 7, y: 5 })] } : {})
      });
    expect(LevelValidator.validate(lit(true)).stats.reachableExit).toBe(true);
    expect(LevelValidator.validate(lit(false)).stats.reachableExit).toBe(false);
  });

  it('does not ask for a brown button when a signal link ends on the wired trap', () => {
    const trap = { x: 6, y: 5 };
    const keys = (links: SignalLink[]): string[] =>
      LevelValidator.validate(room({ terrain: [[SOURCE, PLATE], [trap, TRAP_WIRED]], signalLinks: links })).issues.map((i) => i.i18nKey);
    expect(keys([link(SOURCE, trap)])).not.toContain('validator.issues.trap_no_button.label');
    expect(keys([])).toContain('validator.issues.trap_no_button.label');
  });
});
