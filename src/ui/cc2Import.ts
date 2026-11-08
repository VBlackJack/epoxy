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

import { CC2_LEVEL_EXTENSION, CC2_SCRIPT_EXTENSION } from '../config/constants';
import type { Cc2CoverageVerdict, CompiledLevel } from '../core/types';
import { C2gScript, createC2gResolver, parseC2gBytes } from '../formats/C2gScript';
import { decodeC2m } from '../formats/C2mCodec';
import { convertCc2File } from '../formats/cc2ToEpoxy';
import type { Cc2ConversionReport } from '../formats/cc2ToEpoxy';
import { sha256OfBytes } from '../storage/cc2Sources';
import type { Cc2SourceRecord } from '../storage/Cc2SourceStorage';
import type { ImportableFile } from './cc3dImport';
import { isImportSizeAllowed } from './importLimits';

/**
 * Import of Chip's Challenge 2 levels: a selection of .c2m files (with the .c2g game script, when it is there) becomes
 * one pack. The levels are put in the order of the game script that names the most of them; maps the script does not
 * list follow in natural path order. Every file is converted by the pure converter, and its raw bytes are returned to
 * be stored in the local sidecar (never in the pack itself).
 */

/** i18n keys of the failures the summary reports. */
export const CC2_ERROR_UNREADABLE_KEY = 'cc2.import.error.unreadable';
export const CC2_ERROR_NO_LEVELS_KEY = 'cc2.import.error.no_levels';
/** i18n key of the message for a file over the size limit (shared with the other formats). */
const TOO_LARGE_KEY = 'app.packs.import_too_large.label';

const PATH_SEPARATOR = '/';
const BACKSLASH_PATTERN = /\\/g;
/** Prefix of the AppleDouble companion files macOS writes next to the real ones. */
const APPLE_DOUBLE_PREFIX = '._';
const APPLE_RESOURCE_FOLDER = '__macosx';
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;
const SORT_LOCALE = 'en';

/** A browser File of a folder pick carries its path from the picked folder. */
export interface Cc2ImportFile extends ImportableFile {
  readonly webkitRelativePath?: string;
}

/** True for a CC2 level file name. */
export function isC2mFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CC2_LEVEL_EXTENSION);
}

/** True for a CC2 game script file name. */
export function isC2gFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CC2_SCRIPT_EXTENSION);
}

/** True for a name of a CC2 file of either kind. */
export function isCc2FileName(name: string): boolean {
  return isC2mFileName(name) || isC2gFileName(name);
}

/** Path of a file for ordering and matching: its path from the picked folder when it has one, with forward slashes. */
export function importPathOf(file: Pick<Cc2ImportFile, 'name' | 'webkitRelativePath'>): string {
  const path = file.webkitRelativePath ? file.webkitRelativePath : file.name;
  return path.replace(BACKSLASH_PATTERN, PATH_SEPARATOR);
}

/** True for the companion files a zip made on macOS leaves behind (AppleDouble `._*` files, the `__MACOSX` folder). */
export function isImportJunkPath(path: string): boolean {
  const segments = path.replace(BACKSLASH_PATTERN, PATH_SEPARATOR).split(PATH_SEPARATOR);
  const base = segments[segments.length - 1];
  return base.startsWith(APPLE_DOUBLE_PREFIX) || segments.some((segment) => segment.toLowerCase() === APPLE_RESOURCE_FOLDER);
}

/** The files of a selection without the macOS companion files. */
export function dropImportJunk<T extends Pick<Cc2ImportFile, 'name' | 'webkitRelativePath'>>(files: readonly T[]): T[] {
  return files.filter((file) => !isImportJunkPath(importPathOf(file)));
}

