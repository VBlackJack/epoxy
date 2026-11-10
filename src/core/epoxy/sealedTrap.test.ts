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
 * Format 17, the sealed trap: a trap that no button, wire or link ever opens. Checked in the engine, in the device
 * relations and in the validator.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { deviceRelations } from '../DeviceRelations';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { CompiledLevel, Direction, EntityPlacement, SignalLink, TrapLink } from '../types';
import type { EpoxyContext } from './epoxyWorld';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const BUTTON_X = 3;
const TRAP_X = 5;
const FAR_CORNER = { x: 9, y: 9 };
const MAX_TICKS = 120;
const MAX_WAIT_TICKS = 40;
const SEALED = 'trap_sealed';
const TRAP = 'trap';
const BUTTON = 'button_brown';
const PREFIX = 'validator.issues.';
const KEY_TRAP_NO_BUTTON = `${PREFIX}trap_no_button.label`;
const KEY_TRAP_BUTTON_NO_TRAP = `${PREFIX}trap_button_no_trap.label`;

interface Setup {
  terrain?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  player?: { x: number; y: number };
  trapLinks?: TrapLink[];
  signalLinks?: SignalLink[];
  cloneLinks?: CompiledLevel['cloneLinks'];
}

/** A walled room; the player stands in the corner unless the setup says otherwise. */
function room(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  return {
    id: 'sealed_trap_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...(setup.player ?? FAR_CORNER), dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: setup.entities ?? [],
    trapLinks: setup.trapLinks ?? [],
    cloneLinks: setup.cloneLinks ?? [],
    ...(setup.signalLinks === undefined ? {} : { signalLinks: setup.signalLinks })
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

function tickFor(engine: GameEngine, ticks: number): void {
  for (let i = 0; i < ticks; i++) engine.tick();
}

/** A lane along the row with a button, a trap of the given id and an optional link between them. */
function laneWith(trapId: string, linked: boolean, extra: Setup = {}): CompiledLevel {
  const level = room({
    terrain: [
      [BUTTON_X, ROW, BUTTON],
      [TRAP_X, ROW, trapId]
    ],
    trapLinks: linked ? [{ buttonX: BUTTON_X, buttonY: ROW, trapX: TRAP_X, trapY: ROW }] : [],
    player: { x: PLAYER_X, y: ROW },
    ...extra
  });
  return level;
}

beforeEach(() => loadTestConfigs());

describe('trap_sealed in the engine', () => {
  it('is closed from the start, and a held brown button does not open it', () => {
    for (const linked of [false, true]) {
      const engine = load(laneWith(SEALED, linked));
      expect(engine.isCellClosedTrap(TRAP_X, ROW), `linked ${linked}`).toBe(true);
      step(engine, 'E');
      expect(engine.getPlayer().x).toBe(BUTTON_X);
      expect(engine.isCellClosedTrap(TRAP_X, ROW), `pressed, linked ${linked}`).toBe(true);
    }
  });

  it('opens the plain trap with the same button, which is what the sealed one refuses', () => {
    const engine = load(laneWith(TRAP, true));
    expect(engine.isCellClosedTrap(TRAP_X, ROW)).toBe(true);
    step(engine, 'E');
    expect(engine.isCellClosedTrap(TRAP_X, ROW)).toBe(false);
  });

  it('holds the player that walks in, however the button is worked', () => {
    const engine = load(laneWith(SEALED, true, { player: { x: BUTTON_X, y: ROW } }));
    expect(engine.getPlayer().x).toBe(BUTTON_X);
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getPlayer().x).toBe(TRAP_X);
    expect(step(engine, 'E')).toBe(false);
    step(engine, 'W');
    expect(engine.getPlayer().x).toBe(TRAP_X);
  });

  it('holds a block pushed into it and a monster that enters it', () => {
    const block = load(laneWith(SEALED, false, { entities: [{ type: 'dirt_block', x: TRAP_X - 1, y: ROW, dir: 'E' }], player: { x: TRAP_X - 2, y: ROW } }));
    step(block, 'E');
    const held = block.getEntities().find((e) => e.kind === 'block');
    expect(held?.x).toBe(TRAP_X);
    expect(block.isCellClosedTrap(TRAP_X, ROW)).toBe(true);
    const monster = load(laneWith(SEALED, false, { entities: [{ type: 'walker', x: TRAP_X - 1, y: ROW, dir: 'E' }], player: FAR_CORNER }));
    tickFor(monster, MAX_TICKS);
    const walker = monster.getEntities().find((e) => e.kind === 'monster');
    expect(walker?.x).toBe(TRAP_X);
  });
});

describe('a wire or a clone machine aimed at a sealed trap', () => {
  it('opens nothing when a signal link ends on it and its plate is pressed', () => {
    const engine = load(
      room({
        terrain: [
          [BUTTON_X, ROW, 'signal_plate'],
          [TRAP_X, ROW, SEALED]
        ],
        signalLinks: [{ fromX: BUTTON_X, fromY: ROW, toX: TRAP_X, toY: ROW }],
        player: { x: PLAYER_X, y: ROW }
      })
    );
    expect(engine.isCellClosedTrap(TRAP_X, ROW)).toBe(true);
    step(engine, 'E');
    tickFor(engine, MAX_TICKS);
    expect(engine.getPlayer().x).toBe(BUTTON_X);
    expect(engine.isCellClosedTrap(TRAP_X, ROW)).toBe(true);
    expect(engine.getTerrain()[ROW][TRAP_X]).toBe(SEALED);
  });

  it('holds the block a clone machine puts into it', () => {
    const engine = load(
      room({
        terrain: [
          [TRAP_X - 1, ROW, 'clone_machine'],
          [8, 8, 'button_red'],
          [TRAP_X, ROW, SEALED]
        ],
        entities: [{ type: 'dirt_block', x: TRAP_X - 1, y: ROW, dir: 'E' }],
        cloneLinks: [{ buttonX: 8, buttonY: 8, clonerX: TRAP_X - 1, clonerY: ROW, templateType: 'dirt_block', templateDir: 'E' }],
        player: FAR_CORNER
      })
    );
    (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(8, 8, 'trigger_cloner');
    tickFor(engine, MAX_TICKS);
    const inTrap = engine.getEntities().filter((e) => e.x === TRAP_X && e.y === ROW);
    expect(inTrap).toHaveLength(1);
    expect(engine.isCellClosedTrap(TRAP_X, ROW)).toBe(true);
  });
});

describe('trap_sealed in the device relations', () => {
  it('is left out of the relation of an unlinked brown button, where a plain trap is in', () => {
    const level = room({
      terrain: [
        [1, 1, BUTTON],
        [4, 1, SEALED],
        [6, 1, TRAP]
      ]
    });
    expect(deviceRelations(level, 1, 1).controls).toEqual([{ x: 6, y: 1, kind: 'level', system: 'trap', fallback: true }]);
    expect(deviceRelations(level, 4, 1).controlledBy).toEqual([]);
  });

  it('draws no relation for a trap link that ends on it', () => {
    const level = room({ terrain: [[1, 1, BUTTON], [4, 1, SEALED]], trapLinks: [{ buttonX: 1, buttonY: 1, trapX: 4, trapY: 1 }] });
    expect(deviceRelations(level, 1, 1).controls).toEqual([]);
    expect(deviceRelations(level, 4, 1).controlledBy).toEqual([]);
  });
});

describe('trap_sealed in the validator', () => {
  const issueKeys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);

  it('does not ask for a brown button, where a plain trap does', () => {
    expect(issueKeys(room({ terrain: [[4, 4, TRAP]] }))).toContain(KEY_TRAP_NO_BUTTON);
    expect(issueKeys(room({ terrain: [[4, 4, SEALED]] }))).not.toContain(KEY_TRAP_NO_BUTTON);
  });

  it('does not count it as the trap a brown button works', () => {
    expect(issueKeys(room({ terrain: [[3, 3, BUTTON], [4, 4, SEALED]] }))).toContain(KEY_TRAP_BUTTON_NO_TRAP);
    expect(issueKeys(room({ terrain: [[3, 3, BUTTON], [4, 4, TRAP]] }))).not.toContain(KEY_TRAP_BUTTON_NO_TRAP);
  });

  it('warns about a trap link that ends on it, and not about one that ends on a plain trap', () => {
    const KEY = `${PREFIX}trap_link_sealed.label`;
    const sealed = room({ terrain: [[3, 3, BUTTON], [4, 4, SEALED]], trapLinks: [{ buttonX: 3, buttonY: 3, trapX: 4, trapY: 4 }] });
    expect(issueKeys(sealed)).toContain(KEY);
    const plain = room({ terrain: [[3, 3, BUTTON], [4, 4, TRAP]], trapLinks: [{ buttonX: 3, buttonY: 3, trapX: 4, trapY: 4 }] });
    expect(issueKeys(plain)).not.toContain(KEY);
  });

  it('does not ask for a brown button when another trap has one', () => {
    const keys = issueKeys(room({ terrain: [[3, 3, BUTTON], [4, 4, TRAP], [6, 6, SEALED]] }));
    expect(keys).not.toContain(KEY_TRAP_NO_BUTTON);
  });
});
