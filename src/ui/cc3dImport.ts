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

import { CC3D_XML_EXTENSION, Cc3dImportError, decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import type { CompiledLevel } from '../core/types';
import { formatMegabytes, isImportSizeAllowed } from './importLimits';

/** i18n key of the message for a file over the size limit. */
const TOO_LARGE_KEY = 'app.packs.import_too_large.label';
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;

/** What the import needs of a browser File; a plain object serves in tests. */
export interface ImportableFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** How a selection of files is to be imported. */
export type ImportSelectionKind = 'cc3d' | 'single' | 'several' | 'mixed';

/** True for a level file of the cc3d ruleset. */
export function isCc3dFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CC3D_XML_EXTENSION);
}

/**
 * XML files import together as one pack; any other format imports one file
 * at a time, so several of them are refused (nothing is imported); a selection
 * that mixes XML with another format is refused too.
 */
export function classifyImportSelection(names: readonly string[]): ImportSelectionKind {
  const xmlCount = names.filter(isCc3dFileName).length;
  if (xmlCount === 0) return names.length > 1 ? 'several' : 'single';
  return xmlCount === names.length ? 'cc3d' : 'mixed';
}

export interface Cc3dSelectionResult {
  readonly levels: CompiledLevel[];
  /** Number of files that did not import (unreadable or over the size limit). */
  readonly skipped: number;
  /** Why the first of them failed; null when all imported. */
  readonly firstError: Cc3dImportError | null;
}

/**
 * Reads and decodes a selection of level files. Files over the size limit and
 * files that fail to decode are skipped and counted; the rest import.
 */
export async function importCc3dSelection(
  files: readonly ImportableFile[],
  maxBytes: number,
  packName: string
): Promise<Cc3dSelectionResult> {
  const readable: Array<{ name: string; bytes: ArrayBuffer }> = [];
  let firstError: Cc3dImportError | null = null;
  let skipped = 0;
  for (const file of files) {
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      skipped++;
      firstError ??= new Cc3dImportError(TOO_LARGE_KEY, { max: formatMegabytes(maxBytes) });
      continue;
    }
    readable.push({ name: file.name, bytes: await file.arrayBuffer() });
  }
  const decoded = decodeCc3dFiles(readable, packName);
  skipped += decoded.failures.length;
  firstError ??= decoded.failures[0]?.error ?? null;
  return { levels: decoded.levels, skipped, firstError };
}

/** Name of a pack made from one file: the file name without its extension. */
export function packNameFromFile(fileName: string): string {
  return fileName.replace(FILE_EXTENSION_PATTERN, '');
}
