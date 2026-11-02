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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import type { CompiledLevel } from '../types';
import { Cc3dEngine } from './Cc3dEngine';
import type { Cc3dCell, Cc3dColor, Cc3dLevel, Cc3dMob, Cc3dMobKind, Cc3dTerrain } from './model';

beforeAll(() => {
  loadTestConfigs();
});

const WIDTH = 100;
const HEIGHT = 114;
const MOB_COUNT = 300;
const LATTICE_PERIOD = 6;
const LATTICE_ORIGIN = 3;
const MOB_KINDS: Cc3dMobKind[] = ['bouncer', 'blinky', 'walker', 'limpa', 'screamer', 'golem_blue'];
const COLORS: Cc3dColor[] = ['red', 'green', 'blue', 'yellow'];
const WARMUP_TICKS = 40;
const MEASURED_TICKS = 300;
/** Generous so a loaded CI machine stays green; the target on a quiet machine is well under 2 ms. */
const MAX_MS_PER_TICK = 5;

function floor(): Cc3dCell {
  return { terrain: [{ kind: 'floor' }], panels: [], item: null };
}

function on(...layers: Cc3dTerrain[]): Cc3dCell {
  return { terrain: [{ kind: 'floor' }, ...layers], panels: [], item: null };
}

/** A synthetic heaviest-case map: a lattice of every device kind, 300 walking monsters and a walled corridor for the player. */
function heavyLevel(): Cc3dLevel {
  const cells: Cc3dCell[] = [];
  const mobs: Cc3dMob[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const border = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      if (border || x === 2) {
        cells.push({ terrain: [{ kind: 'wall' }], panels: [], item: null });
        continue;
      }
      if (x < LATTICE_ORIGIN) {
        cells.push(x === 1 && y % LATTICE_PERIOD === 3 ? on({ kind: 'toggle_control', color: 'green' }) : floor());
        continue;
      }
      const lx = (x - LATTICE_ORIGIN) % LATTICE_PERIOD;
      const ly = y % LATTICE_PERIOD;
      const color = COLORS[(Math.floor((x - LATTICE_ORIGIN) / LATTICE_PERIOD) + Math.floor(y / LATTICE_PERIOD)) % COLORS.length];
      if (lx === 1 && ly === 1) cells.push(on({ kind: 'plate', color }));
      else if (lx === 3 && ly === 1) cells.push(on({ kind: 'hold_door', color, open: false }));
      else if (lx === 1 && ly === 3) cells.push(on({ kind: 'toggle_control', color }));
      else if (lx === 3 && ly === 3) cells.push(on({ kind: 'toggle_door', color, open: false }));
      else if (lx === 5 && ly === 1) cells.push(on({ kind: 'trap' }));
      else if (lx === 5 && ly === 3) cells.push(on({ kind: 'trap_control' }));
      else if (lx === 1 && ly === 5) cells.push(on({ kind: 'clone_switch' }));
      else if (lx === 5 && ly === 5) cells.push(on({ kind: 'clone_machine', dir: 'E' }));
      else cells.push(floor());
      if (lx === 5 && ly === 5) mobs.push({ kind: 'block_ice', x, y, dir: 'E' });
      else if (lx === 2 && ly === 2 && mobs.length < MOB_COUNT) {
        mobs.push({ kind: MOB_KINDS[mobs.length % MOB_KINDS.length], x, y, dir: 'E' });
      }
    }
  }
  return { width: WIDTH, height: HEIGHT, cells, mobs, player: { x: 1, y: 1 } };
}

function compiled(level: Cc3dLevel): CompiledLevel {
  return {
    id: 'cc3d_perf',
    ruleset: 'cc3d',
    cc3d: level,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...level.player, dir: 'S' },
    terrain: [],
    items: [],
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('performance on the heaviest map shape', () => {
  it('plays a tick of a 100 x 114 map with every device and 300 monsters well within the frame budget', () => {
    const engine = new Cc3dEngine({ effect: () => undefined, step: () => undefined });
    engine.loadLevel(compiled(heavyLevel()), 1);
    const tickHeld = (): void => {
      engine.holdPlayerDirection('S');
      engine.tick();
    };
    for (let i = 0; i < WARMUP_TICKS; i++) tickHeld();
    const started = performance.now();
    for (let i = 0; i < MEASURED_TICKS; i++) tickHeld();
    const perTick = (performance.now() - started) / MEASURED_TICKS;
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.getEntities().length).toBeGreaterThanOrEqual(MOB_COUNT);
    expect(perTick).toBeLessThan(MAX_MS_PER_TICK);
  });
});
