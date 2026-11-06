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
import { FLOOR_TILE_ID } from '../core/coreConstants';
import { Direction, Ruleset } from '../core/types';
import { t } from '../i18n/I18nManager';
import { emptyClonerMessage } from './cellDescription';
import { EditorMap } from './editorDocument';
import type { ToolMessage } from './editorTools';
import { underlayAt } from './editorUnderlays';
import {
  hasLink,
  hidesLinkEnd,
  holdsLinkEnd,
  LinkEditResult,
  LinkEnd,
  LinkSystem,
  linkCountAt,
  mapHeightOf,
  mapWidthOf,
  placePartnerAndLink,
  replaceButtonLink,
  toggleLink
} from './mapEdits';
import { EPOXY_ONLY_REASON_KEY } from './paletteAvailability';

export type { LinkEnd, LinkSystem } from './mapEdits';

/** A link session: the device the author is linking from, and which end of its system it is. */
export interface LinkSession {
  system: LinkSystem;
  end: LinkEnd;
  x: number;
  y: number;
}

/** What a cell offers to a link session: the system and end of the device on it, and whether it is hidden where it cannot be linked. */
export interface SessionRole {
  system: LinkSystem;
  end: LinkEnd;
  /** True for a trap or clone device hidden under the top tile: the engine, the validator and Lynx read the top tile only. */
  blocked: boolean;
}

/** The partners a session offers: every device it could link to, and those it is linked to already. */
export interface PartnerCandidates {
  candidates: Array<{ x: number; y: number }>;
  linked: Array<{ x: number; y: number }>;
}

/** Outcome of a click in a session. `map` is present only when the click edited the map; `session` is null when it ended. */
export interface SessionClickResult {
  map?: EditorMap;
  session: LinkSession | null;
  messages: ToolMessage[];
}

/** Outcome of starting a session on a cell. */
export interface SessionStartResult {
  session: LinkSession | null;
  messages: ToolMessage[];
}

const KEY_STARTED = 'editor.link.started.label';
const KEY_LINKED = 'editor.link.linked.label';
const KEY_UNLINKED = 'editor.link.unlinked.label';
const KEY_PLACED = 'editor.link.placed.label';
const KEY_REPLACED = 'editor.link.replaced.label';
const KEY_DONE = 'editor.link.done.label';
const KEY_SOURCE_GONE = 'editor.link.source_gone.label';
const KEY_UNAVAILABLE = 'editor.link.unavailable.label';
const KEY_NOTHING = 'editor.link.nothing.label';
const KEY_NUDGE = 'editor.link.nudge.label';
const KEY_REFUSED_HIDDEN = 'editor.link.refused.hidden.label';
const KEY_REFUSED_NOT_FREE = 'editor.link.refused.not_free.label';
const KEY_REFUSED_OTHER = 'editor.link.refused.other.label';
const KEY_REFUSED_CYCLE = 'editor.link.refused.cycle.label';
const KEY_REFUSED_SINGLE_INPUT = 'editor.link.refused.single_input.label';
const KEY_STARTED_SIGNAL = 'editor.link.started_signal.label';
const KEY_REFUSED_OTHER_SIGNAL = 'editor.link.refused.other_signal.label';
const FALLBACK_KEY_PREFIX = 'editor.link.fallback.';
const FALLBACK_LYNX_KEY_PREFIX = 'editor.link.fallback_lynx.';
const ROLE_KEY_PREFIX = 'editor.connections.role.';
const LABEL_SUFFIX = '.label';

/** The systems and ends a session works, in the order a cell is read. */
const SYSTEMS: readonly LinkSystem[] = ['trap', 'clone', 'shot', 'signal'];
const ENDS: readonly LinkEnd[] = ['button', 'target'];

/** The role id of a device, as the Connections section names it. */
function roleId(system: LinkSystem, end: LinkEnd): string {
  if (system === 'trap') return end === 'button' ? 'trap_button' : 'trap';
  if (system === 'clone') return end === 'button' ? 'clone_button' : 'clone_machine';
  if (system === 'signal') return end === 'button' ? 'signal_out' : 'signal_in';
  return end === 'button' ? 'shot_trigger' : 'shot_launcher';
}

function roleName(system: LinkSystem, end: LinkEnd): string {
  return t(`${ROLE_KEY_PREFIX}${roleId(system, end)}${LABEL_SUFFIX}`);
}

const otherEnd = (end: LinkEnd): LinkEnd => (end === 'button' ? 'target' : 'button');

function inGrid(map: EditorMap, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < mapWidthOf(map) && y < mapHeightOf(map);
}

