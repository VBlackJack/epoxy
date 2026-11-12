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

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { loadTestConfigs } from '../test/loadTestConfigs';
import { C2M_TAGS, type Cc2RawSection } from './cc2Model';
import { CC2_FRAMES_PER_TICK, CC2_REPLAY_ACTION_BITS, CC2_REPLAY_KEY_BITS, decodeCc2Replay } from './cc2Replay';
import { checkCc2Replay, checkCc2ReplayBest, resolveCc2HeldOrder } from './cc2ReplayCheck';
import { makeMap, player, put } from './cc2TestMaps';
import { convertCc2Map } from './cc2ToEpoxy';

const CODE_ICE = 0x03;
const CODE_WATER = 0x08;
const CODE_FORCE_E = 0x0b;
const CODE_EXIT = 0x14;
const CODE_WALL = 0x02;
const CODE_PURPLE_WALL = 0x73;
const STEP_FRAMES = 4 * CC2_FRAMES_PER_TICK;
const TAP_FRAMES = CC2_FRAMES_PER_TICK;
const SHORT_RUN_STEPS = 2;
const FAR_RIGHT_X = 1;

const { N, E, S, W } = CC2_REPLAY_KEY_BITS;

type Entry = [delay: number, keys: number];

function replayOf(entries: readonly Entry[]) {
  const stream = Uint8Array.from([0, 0, 0, ...entries.flat()]);
  const section: Cc2RawSection = { kind: 'raw', tag: C2M_TAGS.replay, data: stream };
  return decodeCc2Replay(section);
}

function terrain(x: number, y: number, code: number) {
  return put(x, y, { code });
}

function levelOf(width: number, height: number, placements: ReturnType<typeof put>[]) {
  return convertCc2Map(makeMap(width, height, [player(0, 0), ...placements]), {
    file: 'synthetic.c2m',
    order: 1,
    sha256: 'cd'.repeat(32)
  }).level;
}

/** Holds a key for `steps` walking steps, then releases it. */
const hold = (key: number, steps: number): Entry[] => [
  [0, key],
  [steps * STEP_FRAMES, 0]
];

beforeAll(() => {
  loadTestConfigs();
});

describe('checkCc2ReplayBest on the CC2 engine', () => {
  it('wins a straight walk and reports no unsupported id', () => {
    const level = levelOf(6, 1, [terrain(4, 0, CODE_EXIT)]);
    const best = checkCc2ReplayBest(level, replayOf(hold(E, 4)), 'cc2');
    expect(best.won).toBe(true);
    expect(best.unsupported).toEqual([]);
  });

  it('lists the ids the engine cannot play', () => {
    const level = levelOf(6, 2, [terrain(4, 0, CODE_EXIT), terrain(2, 1, CODE_PURPLE_WALL)]);
    const best = checkCc2ReplayBest(level, replayOf(hold(E, 4)), 'cc2');
    expect(best.won).toBe(true);
    expect(best.unsupported).toEqual(['purple_wall']);
    expect(checkCc2ReplayBest(level, replayOf(hold(E, 4))).unsupported).toEqual([]);
  });
});

describe('checkCc2Replay with the CC2 dirt', () => {
  const walkThroughDirt = () => {
    const level = levelOf(6, 1, [terrain(4, 0, CODE_EXIT)]);
    level.terrain[0][2] = 'dirt_cc2';
    return level;
  };

  it('plays the CC2 dirt as dirt on the Lynx and CC2 engines, which would play an unknown id as a wall', () => {
    const level = walkThroughDirt();
    for (const engine of ['lynx', 'cc2'] as const) {
      const best = checkCc2ReplayBest(level, replayOf(hold(E, 4)), engine);
      expect(best.won, engine).toBe(true);
      expect(best.unsupported, engine).toEqual([]);
    }
  });

  it('leaves the level it was given untouched, and the Epoxy engine on the CC2 dirt', () => {
    const level = walkThroughDirt();
    expect(checkCc2ReplayBest(level, replayOf(hold(E, 4)), 'epoxy').won).toBe(true);
    checkCc2ReplayBest(level, replayOf(hold(E, 4)), 'lynx');
    expect(level.terrain[0][2]).toBe('dirt_cc2');
  });
});

