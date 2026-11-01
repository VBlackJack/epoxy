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

/*
 * Lynx rule modules.
 *
 * The core (Simulation.ts) plays the phases of a tick and owns the creature
 * list, steps, collisions, deaths and remains. Everything that depends on a
 * particular tile or monster lives in a module: one file in this folder, one
 * entry in LYNX_RULE_MODULES below. A module is a RuleModule (../ruleApi.ts);
 * every field is optional, and the core never names a module.
 *
 * The hooks, in the order a tick calls them:
 *
 *  - tiles: a TileRule per tile id (the item on the cell if any, else the
 *    terrain). An id with no rule plays as a wall and is listed by
 *    getUnsupportedTiles(), so adding a rule is what makes a tile playable.
 *    One id may be registered once; a second registration throws.
 *      admits             who may enter (Chip, blocks, which monsters).
 *      mayLeave(probe)    extra refusal when leaving a cell with this tile
 *                         (ice corners, traps, clone machines, force floors).
 *      mayEnter(probe)    extra refusal when entering (hidden walls, toggle
 *                         walls). With probe.mode === 'attempt' it may also
 *                         change the world (a wall appears); with 'test' it
 *                         must not. probe.intent tells why the step is made
 *                         ('released' lets a trap occupant out).
 *      isFast(ctx, who)   true to cover a step into this tile at double speed.
 *      confinesCreatures  monsters here keep their facing and draw no random
 *                         number, and blocks here cannot be pushed.
 *      arrival[kind]      effect when a chip, block or monster arrives by a
 *                         step (buttons, thief, ice corner turn). It runs in
 *                         phase C, after the creature covered its units.
 *  - monsters: a MonsterRule per monster id: decide(ctx, monster) returns the
 *    direction to attempt in phase B or null to stay; unitsPerTick (a blob is
 *    1) and survivesWater are optional. chooseFirstEnterable() (monsterRules.ts)
 *    walks a candidate list. A monster id with no rule is left out of play.
 *  - onLoad(ctx): after the world is built; set up world.moduleData[name]
 *    (link tables, counters). Everything in world.moduleData and in
 *    creature.data is snapshotted for undo, so keep it plain data.
 *  - onTickStart(ctx): phase A, after the time-out (tank marks turn tanks).
 *  - forcedMove(ctx, creature): phase B, for a creature at rest from tick 1:
 *    return { dir, intent: 'carried' | 'teleportExit', chipMayChoose } or null.
 *    It is also asked when the page presses a key, so it must not change
 *    anything. The first module that answers wins.
 *  - onForcedMove(ctx, creature, forced): phase B, the creature received the
 *    forced move this module returned (the random floor direction turns here).
 *  - onStepAttempt(ctx, attempt): after every real attempt to start a step,
 *    accepted ('started'), refused or fatal ('collided'): ice bounce, Chip's
 *    slide permission.
 *  - onTurnEnd(ctx, subject): phase C, right after the turn of a live
 *    creature or of remains (brown buttons hold their trap here).
 *  - onMovementEnd(ctx): phase D, after every turn (teleports).
 *  - isCellClosedTrap(ctx, x, y): the trap display; null when unknown.
 *
 * What a module can do through the RuleContext: read the world, find
 * creatures and remains, change terrain and items, probe a step (canStep),
 * start a step out of turn (startStep, for releases), give extra progress
 * (advance), move a creature without a step (relocate), add a creature
 * (spawn), kill, draw the generators, emit visual events and sounds.
 */

import { RuleModule } from '../ruleApi';
import { buttonsRules } from './buttons';
import { forceFloorRules } from './forceFloors';
import { iceRules } from './ice';
import { specialWallRules } from './specialWalls';
import { tankRules } from './tanks';
import { teethRules } from './teeth';
import { teleportRules } from './teleports';
import { thiefRules } from './thief';
import { walkerBlobRules } from './walkerBlob';

/**
 * Every module the engine consults, in the order its hooks are called.
 *
 * The order matters for forcedMove only (the first module that answers wins):
 * a teleport exit comes before ice and force floors, as the exit is the
 * stronger rule (spec 5.1, 12.3). Ice and force floors never share a cell, and
 * every other hook is owned by a single module (buttons mark tanks, tanks turn
 * them; buttons flip toggle walls, specialWalls reads them).
 */
export const LYNX_RULE_MODULES: readonly RuleModule[] = [
  buttonsRules,
  teleportRules,
  iceRules,
  forceFloorRules,
  thiefRules,
  specialWallRules,
  tankRules,
  teethRules,
  walkerBlobRules
];