/** Natural path order: case-insensitive, digits compared as numbers (lesson_2 before lesson_10). */
export function compareNaturalPaths(a: string, b: string): number {
  return a.localeCompare(b, SORT_LOCALE, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** A map placed in the pack order. */
export interface Cc2OrderedMap {
  /** Import path of the map file. */
  path: string;
  /** Path as the game script writes it, when the script lists the map. */
  scriptPath?: string;
  music?: string;
}

export interface Cc2Ordering {
  ordered: Cc2OrderedMap[];
  /** Game name of the script used, or null without a script. */
  gameName: string | null;
  /** True when a script placed the maps. */
  scripted: boolean;
  /** Number of maps that the script does not list, added at the end. */
  appended: number;
}

/** A parsed script and the path it was read from. */
export interface Cc2ScriptFile {
  path: string;
  script: C2gScript;
}

/** Maps of the script placed on the available files, in script order, each file once. */
function resolveScript(mapPaths: readonly string[], script: C2gScript): Cc2OrderedMap[] {
  const resolve = createC2gResolver(mapPaths);
  const seen = new Set<string>();
  const placed: Cc2OrderedMap[] = [];
  for (const entry of script.maps) {
    const path = resolve(entry);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    placed.push({ path, scriptPath: entry.path, ...(entry.music !== undefined ? { music: entry.music } : {}) });
  }
  return placed;
}

/**
 * Puts the maps in the order of the script that places the most of them (the first one in path order on a tie), then
 * appends the unlisted maps in natural path order. Without a usable script every map is in natural path order.
 */
export function orderCc2Maps(mapPaths: readonly string[], scripts: readonly Cc2ScriptFile[]): Cc2Ordering {
  const naturalPaths = [...mapPaths].sort(compareNaturalPaths);
  let best: { placed: Cc2OrderedMap[]; gameName: string | null } | null = null;
  for (const { script } of [...scripts].sort((a, b) => compareNaturalPaths(a.path, b.path))) {
    const placed = resolveScript(naturalPaths, script);
    if (placed.length > 0 && (best === null || placed.length > best.placed.length)) {
      best = { placed, gameName: script.gameName };
    }
  }
  if (best === null) {
    return { ordered: naturalPaths.map((path) => ({ path })), gameName: null, scripted: false, appended: 0 };
  }
  const listed = new Set(best.placed.map((map) => map.path));
  const extras = naturalPaths.filter((path) => !listed.has(path)).map((path): Cc2OrderedMap => ({ path }));
  return { ordered: [...best.placed, ...extras], gameName: best.gameName, scripted: true, appended: extras.length };
}

/** A converted file: the level, the converter report and the raw bytes to keep in the sidecar. */
export interface Cc2ConvertedFile {
  level: CompiledLevel;
  report: Cc2ConversionReport;
  source: Cc2SourceRecord;
}

/** Decodes and converts the bytes of one .c2m file; throws when the file cannot be decoded. */
export async function convertC2mBytes(
  bytes: Uint8Array,
  options: { file: string; order: number; music?: string }
): Promise<Cc2ConvertedFile> {
  const sha256 = await sha256OfBytes(bytes);
  const converted = convertCc2File(decodeC2m(bytes), {
    file: options.file,
    order: options.order,
    sha256,
    ...(options.music !== undefined ? { music: options.music } : {})
  });
  return { level: converted.level, report: converted.report, source: { sha256, bytes } };
}

/** Counts of an import, for the summary. */
export interface Cc2ImportSummary {
  levelCount: number;
  exact: number;
  approx: number;
  lost: number;
  /** Files that did not import because they cannot be read. */
  skipped: number;
  /** Files that did not import because they are over the size limit. */
  tooLarge: number;
  /** Levels that the game script does not list. */
  appended: number;
  /** Converter warnings over all the levels. */
  warningCount: number;
  /** Keys of the mechanics Epoxy cannot play in at least one level, sorted. */
  lostKeys: string[];
}

export interface Cc2SelectionResult {
  /** Game name of the script, or null when there was no usable script. */
  packName: string | null;
  levels: CompiledLevel[];
  /** The raw bytes of each imported file, once per hash. */
  sources: Cc2SourceRecord[];
  reports: Cc2ConversionReport[];
  summary: Cc2ImportSummary;
  /** Key and parameters of the first failure, null when every file imported. */
  firstError: { key: string; params?: Record<string, string> } | null;
}

/** The file name of an import path: the local folders around it are not kept. */
function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1);
}

