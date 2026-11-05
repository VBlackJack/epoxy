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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, SignalLink, ValidationIssue } from './types';

const SIZE = 11;
const KEY_PREFIX = 'validator.issues.';
const SIGNAL_KEY_MARK = 'signal_';
const PLATE = 'signal_plate';
const AND = 'signal_gate_and';
const OR = 'signal_gate_or';
const NOT = 'signal_gate_not';
const XOR = 'signal_gate_xor';
const LATCH = 'signal_latch_off';
const DOOR = 'hold_door_red_closed';

type Cell = { x: number; y: number };
const P1: Cell = { x: 2, y: 8 };
const P2: Cell = { x: 4, y: 8 };
const GATE: Cell = { x: 3, y: 6 };
const GATE_B: Cell = { x: 5, y: 6 };
const DOOR_CELL: Cell = { x: 3, y: 4 };
const EMITTER: Cell = { x: 1, y: 2 };
const BEAM_DOOR: Cell = { x: 3, y: 2 };
const RECEIVER: Cell = { x: 5, y: 2 };
const EXIT_CELL: Cell = { x: 9, y: 9 };
const START: Cell = { x: 8, y: 8 };

const link = (from: Cell, to: Cell): SignalLink => ({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });

function room(terrain: Array<[Cell, string]>, links: SignalLink[], ruleset: 'epoxy' | 'lynx' = 'epoxy'): CompiledLevel {
  const grid: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  grid[EXIT_CELL.y][EXIT_CELL.x] = 'exit';
  for (const [cell, id] of terrain) grid[cell.y][cell.x] = id;
  return {
    id: 'signal_validator_room',
    number: 1,
    password: 'TEST',
    ruleset,
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...START, dir: 'E' },
    terrain: grid,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks: links
  };
}

function issuesOf(level: CompiledLevel): ValidationIssue[] {
  return LevelValidator.validate(level).issues;
}

function find(level: CompiledLevel, key: string): ValidationIssue | undefined {
  return issuesOf(level).find((issue) => issue.i18nKey === `${KEY_PREFIX}${key}.label`);
}

const signalIssues = (level: CompiledLevel): ValidationIssue[] =>
  issuesOf(level).filter((issue) => issue.i18nKey.includes(SIGNAL_KEY_MARK));

beforeEach(() => loadTestConfigs());

