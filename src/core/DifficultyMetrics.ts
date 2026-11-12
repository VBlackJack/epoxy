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
import { decodeActions, isDropAction, isTurnAction, PieceSolver, SolverAction, SWAP_ACTION, WAIT_ACTION } from '../generator/PieceSolver';
import { GameEngine } from './GameEngine';
import { DIRT_TILE_IDS, LevelMetrics, Mechanic } from './LevelMetrics';
import { isPlayerWalkable } from './Walkability';
import { CompiledLevel, Direction } from './types';

/** Tunables of the difficulty measures. */
export interface DifficultyConfig {
  /** A monster within this Chebyshev distance of the player counts as danger. */
  dangerDistance: number;
}

export const DEFAULT_DIFFICULTY_CONFIG: DifficultyConfig = {
  dangerDistance: 2
};

/** Kinds of irreversible event, in the order reports list them. */
export const IRREVERSIBLE_KINDS = [
  'water_filled',
  'bomb_used',
  'wall_raised',
  'door_opened',
  'dirt_cleared',
  'hazard_cleared',
  'turtle_sunk',
  'terrain_changed',
  'block_lost',
  'monster_removed',
  'boots_lost'
] as const;

export type IrreversibleKind = (typeof IRREVERSIBLE_KINDS)[number];

/** Opposite of each direction, to spot a reversal. */
const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/**
 * Metrics of one level, read from replaying its own solution. Each field is
 * a raw proxy: none of them is a verdict and they are never combined.
 */
export interface DifficultyReport {
  levelId: string;
  /** False when the solution is missing, or does not win in a fresh engine; the numbers are then partial. */
  solved: boolean;

  /** Solution actions that are moves (N/E/S/W). Proxy for length; ignores how hard each move is to find. */
  moves: number;
  /** Solution actions that are waits. Proxy for timing puzzles; zero for levels without moving monsters. */
  waits: number;
  /** Moves that shifted at least one block. Proxy for planning load; also counts blocks carried by ice or force floors. */
  pushes: number;
  /** Consecutive moves in opposite directions. Proxy for backtracking; blind to detours that are not exact reversals. */
  reversals: number;
  /** Positions sampled after each action (start included) over distinct positions. 1 means never back on a cell; slides are sampled only where they stop. */
  revisitRatio: number;
  /** Distinct cells the player stood on after an action. Proxy for ground covered. */
  distinctCells: number;
  /** Solution actions per walkable cell of the map. Proxy for how much of the map the route consumes. */
  stepsPerWalkableCell: number;

  /** Cell and entity changes the player cannot undo, by kind. Reversible (toggle walls, flame jets, laser gates), forced (socket opening) and free (a hidden wall that turns into walkable floor) changes are skipped, and so is picking up items. A block lost next to a hazard cell that changed counts once, as the hazard; removed cloned monsters count in monster_removed. */
  irreversibleByKind: Record<IrreversibleKind, number>;
  /** Total of irreversibleByKind. Proxy for commitment: each one is a place a wrong move can cost the level. */
  irreversibleEvents: number;
  /** 1-based action index of the first irreversible event, or null. */
  firstIrreversibleStep: number | null;
  /** Share of the actions after the action holding the first irreversible event; null without one. Proxy for how long the player lives with a commitment. */
  shareAfterFirstIrreversible: number | null;

  /** Actions after which a monster is within dangerDistance of the player. Sampled once per action, so a brush between two actions is missed. */
  dangerSteps: number;
  /** Smallest Chebyshev distance to a monster seen after an action; null without monsters. */
  minMonsterDistance: number | null;

  /** Level time limit in seconds; 0 when untimed. */
  timeLimitSeconds: number;
  /** Seconds the solution takes: its own pace, with no hesitation. */
  solutionSeconds: number;
  /** Limit (plus bonus time picked up) minus solution seconds; null when untimed. Proxy for slack a slower player has. */
  timeMarginSeconds: number | null;
  /** Limit (plus bonus time) over solution seconds; null when untimed. */
  timeRatio: number | null;

  /** Mechanic families present on the level (LevelMetrics classes). */
  mechanics: Mechanic[];
  mechanicCount: number;
  /** Present mechanics already introduced by earlier levels; proxy for what the player already knows. */
  knownMechanics: Mechanic[];
  /** Present mechanics no earlier level introduced; proxy for what is new to the player. */
  newMechanics: Mechanic[];

  /** Playfield cells with one walkable neighbour over playfield cells. */
  deadShare: number;
  /** Playfield cells with three or more walkable neighbours over playfield cells. */
  junctionShare: number;
  /** Playfield cells over their bounding box. */
  playfieldFill: number;
  /** Walkable cells of the whole map. */
  walkableCells: number;
  /** Playfield cells reachable from the start without crossing a solid cell. */
  playfieldCells: number;
  monsterCount: number;
}

