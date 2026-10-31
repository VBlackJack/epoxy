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
 * Adapts a Sokoban collection in the standard XSB text format into Epoxy
 * pieces (see src/generator/XsbImport.ts for how a level becomes a piece).
 * Results go to local/sokoban-import.txt: how many levels were kept, why the
 * others were not, then the kept pieces as motifs.json entries carrying a
 * credit line.
 *
 * Only use collections whose licence allows reuse; credit their authors.
 *
 * Run with:
 *   EPOXY_SOKOBAN_FILE=path/to/collection.xsb EPOXY_SOKOBAN_CREDIT="Title by Author" npm run import:sokoban
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { PieceDefinition } from '../src/generator/PieceTypes';
import { importXsbLevel, parseXsbCollection, XsbRejection } from '../src/generator/XsbImport';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'local', 'sokoban-import.txt');

it('imports a Sokoban collection', () => {
  const file = process.env.EPOXY_SOKOBAN_FILE;
  if (!file || !existsSync(file)) {
    console.warn('Set EPOXY_SOKOBAN_FILE to an .xsb collection whose licence allows reuse.');
    return;
  }
  const credit = process.env.EPOXY_SOKOBAN_CREDIT ?? file;
  loadTestConfigs();
  const levels = parseXsbCollection(readFileSync(file, 'utf-8'));
  const kept: PieceDefinition[] = [];
  const rejected: Array<{ title: string; rejection: XsbRejection }> = [];
  levels.forEach((level, i) => {
    const result = importXsbLevel(level, credit, i + 1);
    if (result.piece) kept.push(result.piece);
    else if (result.rejection) rejected.push({ title: level.title, rejection: result.rejection });
  });
  const counts = new Map<XsbRejection, number>();
  for (const r of rejected) counts.set(r.rejection, (counts.get(r.rejection) ?? 0) + 1);
  const histogram = [...counts].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `  ${reason}: ${n}`);
  const reasons = rejected.map((r) => `  ${r.title}: ${r.rejection}`);
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(
    OUTPUT_FILE,
    [
      `${kept.length} of ${levels.length} levels adapted`,
      '',
      'Rejections:',
      ...histogram,
      '',
      'Rejected levels:',
      ...reasons,
      '',
      kept.map((d) => JSON.stringify(d)).join('\n\n'),
      ''
    ].join('\n')
  );
});
