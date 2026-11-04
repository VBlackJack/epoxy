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
import { type DeviceLevel, type DeviceRelations, type DeviceRole, type Relation, type RelationKind, type RelationSystem, deviceRelations } from '../core/DeviceRelations';
import { EDITOR_CONNECTIONS_MAX_ROWS } from '../ui/uiConstants';
import type { ToolMessage } from './editorTools';

/**
 * The view model of the Connections section: what a cell controls and is controlled by, as rows the editor
 * draws, with the notes that spell out the engine's fallbacks and the state of the Link button. Pure: it reads
 * deviceRelations() and names things by locale key, the editor translates them.
 */

const KEY_PREFIX = 'editor.connections.';
export const CONNECTIONS_KEYS = {
  cell: `${KEY_PREFIX}cell`,
  cellHidden: `${KEY_PREFIX}cell_hidden`,
  noDevice: `${KEY_PREFIX}no_device`,
  noneControls: `${KEY_PREFIX}none_controls`,
  noneControlled: `${KEY_PREFIX}none_controlled`,
  epoxyOnly: `${KEY_PREFIX}epoxy_only`,
  fallbackTrapButton: `${KEY_PREFIX}fallback.trap_button`,
  fallbackTrapUnlinked: `${KEY_PREFIX}fallback.trap_unlinked`,
  fallbackTrapLinked: `${KEY_PREFIX}fallback.trap_linked`,
  fallbackCloneAny: `${KEY_PREFIX}fallback.clone_any`,
  fallbackCloneNone: `${KEY_PREFIX}fallback.clone_none`,
  fallbackShotUnlinked: `${KEY_PREFIX}fallback.shot_unlinked`,
  fallbackLaserEmitter: `${KEY_PREFIX}fallback.laser_emitter`
} as const;

/** Locale key of the name of each device role (literal keys, so the locale checks see them). */
export const ROLE_NAME_KEYS: Readonly<Record<DeviceRole, string>> = {
  trap_button: 'editor.connections.role.trap_button.label',
  trap: 'editor.connections.role.trap.label',
  clone_button: 'editor.connections.role.clone_button.label',
  clone_machine: 'editor.connections.role.clone_machine.label',
  shot_trigger: 'editor.connections.role.shot_trigger.label',
  shot_launcher: 'editor.connections.role.shot_launcher.label',
  pressure_plate: 'editor.connections.role.pressure_plate.label',
  hold_door: 'editor.connections.role.hold_door.label',
  toggle_button: 'editor.connections.role.toggle_button.label',
  toggle_wall: 'editor.connections.role.toggle_wall.label',
  teleporter: 'editor.connections.role.teleporter.label',
  tank_button: 'editor.connections.role.tank_button.label',
  tank: 'editor.connections.role.tank.label',
  flame_button: 'editor.connections.role.flame_button.label',
  flame_jet: 'editor.connections.role.flame_jet.label',
  swap_button: 'editor.connections.role.swap_button.label',
  puppet_control: 'editor.connections.role.puppet_control.label',
  puppet: 'editor.connections.role.puppet.label',
  laser_emitter: 'editor.connections.role.laser_emitter.label',
  laser_receiver: 'editor.connections.role.laser_receiver.label',
  laser_gate: 'editor.connections.role.laser_gate.label'
};

/** Locale key of the name of each mechanism. */
export const SYSTEM_NAME_KEYS: Readonly<Record<RelationSystem, string>> = {
  trap: 'editor.connections.system.trap.label',
  clone: 'editor.connections.system.clone.label',
  shot: 'editor.connections.system.shot.label',
  plate: 'editor.connections.system.plate.label',
  toggle: 'editor.connections.system.toggle.label',
  teleport: 'editor.connections.system.teleport.label',
  laser: 'editor.connections.system.laser.label',
  tank: 'editor.connections.system.tank.label',
  flame: 'editor.connections.system.flame.label',
  swap: 'editor.connections.system.swap.label',
  puppet: 'editor.connections.system.puppet.label'
};

/** Locale key of how a relation is wired; a fallback edge reads as "no link". */
export const KIND_NAME_KEYS: Readonly<Record<RelationKind | 'fallback', string>> = {
  link: 'editor.connections.kind.link',
  colour: 'editor.connections.kind.colour',
  level: 'editor.connections.kind.level',
  fallback: 'editor.connections.kind.fallback'
};

