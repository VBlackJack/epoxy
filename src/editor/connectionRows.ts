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
import { channelOfButtonAction } from '../core/coreConstants';
import type { TileDefinition } from '../core/types';
import { EDITOR_CONNECTIONS_MAX_ROWS } from '../ui/uiConstants';
import { holdsShotLauncher, holdsShotTrigger } from './editorLauncherLinks';
import type { ToolMessage } from './editorTools';
import type { LinkEnd, LinkSystem } from './mapEdits';

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
  fallbackLaserEmitter: `${KEY_PREFIX}fallback.laser_emitter`,
  needsPlate: `${KEY_PREFIX}needs.plate.label`,
  needsHoldDoor: `${KEY_PREFIX}needs.hold_door.label`,
  needsToggleButton: `${KEY_PREFIX}needs.toggle_button.label`,
  needsToggleWall: `${KEY_PREFIX}needs.toggle_wall.label`,
  needsTeleporterPlain: `${KEY_PREFIX}needs.teleporter_plain.label`,
  needsTeleporterColour: `${KEY_PREFIX}needs.teleporter_colour.label`,
  needsLaserReceiver: `${KEY_PREFIX}needs.laser_receiver.label`,
  needsLaserGate: `${KEY_PREFIX}needs.laser_gate.label`,
  needsPuppetControl: `${KEY_PREFIX}needs.puppet_control.label`,
  needsPuppet: `${KEY_PREFIX}needs.puppet.label`,
  needsFlameButton: `${KEY_PREFIX}needs.flame_button.label`,
  needsFlameJet: `${KEY_PREFIX}needs.flame_jet.label`
} as const;

/** Name of the param of a note that holds a colour or group id, translated by connectionNoteText. */
export const NOTE_COLOUR_PARAM = 'colour';

/** Channel of the plain toggle button and walls. */
const GREEN_CHANNEL = 'green';

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

/** The link session the Link button starts from this cell: its system and which end the cell is. */
export type ConnectionLink =
  | {
      type: 'start';
      system: LinkSystem;
      end: LinkEnd;
      /** True when the device sits hidden under another tile: a trap or clone device must be in plain view to be linked. */
      blocked: boolean;
    }
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

/** The roles that take part in an explicit link, by system and end. */
const LINK_OF_ROLE: Partial<Record<DeviceRole, { system: LinkSystem; end: LinkEnd }>> = {
  trap_button: { system: 'trap', end: 'button' },
  trap: { system: 'trap', end: 'target' },
  clone_button: { system: 'clone', end: 'button' },
  clone_machine: { system: 'clone', end: 'target' },
  shot_trigger: { system: 'shot', end: 'button' },
  shot_launcher: { system: 'shot', end: 'target' }
};

/** The link role a terrain tile plays in the trap and clone systems, read from its flags; shot devices do not exist under Lynx rules. */
function trapCloneLinkOf(tileId: string | undefined): { system: LinkSystem; end: LinkEnd } | null {
  if (tileId === undefined || !ConfigRegistry.isTerrainTile(tileId)) return null;
  const tile = ConfigRegistry.getTile(tileId);
  if (tile.buttonAction === 'hold_trap') return { system: 'trap', end: 'button' };
  if (tile.buttonAction === 'trigger_cloner') return { system: 'clone', end: 'button' };
  if (tile.isTrap) return { system: 'trap', end: 'target' };
  if (tile.isCloneMachine) return { system: 'clone', end: 'target' };
  return null;
}

/**
 * The Link button of a cell of a Lynx level, which the device queries do not cover: a trap, a clone machine or their
 * buttons on the top tile, or hidden under it (blocked, as the trap and clone systems read the top tile only).
 */
function lynxLinkOf(level: DeviceLevel, x: number, y: number): ConnectionLink {
  const top = trapCloneLinkOf(level.terrain[y]?.[x]);
  if (top) return { type: 'start', ...top, blocked: false };
  const hidden = trapCloneLinkOf((level.underlays ?? []).find((u) => u.x === x && u.y === y)?.terrain);
  return hidden ? { type: 'start', ...hidden, blocked: true } : null;
}

/** The Link button of a cell of an Epoxy level: set for every device that takes part in an explicit link (none for CC3D). */
function linkOf(role: DeviceRole | null, facetSource: string | undefined, ruleset: DeviceLevel['ruleset']): ConnectionLink {
  const link = role === null ? undefined : LINK_OF_ROLE[role];
  if (!link || ruleset === 'cc3d') return null;
  return { type: 'start', system: link.system, end: link.end, blocked: link.system !== 'shot' && facetSource !== 'top' };
}

/**
 * The Link button for a shot trigger or launcher hidden under a top tile that plays another role: the engine works
 * a shot device on top or hidden, so it can be linked from the cell although the top role has no link of its own.
 */
function hiddenShotLinkOf(level: DeviceLevel, x: number, y: number): ConnectionLink {
  if (level.ruleset === 'cc3d') return null;
  if (holdsShotTrigger(level, x, y)) return { type: 'start', system: 'shot', end: 'button', blocked: false };
  if (holdsShotLauncher(level, x, y)) return { type: 'start', system: 'shot', end: 'target', blocked: false };
  return null;
}

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

