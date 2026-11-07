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

import { unpackC2m } from './C2mCodec';
import { C2M_TAGS, C2mFormatError, type Cc2RawSection } from './cc2Model';

/**
 * Replay decoder for the REPL and PRPL sections of a C2M file.
 *
 * What was established on the 200 official replays:
 * - PRPL holds the same block compression as PACK (uint16 unpacked size, then
 *   literal runs and back-references); 197 of 197 unpack to exactly their size.
 *   REPL (3 files) holds the stream uncompressed.
 * - The stream is a 3-byte header (byte 0 unknown, byte 1 the starting random
 *   force floor direction 0-3, byte 2 the blob RNG seed) followed by 2-byte
 *   entries (delay, keys). Each entry sets the key state `delay` frames after
 *   the previous one. Frames run at 60 Hz, 3 frames per game tick (20 ticks/s).
 * - A delay of 0xFF ends the stream; what follows is padding (in practice the
 *   pair (0,0),(255,0) repeated).
 * - Four key bits carry the directions. The mapping was fitted by regressing
 *   the net displacement start-to-exit of 154 single-player levels on the held
 *   time of each bit: 0x02 south, 0x04 west, 0x08 east, 0x10 north gave a
 *   correlation of 0.62, the next best assignment 0.35.
 *
 * Not established: byte 0 of the header and how a second player is encoded
 * (bit 0x80 probably marks player 2). Those are kept raw or reported as such.
 */

export type Cc2Direction = 'N' | 'E' | 'S' | 'W';

/** Key bits that carry a direction (confidence: medium, see the file header). */
export const CC2_REPLAY_KEY_BITS: Readonly<Record<Cc2Direction, number>> = {
  S: 0x02,
  W: 0x04,
  E: 0x08,
  N: 0x10
};

/** Non-direction key bits. Drop, switch player and cycle inventory are high confidence by report; the player 2 bit is likely only. */
export const CC2_REPLAY_ACTION_BITS = {
  drop: 0x01,
  switchPlayer: 0x20,
  cycleInventory: 0x40,
  player2: 0x80
} as const;

/** Game frames (replay delay unit) per game tick. */
export const CC2_FRAMES_PER_TICK = 3;

/** Order in which simultaneous moves are listed. */
const DIRECTION_ORDER: readonly Cc2Direction[] = ['N', 'E', 'S', 'W'];

/** How sure the decoder is of each field. */
export type Cc2Confidence = 'certain' | 'high' | 'medium' | 'low' | 'unknown';

export const CC2_REPLAY_CONFIDENCE: Readonly<Record<string, Cc2Confidence>> = {
  compression: 'certain',
  entryLayout: 'high',
  delaySemantics: 'high',
  padding: 'high',
  directionBits: 'medium',
  tickRate: 'high',
  actionBits: 'medium',
  player2Bit: 'low',
  header: 'medium',
  leadByte: 'unknown',
  multiplePlayers: 'unknown'
};

/** Header bytes before the first entry. */
const REPLAY_HEADER_BYTES = 3;
const HEADER_FORCE_FLOOR_AT = 1;
const HEADER_BLOB_SEED_AT = 2;
/** One entry: delay byte then key byte. */
const REPLAY_ENTRY_BYTES = 2;
/** Padding pair: a zero entry followed by a 255-tick idle entry. */
const END_DELAY = 0xff;

/** One key state change. */
export interface Cc2ReplayInput {
  /** Frame (60 Hz) at which the state starts, counted from the first entry. */
  frame: number;
  /** Same instant in game ticks (frame / 3, rounded down). */
  tick: number;
  /** Raw key bits. */
  keys: number;
}

/** A direction held without interruption. */
export interface Cc2ReplayMove {
  direction: Cc2Direction;
  startFrame: number;
  startTick: number;
  /** Frames the direction stayed held (a lower bound when `open`). */
  durationFrames: number;
  durationTicks: number;
  /** True when the stream ended before the key was released. */
  open?: true;
}

export interface Cc2ReplayPlayer {
  player: number;
  moves: Cc2ReplayMove[];
}