/** Whether the ruleset can carry the system at all (Lynx has no shot or signal devices; CC3D draws no links here). */
function systemAllowed(system: LinkSystem, ruleset: Ruleset): boolean {
  return ruleset !== 'cc3d' && !(ruleset === 'lynx' && (system === 'shot' || system === 'signal'));
}

/** Lynx reads one link per button for the system, so a link from a button replaces the others. */
function replacesLinks(system: LinkSystem, ruleset: Ruleset): boolean {
  return ruleset === 'lynx' && system !== 'shot';
}

/**
 * What the cell offers to a link session, read from the tile flags: a trap or clone device counts only on the top tile
 * (hidden under another tile it is `blocked`), a shot trigger or launcher on top or hidden. Null for a cell with no
 * such device, for every cell of a CC3D map, and for shot devices in a Lynx level.
 */
export function sessionRoleAt(level: EditorMap, x: number, y: number, ruleset: Ruleset): SessionRole | null {
  if (level.cc3d || ruleset === 'cc3d' || !inGrid(level, x, y)) return null;
  for (const system of SYSTEMS) {
    if (!systemAllowed(system, ruleset)) continue;
    for (const end of ENDS) {
      if (holdsLinkEnd(level, system, end, x, y)) return { system, end, blocked: false };
    }
  }
  for (const system of SYSTEMS) {
    if (!systemAllowed(system, ruleset)) continue;
    for (const end of ENDS) {
      if (hidesLinkEnd(level, system, end, x, y)) return { system, end, blocked: true };
    }
  }
  return null;
}

/** Whether the session's source still holds its role (the map changed under the session, or was replaced). */
export function sessionSourceHolds(level: EditorMap, session: LinkSession, ruleset: Ruleset): boolean {
  // A signal session reads the signal ends alone: a gate holds both, and a launcher or clone machine reads as its own
  // system first yet can source a session on its signal input (an edge sink).
  if (session.system === 'signal') {
    return !level.cc3d && ruleset !== 'cc3d' && systemAllowed('signal', ruleset) && inGrid(level, session.x, session.y) && holdsLinkEnd(level, 'signal', session.end, session.x, session.y);
  }
  const role = sessionRoleAt(level, session.x, session.y, ruleset);
  if (role === null || role.blocked || role.system !== session.system) return false;
  return role.end === session.end;
}

/** Every device the session could link to (the opposite end of its system, plain view), and those already linked to its source. */
export function partnerCandidates(level: EditorMap, session: LinkSession, ruleset: Ruleset): PartnerCandidates {
  const result: PartnerCandidates = { candidates: [], linked: [] };
  if (level.cc3d || !systemAllowed(session.system, ruleset)) return result;
  const partnerEnd = otherEnd(session.end);
  for (let y = 0; y < mapHeightOf(level); y++) {
    for (let x = 0; x < mapWidthOf(level); x++) {
      if (x === session.x && y === session.y) continue;
      if (!holdsLinkEnd(level, session.system, partnerEnd, x, y)) continue;
      result.candidates.push({ x, y });
      const pair = session.end === 'button' ? [session, { x, y }] : [{ x, y }, session];
      if (hasLink(level, session.system, pair[0], pair[1])) result.linked.push({ x, y });
    }
  }
  return result;
}

/** The status lines of a session that starts or switches: what is linked, and what an unlinked device does. */
export function sessionStartMessages(level: EditorMap, session: LinkSession, ruleset: Ruleset): ToolMessage[] {
  const count = linkCountAt(level, session.system, session.end, session.x, session.y);
  const messages: ToolMessage[] = [
    {
      key: session.system === 'signal' ? KEY_STARTED_SIGNAL : KEY_STARTED,
      params: {
        role: roleName(session.system, session.end),
        partner: roleName(session.system, otherEnd(session.end)),
        x: session.x,
        y: session.y,
        count
      }
    }
  ];
  if (count === 0) {
    // Lynx reads links only: an unlinked device does nothing, so it has its own wording.
    const prefix = ruleset === 'lynx' ? FALLBACK_LYNX_KEY_PREFIX : FALLBACK_KEY_PREFIX;
    messages.push({ key: `${prefix}${roleId(session.system, session.end)}${LABEL_SUFFIX}` });
  }
  return messages;
}

/**
 * Starts a session on a cell (the K key, Link... in Connections). The cell must hold a device in plain view; a hidden
 * trap or clone device is refused, anything else says there is nothing to link. A CC3D map starts nothing.
 * With `only: 'signal'` the session is the signal one of a device that reads as another system first (a shot launcher
 * or a clone machine, which a signal wire can end on): it starts on the device's signal input, or says there is none.
 */
