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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { findMonsterBehaviourConfigErrors, findPushArrowConfigErrors, normalizeCellEdges } from '../../config/ConfigValidation';
import { PACK_JSON_VERSION_V13, PACK_JSON_VERSION_V13_IDS } from '../../config/constants';
import en from '../../locales/en.json';
import fr from '../../locales/fr.json';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CELL_EDGE_CANOPY_BIT, LOCKED_ARROW_BLOCK_ID } from '../coreConstants';
import { cellEdgeMask, cellHasCanopy, levelHasCanopy } from '../EdgeRules';
import { GameEngine } from '../GameEngine';
import type { CellEdge, CompiledLevel, Direction, EntityPlacement } from '../types';

const SIZE = 9;
const MID = 4;
const TIME_LIMIT_SECONDS = 1000;
const MONSTER_RUN_TICKS = 120;
const SLIDE_RUN_TICKS = 40;
const MAX_WAIT_TICKS = 40;
const PUSH_ATTEMPTS = 6;

interface Setup {
  entities: EntityPlacement[];
  terrain?: Array<[number, number, string]>;
  cellEdges?: CellEdge[];
  player?: { x: number; y: number };
}

/** Walled floor room; the player stands in a corner unless the setup says otherwise. */
function room(setup: Setup): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'cc2_canopy_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? { x: 1, y: SIZE - 2 }), dir: 'N' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities,
    trapLinks: [],
    cloneLinks: [],
    ...(setup.cellEdges ? { cellEdges: setup.cellEdges } : {})
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function run(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function cellOf(engine: GameEngine, type: string): string {
  const found = engine.getEntities().find((e) => e.type === type);
  return found ? `${found.x},${found.y}` : 'gone';
}

/** Ticks until the player may move, then moves. */
function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

const canopyAt = (x: number, y: number): CellEdge => ({ x, y, sides: [], canopy: true });

beforeEach(() => {
  loadTestConfigs();
});

describe('canopy: cell edge data', () => {
  it('keeps a canopy with no side in canonical form and drops an empty entry', () => {
    const terrain = room({ entities: [] }).terrain;
    const edges = normalizeCellEdges([{ x: 2, y: 2, sides: ['W'], canopy: true }, canopyAt(3, 3), { x: 4, y: 4, sides: [] }], terrain, 'epoxy');
    expect(edges).toEqual([
      { x: 2, y: 2, sides: ['W'], canopy: true },
      { x: 3, y: 3, sides: [], canopy: true }
    ]);
    expect(normalizeCellEdges([{ x: 2, y: 2, sides: ['W'] }], terrain, 'epoxy')).toEqual([{ x: 2, y: 2, sides: ['W'] }]);
  });

  it('puts the canopy in its own bit and leaves thin walls alone', () => {
    const level = room({ entities: [], cellEdges: [canopyAt(3, 3), { x: 5, y: 5, sides: ['N'] }] });
    const mask = cellEdgeMask(level);
    expect(mask).not.toBeNull();
    expect(mask![3 * SIZE + 3]).toBe(CELL_EDGE_CANOPY_BIT);
    expect(cellHasCanopy(mask, SIZE, 3, 3)).toBe(true);
    expect(cellHasCanopy(mask, SIZE, 5, 5)).toBe(false);
    expect(levelHasCanopy(level)).toBe(true);
    expect(levelHasCanopy(room({ entities: [], cellEdges: [{ x: 5, y: 5, sides: ['N'] }] }))).toBe(false);
  });

  it('does not stop the player: a canopy is no thin wall', () => {
    const engine = load(room({ entities: [], cellEdges: [canopyAt(1, SIZE - 3)], player: { x: 1, y: SIZE - 2 } }));
    expect(step(engine, 'N')).toBe(true);
    expect(engine.getPlayer().y).toBe(SIZE - 3);
    expect(engine.getCanopyCells().has((SIZE - 3) * SIZE + 1)).toBe(true);
  });

  it('writes pack format 13 for a level with a canopy, and reads it back', () => {
    const plain = room({ entities: [], cellEdges: [{ x: 5, y: 5, sides: ['N'] }] });
    const roofed = room({ entities: [], cellEdges: [canopyAt(3, 3)] });
    expect(JSON.parse(serializePack('p', [plain])).version).toBeLessThan(PACK_JSON_VERSION_V13);
    const text = serializePack('p', [roofed]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V13);
    const back = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set<string>(), Date.now, undefined, ConfigRegistry.getLevelTextLimits());
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.levels[0].cellEdges).toEqual([canopyAt(3, 3)]);
  });
});

