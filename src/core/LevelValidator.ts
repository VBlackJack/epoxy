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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { BlockPuzzleSolver, requestedSearchBudget } from './BlockPuzzleSolver';
import { cc3dValidationReport } from './cc3d/cc3dValidator';
import {
  BLOCK_TARGET_TILE_ID,
  FLOOR_TILE_ID,
  HINT_TILE_ID,
  OPPOSITE_DIRECTION,
  WALL_TILE_ID,
  channelOfButtonAction
} from './coreConstants';
import { entityPressesPlate } from './epoxy/epoxyWorld';
import { isEdgeBlockedBetween } from './EdgeRules';
import { GameEngine } from './GameEngine';
import {
  ChannelColor,
  CompiledLevel,
  Direction,
  GridPoint,
  LevelValidationReport,
  TileDefinition,
  ValidationIssue
} from './types';

/**
 * Upper bound on reachability passes. Each pass can unlock new cells (keys,
 * toggled walls, filled water); the loop stops earlier once a pass changes nothing.
 */
const MAX_FIXPOINT_PASSES = 60;
/** Blocks assumed available from a reachable cloner button that clones a block. */
const CLONER_BLOCK_ALLOWANCE = 10;

/**
 * The boots held are part of the search state, as a bit mask over the boot
 * types of the tile config: a thief resets the mask, a boot on the floor sets
 * its bit. Boot types beyond this count are never considered owned, which can
 * only make the verdict stricter.
 */
const MAX_TRACKED_BOOT_TYPES = 8;
const NO_BOOTS = 0;
/** A key in a door's room outweighs any number of chips when choosing which door to open first. */
const DOOR_KEY_WEIGHT = 1000;

interface QueuedCell extends GridPoint {
  boots: number;
}

interface SlideResult {
  end: GridPoint;
  path: GridPoint[];
  boots: number;
  fatal: boolean;
}

/** Tiles that stay solid for the player whatever happens: no pusher can ever stand there. */
const PERMANENT_SOLID_TILES: ReadonlySet<string> = new Set([
  'wall',
  'blue_wall_real',
  'invisible_wall',
  'appearing_wall',
  'clone_machine'
]);

type BootCheck = (boots: number, bootId: string | undefined) => boolean;

/** Tells whether a level's stored solution wins in the real engine; supplied by callers that can replay it. */
export type SolutionWins = (level: CompiledLevel) => boolean;

