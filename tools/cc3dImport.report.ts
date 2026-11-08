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
 * Regenerates the CC3D community packs from their XML sources. Local only. Each pack folder (level order is the file
 * order, `NNN-<mapId>.xml`) gives `<pack>.json` (cc3d ruleset), `<pack> (Epoxy).json` (converted, epoxy ruleset) and
 * `<pack>-report.md` (per level: verdict, lost and approximate keys; counts and names only).
 *
 *   CC3D_GAME_DIR   a folder of pack folders (required)
 *   CC3D_OUT_DIR    where the files go (default: local/levels/converted/cc3d under the repository, git-ignored)
 *   CC3D_META_DIR   optional folder of earlier pack files (`<pack>.json`) whose per-level passwords and titles are
 *                   carried over by map id (metadata only, never their tiles)
 *
 * Run with:
 *   CC3D_GAME_DIR=<folder> npm run import:cc3d
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { CC3D_XML_EXTENSION } from '../src/formats/Cc3dXmlCodec';
import type { Cc3dFile } from '../src/formats/Cc3dXmlCodec';
import { loadTestConfigs } from '../src/test/loadTestConfigs';
import { buildCc3dPackOutput, packFileStem, readMetadataByMapId } from '../src/ui/cc3dImportReport';
import type { Cc3dLevelMetadata } from '../src/ui/cc3dImportReport';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = resolve(ROOT, 'local', 'levels', 'converted', 'cc3d');
const PACK_EXTENSION = '.json';
const REPORT_SUFFIX = '-report.md';

function readPackFolder(dir: string): Cc3dFile[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
}

function readMetadata(metaDir: string | undefined, packName: string): Map<string, Cc3dLevelMetadata> {
  const file = metaDir ? join(resolve(metaDir), `${packName}${PACK_EXTENSION}`) : '';
  return file && existsSync(file) ? readMetadataByMapId(readFileSync(file, 'utf8')) : new Map();
}

it('regenerates the CC3D packs from their XML sources', () => {
  const dirName = process.env.CC3D_GAME_DIR;
  if (!dirName || !existsSync(dirName)) {
    console.warn('Set CC3D_GAME_DIR to a folder of CC3D pack folders (each holding NNN-<mapId>.xml files).');
    return;
  }
  const outDir = process.env.CC3D_OUT_DIR ? resolve(process.env.CC3D_OUT_DIR) : DEFAULT_OUT_DIR;
  const root = resolve(dirName);
  loadTestConfigs();
  mkdirSync(outDir, { recursive: true });

  const packs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(packs.length, 'no pack folder found').toBeGreaterThan(0);

  for (const packName of packs) {
    const files = readPackFolder(join(root, packName));
    if (files.length === 0) continue;
    const output = buildCc3dPackOutput(packName, files, readMetadata(process.env.CC3D_META_DIR, packName));
    const stem = packFileStem(packName);
    writeFileSync(join(outDir, `${stem}${PACK_EXTENSION}`), output.cc3dPackJson, 'utf8');
    writeFileSync(join(outDir, `${packFileStem(output.epoxyPackName)}${PACK_EXTENSION}`), output.epoxyPackJson, 'utf8');
    writeFileSync(join(outDir, `${stem}${REPORT_SUFFIX}`), output.reportMarkdown, 'utf8');
    console.log(output.consoleLine);
  }
});
