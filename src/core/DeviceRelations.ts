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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel, TileDefinition } from './types';
import { BOMB_ITEM_ID, CHIP_ITEM_ID, GRAY_BUTTON_RADIUS, STEER_MONSTERS_ACTION, channelOfButtonAction } from './coreConstants';
import { underlayAt, underlayMap } from './Underlays';

/**
 * What a cell of an Epoxy level does in a mechanism, and what it is wired to. Pure, read-only, no i18n:
 * the editor names the roles. Lynx and CC3D levels have no devices here (CC3D keeps its own links).
 *
 * Facets of a cell: its visible top terrain, the terrain hidden under a removable top (level.underlays) and
 * the entities standing on it. The role is the first facet that is a device (top, then hidden, then
 * entity); the relations are the union of every facet, so a hidden device is wired even under a device top.
 */

/** Stable role ids of the devices; the editor maps them to names. */
export type DeviceRole =
  | 'trap_button' // brown button
  | 'trap'
  | 'clone_button' // red button
  | 'clone_machine'
  | 'shot_trigger'
  | 'shot_launcher'
  | 'pressure_plate'
  | 'hold_door'
  | 'toggle_button' // green and colour toggle buttons
  | 'toggle_wall'
  | 'teleporter'
  | 'tank_button' // blue button
  | 'tank' // an entity reversed by the blue button
  | 'flame_button' // orange button
  | 'flame_jet'
  | 'swap_button' // gray button: swaps chips and bombs around it
  | 'puppet_control'
  | 'puppet' // an entity steered by the puppet control
  | 'laser_emitter' // fires a beam, wired to nothing (the beam is geometry)
  | 'laser_receiver'
  | 'laser_gate';

/**
 * How two cells are related:
 * - 'link': an explicit link of the level (trapLinks, cloneLinks, launcherLinks);
 * - 'colour': same colour or group (plate and hold door, toggle button and wall of a channel, laser receiver
 *   and gate of a group, teleporters of a group); `channel` holds the colour or group id (absent for the
 *   ungrouped teleporters). Teleporters list the whole group, in both directions;
 * - 'level': a level-wide action or an engine fallback, see collectEdges.
 */
export type RelationKind = 'link' | 'colour' | 'level';

export interface Relation {
  x: number;
  y: number;
  kind: RelationKind;
  channel?: string;
}

export interface DeviceRelations {
  role: DeviceRole | null;
  controls: Relation[];
  controlledBy: Relation[];
}

/** Channel of the plain toggle button and walls (the walls that declare no colour). */
const GREEN_CHANNEL = 'green';
/** Channel recorded on the chips and bombs a gray button swaps (the radius is GRAY_BUTTON_RADIUS). */
const SWAP_RADIUS_CHANNEL = 'swap_radius';
/** Teleport group of the teleporters that declare none. */
const UNGROUPED_TELEPORT_GROUP = '';

/** Button action to role. */
const ROLE_OF_BUTTON_ACTION: Record<string, DeviceRole> = {
  toggle_walls: 'toggle_button',
  toggle_walls_red: 'toggle_button',
  toggle_walls_blue: 'toggle_button',
  toggle_walls_yellow: 'toggle_button',
  reverse_tanks: 'tank_button',
  hold_trap: 'trap_button',
  trigger_cloner: 'clone_button',
  toggle_flames: 'flame_button',
  swap_chips_bombs: 'swap_button',
  steer_monsters: 'puppet_control',
  fire_launchers: 'shot_trigger'
};

interface Cell {
  x: number;
  y: number;
}

interface Edge {
  from: Cell;
  to: Cell;
  kind: RelationKind;
  channel?: string;
}

interface TileAt extends Cell {
  tile: TileDefinition;
}

interface EntityFacet extends Cell {
  role: DeviceRole | null;
}

function isEpoxy(level: CompiledLevel): boolean {
  return level.ruleset !== 'lynx' && level.ruleset !== 'cc3d';
}

function inBounds(level: CompiledLevel, x: number, y: number): boolean {
  return (
    Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y < level.terrain.length && x >= 0 && x < (level.terrain[y]?.length ?? 0)
  );
}

/** The terrain tiles of a cell: the visible top first, then the one hidden under it, if any. */
function tilesAt(level: CompiledLevel, x: number, y: number): TileDefinition[] {
  const tiles = [ConfigRegistry.getTile(level.terrain[y][x])];
  const width = level.terrain[0]?.length ?? 0;
  const hidden = underlayAt(underlayMap(level), width, x, y);
  if (hidden !== undefined) tiles.push(ConfigRegistry.getTile(hidden));
  return tiles;
}

