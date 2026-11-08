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
import { BrushKind, CANOPY_BRUSH_ID, CELL_EDGE_BRUSH_ID } from './editorTools';

/** The final segment of a tile or entity name key, swapped for the description segments. */
const NAME_SEGMENT_SUFFIX = '.name';
/** What replaces the name segment: the description sits beside the name, under the same id. */
const DESCRIPTION_SEGMENT_SUFFIX = '.desc.label';
/** Description keys of the synthetic palette entries, which have no tile or entity definition. */
const PLAYER_START_DESCRIPTION_KEY = 'editor.palette.tools.player_start_desc.label';
const CELL_EDGE_DESCRIPTION_KEY = 'editor.palette.tools.cell_edge_desc.label';
const CANOPY_DESCRIPTION_KEY = 'editor.palette.tools.canopy_desc.label';

/**
 * The locale key that explains a palette entry (what it does and what it needs), or undefined for an entry
 * with no such key by construction. A tile or entity description sits beside its name: `tiles.hold_door_red_closed.name`
 * gives `tiles.hold_door_red_closed.desc.label`. Whether the locale holds the text is `paletteDescription`'s concern.
 */
export function descriptionKeyFor(kind: BrushKind, id: string): string | undefined {
  if (kind === 'player_start') return PLAYER_START_DESCRIPTION_KEY;
  if (kind === 'cell_edge') {
    if (id === CANOPY_BRUSH_ID) return CANOPY_DESCRIPTION_KEY;
    return id === CELL_EDGE_BRUSH_ID ? CELL_EDGE_DESCRIPTION_KEY : undefined;
  }
  const nameKey = kind === 'entity' ? ConfigRegistry.getEntityDef(id)?.i18nKey : ConfigRegistry.getTile(id)?.i18nKey;
  // getTile answers floor for an unknown id: only a name key that carries the id is the entry's own.
  if (!nameKey?.endsWith(`.${id}${NAME_SEGMENT_SUFFIX}`)) return undefined;
  return `${nameKey.slice(0, -NAME_SEGMENT_SUFFIX.length)}${DESCRIPTION_SEGMENT_SUFFIX}`;
}

/**
 * The translated description of a palette entry, or undefined when it has none: the entry has no description key,
 * or the translator returns the key itself because the locale lacks it (the fallback: no text, never a raw key).
 */
export function paletteDescription(kind: BrushKind, id: string, translate: (key: string) => string): string | undefined {
  const key = descriptionKeyFor(kind, id);
  if (key === undefined) return undefined;
  const text = translate(key);
  return text === key || text === '' ? undefined : text;
}

/** The entry name followed by its description, as the hover title and the status line show them. */
export function nameWithDescription(name: string, description: string | undefined): string {
  return description === undefined ? name : `${name}: ${description}`;
}