/** Locale key of the colours and groups a relation can name; any other id is shown as it is. */
export const CHANNEL_NAME_KEYS: Readonly<Record<string, string>> = {
  red: 'editor.connections.channel.red',
  green: 'editor.connections.channel.green',
  blue: 'editor.connections.channel.blue',
  yellow: 'editor.connections.channel.yellow',
  swap_radius: 'editor.connections.channel.swap_radius'
};

export interface ConnectionPoint {
  x: number;
  y: number;
}

/** The link an Unlink button removes: the button cell and the target cell of one explicit link. */
export interface ConnectionUnlink {
  system: 'trap' | 'clone' | 'shot';
  button: ConnectionPoint;
  target: ConnectionPoint;
}

export interface ConnectionRow {
  x: number;
  y: number;
  kind: RelationKind;
  system: RelationSystem;
  channel?: string;
  /** True for the engine's fallbacks (an unlinked trap or red button): the row reads as "no link". */
  fallback: boolean;
  /** The other cell's device name, else its item or tile name. */
  name: ToolMessage;
  unlink: ConnectionUnlink | null;
}

export interface ConnectionList {
  rows: ConnectionRow[];
  /** Colour and level-wide rows left out of the list by the per-mechanism cap. */
  more: number;
  /** What the list says when it has no row; null when it has rows. */
  empty: ToolMessage | null;
}

/** The wire the Link button starts, or the hint that tells where to start one. */
export type ConnectionWire = 'trap' | 'clone' | 'launcher';
export type ConnectionLink =
  | {
      type: 'start';
      wire: ConnectionWire;
      /** True when the button sits hidden under another tile: the trap and clone wires need it in plain view. */
      blocked: boolean;
    }
  | { type: 'hint' }
  | null;

/** The line above the lists: the cell and what it is (null name: it holds no mechanism). */
export interface ConnectionCaption {
  key: string;
  x: number;
  y: number;
  name: ToolMessage | null;
}

export interface ConnectionView {
  caption: ConnectionCaption | null;
  controls: ConnectionList | null;
  controlledBy: ConnectionList | null;
  note: ToolMessage | null;
  link: ConnectionLink;
}

const WIRE_OF_ROLE: Partial<Record<DeviceRole, ConnectionWire>> = {
  trap_button: 'trap',
  clone_button: 'clone',
  shot_trigger: 'launcher'
};

/** Roles that are the target end of an explicit link: the player starts the link from their button. */
const LINK_TARGET_ROLES: ReadonlySet<DeviceRole> = new Set<DeviceRole>(['trap', 'clone_machine', 'shot_launcher']);

const EMPTY_VIEW: ConnectionView = { caption: null, controls: null, controlledBy: null, note: null, link: null };

/** The name of a cell for the caption and the rows when it holds no device: its item, else its top tile. */
function plainName(level: DeviceLevel, x: number, y: number): ToolMessage {
  const item = level.items[y]?.[x];
  if (item) return { key: ConfigRegistry.getTile(item).i18nKey };
  return { key: ConfigRegistry.getTile(level.terrain[y]?.[x] ?? '').i18nKey };
}

function nameOf(level: DeviceLevel, role: DeviceRole | null, x: number, y: number): ToolMessage {
  return role === null ? plainName(level, x, y) : { key: ROLE_NAME_KEYS[role] };
}

/** The name of a cell for a status line: its device role, else its item, else its top tile. */
export function connectionCellName(level: DeviceLevel, x: number, y: number): ToolMessage {
  return nameOf(level, deviceRelations(level, x, y).role, x, y);
}

/** Keeps the first EDITOR_CONNECTIONS_MAX_ROWS colour and level-wide relations of each mechanism; links are never cut. */
function capRelations(relations: readonly Relation[]): { kept: Relation[]; more: number } {
  const perSystem = new Map<RelationSystem, number>();
  const kept: Relation[] = [];
  let more = 0;
  for (const r of relations) {
    if (r.kind === 'link') {
      kept.push(r);
      continue;
    }
    const seen = perSystem.get(r.system) ?? 0;
    if (seen >= EDITOR_CONNECTIONS_MAX_ROWS) {
      more++;
      continue;
    }
    perSystem.set(r.system, seen + 1);
    kept.push(r);
  }
  return { kept, more };
}

function unlinkOf(
  relation: Relation,
  subject: ConnectionPoint,
  direction: 'controls' | 'controlledBy'
): ConnectionUnlink | null {
  if (relation.kind !== 'link') return null;
  if (relation.system !== 'trap' && relation.system !== 'clone' && relation.system !== 'shot') return null;
  const other = { x: relation.x, y: relation.y };
  return direction === 'controls'
    ? { system: relation.system, button: subject, target: other }
    : { system: relation.system, button: other, target: subject };
}

