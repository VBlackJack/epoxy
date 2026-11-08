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

/**
 * Converts a folder of Chip's Challenge 2 levels (a folder with a .c2g game script, or any folder of .c2m files, read
 * recursively) into one Epoxy pack file and a report. Local only: the pack embeds the raw source files, since it never
 * leaves this computer, so it is the lossless pack of the folder.
 *
 *   CC2_GAME_DIR   the folder to convert (required)
 *   CC2_OUT_DIR    where the files go (default: local/cc2 under the repository)
 *
 * Writes `<pack-name>.json` (compact pack file with the raw sources) and `<pack-name>-report.md` (per level: verdict,
 * lost and approximate mechanics, converter warnings, validator errors; counts and names only, no map dumps).
 *
 * Run with:
 *   CC2_GAME_DIR=<folder> npm run import:cc2
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { loadTestConfigs } from '../src/test/loadTestConfigs';
import type { Cc2ImportFile } from '../src/ui/cc2Import';
import { importCc2Selection, isCc2FileName, isImportJunkPath } from '../src/ui/cc2Import';
import { buildCc2PackOutput } from '../src/ui/cc2ImportReport';
import { formatMegabytes } from '../src/ui/importLimits';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = resolve(ROOT, 'local', 'cc2');
const PATH_SEPARATOR = '/';
const SPLIT_PATTERN = /[\\/]/;

/** Every CC2 file under a folder, as the browser lists a picked folder (paths start with the folder name). */
function readFolder(root: string): Cc2ImportFile[] {
  const files: Cc2ImportFile[] = [];
  const rootName = basename(root);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const path = [rootName, ...relative(root, full).split(SPLIT_PATTERN)].join(PATH_SEPARATOR);
      if (!isCc2FileName(entry.name) || isImportJunkPath(path)) continue;
      files.push({
        name: entry.name,
        size: statSync(full).size,
        webkitRelativePath: path,
        arrayBuffer: async () => {
          const bytes = readFileSync(full);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        }
      });
    }
  };
  walk(root);
  return files;
}

it('converts a folder of CC2 levels into one local pack and a report', async () => {
  const dirName = process.env.CC2_GAME_DIR;
  if (!dirName || !existsSync(dirName)) {
    console.warn('Set CC2_GAME_DIR to a folder with a .c2g game script, or to any folder of .c2m levels.');
    return;
  }
  const outDir = process.env.CC2_OUT_DIR ? resolve(process.env.CC2_OUT_DIR) : DEFAULT_OUT_DIR;

  loadTestConfigs();
  const files = readFolder(resolve(dirName));
  const result = await importCc2Selection(files, ConfigRegistry.getGame().import.maxFileBytes, formatMegabytes);
  expect(result.levels.length, 'no CC2 level could be converted').toBeGreaterThan(0);

  const output = buildCc2PackOutput(result, files);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${output.stem}.json`), output.packJson, 'utf8');
  writeFileSync(join(outDir, `${output.stem}-report.md`), output.reportMarkdown, 'utf8');
  console.log(output.consoleLine);
});