interface Frame {
  terrain: string[][];
  blocks: Map<number, { x: number; y: number }>;
  monsterUids: Set<number>;
  items: (string | null)[][];
  boots: number;
}

/** Terrain, block positions, monsters and boots of the engine now. */
function frameOf(engine: GameEngine): Frame {
  const blocks = new Map<number, { x: number; y: number }>();
  const monsterUids = new Set<number>();
  for (const e of engine.getEntities()) {
    if (e.kind === 'block') blocks.set(e.uid, { x: e.x, y: e.y });
    else monsterUids.add(e.uid);
  }
  return {
    terrain: engine.getTerrain().map((row) => [...row]),
    blocks,
    monsterUids,
    items: engine.getItems().map((row) => [...row]),
    boots: engine.getPlayer().boots.size
  };
}

function emptyKinds(): Record<IrreversibleKind, number> {
  return Object.fromEntries(IRREVERSIBLE_KINDS.map((k) => [k, 0])) as Record<IrreversibleKind, number>;
}

/** Kind of irreversible event a terrain cell turning from `from` to `to` is, or null when reversible. */
export function terrainEventKind(from: string, to: string): IrreversibleKind | null {
  const before = ConfigRegistry.getTile(from);
  const after = ConfigRegistry.getTile(to);
  // Reversible (toggle walls, colour channel walls, hold doors, flame jets, laser gates).
  if (
    before.togglesTo ||
    after.togglesTo ||
    before.flameTogglesTo ||
    after.flameTogglesTo ||
    before.laserGateTogglesTo ||
    after.laserGateTogglesTo ||
    before.channelTogglesTo ||
    after.channelTogglesTo ||
    before.holdDoorTogglesTo ||
    after.holdDoorTogglesTo
  ) {
    return null;
  }
  // A cell that changes once left: a turtle sinks, a recessed wall closes for good.
  if (before.transformsToOnLeave) return isPlayerWalkable(after) ? 'turtle_sunk' : 'wall_raised';
  if (before.hazard === 'water') return 'water_filled';
  // A door opened with a kept key (green) costs the player nothing: the key stays in hand, so it is not a commitment.
  if (before.requiredKey) return before.consumesKey === false ? null : 'door_opened';
  if (DIRT_TILE_IDS.has(before.id)) return 'dirt_cleared';
  // Forced: a socket opens once the chips are in.
  if (before.transformsToOnUnlock) return null;
  // Free: a hidden wall found.
  if (before.revealsToOnTouch) return null;
  if (before.transformsToOnStep) return isPlayerWalkable(after) ? null : 'wall_raised';
  if (before.hazard) return 'hazard_cleared';
  return 'terrain_changed';
}

