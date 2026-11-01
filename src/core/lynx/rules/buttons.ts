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

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { Cell } from '../directions';
import { SFX } from '../lynxConstants';
import { Creature, Remains, isRemains } from '../model';
import { RuleContext, RuleModule, TileRule } from '../ruleApi';
import { ADMISSION } from '../tileRules';
import { TANK_TURN_MARK, TANK_TYPE } from './tanks';

/*
 * Buttons, traps and clone machines (spec section 11).
 *
 * Cross-team contracts:
 *  - Green button: the toggle walls flip in the terrain itself (toggle_wall_open
 *    <-> toggle_wall_closed) at the moment of arrival, so any rule that reads the
 *    tile id of a cell sees the new state at once. Nothing else is stored.
 *  - Blue button: a tank that must turn gets `creature.data[TANK_TURN_MARK]`
 *    set to 1 (toggled: a second press in the same tick clears it). The tanks
 *    module owns the turn itself (phase A of the next tick) and removes every
 *    mark; this module never turns a tank.
 */

const MARK_SET = 1;

const MODULE_NAME = 'buttons';
const ICE_SLIDE_TYPE = 'ice';
const CELL_KEY_SEPARATOR = ',';

const ID = {
  green: 'button_green',
  blue: 'button_blue',
  brown: 'button_brown',
  red: 'button_red',
  trap: 'trap',
  cloneMachine: 'clone_machine',
  toggleOpen: 'toggle_wall_open',
  toggleClosed: 'toggle_wall_closed'
} as const;

/** Link tables built at load: a button cell key maps to the cell it works on. Plain data. */
interface ButtonLinks {
  traps: Record<string, Cell>;
  clones: Record<string, Cell>;
}

const cellKey = (x: number, y: number): string => `${x}${CELL_KEY_SEPARATOR}${y}`;

function linksOf(ctx: RuleContext): ButtonLinks {
  return ctx.world.moduleData[MODULE_NAME] as ButtonLinks;
}

/** Only the first link of a button whose target has the right tile at load counts. */
function firstValidLinks<T extends { buttonX: number; buttonY: number }>(
  ctx: RuleContext,
  links: readonly T[],
  targetOf: (link: T) => Cell,
  targetTile: string
): Record<string, Cell> {
  const table: Record<string, Cell> = {};
  for (const link of links) {
    const key = cellKey(link.buttonX, link.buttonY);
    const target = targetOf(link);
    if (key in table || !ctx.inMap(target) || ctx.tileIdAt(target.x, target.y) !== targetTile) continue;
    table[key] = target;
  }
  return table;
}

function toggleWalls(ctx: RuleContext): void {
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      const id = ctx.world.terrain[y][x];
      if (id === ID.toggleClosed) ctx.setTerrain(x, y, ID.toggleOpen);
      else if (id === ID.toggleOpen) ctx.setTerrain(x, y, ID.toggleClosed);
    }
  }
}

function markTanks(ctx: RuleContext): void {
  for (const creature of ctx.creatures()) {
    if (creature.kind !== 'monster' || creature.type !== TANK_TYPE) continue;
    const tile = ctx.tileIdAt(creature.x, creature.y);
    if (tile === ID.cloneMachine || ConfigRegistry.getTile(tile).slideType === ICE_SLIDE_TYPE) continue;
    if (creature.data[TANK_TURN_MARK] === MARK_SET) delete creature.data[TANK_TURN_MARK];
    else creature.data[TANK_TURN_MARK] = MARK_SET;
  }
}

/** Lets the creature standing in a clone machine out and leaves a copy behind. */
function pressRedButton(ctx: RuleContext, button: Creature): void {
  const machine = linksOf(ctx).clones[cellKey(button.x, button.y)];
  if (!machine) return;
  const occupant = ctx.creatureAt(machine.x, machine.y);
  if (!occupant || !ctx.isAtRest(occupant)) return;
  const facing = occupant.dir;
  if (ctx.startStep(occupant, facing, 'released') !== 'started') return;
  if (occupant.kind !== 'chip') ctx.spawn(occupant.type, occupant.kind, machine, facing);
  ctx.playSfx(SFX.button);
}

/** Holds the trap linked to a brown button: lets its occupant out or hurries it in. */
function holdTrap(ctx: RuleContext, button: Cell): void {
  const trap = linksOf(ctx).traps[cellKey(button.x, button.y)];
  if (!trap) return;
  const occupant = ctx.creatureAt(trap.x, trap.y);
  if (!occupant) return;
  if (ctx.isAtRest(occupant)) ctx.startStep(occupant, occupant.dir, 'released');
  else ctx.advance(occupant);
}

const pressSound = (ctx: RuleContext): void => ctx.playSfx(SFX.button);

function buttonRule(onArrival: (ctx: RuleContext, creature: Creature) => void): TileRule {
  return {
    admits: ADMISSION.everyone,
    arrival: { chip: onArrival, block: onArrival, monster: onArrival }
  };
}

function isHoldingButton(ctx: RuleContext, subject: Creature | Remains): boolean {
  if (ctx.tileIdAt(subject.x, subject.y) !== ID.brown) return false;
  return isRemains(subject) ? subject.atRest : ctx.isAtRest(subject);
}

function buttonIsHeld(ctx: RuleContext, button: Cell): boolean {
  const creature = ctx.creatureAt(button.x, button.y);
  if (creature && ctx.isAtRest(creature)) return true;
  return ctx.remainsList().some((r) => r.atRest && r.x === button.x && r.y === button.y);
}

export const buttonsRules: RuleModule = {
  name: MODULE_NAME,
  tiles: {
    [ID.green]: buttonRule((ctx) => {
      toggleWalls(ctx);
      pressSound(ctx);
    }),
    [ID.blue]: buttonRule((ctx) => {
      markTanks(ctx);
      pressSound(ctx);
    }),
    [ID.brown]: buttonRule(pressSound),
    [ID.red]: buttonRule(pressRedButton),
    [ID.trap]: {
      admits: ADMISSION.everyone,
      mayLeave: (probe) => probe.intent === 'released',
      confinesCreatures: true
    },
    [ID.cloneMachine]: {
      admits: ADMISSION.nobody,
      mayLeave: (probe) => probe.intent === 'released',
      confinesCreatures: true
    }
  },
  onLoad: (ctx) => {
    const links: ButtonLinks = {
      traps: firstValidLinks(ctx, ctx.level.trapLinks, (l) => ({ x: l.trapX, y: l.trapY }), ID.trap),
      clones: firstValidLinks(ctx, ctx.level.cloneLinks, (l) => ({ x: l.clonerX, y: l.clonerY }), ID.cloneMachine)
    };
    ctx.world.moduleData[MODULE_NAME] = links;
  },
  onTurnEnd: (ctx, subject) => {
    if (isHoldingButton(ctx, subject)) holdTrap(ctx, subject);
  },
  isCellClosedTrap: (ctx, x, y) => {
    if (ctx.tileIdAt(x, y) !== ID.trap) return null;
    const held = Object.entries(linksOf(ctx).traps).some(([key, trap]) => {
      if (trap.x !== x || trap.y !== y) return false;
      const [bx, by] = key.split(CELL_KEY_SEPARATOR).map(Number);
      return buttonIsHeld(ctx, { x: bx, y: by });
    });
    return !held;
  }
};