function roleOfTile(tile: TileDefinition): DeviceRole | null {
  if (tile.buttonAction !== undefined) return ROLE_OF_BUTTON_ACTION[tile.buttonAction] ?? null;
  if (tile.isTrap) return 'trap';
  if (tile.isCloneMachine) return 'clone_machine';
  if (tile.shotLauncher !== undefined) return 'shot_launcher';
  if (tile.isTeleporter) return 'teleporter';
  if (tile.laserEmitter !== undefined) return 'laser_emitter';
  if (tile.laserReceiverGroup !== undefined) return 'laser_receiver';
  if (tile.laserGateGroup !== undefined) return 'laser_gate';
  if (tile.plateColor !== undefined) return 'pressure_plate';
  if (tile.holdDoorColor !== undefined) return 'hold_door';
  if (tile.togglesTo !== undefined || tile.channelTogglesTo !== undefined) return 'toggle_wall';
  if (tile.flameTogglesTo !== undefined) return 'flame_jet';
  return null;
}

function roleOfEntity(type: string): DeviceRole | null {
  const def = ConfigRegistry.getEntityDef(type);
  if (def?.reversedByButton) return 'tank';
  if (def?.steeredBy === STEER_MONSTERS_ACTION) return 'puppet';
  return null;
}

function entityFacets(level: CompiledLevel): EntityFacet[] {
  return (level.entities ?? []).map((e) => ({ x: e.x, y: e.y, role: roleOfEntity(e.type) }));
}

/** Channel a wall answers to: the plain toggle walls are green; colour walls use their own channel. */
function wallChannel(tile: TileDefinition): string | undefined {
  if (tile.togglesTo !== undefined) return GREEN_CHANNEL;
  if (tile.channelTogglesTo !== undefined && tile.toggleChannel !== undefined) return tile.toggleChannel;
  return undefined;
}

/** Channel a toggle button works: the plain button is green, a colour button its own colour. */
function buttonChannel(tile: TileDefinition): string | undefined {
  if (tile.buttonAction === 'toggle_walls') return GREEN_CHANNEL;
  return channelOfButtonAction(tile.buttonAction);
}

/**
 * Every wiring of the level as directed edges, in the engine's terms. Level-wide rules ('level' kind):
 * - brown button: controls every trap that no trapLink names (the engine opens an unlinked trap while any
 *   brown button is held); a trap that a link names answers to its linked buttons only;
 * - red button with no cloneLink of its own: fires every clone machine that has an entity template on it;
 * - blue button reverses every tank, puppet control steers every puppet, orange button toggles every flame
 *   jet; the targets are the entity cells or the jet cells;
 * - gray button swaps the chips and bombs in the square of radius GRAY_BUTTON_RADIUS around it: each such
 *   item cell is a target, tagged with the channel 'swap_radius';
 * - a shot trigger with no launcherLink fires nothing.
 */
