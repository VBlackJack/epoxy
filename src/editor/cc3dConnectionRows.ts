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
import type { Cc3dColorGroup, Cc3dLinks } from '../core/cc3d/cc3dLinks';
import { displayMobId, displayTerrainId } from '../core/cc3d/display';
import { type Cc3dLevel, type Cc3dTerrain, type Cc3dTerrainKind, topTerrain } from '../core/cc3d/model';
import type { RelationKind } from '../core/DeviceRelations';
import { EDITOR_CONNECTIONS_MAX_ROWS } from '../ui/uiConstants';
import {
  CC3D_ROW_SYSTEM_NAME_KEYS,
  CONNECTIONS_KEYS,
  type ConnectionCaption,
  type ConnectionList,
  type ConnectionRow,
  type ConnectionSystem,
  type ConnectionView,
  NOTE_COLOUR_PARAM
} from './connectionRows';
import type { ToolMessage } from './editorTools';

/**
 * The Connections section of a CC3D level: what a cell controls and is controlled by, read from cc3dLinks() (the
 * derivation the engine resolves its devices with) as the same view model an Epoxy level gets. A CC3D level stores
 * no link, so no row can be unlinked and there is no Link button. Pure: it names things by locale key.
 */

/** Locale keys of the CC3D notes (literal keys, so the locale checks see them). */
export const CC3D_CONNECTION_KEYS = {
  derived: 'editor.connections.cc3d_derived.label',
  needsTrap: 'editor.connections.needs.cc3d_trap.label',
  needsTeleport: 'editor.connections.needs.cc3d_teleport.label',
  needsMachine: 'editor.connections.needs.cc3d_machine.label',
  needsTemplate: 'editor.connections.needs.cc3d_template.label',
  needsShooter: 'editor.connections.needs.cc3d_shooter.label',
  needsToggleControl: 'editor.connections.needs.cc3d_toggle_control.label',
  needsToggleDoor: 'editor.connections.needs.cc3d_toggle_door.label',
  needsGolem: 'editor.connections.needs.cc3d_golem.label',
  needsGolemControl: 'editor.connections.needs.cc3d_golem_control.label',
  trapUncontrolled: 'editor.connections.cc3d.trap_uncontrolled.label',
  buried: 'editor.connections.cc3d.buried.label'
} as const;

/** Terrain kinds that make a cell a mechanism, for its caption. */
const DEVICE_KINDS: ReadonlySet<Cc3dTerrainKind> = new Set<Cc3dTerrainKind>([
  'trap_control',
  'trap',
  'teleport_red',
  'teleport_blue',
  'clone_switch',
  'clone_machine',
  'laser_controller',
  'toggle_control',
  'toggle_door',
  'plate',
  'hold_door',
  'golem_control_blue',
  'golem_control_yellow'
]);

/**
 * Devices that act only from the top layer of their cell (the engine reads the top of the stack for them), though
 * cc3dLinks() counts them on any layer. Pressure devices (plates, trap controls) work from any layer.
 */
const TOP_LAYER_KINDS: ReadonlySet<Cc3dTerrainKind> = new Set<Cc3dTerrainKind>([
  'teleport_red',
  'teleport_blue',
  'clone_switch',
  'laser_controller',
  'toggle_control',
  'golem_control_blue',
  'golem_control_yellow'
]);

/** The tile whose name stands in when a stored part has no display id (a level that lacks an attribute its kind needs). */
const FALLBACK_NAME_TILE = 'floor';

const EMPTY_VIEW: ConnectionView = { caption: null, controls: null, controlledBy: null, note: null, link: null };

interface Entry {
  x: number;
  y: number;
  kind: RelationKind;
  system: ConnectionSystem;
  channel?: string;
  /** Resolved only for the rows the cap keeps. */
  name: () => ToolMessage;
}

/** Creatures that take part in a mechanism of their own (shooters, golems), so a cell holding one is a device. */
const DEVICE_MOB_KINDS: ReadonlySet<string> = new Set(['laser_shooter', 'golem_blue', 'golem_yellow']);

/** The name of a part, from the display id it is drawn with (creatures of the shared rules first, else the tile configs). */
function nameOfDisplay(entity: boolean, draw: () => string): ToolMessage {
  let id = FALLBACK_NAME_TILE;
  try {
    id = draw();
  } catch {
    // A stored part without the attribute its kind needs has no display id: the plain floor name stands in.
  }
  const definition = entity ? (ConfigRegistry.getEntityDef(id) ?? ConfigRegistry.getTile(id)) : ConfigRegistry.getTile(id);
  return { key: definition.i18nKey };
}

function layerName(layer: Cc3dTerrain): ToolMessage {
  return nameOfDisplay(false, () => displayTerrainId({ terrain: [layer], panels: [], item: null }));
}

function needsNote(key: string, colour: string | undefined): ToolMessage {
  return { key, ...(colour !== undefined ? { params: { [NOTE_COLOUR_PARAM]: colour } } : {}) };
}

