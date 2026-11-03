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

import type { Cc3dLevel } from '../core/cc3d/model';
import { DEFAULT_WIN_RULE } from '../core/coreConstants';
import type { CompiledLevel } from '../core/types';
import { cloneMap, displayLayersOf, type EditorDocument } from './editorDocument';

/**
 * Conversion between a stored level and the document the editor holds. Pure: the editor supplies the
 * texts it resolved and the values it chose for the export, and these functions only move data.
 */

/** The title and hint shown in the form when a level was opened (already translated). */
export interface DocumentTexts {
  title: string;
  hint: string;
}

/** What an export needs from the editor besides the document. */
export interface LevelExportContext {
  id: string;
  number: number;
  /** The password to store, already resolved. */
  password: string;
  /** Title used when the form's title is empty. */
  fallbackTitle: string;
}

/** Fish an exit must be preceded by: the importer's count, `fish` items only. */
export function cc3dFishCount(cc3d: Pick<Cc3dLevel, 'cells'>): number {
  return cc3d.cells.reduce((count, cell) => (cell.item?.kind === 'fish' ? count + 1 : count), 0);
}

/**
 * The editor document of a level. A CC3D level is held as its cc3d data (shared by reference, it is never
 * mutated) and its display layers are derived from it; any other level is deep-copied.
 */
export function documentFromLevel(level: CompiledLevel, texts: DocumentTexts): EditorDocument {
  const map = level.cc3d ? { ...cloneMap(level), ...displayLayersOf(level.cc3d), cc3d: level.cc3d } : cloneMap(level);
  return {
    ...map,
    title: texts.title,
    hint: texts.hint,
    author: level.author ?? '',
    password: level.password,
    timeLimitSeconds: level.timeLimitSeconds,
    chipsRequired: level.chipsRequired,
    winRule: level.winRule ?? DEFAULT_WIN_RULE,
    ruleset: level.ruleset
  };
}

/**
 * The level an editor document stands for. A CC3D level keeps its cc3d data (map id included), has its
 * display layers derived from it and its required fish recomputed from the cells; any other level is
 * exported exactly as before.
 */
export function levelFromDocument(doc: EditorDocument, context: LevelExportContext): CompiledLevel {
  const level: CompiledLevel = {
    id: context.id,
    ...(doc.winRule === DEFAULT_WIN_RULE ? {} : { winRule: doc.winRule }),
    ...(doc.ruleset ? { ruleset: doc.ruleset } : {}),
    number: context.number,
    customTitle: doc.title || context.fallbackTitle,
    customHint: doc.hint,
    ...(doc.author ? { author: doc.author } : {}),
    password: context.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    ...cloneMap(doc)
  };
  if (doc.cc3d) {
    Object.assign(level, displayLayersOf(doc.cc3d), { chipsRequired: cc3dFishCount(doc.cc3d) });
  }
  return level;
}
