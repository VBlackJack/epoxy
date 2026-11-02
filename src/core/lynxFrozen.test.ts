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

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Freeze guard for the Lynx engine: every file under src/core/lynx is pinned by
 * the SHA-256 of its content (line endings normalised to LF) in
 * lynxFrozen.manifest.json. Any added, removed or changed file fails the test.
 *
 * To accept an intentional change, regenerate the manifest once:
 *   PowerShell: $env:UPDATE_LYNX_MANIFEST = '1'; npx vitest run src/core/lynxFrozen.test.ts
 *   Bash:       UPDATE_LYNX_MANIFEST=1 npx vitest run src/core/lynxFrozen.test.ts
 */

const REPO_ROOT = join(__dirname, '..', '..');
const LYNX_DIR = join(__dirname, 'lynx');
const MANIFEST_PATH = join(__dirname, 'lynxFrozen.manifest.json');
const UPDATE_ENV = 'UPDATE_LYNX_MANIFEST';

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function hashOf(file: string): string {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function currentHashes(): Record<string, string> {
  const result: Record<string, string> = {};
  const files = listFiles(LYNX_DIR)
    .map((f) => relative(REPO_ROOT, f).split(sep).join('/'))
    .sort();
  for (const rel of files) result[rel] = hashOf(join(REPO_ROOT, rel));
  return result;
}

describe('Lynx engine freeze guard', () => {
  it('matches the manifest file for file', () => {
    const current = currentHashes();
    if (process.env[UPDATE_ENV] === '1') {
      writeFileSync(MANIFEST_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, string>;
    const added = Object.keys(current).filter((f) => !(f in manifest));
    const removed = Object.keys(manifest).filter((f) => !(f in current));
    const changed = Object.keys(current).filter((f) => f in manifest && manifest[f] !== current[f]);
    expect({ added, removed, changed }).toEqual({ added: [], removed: [], changed: [] });
  });

  it('reaches nested directories', () => {
    expect(Object.keys(currentHashes()).some((f) => f.startsWith('src/core/lynx/rules/'))).toBe(true);
  });
});
