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
 * Optional corpus check: runs only when DIGGY_CORPUS_DIR names a directory of
 * extracted floor JSON files. The data stays outside the repository.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, sanitizeStoredLevels } from '../config/ConfigValidation';
import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import type { Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeDiggyFiles, isDiggyFloorFileName } from './DiggyCodec';

const CORPUS_DIR = process.env.DIGGY_CORPUS_DIR;

describe.skipIf(!CORPUS_DIR)('diggy corpus import', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('imports, validates, and solves every floor in GameEngine', () => {
    const dir = CORPUS_DIR as string;
    const files = readdirSync(dir)
      .filter((name) => isDiggyFloorFileName(name) || name.toLowerCase().endsWith('.json'))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

    const { levels, skipped } = decodeDiggyFiles(files, 'corpus');
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const malformed = levels.filter((lvl) => !isCompiledLevelShape(lvl as unknown, bounds)).map((lvl) => lvl.id);
    const reloaded = sanitizeStoredLevels(structuredClone(levels), bounds);

    const validationIssues: string[] = [];
    const unsolved: string[] = [];

    for (const level of levels) {
      const report = LevelValidator.validate(level);
      const problems = report.issues.filter((iss) => iss.severity === 'error' || iss.severity === 'warning');
      if (problems.length > 0) {
        validationIssues.push(`${level.id}: ${problems.map((p) => `${p.severity}:${p.i18nKey}`).join('; ')}`);
      }
      const engine = new GameEngine();
      engine.loadLevel(level);
      for (const ch of level.solution ?? '') {
        while (engine.getPlayer().moveCooldown > 0 && engine.getPlayer().alive && !engine.isLevelCompleted()) {
          engine.tick();
        }
        engine.attemptPlayerMove(ch as Direction);
        if (engine.isLevelCompleted()) break;
      }
      if (!engine.isLevelCompleted()) {
        unsolved.push(level.id);
      }
    }

    console.info(
      `diggy corpus: ${levels.length} levels imported from ${files.length} files, ${skipped.length} skipped: ${JSON.stringify(skipped)}`
    );
    expect(malformed).toEqual([]);
    expect(reloaded).toEqual(levels);
    expect(validationIssues).toEqual([]);
    expect(unsolved).toEqual([]);
    expect(levels.length).toBeGreaterThanOrEqual(30);
  });
});
