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
import { Direction } from '../core/types';
import { t } from '../i18n/I18nManager';
import { closedSidesAt } from './editorCellEdges';
import { EditorMap } from './editorDocument';
import { holdsShotLauncher, holdsShotTrigger, launcherCountAt, triggerCountAt } from './editorLauncherLinks';
import { entityHasFacing } from './entityFacing';
import { underlayAt } from './editorUnderlays';
import type { ToolMessage } from './editorTools';
import type { ClonerTemplateChange } from './mapEdits';

const COORDS_KEY = 'editor.palette.status.coords';
const NAME_KEY = 'editor.cell_speech.name.label';
const OUTSIDE_KEY = 'editor.cell_speech.outside.label';
const ITEM_KEY = 'editor.cell_speech.item.label';
const ENTITY_KEY = 'editor.cell_speech.entity.label';
const UNDERLAY_KEY = 'editor.cell_speech.underlay.label';
const EDGES_KEY = 'editor.cell_speech.edges.label';
const FIRES_KEY = 'editor.cell_speech.fires.label';
const FIRED_BY_KEY = 'editor.cell_speech.fired_by.label';
const CLONER_KEY = 'editor.cell_speech.cloner.label';
const CLONER_TEMPLATE_KEY = 'editor.layout.status.cloner_template.label';
const CLONERS_TEMPLATE_KEY = 'editor.layout.status.cloners_template.label';
const EMPTY_CLONER_KEY = 'editor.layout.status.wire_empty_cloner.label';
const PLAYER_KEY = 'editor.cell_speech.player.label';
const SIDE_LIST_SEPARATOR_KEY = 'editor.cell_speech.list_separator.label';
const SIDE_KEYS: Record<Direction, string> = {
  N: 'editor.cell_speech.side.n.label',
  E: 'editor.cell_speech.side.e.label',
  S: 'editor.cell_speech.side.s.label',
  W: 'editor.cell_speech.side.w.label'
};

/** What a screen reader is told about a cell: the coordinates, then what it holds from the ground up. */
export interface CellDescriptionInput {
  map: EditorMap;
  x: number;
  y: number;
  /**
   * CC3D levels: the names of the stack, bottom first (the same names as the layers list). When present they
   * replace the Epoxy terrain, item and creature lookups.
   */
  cc3dNames?: readonly string[];
}

const literal = (name: string): ToolMessage => ({ key: NAME_KEY, params: { name } });

function sideOf(dir: Direction): string {
  return t(SIDE_KEYS[dir]);
}

/** The display name of a tile id: its own locale key (an unknown id resolves to the floor). */
function tileMessage(id: string): ToolMessage {
  return { key: ConfigRegistry.getTile(id).i18nKey };
}

function tileName(id: string): string {
  return t(ConfigRegistry.getTile(id).i18nKey);
}

function entityName(id: string): string {
  const definition = ConfigRegistry.getEntityDef(id) ?? ConfigRegistry.getTile(id);
  return t(definition.i18nKey);
}

/** The name of an entity type, as the palette shows it. */
export function entityDisplayName(id: string): string {
  return entityName(id);
}

/** The name of a side, as it is spoken. */
export function sideDisplayName(dir: Direction): string {
  return sideOf(dir);
}

/** The status line for a clone machine whose template followed the creature put on it. */
export function clonerTemplateMessage(change: ClonerTemplateChange): ToolMessage {
  return {
    key: CLONER_TEMPLATE_KEY,
    params: { x: change.x, y: change.y, name: entityName(change.type), side: sideOf(change.dir) }
  };
}

/** The status line for several clone machines that now copy the same creature (a fill). */
export function clonersTemplateMessage(count: number, type: string, dir: Direction): ToolMessage {
  return { key: CLONERS_TEMPLATE_KEY, params: { count, name: entityName(type), side: sideOf(dir) } };
}

/** The warning for a clone wire drawn to a clone machine with no creature: the link uses the default template. */
export function emptyClonerMessage(type: string, dir: Direction): ToolMessage {
  return { key: EMPTY_CLONER_KEY, params: { name: entityName(type), side: sideOf(dir) } };
}

/** The parts of a spoken cell description as locale keys; the first is always the coordinates. */
export function describeEditorCell(input: CellDescriptionInput): ToolMessage[] {
  const { map, x, y, cc3dNames } = input;
  const parts: ToolMessage[] = [{ key: COORDS_KEY, params: { x, y } }];
  const row = map.terrain[y];
  if (!row || x < 0 || x >= row.length) {
    parts.push({ key: OUTSIDE_KEY });
    return parts;
  }
  if (cc3dNames) {
    for (const name of cc3dNames) parts.push(literal(name));
  } else {
    parts.push(tileMessage(row[x]));
    const hidden = underlayAt(map, x, y);
    if (hidden !== undefined) parts.push({ key: UNDERLAY_KEY, params: { name: tileName(hidden) } });
    // A trigger says how many launchers it fires, a launcher how many triggers fire it, whether in plain view or hidden.
    if (holdsShotTrigger(map, x, y)) parts.push({ key: FIRES_KEY, params: { count: launcherCountAt(map, x, y) } });
    if (holdsShotLauncher(map, x, y)) parts.push({ key: FIRED_BY_KEY, params: { count: triggerCountAt(map, x, y) } });
    const item = map.items[y]?.[x];
    if (item) parts.push({ key: ITEM_KEY, params: { name: tileName(item) } });
    for (const entity of map.entities) {
      if (entity.x === x && entity.y === y) {
        const name = entityName(entity.type);
        parts.push(
          entityHasFacing(entity.type) ? { key: ENTITY_KEY, params: { name, side: sideOf(entity.dir) } } : literal(name)
        );
      }
    }
    // A clone machine says what it clones: the template its link stores, which is what the engine spawns.
    const link = map.cloneLinks.find((l) => l.clonerX === x && l.clonerY === y);
    // It is spoken only when it differs from the creature standing on the machine (that one was just spoken).
    if (link) {
      const standing = map.entities.find((e) => e.x === x && e.y === y);
      const differs =
        !standing ||
        standing.type !== link.templateType ||
        (entityHasFacing(link.templateType) && standing.dir !== link.templateDir);
      if (differs) parts.push({ key: CLONER_KEY, params: { name: entityName(link.templateType), side: sideOf(link.templateDir) } });
    }
    // The line between two cells is one wall: the neighbours' matching walls are spoken as the drawing shows them.
    const closed = closedSidesAt(map, x, y);
    if (closed.length > 0) parts.push({ key: EDGES_KEY, params: { sides: closed.map(sideOf).join(t(SIDE_LIST_SEPARATOR_KEY)) } });
  }
  if (map.playerStart.x === x && map.playerStart.y === y) {
    parts.push({ key: PLAYER_KEY, params: { side: sideOf(map.playerStart.dir) } });
  }
  return parts;
}
