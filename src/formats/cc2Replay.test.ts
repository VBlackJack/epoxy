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

import { describe, expect, it } from 'vitest';
import { decodeC2m } from './C2mCodec';
import { encodeC2m, packC2m } from './C2mEncoder';
import { C2M_TAGS, cc2ReplaySections, type Cc2RawSection } from './cc2Model';
import { CC2_REPLAY_KEY_BITS, cc2KeysToDirections, decodeCc2Replay } from './cc2Replay';

const KEY_N = CC2_REPLAY_KEY_BITS.N;
const KEY_E = CC2_REPLAY_KEY_BITS.E;
const KEY_S = CC2_REPLAY_KEY_BITS.S;
const KEY_W = CC2_REPLAY_KEY_BITS.W;
const STEP_TICKS = 12;
const IDLE_TICKS = 7;
const PADDING_DELAY = 0xff;
const PADDING_PAIR_COUNT = 40;
const UNKNOWN_KEY_BIT = 0x20;
const SAMPLE_LEAD_BYTE = 0xa6;

type Entry = [delay: number, keys: number];

/** Builds a stream: 3 header bytes, then (delay, keys) pairs. */
function streamOf(entries: readonly Entry[], lead = 0, floor = 0, seed = 0): Uint8Array {
  return Uint8Array.from([lead, floor, seed, ...entries.flat()]);
}

function packed(stream: Uint8Array): Cc2RawSection {
  return { kind: 'raw', tag: C2M_TAGS.packedReplay, data: packC2m(stream) };
}

function plain(stream: Uint8Array): Cc2RawSection {
  return { kind: 'raw', tag: C2M_TAGS.replay, data: stream };
}

/** Two steps east, a pause, one step south, release. */
const WALK: Entry[] = [
  [0, 0],
  [0, KEY_E],
  [STEP_TICKS * 2, 0],
  [IDLE_TICKS, KEY_S],
  [STEP_TICKS, 0]
];

/** Expected move, with ticks derived from frames (3 frames per tick). */
function move(direction: string, startFrame: number, durationFrames: number, open = false) {
  const startTick = Math.floor(startFrame / 3);
  const m: Record<string, unknown> = {
    direction,
    startFrame,
    startTick,
    durationFrames,
    durationTicks: Math.floor((startFrame + durationFrames) / 3) - startTick
  };
  if (open) m.open = true;
  return m;
}

