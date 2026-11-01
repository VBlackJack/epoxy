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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { RuntimeEntity } from '../../types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { lynxLevel, LynxLevelOptions, monster } from '../lynxTestMaps';
import { LynxRig } from '../lynxTestRig';
import { RuleModule } from '../ruleApi';
import { ADMISSION } from '../tileRules';
import { LYNX_RULE_MODULES } from './index';
import { walkerBlobRules } from './walkerBlob';

beforeAll(() => {
  loadTestConfigs();
});

const TRAP = 'trap';
const FORCE_RANDOM = 'force_random';
const BLOB_SEED = 0;

/** Stands in for the traps of the buttons module: nothing leaves, monsters at rest here draw nothing. */
const trapStub: RuleModule = {
  name: 'trapStub',
  tiles: { [TRAP]: { admits: ADMISSION.everyone, mayLeave: () => false, confinesCreatures: true } }
};

const rigOf = (rows: string[], options: LynxLevelOptions, seed?: number): LynxRig =>
  new LynxRig(lynxLevel(rows, options), { modules: [walkerBlobRules, trapStub], seed });

const WALKER_ROOM = ['#####', '###.#', '#...#', '#...#', '#####', '#@#'];
const BLOB_ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######', '#@#'];

function byUid(rig: LynxRig, uid: number): RuntimeEntity {
  const found = rig.entities.find((e) => e.uid === uid);
  if (!found) throw new Error(`No entity ${uid}`);
  return found;
}

describe('walker', () => {
  it('F8 goes forward when it may, else turns by one draw from the walker generator', () => {
    const rig = rigOf(WALKER_ROOM, { entities: [monster('walker', 2, 2, 'N')] });
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 2, dir: 'E' });
    rig.afterTick(3);
    expect(rig.entities[0].cooldownTicks).toBe(0);
    rig.afterTick(4);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 1, dir: 'N' });
  });

  it('draws nothing while forward is open', () => {
    const rig = rigOf(['#######', '#.....#', '#######', '#@#'], { entities: [monster('walker', 1, 1, 'E')] });
    rig.tick(12);
    expect(rig.entities[0]).toMatchObject({ x: 4, dir: 'E' });
  });

  it('F9 boxed in, it faces the draws 1, 3, 7 clockwise from its facing', () => {
    const rig = rigOf(['###', '#.#', '###', '#@#'], { entities: [monster('walker', 1, 1, 'N')] });
    rig.afterTick(0);
    expect(rig.entities[0].dir).toBe('E');
    rig.afterTick(1);
    expect(rig.entities[0].dir).toBe('N');
    rig.afterTick(2);
    expect(rig.entities[0].dir).toBe('W');
  });

  it('draws in list order, last to first, when two walkers are blocked in one tick', () => {
    const level: LynxLevelOptions = { entities: [monster('walker', 1, 1, 'N'), monster('walker', 1, 3, 'N')] };
    const rig = rigOf(['###', '#.#', '###', '#.#', '###', '#@#'], level);
    rig.afterTick(0);
    expect(rig.entityAt(1, 1)?.dir).toBe('E');
    expect(rig.entityAt(1, 3)?.dir).toBe('W');
  });

  it('F10 a walker held in a trap draws nothing and keeps its facing', () => {
    const rows = [...WALKER_ROOM, '###', '#t#', '###'];
    const options: LynxLevelOptions = {
      glyphs: { t: { terrain: TRAP, entity: { type: 'walker', dir: 'E' } } },
      entities: [monster('walker', 2, 2, 'N')]
    };
    const rig = rigOf(rows, options);
    const free = rig.entityAt(2, 2)?.uid ?? -1;
    const trapped = rig.entityAt(1, 7)?.uid ?? -1;
    rig.afterTick(0);
    expect(byUid(rig, free)).toMatchObject({ x: 3, y: 2, dir: 'E' });
    rig.afterTick(4);
    expect(byUid(rig, free)).toMatchObject({ x: 3, y: 1, dir: 'N' });
    rig.afterTick(40);
    expect(byUid(rig, trapped)).toMatchObject({ x: 1, y: 7, dir: 'E' });
  });
});

