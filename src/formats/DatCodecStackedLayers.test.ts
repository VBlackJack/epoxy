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

import { DatCodec } from './DatCodec';
import { GameEngine } from '../core/GameEngine';
import { LevelValidator } from '../core/LevelValidator';
import { DEFAULT_RULESET } from '../core/coreConstants';
import type { Ruleset } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** CCLP 2, inlined by Vite as a base64 data URL so the test needs no file system access. */
const CCLP2_DATA_URL = Object.values(
  import.meta.glob('../../public/packs/CCLP2.DAT', { query: '?inline', import: 'default', eager: true })
)[0] as string;

/** Pack header (magic and level count), then the level record: length word, number, time, chips, map detail. */
const LAYER_LENGTH = 1024;
const LAYER_WIDTH = 32;
const HEADER_BYTES = 6;
/** Offset of the first layer length word inside a level record, counted from the record length word. */
const LAYERS_OFFSET = 10;

/** Codes of the CC1 tiles the combinations below use. */
const CODE = { floor: 0, wall: 1, chip: 2, exit: 21, socket: 34, dirt: 11, blueFake: 30, ice: 12, doorRed: 23 };

/** Packs one level whose two layers are given as sparse maps of cell index to code (everything else is floor). */
function packWithCells(top: Record<number, number>, bottom: Record<number, number>, chips = 0): ArrayBuffer {
  const layer = (cells: Record<number, number>): Uint8Array => {
    const out = new Uint8Array(LAYER_LENGTH);
    for (const [idx, code] of Object.entries(cells)) out[Number(idx)] = code;
    return out;
  };
  const l1 = layer(top);
  const l2 = layer(bottom);
  const size = 8 + 2 + LAYER_LENGTH + 2 + LAYER_LENGTH + 2;
  const bytes = new Uint8Array(HEADER_BYTES + 2 + size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x0002aaac, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, size, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 100, true);
  view.setUint16(12, chips, true);
  view.setUint16(14, 1, true);
  let pos = HEADER_BYTES + LAYERS_OFFSET;
  view.setUint16(pos, LAYER_LENGTH, true);
  bytes.set(l1, pos + 2);
  pos += 2 + LAYER_LENGTH;
  view.setUint16(pos, LAYER_LENGTH, true);
  bytes.set(l2, pos + 2);
  pos += 2 + LAYER_LENGTH;
  view.setUint16(pos, 0, true);
  return bytes.buffer;
}

const LYNX_RULESET: Ruleset = 'lynx';
const cell = (x: number, y: number): number => y * LAYER_WIDTH + x;

