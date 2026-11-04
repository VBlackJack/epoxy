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
import { EditorMap } from './editorDocument';
import { ToolMessage } from './editorTools';

const COORDS_KEY = 'editor.palette.status.coords';
const NAME_KEY = 'editor.cell_speech.name.label';
const OUTSIDE_KEY = 'editor.cell_speech.outside.label';
const ITEM_KEY = 'editor.cell_speech.item.label';
const ENTITY_KEY = 'editor.cell_speech.entity.label';
const PLAYER_KEY = 'editor.cell_speech.player.label';
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

/** Only creatures that move have a facing worth speaking; blocks and mirrors stay put. */
function movesOnItsOwn(id: string): boolean {
  const def = ConfigRegistry.getEntityDef(id);
  return Boolean(def?.movementPattern) || def?.steeredBy !== undefined;
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
    const item = map.items[y]?.[x];
    if (item) parts.push({ key: ITEM_KEY, params: { name: tileName(item) } });
    for (const entity of map.entities) {
      if (entity.x === x && entity.y === y) {
        const name = entityName(entity.type);
        parts.push(
          movesOnItsOwn(entity.type) ? { key: ENTITY_KEY, params: { name, side: sideOf(entity.dir) } } : literal(name)
        );
      }
    }
  }
  if (map.playerStart.x === x && map.playerStart.y === y) {
    parts.push({ key: PLAYER_KEY, params: { side: sideOf(map.playerStart.dir) } });
  }
  return parts;
}