describe('canopy: monsters', () => {
  /** A monster facing east in a corridor, with a canopy ahead; true when it ever reaches that cell. */
  function reachesCanopy(type: string, withCanopy: boolean): boolean {
    const terrain: Array<[number, number, string]> = [];
    for (let x = 1; x < SIZE - 1; x++) {
      terrain.push([x, MID - 1, 'wall'], [x, MID + 1, 'wall']);
    }
    const engine = load(
      room({
        entities: [{ type, x: 1, y: MID, dir: 'E' }],
        terrain,
        ...(withCanopy ? { cellEdges: [canopyAt(MID, MID)] } : {})
      })
    );
    for (let i = 0; i < MONSTER_RUN_TICKS; i++) {
      engine.tick();
      const found = engine.getEntities().find((e) => e.type === type);
      if (found && found.x === MID && found.y === MID) return true;
    }
    return false;
  }

  it('lets a bug and a rover through the corridor without a canopy', () => {
    expect(reachesCanopy('bug', false)).toBe(true);
    expect(reachesCanopy('rover', false)).toBe(true);
  });

  it('stops a bug and a rover at a canopy', () => {
    expect(reachesCanopy('bug', true)).toBe(false);
    expect(reachesCanopy('rover', true)).toBe(false);
  });

  it('does not stop the other monsters', () => {
    expect(reachesCanopy('glider', true)).toBe(true);
  });

  it('keeps a blob from stepping from one canopy to another, and lets it step out of a canopy', () => {
    // A blob in a closed pocket of two cells: with both under a canopy it never leaves its cell.
    const pocket = (cellEdges: CellEdge[]): GameEngine => {
      const terrain: Array<[number, number, string]> = [];
      for (let y = MID - 1; y <= MID + 1; y++) for (let x = MID - 1; x <= MID + 2; x++) terrain.push([x, y, 'wall']);
      terrain.push([MID, MID, 'floor'], [MID + 1, MID, 'floor']);
      return load(room({ entities: [{ type: 'blob', x: MID, y: MID, dir: 'E' }], terrain, cellEdges }));
    };
    const visited = (engine: GameEngine): Set<string> => {
      const seen = new Set<string>();
      for (let i = 0; i < MONSTER_RUN_TICKS; i++) {
        engine.tick();
        seen.add(cellOf(engine, 'blob'));
      }
      return seen;
    };
    expect([...visited(pocket([canopyAt(MID, MID), canopyAt(MID + 1, MID)]))]).toEqual([`${MID},${MID}`]);
    expect(visited(pocket([canopyAt(MID, MID)])).has(`${MID + 1},${MID}`)).toBe(true);
    expect(visited(pocket([])).has(`${MID + 1},${MID}`)).toBe(true);
  });

  it('names the canopy fields in the configs and passes the behaviour checks', () => {
    expect(ConfigRegistry.getEntityDef('bug')?.blockedByCanopy).toBe(true);
    expect(ConfigRegistry.getEntityDef('rover')?.blockedByCanopy).toBe(true);
    expect(ConfigRegistry.getEntityDef('blob')?.blockedBetweenCanopies).toBe(true);
    expect(findMonsterBehaviourConfigErrors(ConfigRegistry.getTiles().tiles, ConfigRegistry.getMonsters().entities)).toEqual([]);
  });
});

