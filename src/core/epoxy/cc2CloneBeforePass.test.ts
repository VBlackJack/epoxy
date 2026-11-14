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
 * CC2 engine: a creature or block cloned by the step end of the player (a clone button he stepped onto), which acts at the
 * start of the tick, is counted down by the entity pass of that tick at once, so its wait is one tick longer than that of
 * a clone made during a pass. Other levels, and a clone made outside that moment, keep the wait they always had.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const PLAYER_X = 2;
const BUTTON_X = 3;
const CLONER_X = 7;
const CLONER_Y = 8;
const SPAWN_X = CLONER_X + 1;
const MAX_TICKS = 40;
/** The extra wait of a creature or block cloned before the entity pass. */
const BEFORE_PASS_TICKS = 1;

interface Template {
  type: string;
  kind: 'monster' | 'block';
}
const MONSTER: Template = { type: 'bouncer', kind: 'monster' };
const BLOCK: Template = { type: 'dirt_block', kind: 'block' };

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, template: Template): GameEngine {
  const level = room({
    mode,
    startX: PLAYER_X,
    terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_red', [`${CLONER_X},${CLONER_Y}`]: 'clone_machine' },
    entities: [{ type: template.type, x: CLONER_X, y: CLONER_Y, dir: 'E' }]
  });
  level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, clonerX: CLONER_X, clonerY: CLONER_Y, templateType: template.type, templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const clonedOf = (engine: GameEngine, template: Template) =>
  engine.getEntities().find((e) => e.kind === template.kind && e.type === template.type && e.x === SPAWN_X && e.y === CLONER_Y);

/** The wait of the creature a press made outside the entity pass lets out: the reference. */
function directWait(mode: RoomMode, template: Template): number {
  const engine = load(mode, template);
  (engine as unknown as { ctx: EpoxyContext }).ctx.triggerButton(BUTTON_X, ROOM_ROW, 'trigger_cloner');
  return clonedOf(engine, template)?.cooldownTicks ?? Number.NaN;
}

/** The player steps onto the button, waits the step out, and the next input is the one that lets the clone out. */
function waitOfStepEndClone(mode: RoomMode, template: Template): number {
  const engine = load(mode, template);
  // Any other level presses at the start of the step: the clone is out already.
  if (mode !== 'cc2') {
    expect(engine.attemptPlayerMove('E')).toBe(true);
    return clonedOf(engine, template)?.cooldownTicks ?? Number.NaN;
  }
  expect(playMove(engine, 'E').accepted).toBe(true);
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
  // CC2: nothing yet, the step-end effects act at the start of the next tick or input.
  expect(clonedOf(engine, template)).toBeUndefined();
  // The step end acts when the next input begins: read the wait between that flush and the entity pass of the tick.
  engine.attemptPlayerMove('N');
  engine.flushPendingStepEnd();
  return clonedOf(engine, template)?.cooldownTicks ?? Number.NaN;
}

describe('CC2 engine: a clone let out by the step end of the player', () => {
  it('has a monster wait one tick longer than a clone made outside the pass', () => {
    const expected = directWait('cc2', MONSTER) + BEFORE_PASS_TICKS;
    expect(waitOfStepEndClone('cc2', MONSTER)).toBe(expected);
  });

  it('has a block wait one tick longer than a clone made outside the pass', () => {
    const expected = directWait('cc2', BLOCK) + BEFORE_PASS_TICKS;
    expect(waitOfStepEndClone('cc2', BLOCK)).toBe(expected);
  });

  it('leaves no transient flag behind', () => {
    const engine = load('cc2', MONSTER);
    playMove(engine, 'E');
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
    engine.attemptPlayerMove('N');
    engine.flushPendingStepEnd();
    engine.tick();
    expect(world(engine).cc2BeforePass).toBeUndefined();
  });
});

describe('a level not on the CC2 engine keeps the wait of its clones', () => {
  it.each([
    ['cc', MONSTER],
    ['native', MONSTER],
    ['cc', BLOCK],
    ['native', BLOCK]
  ] as const)('%s level, %s', (mode, template) => {
    expect(waitOfStepEndClone(mode, template)).toBe(directWait(mode, template));
  });
});