/** Folder name the picked files share, used to name a pack made without a script. */
export function folderNameOf(files: ReadonlyArray<Pick<Cc2ImportFile, 'name' | 'webkitRelativePath'>>): string | null {
  const first = files.find((file) => file.webkitRelativePath);
  const root = first?.webkitRelativePath?.replace(BACKSLASH_PATTERN, PATH_SEPARATOR).split(PATH_SEPARATOR)[0];
  return root ? root : null;
}

/** Name of a pack made from a single file: the file name without its extension. */
export function cc2PackNameFromFile(fileName: string): string {
  return fileName.replace(FILE_EXTENSION_PATTERN, '');
}

/**
 * Reads, orders and converts a selection of CC2 files. Files over the size limit and files that do not decode are
 * skipped and counted; the rest import. `formatMax` formats the size limit for the failure message.
 */
export async function importCc2Selection(
  files: readonly Cc2ImportFile[],
  maxBytes: number,
  formatMax: (bytes: number) => string
): Promise<Cc2SelectionResult> {
  const usable = dropImportJunk(files);
  const maps = new Map<string, Cc2ImportFile>();
  const scripts: Cc2ScriptFile[] = [];
  let skipped = 0;
  let tooLarge = 0;
  let firstError: Cc2SelectionResult['firstError'] = null;
  const fail = (key: string, params?: Record<string, string>): void => {
    if (key === TOO_LARGE_KEY) tooLarge++;
    else skipped++;
    firstError ??= params ? { key, params } : { key };
  };

  for (const file of usable) {
    const path = importPathOf(file);
    if (isC2mFileName(file.name)) {
      if (!maps.has(path)) maps.set(path, file);
    } else if (isC2gFileName(file.name)) {
      if (!isImportSizeAllowed(file.size, maxBytes)) {
        fail(TOO_LARGE_KEY, { max: formatMax(maxBytes) });
        continue;
      }
      try {
        scripts.push({ path, script: parseC2gBytes(new Uint8Array(await file.arrayBuffer())) });
      } catch {
        fail(CC2_ERROR_UNREADABLE_KEY);
      }
    }
  }

  const ordering = orderCc2Maps([...maps.keys()], scripts);
  const levels: CompiledLevel[] = [];
  const reports: Cc2ConversionReport[] = [];
  const sources = new Map<string, Cc2SourceRecord>();
  let appended = 0;
  for (const entry of ordering.ordered) {
    const file = maps.get(entry.path) as Cc2ImportFile;
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      fail(TOO_LARGE_KEY, { max: formatMax(maxBytes) });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const converted = await convertC2mBytes(bytes, {
        file: entry.scriptPath ?? baseNameOf(entry.path),
        order: levels.length + 1,
        ...(entry.music !== undefined ? { music: entry.music } : {})
      });
      levels.push(converted.level);
      reports.push(converted.report);
      if (!sources.has(converted.source.sha256)) sources.set(converted.source.sha256, converted.source);
      if (ordering.scripted && entry.scriptPath === undefined) appended++;
    } catch {
      fail(CC2_ERROR_UNREADABLE_KEY);
    }
  }

  return {
    packName: ordering.gameName,
    levels,
    sources: [...sources.values()],
    reports,
    summary: summarizeCc2Import(reports, skipped, appended, tooLarge),
    firstError
  };
}

/** Counts of the converted levels by verdict, their warnings and the mechanics Epoxy cannot play. */
export function summarizeCc2Import(
  reports: readonly Cc2ConversionReport[],
  skipped: number,
  appended: number,
  tooLarge = 0
): Cc2ImportSummary {
  const count: Record<Cc2CoverageVerdict, number> = { exact: 0, approx: 0, lost: 0 };
  const lostKeys = new Set<string>();
  let warningCount = 0;
  for (const report of reports) {
    count[report.verdict]++;
    warningCount += report.warnings.length;
    for (const entry of report.lost) lostKeys.add(entry.key);
  }
  return {
    levelCount: reports.length,
    ...count,
    skipped,
    tooLarge,
    appended,
    warningCount,
    lostKeys: [...lostKeys].sort()
  };
}