describe('signal wiring checks', () => {
  it('reports nothing on a clean plate, AND gate and door wiring', () => {
    const level = room(
      [[P1, PLATE], [P2, PLATE], [GATE, AND], [DOOR_CELL, DOOR]],
      [link(P1, GATE), link(P2, GATE), link(GATE, DOOR_CELL)]
    );
    expect(signalIssues(level)).toEqual([]);
    expect(issuesOf(level).filter((i) => i.i18nKey.includes('hold_door'))).toEqual([]);
  });

  it('refuses a hold door with more than one input, located', () => {
    const level = room([[P1, PLATE], [P2, PLATE], [DOOR_CELL, DOOR]], [link(P1, DOOR_CELL), link(P2, DOOR_CELL)]);
    const issue = find(level, 'signal_sink_inputs');
    expect(issue?.severity).toBe('error');
    expect(issue?.params).toMatchObject({ x: DOOR_CELL.x, y: DOOR_CELL.y, count: 1 });
  });

  it('refuses a colour that has both pressure plates and signal doors', () => {
    const level = room([[P1, PLATE], [DOOR_CELL, DOOR], [{ x: 7, y: 7 }, 'pressure_plate_red']], [link(P1, DOOR_CELL)]);
    const issue = find(level, 'signal_colour_mixed');
    expect(issue?.severity).toBe('error');
    expect(issue?.params).toMatchObject({ x: DOOR_CELL.x, y: DOOR_CELL.y });
  });

  it('refuses a NOT gate without exactly one input', () => {
    const none = room([[GATE, NOT], [DOOR_CELL, DOOR]], [link(GATE, DOOR_CELL)]);
    expect(find(none, 'signal_not_inputs')?.severity).toBe('error');
    expect(find(none, 'signal_gate_no_input')).toBeUndefined();
    const two = room(
      [[P1, PLATE], [P2, PLATE], [GATE, NOT], [DOOR_CELL, DOOR]],
      [link(P1, GATE), link(P2, GATE), link(GATE, DOOR_CELL)]
    );
    expect(find(two, 'signal_not_inputs')?.severity).toBe('error');
    const one = room([[P1, PLATE], [GATE, NOT], [DOOR_CELL, DOOR]], [link(P1, GATE), link(GATE, DOOR_CELL)]);
    expect(find(one, 'signal_not_inputs')).toBeUndefined();
  });

  it('refuses an AND, OR, XOR or latch gate with no input', () => {
    for (const gate of [AND, OR, XOR, LATCH]) {
      const level = room([[GATE, gate], [DOOR_CELL, DOOR]], [link(GATE, DOOR_CELL)]);
      const issue = find(level, 'signal_gate_no_input');
      expect(issue?.severity, gate).toBe('error');
      expect(issue?.params, gate).toMatchObject({ x: GATE.x, y: GATE.y, count: 1 });
    }
  });

  it('refuses a cycle between two gates', () => {
    const level = room(
      [[P1, PLATE], [GATE, OR], [GATE_B, OR], [DOOR_CELL, DOOR]],
      [link(P1, GATE), link(GATE, GATE_B), link(GATE_B, GATE), link(GATE_B, DOOR_CELL)]
    );
    const issue = find(level, 'signal_cycle');
    expect(issue?.severity).toBe('error');
    expect(issue?.params).toMatchObject({ x: GATE.x, y: GATE.y, count: 2 });
  });

  it('warns about a link whose ends are not devices', () => {
    const level = room([[P1, PLATE], [DOOR_CELL, DOOR]], [link(P1, DOOR_CELL), link({ x: 6, y: 6 }, DOOR_CELL)]);
    const issue = find(level, 'signal_link_dangling');
    expect(issue?.severity).toBe('warning');
    expect(issue?.params).toMatchObject({ x: 6, y: 6, count: 1 });
  });

  it('warns about a signal plate that drives nothing', () => {
    const level = room([[P1, PLATE], [P2, PLATE], [DOOR_CELL, DOOR]], [link(P1, DOOR_CELL)]);
    const issue = find(level, 'signal_source_unlinked');
    expect(issue?.severity).toBe('warning');
    expect(issue?.params).toMatchObject({ x: P2.x, y: P2.y, count: 1 });
  });

  it('checks nothing under the Lynx rules', () => {
    const level = room([[P1, PLATE], [P2, PLATE], [DOOR_CELL, DOOR]], [link(P1, DOOR_CELL), link(P2, DOOR_CELL)], 'lynx');
    expect(signalIssues(level)).toEqual([]);
  });
});

/** An emitter beams east through a hold door at BEAM_DOOR to a receiver; the receiver drives that door. */
function worldLoop(path: 'direct' | 'not' | 'xor' | 'and' | 'latch'): CompiledLevel {
  const terrain: Array<[Cell, string]> = [[EMITTER, 'laser_emitter_e'], [BEAM_DOOR, DOOR], [RECEIVER, 'laser_receiver_red']];
  if (path === 'direct') return room(terrain, [link(RECEIVER, BEAM_DOOR)]);
  const gate = { not: NOT, xor: XOR, and: AND, latch: LATCH }[path];
  return room([...terrain, [GATE, gate]], [link(RECEIVER, GATE), link(GATE, BEAM_DOOR)]);
}

