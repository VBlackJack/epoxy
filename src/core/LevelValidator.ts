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
import { FLOOR_TILE_ID, OPPOSITE_DIRECTION } from './coreConstants';
import {
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

interface QueuedCell extends GridPoint {
  boots: number;
}

interface SlideResult {
  end: GridPoint;
  path: GridPoint[];
  boots: number;
  fatal: boolean;
}

type BootCheck = (boots: number, bootId: string | undefined) => boolean;

export class LevelValidator {
  public static validate(level: CompiledLevel): LevelValidationReport {
    const issues: ValidationIssue[] = [];
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;

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

    if (exitCount === 0) {
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
          reachableExit: false
        }
      };
    }

    if (exitCount > 0 && level.chipsRequired > 0) {
      if (this.canReachExitWithoutSocket(level)) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.socket_bypass.label'
        });
      }
    }

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

        if (currTile.buttonAction === 'toggle_walls') {
          for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
              const toggled = ConfigRegistry.getTile(simTerrain[ty][tx]);
              if (toggled.togglesTo && !toggled.passableByPlayer) {
                simTerrain[ty][tx] = toggled.togglesTo;
                changed = true;
              }
            }
          }
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
              if (nextTile.consumesKey) {
                ownedKeys[keyId]--;
              }
              simTerrain[ny][nx] = nextTile.transformsToOnUnlock || FLOOR_TILE_ID;
              changed = true;
              enqueue(nx, ny, curr.boots);
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

          if (!nextTile.passableByPlayer) {
            continue;
          }

          const nextBoots = this.bootsOnArrival(curr.boots, nextTile, simItems[ny][nx], bootBits);
          const protectedHere = hasBoot(nextBoots, nextTile.protectedByItem);

          if (nextTile.hazard === 'water' && !protectedHere) {
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
    }

    if (collectedChips < level.chipsRequired) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.unreachable_chips.label',
        params: { reachable: collectedChips, required: level.chipsRequired }
      });
    }

    if (exitCount > 0 && !reachableExit) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.unreachable_exit.label'
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
        reachableExit
      }
    };
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
        (entered.hazard === 'water' || entered.hazard === 'fire') &&
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

  private static canReachExitWithoutSocket(level: CompiledLevel): boolean {
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;
    const { x: sx, y: sy } = level.playerStart;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return false;
    }
    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: GridPoint[] = [{ x: sx, y: sy }];
    visited[sy][sx] = true;

    for (let head = 0; head < queue.length; head++) {
      const curr = queue[head];
      const currTile = ConfigRegistry.getTile(level.terrain[curr.y][curr.x]);
      if (currTile.isLevelExit) {
        return true;
      }
      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = curr.x + vec.dx;
        const ny = curr.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;
        const nextTile = ConfigRegistry.getTile(level.terrain[ny][nx]);
        if (nextTile.requiresAllChips) continue;
        if (!nextTile.passableByPlayer && !nextTile.requiredKey) {
          continue;
        }
        visited[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  private static isEdgeBlocked(fromId: string, toId: string, dir: Direction): boolean {
    const fromTile = ConfigRegistry.getTile(fromId);
    const toTile = ConfigRegistry.getTile(toId);
    const opposite = OPPOSITE_DIRECTION[dir];

    if (fromTile.blockedEdges?.includes(dir)) return true;
    if (toTile.blockedEdges?.includes(opposite)) return true;
    if (fromTile.blockedEntryDirections?.includes(opposite)) return true;
    if (toTile.blockedEntryDirections?.includes(dir)) return true;
    return false;
  }
}
