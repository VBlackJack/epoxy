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
 * Optional corpus check: runs only when CC3D_CORPUS_DIR names a directory of level files (the data stays
 * outside the repository). Every file must survive decode -> encode -> decode unchanged with no section
 * fallback, and the type table (flags, sections, panel direction, floor omission) must agree with what the
 * files store.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dLevel, decodeCc3dText, parseXmlDocument } from './Cc3dXmlCodec';
import { encodeCc3dLevelReport } from './Cc3dXmlEncoder';
import {
  CC3D_ENTRY_BY_ID,
  KINDS_WITHOUT_FLOOR_TILE,
  PANEL_FILE_DIRECTION,
  PIXELS_PER_CELL,
  TOGGLE_DOOR_STATE_MASK
} from './Cc3dTypeTable';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
const TEST_TIMEOUT_MS = 300_000;
const PLAIN_FLOOR_ID = 1;
const FLAGS_ATTRIBUTE = 'flags';
const DIRECTION_ATTRIBUTE = 'direction';

interface CorpusFile {
  name: string;
  mapId: string;
  bytes: Uint8Array;
}

function loadFiles(): CorpusFile[] {
  const dir = CORPUS_DIR as string;
  expect(existsSync(dir)).toBe(true);
  const names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION));
  expect(names.length, 'the corpus folder holds at least one XML file').toBeGreaterThan(0);
  return names.map((name) => ({ name, mapId: name.slice(0, name.lastIndexOf('.')), bytes: new Uint8Array(readFileSync(join(dir, name))) }));
}

interface FileTile {
  section: string;
  type: number;
  cell: string;
  flags: number;
  direction: number;
}

function tilesOf(text: string): FileTile[] {
  const tiles: FileTile[] = [];
  for (const section of parseXmlDocument(text).children) {
    for (const tile of section.children) {
      const attribute = (name: string): number => Number(tile.attrs.get(name));
      tiles.push({
        section: section.name,
        type: attribute('type'),
        cell: `${attribute('x') / PIXELS_PER_CELL},${attribute('y') / PIXELS_PER_CELL}`,
        flags: Number(tile.children[0]?.attrs.get(FLAGS_ATTRIBUTE)),
        direction: attribute(DIRECTION_ATTRIBUTE)
      });
    }
  }
  return tiles;
}

/** The flags a row stores for a tile: toggle doors add the state mask when open (their state comes from the flags). */
function expectedFlags(type: number, flags: number): number {
  const entry = CC3D_ENTRY_BY_ID.get(type);
  if (entry?.content.role === 'terrain' && entry.content.stateFromFlags) {
    return (flags & TOGGLE_DOOR_STATE_MASK) === TOGGLE_DOOR_STATE_MASK ? entry.flags | TOGGLE_DOOR_STATE_MASK : entry.flags;
  }
  return entry?.flags ?? Number.NaN;
}

describe.skipIf(!CORPUS_DIR)('cc3d encoder corpus round trip', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('decode(encode(decode(file))) equals decode(file) with no section fallback', { timeout: TEST_TIMEOUT_MS }, () => {
    const problems: string[] = [];
    let fallbacks = 0;
    let alternates = 0;
    const files = loadFiles();
    for (const file of files) {
      const options = { packName: 'corpus', mapId: file.mapId, number: 1 };
      const first = decodeCc3dLevel(file.bytes, options);
      const report = encodeCc3dLevelReport(first.cc3d!, { name: first.customTitle ?? '', author: first.author ?? '' });
      fallbacks += report.fallbackCount;
      alternates += report.alternateCount;
      if (report.fallbackCount > 0) problems.push(`${file.name}: ${report.fallbackCount} fallback(s)`);
      const second = decodeCc3dLevel(report.xml, options);
      expect(second.cc3d, file.name).toEqual(first.cc3d);
      expect(second.customTitle, file.name).toBe(first.customTitle);
      expect(second.author, file.name).toBe(first.author);
    }
    console.info(`encoder corpus: ${files.length} files, ${fallbacks} fallback(s), ${alternates} tile(s) in an alternate section`);
    expect(problems).toEqual([]);
  });

  it('agrees with the type table on flags, sections and floor omission', { timeout: TEST_TIMEOUT_MS }, () => {
    const problems = new Set<string>();
    for (const file of loadFiles()) {
      const text = decodeCc3dText(file.bytes);
      const cellsWithPlainFloor = new Set<string>();
      const original = tilesOf(text);
      for (const tile of original) {
        const entry = CC3D_ENTRY_BY_ID.get(tile.type);
        if (!entry) {
          problems.add(`type ${tile.type}: no row`);
          continue;
        }
        if (tile.flags !== expectedFlags(tile.type, tile.flags)) problems.add(`type ${tile.type}: flags ${tile.flags}`);
        if (!entry.sections.includes(tile.section as never)) problems.add(`type ${tile.type}: section ${tile.section} not listed`);
        if (tile.type === PLAIN_FLOOR_ID) cellsWithPlainFloor.add(tile.cell);
      }
      for (const tile of original) {
        const content = CC3D_ENTRY_BY_ID.get(tile.type)?.content;
        if (content?.role === 'terrain' && KINDS_WITHOUT_FLOOR_TILE.has(content.terrain.kind) && cellsWithPlainFloor.has(tile.cell)) {
          problems.add(`type ${tile.type}: stored on a plain floor`);
        }
      }
    }
    expect([...problems]).toEqual([]);
  });

  it('writes flags, sections and panel directions of the table on every tile', { timeout: TEST_TIMEOUT_MS }, () => {
    const problems = new Set<string>();
    for (const file of loadFiles()) {
      const first = decodeCc3dLevel(file.bytes, { packName: 'corpus', mapId: file.mapId, number: 1 });
      const { xml } = encodeCc3dLevelReport(first.cc3d!, { name: '', author: '' });
      for (const tile of tilesOf(xml)) {
        const entry = CC3D_ENTRY_BY_ID.get(tile.type);
        if (!entry) {
          problems.add(`type ${tile.type}: no row`);
          continue;
        }
        if (tile.flags !== expectedFlags(tile.type, tile.flags)) problems.add(`type ${tile.type}: flags ${tile.flags}`);
        // Mobs may take another section their type is stored in to keep the model order; everything else
        // takes the usual one.
        const allowed = entry.content.role === 'mob' ? entry.sections : entry.sections.slice(0, 1);
        if (!allowed.includes(tile.section as never)) problems.add(`type ${tile.type}: section ${tile.section}`);
        if (entry.content.role === 'panel' && tile.direction !== PANEL_FILE_DIRECTION[entry.content.side]) {
          problems.add(`panel ${tile.type}: direction ${tile.direction}`);
        }
        if (entry.alias) problems.add(`type ${tile.type}: alias id written`);
      }
    }
    expect([...problems]).toEqual([]);
  });
});
