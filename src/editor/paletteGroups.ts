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

import { BLOCK_TARGET_TILE_ID, channelOfButtonAction, FIRE_LAUNCHERS_ACTION } from '../core/coreConstants';
import type { EntityDefinition, TileDefinition } from '../core/types';

/** The sub-headings of the Mechanisms tab, in display order. */
export type MechanismGroupId = 'buttons' | 'teleports' | 'lasers' | 'colour' | 'blocks' | 'toggles' | 'rails' | 'other';

export interface MechanismGroup {
  id: MechanismGroupId;
  /** i18n key of the heading. */
  labelKey: string;
}

/** The groups of the Mechanisms tab, top to bottom. */
export const MECHANISM_GROUPS: readonly MechanismGroup[] = [
  { id: 'buttons', labelKey: 'editor.palette.group.buttons.label' },
  { id: 'teleports', labelKey: 'editor.palette.group.teleports.label' },
  { id: 'lasers', labelKey: 'editor.palette.group.lasers.label' },
  { id: 'colour', labelKey: 'editor.palette.group.colour.label' },
  { id: 'blocks', labelKey: 'editor.palette.group.blocks.label' },
  { id: 'toggles', labelKey: 'editor.palette.group.toggles.label' },
  { id: 'rails', labelKey: 'editor.palette.group.rails.label' }
];

/** The heading of the entries no rule places, shown only when such entries exist. */
export const OTHER_GROUP: MechanismGroup = { id: 'other', labelKey: 'editor.palette.group.other.label' };

export interface GroupedEntry<T> {
  group: MechanismGroupId | null;
  item: T;
}

/** The sections to show, in order: the known groups with members, then Other when an entry has no group. */
export function arrangeMechanismSections<T>(entries: readonly GroupedEntry<T>[]): Array<{ group: MechanismGroup; items: T[] }> {
  const sections: Array<{ group: MechanismGroup; items: T[] }> = [];
  for (const group of [...MECHANISM_GROUPS, OTHER_GROUP]) {
    const items = entries
      .filter((entry) => (group.id === OTHER_GROUP.id ? entry.group === null || entry.group === OTHER_GROUP.id : entry.group === group.id))
      .map((entry) => entry.item);
    if (items.length > 0) sections.push({ group, items });
  }
  return sections;
}

/**
 * The group of a Mechanisms tile, read from the fields the tile config declares so that a new tile
 * lands in a group by itself. The first matching rule wins (a coloured teleporter is a teleporter,
 * a laser gate is a laser part). Null when no rule matches.
 */
export function tileMechanismGroup(tile: TileDefinition): MechanismGroupId | null {
  // A dark relay pad is no teleporter yet, but it sits with the pads it will join once lit.
  if (tile.isTeleporter || tile.relayPad !== undefined) return 'teleports';
  // A shot trigger fires launchers: it sits with them, not with the buttons.
  if (tile.buttonAction === FIRE_LAUNCHERS_ACTION) return 'lasers';
  // A colour toggle button sits with the walls of its channel; the plain toggle button stays with the buttons.
  if (channelOfButtonAction(tile.buttonAction) !== undefined) return 'colour';
  if (tile.buttonAction || tile.isTrap || tile.isCloneMachine) return 'buttons';
  if (tile.laserEmitter || tile.laserReceiverGroup || tile.laserGateGroup || tile.shotLauncher) return 'lasers';
  if (tile.plateColor || tile.holdDoorColor || tile.toggleChannel || tile.floatingBlockColor) return 'colour';
  // A rail switch toggles like a wall, but it sits with the rest of the rails.
  if (tile.railSides !== undefined || tile.railJunction === true) return 'rails';
  if (tile.togglesTo || tile.flameTogglesTo || tile.wireTogglesTo || tile.swivelTurns || tile.transmogrifies || tile.facingTurn !== undefined) return 'toggles';
  if (tile.signalSource || tile.signalGate) return 'toggles';
  if (tile.id === BLOCK_TARGET_TILE_ID) return 'blocks';
  return null;
}

/** The group of a Mechanisms entity: mirrors with the lasers, colour blocks with the channels, other blocks, turrets and arrow blocks together. */
export function entityMechanismGroup(entity: EntityDefinition): MechanismGroupId | null {
  if (entity.mirrorAxis) return 'lasers';
  if (entity.turretBeam || entity.pushArrows) return 'blocks';
  if (entity.plateColor) return 'colour';
  if (entity.kind === 'block') return 'blocks';
  return null;
}
