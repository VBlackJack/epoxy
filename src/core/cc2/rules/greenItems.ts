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

import { COLOR, SFX } from '../../lynx/lynxConstants';
import { Creature, Remains, isRemains } from '../../lynx/model';
import { ArrivalEffect, RuleContext, RuleModule } from '../../lynx/ruleApi';
import { ADMISSION } from '../../lynx/tileRules';

/*
 * Green chips and green bombs. They are two forms of one item: the green
 * button of a level turns every green chip into a green bomb and back, the same
 * press that flips the toggle walls (the Lynx buttons module owns that part and
 * is left alone). A green chip counts as a chip for the socket.
 *
 * The Lynx core gives the green button no hook for another module, so a press
 * is seen from here instead: a creature at rest on the button whose turn ends
 * with no mark on it has just arrived. The mark is cleared when it stands
 * anywhere else or on its way (a step in progress already names the next cell,
 * so a walk from one green button onto the next clears it), and set at load for
 * a creature that starts on the button. A press that happens outside the
 * creature's own turn is seen at the next turn end, one tick late.
 */

const GREEN_CHIP = 'green_chip';
const GREEN_BOMB = 'green_bomb';
const GREEN_BUTTON = 'button_green';
/** `creature.data` flag: the creature already pressed the green button it stands on. */
const PRESSED_FLAG = 'greenButtonPressed';
const FLAG_SET = 1;

const collectGreenChip: ArrivalEffect = (ctx, chip) => {
  ctx.world.chipsRemaining = Math.max(0, ctx.world.chipsRemaining - 1);
  ctx.setItem(chip.x, chip.y, null);
  ctx.emitVisual('chip', chip.x, chip.y, COLOR.chip);
  ctx.playSfx(SFX.chip);
};

const explodeOnGreenBomb: ArrivalEffect = (ctx, creature) => {
  ctx.setItem(creature.x, creature.y, null);
  ctx.kill(creature, 'bomb');
};

/** Every green chip becomes a green bomb and every green bomb a green chip. */
function swapGreenItems(ctx: RuleContext): void {
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      const item = ctx.world.items[y][x];
      if (item === GREEN_CHIP) ctx.setItem(x, y, GREEN_BOMB);
      else if (item === GREEN_BOMB) ctx.setItem(x, y, GREEN_CHIP);
    }
  }
}

function onTurnEnd(ctx: RuleContext, subject: Creature | Remains): void {
  if (isRemains(subject)) return;
  if (!ctx.isAtRest(subject) || ctx.tileIdAt(subject.x, subject.y) !== GREEN_BUTTON) {
    delete subject.data[PRESSED_FLAG];
    return;
  }
  if (subject.data[PRESSED_FLAG] === FLAG_SET) return;
  subject.data[PRESSED_FLAG] = FLAG_SET;
  swapGreenItems(ctx);
}

export const greenItemRules: RuleModule = {
  name: 'cc2GreenItems',
  tiles: {
    [GREEN_CHIP]: { admits: ADMISSION.chipOnly, arrival: { chip: collectGreenChip } },
    [GREEN_BOMB]: {
      admits: ADMISSION.everyone,
      arrival: { chip: explodeOnGreenBomb, block: explodeOnGreenBomb, monster: explodeOnGreenBomb }
    }
  },
  onLoad: (ctx) => {
    for (const creature of ctx.creatures()) {
      if (ctx.tileIdAt(creature.x, creature.y) === GREEN_BUTTON) creature.data[PRESSED_FLAG] = FLAG_SET;
    }
  },
  onTurnEnd
};
