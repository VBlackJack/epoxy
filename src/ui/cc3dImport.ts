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
import { decodeDiggyFiles, isDiggyFloorFileName } from '../formats/DiggyCodec';
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
export type ImportSelectionKind = 'cc3d' | 'diggy' | 'single' | 'several' | 'mixed';

/** True for a level file of the cc3d ruleset. */
export function isCc3dFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CC3D_XML_EXTENSION);
}

/**
 * XML files import together as one pack, and multiple Diggy floor JSON files
 * (`floors_*.json` / `*.diggy.json`) import together as one pack; any other
 * format imports one file at a time, so several of them or a mixed selection
 * are refused (nothing is imported).
 */
export function classifyImportSelection(names: readonly string[]): ImportSelectionKind {
  const xmlCount = names.filter(isCc3dFileName).length;
  if (xmlCount > 0) return xmlCount === names.length ? 'cc3d' : 'mixed';
  if (names.length <= 1) return 'single';
  const diggyCount = names.filter(isDiggyFloorFileName).length;
  if (diggyCount === names.length) return 'diggy';
  return diggyCount > 0 ? 'mixed' : 'several';
}

export interface Cc3dSelectionResult {
  readonly levels: CompiledLevel[];
  /** Number of files that did not import (unreadable or over the size limit). */
  readonly skipped: number;
  /** Why the first of them failed; null when all imported. */
  readonly firstError: Cc3dImportError | null;
}

export interface DiggySelectionResult {
  readonly levels: CompiledLevel[];
  /** Number of files or floors that did not import (unreadable, oversized, or unsolvable). */
  readonly skipped: number;
  /** Formatted max megabytes when a file exceeded the size limit, else null. */
  readonly tooLargeMaxMb: string | null;
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

/**
 * Reads and decodes a selection of Diggy floor JSON files into one pack.
 */
export async function importDiggySelection(
  files: readonly ImportableFile[],
  maxBytes: number,
  packName: string
): Promise<DiggySelectionResult> {
  const readable: Array<{ name: string; text: string }> = [];
  let tooLargeMaxMb: string | null = null;
  let skipped = 0;
  const decoder = new TextDecoder('utf-8');
  for (const file of files) {
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      skipped++;
      tooLargeMaxMb ??= formatMegabytes(maxBytes);
      continue;
    }
    readable.push({ name: file.name, text: decoder.decode(await file.arrayBuffer()) });
  }
  const decoded = decodeDiggyFiles(readable, packName);
  skipped += decoded.skipped.length;
  return { levels: decoded.levels, skipped, tooLargeMaxMb };
}

/** Name of a pack made from one file: the file name without its extension. */
export function packNameFromFile(fileName: string): string {
  return fileName.replace(FILE_EXTENSION_PATTERN, '');
}
