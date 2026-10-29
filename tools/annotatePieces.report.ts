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
 * Writes public/configs/motif-annotations.json: for every piece of
 * motifs.json, a shortest winning action list and whether every winning
 * state can walk back out. The generator reads these instead of searching
 * in the browser; the tests replay and re-check them. Run it after adding
 * or editing a piece.
 *
 * Run with: npm run annotate:pieces
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { compilePiece } from '../src/generator/PieceCompiler';
import { PieceSolver, WAIT_ACTION } from '../src/generator/PieceSolver';
import { MotifAnnotations } from '../src/generator/PieceTypes';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = resolve(ROOT, 'public', 'configs', 'motif-annotations.json');
/** Large enough for the heaviest Sokoban pieces of the library. */
const MAX_STATES = 400000;
const WAIT_LETTER = '.';
const JSON_INDENT = 2;

it('annotates every piece', () => {
  loadTestConfigs();
  const legend = ConfigRegistry.getPieceLegend();
  const annotations: MotifAnnotations = {};
  const failures: string[] = [];
  const definitions = [...ConfigRegistry.getMotifs().pieces].sort((a, b) => a.id.localeCompare(b.id));
  for (const def of definitions) {
    const piece = compilePiece(def, legend);
    const solved = PieceSolver.solve(piece, { maxStates: MAX_STATES });
    const analysis = PieceSolver.analyze(piece, { maxStates: MAX_STATES });
    if (!solved.moves || analysis.truncated) {
      failures.push(def.id);
      continue;
    }
    annotations[def.id] = {
      solution: solved.moves.map((a) => (a === WAIT_ACTION ? WAIT_LETTER : a)).join(''),
      reversible: analysis.winnable && analysis.unreturnableGoals === 0
    };
  }
  if (failures.length > 0) throw new Error(`could not annotate: ${failures.join(', ')}`);
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(annotations, null, JSON_INDENT)}\n`);
});
