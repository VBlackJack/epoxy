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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const TICKS = 24;
const KEY_CELL = 3;
const FAR_CELL = 5;

interface TestWorld {
  entities: { kind: string; x: number }[];
  items: (string | null)[][];
}

function level(row: string, cc2: boolean): CompiledLevel {
  const built = buildTestLevel(['##########', `#${row}#`, '##########'], {
    entities: [{ type: 'glider', x: 1, y: 1, dir: 'E' as Direction }]
  });
  return cc2 ? { ...built, cc2: CC2_RECORD } : built;
}

function play(lvl: CompiledLevel): { furthest: number; key: string | null } {
  const engine = new GameEngine();
  engine.loadLevel(lvl);
  const w = (engine as unknown as { w: TestWorld }).w;
  let furthest = 0;
  for (let t = 0; t < TICKS; t++) {
    engine.tick();
    furthest = Math.max(furthest, w.entities.find((e) => e.kind === 'monster')?.x ?? 0);
  }
  return { furthest, key: w.items[1][KEY_CELL] ?? null };
}

describe('CC2 monsters and keys', () => {
  it('passes a red key and leaves it on a CC2 level', () => {
    const result = play(level('..r....', true));
    expect(result.furthest).toBeGreaterThan(KEY_CELL);
    expect(result.key).toBe('key_red');
  });

  it('passes a blue key and takes it on a CC2 level', () => {
    const result = play(level('..b....', true));
    expect(result.furthest).toBeGreaterThan(KEY_CELL);
    expect(result.key).toBeNull();
  });

  it.each(['r', 'b'])('is stopped by a %s key on a level that is not a CC2 import', (glyph) => {
    const result = play(level(`..${glyph}....`, false));
    expect(result.furthest).toBeLessThan(FAR_CELL);
    expect(result.furthest).toBeLessThanOrEqual(KEY_CELL - 1);
  });
});
