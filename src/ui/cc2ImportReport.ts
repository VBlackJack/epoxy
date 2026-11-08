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

import { LevelValidator } from '../core/LevelValidator';
import { serializePack } from '../packs/packJson';
import { bytesToBase64 } from '../storage/cc2Sources';
import { folderNameOf } from './cc2Import';
import type { Cc2ImportFile, Cc2SelectionResult } from './cc2Import';

/**
 * What the local import tool writes for a converted folder: the pack file (compact, with the raw sources embedded,
 * since the file never leaves the computer) and a markdown report. Pure, so the tool itself is only file reading and
 * writing. The report holds names and counts only, never map contents.
 */

const FALLBACK_PACK_NAME = 'cc2-pack';
const UNSAFE_NAME_PATTERN = /[^a-z0-9]+/g;
const EDGE_DASH_PATTERN = /^-+|-+$/g;
const NONE = 'none';

export interface Cc2PackOutput {
  packName: string;
  /** File name stem shared by the pack file and the report. */
  stem: string;
  packJson: string;
  reportMarkdown: string;
  /** Levels whose validator report holds at least one error. */
  validatorErrorLevels: number;
  /** One line of counts for the console. */
  consoleLine: string;
}

/** A pack name as a file name stem. */
export function cc2FileStem(name: string): string {
  const stem = name.toLowerCase().replace(UNSAFE_NAME_PATTERN, '-').replace(EDGE_DASH_PATTERN, '');
  return stem === '' ? FALLBACK_PACK_NAME : stem;
}

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(', ') : NONE;
}

/** Builds the pack file and the report of a converted selection. The level configs must be loaded (the validator reads them). */
export function buildCc2PackOutput(result: Cc2SelectionResult, files: readonly Cc2ImportFile[]): Cc2PackOutput {
  const packName = result.packName ?? folderNameOf(files) ?? FALLBACK_PACK_NAME;
  const sources = Object.fromEntries(result.sources.map((source) => [source.sha256, bytesToBase64(source.bytes)]));
  const summary = result.summary;

  const levelLines: string[] = [];
  let validatorErrorLevels = 0;
  result.levels.forEach((level, index) => {
    const report = result.reports[index];
    const errors = LevelValidator.validate(level)
      .issues.filter((issue) => issue.severity === 'error')
      .map((issue) => issue.i18nKey);
    if (errors.length > 0) validatorErrorLevels++;
    levelLines.push(
      `### ${level.number}. ${report.title || report.file} (${report.file})`,
      `- Verdict: ${report.verdict}`,
      `- Lost: ${listOrNone(report.lost.map((entry) => entry.key))}`,
      `- Approximate: ${listOrNone(report.approx.map((entry) => entry.key))}`,
      `- Warnings: ${report.warnings.length === 0 ? NONE : report.warnings.length}`,
      ...report.warnings.map((warning) => `  - ${warning}`),
      `- Validator errors: ${listOrNone(errors)}`,
      ''
    );
  });

  const reportLines = [
    `# ${packName}`,
    '',
    `- Levels imported: ${summary.levelCount}`,
    `- Coverage: exact ${summary.exact}, approximate ${summary.approx}, not playable ${summary.lost}`,
    `- Files skipped (unreadable): ${summary.skipped}`,
    `- Files skipped (over the size limit): ${summary.tooLarge}`,
    `- Levels not in the game script (added at the end): ${summary.appended}`,
    `- Converter warnings: ${summary.warningCount}`,
    `- Levels with validator errors: ${validatorErrorLevels}`,
    `- Mechanics Epoxy cannot play: ${listOrNone(summary.lostKeys)}`,
    '',
    '## Levels',
    '',
    ...levelLines
  ];

  return {
    packName,
    stem: cc2FileStem(packName),
    packJson: serializePack(packName, result.levels, {}, true, sources),
    reportMarkdown: `${reportLines.join('\n')}\n`,
    validatorErrorLevels,
    consoleLine:
      `${packName}: ${summary.levelCount} levels, exact ${summary.exact}, approx ${summary.approx}, lost ${summary.lost}, ` +
      `skipped ${summary.skipped}, appended ${summary.appended}, warnings ${summary.warningCount}, ` +
      `validator-error levels ${validatorErrorLevels}`
  };
}