export interface Cc2Replay {
  tag: string;
  /** Stream bytes after decompression. */
  stream: Uint8Array;
  /** False when a PRPL block could not be unpacked; then nothing else is decoded. */
  unpacked: boolean;
  /** Header byte 0, meaning not established. */
  leadByte: number;
  /** Starting direction of random force floors, 0-3 (header byte 1). */
  forceFloorStart: number;
  /** Seed of the blob generator (header byte 2). */
  blobSeed: number;
  /** Key state changes, padding removed. */
  inputs: Cc2ReplayInput[];
  /** Frame of the last entry before the end marker. */
  totalFrames: number;
  totalTicks: number;
  /** Number of entries dropped from the end marker on. */
  paddingEntries: number;
  /** True when the stream had a stray byte after the last full entry. */
  danglingByte: boolean;
  /** Union of every key bit seen that is not a direction bit. */
  otherKeyBits: number;
  /** One stream only: how a second player is encoded is not established. */
  players: Cc2ReplayPlayer[];
}

const ALL_DIRECTION_BITS = DIRECTION_ORDER.reduce((mask, d) => mask | CC2_REPLAY_KEY_BITS[d], 0);

/** Splits key bits into the directions they hold, in N, E, S, W order. */
export function cc2KeysToDirections(keys: number): Cc2Direction[] {
  return DIRECTION_ORDER.filter((direction) => (keys & CC2_REPLAY_KEY_BITS[direction]) !== 0);
}

/** Unpacked stream, or null when a PRPL block cannot be unpacked. */
function readStream(section: Cc2RawSection): Uint8Array | null {
  if (section.tag !== C2M_TAGS.packedReplay) return section.data;
  try {
    return unpackC2m(section.data);
  } catch (error) {
    if (error instanceof C2mFormatError) return null;
    throw error;
  }
}

const toTicks = (frames: number): number => Math.floor(frames / CC2_FRAMES_PER_TICK);

/** Builds the per-player move lists from the key state changes. */
function movesFromInputs(inputs: readonly Cc2ReplayInput[], endFrame: number): Cc2ReplayMove[] {
  const moves: Cc2ReplayMove[] = [];
  const open = new Map<Cc2Direction, Cc2ReplayMove>();
  const close = (move: Cc2ReplayMove, frame: number): void => {
    move.durationFrames = frame - move.startFrame;
    move.durationTicks = toTicks(frame) - move.startTick;
  };
  for (const input of inputs) {
    for (const direction of DIRECTION_ORDER) {
      const held = (input.keys & CC2_REPLAY_KEY_BITS[direction]) !== 0;
      const current = open.get(direction);
      if (held && !current) {
        const move: Cc2ReplayMove = {
          direction,
          startFrame: input.frame,
          startTick: input.tick,
          durationFrames: 0,
          durationTicks: 0,
          open: true
        };
        open.set(direction, move);
        moves.push(move);
      } else if (!held && current) {
        close(current, input.frame);
        delete current.open;
        open.delete(direction);
      }
    }
  }
  // Still held at the end of the stream: the durations are lower bounds.
  for (const move of open.values()) close(move, endFrame);
  return moves;
}

/** Decodes a REPL or PRPL section. */
export function decodeCc2Replay(section: Cc2RawSection): Cc2Replay {
  const unpackedStream = readStream(section);
  const stream = unpackedStream ?? new Uint8Array(0);
  const entryBytes = Math.max(0, stream.length - REPLAY_HEADER_BYTES);
  const danglingByte = entryBytes % REPLAY_ENTRY_BYTES !== 0;
  const entryCount = Math.floor(entryBytes / REPLAY_ENTRY_BYTES);

  const inputs: Cc2ReplayInput[] = [];
  let frame = 0;
  let otherKeyBits = 0;
  let used = 0;
  for (; used < entryCount; used++) {
    const at = REPLAY_HEADER_BYTES + used * REPLAY_ENTRY_BYTES;
    if (stream[at] === END_DELAY) break;
    frame += stream[at];
    const keys = stream[at + 1];
    otherKeyBits |= keys & ~ALL_DIRECTION_BITS;
    inputs.push({ frame, tick: toTicks(frame), keys });
  }
  return {
    tag: section.tag,
    stream,
    unpacked: unpackedStream !== null,
    leadByte: stream[0] ?? 0,
    forceFloorStart: stream[HEADER_FORCE_FLOOR_AT] ?? 0,
    blobSeed: stream[HEADER_BLOB_SEED_AT] ?? 0,
    inputs,
    totalFrames: frame,
    totalTicks: toTicks(frame),
    paddingEntries: entryCount - used,
    danglingByte,
    otherKeyBits,
    players: [{ player: 0, moves: movesFromInputs(inputs, frame) }]
  };
}