export function startLinkSession(level: EditorMap, x: number, y: number, ruleset: Ruleset, only?: 'signal'): SessionStartResult {
  if (level.cc3d || ruleset === 'cc3d') return { session: null, messages: [{ key: KEY_UNAVAILABLE }] };
  if (only === 'signal') {
    if (ruleset === 'lynx') return { session: null, messages: [{ key: EPOXY_ONLY_REASON_KEY }] };
    if (!inGrid(level, x, y) || !holdsLinkEnd(level, 'signal', 'target', x, y)) return { session: null, messages: [{ key: KEY_NOTHING }] };
    const session: LinkSession = { system: 'signal', end: 'target', x, y };
    return { session, messages: sessionStartMessages(level, session, ruleset) };
  }
  const role = sessionRoleAt(level, x, y, ruleset);
  // A Lynx level has no signal devices: say why instead of saying there is nothing to link. A clone machine still links there.
  if (!role && ruleset === 'lynx' && (holdsLinkEnd(level, 'signal', 'button', x, y) || holdsLinkEnd(level, 'signal', 'target', x, y))) {
    return { session: null, messages: [{ key: EPOXY_ONLY_REASON_KEY }] };
  }
  if (!role) return { session: null, messages: [{ key: KEY_NOTHING }] };
  if (role.blocked) return { session: null, messages: [{ key: KEY_REFUSED_HIDDEN, params: { role: roleName(role.system, role.end) } }] };
  const session: LinkSession = { system: role.system, end: role.end, x, y };
  return { session, messages: sessionStartMessages(level, session, ruleset) };
}

/**
 * The one cell whose top tile or hidden terrain differs between two versions of a map, or null when none or several do
 * (or the size changed). What a single placement leaves behind.
 */
export function soleChangedCell(before: EditorMap, after: EditorMap): { x: number; y: number } | null {
  if (mapWidthOf(before) !== mapWidthOf(after) || mapHeightOf(before) !== mapHeightOf(after)) return null;
  let found: { x: number; y: number } | null = null;
  for (let y = 0; y < mapHeightOf(after); y++) {
    for (let x = 0; x < mapWidthOf(after); x++) {
      if (before.terrain[y][x] === after.terrain[y][x] && underlayAt(before, x, y) === underlayAt(after, x, y)) continue;
      if (found) return null;
      found = { x, y };
    }
  }
  return found;
}

/**
 * The status lines that tell the author a device just placed can be linked: what it is, how to start (K or Link...) and
 * what it does unlinked. Empty when the cell holds no device in plain view or the device is linked already.
 */
export function nudgeMessages(level: EditorMap, x: number, y: number, ruleset: Ruleset): ToolMessage[] {
  const role = sessionRoleAt(level, x, y, ruleset);
  if (!role || role.blocked || linkCountAt(level, role.system, role.end, x, y) > 0) return [];
  // A hold door and a laser receiver work without a signal link (plates, beams): no nudge to link them.
  if (role.system === 'signal') {
    const tile = ConfigRegistry.getTile(level.terrain[y][x]);
    if (tile.holdDoorColor !== undefined || tile.laserReceiverGroup !== undefined) return [];
  }
  const prefix = ruleset === 'lynx' ? FALLBACK_LYNX_KEY_PREFIX : FALLBACK_KEY_PREFIX;
  return [
    { key: KEY_NUDGE, params: { role: roleName(role.system, role.end) } },
    { key: `${prefix}${roleId(role.system, role.end)}${LABEL_SUFFIX}` }
  ];
}

function topTileName(level: EditorMap, x: number, y: number): string {
  return t(ConfigRegistry.getTile(level.terrain[y][x]).i18nKey);
}

/** The status lines after an edit of the session's links. */
function editMessages(result: LinkEditResult, session: LinkSession, ruleset: Ruleset, placed: boolean): ToolMessage[] {
  const map = result.map;
  if (!map) return [];
  const params = {
    role: roleName(session.system, session.end),
    count: linkCountAt(map, session.system, session.end, session.x, session.y)
  };
  const head: ToolMessage = placed
    ? { key: KEY_PLACED, params: { ...params, partner: roleName(session.system, otherEnd(session.end)) } }
    : { key: result.action === 'unlinked' ? KEY_UNLINKED : KEY_LINKED, params };
  const messages: ToolMessage[] = [head];
  // Lynx frees the creature standing in the machine: there is no template to warn about.
  if (ruleset !== 'lynx' && result.emptyCloner && result.template) messages.push(emptyClonerMessage(result.template.type, result.template.dir));
  if (result.replaced && replacesLinks(session.system, ruleset)) messages.push({ key: KEY_REPLACED });
  return messages;
}