export class LevelValidator {
  /**
   * Checks a level. `solutionWins` is the replay of the stored solution: when it confirms the
   * solution, a reachability miss of the simulator is downgraded to a warning.
   */
  public static validate(level: CompiledLevel, solutionWins?: SolutionWins): LevelValidationReport {
    // A CC3D level is checked by its own strict validator, not by the Epoxy tile rules.
    if (level.ruleset === 'cc3d' && level.cc3d) return cc3dValidationReport(level);
    const issues: ValidationIssue[] = [];
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;

    const coversTargets = level.winRule === 'targets';
    const lightsReceivers = level.winRule === 'receivers';
    // Only the 'exit' rule asks for an exit and a way to reach it.
    const needsExit = !coversTargets && !lightsReceivers;
    let targetCount = 0;
    let emitterCount = 0;
    let receiverCount = 0;
    let gateCount = 0;
    // Groups with a receiver: their closed gates count as passable in the reachability walk, as a key barrier does.
    const receiverGroups = new Set<string>();
    let chipsPlaced = 0;
    let exitCount = 0;
    const consumingDoorCounts: Record<string, number> = {};
    const keepingDoorCounts: Record<string, number> = {};
    const keyCounts: Record<string, number> = {};

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tDef = ConfigRegistry.getTile(level.terrain[y][x]);
        const iId = level.items[y][x];
        if (tDef.isLevelExit) {
          exitCount++;
        }
        if (level.terrain[y][x] === BLOCK_TARGET_TILE_ID) {
          targetCount++;
        }
        if (tDef.laserEmitter) emitterCount++;
        if (tDef.laserReceiverGroup !== undefined) {
          receiverCount++;
          receiverGroups.add(tDef.laserReceiverGroup);
        }
        if (tDef.laserGateGroup !== undefined) gateCount++;
        if (tDef.requiredKey) {
          const counts = tDef.consumesKey ? consumingDoorCounts : keepingDoorCounts;
          counts[tDef.requiredKey] = (counts[tDef.requiredKey] || 0) + 1;
        }
        if (iId) {
          const iDef = ConfigRegistry.getTile(iId);
          if (iDef.collectible === 'chip') {
            chipsPlaced++;
          } else if (iDef.collectible === 'key') {
            keyCounts[iId] = (keyCounts[iId] || 0) + 1;
          }
        }
      }
    }

    if (coversTargets) {
      this.checkTargets(level, targetCount, issues);
    } else if (lightsReceivers) {
      if (emitterCount === 0) issues.push({ severity: 'error', i18nKey: 'validator.issues.no_emitter.label' });
      if (receiverCount === 0) issues.push({ severity: 'error', i18nKey: 'validator.issues.no_receiver.label' });
      // An exit tile still ends the level on touch, which would bypass the receivers.
      if (exitCount > 0) issues.push({ severity: 'warning', i18nKey: 'validator.issues.exit_on_receivers_level.label' });
    } else if (exitCount === 0) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.no_exit.label'
      });
    }

    if (chipsPlaced < level.chipsRequired) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.missing_chips.label',
        params: { placed: chipsPlaced, required: level.chipsRequired }
      });
    }

    if (gateCount > 0 && emitterCount > 0) {
      for (const group of this.findSelfFeedingGateGroups(level)) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.laser_gate_on_beam.label',
          params: { group }
        });
      }
    }

    this.checkColorChannels(level, issues);

    // A consumed key opens one door; a kept key opens every door of its colour
    for (const [keyId, doors] of Object.entries(consumingDoorCounts)) {
      const keys = keyCounts[keyId] || 0;
      if (doors > keys) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.fewer_keys_than_doors.label',
          params: { key: keyId, keys, doors }
        });
      }
    }
    for (const [keyId, doors] of Object.entries(keepingDoorCounts)) {
      if ((keyCounts[keyId] || 0) === 0) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.no_matching_key.label',
          params: { key: keyId, doors }
        });
      }
    }

    const sx = level.playerStart.x;
    const sy = level.playerStart.y;
    const startInGrid = Number.isInteger(sx) && Number.isInteger(sy) && sx >= 0 && sx < width && sy >= 0 && sy < height;
    if (!startInGrid) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.invalid_start.label'
      });
      return {
        valid: false,
        issues,
        stats: {
          chipsPlaced,
          chipsRequired: level.chipsRequired,
          exitCount,
          reachableChips: 0,
          reachableExit: false,
          targetCount
        }
      };
    }

    this.checkStartCell(level, issues);
    this.checkLinkEndpoints(level, issues);
    // A Lynx level is played by the Lynx engine, not by the Epoxy block rules this reach walk approximates.
    if (level.ruleset !== 'lynx') this.checkHiddenByBlocks(level, issues);

    if (needsExit && exitCount > 0 && level.chipsRequired > 0) {
      if (this.canReachExitWithoutSocket(level)) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.socket_bypass.label'
        });
      }
    }

    const holdDoorOpenable = this.openableHoldDoorColors(level);
    const simTerrain = level.terrain.map((row) => [...row]);
    const simItems = level.items.map((row) => [...row]);
    const ownedKeys: Record<string, number> = {};
    const bootBits = this.buildBootBits();
    const maskCount = 1 << bootBits.size;
    const hasBoot: BootCheck = (boots, bootId) => {
      const bit = bootId ? bootBits.get(bootId) : undefined;
      return bit !== undefined && (boots & bit) !== 0;
    };
    let collectedChips = 0;
    let reachableExit = false;

    const blockTypes = new Set(
      Object.values(ConfigRegistry.getMonsters().entities)
        .filter((def) => def.kind === 'block')
        .map((def) => def.id)
    );
    let availableBlocks = 0;
    const uncollectedBlocks = new Set<string>(
      level.entities.filter((e) => blockTypes.has(e.type)).map((e) => `${e.x},${e.y}`)
    );
    // A cloner only supplies blocks once the player can reach its button
    const grantedCloneLinks = new Set<number>();

    const teleporters: GridPoint[] = [];
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (ConfigRegistry.getTile(simTerrain[ty][tx]).isTeleporter) teleporters.push({ x: tx, y: ty });
      }
    }

    const appliedKeyThieves = new Set<string>();

    let changed = true;
    let passes = 0;

    while (changed && passes < MAX_FIXPOINT_PASSES) {
      changed = false;
      passes++;

      const visited = new Uint8Array(maskCount * width * height);
      const queue: QueuedCell[] = [];
      const enqueue = (x: number, y: number, boots: number): void => {
        const idx = (boots * height + y) * width + x;
        if (!visited[idx]) {
          visited[idx] = 1;
          queue.push({ x, y, boots });
        }
      };

      /**
       * Picks up what lies on a cell. Chips, keys and blocks are shared by
       * every state; a boot only extends the mask of the state standing there,
       * and stays on the grid for the states that arrive without it.
       */
      const collectAt = (cx: number, cy: number, boots: number): number => {
        const bKey = `${cx},${cy}`;
        if (uncollectedBlocks.has(bKey)) {
          uncollectedBlocks.delete(bKey);
          availableBlocks++;
          changed = true;
        }
        const item = simItems[cy][cx];
        if (!item) return boots;
        const itemDef = ConfigRegistry.getTile(item);
        if (itemDef.collectible === 'chip') {
          collectedChips++;
          simItems[cy][cx] = null;
          changed = true;
        } else if (itemDef.collectible === 'key') {
          ownedKeys[item] = (ownedKeys[item] || 0) + 1;
          simItems[cy][cx] = null;
          changed = true;
        } else if (itemDef.collectible === 'boot') {
          return boots | (bootBits.get(item) ?? NO_BOOTS);
        }
        return boots;
      };

      const deferredDoors = new Map<string, { x: number; y: number; keyId: string }>();
      // Consumed-key doors still closed, per key: while the keys held cover them all, no order can go wrong.
      const closedDoors: Record<string, number> = {};
      for (const row of simTerrain) {
        for (const id of row) {
          const door = ConfigRegistry.getTile(id);
          if (door.requiredKey && door.consumesKey) {
            closedDoors[door.requiredKey] = (closedDoors[door.requiredKey] || 0) + 1;
          }
        }
      }
      enqueue(sx, sy, NO_BOOTS);

      for (let head = 0; head < queue.length; head++) {
        const curr = queue[head];
        const currTile = ConfigRegistry.getTile(simTerrain[curr.y][curr.x]);

        const pickedUp = collectAt(curr.x, curr.y, curr.boots);
        if (pickedUp !== curr.boots) {
          // Same cell, now holding the boot: continue from that state instead
          enqueue(curr.x, curr.y, pickedUp);
          continue;
        }

        if (currTile.isLevelExit) {
          reachableExit = true;
        }

        // A key thief the player can reach is assumed to be crossed once: the keys held then are gone.
        // Later passes carry the keys picked up since, which the same thief must not rob again.
        if (currTile.stealsKeys && !appliedKeyThieves.has(`${curr.x},${curr.y}`)) {
          appliedKeyThieves.add(`${curr.x},${curr.y}`);
          for (const keyId of Object.keys(ownedKeys)) {
            if (ownedKeys[keyId] > 0) {
              ownedKeys[keyId] = 0;
              changed = true;
            }
          }
        }

        // A reachable button lets the player set its tiles to the open state: closed
        // toggle walls open, lit flame jets go out (off jets stay off, so both are passable).
        if (currTile.buttonAction === 'toggle_walls') {
          this.openToggledTiles(simTerrain, (tile) => (tile.passableByPlayer ? undefined : tile.togglesTo), () => {
            changed = true;
          });
        }
        // A colour button opens the closed walls of its own channel only; the green button leaves them shut.
        const buttonChannel = channelOfButtonAction(currTile.buttonAction);
        if (buttonChannel) {
          this.openToggledTiles(
            simTerrain,
            (tile) => (tile.toggleChannel === buttonChannel && !tile.passableByPlayer ? tile.channelTogglesTo : undefined),
            () => {
              changed = true;
            }
          );
        }
        if (currTile.buttonAction === 'toggle_flames') {
          this.openToggledTiles(simTerrain, (tile) => (tile.hazard ? tile.flameTogglesTo : undefined), () => {
            changed = true;
          });
        }

        if (currTile.buttonAction === 'trigger_cloner') {
          level.cloneLinks.forEach((link, linkIdx) => {
            if (
              link.buttonX === curr.x &&
              link.buttonY === curr.y &&
              blockTypes.has(link.templateType) &&
              !grantedCloneLinks.has(linkIdx)
            ) {
              grantedCloneLinks.add(linkIdx);
              availableBlocks += CLONER_BLOCK_ALLOWANCE;
              changed = true;
            }
          });
        }

        if (currTile.isTeleporter) {
          for (const t of teleporters) {
            if (ConfigRegistry.getTile(simTerrain[t.y][t.x]).teleportGroup !== currTile.teleportGroup) continue;
            enqueue(t.x, t.y, curr.boots);
          }
        }

        // Standing on an unprotected force floor, the player cannot walk against it
        const pushedAgainst: Direction | null =
          currTile.slideType === 'force' &&
          !hasBoot(curr.boots, currTile.protectedByItem) &&
          currTile.forceDirection &&
          currTile.forceDirection !== 'RANDOM'
            ? OPPOSITE_DIRECTION[currTile.forceDirection]
            : null;

        for (const dir of ORDERED_DIRECTIONS) {
          if (dir === pushedAgainst) continue;
          const vec = DIRECTION_VECTORS[dir];
          const nx = curr.x + vec.dx;
          const ny = curr.y + vec.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }

          if (this.isEdgeBlocked(currTile.id, simTerrain[ny][nx], dir)) {
            continue;
          }

          let nextTile = ConfigRegistry.getTile(simTerrain[ny][nx]);

          if (nextTile.revealsToOnTouch && nextTile.revealsToOnTouch !== simTerrain[ny][nx]) {
            simTerrain[ny][nx] = nextTile.revealsToOnTouch;
            nextTile = ConfigRegistry.getTile(simTerrain[ny][nx]);
            changed = true;
          }

          if (nextTile.requiredKey) {
            const keyId = nextTile.requiredKey;
            if ((ownedKeys[keyId] || 0) > 0) {
              if (nextTile.consumesKey && (ownedKeys[keyId] || 0) < (closedDoors[keyId] || 0)) {
                // Keys are scarce: a spent key cannot be taken back, so the door waits until nothing
                // else progresses, then the most rewarding one opens (see below).
                deferredDoors.set(`${nx},${ny}`, { x: nx, y: ny, keyId });
              } else {
                if (nextTile.consumesKey) ownedKeys[keyId]--;
                closedDoors[keyId] = Math.max((closedDoors[keyId] || 0) - 1, 0);
                simTerrain[ny][nx] = nextTile.transformsToOnUnlock || FLOOR_TILE_ID;
                changed = true;
                enqueue(nx, ny, curr.boots);
              }
            }
            continue;
          }

          if (nextTile.requiresAllChips) {
            if (collectedChips >= level.chipsRequired) {
              simTerrain[ny][nx] = nextTile.transformsToOnUnlock || FLOOR_TILE_ID;
              changed = true;
              enqueue(nx, ny, curr.boots);
            }
            continue;
          }

          const gateCanOpen =
            emitterCount > 0 && nextTile.laserGateGroup !== undefined && receiverGroups.has(nextTile.laserGateGroup);
          // A hold door can be passed when blocks can hold down every plate of its colour.
          const holdDoorCanOpen =
            nextTile.holdDoorColor !== undefined && holdDoorOpenable.has(nextTile.holdDoorColor);
          if (!nextTile.passableByPlayer && !gateCanOpen && !holdDoorCanOpen) {
            continue;
          }

          // A barrier against a held item is passable here: the item can be put down
          // before it and fetched later, so reachability stays optimistic about it.

          const nextBoots = this.bootsOnArrival(curr.boots, nextTile, simItems[ny][nx], bootBits);
          const protectedHere = hasBoot(nextBoots, nextTile.protectedByItem);

          // A block pushed in turns water or slime into ground the player can cross.
          if ((nextTile.hazard === 'water' || nextTile.hazard === 'slime') && !protectedHere) {
            if (availableBlocks > 0) {
              availableBlocks--;
              simTerrain[ny][nx] = FLOOR_TILE_ID;
              changed = true;
            } else {
              continue;
            }
          }

          if (nextTile.hazard === 'fire' && !protectedHere) {
            continue;
          }

          const nextItem = simItems[ny][nx];
          if (nextItem && ConfigRegistry.getTile(nextItem).hazard === 'bomb') {
            if (availableBlocks > 0) {
              availableBlocks--;
              simItems[ny][nx] = null;
              changed = true;
            } else {
              continue;
            }
          }

          // Ice and force floors carry the player: follow the slide to where it really ends
          const landedTile = ConfigRegistry.getTile(simTerrain[ny][nx]);
          if (landedTile.slideType && !hasBoot(nextBoots, landedTile.protectedByItem)) {
            const slide = this.simulateSlide(
              simTerrain,
              simItems,
              nx,
              ny,
              dir,
              nextBoots,
              hasBoot,
              bootBits
            );
            if (slide.fatal) {
              continue;
            }
            for (const passed of slide.path) {
              collectAt(passed.x, passed.y, slide.boots);
            }
            enqueue(slide.end.x, slide.end.y, slide.boots);
            continue;
          }

          enqueue(nx, ny, nextBoots);
        }
      }

      if (!changed && deferredDoors.size > 0) {
        const best = this.pickRewardingDoor([...deferredDoors.values()], simTerrain, simItems);
        const doorTile = ConfigRegistry.getTile(simTerrain[best.y][best.x]);
        ownedKeys[best.keyId]--;
        simTerrain[best.y][best.x] = doorTile.transformsToOnUnlock || FLOOR_TILE_ID;
        changed = true;
      }
    }

    // The simulator is a conservative model: a stored solution that wins in the real engine is
    // stronger evidence, so a reachability miss then only warns (the simulator is what is wrong).
    const chipsMissed = collectedChips < level.chipsRequired;
    const exitMissed = needsExit && exitCount > 0 && !reachableExit;
    const provenSolvable = (chipsMissed || exitMissed) && this.storedSolutionWins(level, solutionWins);
    const missSeverity = provenSolvable ? 'warning' : 'error';

    if (chipsMissed) {
      issues.push({
        severity: missSeverity,
        i18nKey: provenSolvable
          ? 'validator.issues.unreachable_chips_proven.label'
          : 'validator.issues.unreachable_chips.label',
        params: { reachable: collectedChips, required: level.chipsRequired }
      });
    }

    if (exitMissed) {
      issues.push({
        severity: missSeverity,
        i18nKey: provenSolvable
          ? 'validator.issues.unreachable_exit_proven.label'
          : 'validator.issues.unreachable_exit.label'
      });
    }

    const hasErrors = issues.some((i) => i.severity === 'error');
    return {
      valid: !hasErrors,
      issues,
      stats: {
        chipsPlaced,
        chipsRequired: level.chipsRequired,
        exitCount,
        reachableChips: collectedChips,
        reachableExit,
        targetCount
      }
    };
  }

  /**
   * Warns when a collectible item or a hint tile lies on a cell a pushable
   * block can reach: a block covering it hides it from the player. Cheap
   * approximation: the cells each block type can reach from its starts by
   * pushes: a block moves from a cell to a neighbour only when that neighbour
   * is block-passable and the cell opposite is ground the player can stand on.
   * Other blocks and the player's route are ignored. A
   * hazard the block type refuses (mirrors and water) is never entered; water
   * the block may enter is reached but not crossed, since the block sinks there.
   */
  /**
   * True for ground nobody can ever stand on: walls and fixtures. Doors, sockets, toggle walls
   * and hazards are not solid here, since a key, chips, a switch, boots or a filled pool can
   * make them standable, so a push from them is still possible.
   */
  private static isSolidForPusher(terrainId: string): boolean {
    return (
      PERMANENT_SOLID_TILES.has(terrainId) ||
      terrainId.startsWith('laser_emitter') ||
      terrainId.startsWith('laser_receiver')
    );
  }

  /**
   * The cells a block pushed from (x, y) one step in `dir` may reach: the cell
   * it enters and, when that cell is ice and the block type slides on ice,
   * every cell its slide passes over (another block in the lane could stop it
   * on any of them). The slide follows the engine: an ice corner deflects the
   * direction, the block stops on the first non-ice cell, vanishes in water or
   * slime (or in fire when the type burns), and when blocked on ice it bounces
   * back along the lane. Other blocks, the player and the exact slide timing
   * are ignored, so the result over-approximates. Known limits: force floors
   * after the ice are not followed, and terrain changed during play (melted or
   * filled cells) is not modelled. Without ice it is just the entered cell.
   */
  private static blockLandings(level: CompiledLevel, type: string, x: number, y: number, dir: Direction): GridPoint[] {
    const vec = DIRECTION_VECTORS[dir];
    const entered = { x: x + vec.dx, y: y + vec.dy };
    const def = ConfigRegistry.getEntityDef(type);
    const refused = def?.refusesHazards ?? [];
    const enterTile = ConfigRegistry.getTile(level.terrain[entered.y][entered.x]);
    if (enterTile.slideType !== 'ice' || !def?.slidesOnIce) return [entered];

    const height = level.terrain.length;
    const width = level.terrain[0]?.length ?? 0;
    const canEnter = (fx: number, fy: number, d: Direction): GridPoint | null => {
      const v = DIRECTION_VECTORS[d];
      const tx = fx + v.dx;
      const ty = fy + v.dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
      const dest = ConfigRegistry.getTile(level.terrain[ty][tx]);
      if (dest.passableByBlock !== true) return null;
      if (dest.hazard && refused.includes(dest.hazard)) return null;
      if (this.isEdgeBlocked(level.terrain[fy][fx], level.terrain[ty][tx], d)) return null;
      return { x: tx, y: ty };
    };

    const landings: GridPoint[] = [];
    const visited = new Set<string>();
    let cur = entered;
    let heading: Direction = enterTile.deflectionMap?.[dir] ?? dir;
    for (;;) {
      landings.push(cur);
      const tile = ConfigRegistry.getTile(level.terrain[cur.y][cur.x]);
      // A block that sank or dissolved rests nowhere further on; fire only destroys the types that burn.
      if (tile.hazard === 'water' || tile.hazard === 'slime') break;
      if (tile.hazard === 'fire' && def?.destroyedByFire) break;
      if (tile.slideType !== 'ice') break;
      const key = `${cur.x},${cur.y},${heading}`;
      if (visited.has(key)) break;
      visited.add(key);
      const next = canEnter(cur.x, cur.y, heading);
      if (next) {
        cur = next;
        const nextTile = ConfigRegistry.getTile(level.terrain[cur.y][cur.x]);
        if (nextTile.slideType === 'ice') heading = nextTile.deflectionMap?.[heading] ?? heading;
        continue;
      }
      const bounce = tile.deflectionMap?.[OPPOSITE_DIRECTION[heading]] ?? OPPOSITE_DIRECTION[heading];
      const back = canEnter(cur.x, cur.y, bounce);
      if (!back) break;
      cur = back;
      heading = bounce;
      const backTile = ConfigRegistry.getTile(level.terrain[cur.y][cur.x]);
      if (backTile.slideType === 'ice') heading = backTile.deflectionMap?.[heading] ?? heading;
    }
    return landings;
  }

  private static checkHiddenByBlocks(level: CompiledLevel, issues: ValidationIssue[]): void {
    const height = level.terrain.length;
    const width = level.terrain[0]?.length ?? 0;
    const starts = new Map<string, GridPoint[]>();
    for (const e of level.entities) {
      if (ConfigRegistry.getEntityDef(e.type)?.kind !== 'block') continue;
      if (e.x < 0 || e.y < 0 || e.x >= width || e.y >= height) continue;
      starts.set(e.type, [...(starts.get(e.type) ?? []), { x: e.x, y: e.y }]);
    }
    const reached = new Uint8Array(width * height);
    for (const [type, origins] of starts) {
      const refused = ConfigRegistry.getEntityDef(type)?.refusesHazards ?? [];
      const seen = new Uint8Array(width * height);
      const queue: GridPoint[] = [];
      for (const o of origins) {
        seen[o.y * width + o.x] = 1;
        queue.push(o);
      }
      for (let head = 0; head < queue.length; head++) {
        const { x, y } = queue[head];
        const here = ConfigRegistry.getTile(level.terrain[y][x]);
        // A block that sank, dissolved or burned is gone: nothing is pushed on from there.
        if (here.hazard === 'water' || here.hazard === 'slime') continue;
        if (here.hazard === 'fire' && ConfigRegistry.getEntityDef(type)?.destroyedByFire) continue;
        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = x + vec.dx;
          const ny = y + vec.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const dest = ConfigRegistry.getTile(level.terrain[ny][nx]);
          if (dest.passableByBlock !== true) continue;
          if (dest.hazard && refused.includes(dest.hazard)) continue;
          if (this.isEdgeBlocked(level.terrain[y][x], level.terrain[ny][nx], dir)) continue;
          // The player must be able to stand on the cell behind the block to push it this way.
          const px = x - vec.dx;
          const py = y - vec.dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          if (this.isSolidForPusher(level.terrain[py][px])) continue;
          for (const cell of this.blockLandings(level, type, x, y, dir)) {
            if (seen[cell.y * width + cell.x]) continue;
            seen[cell.y * width + cell.x] = 1;
            queue.push(cell);
          }
        }
      }
      for (let i = 0; i < seen.length; i++) if (seen[i]) reached[i] = 1;
    }
    let hidden = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!reached[y * width + x]) continue;
        const item = level.items[y][x];
        const collectible = item !== null && ConfigRegistry.getTile(item).collectible !== undefined;
        if (collectible || level.terrain[y][x] === HINT_TILE_ID) hidden++;
      }
    }
    if (hidden > 0) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.hidden_by_block.label', params: { count: hidden } });
    }
  }

  /** Warns when the player starts inside a wall or on a cell that holds an entity. */
  private static checkStartCell(level: CompiledLevel, issues: ValidationIssue[]): void {
    const { x, y } = level.playerStart;
    if (level.terrain[y][x] === WALL_TILE_ID) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.start_on_wall.label' });
    }
    if ((level.entities ?? []).some((e) => e.x === x && e.y === y)) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.start_on_entity.label' });
    }
  }

  /** Warns about links whose button or target cell is no longer the tile the link needs. */
  private static checkLinkEndpoints(level: CompiledLevel, issues: ValidationIssue[]): void {
    const tileAt = (x: number, y: number): TileDefinition | undefined => {
      const id = level.terrain[y]?.[x];
      return id === undefined ? undefined : ConfigRegistry.getTile(id);
    };
    for (const link of level.trapLinks ?? []) {
      if (tileAt(link.buttonX, link.buttonY)?.buttonAction !== 'hold_trap') {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.trap_link_button.label',
          params: { x: link.buttonX, y: link.buttonY }
        });
      }
      if (!tileAt(link.trapX, link.trapY)?.isTrap) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.trap_link_target.label',
          params: { x: link.trapX, y: link.trapY }
        });
      }
    }
    for (const link of level.cloneLinks ?? []) {
      if (tileAt(link.buttonX, link.buttonY)?.buttonAction !== 'trigger_cloner') {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.clone_link_button.label',
          params: { x: link.buttonX, y: link.buttonY }
        });
      }
      if (!tileAt(link.clonerX, link.clonerY)?.isCloneMachine) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.clone_link_target.label',
          params: { x: link.clonerX, y: link.clonerY }
        });
      }
    }
  }

  /**
   * Groups with a laser gate standing on a beam while that beam lights a
   * receiver that drives gates (of its own group or another): closed, the gate
   * cuts a beam that opens gates, so it can hold itself shut or swap state with
   * another gate forever. The beams are traced from the level as laid out,
   * every gate taken as open.
   */
  private static findSelfFeedingGateGroups(level: CompiledLevel): string[] {
    const openedLevel: CompiledLevel = {
      ...level,
      terrain: level.terrain.map((row) =>
        row.map((id) => {
          const tile = ConfigRegistry.getTile(id);
          return tile.laserGateGroup !== undefined && !tile.laserGateOpen && tile.laserGateTogglesTo
            ? tile.laserGateTogglesTo
            : id;
        })
      )
    };
    const engine = new GameEngine();
    engine.loadLevel(openedLevel);
    const terrain = engine.getTerrain();
    const gateGroups = new Set<string>();
    for (const row of terrain) {
      for (const id of row) {
        const group = ConfigRegistry.getTile(id).laserGateGroup;
        if (group !== undefined) gateGroups.add(group);
      }
    }
    const litDrivesGates = engine.getLitReceivers().some(({ x, y }) => {
      const group = ConfigRegistry.getTile(terrain[y][x]).laserReceiverGroup;
      return group !== undefined && gateGroups.has(group);
    });
    if (!litDrivesGates) return [];
    const flagged = new Set<string>();
    for (const { x, y } of engine.getBeamCells()) {
      const group = ConfigRegistry.getTile(terrain[y][x]).laserGateGroup;
      if (group !== undefined) flagged.add(group);
    }
    return [...flagged].sort();
  }

  /**
   * Rules of a level won by covering block targets: at least one target, at
   * least as many blocks as targets, and, when the exact block search can
   * prove it, a way to cover them all. An inconclusive search is silent.
   */
  private static checkTargets(level: CompiledLevel, targetCount: number, issues: ValidationIssue[]): void {
    if (targetCount === 0) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.no_targets.label' });
      return;
    }
    const blockTypes = new Set(
      Object.values(ConfigRegistry.getMonsters().entities)
        .filter((def) => def.kind === 'block')
        .map((def) => def.id)
    );
    const blocks = level.entities.filter((e) => blockTypes.has(e.type)).length;
    const hasCloner = level.cloneLinks.some((link) => blockTypes.has(link.templateType));
    if (blocks < targetCount && !hasCloner) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.fewer_blocks_than_targets.label',
        params: { blocks, targets: targetCount }
      });
      return;
    }
    const start = level.playerStart;
    const startInGrid =
      Number.isInteger(start.x) &&
      Number.isInteger(start.y) &&
      start.y >= 0 &&
      start.y < level.terrain.length &&
      start.x >= 0 &&
      start.x < (level.terrain[0]?.length ?? 0);
    if (!startInGrid) return;
    // The block search plays the Epoxy rules; a Lynx or CC3D level is not played by them.
    switch (level.ruleset) {
      case 'lynx':
      case 'cc3d':
        return;
      case 'epoxy':
      case undefined:
        break;
      default: {
        const unreachable: never = level.ruleset;
        throw new Error(`Unknown ruleset: ${String(unreachable)}`);
      }
    }
    const engine = new GameEngine();
    engine.loadLevel(level);
    if (BlockPuzzleSolver.isStuck(engine, requestedSearchBudget())) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.targets_unsolvable.label' });
    }
  }

  /**
   * Follows an ice or force floor slide from its first cell. The slide is
   * fatal when it runs into water, fire or a bomb without protection, when it
   * hits a random force floor (its outcome cannot be predicted), or when it
   * loops for longer than the grid has cells.
   */
  private static simulateSlide(
    terrain: string[][],
    items: (string | null)[][],
    startX: number,
    startY: number,
    entryDir: Direction,
    startBoots: number,
    hasBoot: BootCheck,
    bootBits: Map<string, number>
  ): SlideResult {
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const maxSteps = width * height;

    let x = startX;
    let y = startY;
    let dir = entryDir;
    let boots = startBoots;
    const path: GridPoint[] = [{ x, y }];
    const fatal = (): SlideResult => ({ end: { x, y }, path, boots, fatal: true });

    const canEnter = (fromTile: TileDefinition, d: Direction): GridPoint | null => {
      const vec = DIRECTION_VECTORS[d];
      const nx = x + vec.dx;
      const ny = y + vec.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return null;
      if (this.isEdgeBlocked(fromTile.id, terrain[ny][nx], d)) return null;
      if (!ConfigRegistry.getTile(terrain[ny][nx]).passableByPlayer) return null;
      return { x: nx, y: ny };
    };

    for (let step = 0; step < maxSteps; step++) {
      const tile = ConfigRegistry.getTile(terrain[y][x]);
      if (!tile.slideType || hasBoot(boots, tile.protectedByItem)) {
        return { end: { x, y }, path, boots, fatal: false };
      }

      if (tile.slideType === 'force') {
        if (tile.forceDirection === 'RANDOM') return fatal();
        dir = tile.forceDirection || dir;
      } else {
        dir = tile.deflectionMap?.[dir] || dir;
      }

      let next = canEnter(tile, dir);
      if (!next && tile.slideType === 'ice') {
        // Bounce back on ice
        const bounceDir = OPPOSITE_DIRECTION[dir];
        dir = tile.deflectionMap?.[bounceDir] || bounceDir;
        next = canEnter(tile, dir);
      }
      if (!next) {
        // Blocked both ways: the player stops here and walks off on foot
        return { end: { x, y }, path, boots, fatal: false };
      }

      x = next.x;
      y = next.y;
      path.push({ x, y });

      const entered = ConfigRegistry.getTile(terrain[y][x]);
      const item = items[y][x];
      if (item && ConfigRegistry.getTile(item).hazard === 'bomb') return fatal();
      boots = this.bootsOnArrival(boots, entered, item, bootBits);
      if (
        (entered.hazard === 'water' || entered.hazard === 'fire' || entered.hazard === 'slime') &&
        !hasBoot(boots, entered.protectedByItem)
      ) {
        return fatal();
      }
    }

    return fatal();
  }

  /** One bit per boot type of the tile config, in a stable order. */
  private static buildBootBits(): Map<string, number> {
    const bits = new Map<string, number>();
    const bootIds = Object.values(ConfigRegistry.getTiles().tiles)
      .filter((t) => t.collectible === 'boot')
      .map((t) => t.id)
      .sort()
      .slice(0, MAX_TRACKED_BOOT_TYPES);
    bootIds.forEach((id, idx) => bits.set(id, 1 << idx));
    return bits;
  }

  /** Replaces every tile for which `target` names a terrain, reporting each change. */
  /**
   * Warnings about the colour channels: a hold door whose colour has no plate (it can never open), colour
   * walls with no button of their channel, a colour button with no wall to move, and a hold door placed
   * in the state its plates will not leave it in at the start (the engine corrects it when the level loads).
   */
  private static checkColorChannels(level: CompiledLevel, issues: ValidationIssue[]): void {
    const platesByColor = new Map<ChannelColor, GridPoint[]>();
    const doorsByColor = new Map<ChannelColor, Array<GridPoint & { open: boolean }>>();
    const wallsByChannel = new Map<ChannelColor, number>();
    const buttonsByChannel = new Map<ChannelColor, number>();
    const push = <T>(map: Map<ChannelColor, T[]>, color: ChannelColor, value: T): void => {
      map.set(color, [...(map.get(color) ?? []), value]);
    };
    level.terrain.forEach((row, y) =>
      row.forEach((id, x) => {
        const tile = ConfigRegistry.getTile(id);
        if (tile.plateColor !== undefined) push(platesByColor, tile.plateColor, { x, y });
        if (tile.holdDoorColor !== undefined) {
          push(doorsByColor, tile.holdDoorColor, { x, y, open: tile.holdDoorOpen === true });
        }
        if (tile.toggleChannel !== undefined) {
          wallsByChannel.set(tile.toggleChannel, (wallsByChannel.get(tile.toggleChannel) ?? 0) + 1);
        }
        const channel = channelOfButtonAction(tile.buttonAction);
        if (channel) buttonsByChannel.set(channel, (buttonsByChannel.get(channel) ?? 0) + 1);
      })
    );

    const pressedAtStart = (plate: GridPoint, color: ChannelColor): boolean =>
      (level.playerStart.x === plate.x && level.playerStart.y === plate.y) ||
      level.entities.some((e) => {
        if (e.x !== plate.x || e.y !== plate.y) return false;
        const kind = ConfigRegistry.getEntityDef(e.type)?.kind;
        return kind !== undefined && entityPressesPlate(e.type, kind, color);
      });

    for (const [color, doors] of doorsByColor) {
      const plates = platesByColor.get(color) ?? [];
      if (plates.length === 0) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.hold_door_no_plate.label', params: { color } });
        continue;
      }
      const shouldBeOpen = plates.every((plate) => pressedAtStart(plate, color));
      if (doors.some((door) => door.open !== shouldBeOpen)) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.hold_door_wrong_start.label', params: { color } });
      }
    }
    for (const [channel, count] of wallsByChannel) {
      if (!buttonsByChannel.has(channel) && count > 0) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.channel_walls_no_button.label', params: { color: channel } });
      }
    }
    for (const channel of buttonsByChannel.keys()) {
      if (!wallsByChannel.has(channel)) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.channel_button_no_walls.label', params: { color: channel } });
      }
    }
  }

  /**
   * Colours whose hold doors the player can pass, as far as the level can tell: the colour has at least one
   * plate and at least as many things that can lie on a plate for good (blocks, monsters that press plates,
   * a cloned block) as it has plates. The player cannot hold a plate and walk through the door too.
   */
  private static openableHoldDoorColors(level: CompiledLevel): Set<ChannelColor> {
    const platesByColor = new Map<ChannelColor, number>();
    const doorColors = new Set<ChannelColor>();
    for (const row of level.terrain) {
      for (const id of row) {
        const tile = ConfigRegistry.getTile(id);
        if (tile.plateColor !== undefined) platesByColor.set(tile.plateColor, (platesByColor.get(tile.plateColor) ?? 0) + 1);
        if (tile.holdDoorColor !== undefined) doorColors.add(tile.holdDoorColor);
      }
    }
    const openable = new Set<ChannelColor>();
    for (const color of doorColors) {
      const plates = platesByColor.get(color) ?? 0;
      if (plates === 0) continue;
      let pressers = 0;
      for (const entity of level.entities) {
        const kind = ConfigRegistry.getEntityDef(entity.type)?.kind;
        if (kind !== undefined && entityPressesPlate(entity.type, kind, color)) pressers++;
      }
      for (const link of level.cloneLinks) {
        if (ConfigRegistry.getEntityDef(link.templateType)?.kind === 'block' && entityPressesPlate(link.templateType, 'block', color)) {
          pressers += CLONER_BLOCK_ALLOWANCE;
        }
      }
      if (pressers >= plates) openable.add(color);
    }
    return openable;
  }

  private static openToggledTiles(
    simTerrain: string[][],
    target: (tile: TileDefinition) => string | undefined,
    onChange: () => void
  ): void {
    for (let ty = 0; ty < simTerrain.length; ty++) {
      for (let tx = 0; tx < simTerrain[ty].length; tx++) {
        const next = target(ConfigRegistry.getTile(simTerrain[ty][tx]));
        if (next && next !== simTerrain[ty][tx]) {
          simTerrain[ty][tx] = next;
          onChange();
        }
      }
    }
  }

  /** Boots held after entering a cell: its boot item is picked up first, then a thief takes everything. */
  private static bootsOnArrival(
    boots: number,
    tile: TileDefinition,
    itemId: string | null,
    bootBits: Map<string, number>
  ): number {
    if (tile.stealsBoots) return NO_BOOTS;
    return itemId ? boots | (bootBits.get(itemId) ?? NO_BOOTS) : boots;
  }

  /**
   * Whether the exit can be reached without passing a socket. Thin walls bind
   * exactly as in the engine, and a key door is crossed only with a key of its
   * colour picked up on the way,
   * so a key kept behind the socket opens nothing here. A consumed key is
   * treated as reusable once one is held: this over-approximates, so a rare false
   * bypass is possible but a real one is never missed.
   */
  /**
   * Chooses which door a spent key opens first: the one whose room holds the
   * most keys, then chips. Greedy reachability cannot undo a key spent on the
   * wrong door, so the order matters on key-order traps.
   */
  private static pickRewardingDoor(
    doors: { x: number; y: number; keyId: string }[],
    terrain: string[][],
    items: (string | null)[][]
  ): { x: number; y: number; keyId: string } {
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const closedByKey: Record<string, number> = {};
    for (const row of terrain) {
      for (const id of row) {
        const required = ConfigRegistry.getTile(id).requiredKey;
        if (required) closedByKey[required] = (closedByKey[required] || 0) + 1;
      }
    }
    // The flood below only follows walkable terrain: hazards and boots are ignored, as this is a ranking.
    const score = (door: { x: number; y: number; keyId: string }): number => {
      const seen = new Set<string>([`${door.x},${door.y}`]);
      const stack: GridPoint[] = [{ x: door.x, y: door.y }];
      let keyCount = 0;
      let chipCount = 0;
      while (stack.length > 0) {
        const cell = stack.pop() as GridPoint;
        const item = items[cell.y][cell.x];
        const collectible = item ? ConfigRegistry.getTile(item).collectible : undefined;
        // A key only counts while a door of its colour would still be closed once this one is open.
        if (item && collectible === 'key' && (closedByKey[item] || 0) - (item === door.keyId ? 1 : 0) > 0) {
          keyCount++;
        }
        if (collectible === 'chip') chipCount++;
        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = cell.x + vec.dx;
          const ny = cell.y + vec.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen.has(`${nx},${ny}`)) continue;
          if (this.isEdgeBlocked(terrain[cell.y][cell.x], terrain[ny][nx], dir)) continue;
          if (!ConfigRegistry.getTile(terrain[ny][nx]).passableByPlayer) continue;
          seen.add(`${nx},${ny}`);
          stack.push({ x: nx, y: ny });
        }
      }
      return keyCount * DOOR_KEY_WEIGHT + chipCount;
    };
    return doors.reduce((best, door) => (score(door) > score(best) ? door : best));
  }

  /** Whether the level's stored solution replays to a win in the real engine. */
  private static storedSolutionWins(level: CompiledLevel, solutionWins?: SolutionWins): boolean {
    if (!level.solution || !solutionWins) return false;
    try {
      return solutionWins(level);
    } catch {
      return false;
    }
  }

  private static canReachExitWithoutSocket(level: CompiledLevel): boolean {
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;
    const { x: sx, y: sy } = level.playerStart;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return false;
    }
    const terrain = level.terrain.map((row) => [...row]);
    const picked = new Set<string>();
    const ownedKeys: Record<string, number> = {};
    let changed = true;

    while (changed) {
      changed = false;
      const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
      const queue: GridPoint[] = [{ x: sx, y: sy }];
      visited[sy][sx] = true;

      for (let head = 0; head < queue.length; head++) {
        const curr = queue[head];
        const currTile = ConfigRegistry.getTile(terrain[curr.y][curr.x]);
        if (currTile.isLevelExit) {
          return true;
        }
        const cellKey = `${curr.x},${curr.y}`;
        const item = level.items[curr.y]?.[curr.x];
        if (item && !picked.has(cellKey) && ConfigRegistry.getTile(item).collectible === 'key') {
          picked.add(cellKey);
          ownedKeys[item] = (ownedKeys[item] || 0) + 1;
          changed = true;
        }
        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = curr.x + vec.dx;
          const ny = curr.y + vec.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;
          if (this.isEdgeBlocked(currTile.id, terrain[ny][nx], dir)) continue;
          const nextTile = ConfigRegistry.getTile(terrain[ny][nx]);
          if (nextTile.requiresAllChips) continue;
          if (nextTile.requiredKey) {
            if ((ownedKeys[nextTile.requiredKey] || 0) <= 0) continue;
            terrain[ny][nx] = nextTile.transformsToOnUnlock || FLOOR_TILE_ID;
            changed = true;
          } else if (!nextTile.passableByPlayer) {
            continue;
          }
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return false;
  }

  private static isEdgeBlocked(fromId: string, toId: string, dir: Direction): boolean {
    return isEdgeBlockedBetween(fromId, toId, dir);
  }
}