function listOf(
  level: DeviceLevel,
  relations: readonly Relation[],
  subject: ConnectionPoint,
  direction: 'controls' | 'controlledBy',
  emptyKey: string
): ConnectionList {
  // The gray button swaps what lies on its own cell too: that relation to itself says nothing.
  const others = relations.filter((r) => !(r.system === 'swap' && r.x === subject.x && r.y === subject.y));
  const { kept, more } = capRelations(others);
  const rows: ConnectionRow[] = kept.map((r) => ({
    x: r.x,
    y: r.y,
    kind: r.kind,
    system: r.system,
    ...(r.channel !== undefined ? { channel: r.channel } : {}),
    fallback: r.fallback === true,
    name: nameOf(level, deviceRelations(level, r.x, r.y).role, r.x, r.y),
    unlink: unlinkOf(r, subject, direction)
  }));
  return { rows, more, empty: rows.length === 0 && more === 0 ? { key: emptyKey } : null };
}

function hasLink(relations: readonly Relation[], system: RelationSystem): boolean {
  return relations.some((r) => r.kind === 'link' && r.system === system);
}

function hasFallback(relations: readonly Relation[], system: RelationSystem): boolean {
  return relations.some((r) => r.fallback === true && r.system === system);
}

/** The sentence that spells out the engine's fallback for the cell's device, or null when there is none to spell. */
function noteFor(role: DeviceRole | null, rel: DeviceRelations): ToolMessage | null {
  switch (role) {
    case 'trap_button':
      return hasFallback(rel.controls, 'trap') ? { key: CONNECTIONS_KEYS.fallbackTrapButton } : null;
    case 'trap':
      return { key: hasLink(rel.controlledBy, 'trap') ? CONNECTIONS_KEYS.fallbackTrapLinked : CONNECTIONS_KEYS.fallbackTrapUnlinked };
    case 'clone_button':
      if (hasLink(rel.controls, 'clone')) return null;
      return { key: hasFallback(rel.controls, 'clone') ? CONNECTIONS_KEYS.fallbackCloneAny : CONNECTIONS_KEYS.fallbackCloneNone };
    case 'shot_trigger':
      return hasLink(rel.controls, 'shot') ? null : { key: CONNECTIONS_KEYS.fallbackShotUnlinked };
    case 'laser_emitter':
      return { key: CONNECTIONS_KEYS.fallbackLaserEmitter };
    default:
      return null;
  }
}

/**
 * What the Connections section shows for the cell: its caption, the two lists, the fallback note and the Link
 * button state. A Lynx level lists nothing (its note says where its links are shown); a cell outside the grid
 * has no view.
 */
export function connectionRows(level: DeviceLevel, x: number, y: number): ConnectionView {
  if (level.ruleset === 'lynx') return { ...EMPTY_VIEW, note: { key: CONNECTIONS_KEYS.epoxyOnly } };
  if (y < 0 || y >= level.terrain.length || x < 0 || x >= (level.terrain[y]?.length ?? 0)) return EMPTY_VIEW;
  const subject = { x, y };
  const rel = deviceRelations(level, x, y);
  const controls = listOf(level, rel.controls, subject, 'controls', CONNECTIONS_KEYS.noneControls);
  const controlledBy = listOf(level, rel.controlledBy, subject, 'controlledBy', CONNECTIONS_KEYS.noneControlled);
  const related = controls.rows.length + controls.more + controlledBy.rows.length + controlledBy.more > 0;
  const name = nameOf(level, rel.role, x, y);
  const caption: ConnectionCaption =
    rel.role === null && !related
      ? { key: CONNECTIONS_KEYS.noDevice, x, y, name: null }
      : { key: rel.facet?.source === 'hidden' ? CONNECTIONS_KEYS.cellHidden : CONNECTIONS_KEYS.cell, x, y, name };
  const wire = rel.role === null ? undefined : WIRE_OF_ROLE[rel.role];
  const link: ConnectionLink = wire
    ? { type: 'start', wire, blocked: wire !== 'launcher' && rel.facet?.source !== 'top' }
    : rel.role !== null && LINK_TARGET_ROLES.has(rel.role)
      ? { type: 'hint' }
      : null;
  return { caption, controls, controlledBy, note: noteFor(rel.role, rel), link };
}
