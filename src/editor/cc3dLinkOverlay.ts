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

import {
  type Cc3dColorGroup,
  type Cc3dLink,
  type Cc3dLinks,
  cc3dLinks,
  type LinkPoint
} from '../core/cc3d/cc3dLinks';
import type { Cc3dLevel } from '../core/cc3d/model';
import { EDITOR_CC3D_MAX_LINK_MESSAGES } from '../ui/uiConstants';
import type { ToolMessage } from './editorTools';

/**
 * What the link overlay of the CC3D editor draws for a cell, and what an edit changed in the links. Both
 * read cc3dLinks(), the same derivation the engine resolves its devices with.
 */

export type OverlayArrowKind = 'trap' | 'teleport' | 'clone' | 'template' | 'laser';

export interface OverlayArrow {
  kind: OverlayArrowKind;
  from: LinkPoint;
  to: LinkPoint;
}

export interface LinkOverlay {
  arrows: OverlayArrow[];
  /** Cells of the same colour group (toggles, hold plates and doors, golems) as the cell looked at. */
  highlights: LinkPoint[];
  /** The template mob a clone machine copies: it carries a badge. */
  badges: LinkPoint[];
}

const EMPTY_OVERLAY: LinkOverlay = { arrows: [], highlights: [], badges: [] };

function pointOfCell(index: number, width: number): LinkPoint {
  return { x: index % width, y: Math.floor(index / width) };
}

/** Context shared by the readers below: the grid width and the mobs. */
type LevelView = Pick<Cc3dLevel, 'width' | 'mobs'>;

/** Where a link's target stands: a cell index, or (when `mobTarget`) the cell of a mob. */
function targetPoint(view: LevelView, link: Cc3dLink, mobTarget: boolean): LinkPoint | null {
  if (link.to === null) return null;
  if (!mobTarget) return pointOfCell(link.to, view.width);
  const mob = view.mobs[link.to];
  return mob ? { x: mob.x, y: mob.y } : null;
}

interface LinkFamily {
  kind: OverlayArrowKind;
  links: readonly Cc3dLink[];
  mobTarget: boolean;
}

function families(links: Cc3dLinks): LinkFamily[] {
  return [
    { kind: 'trap', links: links.trapControls, mobTarget: false },
    { kind: 'teleport', links: links.teleports, mobTarget: false },
    { kind: 'clone', links: links.cloneSwitches, mobTarget: false },
    { kind: 'template', links: links.cloneMachines, mobTarget: true },
    { kind: 'laser', links: links.laserControllers, mobTarget: true }
  ];
}

function sameCell(a: LinkPoint, b: LinkPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function addUnique(list: LinkPoint[], point: LinkPoint): void {
  if (!list.some((existing) => sameCell(existing, point))) list.push(point);
}

/** The cells of a colour group that holds the cell, controls and targets alike (golem targets are mob indices). */
function groupCells(view: LevelView, group: Cc3dColorGroup, mobTargets: boolean): LinkPoint[] {
  const controls = group.controls.map((index) => pointOfCell(index, view.width));
  const targets = group.targets.flatMap((index): LinkPoint[] => {
    if (!mobTargets) return [pointOfCell(index, view.width)];
    const mob = view.mobs[index];
    return mob ? [{ x: mob.x, y: mob.y }] : [];
  });
  return [...controls, ...targets];
}

function groupsOf(links: Cc3dLinks): Array<{ group: Cc3dColorGroup; mobTargets: boolean }> {
  return [
    ...links.toggles.map((group) => ({ group, mobTargets: false })),
    ...links.holds.map((group) => ({ group, mobTargets: false })),
    { group: links.golems.blue, mobTargets: true },
    { group: links.golems.yellow, mobTargets: true }
  ];
}

/**
 * The arrows and highlights of the links a cell takes part in, as source or as target: a trap control
 * points at its trap (and a trap shows the controls that open it), a teleport at the cell an arrival
 * there would use, a clone switch at its machine and the machine at the template on it (badge), a laser
 * controller at its shooter; cells of a toggle, plate or golem colour group are highlighted together.
 * `links` may be passed when the caller already derived them.
 */
export function linkOverlayFor(level: Cc3dLevel, cell: LinkPoint, links: Cc3dLinks = cc3dLinks(level)): LinkOverlay {
  const { width } = level;
  if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= level.height) return EMPTY_OVERLAY;
  const here = cell.y * width + cell.x;
  const overlay: LinkOverlay = { arrows: [], highlights: [], badges: [] };
  const machinesSeen = new Set<number>();

  const addArrow = (kind: OverlayArrowKind, from: LinkPoint, to: LinkPoint): void => {
    if (!overlay.arrows.some((a) => a.kind === kind && sameCell(a.from, from) && sameCell(a.to, to))) {
      overlay.arrows.push({ kind, from, to });
    }
    if (kind === 'template') addUnique(overlay.badges, to);
  };

  for (const family of families(links)) {
    for (const link of family.links) {
      const to = targetPoint(level, link, family.mobTarget);
      const from = pointOfCell(link.from, width);
      const involved = link.from === here || (to !== null && sameCell(to, cell));
      if (!involved || to === null) continue;
      addArrow(family.kind, from, to);
      // Looking at a clone switch also shows what its machine copies, so the whole chain is visible.
      if (family.kind === 'clone') machinesSeen.add(link.to as number);
    }
  }
  for (const machine of machinesSeen) {
    const template = links.cloneMachines.find((link) => link.from === machine);
    const to = template ? targetPoint(level, template, true) : null;
    if (to) addArrow('template', pointOfCell(machine, width), to);
  }

  for (const { group, mobTargets } of groupsOf(links)) {
    const cells = groupCells(level, group, mobTargets);
    if (!cells.some((candidate) => sameCell(candidate, cell))) continue;
    for (const candidate of cells) if (!sameCell(candidate, cell)) addUnique(overlay.highlights, candidate);
  }
  return overlay;
}