/** Bombs that left the item layer between two frames, without turning into a chip (a button swap is reversible). */
export function bombsUsed(before: (string | null)[][], after: (string | null)[][]): number {
  let used = 0;
  for (let y = 0; y < before.length; y++) {
    for (let x = 0; x < before[y].length; x++) {
      const was = before[y][x];
      const now = after[y][x];
      if (!was || was === now || ConfigRegistry.getTile(was).hazard !== 'bomb') continue;
      if (now && ConfigRegistry.getTile(now).collectible === 'chip') continue;
      used++;
    }
  }
  return used;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export class DifficultyMetrics {
  /**
   * Replays the level's solution in a fresh engine and measures it.
   * `priorMechanics` are the mechanics earlier levels introduced.
   */
  public static measure(
    level: CompiledLevel,
    priorMechanics: ReadonlySet<Mechanic> = new Set(),
    config: DifficultyConfig = DEFAULT_DIFFICULTY_CONFIG
  ): DifficultyReport {
    const structure = LevelMetrics.measure(level);
    const actions: SolverAction[] = level.solution ? decodeActions(level.solution) : [];

    const engine = new GameEngine();
    engine.loadLevel(level);
    let moves = 0;
    let waits = 0;
    let pushes = 0;
    let reversals = 0;
    let dangerSteps = 0;
    let minDistance: number | null = null;
    let firstIrreversible: number | null = null;
    const kinds = emptyKinds();
    let lastMove: Direction | null = null;
    const visited = new Map<string, number>();
    const mark = (): void => {
      const p = engine.getPlayer();
      const key = `${p.x},${p.y}`;
      visited.set(key, (visited.get(key) ?? 0) + 1);
    };
    mark();

    let played = 0;
    let finished = actions.length > 0;
    for (const action of actions) {
      const before = frameOf(engine);
      const alive = PieceSolver.play(engine, action);
      played++;
      if (action === WAIT_ACTION) {
        waits++;
      } else if (isDropAction(action) || action === SWAP_ACTION || isTurnAction(action)) {
        // Dropping an item, swapping players or turning in place counts as a move but is no step: the run of direction reversals is left as it was.
        moves++;
      } else {
        moves++;
        if (lastMove && OPPOSITE[lastMove] === action) reversals++;
        lastMove = action;
      }
      const after = frameOf(engine);

      let stepEvents = 0;
      for (let y = 0; y < after.terrain.length; y++) {
        for (let x = 0; x < after.terrain[y].length; x++) {
          if (before.terrain[y][x] === after.terrain[y][x]) continue;
          const kind = terrainEventKind(before.terrain[y][x], after.terrain[y][x]);
          if (kind) {
            kinds[kind]++;
            stepEvents++;
          }
        }
      }
      const bombs = bombsUsed(before.items, after.items);
      if (bombs > 0) {
        kinds.bomb_used += bombs;
        stepEvents += bombs;
      }
      const hazardCells: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < after.terrain.length; y++) {
        for (let x = 0; x < after.terrain[y].length; x++) {
          if (before.terrain[y][x] !== after.terrain[y][x] && ConfigRegistry.getTile(before.terrain[y][x]).hazard) {
            hazardCells.push({ x, y });
          }
        }
      }
      let pushed = false;
      for (const [uid, from] of before.blocks) {
        const to = after.blocks.get(uid);
        if (!to) {
          pushed = true;
          // A block that sank into water is already counted as the water being filled.
          if (!hazardCells.some((c) => chebyshev(c.x, c.y, from.x, from.y) <= 1)) {
            kinds.block_lost++;
            stepEvents++;
          }
        } else if (to.x !== from.x || to.y !== from.y) {
          pushed = true;
        }
      }
      for (const uid of before.monsterUids) {
        if (!after.monsterUids.has(uid)) {
          kinds.monster_removed++;
          stepEvents++;
        }
      }
      if (after.boots < before.boots) {
        kinds.boots_lost += before.boots - after.boots;
        stepEvents++;
      }
      if (pushed) pushes++;
      if (stepEvents > 0 && firstIrreversible === null) firstIrreversible = played;

      mark();
      const player = engine.getPlayer();
      let closest: number | null = null;
      for (const e of engine.getEntities()) {
        if (e.kind !== 'monster') continue;
        const d = chebyshev(e.x, e.y, player.x, player.y);
        if (closest === null || d < closest) closest = d;
      }
      if (closest !== null) {
        if (minDistance === null || closest < minDistance) minDistance = closest;
        if (closest <= config.dangerDistance) dangerSteps++;
      }
      if (!alive) {
        finished = false;
        break;
      }
    }

    const timing = ConfigRegistry.getGame().timing;
    // Ticks a toggle clock held the timer do not count against the time limit (0 without a clock).
    const solutionSeconds = (engine.getTick() - engine.getPausedTicks()) / timing.ticksPerSecond;
    const timed = level.timeLimitSeconds > 0;
    const allowance = level.timeLimitSeconds + engine.getExtraTimeSeconds();
    const mechanics = structure.mechanics;
    const irreversibleEvents = IRREVERSIBLE_KINDS.reduce((sum, k) => sum + kinds[k], 0);
    const positions = played + 1;

    return {
      levelId: level.id,
      solved: finished && engine.isLevelCompleted(),
      moves,
      waits,
      pushes,
      reversals,
      revisitRatio: positions / visited.size,
      distinctCells: visited.size,
      stepsPerWalkableCell: structure.walkableCells > 0 ? played / structure.walkableCells : 0,
      irreversibleByKind: kinds,
      irreversibleEvents,
      firstIrreversibleStep: firstIrreversible,
      shareAfterFirstIrreversible:
        firstIrreversible === null || played === 0 ? null : (played - firstIrreversible) / played,
      dangerSteps,
      minMonsterDistance: minDistance,
      timeLimitSeconds: level.timeLimitSeconds,
      solutionSeconds,
      timeMarginSeconds: timed ? allowance - solutionSeconds : null,
      timeRatio: timed && solutionSeconds > 0 ? allowance / solutionSeconds : null,
      mechanics,
      mechanicCount: mechanics.length,
      knownMechanics: mechanics.filter((m) => priorMechanics.has(m)),
      newMechanics: mechanics.filter((m) => !priorMechanics.has(m)),
      deadShare: structure.deadShare,
      junctionShare: structure.junctionShare,
      playfieldFill: structure.playfieldFill,
      walkableCells: structure.walkableCells,
      playfieldCells: structure.playfieldCells,
      monsterCount: structure.monsterCount
    };
  }
}
