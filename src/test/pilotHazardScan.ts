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
import { DIRECTION_VECTORS } from '../config/constants';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import { cellEdgeMask, isEdgeBlockedAt } from '../core/EdgeRules';
import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction, RuntimeEntity, UndoSnapshot } from '../core/types';
import { WAIT_ACTION } from '../generator/PieceSolver';
import {
  DEFAULT_SEARCH_STATE_CAP,
  DROP_ACTION_PREFIX,
  SearchAction,
  searchActions,
  searchStateKey
} from './pilotSearch';

/** Ticks one action may run before the scan counts it as never settling (same bound as the solver's). */
const MAX_SCAN_SETTLE_TICKS = 400;
/** Reason key the engine gives to the death of a player crushed by a block. */
export const DEATH_BLOCK_REASON = 'hud.messages.death_block';

export interface HazardScanOptions {
  /** Offer the drop of held items as a move; true by default. */
  allowDrops?: boolean;
  /** Most states to visit; when reached the scan stops and reports `truncated`. */
  maxStates?: number;
}

/** A player death reachable by some sequence of actions. */
export interface ScanDeath {
  /** The engine's reason key, for example `hud.messages.death_water`. */
  reason: string;
  /** Cell of the player when it died. */
  x: number;
  y: number;
  /** Shortest action sequence that leads to this death. */
  path: SearchAction[];
}

/** A block that reversed its slide after hitting an obstacle on ice. */
export interface ScanBounce {
  /** Cell the block bounced from, and the direction it was sliding. */
  x: number;
  y: number;
  dir: Direction;
  /** Shortest action sequence that leads to this bounce. */
  path: SearchAction[];
}

export interface HazardScan {
  /** Distinct states visited. */
  states: number;
  /** Distinct (reason, cell) deaths, each with its shortest path. */
  deaths: ScanDeath[];
  /** Distinct block bounces (cell and direction). */
  blockBounces: number;
  /** The bounces themselves, with their paths. */
  bounces: ScanBounce[];
  /** Actions that never settled within the tick bound (a loop); they are not explored further. */
  unsettled: number;
  /** True when the state limit was hit before the search ended: the result is then incomplete. */
  truncated: boolean;
}

interface SlideProbe {
  x: number;
  y: number;
  dir: Direction;
}

/** Whether anything is still moving: the player's slide or cooldown, or a sliding block. */
function isMoving(engine: GameEngine): boolean {
  const player = engine.getPlayer();
  return player.isSliding || player.moveCooldown > 0 || engine.getEntities().some((e) => e.isSliding);
}

/** Starts one search action without ticking. A refused move simply changes nothing. */
function startAction(engine: GameEngine, action: SearchAction): void {
  if (action.startsWith(DROP_ACTION_PREFIX)) {
    engine.dropItem(action.slice(DROP_ACTION_PREFIX.length));
    return;
  }
  if (action === WAIT_ACTION) return;
  engine.attemptPlayerMove(action as Direction);
}

/** Whether a block could enter a cell, with the engine's own rules (bounds, edges, tile, refused hazards, occupant). */
function blockCanEnter(engine: GameEngine, block: RuntimeEntity, dir: Direction): boolean {
  const vec = DIRECTION_VECTORS[dir];
  const x = block.x + vec.dx;
  const y = block.y + vec.dy;
  const terrain = engine.getTerrain();
  if (y < 0 || y >= terrain.length || x < 0 || x >= terrain[0].length) return false;
  if (isEdgeBlockedAt(terrain, cellEdgeMask(engine.getLevel()), block.x, block.y, x, y, dir)) return false;
  const tile = ConfigRegistry.getTile(terrain[y][x]);
  if (!tile.passableByBlock) return false;
  if (tile.hazard && ConfigRegistry.getEntityDef(block.type)?.refusesHazards?.includes(tile.hazard)) return false;
  return !engine.getEntities().some((e) => e.x === x && e.y === y);
}

/**
 * Whether the block, about to act this tick, will bounce: it slides, its way is
 * blocked, it stands on ice and the cell behind it (after the tile's
 * deflection) is free. Decided before the tick, so a block that vanishes in
 * water, fire or a bomb on the way back is still seen.
 */
function willBounce(engine: GameEngine, block: RuntimeEntity): boolean {
  if (block.kind !== 'block' || !block.isSliding || block.cooldownTicks > 0) return false;
  const tile = ConfigRegistry.getTile(engine.getTerrain()[block.y][block.x]);
  if (tile.slideType !== 'ice') return false;
  if (blockCanEnter(engine, block, block.dir)) return false;
  const opposite = OPPOSITE_DIRECTION[block.dir];
  // A CC3D corner does not turn the bounce, so the block runs into the closed side and stops.
  return blockCanEnter(engine, block, tile.cc3dCornerBounce === true ? opposite : tile.deflectionMap?.[opposite] ?? opposite);
}