describe('decodeCc2Replay', () => {
  it('turns key state changes into ordered moves with tick timing', () => {
    const replay = decodeCc2Replay(packed(streamOf(WALK)));
    expect(replay.inputs.map((i) => i.frame)).toEqual([0, 0, 24, 31, 43]);
    expect(replay.inputs.map((i) => i.tick)).toEqual([0, 0, 8, 10, 14]);
    expect(replay.players).toHaveLength(1);
    expect(replay.players[0].moves).toEqual([move('E', 0, 24), move('S', 31, 12)]);
    expect(replay.totalFrames).toBe(43);
    expect(replay.totalTicks).toBe(14);
  });

  it('reads an uncompressed REPL stream the same way', () => {
    const stream = streamOf(WALK);
    expect(decodeCc2Replay(plain(stream)).players).toEqual(decodeCc2Replay(packed(stream)).players);
  });

  it('merges a direction that stays held across entries', () => {
    const entries: Entry[] = [[0, KEY_W], [STEP_TICKS, KEY_W], [STEP_TICKS, KEY_W], [STEP_TICKS, 0]];
    const replay = decodeCc2Replay(plain(streamOf(entries)));
    expect(replay.players[0].moves).toEqual([move('W', 0, STEP_TICKS * 3)]);
  });

  it('lists simultaneous directions in N, E, S, W order', () => {
    const replay = decodeCc2Replay(plain(streamOf([[0, KEY_N | KEY_E], [STEP_TICKS, 0]])));
    expect(replay.players[0].moves.map((m) => m.direction)).toEqual(['N', 'E']);
    expect(cc2KeysToDirections(KEY_S | KEY_W)).toEqual(['S', 'W']);
  });

  it('flags a direction still held when the stream ends', () => {
    const replay = decodeCc2Replay(plain(streamOf([[0, 0], [5, KEY_N], [STEP_TICKS, KEY_N]])));
    expect(replay.players[0].moves).toEqual([move('N', 5, STEP_TICKS, true)]);
  });

  it('drops the trailing padding made of (0,0),(255,0) pairs', () => {
    const padding: Entry[] = [];
    for (let i = 0; i < PADDING_PAIR_COUNT; i++) padding.push([0, 0], [PADDING_DELAY, 0]);
    const replay = decodeCc2Replay(packed(streamOf([...WALK, ...padding])));
    expect(replay.paddingEntries).toBe(PADDING_PAIR_COUNT * 2 - 1);
    expect(replay.inputs).toHaveLength(WALK.length + 1);
    expect(replay.totalFrames).toBe(43);
  });

  it('stops at the first entry whose delay is 0xFF', () => {
    const entries: Entry[] = [[0, 0], [3, KEY_E], [4, 0], [PADDING_DELAY, 0], [3, KEY_W], [4, 0]];
    const replay = decodeCc2Replay(plain(streamOf(entries)));
    expect(replay.paddingEntries).toBe(3);
    expect(replay.players[0].moves).toEqual([move('E', 3, 4)]);
  });

  it('parses the header fields', () => {
    const replay = decodeCc2Replay(plain(streamOf([[0, 0]], SAMPLE_LEAD_BYTE, 2, 0x5c)));
    expect(replay.leadByte).toBe(SAMPLE_LEAD_BYTE);
    expect(replay.forceFloorStart).toBe(2);
    expect(replay.blobSeed).toBe(0x5c);
    expect(replay.unpacked).toBe(true);
  });

  it('reports a dangling byte without failing', () => {
    const stream = Uint8Array.from([SAMPLE_LEAD_BYTE, 0, 0, 0, KEY_E, 9]);
    const replay = decodeCc2Replay(plain(stream));
    expect(replay.danglingByte).toBe(true);
    expect(replay.inputs).toHaveLength(1);
  });

  it('exposes key bits that are not directions', () => {
    const replay = decodeCc2Replay(plain(streamOf([[0, KEY_E | UNKNOWN_KEY_BIT], [STEP_TICKS, 0]])));
    expect(replay.otherKeyBits).toBe(UNKNOWN_KEY_BIT);
    expect(replay.players[0].moves.map((m) => m.direction)).toEqual(['E']);
  });

  it('handles empty and header-only streams', () => {
    expect(decodeCc2Replay(plain(new Uint8Array(0))).inputs).toEqual([]);
    expect(decodeCc2Replay(plain(Uint8Array.of(0))).players[0].moves).toEqual([]);
  });

  it('reports a PRPL block that does not unpack instead of decoding it', () => {
    const broken: Cc2RawSection = {
      kind: 'raw',
      tag: C2M_TAGS.packedReplay,
      data: Uint8Array.of(0x10, 0x00, 0x81, 0x01)
    };
    const replay = decodeCc2Replay(broken);
    expect(replay.unpacked).toBe(false);
    expect(replay.inputs).toEqual([]);
  });

  it('finds replay sections inside a file', () => {
    const bytes = encodeC2m({
      sections: [packed(streamOf(WALK)), { kind: 'raw', tag: C2M_TAGS.end, data: new Uint8Array(0) }],
      trailing: new Uint8Array(0)
    });
    const sections = cc2ReplaySections(decodeC2m(bytes));
    expect(sections).toHaveLength(1);
    expect(decodeCc2Replay(sections[0]).players[0].moves).toHaveLength(2);
  });
});
