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
import { OPPOSITE_DIRECTION } from './coreConstants';
import { GameEngine } from './GameEngine';
import { Direction, GridPoint, TileDefinition } from './types';

/** Step cost of a plain cell. */
const BASE_STEP_COST = 1;
/** Extra cost of walking over a thief while carrying boots: prefer any detour. */
const THIEF_STEP_COST = 12;
/** Cost of a final step onto ice or a force floor, which moves the player on its own. */
const SLIDE_STEP_COST = 4;
/** Upper bound on expanded search states, as a guard against pathological door layouts. */
const MAX_EXPANDED_STATES = 20000;

interface AStarNode {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: AStarNode | null;
  moveDir: Direction | null;
  /** Boots were taken by a thief earlier on this path. */
  bootsStolen: boolean;
  /** Keys consumed by doors earlier on this path, per key id. */
  keysUsed: Record<string, number>;
}

/** Binary min-heap on node f. */
class NodeHeap {
  private readonly nodes: AStarNode[] = [];

  public get size(): number {
    return this.nodes.length;
  }

  public push(node: AStarNode): void {
    const nodes = this.nodes;
    nodes.push(node);
    let i = nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (nodes[parent].f <= nodes[i].f) break;
      [nodes[parent], nodes[i]] = [nodes[i], nodes[parent]];
      i = parent;
    }
  }

  public pop(): AStarNode | undefined {
    const nodes = this.nodes;
    if (nodes.length === 0) return undefined;
    const top = nodes[0];
    const last = nodes.pop()!;
    if (nodes.length > 0) {
      nodes[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < nodes.length && nodes[left].f < nodes[smallest].f) smallest = left;
        if (right < nodes.length && nodes[right].f < nodes[smallest].f) smallest = right;
        if (smallest === i) break;
        [nodes[smallest], nodes[i]] = [nodes[i], nodes[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export class Pathfinder {
  /**
   * Finds a click-to-move path. Cells that move the player on their own (ice,
   * force floors without boots, teleporters) can only be the last step of a
   * path: the route beyond them is not under the player's control. A thief
   * removes the boots for the rest of the path, and every door consumes one
   * of the keys the player actually holds.
   */
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

    const hasBoot = (node: AStarNode, bootId: string | undefined): boolean =>
      Boolean(bootId) && !node.bootsStolen && player.boots.has(bootId!);
    const movesPlayerOnItsOwn = (tile: TileDefinition, node: AStarNode): boolean =>
      Boolean(tile.isTeleporter) ||
      (tile.slideType !== undefined && !hasBoot(node, tile.protectedByItem));
    const stateKey = (node: AStarNode): string =>
      `${node.x},${node.y},${node.bootsStolen ? 1 : 0},${JSON.stringify(node.keysUsed)}`;

    const openList = new NodeHeap();
    openList.push({
      x: player.x,
      y: player.y,
      g: 0,
      f: Math.abs(targetX - player.x) + Math.abs(targetY - player.y),
      parent: null,
      moveDir: null,
      bootsStolen: false,
      keysUsed: {}
    });
    const bestG = new Map<string, number>();
    let expanded = 0;

    while (openList.size > 0 && expanded < MAX_EXPANDED_STATES) {
      const curr = openList.pop()!;
      expanded++;

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
      // Never plan through a cell that would carry the player elsewhere
      if (curr.parent && movesPlayerOnItsOwn(currTile, curr)) {
        continue;
      }

      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = curr.x + vec.dx;
        const ny = curr.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const nextTile = ConfigRegistry.getTile(terrain[ny][nx]);
        const opposite = OPPOSITE_DIRECTION[dir];
        const isTarget = nx === targetX && ny === targetY;

        if (currTile.blockedEdges?.includes(dir)) continue;
        if (nextTile.blockedEdges?.includes(opposite)) continue;
        if (currTile.blockedEntryDirections?.includes(opposite)) continue;
        if (nextTile.blockedEntryDirections?.includes(dir)) continue;

        const keyCoord = `${nx},${ny}`;
        if (monsterPositions.has(keyCoord)) continue;

        // Allow clicking onto an adjacent pushable block if it is the final target
        if (blockPositions.has(keyCoord) && !isTarget) {
          continue;
        }

        let keysUsed = curr.keysUsed;
        if (nextTile.requiredKey) {
          const keyId = nextTile.requiredKey;
          const held = (player.keys[keyId] || 0) - (curr.keysUsed[keyId] || 0);
          if (held <= 0) {
            continue;
          }
          if (nextTile.consumesKey) {
            keysUsed = { ...curr.keysUsed, [keyId]: (curr.keysUsed[keyId] || 0) + 1 };
          }
        } else if (nextTile.requiresAllChips) {
          if (engine.getChipsRemaining() > 0) {
            continue;
          }
        } else if (!nextTile.passableByPlayer) {
          // Allow bumping into a fake blue wall or recessed wall if it is the clicked target
          if (!(isTarget && Boolean(nextTile.revealsToOnTouch))) {
            continue;
          }
        }

        const itemOnNext = items[ny][nx];
        if (itemOnNext && ConfigRegistry.getTile(itemOnNext).hazard === 'bomb') continue;

        // A barrier against an item the player carries stays solid along the whole path
        if (nextTile.forbiddenItem && engine.holdsItem(nextTile.forbiddenItem)) continue;

        // A thief on this step takes the boots before the cell's own hazard applies
        const stolenHere = Boolean(nextTile.stealsBoots) && !curr.bootsStolen && player.boots.size > 0;
        const probe: AStarNode = {
          ...curr,
          x: nx,
          y: ny,
          bootsStolen: curr.bootsStolen || stolenHere
        };
        if (
          (nextTile.hazard === 'water' || nextTile.hazard === 'fire') &&
          !hasBoot(probe, nextTile.protectedByItem)
        ) {
          continue;
        }

        let stepCost = BASE_STEP_COST;
        if (stolenHere) {
          stepCost = THIEF_STEP_COST;
        } else if (nextTile.slideType !== undefined && !hasBoot(probe, nextTile.protectedByItem)) {
          stepCost = SLIDE_STEP_COST;
        }

        const tentativeG = curr.g + stepCost;
        const next: AStarNode = {
          x: nx,
          y: ny,
          g: tentativeG,
          f: tentativeG + Math.abs(targetX - nx) + Math.abs(targetY - ny),
          parent: curr,
          moveDir: dir,
          bootsStolen: probe.bootsStolen,
          keysUsed
        };
        const key = stateKey(next);
        const prevBest = bestG.get(key);
        if (prevBest === undefined || tentativeG < prevBest) {
          bestG.set(key, tentativeG);
          openList.push(next);
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

    if (player.x < 0 || player.x >= width || player.y < 0 || player.y >= height) {
      return null;
    }

    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: GridPoint[] = [{ x: player.x, y: player.y }];
    visited[player.y][player.x] = true;

    let exitCandidate: GridPoint | null = null;
    let keyOrBootCandidate: GridPoint | null = null;
    let unlockableDoorCandidate: GridPoint | null = null;
    let buttonCandidate: GridPoint | null = null;
    let chipCandidate: GridPoint | null = null;

    let hasClosedToggleWall = false;
    let hasLitFlameJet = false;
    const teleporters: GridPoint[] = [];
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const tile = ConfigRegistry.getTile(terrain[ty][tx]);
        if (tile.togglesTo && !tile.passableByPlayer) hasClosedToggleWall = true;
        if (tile.flameTogglesTo && tile.hazard) hasLitFlameJet = true;
        if (tile.isTeleporter) teleporters.push({ x: tx, y: ty });
      }
    }

    for (let head = 0; head < queue.length; head++) {
      const curr = queue[head];
      const tile = ConfigRegistry.getTile(terrain[curr.y][curr.x]);
      const itemId = items[curr.y][curr.x];
      const itemDef = itemId ? ConfigRegistry.getTile(itemId) : null;

      if (curr.x !== player.x || curr.y !== player.y) {
        if (tile.isLevelExit || (tile.requiresAllChips && engine.getChipsRemaining() === 0)) {
          if (!exitCandidate) exitCandidate = curr;
        }
        if (itemDef && (itemDef.collectible === 'key' || itemDef.collectible === 'boot')) {
          if (!keyOrBootCandidate) keyOrBootCandidate = curr;
        }
        if (tile.buttonAction === 'toggle_walls' && hasClosedToggleWall && !buttonCandidate) {
          buttonCandidate = curr;
        }
        if (tile.buttonAction === 'toggle_flames' && hasLitFlameJet && !buttonCandidate) {
          buttonCandidate = curr;
        }
        if (
          (tile.buttonAction === 'hold_trap' || tile.buttonAction === 'trigger_cloner') &&
          !buttonCandidate
        ) {
          buttonCandidate = curr;
        }
        if (itemDef?.collectible === 'chip' && !chipCandidate) {
          chipCandidate = curr;
        }
      }

      if (tile.isTeleporter) {
        for (const t of teleporters) {
          if (ConfigRegistry.getTile(terrain[t.y][t.x]).teleportGroup !== tile.teleportGroup) continue;
          if (!visited[t.y][t.x]) {
            visited[t.y][t.x] = true;
            queue.push({ x: t.x, y: t.y });
          }
        }
      }

      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = curr.x + vec.dx;
        const ny = curr.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;

        const nextTile = ConfigRegistry.getTile(terrain[ny][nx]);

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
        if (nextTile.forbiddenItem && engine.holdsItem(nextTile.forbiddenItem)) continue;
        if (
          nextTile.hazard === 'fire' &&
          (!nextTile.protectedByItem || !player.boots.has(nextTile.protectedByItem))
        ) {
          continue;
        }

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
