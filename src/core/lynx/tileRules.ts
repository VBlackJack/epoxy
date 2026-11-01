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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { opposite } from './directions';
import { COLOR, ENTITY, KEY_COUNT_MODULUS, SFX, TILE } from './lynxConstants';
import { Creature } from './model';
import { Admission, ArrivalEffect, RuleContext, TileRule } from './ruleApi';

/** Who may enter, for the common cases. Rule modules reuse these. */
export const ADMISSION = {
  everyone: { chip: true, block: true, monsters: 'all' },
  nobody: { chip: false, block: false, monsters: 'none' },
  chipOnly: { chip: true, block: false, monsters: 'none' },
  chipAndBlocks: { chip: true, block: true, monsters: 'none' },
  chipBlocksAndFireballs: { chip: true, block: true, monsters: [ENTITY.fireball] }
} as const satisfies Record<string, Admission>;

const KEY_IDS = ['key_red', 'key_blue', 'key_yellow', 'key_green'] as const;
const BOOT_IDS = ['boots_water', 'boots_fire', 'boots_ice', 'boots_force'] as const;
/** Keys that anyone may step on; the others are Chip-only. */
const OPEN_KEY_IDS: readonly string[] = [TILE.keyRed, TILE.keyBlue];

const keyColor = (tileId: string): string => ConfigRegistry.getTile(tileId).colorKey ?? COLOR.fallbackKey;

function ownsBoots(ctx: RuleContext, id: string): boolean {
  return ctx.world.chipState.boots.has(id);
}

/** Collects an item: removes it from the cell. */
function takeItem(ctx: RuleContext, chip: Creature): void {
  ctx.setItem(chip.x, chip.y, null);
}

const destroyItem: ArrivalEffect = (ctx, creature) => ctx.setItem(creature.x, creature.y, null);

const explodeOnBomb: ArrivalEffect = (ctx, creature) => {
  ctx.setItem(creature.x, creature.y, null);
  ctx.kill(creature, 'bomb');
};

const sinkInWater: ArrivalEffect = (ctx, creature) => {
  if (creature.kind === 'block') ctx.setTerrain(creature.x, creature.y, TILE.dirt);
  ctx.kill(creature, 'drown');
};

function collectKey(id: string): ArrivalEffect {
  return (ctx, chip) => {
    const keys = ctx.world.chipState.keys;
    keys[id] = ((keys[id] ?? 0) + 1) % KEY_COUNT_MODULUS;
    takeItem(ctx, chip);
    ctx.emitVisual('item', chip.x, chip.y, keyColor(id));
    ctx.playSfx(SFX.item);
  };
}

function collectBoots(id: string): ArrivalEffect {
  return (ctx, chip) => {
    ctx.world.chipState.boots.add(id);
    takeItem(ctx, chip);
    ctx.emitVisual('item', chip.x, chip.y, COLOR.boots);
    ctx.playSfx(SFX.item);
  };
}

const collectChip: ArrivalEffect = (ctx, chip) => {
  ctx.world.chipsRemaining = Math.max(0, ctx.world.chipsRemaining - 1);
  takeItem(ctx, chip);
  ctx.emitVisual('chip', chip.x, chip.y, COLOR.chip);
  ctx.playSfx(SFX.chip);
};

function doorRule(doorId: string): TileRule {
  const def = ConfigRegistry.getTile(doorId);
  const keyId = def.requiredKey ?? doorId.replace(TILE.doorPrefix, TILE.keyPrefix);
  const color = def.colorKey ?? COLOR.fallbackKey;
  return {
    admits: ADMISSION.chipOnly,
    mayEnter: (probe) => (probe.ctx.world.chipState.keys[keyId] ?? 0) > 0,
    arrival: {
      chip: (ctx, chip) => {
        if (def.consumesKey !== false) ctx.world.chipState.keys[keyId] -= 1;
        ctx.setTerrain(chip.x, chip.y, TILE.floor);
        ctx.emitVisual('unlock', chip.x, chip.y, color);
        ctx.playSfx(SFX.door);
      }
    }
  };
}

function thinWallRule(edges: readonly string[]): TileRule {
  return {
    admits: ADMISSION.everyone,
    mayLeave: (probe) => !edges.includes(probe.dir),
    mayEnter: (probe) => !edges.includes(opposite(probe.dir))
  };
}

/** The tile rules the core owns. Tiles with no rule at all play as walls. */
export function coreTileRules(): Record<string, TileRule> {
  const rules: Record<string, TileRule> = {
    [TILE.floor]: { admits: ADMISSION.everyone },
    [TILE.wall]: { admits: ADMISSION.nobody },
    [TILE.invisibleWall]: { admits: ADMISSION.nobody },
    [TILE.dirt]: {
      admits: ADMISSION.chipOnly,
      arrival: { chip: (ctx, chip) => ctx.setTerrain(chip.x, chip.y, TILE.floor) }
    },
    [TILE.gravel]: { admits: ADMISSION.chipAndBlocks },
    [TILE.hint]: { admits: ADMISSION.chipOnly },
    [TILE.water]: {
      admits: ADMISSION.everyone,
      arrival: {
        chip: (ctx, chip) => {
          if (!ownsBoots(ctx, TILE.bootsWater)) ctx.kill(chip, 'drown');
        },
        block: sinkInWater,
        monster: (ctx, monster) => {
          if (!ctx.monsterRuleOf(monster.type)?.survivesWater) ctx.kill(monster, 'drown');
        }
      }
    },
    [TILE.fire]: {
      admits: ADMISSION.chipBlocksAndFireballs,
      arrival: {
        chip: (ctx, chip) => {
          if (!ownsBoots(ctx, TILE.bootsFire)) ctx.kill(chip, 'burn');
        }
      }
    },
    [TILE.socket]: {
      admits: ADMISSION.chipOnly,
      mayEnter: (probe) => probe.ctx.world.chipsRemaining === 0,
      arrival: {
        chip: (ctx, chip) => {
          ctx.setTerrain(chip.x, chip.y, TILE.floor);
          ctx.emitVisual('unlock', chip.x, chip.y, COLOR.socket);
          ctx.playSfx(SFX.socket);
        }
      }
    },
    [TILE.exit]: {
      admits: ADMISSION.chipOnly,
      arrival: {
        chip: (ctx) => {
          ctx.world.chipState.exited = true;
          ctx.world.complete = true;
        }
      }
    },
    [TILE.chip]: { admits: ADMISSION.chipOnly, arrival: { chip: collectChip } },
    [TILE.bomb]: {
      admits: ADMISSION.everyone,
      arrival: { chip: explodeOnBomb, block: explodeOnBomb, monster: explodeOnBomb }
    }
  };

  for (const id of KEY_IDS) {
    const open = OPEN_KEY_IDS.includes(id);
    rules[id] = {
      admits: open ? ADMISSION.everyone : ADMISSION.chipOnly,
      arrival: {
        chip: collectKey(id),
        ...(id === TILE.keyBlue ? { block: destroyItem, monster: destroyItem } : {})
      }
    };
  }
  for (const id of BOOT_IDS) {
    rules[id] = { admits: ADMISSION.chipOnly, arrival: { chip: collectBoots(id) } };
  }

  for (const [id, def] of Object.entries(ConfigRegistry.getTiles().tiles)) {
    if (id.startsWith(TILE.doorPrefix)) rules[id] = doorRule(id);
    else if (id.startsWith(TILE.thinWallPrefix) && def.blockedEdges?.length) rules[id] = thinWallRule(def.blockedEdges);
  }
  return rules;
}