function listOf(entries: readonly Entry[], emptyKey: string): ConnectionList {
  const perSystem = new Map<ConnectionSystem, number>();
  const rows: ConnectionRow[] = [];
  let more = 0;
  for (const entry of entries) {
    // Colour rows are capped per mechanism like the Epoxy ones; the position-derived links are few and never cut.
    if (entry.kind === 'colour') {
      const seen = perSystem.get(entry.system) ?? 0;
      if (seen >= EDITOR_CONNECTIONS_MAX_ROWS) {
        more++;
        continue;
      }
      perSystem.set(entry.system, seen + 1);
    }
    rows.push({
      x: entry.x,
      y: entry.y,
      kind: entry.kind,
      system: entry.system,
      ...(CC3D_ROW_SYSTEM_NAME_KEYS[entry.system] !== undefined ? { systemNameKey: CC3D_ROW_SYSTEM_NAME_KEYS[entry.system] } : {}),
      ...(entry.channel !== undefined ? { channel: entry.channel } : {}),
      fallback: false,
      name: entry.name(),
      unlink: null
    });
  }
  return { rows, more, empty: rows.length === 0 && more === 0 ? { key: emptyKey } : null };
}

/**
 * What the Connections section shows for a cell of a CC3D level: its caption, what the cell works and what works
 * it, and one note (a device buried under another layer first, else what the device still needs). `links` are the
 * level's derived links, passed by the caller that already has them. A cell outside the grid has no view.
 */
