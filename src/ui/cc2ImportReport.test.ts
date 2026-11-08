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

import { beforeAll, describe, expect, it } from 'vitest';
import { PACK_JSON_VERSION_V12 } from '../config/constants';
import { FLOOR_CODE, c2mFileBytes, makeMap, player, put } from '../formats/cc2TestMaps';
import { parsePackJson } from '../packs/packJson';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { base64ToBytes } from '../storage/cc2Sources';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { importCc2Selection } from './cc2Import';
import type { Cc2ImportFile } from './cc2Import';
import { buildCc2PackOutput, cc2FileStem } from './cc2ImportReport';

/** The railroad sign has no Epoxy equivalent yet, so a level that holds it keeps a reserved id and is lost. */
const RAILROAD_SIGN = 0x6f;
const MAX_BYTES = 1 << 20;

function fileOf(path: string, bytes: Uint8Array): Cc2ImportFile {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    size: bytes.length,
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer
  };
}

beforeAll(() => {
  loadTestConfigs();
});

describe('the local CC2 import tool output', () => {
  it('names the files after the pack', () => {
    expect(cc2FileStem('Chip\'s Challenge 2: Steam!')).toBe('chip-s-challenge-2-steam');
    expect(cc2FileStem('***')).toBe('cc2-pack');
  });

  it('writes a lossless pack and a report of counts for a synthetic folder', async () => {
    const files = [
      fileOf('Folder/g.c2g', new TextEncoder().encode('game "Synthetic Game"\nmap "two.c2m"\nmap "one.c2m"\n')),
      fileOf('Folder/one.c2m', c2mFileBytes(makeMap(4, 3, [player(1, 1)]), 'One')),
      fileOf('Folder/two.c2m', c2mFileBytes(makeMap(4, 3, [player(1, 1), put(2, 1, { code: RAILROAD_SIGN }, { code: FLOOR_CODE })]), 'Two'))
    ];
    const result = await importCc2Selection(files, MAX_BYTES, String);
    const output = buildCc2PackOutput(result, files);

    expect(output.packName).toBe('Synthetic Game');
    expect(output.stem).toBe('synthetic-game');
    const pack = JSON.parse(output.packJson);
    expect(pack.version).toBe(PACK_JSON_VERSION_V12);
    expect(pack.levels.map((l: { customTitle: string }) => l.customTitle)).toEqual(['Two', 'One']);
    // The local pack embeds every raw source, each one hashing back to the bytes of its file.
    const hashes = pack.levels.map((l: { cc2: { sha256: string } }) => l.cc2.sha256);
    expect(Object.keys(pack.cc2Sources).sort()).toEqual([...hashes].sort());
    expect(Array.from(base64ToBytes(pack.cc2Sources[hashes[1]]) ?? [])).toEqual(
      Array.from(c2mFileBytes(makeMap(4, 3, [player(1, 1)]), 'One'))
    );
    // The pack reads back through the regular pack file reader.
    const parsed = parsePackJson(output.packJson, ConfigRegistry.getLevelSizeBounds(), new Set());
    expect(parsed.ok && parsed.levels).toHaveLength(2);

    const report = output.reportMarkdown;
    expect(report).toContain('- Levels imported: 2');
    expect(report).toContain('- Coverage: exact 1, approximate 0, not playable 1');
    expect(report).toContain('### 1. Two (two.c2m)');
    expect(report).toContain('- Lost: railroad_sign');
    expect(report).toContain('- Mechanics Epoxy cannot play: railroad_sign');
    expect(report).not.toMatch(/\[\s*\[/);
  });

  it('names a pack made without a script after its folder', async () => {
    const files = [fileOf('My Levels/a.c2m', c2mFileBytes(makeMap(3, 3, [player(1, 1)])))];
    const output = buildCc2PackOutput(await importCc2Selection(files, MAX_BYTES, String), files);
    expect(output.packName).toBe('My Levels');
    expect(output.stem).toBe('my-levels');
  });
});
