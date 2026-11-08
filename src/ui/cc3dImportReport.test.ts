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
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  applyMetadata,
  buildCc3dPackOutput,
  mapIdFromName,
  packFileStem,
  readMetadataByMapId
} from './cc3dImportReport';

interface PackShape {
  levels: Array<{ ruleset?: string; password: string; customTitle?: string }>;
}

const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;

function levelXml(name: string, tiles: Array<{ type: number; x: number; y: number }>): string {
  const body = tiles
    .map(
      (t) =>
        `<tile image_index="${t.type}" x="${t.x * CELL}" y="${t.y * CELL}" direction="0" type="${t.type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><map name="${name}" author="A" width="5" height="5" background="0"><tiles>${body}</tiles></map>`;
}

const VALID = levelXml('Synthetic', [
  { type: PLAYER_TYPE, x: 0, y: 0 },
  { type: FISH_TYPE, x: 2, y: 2 }
]);
const NO_PLAYER = levelXml('Broken', [{ type: FISH_TYPE, x: 2, y: 2 }]);

beforeAll(() => {
  loadTestConfigs();
});

describe('cc3d import tool helpers', () => {
  it('reads the map id at the end of a name', () => {
    expect(mapIdFromName('001-15022.xml')).toBe('15022');
    expect(mapIdFromName('pack_id00042')).toBe('42');
    expect(mapIdFromName('no digits')).toBeNull();
  });

  it('keeps pack names usable as file names', () => {
    expect(packFileStem('Pack (2021-2023)')).toBe('Pack (2021-2023)');
    expect(packFileStem('a/b:c')).toBe('a-b-c');
    expect(packFileStem('  ')).toBe('pack');
  });

  it('reads passwords and titles by map id and ignores bad input', () => {
    const json = JSON.stringify({
      levels: [
        { id: 'p_id7', password: 'ABCD', customTitle: 'Seven' },
        { id: 'p_id8', password: '' },
        { id: 'nope' },
        null
      ]
    });
    const found = readMetadataByMapId(json);
    expect([...found.keys()]).toEqual(['7']);
    expect(found.get('7')).toEqual({ password: 'ABCD', customTitle: 'Seven' });
    expect(readMetadataByMapId('not json').size).toBe(0);
    expect(readMetadataByMapId('{"levels":5}').size).toBe(0);
  });

  it('builds both packs and a report from synthetic files, carrying metadata over', () => {
    const metadata = new Map([['5', { password: 'WXYZ', customTitle: 'Carried' }]]);
    const output = buildCc3dPackOutput(
      'Synthetic Pack',
      [
        { name: '002-9.xml', bytes: NO_PLAYER },
        { name: '001-5.xml', bytes: VALID }
      ],
      metadata
    );
    expect(output.levelCount).toBe(1);
    expect(output.failureCount).toBe(1);
    expect(output.verdicts.exact + output.verdicts.approx + output.verdicts.lost).toBe(1);
    expect(output.epoxyPackName).toBe('Synthetic Pack (Epoxy)');
    expect(output.reportMarkdown).toContain('# Synthetic Pack');
    expect(output.reportMarkdown).toContain('- Verdict:');
    expect(output.reportMarkdown).toContain('Failed: 002-9.xml');

    const cc3dPack = JSON.parse(output.cc3dPackJson) as PackShape;
    const epoxyPack = JSON.parse(output.epoxyPackJson) as PackShape;
    expect(cc3dPack.levels[0].ruleset).toBe('cc3d');
    expect(cc3dPack.levels[0].password).toBe('WXYZ');
    expect(epoxyPack.levels[0].ruleset).toBe('epoxy');
    expect(epoxyPack.levels[0].password).toBe('WXYZ');
    expect(epoxyPack.levels[0].customTitle).toBe('Synthetic');
  });

  it('keeps a level untouched when no metadata matches, and never overrides an existing title', () => {
    const output = buildCc3dPackOutput('P', [{ name: '001-5.xml', bytes: VALID }]);
    const pack = JSON.parse(output.cc3dPackJson) as { levels: Array<Parameters<typeof applyMetadata>[0]> };
    const level = pack.levels[0];
    expect(applyMetadata(level, new Map())).toBe(level);
    const merged = applyMetadata(level, new Map([['5', { customTitle: 'Other' }]]));
    expect(merged.customTitle).toBe('Synthetic');
  });
});
