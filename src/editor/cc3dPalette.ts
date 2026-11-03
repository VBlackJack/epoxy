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

import { REFLECTING_FACES } from '../core/cc3d/cc3dLasers';
import { displayItemId, displayMobId, displayTerrainId } from '../core/cc3d/display';
import {
  CC3D_BLOCKER_KINDS,
  CC3D_DEVICE_KINDS,
  CC3D_FLOOR_LIKE_KINDS,
  CC3D_ITEM_KINDS,
  CC3D_MOB_KINDS,
  type Cc3dColor,
  type Cc3dItem,
  type Cc3dMob,
  type Cc3dTerrain,
  type Cc3dTerrainKind
} from '../core/cc3d/model';
import type { Direction } from '../core/types';

/**
 * The palette of the CC3D editor, as data: one entry per kind a level file can hold, with the attributes
 * the kind needs (colour, direction, corner, mirror). Pure: the editor draws the entries, resolves their
 * names and icons from the display ids, and hands the chosen attributes back to build what is placed.
 */

export type Cc3dCategoryId = 'floors' | 'devices' | 'blockers' | 'items' | 'mobs' | 'player';

export interface Cc3dCategory {
  id: Cc3dCategoryId;
  labelKey: string;
}

export const CC3D_CATEGORIES: readonly Cc3dCategory[] = [
  { id: 'floors', labelKey: 'editor.cc3d.category.floors' },
  { id: 'devices', labelKey: 'editor.cc3d.category.devices' },
  { id: 'blockers', labelKey: 'editor.cc3d.category.blockers' },
  { id: 'items', labelKey: 'editor.cc3d.category.items' },
  { id: 'mobs', labelKey: 'editor.cc3d.category.mobs' },
  { id: 'player', labelKey: 'editor.cc3d.category.player' }
];

/** What an entry asks the player to choose besides the entry itself. */
export type Cc3dAttribute = 'color' | 'dir' | 'corner' | 'mirror';

/** What an entry places: a terrain layer, an item, a mob, the player start, or a thin wall side. */
export type Cc3dEntryAction = 'layer' | 'item' | 'mob' | 'player' | 'panel';

export interface Cc3dPaletteEntry {
  /** Unique, stable: `<action>:<kind>`, with `:open` for the open variant of a toggle door. */
  id: string;
  category: Cc3dCategoryId;
  action: Cc3dEntryAction;
  /** The model kind; `player` and `panel` for the two entries that have none. */
  kind: string;
  attributes: readonly Cc3dAttribute[];
  /** The open variant of a toggle door (its initial state). */
  open?: boolean;
  /** Locale key of the name, for the kinds whose display id shares its name with another kind. */
  labelKey?: string;
}

/** The attributes the player picked, shared by every entry that uses them. */
export interface Cc3dBrushAttributes {
  color: Cc3dColor;
  corner: readonly [Direction, Direction];
  /** The stored name of a reflector, for example "LU". */
  mirror: string;
}

export const CC3D_PLAYER_ENTRY_KIND = 'player';
export const CC3D_PANEL_ENTRY_KIND = 'panel';

/** The four corners an ice corner can close, as its two closed sides. */
export const CC3D_CORNERS: ReadonlyArray<readonly [Direction, Direction]> = [
  ['N', 'E'],
  ['S', 'E'],
  ['S', 'W'],
  ['N', 'W']
];

/** The mirror names a reflector can take. */
export const CC3D_MIRRORS: readonly string[] = Object.keys(REFLECTING_FACES);

export const DEFAULT_CC3D_ATTRIBUTES: Cc3dBrushAttributes = {
  color: 'red',
  corner: CC3D_CORNERS[0],
  mirror: CC3D_MIRRORS[0]
};

const COLORED_LAYERS: readonly string[] = ['door', 'toggle_door', 'toggle_control', 'hold_door', 'plate'];
const DIRECTED_LAYERS: readonly string[] = ['force', 'clone_machine'];
/** Kinds whose display id is another kind's, and the thin wall: a locale key names them. */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'item:fish': 'editor.cc3d.kind.fish',
  'mob:snappy': 'editor.cc3d.kind.snappy',
  'mob:nibble': 'editor.cc3d.kind.nibble',
  'panel:panel': 'editor.cc3d.kind.panel'
};
const PLAYER_ICON_ID = 'player_start';
const PLAYER_LABEL_KEY = 'editor.palette.tools.player_start';
const PLAIN_FLOOR: Cc3dTerrain = { kind: 'floor' };

function layerAttributes(kind: Cc3dTerrainKind): Cc3dAttribute[] {
  const found: Cc3dAttribute[] = [];
  if (COLORED_LAYERS.includes(kind)) found.push('color');
  if (DIRECTED_LAYERS.includes(kind)) found.push('dir');
  if (kind === 'ice_corner') found.push('corner');
  return found;
}

function layerEntries(category: Cc3dCategoryId, kinds: readonly Cc3dTerrainKind[]): Cc3dPaletteEntry[] {
  const entries: Cc3dPaletteEntry[] = [];
  for (const kind of kinds) {
    const base: Cc3dPaletteEntry = { id: `layer:${kind}`, category, action: 'layer', kind, attributes: layerAttributes(kind) };
    entries.push(base);
    // A toggle door starts open or closed: two entries make the initial state a visible choice.
    if (kind === 'toggle_door') entries.push({ ...base, id: `layer:${kind}:open`, open: true });
  }
  return entries;
}