describe('checkCc2Replay', () => {
  it('wins a straight walk with both strategies', () => {
    const level = levelOf(6, 1, [terrain(4, 0, CODE_EXIT)]);
    const replay = replayOf(hold(E, 4));
    const best = checkCc2ReplayBest(level, replay);
    expect(best.results.map((r) => [r.strategy, r.won])).toEqual([
      ['held', true],
      ['steps', true]
    ]);
    expect(best.winner).toBe('held');
    expect(best.ignoredKeyBits).toBe(0);
  });

  it('wins a walk with a turn', () => {
    const level = levelOf(3, 3, [terrain(2, 2, CODE_EXIT)]);
    const replay = replayOf([...hold(E, 2), ...hold(S, 2)]);
    expect(checkCc2Replay(level, replay, 'held').won).toBe(true);
    expect(checkCc2Replay(level, replay, 'steps').won).toBe(true);
  });

  it('keeps the player moving while a direction is held on force floors', () => {
    const level = levelOf(7, 1, [
      terrain(1, 0, CODE_FORCE_E),
      terrain(2, 0, CODE_FORCE_E),
      terrain(3, 0, CODE_FORCE_E),
      terrain(5, 0, CODE_EXIT)
    ]);
    // One long press east: the conveyor carries the player, the held key walks him on past its end.
    const replay = replayOf(hold(E, 6));
    expect(checkCc2Replay(level, replay, 'held').won).toBe(true);
  });

  it('wins a tap that slides across ice', () => {
    const level = levelOf(6, 1, [
      terrain(1, 0, CODE_ICE),
      terrain(2, 0, CODE_ICE),
      terrain(3, 0, CODE_ICE),
      terrain(4, 0, CODE_EXIT)
    ]);
    const replay = replayOf([
      [0, E],
      [TAP_FRAMES, 0]
    ]);
    const best = checkCc2ReplayBest(level, replay);
    expect(best.won).toBe(true);
    expect(best.winner).toBe('held');
    expect(checkCc2Replay(level, replay, 'steps').won).toBe(true);
  });

  it('reports a death with its tick, position and cause', () => {
    const level = levelOf(5, 1, [terrain(2, 0, CODE_WATER), terrain(4, 0, CODE_EXIT)]);
    const replay = replayOf(hold(E, 4));
    for (const strategy of ['held', 'steps'] as const) {
      const result = checkCc2Replay(level, replay, strategy);
      expect(result.won).toBe(false);
      expect(result.divergence?.kind).toBe('death');
      expect(result.divergence?.x).toBe(2);
      expect(result.divergence?.reasonKey).toBeTruthy();
    }
  });

  it('reports a replay that ends short of the exit', () => {
    const level = levelOf(6, 1, [terrain(5, 0, CODE_EXIT)]);
    const replay = replayOf(hold(E, SHORT_RUN_STEPS));
    const result = checkCc2Replay(level, replay, 'steps');
    expect(result.won).toBe(false);
    expect(result.divergence?.kind).toBe('no_exit');
    expect(result.divergence?.x).toBe(SHORT_RUN_STEPS);
  });

  it('reports a run blocked by a wall as stuck', () => {
    const level = levelOf(4, 1, [terrain(FAR_RIGHT_X, 0, CODE_WALL), terrain(3, 0, CODE_EXIT)]);
    const replay = replayOf(hold(E, 20));
    const result = checkCc2Replay(level, replay, 'held');
    expect(result.won).toBe(false);
    expect(result.divergence?.kind).toBe('stuck');
    expect(result.divergence?.blockedSinceTick).toBeDefined();
  });

  it('lists the key bits it cannot play', () => {
    const level = levelOf(3, 1, [terrain(2, 0, CODE_EXIT)]);
    const replay = replayOf([
      [0, CC2_REPLAY_ACTION_BITS.drop | E],
      [2 * STEP_FRAMES, 0]
    ]);
    const best = checkCc2ReplayBest(level, replay);
    expect(best.won).toBe(true);
    expect(best.ignoredKeyBits).toBe(CC2_REPLAY_ACTION_BITS.drop);
  });
});