describe('signal world loops through a laser receiver', () => {
  it('warns when the loop does not invert (the receiver holds its own door open)', () => {
    for (const path of ['direct', 'and'] as const) {
      const level = worldLoop(path);
      const even = find(level, 'signal_world_loop_even');
      expect(even?.severity, path).toBe('warning');
      expect(even?.params, path).toMatchObject({ x: RECEIVER.x, y: RECEIVER.y, count: 1 });
      expect(find(level, 'signal_world_loop_odd'), path).toBeUndefined();
    }
  });

  it('refuses a loop that inverts through a NOT gate (the door would flicker)', () => {
    const level = worldLoop('not');
    const odd = find(level, 'signal_world_loop_odd');
    expect(odd?.severity).toBe('error');
    expect(odd?.params).toMatchObject({ x: RECEIVER.x, y: RECEIVER.y, count: 1 });
    expect(find(level, 'signal_world_loop_even')).toBeUndefined();
  });

  it('counts a path through a XOR gate as an error', () => {
    expect(find(worldLoop('xor'), 'signal_world_loop_odd')?.severity).toBe('error');
  });

  it('gives only the warning for a path through a latch, which is edge-triggered and settles', () => {
    const level = worldLoop('latch');
    expect(find(level, 'signal_world_loop_odd')).toBeUndefined();
    expect(find(level, 'signal_world_loop_even')?.severity).toBe('warning');
  });

  it('gives the same result for two receivers that reach the same door colour', () => {
    const second: Cell = { x: 5, y: 3 };
    const emitter2: Cell = { x: 1, y: 3 };
    const level = room(
      [[EMITTER, 'laser_emitter_e'], [BEAM_DOOR, DOOR], [RECEIVER, 'laser_receiver_red'], [{ x: 3, y: 3 }, DOOR],
        [emitter2, 'laser_emitter_e'], [second, 'laser_receiver_red'], [GATE, NOT]],
      [link(RECEIVER, GATE), link(second, GATE), link(GATE, BEAM_DOOR)]
    );
    const odd = find(level, 'signal_world_loop_odd');
    expect(odd?.severity).toBe('error');
    expect(odd?.params).toMatchObject({ x: RECEIVER.x, y: RECEIVER.y, count: 2 });
  });

  it('reports nothing when the door is not on the beam of its receiver', () => {
    const level = room(
      [[EMITTER, 'laser_emitter_e'], [RECEIVER, 'laser_receiver_red'], [GATE, NOT], [DOOR_CELL, DOOR]],
      [link(RECEIVER, GATE), link(GATE, DOOR_CELL)]
    );
    expect(find(level, 'signal_world_loop_odd')).toBeUndefined();
    expect(find(level, 'signal_world_loop_even')).toBeUndefined();
  });
});

describe('signal-driven doors count as openable', () => {
  const GATED_DOOR: Cell = { x: 6, y: 8 };

  /** A wall column with one hold door in it, between the player and the exit. */
  function gated(links: SignalLink[]): CompiledLevel {
    const wall: Array<[Cell, string]> = [];
    for (let y = 1; y < SIZE - 1; y++) wall.push([{ x: 6, y }, 'wall']);
    return room([...wall, [GATED_DOOR, DOOR], [P1, PLATE]], links);
  }

  it('reports no unreachable exit and no plate-less door when a signal drives the door', () => {
    const level = gated([link(P1, GATED_DOOR)]);
    level.playerStart = { x: 5, y: 8, dir: 'E' };
    const keys = issuesOf(level).map((i) => i.i18nKey);
    expect(keys).not.toContain(`${KEY_PREFIX}unreachable_exit.label`);
    expect(keys).not.toContain(`${KEY_PREFIX}hold_door_no_plate.label`);
    expect(keys).not.toContain(`${KEY_PREFIX}hold_door_wrong_start.label`);
  });

  it('still reports the unreachable exit and the plate-less door when nothing drives the door', () => {
    const level = gated([]);
    level.playerStart = { x: 5, y: 8, dir: 'E' };
    const keys = issuesOf(level).map((i) => i.i18nKey);
    expect(keys).toContain(`${KEY_PREFIX}hold_door_no_plate.label`);
    expect(keys).toContain(`${KEY_PREFIX}unreachable_exit.label`);
  });
});
