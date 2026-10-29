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
import { GameEngine } from './GameEngine';
import { Direction, GridPoint } from './types';

interface AStarNode {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: AStarNode | null;
  moveDir: Direction | null;
}

export class Pathfinder {
  public static findPath(
    engine: GameEngine,
    targetX: number,
    targetY: number
  ): { moves: Direction[]; points: GridPoint[] } {
    const player = engine.getPlayer();
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const entities = engine.getEntities();
    const height = terrain.length;
    const width = terrain[0]?.length || 0;

    if (
      targetX < 0 ||
      targetX >= width ||
      targetY < 0 ||
      targetY >= height ||
      (player.x === targetX && player.y === targetY)
    ) {
      return { moves: [], points: [] };
    }

    const monsterPositions = new Set<string>();
    const blockPositions = new Set<string>();
    for (const ent of entities) {
      if (ent.kind === 'monster') {
        monsterPositions.add(`${ent.x},${ent.y}`);
      } else {
        blockPositions.add(`${ent.x},${ent.y}`);
      }
    }

    const openList: AStarNode[] = [
      {
        x: player.x,
        y: player.y,
        g: 0,
        f: Math.abs(targetX - player.x) + Math.abs(targetY - player.y),
        parent: null,
        moveDir: null
      }
    ];
    const bestG = new Map<string, number>();
    bestG.set(`${player.x},${player.y}`, 0);

    const oppositeMap: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

    while (openList.length > 0) {
      openList.sort((a, b) => a.f - b.f);
      const curr = openList.shift()!;

      if (curr.x === targetX && curr.y === targetY) {
        const moves: Direction[] = [];
        const points: GridPoint[] = [];
        let node: AStarNode | null = curr;
        while (node && node.moveDir) {
          moves.unshift(node.moveDir);
          points.unshift({ x: node.x, y: node.y });
          node = node.parent;
        }
        return { moves, points };
      }

      const currTile = ConfigRegistry.getTile(terrain[curr.y][curr.x]);

      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = curr.x + vec.dx;
        const ny = curr.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const nextTile = ConfigRegistry.getTile(terrain[ny][nx]);
        const opposite = oppositeMap[dir];

        if (currTile.blockedEdges?.includes(dir)) continue;
        if (nextTile.blockedEdges?.includes(opposite)) continue;
        if (currTile.blockedEntryDirections?.includes(opposite)) continue;
        if (nextTile.blockedEntryDirections?.includes(dir)) continue;

        const keyCoord = `${nx},${ny}`;
        if (monsterPositions.has(keyCoord)) continue;

        // Allow clicking onto an adjacent pushable block if it is the final target
        if (blockPositions.has(keyCoord) && (nx !== targetX || ny !== targetY)) {
          continue;
        }

        if (nextTile.requiredKey) {
          if ((player.keys[nextTile.requiredKey] || 0) <= 0) {
            continue;
          }
        } else if (nextTile.requiresAllChips) {
          if (engine.getChipsRemaining() > 0) {
            continue;
          }
        } else if (!nextTile.passableByPlayer) {
          // Allow bumping into a fake blue wall or recessed wall if it is the clicked target
          if (
            (nx === targetX && ny === targetY) &&
            Boolean(nextTile.revealsToOnTouch)
          ) {
            // Allowed as final target
          } else {
            continue;
          }
        }

        const itemOnNext = items[ny][nx];
        if (itemOnNext === 'bomb') continue;
        if (nextTile.hazard === 'water' && !player.boots.has('boots_water')) continue;
        if (nextTile.hazard === 'fire' && !player.boots.has('boots_fire')) continue;

        // Slightly penalize thief or ice/force tiles unless boots are owned
        let stepCost = 1;
        if (nextTile.stealsBoots && player.boots.size > 0) {
          stepCost = 12;
        } else if (nextTile.slideType === 'ice' && !player.boots.has('boots_ice')) {
          stepCost = 4;
        } else if (nextTile.slideType === 'force' && !player.boots.has('boots_force')) {
          stepCost = 3;
        }

        const tentativeG = curr.g + stepCost;
        const prevBest = bestG.get(keyCoord);
        if (prevBest === undefined || tentativeG < prevBest) {
          bestG.set(keyCoord, tentativeG);
          const h = Math.abs(targetX - nx) + Math.abs(targetY - ny);
          openList.push({
            x: nx,
            y: ny,
            g: tentativeG,
            f: tentativeG + h,
            parent: curr,
            moveDir: dir
          });
        }
      }
    }

    return { moves: [], points: [] };
  }

  /**
   * Locates the most relevant next objective (key, boot, unlockable door, button, chip, or exit)
   * currently reachable by the player.
   */
  public static findNextObjective(engine: GameEngine): GridPoint | null {
    const player = engine.getPlayer();
    const terrain = engine.getTerrain();
    const items = engine.getItems();
    const height = terrain.length;
    const width = terrain[0]?.length || 0;

    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: GridPoint[] = [{ x: player.x, y: player.y }];
    visited[player.y][player.x] = true;

    let exitCandidate: GridPoint | null = null;
    let keyOrBootCandidate: GridPoint | null = null;
    let unlockableDoorCandidate: GridPoint | null = null;
    let buttonCandidate: GridPoint | null = null;
    let chipCandidate: GridPoint | null = null;

    const hasClosedToggleWall = terrain.some((row) => row.includes('toggle_wall_closed'));

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const tileId = terrain[curr.y][curr.x];
      const tile = ConfigRegistry.getTile(tileId);
      const itemId = items[curr.y][curr.x];

      if (curr.x !== player.x || curr.y !== player.y) {
        if (tile.isLevelExit || (tile.requiresAllChips && engine.getChipsRemaining() === 0)) {
          if (!exitCandidate) exitCandidate = curr;
        }
        if (itemId && (itemId.startsWith('key_') || itemId.startsWith('boots_'))) {
          if (!keyOrBootCandidate) keyOrBootCandidate = curr;
        }
        if (tileId === 'button_green' && hasClosedToggleWall && !buttonCandidate) {
          buttonCandidate = curr;
        }
        if ((tileId === 'button_brown' || tileId === 'button_red') && !buttonCandidate) {
          buttonCandidate = curr;
        }
        if (itemId === 'chip' && !chipCandidate) {
          chipCandidate = curr;
        }
      }

      if (tile.isTeleporter) {
        for (let ty = 0; ty < height; ty++) {
          for (let tx = 0; tx < width; tx++) {
            if (terrain[ty][tx] === 'teleport' && !visited[ty][tx]) {
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
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;

        const nextId = terrain[ny][nx];
        const nextTile = ConfigRegistry.getTile(nextId);

        if (nextTile.requiredKey) {
          if ((player.keys[nextTile.requiredKey] || 0) > 0) {
            if (!unlockableDoorCandidate) {
              unlockableDoorCandidate = { x: nx, y: ny };
            }
            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny });
          }
          continue;
        }

        if (nextTile.requiresAllChips) {
          if (engine.getChipsRemaining() === 0) {
            if (!exitCandidate) exitCandidate = { x: nx, y: ny };
            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny });
          }
          continue;
        }

        if (!nextTile.passableByPlayer) continue;
        if (nextTile.hazard === 'fire' && !player.boots.has('boots_fire')) continue;

        visited[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }

    return (
      exitCandidate ||
      keyOrBootCandidate ||
      unlockableDoorCandidate ||
      buttonCandidate ||
      chipCandidate
    );
  }
}