describe('resolveCc2HeldOrder', () => {
  it('cancels all input when an opposing pair is held, with two or three keys', () => {
    expect(resolveCc2HeldOrder(['N', 'S'], 'N')).toEqual([]);
    expect(resolveCc2HeldOrder(['E', 'W'], 'E')).toEqual([]);
    expect(resolveCc2HeldOrder(['N', 'E', 'S'], 'E')).toEqual([]);
    expect(resolveCc2HeldOrder(['E', 'S', 'W'], 'S')).toEqual([]);
  });

  it('tries the key matching the facing first', () => {
    expect(resolveCc2HeldOrder(['N', 'E'], 'N')).toEqual(['N', 'E']);
    expect(resolveCc2HeldOrder(['E', 'S'], 'E')).toEqual(['E', 'S']);
    expect(resolveCc2HeldOrder(['S', 'W'], 'S')).toEqual(['S', 'W']);
  });

  it('falls back to the horizontal key when the facing is not held', () => {
    expect(resolveCc2HeldOrder(['N', 'E'], 'W')).toEqual(['E', 'N']);
    expect(resolveCc2HeldOrder(['S', 'W'], 'N')).toEqual(['W', 'S']);
  });

  it('leaves a single key untouched', () => {
    expect(resolveCc2HeldOrder(['S'], 'E')).toEqual(['S']);
    expect(resolveCc2HeldOrder([], 'E')).toEqual([]);
  });
});

describe('checkCc2Replay with several held keys', () => {
  const holdBoth = (a: number, b: number) => replayOf(hold(a | b, 6));

  it('ignores the whole tick on the Epoxy engine when an opposing pair is held', () => {
    const level = levelOf(3, 1, [terrain(2, 0, CODE_EXIT)]);
    expect(checkCc2Replay(level, holdBoth(E, W), 'held').won).toBe(false);
    expect(checkCc2Replay(level, replayOf(hold(E, 6)), 'held').won).toBe(true);
  });

  it('ignores a third key with an opposing pair on the Epoxy engine', () => {
    const level = levelOf(3, 3, [terrain(2, 0, CODE_EXIT)]);
    expect(checkCc2Replay(level, replayOf(hold(E | W | S, 6)), 'held').won).toBe(false);
  });

  it('walks the horizontal key first when the facing is not held', () => {
    // Exit east on a one row corridor: N is blocked, so only the horizontal key can make progress.
    const level = levelOf(3, 1, [terrain(2, 0, CODE_EXIT)]);
    expect(checkCc2Replay(level, holdBoth(N, E), 'held').won).toBe(true);
  });

  it('keeps the Lynx based engines on their own resolution', () => {
    // East alone, then west pressed on top: the Lynx engines follow the older key, the Epoxy engine stops.
    const level = levelOf(5, 1, [terrain(4, 0, CODE_EXIT)]);
    const replay = replayOf([
      [0, E],
      [STEP_FRAMES, E | W],
      [6 * STEP_FRAMES, 0]
    ]);
    for (const engine of ['lynx', 'cc2'] as const) {
      expect(checkCc2Replay(level, replay, 'held', engine).won).toBe(true);
    }
    expect(checkCc2Replay(level, replay, 'held').won).toBe(false);
  });
});

describe('checkCc2Replay after the replay ends', () => {
  const LONG_CORRIDOR = 20;
  // One step of E, then the stream ends with E still held (no release entry).
  const endsHeld = () =>
    replayOf([
      [0, E],
      [STEP_FRAMES, E]
    ]);

  it('keeps holding the last input during the grace period on the Epoxy engine', () => {
    const level = levelOf(LONG_CORRIDOR, 1, [terrain(LONG_CORRIDOR - 1, 0, CODE_EXIT)]);
    expect(checkCc2Replay(level, endsHeld(), 'held').won).toBe(true);
  });

  it('still releases after a final release entry', () => {
    const level = levelOf(LONG_CORRIDOR, 1, [terrain(LONG_CORRIDOR - 1, 0, CODE_EXIT)]);
    expect(checkCc2Replay(level, replayOf(hold(E, 2)), 'held').won).toBe(false);
  });

  it('leaves the Lynx based engines releasing at the end', () => {
    const level = levelOf(LONG_CORRIDOR, 1, [terrain(LONG_CORRIDOR - 1, 0, CODE_EXIT)]);
    for (const engine of ['lynx', 'cc2'] as const) {
      expect(checkCc2Replay(level, endsHeld(), 'held', engine).won).toBe(false);
    }
  });
});
