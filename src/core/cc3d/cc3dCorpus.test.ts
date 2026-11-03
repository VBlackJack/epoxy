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
 * outside the repository). Every level must have no validator error, a stable cell stack, display layers
 * that match its own cc3d data, and links that match what the engine resolves. When CC3D_CORPUS_DUMP names
 * a file, the SHA-256 of every decoded level is written there, to compare the codec before and after a change.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../../formats/Cc3dXmlCodec';
import type { CompiledLevel } from '../types';
import { nearestMachine } from './cc3dDevices';
import { nearestShooter } from './cc3dLasers';
import { cc3dLinks, NO_LINK } from './cc3dLinks';
import { deriveDisplayLayers } from './cc3dLayers';
import { candidatesBefore } from './cc3dTeleports';
import { validateCc3dLevel } from './cc3dValidator';
import { buildWorld, type RuleContext } from './cc3dWorld';
import { normalizeCell } from './model';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
const DUMP_FILE = process.env.CC3D_CORPUS_DUMP;
const WORLD_SEED = 1;
const KEY_PREFIX = 'validator.issues.cc3d_';
const TEST_TIMEOUT_MS = 120_000;

function loadLevels(): { levels: CompiledLevel[]; fileCount: number } {
  const dir = CORPUS_DIR as string;
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
  const { levels, failures } = decodeCc3dFiles(files, 'corpus');
  expect(failures).toEqual([]);
  return { levels, fileCount: files.length };
}

describe.skipIf(!CORPUS_DIR)('cc3d corpus', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no validator error and keeps its layers and stacks stable', { timeout: TEST_TIMEOUT_MS }, () => {
    const { levels, fileCount } = loadLevels();
    const errors: string[] = [];
    const warnings: Record<string, number> = {};
    for (const level of levels) {
      const cc3d = level.cc3d;
      if (!cc3d) throw new Error(`${level.id} has no cc3d data`);
      for (const issue of validateCc3dLevel(cc3d)) {
        const kind = issue.i18nKey.slice(KEY_PREFIX.length).replace(/\.label$/, '');
        if (issue.severity === 'error') errors.push(`${level.id}: ${kind} ${JSON.stringify(issue.params)}`);
        else warnings[kind] = (warnings[kind] ?? 0) + 1;
      }
      const layers = deriveDisplayLayers(cc3d);
      expect({ terrain: level.terrain, items: level.items, entities: level.entities }).toEqual(layers);
      for (const cell of cc3d.cells) expect(normalizeCell(cell.terrain)).toEqual(cell.terrain);
    }
    console.info(`cc3d corpus: ${levels.length} of ${fileCount} levels, ${errors.length} errors, warnings ${JSON.stringify(warnings)}`);
    expect(errors).toEqual([]);
    if (DUMP_FILE) {
      const hashes: Record<string, string> = {};
      for (const level of levels) hashes[level.id] = createHash('sha256').update(JSON.stringify(level)).digest('hex');
      writeFileSync(DUMP_FILE, JSON.stringify(hashes, null, 1));
    }
  });

  it('derives the links the engine resolves', { timeout: TEST_TIMEOUT_MS }, () => {
    const { levels } = loadLevels();
    let checked = 0;
    for (const level of levels) {
      const cc3d = level.cc3d;
      if (!cc3d) throw new Error(`${level.id} has no cc3d data`);
      const world = buildWorld(cc3d, WORLD_SEED);
      const links = cc3dLinks(cc3d);
      const at = (index: number) => ({ x: index % cc3d.width, y: Math.floor(index / cc3d.width) });
      expect(links.trapControls.map((l) => l.to ?? NO_LINK), level.id).toEqual(world.devices.trapTargets);
      for (const link of links.cloneSwitches) expect(nearestMachine(world, at(link.from)), level.id).toBe(link.to);
      for (const link of links.cloneMachines) {
        const template = world.occupancy.get(link.from);
        expect(template === undefined ? null : template.uid - 1, level.id).toBe(link.to);
      }
      for (const link of links.laserControllers) {
        const shooter = nearestShooter(world, at(link.from));
        expect(shooter === null ? null : shooter.uid - 1, level.id).toBe(link.to);
      }
      for (const link of links.teleports) {
        const kind = cc3d.cells[link.from].terrain[cc3d.cells[link.from].terrain.length - 1].kind;
        if (kind !== 'teleport_red' && kind !== 'teleport_blue') throw new Error(`${level.id}: not a teleport`);
        const first = candidatesBefore({ world } as RuleContext, at(link.from), kind)[0];
        expect(first === undefined ? null : first.y * cc3d.width + first.x, level.id).toBe(link.to);
      }
      checked += links.trapControls.length + links.cloneSwitches.length + links.cloneMachines.length + links.laserControllers.length + links.teleports.length;
    }
    console.info(`cc3d corpus: ${checked} links compared with the engine`);
  });
});