/** The terrain tile that gives the cell its role (top or hidden), or null when an entity or nothing does. */
function roleTileOf(rel: DeviceRelations): TileDefinition | null {
  const facet = rel.facet;
  if (!facet || facet.source === 'entity' || !ConfigRegistry.isTerrainTile(facet.id)) return null;
  return ConfigRegistry.getTile(facet.id);
}

/** A "needs" note carrying the colour or group id it is about (translated when the note is written out). */
function needsNote(key: string, colour: string | undefined): ToolMessage {
  return { key, ...(colour !== undefined ? { params: { [NOTE_COLOUR_PARAM]: colour } } : {}) };
}

/**
 * What a device still needs to do anything, read from the emptiness of its relations (a relation exists exactly when
 * a partner of the same colour or kind is on the level) and the engine's rules; null when it has a partner, or
 * when the role has no partner to wait for.
 */
function needsNoteFor(role: DeviceRole | null, rel: DeviceRelations, tile: TileDefinition | null): ToolMessage | null {
  switch (role) {
    case 'pressure_plate':
      return rel.controls.length === 0 ? needsNote(CONNECTIONS_KEYS.needsPlate, tile?.plateColor) : null;
    case 'hold_door':
      return rel.controlledBy.length === 0 ? needsNote(CONNECTIONS_KEYS.needsHoldDoor, tile?.holdDoorColor) : null;
    case 'toggle_button':
      return rel.controls.length === 0
        ? needsNote(CONNECTIONS_KEYS.needsToggleButton, tile?.buttonAction === 'toggle_walls' ? GREEN_CHANNEL : channelOfButtonAction(tile?.buttonAction))
        : null;
    case 'toggle_wall':
      return rel.controlledBy.length === 0
        ? needsNote(CONNECTIONS_KEYS.needsToggleWall, tile?.togglesTo !== undefined ? GREEN_CHANNEL : tile?.toggleChannel)
        : null;
    case 'teleporter':
      if (rel.controls.length > 0) return null;
      return tile?.teleportGroup === undefined
        ? { key: CONNECTIONS_KEYS.needsTeleporterPlain }
        : needsNote(CONNECTIONS_KEYS.needsTeleporterColour, tile.teleportGroup);
    case 'laser_receiver':
      return rel.controls.length === 0 ? needsNote(CONNECTIONS_KEYS.needsLaserReceiver, tile?.laserReceiverGroup) : null;
    case 'laser_gate':
      return rel.controlledBy.length === 0 ? needsNote(CONNECTIONS_KEYS.needsLaserGate, tile?.laserGateGroup) : null;
    case 'puppet_control':
      return rel.controls.length === 0 ? { key: CONNECTIONS_KEYS.needsPuppetControl } : null;
    case 'puppet':
      return rel.controlledBy.length === 0 ? { key: CONNECTIONS_KEYS.needsPuppet } : null;
    case 'flame_button':
      return rel.controls.length === 0 ? { key: CONNECTIONS_KEYS.needsFlameButton } : null;
    case 'flame_jet':
      return rel.controlledBy.length === 0 ? { key: CONNECTIONS_KEYS.needsFlameJet } : null;
    default:
      return null;
  }
}

/** Writes a note out: its colour param (a colour or group id) becomes the colour's name, any other id stays as it is. */
export function connectionNoteText(note: ToolMessage, translate: (key: string, params?: Record<string, string | number>) => string): string {
  const colour = note.params?.[NOTE_COLOUR_PARAM];
  if (typeof colour !== 'string') return translate(note.key, note.params);
  const name = CHANNEL_NAME_KEYS[colour] ? translate(CHANNEL_NAME_KEYS[colour]) : colour;
  return translate(note.key, { ...note.params, [NOTE_COLOUR_PARAM]: name });
}

/** The sentence that spells out the engine's fallback or what the device still needs, or null when there is none to say. */
function noteFor(role: DeviceRole | null, rel: DeviceRelations, tile: TileDefinition | null): ToolMessage | null {
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
      return needsNoteFor(role, rel, tile);
  }
}

/**
 * What the Connections section shows for the cell: its caption, the two lists, the fallback note and the Link
 * button state. A Lynx level lists nothing (its note says where its links are shown); a cell outside the grid
 * has no view.
 */
export function connectionRows(level: DeviceLevel, x: number, y: number): ConnectionView {
  if (y < 0 || y >= level.terrain.length || x < 0 || x >= (level.terrain[y]?.length ?? 0)) return EMPTY_VIEW;
  if (level.ruleset === 'lynx') return { ...EMPTY_VIEW, note: { key: CONNECTIONS_KEYS.epoxyOnly }, link: lynxLinkOf(level, x, y) };
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
  const link = linkOf(rel.role, rel.facet?.source, level.ruleset) ?? hiddenShotLinkOf(level, x, y);
  return { caption, controls, controlledBy, note: noteFor(rel.role, rel, roleTileOf(rel)), link };
}