describe('blob', () => {
  it('A5 steps every 8 ticks along the main generator', () => {
    const rig = rigOf(BLOB_ROOM, { entities: [monster('blob', 3, 3, 'N')] }, BLOB_SEED);
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 2, cooldownTicks: 7 });
    rig.afterTick(7);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 2, cooldownTicks: 0 });
    rig.afterTick(8);
    expect(rig.entities[0]).toMatchObject({ x: 3, y: 3 });
    rig.afterTick(16);
    expect(rig.entities[0]).toMatchObject({ x: 4, y: 3 });
    rig.afterTick(24);
    expect(rig.entities[0]).toMatchObject({ x: 4, y: 4 });
  });

  it('is deterministic for a seed and varies with it', () => {
    const run = (seed: number): string => {
      const rig = rigOf(BLOB_ROOM, { entities: [monster('blob', 3, 3, 'N')] }, seed);
      rig.tick(120);
      const [blob] = rig.entities;
      return `${blob.x},${blob.y},${blob.dir}`;
    };
    expect(run(7)).toBe(run(7));
    const outcomes = new Set([0, 1, 2, 3, 4, 5].map(run));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('faces the drawn direction and stays when it is refused', () => {
    const rig = rigOf(['###', '#.#', '###', '#@#'], { entities: [monster('blob', 1, 1, 'N')] }, BLOB_SEED);
    rig.afterTick(0);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'N' });
    rig.afterTick(1);
    expect(rig.entities[0]).toMatchObject({ x: 1, y: 1, dir: 'S' });
  });

  it('F11 a blob held in a trap draws nothing', () => {
    const rows = [...BLOB_ROOM, '###', '#t#', '###'];
    const options: LynxLevelOptions = {
      glyphs: { t: { terrain: TRAP, entity: { type: 'blob', dir: 'E' } } },
      entities: [monster('blob', 3, 3, 'N')]
    };
    const rig = rigOf(rows, options, BLOB_SEED);
    const free = rig.entityAt(3, 3)?.uid ?? -1;
    rig.afterTick(0);
    expect(byUid(rig, free)).toMatchObject({ x: 3, y: 2 });
    rig.afterTick(8);
    expect(byUid(rig, free)).toMatchObject({ x: 3, y: 3 });
    rig.afterTick(16);
    expect(byUid(rig, free)).toMatchObject({ x: 4, y: 3 });
    rig.afterTick(24);
    expect(byUid(rig, free)).toMatchObject({ x: 4, y: 4 });
    expect(rig.entityAt(1, 9)).toMatchObject({ type: 'blob', dir: 'E' });
  });
});

describe('K5 replay', () => {
  const CORRIDOR_LENGTH = 20;
  const REPLAY_SEED = 12345;
  const TIME_LIMIT_SECONDS = 100;

  const level = lynxLevel(
    [
      `#@${'.'.repeat(CORRIDOR_LENGTH)}X#`,
      '#'.repeat(CORRIDOR_LENGTH + 4),
      '#.........#',
      '#...?.....#',
      '#.........#',
      '#'.repeat(11)
    ],
    {
      number: 3,
      timeLimitSeconds: TIME_LIMIT_SECONDS,
      glyphs: { '?': FORCE_RANDOM },
      entities: [monster('walker', 2, 2, 'E'), monster('blob', 8, 4, 'N')]
    }
  );

  it('reproduces the win tick, the entities and the score from the timed history', () => {
    const first = new LynxRig(level, { seed: REPLAY_SEED, modules: LYNX_RULE_MODULES });
    first.hold('E');
    for (let i = 0; i < 200 && !first.engine.isLevelCompleted(); i++) first.tick();
    expect(first.engine.isLevelCompleted()).toBe(true);
    const history = first.engine.getTimedMoveHistory();

    const second = new LynxRig(level, { seed: REPLAY_SEED, modules: LYNX_RULE_MODULES });
    for (let k = 0; k < first.engine.getTick(); k++) {
      for (const move of history.filter((m) => m.tick === k)) second.press(move.dir);
      second.tick();
    }
    expect(second.engine.isLevelCompleted()).toBe(true);
    expect(second.engine.getTick()).toBe(first.engine.getTick());
    expect(second.entities).toEqual(first.entities);
    expect(second.wins).toEqual(first.wins);
    expect(second.wins).toHaveLength(1);
  });
});
