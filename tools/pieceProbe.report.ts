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
 * Writes to local/piece-probe.txt, for every motif piece, whether it is solvable, the shortest
 * solution, and whether its required items are really needed. Meant for
 * authoring pieces; the regular suite asserts the same properties.
 *
 * Run with: npm run report:pieces
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => ({
  AudioManager: new Proxy({}, { get: () => () => undefined })
}));

import { ConfigRegistry } from '../src/config/ConfigRegistry';
import { compilePiece } from '../src/generator/PieceCompiler';
import { PieceSolver } from '../src/generator/PieceSolver';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

/** Authoring output, kept out of the repository with the rest of local/. */
const OUTPUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'local', 'piece-probe.txt');

it('probes every motif piece', () => {
  loadTestConfigs();
  const legend = ConfigRegistry.getPieceLegend();
  const lines: string[] = [];
  for (const def of ConfigRegistry.getMotifs().pieces) {
    const piece = compilePiece(def, legend);
    const result = PieceSolver.solve(piece);
    const withoutCarried =
      piece.requires.length > 0 ? PieceSolver.solve(piece, { carried: [] }).solvable : null;
    lines.push(
      [
        def.id.padEnd(22),
        result.solvable ? 'SOLVED' : result.truncated ? 'TRUNCATED' : 'UNSOLVABLE',
        `states=${result.statesExplored}`,
        `moves=${result.moves?.length ?? '-'}`,
        withoutCarried === null ? '' : `solvable-without-requires=${withoutCarried}`,
        result.moves ? result.moves.join('') : ''
      ].join(' ')
    );
  }
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${lines.join('\n')}\n`);
});