function collectEdges(level: CompiledLevel): Edge[] {
  const edges: Edge[] = [];
  const add = (from: Cell, to: Cell, kind: RelationKind, channel?: string): void => {
    if (from.x === to.x && from.y === to.y) return;
    edges.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, kind, ...(channel !== undefined ? { channel } : {}) });
  };

  const trapLinks = level.trapLinks ?? [];
  const cloneLinks = level.cloneLinks ?? [];
  const launcherLinks = level.launcherLinks ?? [];
  for (const l of trapLinks) {
    if (inBounds(level, l.buttonX, l.buttonY) && inBounds(level, l.trapX, l.trapY)) {
      add({ x: l.buttonX, y: l.buttonY }, { x: l.trapX, y: l.trapY }, 'link');
    }
  }
  for (const l of cloneLinks) {
    if (inBounds(level, l.buttonX, l.buttonY) && inBounds(level, l.clonerX, l.clonerY)) {
      add({ x: l.buttonX, y: l.buttonY }, { x: l.clonerX, y: l.clonerY }, 'link');
    }
  }
  for (const l of launcherLinks) {
    if (inBounds(level, l.buttonX, l.buttonY) && inBounds(level, l.launcherX, l.launcherY)) {
      add({ x: l.buttonX, y: l.buttonY }, { x: l.launcherX, y: l.launcherY }, 'link');
    }
  }

  const linkedTraps = new Set(trapLinks.map((l) => `${l.trapX},${l.trapY}`));
  const buttonsWithCloneLinks = new Set(cloneLinks.map((l) => `${l.buttonX},${l.buttonY}`));
  const entities = entityFacets(level);
  const entityCells = new Set(entities.map((e) => `${e.x},${e.y}`));

  const facets: TileAt[] = [];
  for (let y = 0; y < level.terrain.length; y++) {
    for (let x = 0; x < level.terrain[y].length; x++) {
      for (const tile of tilesAt(level, x, y)) facets.push({ x, y, tile });
    }
  }

  const teleportersByGroup = new Map<string, TileAt[]>();
  for (const a of facets) {
    if (!a.tile.isTeleporter) continue;
    const group = a.tile.teleportGroup ?? UNGROUPED_TELEPORT_GROUP;
    teleportersByGroup.set(group, [...(teleportersByGroup.get(group) ?? []), a]);
  }
  for (const [group, members] of teleportersByGroup) {
    const channel = group === UNGROUPED_TELEPORT_GROUP ? undefined : group;
    for (const a of members) for (const b of members) add(a, b, 'colour', channel);
  }

  for (const a of facets) {
    const action = a.tile.buttonAction;
    if (action === 'hold_trap') {
      for (const b of facets) if (b.tile.isTrap && !linkedTraps.has(`${b.x},${b.y}`)) add(a, b, 'level');
    } else if (action === 'trigger_cloner' && !buttonsWithCloneLinks.has(`${a.x},${a.y}`)) {
      for (const b of facets) if (b.tile.isCloneMachine && entityCells.has(`${b.x},${b.y}`)) add(a, b, 'level');
    } else if (action === 'reverse_tanks' || action === STEER_MONSTERS_ACTION) {
      const wanted: DeviceRole = action === 'reverse_tanks' ? 'tank' : 'puppet';
      for (const e of entities) if (e.role === wanted) add(a, e, 'level');
    } else if (action === 'toggle_flames') {
      for (const b of facets) if (b.tile.flameTogglesTo !== undefined) add(a, b, 'level');
    } else if (action === 'swap_chips_bombs') {
      for (let y = a.y - GRAY_BUTTON_RADIUS; y <= a.y + GRAY_BUTTON_RADIUS; y++) {
        for (let x = a.x - GRAY_BUTTON_RADIUS; x <= a.x + GRAY_BUTTON_RADIUS; x++) {
          const item = level.items?.[y]?.[x];
          if (item === CHIP_ITEM_ID || item === BOMB_ITEM_ID) add(a, { x, y }, 'level', SWAP_RADIUS_CHANNEL);
        }
      }
    }

    const channel = buttonChannel(a.tile);
    if (channel !== undefined) {
      for (const b of facets) if (wallChannel(b.tile) === channel) add(a, b, 'colour', channel);
    }
    if (a.tile.plateColor !== undefined) {
      for (const b of facets) if (b.tile.holdDoorColor === a.tile.plateColor) add(a, b, 'colour', a.tile.plateColor);
    }
    if (a.tile.laserReceiverGroup !== undefined) {
      for (const b of facets) {
        if (b.tile.laserGateGroup === a.tile.laserReceiverGroup) add(a, b, 'colour', a.tile.laserReceiverGroup);
      }
    }
  }
  return edges;
}

function compareRelations(a: Relation, b: Relation): number {
  return a.y - b.y || a.x - b.x || a.kind.localeCompare(b.kind) || (a.channel ?? '').localeCompare(b.channel ?? '');
}

function uniqueSorted(relations: Relation[]): Relation[] {
  const seen = new Set<string>();
  const out: Relation[] = [];
  for (const r of [...relations].sort(compareRelations)) {
    const key = `${r.x},${r.y},${r.kind},${r.channel ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function cellRole(level: CompiledLevel, x: number, y: number): DeviceRole | null {
  for (const tile of tilesAt(level, x, y)) {
    const role = roleOfTile(tile);
    if (role !== null) return role;
  }
  for (const e of entityFacets(level)) {
    if (e.x === x && e.y === y && e.role !== null) return e.role;
  }
  return null;
}

/** Whether the cell holds a device (its top, a device hidden under it, or a tank or puppet standing on it). */
export function isDeviceCell(level: CompiledLevel, x: number, y: number): boolean {
  return isEpoxy(level) && inBounds(level, x, y) && cellRole(level, x, y) !== null;
}

/**
 * The role of the cell and what it controls and is controlled by, in reading order. A cell that holds no
 * device but is the end of a link, or a chip or bomb inside a gray button's radius, has role null and
 * still lists those relations. Lynx and CC3D levels, and cells outside the grid, return nothing.
 */
export function deviceRelations(level: CompiledLevel, x: number, y: number): DeviceRelations {
  if (!isEpoxy(level) || !inBounds(level, x, y)) return { role: null, controls: [], controlledBy: [] };
  const controls: Relation[] = [];
  const controlledBy: Relation[] = [];
  for (const e of collectEdges(level)) {
    const channel = e.channel !== undefined ? { channel: e.channel } : {};
    if (e.from.x === x && e.from.y === y) controls.push({ x: e.to.x, y: e.to.y, kind: e.kind, ...channel });
    if (e.to.x === x && e.to.y === y) controlledBy.push({ x: e.from.x, y: e.from.y, kind: e.kind, ...channel });
  }
  return { role: cellRole(level, x, y), controls: uniqueSorted(controls), controlledBy: uniqueSorted(controlledBy) };
}
