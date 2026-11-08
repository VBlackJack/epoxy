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

import { convertCc3dLevel } from '../core/cc3d/cc3dToEpoxy';
import { classifyLevel } from '../core/cc3d/epoxyCoverage';
import type { CoverageLevel } from '../core/cc3d/epoxyCoverage';
import { LevelValidator } from '../core/LevelValidator';
import type { CompiledLevel } from '../core/types';
import { decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import type { Cc3dFile } from '../formats/Cc3dXmlCodec';
import { serializePack } from '../packs/packJson';

/**
 * What the local CC3D import tool writes for one pack folder: the cc3d-ruleset pack, the Epoxy-ruleset pack made by the
 * converter, and a markdown report. Pure, so the tool itself is only file reading and writing. The report holds names
 * and counts only, never map contents.
 */

const NONE = 'none';
const DEC_RADIX = 10;
const EPOXY_PACK_SUFFIX = ' (Epoxy)';
const UNSAFE_FILE_NAME_PATTERN = /[\\/:*?"<>|]/g;
const MAP_ID_PATTERN = /(\d+)(?:\.[^.\\/]*)?$/;
const FILE_NAME_FALLBACK = 'pack';

/** The per-level fields carried over from an earlier pack, matched by map id. */
export interface Cc3dLevelMetadata {
  password?: string;
  customTitle?: string;
}

export interface Cc3dPackOutput {
  packName: string;
  cc3dPackJson: string;
  epoxyPackName: string;
  epoxyPackJson: string;
  reportMarkdown: string;
  levelCount: number;
  failureCount: number;
  verdicts: Record<CoverageLevel, number>;
  /** Levels whose converted form holds at least one validator error. */
  validatorErrorLevels: number;
  /** One line of counts for the console. */
  consoleLine: string;
}

/** The numeric map id at the end of a file name or level id (`001-15022.xml` gives `15022`), or null. */
export function mapIdFromName(name: string): string | null {
  const match = MAP_ID_PATTERN.exec(name);
  return match ? String(parseInt(match[1], DEC_RADIX)) : null;
}

/** A pack name as a file name stem: only the characters a Windows path rejects are replaced. */
export function packFileStem(name: string): string {
  const stem = name.replace(UNSAFE_FILE_NAME_PATTERN, '-').trim();
  return stem === '' ? FILE_NAME_FALLBACK : stem;
}

/** Reads the password and title of every level of an earlier pack file, keyed by map id. Anything unreadable is skipped. */
export function readMetadataByMapId(packJson: string): Map<string, Cc3dLevelMetadata> {
  const found = new Map<string, Cc3dLevelMetadata>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(packJson);
  } catch {
    return found;
  }
  const levels = (parsed as { levels?: unknown } | null)?.levels;
  if (!Array.isArray(levels)) return found;
  for (const level of levels) {
    if (typeof level !== 'object' || level === null) continue;
    const record = level as Record<string, unknown>;
    const id = typeof record.id === 'string' ? mapIdFromName(record.id) : null;
    if (id === null) continue;
    const entry: Cc3dLevelMetadata = {};
    if (typeof record.password === 'string' && record.password !== '') entry.password = record.password;
    if (typeof record.customTitle === 'string' && record.customTitle !== '') entry.customTitle = record.customTitle;
    if (entry.password !== undefined || entry.customTitle !== undefined) found.set(id, entry);
  }
  return found;
}

/** Applies carried-over metadata to a level, matched by its map id; a title is only filled in when the level has none. */
export function applyMetadata(level: CompiledLevel, metadata: ReadonlyMap<string, Cc3dLevelMetadata>): CompiledLevel {
  const id = level.cc3d?.mapId ? mapIdFromName(level.cc3d.mapId) : null;
  const found = id === null ? undefined : metadata.get(id);
  if (!found) return level;
  return {
    ...level,
    ...(found.password !== undefined ? { password: found.password } : {}),
    ...(level.customTitle === undefined && found.customTitle !== undefined ? { customTitle: found.customTitle } : {})
  };
}

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(', ') : NONE;
}

/** Builds both packs and the report of one pack folder. The level configs must be loaded (decoder and validator read them). */
export function buildCc3dPackOutput(
  packName: string,
  files: readonly Cc3dFile[],
  metadata: ReadonlyMap<string, Cc3dLevelMetadata> = new Map()
): Cc3dPackOutput {
  const decoded = decodeCc3dFiles(files, packName);
  const levels = decoded.levels.map((level) => applyMetadata(level, metadata));
  const verdicts: Record<CoverageLevel, number> = { exact: 0, approx: 0, lost: 0 };
  const lostKeys = new Set<string>();
  const converted: CompiledLevel[] = [];
  const levelLines: string[] = [];
  let validatorErrorLevels = 0;

  for (const level of levels) {
    if (!level.cc3d) continue;
    const coverage = classifyLevel(level.cc3d);
    verdicts[coverage.verdict]++;
    coverage.lost.forEach((key) => lostKeys.add(key));
    const result = convertCc3dLevel(level);
    converted.push(result.level);
    const errors = LevelValidator.validate(result.level)
      .issues.filter((issue) => issue.severity === 'error')
      .map((issue) => issue.i18nKey);
    if (errors.length > 0) validatorErrorLevels++;
    levelLines.push(
      `### ${level.number}. ${level.customTitle || level.cc3d.mapId || level.id} (${level.cc3d.mapId ?? level.id})`,
      `- Verdict: ${coverage.verdict}`,
      `- Lost: ${listOrNone(coverage.lost)}`,
      `- Approximate: ${listOrNone(coverage.approx)}`,
      `- Validator errors (converted): ${listOrNone(errors)}`,
      ''
    );
  }

  const epoxyPackName = `${packName}${EPOXY_PACK_SUFFIX}`;
  const reportLines = [
    `# ${packName}`,
    '',
    `- Levels imported: ${levels.length}`,
    `- Files that failed to import: ${decoded.failures.length}`,
    `- Coverage: exact ${verdicts.exact}, approximate ${verdicts.approx}, not playable ${verdicts.lost}`,
    `- Levels with validator errors (converted): ${validatorErrorLevels}`,
    `- Mechanics Epoxy cannot play: ${listOrNone([...lostKeys].sort())}`,
    ...decoded.failures.map((failure) => `- Failed: ${failure.name} (${failure.error.message})`),
    '',
    '## Levels',
    '',
    ...levelLines
  ];

  return {
    packName,
    cc3dPackJson: serializePack(packName, levels, {}, true),
    epoxyPackName,
    epoxyPackJson: serializePack(epoxyPackName, converted, {}, true),
    reportMarkdown: `${reportLines.join('\n')}\n`,
    levelCount: levels.length,
    failureCount: decoded.failures.length,
    verdicts,
    validatorErrorLevels,
    consoleLine:
      `${packName}: ${levels.length} levels, exact ${verdicts.exact}, approx ${verdicts.approx}, lost ${verdicts.lost}, ` +
      `failed ${decoded.failures.length}, validator-error levels ${validatorErrorLevels}`
  };
}