/**
 * Exhaustive breadth-first scan of every state reachable from the engine's
 * current one, with the action model and state key of `pilotSearch`, but
 * ticking by hand so it can record, on every reachable transition, any player
 * death with its reason key and any block whose slide reverses. A real player
 * could sometimes step aside from a bouncing block, so a level that must be
 * free of crushes asserts no bounce and no `death_block`, rather than relying
 * on the winning search, which treats every death as a dead end. The engine is
 * left in an unspecified state.
 */
export function scanHazards(level: CompiledLevel | GameEngine, options: HazardScanOptions = {}): HazardScan {
  const engine = level instanceof GameEngine ? level : loadEngine(level);
  const cap = options.maxStates ?? DEFAULT_SEARCH_STATE_CAP;
  const allowDrops = options.allowDrops ?? true;
  const seen = new Set<string>([searchStateKey(engine)]);
  const nodes: Array<{ state: UndoSnapshot; parent: number; action: SearchAction | null }> = [
    { state: engine.captureState(), parent: -1, action: null }
  ];
  const deaths = new Map<string, ScanDeath>();
  const bounces = new Map<string, ScanBounce>();
  let unsettled = 0;
  let truncated = false;

  const pathTo = (index: number, last: SearchAction): SearchAction[] => {
    const path: SearchAction[] = [last];
    for (let n = index; nodes[n].parent >= 0; n = nodes[n].parent) path.unshift(nodes[n].action as SearchAction);
    return path;
  };

  const recordDeath = (head: number, action: SearchAction): void => {
    const player = engine.getPlayer();
    const reason = player.deathReasonKey ?? 'unknown';
    const key = `${reason}@${player.x},${player.y}`;
    if (!deaths.has(key)) deaths.set(key, { reason, x: player.x, y: player.y, path: pathTo(head, action) });
  };

  /** The sliding blocks about to bounce this tick, and where every sliding block stands before it. */
  const probe = (): { bouncing: Map<number, SlideProbe>; sliding: Map<number, SlideProbe> } => {
    const bouncing = new Map<number, SlideProbe>();
    const sliding = new Map<number, SlideProbe>();
    for (const e of engine.getEntities()) {
      if (e.kind !== 'block' || !e.isSliding) continue;
      const at = { x: e.x, y: e.y, dir: e.dir };
      sliding.set(e.uid, at);
      if (willBounce(engine, e)) bouncing.set(e.uid, at);
    }
    return { bouncing, sliding };
  };
  /** Records the predicted bounces, plus any block that ended a tick on the cell behind its slide. */
  const recordBounces = (before: ReturnType<typeof probe>, head: number, action: SearchAction): void => {
    const note = (at: SlideProbe): void => {
      const key = `${at.x},${at.y},${at.dir}`;
      if (!bounces.has(key)) bounces.set(key, { ...at, path: pathTo(head, action) });
    };
    before.bouncing.forEach(note);
    for (const e of engine.getEntities()) {
      const prev = before.sliding.get(e.uid);
      if (!prev) continue;
      const back = DIRECTION_VECTORS[OPPOSITE_DIRECTION[prev.dir]];
      if (e.x === prev.x + back.dx && e.y === prev.y + back.dy) note(prev);
    }
  };

  for (let head = 0; head < nodes.length && !truncated; head++) {
    engine.restoreState(nodes[head].state);
    const actions = searchActions(engine, allowDrops);
    for (const action of actions) {
      engine.restoreState(nodes[head].state);
      startAction(engine, action);
      let forcedTicks = action === WAIT_ACTION ? ConfigRegistry.getGame().timing.playerMoveCooldownTicks : 0;
      const tickLimit = MAX_SCAN_SETTLE_TICKS + forcedTicks;
      let settled = false;
      let died = false;
      for (let tick = 0; tick < tickLimit; tick++) {
        if (!engine.getPlayer().alive) break;
        if (forcedTicks > 0) forcedTicks--;
        else if (engine.isLevelCompleted() || !isMoving(engine)) {
          settled = true;
          break;
        }
        const before = probe();
        engine.tick();
        recordBounces(before, head, action);
      }
      if (!engine.getPlayer().alive) {
        recordDeath(head, action);
        died = true;
      } else if (!settled && (engine.isLevelCompleted() || !isMoving(engine))) {
        settled = true;
      }
      if (died) continue;
      if (!settled) {
        unsettled++;
        continue;
      }
      if (engine.isLevelCompleted()) continue;
      const id = searchStateKey(engine);
      if (seen.has(id)) continue;
      if (seen.size >= cap) {
        truncated = true;
        break;
      }
      seen.add(id);
      nodes.push({ state: engine.captureState(), parent: head, action });
    }
  }
  return {
    states: seen.size,
    deaths: [...deaths.values()],
    blockBounces: bounces.size,
    bounces: [...bounces.values()],
    unsettled,
    truncated
  };
}

function loadEngine(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/**
 * Whether a scan proves nothing can crush the player: no reachable block
 * bounce and no `death_block`. An incomplete scan (truncated, or with an
 * action that never settled) proves nothing, so it never passes.
 */
export function hasNoCrushHazard(scan: HazardScan): boolean {
  if (scan.truncated || scan.unsettled > 0) return false;
  return scan.blockBounces === 0 && !scan.deaths.some((d) => d.reason === DEATH_BLOCK_REASON);
}
