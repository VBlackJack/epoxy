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
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { lynxLevel, monster } from './lynxTestMaps';
import { LynxRig } from './lynxTestRig';
import { LYNX_RULE_MODULES } from './rules';
import { buildRuleBook } from './ruleBook';
import { RuleModule, StepAttempt } from './ruleApi';
import { ADMISSION } from './tileRules';

beforeAll(() => {
  loadTestConfigs();
});

describe('rule modules', () => {
  it('registers the nine modules in the intended order', () => {
    expect(LYNX_RULE_MODULES.map((m) => m.name)).toEqual([
      'buttons',
      'teleports',
      'ice',
      'forceFloors',
      'thief',
      'specialWalls',
      'tanks',
      'teeth',
      'walkerBlob'
    ]);
    expect(new Set(LYNX_RULE_MODULES.map((m) => m.name)).size).toBe(LYNX_RULE_MODULES.length);
  });

  it('builds a rule book from the registry without a duplicate tile or monster rule', () => {
    const book = buildRuleBook(LYNX_RULE_MODULES);
    expect(book.modules).toBe(LYNX_RULE_MODULES);
    expect(book.tiles.has('button_green')).toBe(true);
    expect(book.monsters.has('walker')).toBe(true);
  });

  it('asks teleports before ice and force floors for a forced move', () => {
    const names = LYNX_RULE_MODULES.filter((m) => m.forcedMove).map((m) => m.name);
    expect(names).toEqual(['teleports', 'ice', 'forceFloors']);
  });

  it('refuses two rules for one tile id', () => {
    const clash: RuleModule = { name: 'clash', tiles: { floor: { admits: ADMISSION.nobody } } };
    expect(() => new LynxRig(lynxLevel(['###', '#@#', '###']), { modules: [clash] })).toThrow();
  });

  it('makes a tile playable once a module gives it a rule', () => {
    const turtle: RuleModule = { name: 'turtle', tiles: { turtle: { admits: ADMISSION.chipOnly } } };
    const rig = new LynxRig(lynxLevel(['####', '#@T#', '####'], { glyphs: { T: 'turtle' } }), { modules: [turtle] });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player.x).toBe(2);
  });

  it('calls the phase hooks and passes forced moves, attempts and speed through', () => {
    const calls = { load: 0, start: 0, end: 0, forcedTaken: 0, turnEnds: 0 };
    const attempts: StepAttempt[] = [];
    const slide: RuleModule = {
      name: 'slide',
      tiles: {
        force_e: { admits: ADMISSION.everyone, isFast: () => true }
      },
      onLoad: () => {
        calls.load++;
      },
      onTickStart: () => {
        calls.start++;
      },
      onMovementEnd: () => {
        calls.end++;
      },
      onTurnEnd: () => {
        calls.turnEnds++;
      },
      forcedMove: (ctx, creature) =>
        ctx.tileIdAt(creature.x, creature.y) === 'force_e'
          ? { dir: 'E', intent: 'carried', chipMayChoose: false }
          : null,
      onForcedMove: () => {
        calls.forcedTaken++;
      },
      onStepAttempt: (_ctx, attempt) => {
        attempts.push(attempt);
      }
    };
    const level = lynxLevel(['#####', '#@>>#', '#####'], { glyphs: { '>': 'force_e' } });
    const rig = new LynxRig(level, { modules: [slide] });
    expect(calls.load).toBe(1);
    rig.press('E');
    rig.afterTick(0);
    expect(rig.player).toMatchObject({ x: 2, moveCooldown: 1, isSliding: false });
    rig.afterTick(1);
    expect(rig.player.moveCooldown).toBe(0);
    expect(rig.press('W')).toBe(false);
    rig.afterTick(2);
    expect(rig.player).toMatchObject({ x: 3, isSliding: true });
    rig.afterTick(4);
    expect(attempts.map((a) => [a.intent, a.outcome])).toEqual([
      ['chosen', 'started'],
      ['carried', 'started'],
      ['carried', 'refused']
    ]);
    expect(calls.start).toBe(5);
    expect(calls.end).toBe(5);
    expect(calls.forcedTaken).toBeGreaterThan(0);
    expect(calls.turnEnds).toBeGreaterThanOrEqual(5);
  });

  it('offers monster rules, spawning and out-of-turn steps', () => {
    const spawner: RuleModule = {
      name: 'spawner',
      monsters: { walker: { decide: () => 'E' } },
      onLoad: (ctx) => {
        const made = ctx.spawn('pink_ball', 'monster', { x: 1, y: 1 }, 'E');
        ctx.startStep(made, 'E', 'released');
      }
    };
    const level = lynxLevel(['#####', '#...#', '#####', '#@#'], { entities: [monster('walker', 3, 1, 'W')] });
    const rig = new LynxRig(level, { modules: [spawner] });
    const [first, second] = rig.entities;
    expect(rig.entities).toHaveLength(2);
    expect(new Set([first.uid, second.uid]).size).toBe(2);
    expect(rig.entityAt(2, 1)).toMatchObject({ type: 'pink_ball', cooldownTicks: 3 });
    expect(rig.engine.getUnsupportedTiles()).toEqual([]);
  });
});