/** One link whose target moved when the level was edited. */
export interface Cc3dLinkChange {
  /** Locale key family: trap, teleport, clone_switch or laser. */
  kind: 'trap' | 'teleport' | 'clone_switch' | 'laser';
  from: LinkPoint;
  /** Where the link points now, or null when it points nowhere. */
  to: LinkPoint | null;
  /** Where it pointed before, or null when it pointed nowhere. */
  was: LinkPoint | null;
}

const CHANGE_FAMILIES: ReadonlyArray<{ kind: Cc3dLinkChange['kind']; pick: (links: Cc3dLinks) => readonly Cc3dLink[]; mobTarget: boolean }> = [
  { kind: 'trap', pick: (links) => links.trapControls, mobTarget: false },
  { kind: 'teleport', pick: (links) => links.teleports, mobTarget: false },
  { kind: 'clone_switch', pick: (links) => links.cloneSwitches, mobTarget: false },
  { kind: 'laser', pick: (links) => links.laserControllers, mobTarget: true }
];

/**
 * The links that existed before an edit and after it (same source cell) but point somewhere else now.
 * A source that appeared or went away is not a changed link, nor is a template appearing on a machine.
 */
export function diffCc3dLinks(before: Cc3dLevel, after: Cc3dLevel): Cc3dLinkChange[] {
  if (before === after || before.width !== after.width || before.height !== after.height) return [];
  const linksBefore = cc3dLinks(before);
  const linksAfter = cc3dLinks(after);
  const changes: Cc3dLinkChange[] = [];
  for (const family of CHANGE_FAMILIES) {
    const afterBySource = new Map(family.pick(linksAfter).map((link) => [link.from, link]));
    for (const link of family.pick(linksBefore)) {
      const next = afterBySource.get(link.from);
      if (!next) continue;
      const was = targetPoint(before, link, family.mobTarget);
      const to = targetPoint(after, next, family.mobTarget);
      const same = was === to || (was !== null && to !== null && sameCell(was, to));
      if (!same) changes.push({ kind: family.kind, from: pointOfCell(link.from, before.width), to, was });
    }
  }
  return changes;
}

export const MESSAGE_CC3D_LINK_MORE = 'editor.cc3d.status.link_more';

const CHANGE_KEYS: Record<Cc3dLinkChange['kind'], { to: string; none: string }> = {
  trap: { to: 'editor.cc3d.status.link_trap', none: 'editor.cc3d.status.link_trap_none' },
  teleport: { to: 'editor.cc3d.status.link_teleport', none: 'editor.cc3d.status.link_teleport_none' },
  clone_switch: { to: 'editor.cc3d.status.link_clone', none: 'editor.cc3d.status.link_clone_none' },
  laser: { to: 'editor.cc3d.status.link_laser', none: 'editor.cc3d.status.link_laser_none' }
};

/**
 * The status messages for changed links: the first few spelled out, the rest counted. A message names
 * the source cell and, when there is one, the cell it points at now.
 */
export function describeLinkChanges(changes: readonly Cc3dLinkChange[]): ToolMessage[] {
  const shown = changes.slice(0, EDITOR_CC3D_MAX_LINK_MESSAGES).map((change): ToolMessage => {
    const keys = CHANGE_KEYS[change.kind];
    if (!change.to) return { key: keys.none, params: { x: change.from.x, y: change.from.y } };
    return { key: keys.to, params: { x: change.from.x, y: change.from.y, toX: change.to.x, toY: change.to.y } };
  });
  const rest = changes.length - shown.length;
  return rest > 0 ? [...shown, { key: MESSAGE_CC3D_LINK_MORE, params: { count: rest } }] : shown;
}