/**
 * A primary click on a cell while a session is open. Decision order:
 * (1) the source ends the session; (2) a device of the source's own role becomes the new source, no edit; (3) a device
 * of the partner role in plain view toggles the link (Lynx: links it, replacing the button's other link, or unlinks
 * an existing pair); (4) a hidden trap or clone device of the system is refused; (5) a free floor cell gets the
 * partner, placed and linked as one edit (`dir` is the facing of a launcher and of a default clone template);
 * (6) anything else is refused, naming what is there and what is expected. An existing device is never repainted.
 * A session whose source no longer holds its role ends first, saying so.
 */
export function sessionClick(
  level: EditorMap,
  session: LinkSession,
  cell: { x: number; y: number },
  dir: Direction,
  ruleset: Ruleset
): SessionClickResult {
  const role = roleName(session.system, session.end);
  if (level.cc3d || ruleset === 'cc3d') return { session: null, messages: [{ key: KEY_UNAVAILABLE }] };
  if (!sessionSourceHolds(level, session, ruleset)) return { session: null, messages: [{ key: KEY_SOURCE_GONE, params: { role } }] };
  if (!inGrid(level, cell.x, cell.y)) return { session, messages: [] };

  if (cell.x === session.x && cell.y === session.y) {
    const count = linkCountAt(level, session.system, session.end, session.x, session.y);
    return { session: null, messages: [{ key: KEY_DONE, params: { role, count } }] };
  }

  const here = sessionRoleAt(level, cell.x, cell.y, ruleset);
  // A signal gate holds both ends: it takes the wire of the session before it can replace the source. A launcher
  // or clone machine on top takes a wire from a signal output session the same way.
  const takesWire = session.system === 'signal' && holdsLinkEnd(level, 'signal', otherEnd(session.end), cell.x, cell.y);
  // A signal input session moves to another signal input (a launcher or clone machine reads as its own system first).
  const movesSignalInput =
    session.system === 'signal' && session.end === 'target' && !takesWire && holdsLinkEnd(level, 'signal', 'target', cell.x, cell.y);
  if (movesSignalInput || (here && !here.blocked && !takesWire && here.system === session.system && here.end === session.end)) {
    const next: LinkSession = { system: session.system, end: session.end, x: cell.x, y: cell.y };
    return { session: next, messages: sessionStartMessages(level, next, ruleset) };
  }

  // A shot launcher or clone machine reads as its own system first, yet a signal wire may end on it (an edge sink).
  if ((here && !here.blocked && here.system === session.system) || takesWire) {
    const button = session.end === 'button' ? session : cell;
    const target = session.end === 'button' ? cell : session;
    const linked = hasLink(level, session.system, button, target);
    const result =
      replacesLinks(session.system, ruleset) && !linked && session.system !== 'shot' && session.system !== 'signal'
        ? replaceButtonLink(level, session.system, button, target, dir)
        : toggleLink(level, session.system, button, target, dir);
    if (result.refusal === 'single_input') return { session, messages: [{ key: KEY_REFUSED_SINGLE_INPUT, params: { x: cell.x, y: cell.y } }] };
    if (result.refusal === 'cycle') return { session, messages: [{ key: KEY_REFUSED_CYCLE, params: { x: cell.x, y: cell.y } }] };
    return { ...(result.changed ? { map: result.map } : {}), session, messages: editMessages(result, session, ruleset, false) };
  }

  if (here && here.blocked && here.system === session.system) {
    return { session, messages: [{ key: KEY_REFUSED_HIDDEN, params: { role: roleName(here.system, here.end) } }] };
  }

  const partnerName = roleName(session.system, otherEnd(session.end));
  if (level.terrain[cell.y][cell.x] === FLOOR_TILE_ID && session.system !== 'signal') {
    if (underlayAt(level, cell.x, cell.y) !== undefined) {
      return { session, messages: [{ key: KEY_REFUSED_NOT_FREE, params: { partner: partnerName } }] };
    }
    const placed = placePartnerAndLink(level, session.system, session.end, session, cell, dir, replacesLinks(session.system, ruleset));
    if (placed.refused || !placed.changed) return { session, messages: [] };
    return { map: placed.map, session, messages: editMessages(placed, session, ruleset, true) };
  }

  return {
    session,
    messages: [{ key: session.system === 'signal' ? KEY_REFUSED_OTHER_SIGNAL : KEY_REFUSED_OTHER, params: { found: topTileName(level, cell.x, cell.y), expected: partnerName } }]
  };
}
