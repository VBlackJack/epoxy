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
import { convertCc3dLevel } from '../core/cc3d/cc3dToEpoxy';
import { classifyLevel } from '../core/cc3d/epoxyCoverage';
import { LevelValidator } from '../core/LevelValidator';
import type { CompiledLevel } from '../core/types';
import { t } from '../i18n/I18nManager';
import { isCc2FileName } from './cc2Import';
import { formatMegabytes, isImportSizeAllowed } from './importLimits';

/** i18n key of the message for a file over the size limit. */
const TOO_LARGE_KEY = 'app.packs.import_too_large.label';
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;
/** At most this many level numbers are named in one line of the import report; the rest is counted. */
const REPORT_LEVELS_LISTED_MAX = 12;
const REPORT_LEVEL_SEPARATOR = ', ';

/** What the import needs of a browser File; a plain object serves in tests. */
export interface ImportableFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** How a selection of files is to be imported. */
export type ImportSelectionKind = 'cc3d' | 'cc2' | 'diggy' | 'single' | 'several' | 'mixed';

/** True for a level file of the cc3d ruleset. */
export function isCc3dFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CC3D_XML_EXTENSION);
}

/**
 * XML files import together as one pack, so do CC2 level and script files (.c2m, .c2g), and multiple Diggy floor JSON files
 * (`floors_*.json` / `*.diggy.json`) import together as one pack; any other
 * format imports one file at a time, so several of them or a mixed selection
 * are refused (nothing is imported).
 */
export function classifyImportSelection(names: readonly string[]): ImportSelectionKind {
  const xmlCount = names.filter(isCc3dFileName).length;
  if (xmlCount > 0) return xmlCount === names.length ? 'cc3d' : 'mixed';
  const cc2Count = names.filter(isCc2FileName).length;
  if (cc2Count > 0) return cc2Count === names.length ? 'cc2' : 'mixed';
  if (names.length <= 1) return 'single';
  const diggyCount = names.filter(isDiggyFloorFileName).length;
  if (diggyCount === names.length) return 'diggy';
  return diggyCount > 0 ? 'mixed' : 'several';
}

/** What the import made of the levels of a CC3D selection, by level label (the map id of the file, else the level number). Nothing is dropped without being named here. */
export interface Cc3dImportSummary {
  /** Levels imported as Epoxy levels. */
  readonly imported: number;
  readonly exact: number;
  readonly approx: number;
  /** Imported levels the converter marks lost: they hold mechanics Epoxy cannot play. */
  readonly lostLevels: readonly string[];
  /** Imported levels whose converted form holds a validator error. */
  readonly invalidLevels: readonly string[];
  /** Levels whose conversion threw: reported and left out of the pack. */
  readonly failedLevels: readonly string[];
}

export interface Cc3dSelectionResult {
  readonly levels: CompiledLevel[];
  readonly summary: Cc3dImportSummary;
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
  const converted = convertImportedLevels(decoded.levels);
  return { levels: converted.levels, summary: converted.summary, skipped, firstError };
}

/**
 * Turns the decoded CC3D levels into native Epoxy levels, which the Epoxy engine plays with all its aids. The converted
 * level keeps the CC3D level it came from in `cc3dSource`, so it can be converted again when the converter improves.
 * A level the converter marks lost, or the validator flags, is still imported and named in the summary; a level whose
 * conversion throws is named as failed and left out, and the others go on.
 */
export function convertImportedLevels(decoded: readonly CompiledLevel[]): { levels: CompiledLevel[]; summary: Cc3dImportSummary } {
  const levels: CompiledLevel[] = [];
  const lostLevels: string[] = [];
  const invalidLevels: string[] = [];
  const failedLevels: string[] = [];
  let exact = 0;
  let approx = 0;
  for (const source of decoded) {
    const cc3d = source.cc3d;
    if (!cc3d) continue;
    const label = cc3d.mapId ?? String(source.number);
    try {
      const verdict = classifyLevel(cc3d).verdict;
      const converted = convertCc3dLevel(source).level;
      const hasErrors = LevelValidator.validate(converted).issues.some((issue) => issue.severity === 'error');
      levels.push({ ...converted, cc3dSource: cc3d });
      if (verdict === 'exact') exact++;
      else if (verdict === 'approx') approx++;
      else lostLevels.push(label);
      if (hasErrors) invalidLevels.push(label);
    } catch {
      failedLevels.push(label);
    }
  }
  return { levels, summary: { imported: levels.length, exact, approx, lostLevels, invalidLevels, failedLevels } };
}

function levelNumbersText(numbers: readonly string[]): string {
  const listed = numbers.slice(0, REPORT_LEVELS_LISTED_MAX).join(REPORT_LEVEL_SEPARATOR);
  const more = numbers.length - REPORT_LEVELS_LISTED_MAX;
  return more > 0 ? t('cc3d.import.report.more.label', { levels: listed, count: more }) : listed;
}

/** The lines of the import report: the counts first, then one line per kind of level that needs a word. */
export function cc3dImportReportLines(summary: Cc3dImportSummary): string[] {
  const lines = [
    t('cc3d.import.report.summary.label', {
      count: summary.imported,
      exact: summary.exact,
      approx: summary.approx,
      lost: summary.lostLevels.length
    })
  ];
  if (summary.lostLevels.length > 0) lines.push(t('cc3d.import.report.lost.label', { levels: levelNumbersText(summary.lostLevels) }));
  if (summary.invalidLevels.length > 0) lines.push(t('cc3d.import.report.invalid.label', { levels: levelNumbersText(summary.invalidLevels) }));
  if (summary.failedLevels.length > 0) lines.push(t('cc3d.import.report.failed.label', { levels: levelNumbersText(summary.failedLevels) }));
  return lines;
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
