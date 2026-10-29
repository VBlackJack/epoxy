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
import { CompiledLevel, Direction, LevelValidationReport, ValidationIssue } from './types';

export class LevelValidator {
  public static validate(level: CompiledLevel): LevelValidationReport {
    const issues: ValidationIssue[] = [];
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;

    let chipsPlaced = 0;
    let exitCount = 0;
    const doorCounts: Record<string, number> = {};
    const keyCounts: Record<string, number> = {};

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tId = level.terrain[y][x];
        const iId = level.items[y][x];
        const tDef = ConfigRegistry.getTile(tId);
        if (tDef.isLevelExit) {
          exitCount++;
        }
        if (tDef.requiredKey) {
          doorCounts[tDef.requiredKey] = (doorCounts[tDef.requiredKey] || 0) + 1;
        }
        if (iId === 'chip') {
          chipsPlaced++;
        } else if (iId && iId.startsWith('key_')) {
          keyCounts[iId] = (keyCounts[iId] || 0) + 1;
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

    for (const keyId of ['key_red', 'key_blue', 'key_yellow']) {
      const doors = doorCounts[keyId] || 0;
      const keys = keyCounts[keyId] || 0;
      if (doors > keys) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.fewer_keys_than_doors.label',
          params: { key: keyId, keys, doors }
        });
      }
    }

    if ((doorCounts['key_green'] || 0) > 0 && (keyCounts['key_green'] || 0) === 0) {
      issues.push({
        severity: 'error',
        i18nKey: 'validator.issues.no_matching_key.label',
        params: { key: 'key_green', doors: doorCounts['key_green'] }
      });
    }

    if (exitCount > 0 && level.chipsRequired > 0) {
      if (this.canReachExitWithoutSocket(level)) {
        issues.push({
          severity: 'error',
          i18nKey: 'validator.issues.unreachable_exit.label'
        });
      }
    }

    const simTerrain = level.terrain.map((row) => [...row]);
    const simItems = level.items.map((row) => [...row]);
    const ownedKeys: Record<string, number> = {};
    const ownedBoots = new Set<string>();
    let collectedChips = 0;
    let reachableExit = false;

    let availableBlocks = level.cloneLinks.some((c) => c.templateType === 'dirt_block') ? 10 : 0;
    const uncollectedBlocks = new Set<string>(
      level.entities
        .filter((e) => e.type === 'dirt_block' || e.type === 'ice_block')
        .map((e) => `${e.x},${e.y}`)
    );

    let changed = true;
    let iterations = 0;

    while (changed && iterations < 60) {
      changed = false;
      iterations++;

      const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
      const queue: Array<{ x: number; y: number }> = [];

      const sx = level.playerStart.x;
      const sy = level.playerStart.y;
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        visited[sy][sx] = true;
        queue.push({ x: sx, y: sy });
      }

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const currTile = ConfigRegistry.getTile(simTerrain[curr.y][curr.x]);

        const collectAt = (cx: number, cy: number): void => {
          const bKey = `${cx},${cy}`;
          if (uncollectedBlocks.has(bKey)) {
            uncollectedBlocks.delete(bKey);
            availableBlocks++;
            changed = true;
          }
          const item = simItems[cy][cx];
          if (!item) return;
          if (item === 'chip') {
            collectedChips++;
            simItems[cy][cx] = null;
            changed = true;
          } else if (item.startsWith('key_')) {
            ownedKeys[item] = (ownedKeys[item] || 0) + 1;
            simItems[cy][cx] = null;
            changed = true;
          } else if (item.startsWith('boots_')) {
            ownedBoots.add(item);
            simItems[cy][cx] = null;
            changed = true;
          }
        };

        collectAt(curr.x, curr.y);

        if (currTile.isLevelExit) {
          reachableExit = true;
        }

        if (currTile.buttonAction === 'toggle_walls') {
          for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
              if (simTerrain[ty][tx] === 'toggle_wall_closed') {
                simTerrain[ty][tx] = 'toggle_wall_open';
                changed = true;
              }
            }
          }
        }

        if (currTile.isTeleporter) {
          for (let ty = 0; ty < height; ty++) {
            for (let tx = 0; tx < width; tx++) {
              if (simTerrain[ty][tx] === 'teleport' && !visited[ty][tx]) {
                visited[ty][tx] = true;
                queue.push({ x: tx, y: ty });
              }
            }
          }
        }

        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = curr.x + vec.dx;
          const ny = curr.y + vec.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }

          if (this.isEdgeBlocked(currTile.id, simTerrain[ny][nx], dir)) {
            continue;
          }

          const nextId = simTerrain[ny][nx];
          const nextTile = ConfigRegistry.getTile(nextId);

          if (nextTile.revealsToOnTouch === 'floor') {
            simTerrain[ny][nx] = 'floor';
            changed = true;
          }

          if (nextTile.requiredKey) {
            const keyId = nextTile.requiredKey;
            if ((ownedKeys[keyId] || 0) > 0) {
              if (nextTile.consumesKey) {
                ownedKeys[keyId]--;
              }
              simTerrain[ny][nx] = nextTile.transformsToOnUnlock || 'floor';
              changed = true;
              if (!visited[ny][nx]) {
                visited[ny][nx] = true;
                queue.push({ x: nx, y: ny });
              }
            }
            continue;
          }

          if (nextTile.requiresAllChips) {
            if (collectedChips >= level.chipsRequired) {
              simTerrain[ny][nx] = nextTile.transformsToOnUnlock || 'floor';
              changed = true;
              if (!visited[ny][nx]) {
                visited[ny][nx] = true;
                queue.push({ x: nx, y: ny });
              }
            }
            continue;
          }

          if (!nextTile.passableByPlayer) {
            continue;
          }

          if (nextTile.hazard === 'water' && !ownedBoots.has('boots_water')) {
            if (availableBlocks > 0) {
              availableBlocks--;
              simTerrain[ny][nx] = 'floor';
              changed = true;
            } else {
              continue;
            }
          }

          if (nextTile.hazard === 'fire' && !ownedBoots.has('boots_fire')) {
            continue;
          }

          if (simItems[ny][nx] === 'bomb') {
            if (availableBlocks > 0) {
              availableBlocks--;
              simItems[ny][nx] = null;
              changed = true;
            } else {
              continue;
            }
          }

          // Simulate true ice sliding when player does not have boots_ice
          if (nextTile.slideType === 'ice' && !ownedBoots.has('boots_ice')) {
            const slideResult = this.simulateIceSlide(simTerrain, nx, ny, dir);
            for (const passed of slideResult.path) {
              collectAt(passed.x, passed.y);
            }
            const endPt = slideResult.end;
            if (!visited[endPt.y][endPt.x]) {
              visited[endPt.y][endPt.x] = true;
              queue.push(endPt);
            }
            continue;
          }

          if (!visited[ny][nx]) {
            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny });
          }
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

  private static simulateIceSlide(
    terrain: string[][],
    startX: number,
    startY: number,
    entryDir: Direction
  ): { end: { x: number; y: number }; path: Array<{ x: number; y: number }> } {
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const oppositeMap: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

    let x = startX;
    let y = startY;
    let dir = entryDir;
    const path: Array<{ x: number; y: number }> = [{ x, y }];

    for (let step = 0; step < 32; step++) {
      const tile = ConfigRegistry.getTile(terrain[y][x]);
      if (tile.slideType !== 'ice') {
        break;
      }
      dir = tile.deflectionMap?.[dir] || dir;
      const vec = DIRECTION_VECTORS[dir];
      const nx = x + vec.dx;
      const ny = y + vec.dy;

      if (
        nx < 0 ||
        nx >= width ||
        ny < 0 ||
        ny >= height ||
        this.isEdgeBlocked(tile.id, terrain[ny][nx], dir) ||
        !ConfigRegistry.getTile(terrain[ny][nx]).passableByPlayer
      ) {
        // Bounce back on ice
        const bounceDir = oppositeMap[dir];
        dir = tile.deflectionMap?.[bounceDir] || bounceDir;
        const bVec = DIRECTION_VECTORS[dir];
        const bx = x + bVec.dx;
        const by = y + bVec.dy;
        if (
          bx < 0 ||
          bx >= width ||
          by < 0 ||
          by >= height ||
          this.isEdgeBlocked(tile.id, terrain[by][bx], dir) ||
          !ConfigRegistry.getTile(terrain[by][bx]).passableByPlayer
        ) {
          break;
        }
        x = bx;
        y = by;
        path.push({ x, y });
      } else {
        x = nx;
        y = ny;
        path.push({ x, y });
      }
    }

    return { end: { x, y }, path };
  }

  private static canReachExitWithoutSocket(level: CompiledLevel): boolean {
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;
    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: Array<{ x: number; y: number }> = [
      { x: level.playerStart.x, y: level.playerStart.y }
    ];
    visited[level.playerStart.y][level.playerStart.x] = true;

    while (queue.length > 0) {
      const curr = queue.shift()!;
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
        if (!nextTile.passableByPlayer && !nextTile.requiredKey && nextTile.revealsToOnTouch !== 'floor') {
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
    const oppositeMap: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };
    const opposite = oppositeMap[dir];

    if (fromTile.blockedEdges?.includes(dir)) return true;
    if (toTile.blockedEdges?.includes(opposite)) return true;
    if (fromTile.blockedEntryDirections?.includes(opposite)) return true;
    if (toTile.blockedEntryDirections?.includes(dir)) return true;
    return false;
  }
}
