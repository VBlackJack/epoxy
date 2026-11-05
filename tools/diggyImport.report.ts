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
 * Converts a directory of extracted Diggy's Adventure floor JSON files
 * (defaulting to `local/diggy/floors`, or `EPOXY_DIGGY_DIR`) into a ready-to-import
 * Epoxy pack JSON (`local/diggy/diggy-adventure-pack.json`) and a summary report
 * (`local/diggy/diggy-import-report.txt`). Every generated level is checked against
 * `LevelValidator` and replayed in `GameEngine`.
 *
 * Run with:
 *   npm run import:diggy
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { GameEngine } from '../src/core/GameEngine';
import { LevelValidator } from '../src/core/LevelValidator';
import type { Direction } from '../src/core/types';
import { decodeDiggyFiles, isDiggyFloorFileName } from '../src/formats/DiggyCodec';
import { serializePack } from '../src/packs/packJson';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FLOORS_DIR = resolve(ROOT, 'local', 'diggy', 'floors');
const OUTPUT_PACK_FILE = resolve(ROOT, 'local', 'diggy', 'diggy-adventure-pack.json');
const OUTPUT_REPORT_FILE = resolve(ROOT, 'local', 'diggy', 'diggy-import-report.txt');
const DEFAULT_PACK_NAME = 'Diggy Adventure Mines';

it('imports Diggy floor JSON files into an Epoxy pack', () => {
  const dir = process.env.EPOXY_DIGGY_DIR ? resolve(process.env.EPOXY_DIGGY_DIR) : DEFAULT_FLOORS_DIR;
  if (!existsSync(dir)) {
    console.warn(`Set EPOXY_DIGGY_DIR or place floor JSON files in ${DEFAULT_FLOORS_DIR}.`);
    return;
  }

  loadTestConfigs();

  const files = readdirSync(dir)
    .filter((name) => isDiggyFloorFileName(name) || name.toLowerCase().endsWith('.json'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

  const packName = process.env.EPOXY_DIGGY_PACK_NAME ?? DEFAULT_PACK_NAME;
  const { levels, skipped } = decodeDiggyFiles(files, 'diggy');

  const lines: string[] = [
    `Pack: ${packName}`,
    `Source files: ${files.length}`,
    `Imported levels: ${levels.length}`,
    `Skipped floors: ${skipped.length}`,
    ''
  ];

  for (const level of levels) {
    const validation = LevelValidator.validate(level);
    const errors = validation.issues.filter((i) => i.severity === 'error');
    const warnings = validation.issues.filter((i) => i.severity === 'warning');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);

    const engine = new GameEngine();
    engine.loadLevel(level);
    for (const ch of level.solution ?? '') {
      while (engine.getPlayer().moveCooldown > 0 && engine.getPlayer().alive && !engine.isLevelCompleted()) {
        engine.tick();
      }
      engine.attemptPlayerMove(ch as Direction);
      if (engine.isLevelCompleted()) break;
    }
    expect(engine.isLevelCompleted()).toBe(true);

    const width = level.terrain[0]?.length ?? 0;
    const height = level.terrain.length;
    lines.push(
      `  #${String(level.number).padStart(2, '0')} ${level.id} "${level.customTitle}" (${width}x${height}, chips=${level.chipsRequired}, blocks=${level.entities.length}, moves=${level.solution?.length ?? 0})`
    );
  }

  if (skipped.length > 0) {
    lines.push('', 'Skipped:');
    for (const s of skipped) {
      lines.push(`  floor ${s.floorId} "${s.title}": ${s.reason}`);
    }
  }

  mkdirSync(dirname(OUTPUT_PACK_FILE), { recursive: true });
  writeFileSync(OUTPUT_PACK_FILE, serializePack(packName, levels), 'utf8');
  writeFileSync(OUTPUT_REPORT_FILE, `${lines.join('\n')}\n`, 'utf8');
});