describe('locked arrow block', () => {
  it('is a block with an empty arrow list, texts in both languages, and format 13', () => {
    const def = ConfigRegistry.getEntityDef(LOCKED_ARROW_BLOCK_ID);
    expect(def?.kind).toBe('block');
    expect(def?.pushArrows).toEqual([]);
    expect(typeof en.entities.arrow_block_none.name).toBe('string');
    expect(typeof fr.entities.arrow_block_none.name).toBe('string');
    expect(PACK_JSON_VERSION_V13_IDS.has(LOCKED_ARROW_BLOCK_ID)).toBe(true);
    expect(findPushArrowConfigErrors(ConfigRegistry.getMonsters().entities)).toEqual([]);
  });

  it('may push others along like the other arrow blocks, and no block lists it', () => {
    const defs = ConfigRegistry.getMonsters().entities;
    expect(defs[LOCKED_ARROW_BLOCK_ID].chainPushes).toEqual(defs.arrow_block_one.chainPushes);
    for (const [id, def] of Object.entries(defs)) {
      if (id !== LOCKED_ARROW_BLOCK_ID) expect(def.chainPushes ?? [], id).not.toContain(LOCKED_ARROW_BLOCK_ID);
    }
  });

  it('still refuses an empty arrow list on any other block', () => {
    const entities = structuredClone(ConfigRegistry.getMonsters().entities);
    entities.arrow_block_one = { ...entities.arrow_block_one, pushArrows: [] };
    expect(findPushArrowConfigErrors(entities)).toHaveLength(1);
  });

  it('cannot be pushed by the player from any side', () => {
    for (const dir of ['N', 'E', 'S', 'W'] as const) {
      const dx = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
      const dy = dir === 'S' ? 1 : dir === 'N' ? -1 : 0;
      const engine = load(room({ entities: [{ type: LOCKED_ARROW_BLOCK_ID, x: MID, y: MID, dir: 'N' }], player: { x: MID - dx, y: MID - dy } }));
      for (let i = 0; i < PUSH_ATTEMPTS; i++) step(engine, dir);
      expect(cellOf(engine, LOCKED_ARROW_BLOCK_ID), dir).toBe(`${MID},${MID}`);
    }
  });

  it('is not pushed along by an arrow block in front of the player', () => {
    const engine = load(
      room({
        entities: [
          { type: 'arrow_block_line', x: MID - 1, y: MID, dir: 'E' },
          { type: LOCKED_ARROW_BLOCK_ID, x: MID, y: MID, dir: 'N' }
        ],
        player: { x: MID - 2, y: MID }
      })
    );
    for (let i = 0; i < PUSH_ATTEMPTS; i++) step(engine, 'E');
    expect(cellOf(engine, LOCKED_ARROW_BLOCK_ID)).toBe(`${MID},${MID}`);
    expect(cellOf(engine, 'arrow_block_line')).toBe(`${MID - 1},${MID}`);
  });

  it('still slides once it moves on a force floor', () => {
    const engine = load(
      room({
        entities: [{ type: LOCKED_ARROW_BLOCK_ID, x: MID, y: MID, dir: 'E' }],
        terrain: [
          [MID, MID, 'force_e'],
          [MID + 1, MID, 'force_e']
        ]
      })
    );
    // Only a push, a teleport or a clone puts a block in motion; the slide itself ignores the missing arrows.
    const block = engine.getEntities().find((e) => e.type === LOCKED_ARROW_BLOCK_ID);
    if (!block) throw new Error('the locked block was not placed');
    block.isSliding = true;
    block.cooldownTicks = 0;
    run(engine, SLIDE_RUN_TICKS);
    expect(cellOf(engine, LOCKED_ARROW_BLOCK_ID)).not.toBe(`${MID},${MID}`);
  });
});