function withLabel(entry: Cc3dPaletteEntry): Cc3dPaletteEntry {
  const labelKey = LABEL_OVERRIDES[`${entry.action}:${entry.kind}`];
  return labelKey ? { ...entry, labelKey } : entry;
}

function mobEntry(kind: Cc3dMob['kind']): Cc3dPaletteEntry {
  const attributes: Cc3dAttribute[] = ['dir'];
  if (kind === 'block_color') attributes.push('color');
  if (kind === 'reflector') attributes.push('mirror');
  return { id: `mob:${kind}`, category: 'mobs', action: 'mob', kind, attributes };
}

function itemEntry(kind: Cc3dItem['kind']): Cc3dPaletteEntry {
  return { id: `item:${kind}`, category: 'items', action: 'item', kind, attributes: kind === 'key' ? ['color'] : [] };
}

function buildPalette(): Cc3dPaletteEntry[] {
  const entries: Cc3dPaletteEntry[] = [
    ...layerEntries('floors', CC3D_FLOOR_LIKE_KINDS),
    ...layerEntries('devices', CC3D_DEVICE_KINDS),
    ...layerEntries('blockers', CC3D_BLOCKER_KINDS),
    { id: `panel:${CC3D_PANEL_ENTRY_KIND}`, category: 'blockers', action: 'panel', kind: CC3D_PANEL_ENTRY_KIND, attributes: ['dir'] },
    ...CC3D_ITEM_KINDS.map(itemEntry),
    ...CC3D_MOB_KINDS.map(mobEntry),
    {
      id: `player:${CC3D_PLAYER_ENTRY_KIND}`,
      category: 'player',
      action: 'player',
      kind: CC3D_PLAYER_ENTRY_KIND,
      attributes: ['dir'],
      labelKey: PLAYER_LABEL_KEY
    }
  ];
  return entries.map(withLabel);
}

/** Every entry of the palette, in display order. */
export const CC3D_PALETTE: readonly Cc3dPaletteEntry[] = buildPalette();

/** The entries of one category, in display order. */
export function cc3dEntriesOf(category: Cc3dCategoryId): Cc3dPaletteEntry[] {
  return CC3D_PALETTE.filter((entry) => entry.category === category);
}

/** The entry with this id, or undefined. */
export function findCc3dEntry(id: string): Cc3dPaletteEntry | undefined {
  return CC3D_PALETTE.find((entry) => entry.id === id);
}

/** The id of the entry that places this terrain layer. */
export function entryIdOfLayer(layer: Cc3dTerrain): string {
  return `layer:${layer.kind}${layer.kind === 'toggle_door' && layer.open ? ':open' : ''}`;
}

export function needsAttribute(entry: Cc3dPaletteEntry, attribute: Cc3dAttribute): boolean {
  return entry.attributes.includes(attribute);
}

/** The terrain layer a `layer` entry places with these attributes; cc3dEdits cleans it to what its kind uses. */
export function layerOf(entry: Cc3dPaletteEntry, attrs: Cc3dBrushAttributes, dir: Direction): Cc3dTerrain {
  const layer: Cc3dTerrain = { kind: entry.kind as Cc3dTerrainKind };
  if (needsAttribute(entry, 'color')) layer.color = attrs.color;
  if (needsAttribute(entry, 'dir')) layer.dir = dir;
  if (needsAttribute(entry, 'corner')) layer.corner = [attrs.corner[0], attrs.corner[1]];
  if (entry.open !== undefined) layer.open = entry.open;
  return layer;
}

/** The item an `item` entry places. */
export function itemOf(entry: Cc3dPaletteEntry, attrs: Cc3dBrushAttributes): Cc3dItem {
  const kind = entry.kind as Cc3dItem['kind'];
  return needsAttribute(entry, 'color') ? { kind, color: attrs.color } : { kind };
}

/** The mob a `mob` entry places at a cell, facing `dir`. */
export function mobOf(entry: Cc3dPaletteEntry, attrs: Cc3dBrushAttributes, dir: Direction, x: number, y: number): Cc3dMob {
  const mob: Cc3dMob = { kind: entry.kind as Cc3dMob['kind'], x, y, dir };
  if (needsAttribute(entry, 'color')) mob.color = attrs.color;
  if (needsAttribute(entry, 'mirror')) mob.mirror = attrs.mirror;
  return mob;
}

/** The icon family and display id that show an entry. */
export interface Cc3dEntryDisplay {
  kind: 'tile' | 'item' | 'entity' | 'player';
  id: string;
}

/** How an entry looks, as the display id the renderer draws: the ids the level itself is drawn with. */
export function entryDisplay(entry: Cc3dPaletteEntry, attrs: Cc3dBrushAttributes, dir: Direction): Cc3dEntryDisplay {
  switch (entry.action) {
    case 'layer':
      return { kind: 'tile', id: displayTerrainId({ terrain: [layerOf(entry, attrs, dir)], panels: [], item: null }) };
    case 'panel':
      return { kind: 'tile', id: displayTerrainId({ terrain: [PLAIN_FLOOR], panels: [dir], item: null }) };
    case 'item':
      return { kind: 'item', id: displayItemId(itemOf(entry, attrs)) ?? '' };
    case 'mob':
      return { kind: 'entity', id: displayMobId(mobOf(entry, attrs, dir, 0, 0)) };
    case 'player':
      return { kind: 'player', id: PLAYER_ICON_ID };
  }
}
