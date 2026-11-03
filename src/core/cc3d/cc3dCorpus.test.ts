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
 * When CC3D_SIM_GOLDEN names a file, a fixed play-through of every level is hashed and
 * must match that file exactly; a missing file fails. The file is only written when CC3D_SIM_GOLDEN_WRITE=1
 * is also set, and that must be done on the reference checkout, never on the branch under test. Hashes and
 * ids only.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../../formats/Cc3dXmlCodec';
import type { CompiledLevel } from '../types';
import { nearestMachine } from './cc3dDevices';
import { nearestShooter } from './cc3dLasers';
import { cc3dLinks } from './cc3dLinks';
import { deriveDisplayLayers } from './cc3dLayers';
import { simulationHash } from './cc3dSimHash';
import { candidatesBefore } from './cc3dTeleports';
import { validateCc3dLevel } from './cc3dValidator';
import { buildWorld, type RuleContext } from './cc3dWorld';
import { normalizeCell } from './model';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
const DUMP_FILE = process.env.CC3D_CORPUS_DUMP;
const WORLD_SEED = 1;
const KEY_PREFIX = 'validator.issues.cc3d_';
const TEST_TIMEOUT_MS = 120_000;
const SIMULATION_TIMEOUT_MS = 600_000;
const SIM_GOLDEN_FILE = process.env.CC3D_SIM_GOLDEN;
const SIM_GOLDEN_WRITE = process.env.CC3D_SIM_GOLDEN_WRITE === '1';

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

  it('derives the links an independent reading of the rules gives, and the engine agrees', { timeout: TEST_TIMEOUT_MS }, () => {
    const { levels } = loadLevels();
    let checked = 0;
    for (const level of levels) {
      const cc3d = level.cc3d;
      if (!cc3d) throw new Error(`${level.id} has no cc3d data`);
      const { width } = cc3d;
      const world = buildWorld(cc3d, WORLD_SEED);
      const links = cc3dLinks(cc3d);
      const at = (index: number) => ({ x: index % width, y: Math.floor(index / width) });
      const topKind = (index: number) => cc3d.cells[index].terrain[cc3d.cells[index].terrain.length - 1].kind;
      const cellsWith = (kind: string) => cc3d.cells.flatMap((cell, i) => (cell.terrain.some((l) => l.kind === kind) ? [i] : []));
      // The oracle: the rules written out the long way, sharing no code with the engine or cc3dLinks.
      const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      const nearest = (from: number, targets: Array<{ x: number; y: number; id: number }>) =>
        [...targets].sort((p, q) => distance(p, at(from)) - distance(q, at(from)) || p.y * width + p.x - (q.y * width + q.x))[0]?.id ?? null;

      const traps = cellsWith('trap');
      for (const link of links.trapControls) {
        const oracle = traps.length === 0 ? null : (traps.find((t) => t > link.from) ?? traps[0]);
        expect(link.to, level.id).toBe(oracle);
      }
      expect(links.trapControls.map((l) => l.to ?? -1), level.id).toEqual(world.devices.trapTargets);

      const machines = cellsWith('clone_machine').map((id) => ({ ...at(id), id }));
      for (const link of links.cloneSwitches) {
        expect(link.to, level.id).toBe(nearest(link.from, machines));
        expect(nearestMachine(world, at(link.from)), level.id).toBe(link.to);
      }
      for (const link of links.cloneMachines) {
        const oracle = cc3d.mobs.findIndex((m) => m.x === at(link.from).x && m.y === at(link.from).y);
        expect(link.to, level.id).toBe(oracle < 0 ? null : oracle);
        const template = world.occupancy.get(link.from);
        expect(template === undefined ? null : template.uid - 1, level.id).toBe(link.to);
      }

      const shooters = cc3d.mobs.flatMap((m, id) => (m.kind === 'laser_shooter' ? [{ x: m.x, y: m.y, id }] : []));
      for (const link of links.laserControllers) {
        expect(link.to, level.id).toBe(nearest(link.from, shooters));
        const shooter = nearestShooter(world, at(link.from));
        expect(shooter === null ? null : shooter.uid - 1, level.id).toBe(link.to);
      }

      for (const link of links.teleports) {
        const kind = topKind(link.from);
        if (kind !== 'teleport_red' && kind !== 'teleport_blue') throw new Error(`${level.id}: not a teleport`);
        const same = cc3d.cells.flatMap((_, i) => (topKind(i) === kind ? [i] : []));
        const before = same.filter((i) => i < link.from);
        const oracle = same.length < 2 ? null : before.length > 0 ? before[before.length - 1] : same[same.length - 1];
        expect(link.to, level.id).toBe(oracle);
        const first = candidatesBefore({ world } as RuleContext, at(link.from), kind)[0];
        expect(first === undefined ? null : first.y * width + first.x, level.id).toBe(link.to);
      }
      checked += links.trapControls.length + links.cloneSwitches.length + links.cloneMachines.length + links.laserControllers.length + links.teleports.length;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('plays every level exactly as the reference engine did', { timeout: SIMULATION_TIMEOUT_MS }, () => {
    if (!SIM_GOLDEN_FILE) return;
    const { levels } = loadLevels();
    const hashes: Record<string, string> = {};
    for (const level of levels) hashes[level.id] = simulationHash(level);
    if (SIM_GOLDEN_WRITE) {
      // Explicit request, on the reference checkout only: record the hashes and compare nothing.
      writeFileSync(SIM_GOLDEN_FILE, JSON.stringify(hashes, null, 1));
      return;
    }
    // A missing file is a failure: a branch must never bless its own behaviour.
    expect(existsSync(SIM_GOLDEN_FILE), `golden file ${SIM_GOLDEN_FILE} is missing`).toBe(true);
    const golden = JSON.parse(readFileSync(SIM_GOLDEN_FILE, 'utf8')) as Record<string, string>;
    const different = Object.keys(hashes).filter((id) => golden[id] !== hashes[id]);
    expect(Object.keys(golden).length).toBe(levels.length);
    expect(different).toEqual([]);
  });
});
