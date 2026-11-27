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
import { PathEngine, Pathfinder } from '../core/Pathfinder';
import { Direction, GridPoint } from '../core/types';
import { TIMING_DEFAULTS } from './uiConstants';

/**
 * The step aside of a tapped walk. When the monster watch finds both the next step and standing still deadly, the walk may
 * take one step to a neighbouring cell of plain ground where the forecast keeps Chip alive, then plans again from there to
 * the same goal. The step is an ordinary press, like every step of the walk: recorded runs and scores are unchanged.
 */

/** A step off the plan, to a neighbouring cell. */
export interface AsideStep {
  readonly dir: Direction;
  readonly point: GridPoint;
}

/** The tile category of plain ground: no hazard, no mechanism, nothing that moves Chip or changes when he steps on it. */
const PLAIN_GROUND_CATEGORY = 'terrain';

/** Steps aside one walk may take before a deadly spot ends it as before (game.json timing). */
export function walkStepAsideLimit(): number {
  return ConfigRegistry.getGame().timing.walkStepAsideLimit ?? TIMING_DEFAULTS.walkStepAsideLimit;
}

/**
 * The neighbouring cells the walk may step aside to, closest to the goal first: plain ground with no item, a step the path
 * search itself would take now (no monster, block, beam, wall edge, key door or sign in the way), never the planned step.
 * A cell that slides, carries, teleports, traps, presses a button, opens, crumbles or is picked up is left out, so a step
 * aside never leaves Chip somewhere he cannot walk away from on his own.
 */
export function stepAsideCandidates(view: PathEngine, plannedDir: Direction, goal: GridPoint): AsideStep[] {
  const player = view.getPlayer();
  const terrain = view.getTerrain();
  const items = view.getItems();
  const found: AsideStep[] = [];
  for (const dir of ORDERED_DIRECTIONS) {
    if (dir === plannedDir) continue;
    const vec = DIRECTION_VECTORS[dir];
    const x = player.x + vec.dx;
    const y = player.y + vec.dy;
    if (y < 0 || y >= terrain.length || x < 0 || x >= (terrain[y]?.length ?? 0)) continue;
    if (items[y][x] !== null) continue;
    const tile = ConfigRegistry.getTile(terrain[y][x]);
    // The exit is plain terrain too, and Chip may not leave the level by a step the player never asked for.
    if (tile.category !== PLAIN_GROUND_CATEGORY || !tile.passableByPlayer || tile.isLevelExit === true) continue;
    if (tile.transformsToOnStep !== undefined || tile.transformsToOnLeave !== undefined || tile.revealsToOnTouch !== undefined) continue;
    if (!Pathfinder.isStepSafe(view, x, y, false)) continue;
    const path = Pathfinder.findPath(view, x, y);
    if (path.moves.length !== 1 || path.moves[0] !== dir) continue;
    found.push({ dir, point: { x, y } });
  }
  const distance = (p: GridPoint): number => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
  // A stable sort: equal distances keep the N, E, S, W order.
  return found.sort((a, b) => distance(a.point) - distance(b.point));
}

/**
 * What a walk remembers across its steps aside: the goal the player tapped, how many steps aside it took, and whether the
 * walk is waiting for one to end. Only a walk the player tapped is armed; any other walk (the block puzzle hint) never steps
 * aside. Built by the page before the config is loaded: the limit is read when it is used.
 */
export class WalkDetour {
  private goal: GridPoint | null = null;
  private used = 0;
  private resuming = false;

  /** `limit`: for a test; by default the limit of game.json timing. */
  constructor(private readonly limit?: number) {}

  /** A tapped walk to `goal` begins: it may step aside, up to the limit, and the count starts again. */
  public arm(goal: GridPoint): void {
    this.goal = goal;
    this.used = 0;
    this.resuming = false;
  }

  /** The walk is not one the player tapped (or it was dropped): it never steps aside. */
  public disarm(): void {
    this.goal = null;
    this.used = 0;
    this.resuming = false;
  }

  /** A new walk, or the walk was dropped: the same as disarm. */
  public clear(): void {
    this.disarm();
  }

  /** Steps aside taken by this walk. */
  public get taken(): number {
    return this.used;
  }

  /** Whether this walk may still step aside: an armed walk below its limit. */
  public allowed(): boolean {
    return this.goal !== null && this.used < (this.limit ?? walkStepAsideLimit());
  }

  /** A step aside was sent: once it is taken, the walk plans again to its goal. */
  public stepped(): void {
    if (this.goal === null) return;
    this.resuming = true;
    this.used++;
  }

  /** Whether the walk waits for a step aside to end before it plans again. */
  public get pending(): boolean {
    return this.resuming;
  }

  /**
   * The step aside was taken: the plan from here to the goal, or null when the level itself offers no path now. The path
   * search is asked on the level as it stands first (a monster that stays put, in a trap or on a clone machine, is a wall it
   * goes around). When that finds nothing, the monsters are taken out of the view: the one the walk stepped aside for usually
   * stands in the way, and the monster watch judges every step of the plan, so the walk waits for them to pass as it always
   * does.
   */
  public resume(view: PathEngine): { moves: Direction[]; points: GridPoint[] } | null {
    const goal = this.goal;
    const wanted = this.resuming;
    this.resuming = false;
    if (goal === null || !wanted) return null;
    const direct = Pathfinder.findPath(view, goal.x, goal.y);
    if (direct.moves.length > 0) return direct;
    const through = Pathfinder.findPath(withoutMonsters(view), goal.x, goal.y);
    return through.moves.length > 0 ? through : null;
  }
}

/** The level as the path search reads it, with no monster in it. */
function withoutMonsters(view: PathEngine): PathEngine {
  const revealed = view.getRevealedTerrain;
  return {
    getLevel: () => view.getLevel(),
    getTerrain: () => view.getTerrain(),
    getItems: () => view.getItems(),
    getEntities: () => view.getEntities().filter((entity) => entity.kind !== 'monster'),
    getPlayer: () => view.getPlayer(),
    getBeamCells: () => view.getBeamCells(),
    isCellClosedTrap: (x, y) => view.isCellClosedTrap(x, y),
    getChipsRemaining: () => view.getChipsRemaining(),
    holdsItem: (itemId) => view.holdsItem(itemId),
    getPlayerCharacter: () => view.getPlayerCharacter(),
    getRailState: () => view.getRailState(),
    ...(revealed ? { getRevealedTerrain: (x: number, y: number) => revealed.call(view, x, y) } : {}),
    canPlayerStepOn: (tile, itemId) => view.canPlayerStepOn(tile, itemId)
  };
}