function cclp2() {
  const base64 = CCLP2_DATA_URL.slice(CCLP2_DATA_URL.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return DatCodec.decodeBuffer(bytes.buffer, 'cclp2', DEFAULT_RULESET);
}

describe('DatCodec stacked layers (Epoxy reading)', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('turns an item over a wall into an item on a recessed wall', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.chip }, { [cell(5, 5)]: CODE.wall }), 't', DEFAULT_RULESET);
    expect(level.items[5][5]).toBe('chip');
    expect(level.terrain[5][5]).toBe('recessed_wall');
  });

  it('turns an item over another solid tile into an item on open floor', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.chip }, { [cell(5, 5)]: 5 }), 't', DEFAULT_RULESET);
    expect(level.terrain[5][5]).toBe('floor');
  });

  it('closes the wall behind the player once the chip is taken', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.chip }, { [cell(5, 5)]: CODE.wall }, 1), 't', DEFAULT_RULESET);
    level.playerStart = { x: 4, y: 5, dir: 'E' };
    level.terrain[5][4] = 'floor';
    const engine = new GameEngine();
    engine.loadLevel(level);
    const move = (dir: 'E' | 'W'): void => {
      for (let waited = 0; !engine.attemptPlayerMove(dir); waited++) {
        if (waited > 40) throw new Error('move refused');
        engine.tick();
      }
      engine.tick();
    };
    move('E');
    expect(engine.getPlayer().x).toBe(5);
    move('W');
    for (let i = 0; i < 40; i++) engine.tick();
    expect(engine.getTerrain()[5][5]).toBe('wall');
  });

  it('hides the terrain under a socket as an underlay', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.socket }, { [cell(5, 5)]: CODE.exit }), 't', DEFAULT_RULESET);
    expect(level.terrain[5][5]).toBe('socket');
    expect(level.underlays).toEqual([{ x: 5, y: 5, terrain: 'exit' }]);
  });

  it('hides terrain under dirt and under a fake wall', () => {
    const [level] = DatCodec.decodeBuffer(
      packWithCells({ [cell(5, 5)]: CODE.dirt, [cell(6, 5)]: CODE.blueFake }, { [cell(5, 5)]: CODE.ice, [cell(6, 5)]: CODE.ice }),
      't',
      DEFAULT_RULESET
    );
    expect(level.underlays).toEqual([
      { x: 5, y: 5, terrain: 'ice' },
      { x: 6, y: 5, terrain: 'ice' }
    ]);
  });

  it('leaves a non-removable top alone: nothing is hidden under a wall', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.wall }, { [cell(5, 5)]: CODE.ice }), 't', DEFAULT_RULESET);
    expect(level.terrain[5][5]).toBe('wall');
    expect(level.underlays).toBeUndefined();
  });

  it('keeps an item under a terrain top on the cell', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.blueFake }, { [cell(5, 5)]: CODE.chip }), 't', DEFAULT_RULESET);
    expect(level.terrain[5][5]).toBe('blue_wall_fake');
    expect(level.items[5][5]).toBe('chip');
  });

  it('does not touch the Lynx reading, which ignores the lower layer under a non-creature', () => {
    const [level] = DatCodec.decodeBuffer(packWithCells({ [cell(5, 5)]: CODE.socket, [cell(6, 5)]: CODE.chip }, { [cell(5, 5)]: CODE.exit, [cell(6, 5)]: CODE.wall }), 't', LYNX_RULESET);
    expect(level.underlays).toBeUndefined();
    expect(level.terrain[5][5]).toBe('socket');
    expect(level.terrain[5][6]).toBe('floor');
    expect(level.items[5][6]).toBe('chip');
  });

  it('decodes CCLP2 level 17 with its chips on enterable cells and no unreachable chips', () => {
    const level = cclp2().find((l) => l.number === 17)!;
    for (const [x, y] of [[19, 8], [23, 8], [17, 9], [21, 9], [17, 23], [21, 23], [19, 24], [23, 24]]) {
      expect(level.items[y][x]).toBe('chip');
      expect(level.terrain[y][x]).toBe('recessed_wall');
    }
    const keys = LevelValidator.validate(level).issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey);
    expect(keys).not.toContain('validator.issues.unreachable_chips.label');
    expect(keys).not.toContain('validator.issues.unreachable_exit.label');
  });

  it('decodes CCLP2 level 85 with recessed walls under its chips and nothing unreachable', () => {
    const level = cclp2().find((l) => l.number === 85)!;
    const count = level.items.flat().filter((i) => i === 'chip').length;
    expect(count).toBeGreaterThan(0);
    expect(level.terrain.flat().filter((t) => t === 'recessed_wall').length).toBeGreaterThan(0);
    const keys = LevelValidator.validate(level).issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey);
    expect(keys).not.toContain('validator.issues.unreachable_chips.label');
    expect(keys).not.toContain('validator.issues.unreachable_exit.label');
  });

  it('decodes CCLP2 level 15 with its exit hidden under a socket and reachable', () => {
    const level = cclp2().find((l) => l.number === 15)!;
    const hiddenExits = (level.underlays ?? []).filter((u) => u.terrain === 'exit');
    expect(hiddenExits.length).toBeGreaterThan(0);
    for (const u of hiddenExits) expect(level.terrain[u.y][u.x]).toBe('socket');
    const keys = LevelValidator.validate(level).issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey);
    expect(keys).not.toContain('validator.issues.unreachable_exit.label');
  });
});