export function cc3dConnectionRows(level: Cc3dLevel, x: number, y: number, links: Cc3dLinks): ConnectionView {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return EMPTY_VIEW;
  const here = y * level.width + x;
  const cell = level.cells[here];
  if (!cell) return EMPTY_VIEW;

  const cellEntry = (index: number, layerKind: Cc3dTerrainKind, system: ConnectionSystem, kind: RelationKind, channel?: string): Entry => {
    const layer = level.cells[index].terrain.find((candidate) => candidate.kind === layerKind) ?? topTerrain(level.cells[index]);
    return { x: index % level.width, y: Math.floor(index / level.width), kind, system, ...(channel !== undefined ? { channel } : {}), name: () => layerName(layer) };
  };
  const topEntry = (index: number, system: ConnectionSystem): Entry => {
    const target = level.cells[index];
    return { x: index % level.width, y: Math.floor(index / level.width), kind: 'link', system, name: () => layerName(topTerrain(target)) };
  };
  const mobEntry = (mobIndex: number, system: ConnectionSystem, kind: RelationKind, channel?: string): Entry | null => {
    const mob = level.mobs[mobIndex];
    if (!mob) return null;
    return { x: mob.x, y: mob.y, kind, system, ...(channel !== undefined ? { channel } : {}), name: () => nameOfDisplay(true, () => displayMobId(mob)) };
  };
  // An entry device acts only from the top layer: one buried under another layer is listed but does not count as a partner.
  const actsFrom = (index: number, kind: Cc3dTerrainKind): boolean => !TOP_LAYER_KINDS.has(kind) || topTerrain(level.cells[index]).kind === kind;

  const controls: Entry[] = [];
  const controlledBy: Entry[] = [];
  const notes: ToolMessage[] = [];
  const add = (list: Entry[], entry: Entry | null): void => {
    if (entry) list.push(entry);
  };
  const layers = cell.terrain;
  const mobsHere: number[] = [];
  level.mobs.forEach((mob, index) => {
    if (mob.x === x && mob.y === y) mobsHere.push(index);
  });
  const layerOf = (kind: Cc3dTerrainKind): Cc3dTerrain | undefined => layers.find((layer) => layer.kind === kind);

  // Trap controls open the next trap; a trap lists the controls that open it.
  for (const link of links.trapControls) {
    if (link.from === here) {
      if (link.to !== null) controls.push(cellEntry(link.to, 'trap', 'trap', 'link'));
      else notes.push({ key: CC3D_CONNECTION_KEYS.needsTrap });
    }
    if (link.to === here) controlledBy.push(cellEntry(link.from, 'trap_control', 'trap', 'link'));
  }
  if (layerOf('trap') && !links.trapControls.some((link) => link.to === here)) notes.push({ key: CC3D_CONNECTION_KEYS.trapUncontrolled });

  // Teleports lead to the cell an arrival there would use; a teleport lists the ones that lead to it.
  for (const link of links.teleports) {
    if (link.from === here) {
      if (link.to !== null) controls.push(topEntry(link.to, 'teleport'));
      else notes.push(needsNote(CC3D_CONNECTION_KEYS.needsTeleport, topTerrain(cell).kind === 'teleport_red' ? 'red' : 'blue'));
    }
    if (link.to === here) controlledBy.push(topEntry(link.from, 'teleport'));
  }

  // Clone switches work the nearest machine; a machine copies the creature standing on it (the template).
  for (const link of links.cloneSwitches) {
    if (link.from === here) {
      if (link.to !== null) controls.push(cellEntry(link.to, 'clone_machine', 'clone', 'link'));
      else notes.push({ key: CC3D_CONNECTION_KEYS.needsMachine });
    }
    if (link.to === here) controlledBy.push(cellEntry(link.from, 'clone_switch', 'clone', 'link'));
  }
  for (const link of links.cloneMachines) {
    if (link.from === here) {
      if (link.to !== null) add(controls, mobEntry(link.to, 'template', 'link'));
      else notes.push({ key: CC3D_CONNECTION_KEYS.needsTemplate });
    }
    // A template stands on its machine's cell: the machine is not listed as controlling itself.
    if (link.from !== here && link.to !== null && mobsHere.includes(link.to)) controlledBy.push(cellEntry(link.from, 'clone_machine', 'template', 'link'));
  }

  // Laser controllers fire the nearest shooter.
  for (const link of links.laserControllers) {
    if (link.from === here) {
      if (link.to !== null) add(controls, mobEntry(link.to, 'laser', 'link'));
      else notes.push({ key: CC3D_CONNECTION_KEYS.needsShooter });
    }
    if (link.from !== here && link.to !== null && mobsHere.includes(link.to)) controlledBy.push(cellEntry(link.from, 'laser_controller', 'laser', 'link'));
  }

  // Colour groups: toggle controls and doors, plates and hold doors.
  const colourGroups = (
    groups: readonly Cc3dColorGroup[],
    controlKind: Cc3dTerrainKind,
    targetKind: Cc3dTerrainKind,
    system: ConnectionSystem,
    needsControlKey: string,
    needsTargetKey: string
  ): void => {
    const control = layerOf(controlKind);
    if (control?.color) {
      const group = groups.find((candidate) => candidate.color === control.color);
      for (const index of group?.targets ?? []) controls.push(cellEntry(index, targetKind, system, 'colour', control.color));
      if (!group || group.targets.length === 0) notes.push(needsNote(needsControlKey, control.color));
    }
    const target = layerOf(targetKind);
    if (target?.color) {
      const group = groups.find((candidate) => candidate.color === target.color);
      for (const index of group?.controls ?? []) controlledBy.push(cellEntry(index, controlKind, system, 'colour', target.color));
      if (!group || !group.controls.some((index) => actsFrom(index, controlKind))) notes.push(needsNote(needsTargetKey, target.color));
    }
  };
  colourGroups(links.toggles, 'toggle_control', 'toggle_door', 'toggle', CC3D_CONNECTION_KEYS.needsToggleControl, CC3D_CONNECTION_KEYS.needsToggleDoor);
  colourGroups(links.holds, 'plate', 'hold_door', 'hold', CONNECTIONS_KEYS.needsPlate, CONNECTIONS_KEYS.needsHoldDoor);

  // Golem controls move or turn every golem of their kind.
  for (const [color, controlKind, mobKind] of [
    ['blue', 'golem_control_blue', 'golem_blue'],
    ['yellow', 'golem_control_yellow', 'golem_yellow']
  ] as const) {
    const group = links.golems[color];
    if (layerOf(controlKind)) {
      for (const index of group.targets) add(controls, mobEntry(index, 'golem', 'colour', color));
      if (group.targets.length === 0) notes.push(needsNote(CC3D_CONNECTION_KEYS.needsGolem, color));
    }
    if (mobsHere.some((index) => level.mobs[index].kind === mobKind)) {
      for (const index of group.controls) controlledBy.push(cellEntry(index, controlKind, 'golem', 'colour', color));
      // A blue golem walks on its own; a yellow one never moves unless a control of its kind moves it.
      if (color === 'yellow' && !group.controls.some((index) => actsFrom(index, controlKind))) notes.push(needsNote(CC3D_CONNECTION_KEYS.needsGolemControl, color));
    }
  }

  // An entry device under another layer does nothing: the engine reads the top of the stack for it.
  const top = topTerrain(cell);
  const buried = layers.some((layer) => TOP_LAYER_KINDS.has(layer.kind) && layer.kind !== top.kind);
  const note = buried ? { key: CC3D_CONNECTION_KEYS.buried } : (notes[0] ?? null);

  const controlsList = listOf(controls, CONNECTIONS_KEYS.noneControls);
  const controlledList = listOf(controlledBy, CONNECTIONS_KEYS.noneControlled);
  const related = controlsList.rows.length + controlsList.more + controlledList.rows.length + controlledList.more > 0;
  const deviceLayer = layers.find((layer) => DEVICE_KINDS.has(layer.kind));
  const deviceMob = mobsHere.find((index) => DEVICE_MOB_KINDS.has(level.mobs[index].kind)) ?? (related ? mobsHere[0] : undefined);
  const deviceName: ToolMessage | null = deviceLayer
    ? layerName(deviceLayer)
    : deviceMob !== undefined
      ? nameOfDisplay(true, () => displayMobId(level.mobs[deviceMob]))
      : null;
  const caption: ConnectionCaption =
    deviceName === null && !related
      ? { key: CONNECTIONS_KEYS.noDevice, x, y, name: null }
      : { key: CONNECTIONS_KEYS.cell, x, y, name: deviceName ?? layerName(top) };
  return { caption, controls: controlsList, controlledBy: controlledList, note, link: null };
}
