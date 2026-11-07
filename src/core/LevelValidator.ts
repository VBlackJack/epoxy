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
import { BlockPuzzleSolver, requestedSearchBudget, watchSearchBudget } from './BlockPuzzleSolver';
import { cc3dValidationReport } from './cc3d/cc3dValidator';
import {
  BLOCK_TARGET_TILE_ID,
  FLOOR_TILE_ID,
  HINT_TILE_ID,
  CELL_EDGE_BITS,
  OPPOSITE_DIRECTION,
  WALL_TILE_ID,
  CHANNEL_COLOR_NAME_KEY_PREFIX,
  channelOfButtonAction,
  FIRE_LAUNCHERS_ACTION,
  toggleWallOtherForm
} from './coreConstants';
import { t } from '../i18n/I18nManager';
import { DEFAULT_TELEPORT_GROUP, entityPressesPlate } from './epoxy/epoxyWorld';
import { relativeTo } from './lynx/directions';
import { hasTokenContent, isArrowBlockEntityType, isPhasingEntityType, isSteeredEntityType, isSteeringTileId } from './RulesetFeatures';
import { cellEdgeMask, isEdgeBlockedAt, isEdgeBlockedBetween } from './EdgeRules';
import { GameEngine } from './GameEngine';
import { registryTileLookup } from './epoxy/epoxySignals';
import { checkSignalWiring, signalDrivenColors } from './signalChecks';
import { compileSignalSpec } from './signalLinks';
import { hiddenUnder, underlayMap } from './Underlays';
import {
  ChannelColor,
  CompiledLevel,
  Direction,
  EntityPlacement,
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
/** Pocket pads it takes to make a link: gates reached plus pads the level places. */
const MIN_POCKET_PADS = 2;
/** Relay pads it takes to make a pair: a group with fewer leads nowhere. */
const MIN_RELAY_PADS = 2;
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
/**
 * Cell expansions the whole validation may spend ranking the doors that wait for a scarce key. Once spent, the
 * doors left are ranked by the cheap flood that ignores hazards and slides. Counted in steps, never in time, so
 * the verdict stays the same on every machine.
 */
const RANK_STEP_BUDGET = 3_000_000;
/** Most extra reach walks the door order search may run on one level, on top of the greedy walk. */
export const DOOR_ORDER_MAX_WALKS = 32;
/**
 * Work the extra walks of the door order search may spend together on one level, in cell expansions: the walk's
 * own steps plus every cell its door ranking expands (the precise flood and the plain flood alike). Walk 0 is not
 * counted. A walk that outruns what is left is discarded, ranking included. Counted in steps, never in time, so
 * the verdict is the same on every machine. The allowance is DOOR_ORDER_STEP_FLOOR plus the greedy walk's own
 * steps divided by DOOR_ORDER_STEP_SHARE, capped at DOOR_ORDER_STEP_CAP: a retry is a fraction of the validation,
 * never a multiple of it. The 'deep' mode replaces the floor with the larger of DOOR_ORDER_STEP_FLOOR and
 * DOOR_ORDER_DEEP_TOTAL_WORK minus the walk's steps, and keeps the fraction and the cap (see the deep constants). Measured on the 128 by 128 comb of the timing test (the greedy walk costs 311k steps,
 * about 0.45 s; each extra walk replays every pass from the start and costs 182k steps, about 0.3 s): the old flat
 * 400k let two full walks run and doubled the time, this allowance (about 39k there) costs under 0.1 s. The door
 * order tests need under 1k steps in all.
 */
const DOOR_ORDER_STEP_FLOOR = 20_000;
const DOOR_ORDER_STEP_SHARE = 16;
const DOOR_ORDER_STEP_CAP = 400_000;
/** Most decisions the default search changes in one walk: the greedy order is wrong in a place or two, not more. */
const DOOR_ORDER_MAX_DISCREPANCIES = 2;
/**
 * The 'deep' search, asked for by a check that runs once (the CC3D conversion), never by the editor's per-edit
 * check: three decisions changed, 64 walks, and a small level may spend about DOOR_ORDER_DEEP_TOTAL_WORK steps on
 * the retries in all (never less than the default allowance, still capped at DOOR_ORDER_STEP_CAP). Measured on the
 * converted CC3D map 15022, whose greedy order is wrong in three places: it needs 3 discrepancies, 46 walks and
 * 161k steps (walk 0 costs 4.1k). The deep allowance equals the default one only once walk 0 reaches about 180k steps. From
 * about 103k to 180k it is above the default yet below one full retry, which replays the whole walk (example: walk 0
 * at 150k gives 59,375 against 29,375 by default). Below about 103k a full retry fits.
 */
const DOOR_ORDER_DEEP_MAX_DISCREPANCIES = 3;
const DOOR_ORDER_DEEP_MAX_WALKS = 64;
const DOOR_ORDER_DEEP_TOTAL_WORK = 200_000;

/** Which search the door order uses: false never retries, true is the editor-safe default, 'deep' is wider. */
export type DoorOrderSearchMode = boolean | 'deep';

/** Steps the retries of the door order search may spend, given the steps of the greedy walk (walk 0). */
export function doorOrderAllowance(walk0Steps: number, mode: DoorOrderSearchMode = true): number {
  const fraction = Math.floor(walk0Steps / DOOR_ORDER_STEP_SHARE);
  if (mode === 'deep') {
    return Math.min(
      DOOR_ORDER_STEP_CAP,
      Math.max(DOOR_ORDER_STEP_FLOOR, DOOR_ORDER_DEEP_TOTAL_WORK - walk0Steps) + fraction
    );
  }
  return Math.min(DOOR_ORDER_STEP_CAP, DOOR_ORDER_STEP_FLOOR + fraction);
}

/** A block use the stock must cover, as tracked by the reach walk. */
type BlockUse = 'water' | 'fire' | 'melt' | 'other';

/** What one reach walk found: the chips it collected and whether it stood on an exit. */
interface ReachOutcome {
  collectedChips: number;
  reachableExit: boolean;
  /** The doors opened at fixpoints, in order. */
  decisions: DoorDecision[];
  /** Cells expanded by the walk, its door ranking included. */
  steps: number;
  /** The walk was cut off or its forced door was not waiting: its result means nothing. */
  aborted: boolean;
}

/** One choice of the reach walk: the door that was opened ("x,y") and every door that waited, best first. */
interface DoorDecision {
  chosen: string;
  ranked: string[];
}

/** The grid key of a deferred door, as the reach walk files it. */
const doorKey = (door: DeferredDoor): string => `${door.x},${door.y}`;

/** A closed scarce-key door the player has already reached, with how it was reached. */
interface DeferredDoor {
  x: number;
  y: number;
  keyId: string;
  /** Boots held by the states that reached the door, combined (the ranking leans optimistic). */
  boots: number;
}

/** What the door ranking needs to know about the reach walk at the moment it must choose. */
interface DoorRankContext {
  level: CompiledLevel;
  terrain: string[][];
  items: (string | null)[][];
  edgeMask: Uint8Array | null;
  bootBits: Map<string, number>;
  hasBoot: BootCheck;
  ownedKeys: Readonly<Record<string, number>>;
  collectedChips: number;
  chipsRequired: number;
  meltedFires: ReadonlySet<string>;
  swimProtection: string | undefined;
  /** True when the level places a toll token, so a thief is read as taking nothing. */
  hasToken: boolean;
  /** Whether the block stock would still cover one more demand of this kind; spends nothing. */
  affords: (use: BlockUse) => boolean;
  /** One flag per cell (y * width + x): cells some state of the walk has already reached. */
  reached: Uint8Array;
  /** Steps left to rank doors precisely, shared by every choice of one validation. */
  budget: { left: number };
  /** Work of the current walk, ranking included; a ranking stops once spent passes limit (the walk is then discarded). */
  work: { spent: number; limit: number };
  /** Observe-only work counters, see `ValidateWorkMeter`. */
  meter?: ValidateWorkMeter;
}

interface QueuedCell extends GridPoint {
  boots: number;
}

interface SlideResult {
  end: GridPoint;
  path: GridPoint[];
  boots: number;
  fatal: boolean;
  /** The door or socket the slide opened on its last step (the slide stops on that cell). */
  opened?: { x: number; y: number; keyId?: string };
  /** The hazard cell that made the slide fatal, when a block could deal with it (water, slime, fire, bomb). */
  lethal?: { hazard: string; x: number; y: number };
}

/**
 * What a removable top leaves in its cell once the player has removed it: the terrain hidden under it,
 * or, for a cell that hides none, the remains the tile names.
 */
function openedTerrain(level: CompiledLevel, terrain: string[][], x: number, y: number, top: TileDefinition): string {
  return hiddenUnder(level, terrain, x, y) ?? (top.transformsToOnUnlock || FLOOR_TILE_ID);
}

/**
 * Whether the reach walk may step onto a cell that just revealed a hidden terrain right away: only plain
 * ground. A hazard, a slide or a wall there is judged by the next pass, which reads the terrain as it now is.
 */
function isPlainGround(tile: TileDefinition): boolean {
  return tile.passableByPlayer === true && !tile.hazard && tile.slideType === undefined;
}

/** Tiles that stay solid for the player whatever happens: no pusher can ever stand there. */
const PERMANENT_SOLID_TILES: ReadonlySet<string> = new Set([
  'wall',
  'blue_wall_real',
  'invisible_wall',
  'appearing_wall',
  'clone_machine'
]);

/**
 * Tile ids that seal a swivel door side for good: a plain wall and an invisible wall. Laser emitters and receivers
 * also seal a side, but they are recognised by their tile properties, not by this set. Anything else a neighbour may
 * be (a door, a toggle wall, a clone machine, a shot launcher, another swivel) can change or be passed, so it never
 * counts as sealing.
 */
const SWIVEL_SEALING_TILE_IDS: ReadonlySet<string> = new Set([WALL_TILE_ID, 'invisible_wall']);

type BootCheck = (boots: number, bootId: string | undefined) => boolean;

/** Tells whether a level's stored solution wins in the real engine; supplied by callers that can replay it. */
export type SolutionWins = (level: CompiledLevel) => boolean;

/** Tile standing in for a swivel door while its own edges are ignored by the reachability checks. */
const SWIVEL_NEUTRAL_TILE = 'floor';

/** How hard the validator searches the block puzzle of a 'targets' level. */
export type BlockSearchMode = 'watch' | 'exhaustive';

/**
 * Work counters a test may hand to `validate` through `ValidateOptions.meter`. `cells` sums the cells the reach
 * walks touch (queue steps, ranking flood steps, slide path lengths, grid scans, the per-mask visited grids and the
 * per-walk grid copies), `walks` counts reach walks, `passes` counts fixpoint passes and `blockNodes` sums the block
 * layouts the `targets_unsolvable` search visited (0 when it never ran). They are observed, never read: nothing here
 * feeds a budget or a verdict.
 */
export interface ValidateWorkMeter {
  cells: number;
  walks: number;
  passes: number;
  blockNodes: number;
}

export interface ValidateOptions {
  /**
   * Budget of the block search behind `targets_unsolvable`. 'watch' (default) spends the in-game
   * dead-end watch budget, cheap enough to run after every edit. 'exhaustive' spends the hint
   * budget, for a check the designer asked for. Either way, a level the solver does not model
   * exactly, a playfield above `watchMaxCells` or an exhausted budget gives no warning.
   */
  blockSearch?: BlockSearchMode;
  /**
   * Whether a reach walk that misses chips or the exit retries other orders for the scarce-key doors
   * (default true: up to 2 decisions changed, 32 walks, a small allowance, cheap enough for every edit).
   * The retries only ever add what a legal order reaches; false keeps the greedy walk alone. 'deep' widens
   * the search (3 decisions, 64 walks, about 200k steps on a small level) for a check that runs once.
   */
  doorOrderSearch?: DoorOrderSearchMode;
  /** Filled in by validate: counts the work done, for tests. It only observes and never changes any verdict. */
  meter?: ValidateWorkMeter;
}

export class LevelValidator {
  /**
   * Checks a level. `solutionWins` is the replay of the stored solution: when it confirms the
   * solution, a reachability miss of the simulator is downgraded to a warning.
   * `options.blockSearch` picks the block search effort (see `ValidateOptions`).
   */
  public static validate(
    level: CompiledLevel,
    solutionWins?: SolutionWins,
    options: ValidateOptions = {}
  ): LevelValidationReport {
    // A CC3D level is checked by its own strict validator, not by the Epoxy tile rules.
    if (level.ruleset === 'cc3d' && level.cc3d) return cc3dValidationReport(level);
    const issues: ValidationIssue[] = [];
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;
    const edgeMask = cellEdgeMask(level);
    const underlays = underlayMap(level);

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
        // What a removable top hides counts as part of the level: the exit, a target or a laser device
        // under a door is there to be found once the door is open.
        const hiddenId = underlays?.get(y * width + x);
        if (hiddenId !== undefined) {
          const hiddenDef = ConfigRegistry.getTile(hiddenId);
          if (hiddenDef.isLevelExit) exitCount++;
          if (hiddenId === BLOCK_TARGET_TILE_ID) targetCount++;
          if (hiddenDef.laserEmitter) emitterCount++;
          if (hiddenDef.laserReceiverGroup !== undefined) {
            receiverCount++;
            receiverGroups.add(hiddenDef.laserReceiverGroup);
          }
          if (hiddenDef.laserGateGroup !== undefined) gateCount++;
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

    if (coversTargets) {
      this.checkTargets(level, targetCount, issues, options.blockSearch ?? 'watch', options.meter);
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
    this.checkSteering(level, issues);
    this.checkLurkers(level, issues);
    this.checkPhasingClones(level, issues);
    this.checkShotLaunchers(level, issues);
    this.checkButtonsWithoutEffect(level, issues);
    this.checkMechanisms(level, issues);
    checkSignalWiring(level, issues);

    // A consumed key opens one door; a kept key opens every door of its colour.
    // Fewer keys than doors only warns that the doors cannot all be opened: spare or decoy
    // doors are legitimate, and the reach walk decides whether the level can be won.
    // Known gap, accepted: on levels won by targets or receivers the walk ignores the exit, so a real
    // key shortage there gets only this warning. The severity stays fixed: making it depend on the
    // level would bring back the false errors on winnable levels with spare doors.
    for (const [keyId, doors] of Object.entries(consumingDoorCounts)) {
      const keys = keyCounts[keyId] || 0;
      if (doors > keys) {
        issues.push({
          severity: 'warning',
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
    const bootBits = this.buildBootBits();
    const maskCount = 1 << bootBits.size;
    // A level that places a toll token may pay any thief once, so the walk takes no thief as stealing (an
    // over-approximation: it never reports a false unreachable, at the price of missing a robbery the token covers).
    const tokenLevel = hasTokenContent({ terrain: level.terrain, items: level.items });
    const hasBoot: BootCheck = (boots, bootId) => {
      const bit = bootId ? bootBits.get(bootId) : undefined;
      return bit !== undefined && (boots & bit) !== 0;
    };

    const blockTypes = new Set(
      Object.values(ConfigRegistry.getMonsters().entities)
        .filter((def) => def.kind === 'block')
        .map((def) => def.id)
    );
    const swimProtection = ConfigRegistry.getTile('water').protectedByItem;

    // A dark relay pad a signal link powers may be lit at some point of play, and the walk does not follow the
    // timing of the signals: it reads such a pad as lit from the start (an over-approximation, so it never reports a false
    // unreachable). A dark pad no link ends on stays plain floor for good.
    const poweredRelayCells = new Set<number>();
    for (const link of level.signalLinks ?? []) {
      const tile = ConfigRegistry.getTile(level.terrain[link.toY]?.[link.toX] ?? FLOOR_TILE_ID);
      if (tile.relayPad === 'dark') poweredRelayCells.add(link.toY * width + link.toX);
    }
    const teleporters: GridPoint[] = [];
    // The pocket pads the level places itself: pads the player sets down join them, so they are listed apart.
    const placedPads: GridPoint[] = [];
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (ConfigRegistry.getTile(level.terrain[ty][tx]).isTeleporter || poweredRelayCells.has(ty * width + tx)) {
          teleporters.push({ x: tx, y: ty });
        }
        if (ConfigRegistry.getTile(level.terrain[ty][tx]).portableTeleporter === true) placedPads.push({ x: tx, y: ty });
        // A teleporter hidden under a removable top joins its group once the top is gone (checked at use).
        const hiddenId = underlays?.get(ty * width + tx);
        if (hiddenId !== undefined && ConfigRegistry.getTile(hiddenId).isTeleporter) teleporters.push({ x: tx, y: ty });
        if (hiddenId !== undefined && ConfigRegistry.getTile(hiddenId).portableTeleporter === true) placedPads.push({ x: tx, y: ty });
      }
    }

    const rankBudget = { left: RANK_STEP_BUDGET };
    const meter = options.meter;

    /** Walks the level once from the start: what the greedy reach finds, with the doors opened in ranked order. */
    const walkReach = (forced: readonly string[], stepLimit: number): ReachOutcome => {
      const work = { spent: 0, limit: stepLimit };
      if (meter) meter.walks++;
      const decisions: DoorDecision[] = [];
      const simTerrain = level.terrain.map((row) => [...row]);
      for (const cell of poweredRelayCells) {
        const x = cell % width;
        const y = Math.floor(cell / width);
        simTerrain[y][x] = ConfigRegistry.getTile(simTerrain[y][x]).relayTwin ?? simTerrain[y][x];
      }
      const simItems = level.items.map((row) => [...row]);
      if (meter) meter.cells += 2 * width * height;
      const ownedKeys: Record<string, number> = {};
      let collectedChips = 0;
      let reachableExit = false;

      // Reachable blocks are counted per type, globally and not by position. What a block can do to a hazard
      // depends on its type: a dirt block fills water, an ice block melts fire but vanishes in water, a mirror
      // refuses water. Hazards are demands on that stock, accepted only while a consistent assignment exists.
      const blockStock = new Map<string, number>();
      const stockBlocks = (type: string, count: number): void => {
        blockStock.set(type, (blockStock.get(type) ?? 0) + count);
      };
      const demand = { water: 0, fire: 0, melt: 0, other: 0 };
      type Demand = typeof demand;
      /**
       * Whether the stock covers a set of demands. Water needs a block that fills it; fire needs an ice block
       * (which melts) and a separate filler (for the water left); a melt needs only the ice block, because the
       * player swims the water left; slime and bombs take any block. With fillers F, ice blocks M and all blocks T:
       * water + fire <= F, fire + melt <= M and water + 2 * fire + melt + other <= T.
       */
      const covers = (next: Demand): boolean => {
        let fillers = 0;
        let melters = 0;
        let total = 0;
        for (const [type, count] of blockStock) {
          if (count <= 0) continue;
          const def = ConfigRegistry.getEntityDef(type);
          total += count;
          if (!def?.refusesHazards?.includes('water') && def?.waterTransformsTo !== 'water') fillers += count;
          if (def?.meltsInFireTo && def.destroyedByFire) melters += count;
        }
        return !(
          next.water + next.fire > fillers ||
          next.fire + next.melt > melters ||
          next.water + 2 * next.fire + next.melt + next.other > total
        );
      };
      const affords = (use: BlockUse): boolean => covers({ ...demand, [use]: demand[use] + 1 });
      /** Takes the blocks one hazard needs, if the stock still covers every demand taken so far. */
      const trySpend = (use: BlockUse): boolean => {
        if (!covers({ ...demand, [use]: demand[use] + 1 })) return false;
        demand[use]++;
        return true;
      };
      // Fires an ice block melted into water. The terrain grid is shared by every boot state and stays fire
      // there: writing water would make the cell harder for a state holding fire boots.
      const meltedFires = new Set<string>();
      /**
       * Deals with an unprotected fire reached by a state: 'pass' when it can cross the cell now (swimming the
       * melt), 'floor' when the cell just became ground (replayed on the next pass), 'blocked' otherwise.
       */
      const settleFire = (fx: number, fy: number, boots: number): 'pass' | 'floor' | 'blocked' => {
        const key = `${fx},${fy}`;
        const swims = hasBoot(boots, swimProtection);
        if (meltedFires.has(key)) {
          if (swims) return 'pass';
          // A bootless state needs the water filled: upgrade the melt to a full fire demand (filler included).
          if (!covers({ ...demand, melt: demand.melt - 1, fire: demand.fire + 1 })) return 'blocked';
          demand.melt--;
          demand.fire++;
          meltedFires.delete(key);
          simTerrain[fy][fx] = FLOOR_TILE_ID;
          changed = true;
          return 'floor';
        }
        if (swims) {
          if (!trySpend('melt')) return 'blocked';
          meltedFires.add(key);
          changed = true;
          return 'pass';
        }
        if (!trySpend('fire')) return 'blocked';
        simTerrain[fy][fx] = FLOOR_TILE_ID;
        changed = true;
        return 'floor';
      };
      const uncollectedBlocks = new Map<string, string>(
        level.entities.filter((e) => blockTypes.has(e.type)).map((e) => [`${e.x},${e.y}`, e.type])
      );
      // A button-fed cloner only supplies blocks once the player can reach its button (signal-driven ones: applySignalSinks)
      const grantedCloneLinks = new Set<number>();

      const appliedKeyThieves = new Set<string>();

      // Pocket gates the walk has picked up. A pad may be set down on any cell the walk reaches, and the pads link only
      // with each other, so once gates and placed pads can make a pair the walk over-approximates: every reached cell
      // and every placed pad link with each other (see linkPocketPads). Kept across passes: the item is gone from the grid by then.
      let gateCount = 0;
      // Hurl stones the walk has picked up. A stone sets off a bomb it is thrown at, so once one is reachable every bomb
      // is taken as passable (an over-approximation: the throw needs a clear line, and a stone is used up by one throw).
      // Kept across passes: the item is gone from the grid by then.
      let stoneCount = 0;

      // Signal sinks fire without the player reaching a button: applied once, before the fixpoint.
      this.applySignalSinks(level, blockTypes, stockBlocks, simItems, simTerrain);

      let changed = true;
      let passes = 0;

      while (changed && passes < MAX_FIXPOINT_PASSES) {
        changed = false;
        passes++;
        if (stoneCount > 0) {
          for (const row of simItems) {
            for (let cx = 0; cx < row.length; cx++) {
              const cell = row[cx];
              if (cell && ConfigRegistry.getTile(cell).hazard === 'bomb') {
                row[cx] = null;
                changed = true;
              }
            }
          }
        }
        if (meter) {
          meter.passes++;
          // The visited grid of every mask, then the closedDoors scan of the whole grid.
          meter.cells += maskCount * width * height + width * height;
        }

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
          const blockHere = uncollectedBlocks.get(bKey);
          if (blockHere !== undefined) {
            uncollectedBlocks.delete(bKey);
            stockBlocks(blockHere, 1);
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
          } else if (itemDef.collectible === 'gate') {
            gateCount++;
            simItems[cy][cx] = null;
            changed = true;
          } else if (itemDef.collectible === 'stone') {
            stoneCount++;
            simItems[cy][cx] = null;
            changed = true;
          } else if (itemDef.collectible === 'boot') {
            return boots | (bootBits.get(item) ?? NO_BOOTS);
          }
          return boots;
        };

        const deferredDoors = new Map<string, DeferredDoor>();
        const deferDoor = (x: number, y: number, keyId: string, boots: number): void => {
          const known = deferredDoors.get(`${x},${y}`);
          if (known) known.boots |= boots;
          else deferredDoors.set(`${x},${y}`, { x, y, keyId, boots });
        };
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

        /**
         * Links the pocket pads once the gates reached and the placed pads can make a pair: every reached cell may hold
         * a pad, so each such cell and each placed pad is reached with every boots state seen on any of them. Done
         * whenever the queue runs dry, so the order the cells were reached in does not matter. True when it queued states.
         */
        const linkPocketPads = (): boolean => {
          if (gateCount === 0 || gateCount + placedPads.length < MIN_POCKET_PADS) return false;
          const known = queue.length;
          const masks = new Set<number>();
          const locations = new Map<number, GridPoint>();
          for (let i = 0; i < known; i++) {
            masks.add(queue[i].boots);
            locations.set(queue[i].y * width + queue[i].x, queue[i]);
          }
          for (const pad of placedPads) locations.set(pad.y * width + pad.x, pad);
          for (const location of locations.values()) {
            for (const mask of masks) enqueue(location.x, location.y, mask);
          }
          return queue.length > known;
        };

        for (let head = 0; head < queue.length || linkPocketPads(); head++) {
          // A walk that outruns its step limit is cut off and discarded by the caller.
          if (++work.spent > work.limit) return { collectedChips, reachableExit, decisions, steps: work.spent, aborted: true };
          if (meter) meter.cells++;
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
          if (currTile.stealsKeys && !tokenLevel && !appliedKeyThieves.has(`${curr.x},${curr.y}`)) {
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
                stockBlocks(link.templateType, CLONER_BLOCK_ALLOWANCE);
                changed = true;
              }
            });
          }

          if (currTile.isTeleporter) {
            for (const t of teleporters) {
              const exitTile = ConfigRegistry.getTile(simTerrain[t.y][t.x]);
              if (!exitTile.isTeleporter || exitTile.teleportGroup !== currTile.teleportGroup) continue;
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

            if (this.isEdgeBlocked(simTerrain, edgeMask, curr.x, curr.y, nx, ny, dir)) {
              continue;
            }

            let nextTile = ConfigRegistry.getTile(simTerrain[ny][nx]);

            if (nextTile.revealsToOnTouch && nextTile.revealsToOnTouch !== simTerrain[ny][nx]) {
              simTerrain[ny][nx] = nextTile.revealsToOnTouch;
              nextTile = ConfigRegistry.getTile(simTerrain[ny][nx]);
              changed = true;
            }

            // A top that goes away under the step shows what it hides before the step is judged.
            if (nextTile.transformsToOnStep) {
              const hidden = hiddenUnder(level, simTerrain, nx, ny);
              if (hidden !== undefined) {
                simTerrain[ny][nx] = hidden;
                nextTile = ConfigRegistry.getTile(hidden);
                changed = true;
              }
            }

            if (nextTile.requiredKey) {
              const keyId = nextTile.requiredKey;
              if ((ownedKeys[keyId] || 0) > 0) {
                if (nextTile.consumesKey && (ownedKeys[keyId] || 0) < (closedDoors[keyId] || 0)) {
                  // Keys are scarce: a spent key cannot be taken back, so the door waits until nothing
                  // else progresses, then the most rewarding one opens (see below).
                  deferDoor(nx, ny, keyId, curr.boots);
                } else {
                  if (nextTile.consumesKey) ownedKeys[keyId]--;
                  closedDoors[keyId] = Math.max((closedDoors[keyId] || 0) - 1, 0);
                  const hidden = hiddenUnder(level, simTerrain, nx, ny);
                  simTerrain[ny][nx] = openedTerrain(level, simTerrain, nx, ny, nextTile);
                  changed = true;
                  if (hidden === undefined || isPlainGround(ConfigRegistry.getTile(hidden))) enqueue(nx, ny, curr.boots);
                }
              }
              continue;
            }

            if (nextTile.requiresAllChips) {
              if (collectedChips >= level.chipsRequired) {
                const hidden = hiddenUnder(level, simTerrain, nx, ny);
                simTerrain[ny][nx] = openedTerrain(level, simTerrain, nx, ny, nextTile);
                changed = true;
                if (hidden === undefined || isPlainGround(ConfigRegistry.getTile(hidden))) enqueue(nx, ny, curr.boots);
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

            const nextBoots = this.bootsOnArrival(curr.boots, nextTile, simItems[ny][nx], bootBits, tokenLevel);
            // A fire an ice block melted is water in the engine: only flippers protect there, not fire boots.
            const meltedHere = nextTile.hazard === 'fire' && meltedFires.has(`${nx},${ny}`);
            const protectedHere = hasBoot(nextBoots, meltedHere ? swimProtection : nextTile.protectedByItem);

            // A block pushed in turns water or slime into ground the player can cross.
            // Known limits of this optimistic count: blocks are tallied per type and not by position, and the
            // demands are not ordered. Water needs a filler (dirt; an ice block vanishes there and leaves the
            // water, a mirror refuses it), slime swallows any block, and fire costs an ice block plus a filler,
            // after which the cell is plain ground. A state holding flippers only pays the ice block (melt then
            // swim); the cell is remembered as melted. Any other state that later needs it, fire boots included
            // (the cell is water by then), upgrades that melt to a full fire demand.
            // The melt is committed greedily as soon as a flippers-only state reaches a fire, so where fire boots and
            // flippers cannot be held together, a fire-boots crossing that skips the melt can be missed: the verdict is
            // then pessimistic (unreachable). A dirt block on fire neither burns nor puts it out. A slide that ends in
            // water, slime, fire or a bomb is replayed on the next pass once the blocks are spent.
            if ((nextTile.hazard === 'water' || nextTile.hazard === 'slime') && !protectedHere) {
              if (trySpend(nextTile.hazard === 'water' ? 'water' : 'other')) {
                simTerrain[ny][nx] = FLOOR_TILE_ID;
                changed = true;
              } else {
                continue;
              }
            }

            // An ice block melts the fire. A state with flippers swims the water left; any other state needs a
            // second block to fill it, and the cell then becomes ground.
            if (nextTile.hazard === 'fire' && !protectedHere) {
              if (settleFire(nx, ny, nextBoots) !== 'pass') continue;
            }

            const nextItem = simItems[ny][nx];
            if (nextItem && ConfigRegistry.getTile(nextItem).hazard === 'bomb') {
              if (trySpend('other')) {
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
                bootBits,
                edgeMask,
                ownedKeys,
                collectedChips,
                level.chipsRequired,
                meltedFires,
                swimProtection,
                tokenLevel
              );
              if (meter) meter.cells += slide.path.length;
              if (slide.fatal) {
                // A slide that ends in a hazard a block can deal with is replayed on the next pass.
                const lethal = slide.lethal;
                if (lethal) {
                  if (lethal.hazard === 'fire') {
                    settleFire(lethal.x, lethal.y, slide.boots);
                  } else if (trySpend(lethal.hazard === 'water' ? 'water' : 'other')) {
                    if (lethal.hazard === 'bomb') simItems[lethal.y][lethal.x] = null;
                    else simTerrain[lethal.y][lethal.x] = FLOOR_TILE_ID;
                    changed = true;
                  }
                }
                continue;
              }
              for (const passed of slide.path) {
                collectAt(passed.x, passed.y, slide.boots);
              }
              if (slide.opened) {
                // Mirrors the engine: the slide opens the door or socket it reaches and stops there.
                const { x: ox, y: oy, keyId } = slide.opened;
                const openedTile = ConfigRegistry.getTile(simTerrain[oy][ox]);
                // Reachability is not purely growing across passes: once a key is held, a slide that used to
                // bounce off its door now ends on it.
                if (
                  keyId !== undefined &&
                  openedTile.consumesKey &&
                  (ownedKeys[keyId] || 0) < (closedDoors[keyId] || 0)
                ) {
                  // Same rule as walking onto a scarce-key door: the door waits until nothing else progresses.
                  deferDoor(ox, oy, keyId, slide.boots);
                  continue;
                }
                if (keyId !== undefined) {
                  if (openedTile.consumesKey) {
                    ownedKeys[keyId] = Math.max((ownedKeys[keyId] || 0) - 1, 0);
                    closedDoors[keyId] = Math.max((closedDoors[keyId] || 0) - 1, 0);
                  }
                }
                const hidden = hiddenUnder(level, simTerrain, ox, oy);
                simTerrain[oy][ox] = openedTerrain(level, simTerrain, ox, oy, openedTile);
                changed = true;
                // As for a door opened on foot: the engine lets the player enter whatever the opening reveals
                // (ice carries on, water kills), so only plain ground is entered here; the next pass judges the rest.
                if (hidden !== undefined && !isPlainGround(ConfigRegistry.getTile(hidden))) continue;
              }
              enqueue(slide.end.x, slide.end.y, slide.boots);
              continue;
            }

            enqueue(nx, ny, nextBoots);
          }
        }

        if (!changed && deferredDoors.size > 0) {
          if (meter) meter.cells += maskCount * width * height;
          const reached = new Uint8Array(width * height);
          for (let mask = 0; mask < maskCount; mask++) {
            for (let cell = 0; cell < width * height; cell++) {
              if (visited[mask * width * height + cell]) reached[cell] = 1;
            }
          }
          // The first decisions of a re-walk are forced and skip the ranking; the rest is ranked as ever.
          const forcedKey = decisions.length < forced.length ? forced[decisions.length] : undefined;
          let best: DeferredDoor;
          let ranked: string[];
          if (forcedKey !== undefined) {
            const forcedDoor = deferredDoors.get(forcedKey);
            // A forced door that is not waiting means this order leads somewhere else: nothing to report.
            if (!forcedDoor) return { collectedChips, reachableExit, decisions, steps: work.spent, aborted: true };
            best = forcedDoor;
            ranked = [forcedKey];
          } else {
            const order = this.rankDoors([...deferredDoors.values()], {
              level,
              terrain: simTerrain,
              items: simItems,
              edgeMask,
              bootBits,
              hasBoot,
              ownedKeys,
              collectedChips,
              chipsRequired: level.chipsRequired,
              meltedFires,
              swimProtection,
              hasToken: tokenLevel,
              affords,
              reached,
              budget: rankBudget,
              work,
              meter
            });
            // A ranking cut short by the limit is not a ranking: the walk is discarded.
            if (work.spent > work.limit) return { collectedChips, reachableExit, decisions, steps: work.spent, aborted: true };
            best = order[0];
            ranked = order.map(doorKey);
          }
          decisions.push({ chosen: doorKey(best), ranked });
          const doorTile = ConfigRegistry.getTile(simTerrain[best.y][best.x]);
          ownedKeys[best.keyId]--;
          simTerrain[best.y][best.x] = openedTerrain(level, simTerrain, best.x, best.y, doorTile);
          changed = true;
        }
      }
      return { collectedChips, reachableExit, decisions, steps: work.spent, aborted: false };
    };

    const misses = (walk: ReachOutcome): number =>
      (walk.collectedChips < level.chipsRequired ? 1 : 0) +
      (needsExit && exitCount > 0 && !walk.reachableExit ? 1 : 0);
    // Walk 0 is the greedy walk: when it finds everything, nothing else is tried and the verdict is unchanged.
    let reported = walkReach([], Number.POSITIVE_INFINITY);
    const wrongAndSearchable =
      misses(reported) > 0 && options.doorOrderSearch !== false && reported.decisions.some((d) => d.ranked.length > 1);
    if (wrongAndSearchable) {
      reported = this.searchDoorOrders(reported, walkReach, misses, options.doorOrderSearch ?? true);
    }
    const { collectedChips, reachableExit } = reported;

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
   * filled cells) is not modelled here. Without ice it is just the entered cell.
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
    const edgeMask = cellEdgeMask(level);
    const canEnter = (fx: number, fy: number, d: Direction): GridPoint | null => {
      const v = DIRECTION_VECTORS[d];
      const tx = fx + v.dx;
      const ty = fy + v.dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
      const dest = ConfigRegistry.getTile(level.terrain[ty][tx]);
      if (dest.passableByBlock !== true) return null;
      if (dest.hazard && refused.includes(dest.hazard)) return null;
      if (this.isEdgeBlocked(level.terrain, edgeMask, fx, fy, tx, ty, d)) return null;
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
    const edgeMask = cellEdgeMask(level);
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
          if (this.isEdgeBlocked(level.terrain, edgeMask, x, y, nx, ny, dir)) continue;
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
    // Emitter beams only: a turret beam lights no receiver, so a gate on its path feeds nothing.
    for (const { x, y } of engine.getEmitterBeamCells()) {
      const group = ConfigRegistry.getTile(terrain[y][x]).laserGateGroup;
      if (group !== undefined) flagged.add(group);
    }
    return [...flagged].sort();
  }

  /**
   * Rules of a level won by covering block targets: at least one target, at
   * least as many blocks as targets, and, when the exact block search can
   * prove it on a fully modelled level, a way to cover them all. An inconclusive search is silent.
   */
  private static checkTargets(
    level: CompiledLevel,
    targetCount: number,
    issues: ValidationIssue[],
    blockSearch: BlockSearchMode,
    meter?: ValidateWorkMeter
  ): void {
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
    // Only a proof from the exact model counts: verdict() skips what it does not model and big maps.
    const budget = blockSearch === 'exhaustive' ? requestedSearchBudget() : watchSearchBudget();
    const work = meter ? { nodes: 0 } : undefined;
    const verdict = BlockPuzzleSolver.verdict(engine, budget, work);
    if (meter && work) meter.blockNodes += work.nodes;
    if (verdict.kind === 'unsolvable') {
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
    bootBits: Map<string, number>,
    edgeMask: Uint8Array | null,
    heldKeys: Readonly<Record<string, number>>,
    heldChips: number,
    chipsRequired: number,
    meltedFires: ReadonlySet<string>,
    swimProtection: string | undefined,
    hasToken: boolean
  ): SlideResult {
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const maxSteps = width * height;

    let x = startX;
    let y = startY;
    let dir = entryDir;
    let boots = startBoots;
    const path: GridPoint[] = [{ x, y }];
    const fatal = (hazard?: string, hx?: number, hy?: number): SlideResult => ({
      end: { x, y },
      path,
      boots,
      fatal: true,
      lethal: hazard !== undefined && hx !== undefined && hy !== undefined ? { hazard, x: hx, y: hy } : undefined
    });

    // Keys and chips lying on the cells the slide passes count at once, as in the engine.
    const keys: Record<string, number> = { ...heldKeys };
    let chips = heldChips;
    const pickUp = (cx: number, cy: number): void => {
      const item = items[cy][cx];
      if (!item) return;
      const collectible = ConfigRegistry.getTile(item).collectible;
      if (collectible === 'key') keys[item] = (keys[item] || 0) + 1;
      else if (collectible === 'chip') chips++;
    };
    pickUp(x, y);
    let opening: { x: number; y: number; keyId?: string } | undefined;

    const canEnter = (d: Direction): GridPoint | null => {
      const vec = DIRECTION_VECTORS[d];
      const nx = x + vec.dx;
      const ny = y + vec.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return null;
      if (this.isEdgeBlocked(terrain, edgeMask, x, y, nx, ny, d)) return null;
      const target = ConfigRegistry.getTile(terrain[ny][nx]);
      let opens: { x: number; y: number; keyId?: string } | undefined;
      if (target.requiredKey) {
        if ((keys[target.requiredKey] || 0) <= 0) return null;
        opens = { x: nx, y: ny, keyId: target.requiredKey };
      }
      if (target.requiresAllChips) {
        if (chips < chipsRequired) return null;
        opens = opens ?? { x: nx, y: ny };
      }
      if (opens) {
        opening = opens;
      } else if (!target.passableByPlayer) {
        return null;
      }
      return { x: nx, y: ny };
    };

    for (let step = 0; step < maxSteps; step++) {
      const tile = ConfigRegistry.getTile(terrain[y][x]);
      if (!tile.slideType || hasBoot(boots, tile.protectedByItem)) {
        return { end: { x, y }, path, boots, fatal: false };
      }

      if (tile.slideType === 'force') {
        // A turning force floor pushes by the shared turn, which no static walk can know: the slide ends here without
        // a verdict, so the walk tries every exit from this cell (an over-approximation, never a false unreachable).
        if (tile.forceCycle === true) return { end: { x, y }, path, boots, fatal: false };
        if (tile.forceDirection === 'RANDOM') return fatal();
        dir = tile.forceDirection || dir;
      } else {
        dir = tile.deflectionMap?.[dir] || dir;
      }

      opening = undefined;
      let next = canEnter(dir);
      if (!next && tile.slideType === 'ice') {
        // Bounce back on ice
        const bounceDir = OPPOSITE_DIRECTION[dir];
        dir = tile.deflectionMap?.[bounceDir] || bounceDir;
        opening = undefined;
        next = canEnter(dir);
      }
      if (!next) {
        // Blocked both ways: the player stops here and walks off on foot
        return { end: { x, y }, path, boots, fatal: false };
      }

      x = next.x;
      y = next.y;
      path.push({ x, y });

      if (opening) {
        // The door or socket opens under the player; the cell it leaves behind is ground, so the slide ends here.
        return { end: { x, y }, path, boots, fatal: false, opened: opening };
      }
      pickUp(x, y);

      const entered = ConfigRegistry.getTile(terrain[y][x]);
      const item = items[y][x];
      if (item && ConfigRegistry.getTile(item).hazard === 'bomb') return fatal('bomb', x, y);
      boots = this.bootsOnArrival(boots, entered, item, bootBits, hasToken);
      // A fire an ice block melted is water now: a swimmer survives it (the slide stops there), fire boots do not.
      const protection =
        entered.hazard === 'fire' && meltedFires.has(`${x},${y}`) ? swimProtection : entered.protectedByItem;
      if (
        (entered.hazard === 'water' || entered.hazard === 'fire' || entered.hazard === 'slime') &&
        !hasBoot(boots, protection)
      ) {
        return fatal(entered.hazard, x, y);
      }
    }

    return fatal();
  }

  /** One bit per boot type of the tile config, in a stable order. */
  private static buildBootBits(): Map<string, number> {
    const bits = new Map<string, number>();
    const tiles = Object.values(ConfigRegistry.getTiles().tiles);
    // Only boots that some tile names as protection change what the player survives; the others (slow-time) would only grow the state space.
    const protectingBootIds = new Set(tiles.map((t) => t.protectedByItem).filter((id): id is string => id !== undefined));
    const bootIds = tiles
      .filter((t) => t.collectible === 'boot' && protectingBootIds.has(t.id))
      .map((t) => t.id)
      .sort()
      .slice(0, MAX_TRACKED_BOOT_TYPES);
    bootIds.forEach((id, idx) => bits.set(id, 1 << idx));
    return bits;
  }

  /**
   * Warnings about the steering pads: a puppet control with no puppet on the map or cloned to steer, and
   * a puppet with no control to move it (it can never step). A hidden pad counts like one in plain sight.
   */
  private static checkSteering(level: CompiledLevel, issues: ValidationIssue[]): void {
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    const padCells: GridPoint[] = [];
    level.terrain.forEach((row, y) =>
      row.forEach((id, x) => {
        // One entry per cell, even when both the top tile and its hidden underlay are pads.
        const hiddenId = underlays?.get(y * width + x);
        if (isSteeringTileId(id) || (hiddenId !== undefined && isSteeringTileId(hiddenId))) padCells.push({ x, y });
      })
    );
    const puppetEntities = level.entities.filter((e) => isSteeredEntityType(e.type));
    // A puppet a clone machine makes is located at its machine.
    const puppetLinks = (level.cloneLinks ?? []).filter((link) => isSteeredEntityType(link.templateType));
    const puppets = puppetEntities.length > 0 || puppetLinks.length > 0;
    if (padCells.length > 0 && !puppets) {
      issues.push({
        severity: 'warning',
        i18nKey: 'validator.issues.steering_pad_no_puppet.label',
        params: this.locationParams(padCells)
      });
    }
    if (padCells.length === 0 && puppets) {
      const puppetCells = [
        ...puppetEntities.map((e) => ({ x: e.x, y: e.y })),
        ...puppetLinks.map((link) => ({ x: link.clonerX, y: link.clonerY }))
      ].filter((cell) => this.inGrid(level, cell));
      // With no puppet inside the grid there is no location to show: use the label variant without one.
      issues.push({
        severity: 'warning',
        i18nKey:
          puppetCells.length > 0
            ? 'validator.issues.puppet_no_steering_pad.label'
            : 'validator.issues.puppet_no_steering_pad_nowhere.label',
        params: this.locationParams(puppetCells)
      });
    }
  }

  /**
   * A sleeping lurker is drawn as plain floor with a faint tell; on any other tile (dirt, ice, a button, a floor
   * with something hidden under it) it cannot pass for floor, so each one off plain floor is reported.
   */
  private static checkLurkers(level: CompiledLevel, issues: ValidationIssue[]): void {
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    const offFloor = level.entities.filter((entity) => {
      if (ConfigRegistry.getEntityDef(entity.type)?.wakesTo === undefined) return false;
      if (!this.inGrid(level, entity)) return false;
      return level.terrain[entity.y][entity.x] !== FLOOR_TILE_ID || underlays?.has(entity.y * width + entity.x) === true;
    });
    if (offFloor.length === 0) return;
    issues.push({
      severity: 'warning',
      i18nKey: 'validator.issues.lurker_not_on_floor.label',
      params: this.locationParams(offFloor.map((entity) => ({ x: entity.x, y: entity.y })))
    });
  }

  /**
   * A wisp is never a clone template: a clone machine holding one, or a clone link naming one, is an error. The
   * engine spawns nothing from such a link, so the level would play differently from how it reads.
   */
  private static checkPhasingClones(level: CompiledLevel, issues: ValidationIssue[]): void {
    const cells: GridPoint[] = [];
    for (const entity of level.entities) {
      if (!isPhasingEntityType(entity.type) || !this.inGrid(level, entity)) continue;
      if (ConfigRegistry.getTile(level.terrain[entity.y][entity.x]).isCloneMachine) cells.push({ x: entity.x, y: entity.y });
    }
    for (const link of level.cloneLinks ?? []) {
      if (isPhasingEntityType(link.templateType)) cells.push({ x: link.clonerX, y: link.clonerY });
    }
    if (cells.length === 0) return;
    issues.push({
      severity: 'error',
      i18nKey: 'validator.issues.wisp_cloned.label',
      params: this.locationParams(cells)
    });
  }

  /**
   * Warnings about the shot devices: a trigger with no link fires nothing, a launcher no trigger is linked
   * to never fires, and a launcher facing a wall or the edge of the map fires into it at once.
   */
  private static checkShotLaunchers(level: CompiledLevel, issues: ValidationIssue[]): void {
    const links = level.launcherLinks ?? [];
    const mask = cellEdgeMask(level);
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    level.terrain.forEach((row, y) =>
      row.forEach((topId, x) => {
        // A device hidden under a removable top is judged like one in plain sight: it works once the top is gone.
        const hiddenId = underlays?.get(y * width + x);
        for (const id of hiddenId === undefined ? [topId] : [topId, hiddenId]) {
          const tile = ConfigRegistry.getTile(id);
          if (tile.buttonAction === FIRE_LAUNCHERS_ACTION && !links.some((l) => l.buttonX === x && l.buttonY === y)) {
            issues.push({ severity: 'warning', i18nKey: 'validator.issues.shot_trigger_no_link.label', params: { x, y } });
          }
          if (!tile.shotLauncher) continue;
          const signalDriven = (level.signalLinks ?? []).some((l) => l.toX === x && l.toY === y);
          if (!signalDriven && !links.some((l) => l.launcherX === x && l.launcherY === y)) {
            issues.push({ severity: 'warning', i18nKey: 'validator.issues.shot_launcher_unlinked.label', params: { x, y } });
          }
          const dir = tile.shotLauncher.dir;
          const nx = x + DIRECTION_VECTORS[dir].dx;
          const ny = y + DIRECTION_VECTORS[dir].dy;
          // Raw edge check on purpose: a swivel launcher or target cell keeps its start orientation here.
          const ahead = level.terrain[ny]?.[nx];
          if (ahead === undefined || !ConfigRegistry.getTile(ahead).laserTransparent || isEdgeBlockedAt(level.terrain, mask, x, y, nx, ny, dir, true)) {
            issues.push({ severity: 'warning', i18nKey: 'validator.issues.shot_launcher_faces_wall.label', params: { x, y } });
          }
        }
      })
    );
  }

  /**
   * Info about brown and red buttons that cannot do anything on an Epoxy level: a brown button with no trap tile
   * anywhere, and a red button with no link of its own while no clone machine holds an entity template (the engine
   * fallback then has nothing to clone). Hidden underlays count like tiles in plain sight.
   */
  private static checkButtonsWithoutEffect(level: CompiledLevel, issues: ValidationIssue[]): void {
    if (level.ruleset === 'lynx' || level.ruleset === 'cc3d') return;
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    const tilesAt = (x: number, y: number): TileDefinition[] => {
      const hiddenId = underlays?.get(y * width + x);
      const ids = hiddenId === undefined ? [level.terrain[y][x]] : [level.terrain[y][x], hiddenId];
      return ids.map((id) => ConfigRegistry.getTile(id));
    };
    const links = level.cloneLinks ?? [];
    let trapExists = false;
    const brownButtons: GridPoint[] = [];
    const redButtons: GridPoint[] = [];
    const machineCells: GridPoint[] = [];
    level.terrain.forEach((row, y) =>
      row.forEach((_id, x) => {
        for (const tile of tilesAt(x, y)) {
          if (tile.isTrap) trapExists = true;
          if (tile.buttonAction === 'hold_trap') brownButtons.push({ x, y });
          if (tile.buttonAction === 'trigger_cloner') redButtons.push({ x, y });
          if (tile.isCloneMachine) machineCells.push({ x, y });
        }
      })
    );
    if (brownButtons.length > 0 && !trapExists) {
      issues.push({
        severity: 'info',
        i18nKey: 'validator.issues.trap_button_no_trap.label',
        params: this.locationParams(brownButtons)
      });
    }
    const templateOnMachine = machineCells.some((cell) =>
      (level.entities ?? []).some((e) => e.x === cell.x && e.y === cell.y)
    );
    if (templateOnMachine) return;
    for (const button of redButtons) {
      if (links.some((l) => l.buttonX === button.x && l.buttonY === button.y)) continue;
      issues.push({ severity: 'info', i18nKey: 'validator.issues.clone_button_nothing.label', params: { x: button.x, y: button.y } });
    }
  }

  /** Whether a cell lies inside the terrain grid, as an integer position. */
  private static inGrid(level: CompiledLevel, cell: GridPoint): boolean {
    return (
      Number.isInteger(cell.x) &&
      Number.isInteger(cell.y) &&
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.y < level.terrain.length &&
      cell.x < (level.terrain[cell.y]?.length ?? 0)
    );
  }

  /**
   * The location params of an issue about several cells: the first one in row-major order and how many there are.
   * The cells must lie inside the grid. An empty list gives no params (the callers never pass one).
   */
  private static locationParams(cells: readonly GridPoint[], extra: Record<string, string | number> = {}): Record<string, string | number> {
    if (cells.length === 0) return extra;
    const first = cells.reduce((best, cell) => (cell.y < best.y || (cell.y === best.y && cell.x < best.x) ? cell : best));
    return { ...extra, x: first.x, y: first.y, count: cells.length };
  }

  /**
   * Hints and warnings about mechanisms that do nothing on an Epoxy level: a trap with no brown button, a lone
   * teleporter, a laser gate whose group has no receiver (it stays closed), flame jets with no orange button and a
   * swivel door sealed on every side it opens on, and turn plates with no arrow block to turn. Hidden underlays count like tiles in plain sight.
   */
  private static checkMechanisms(level: CompiledLevel, issues: ValidationIssue[]): void {
    if (level.ruleset === 'lynx' || level.ruleset === 'cc3d') return;
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    const trapCells: GridPoint[] = [];
    const jetCells: GridPoint[] = [];
    const swivelCells: GridPoint[] = [];
    const plateCells: GridPoint[] = [];
    const railSwitchCells: GridPoint[] = [];
    let greenButtons = 0;
    const gateCellsByGroup = new Map<string, GridPoint[]>();
    const teleportCellsByGroup = new Map<string, GridPoint[]>();
    const portableGroups = new Set<string>();
    const gateCells: GridPoint[] = [];
    level.items.forEach((row, y) =>
      row.forEach((id, x) => {
        if (id !== null && ConfigRegistry.getTile(id).collectible === 'gate') gateCells.push({ x, y });
      })
    );
    const hasGate = gateCells.length > 0;
    const receiverGroups = new Set<string>();
    let brownButtons = 0;
    let orangeButtons = 0;
    // The relay pads, lit or dark, and the dark ones no signal link ends on (they stay floor for good).
    const relayCells: GridPoint[] = [];
    const darkRelayCells: GridPoint[] = [];
    level.terrain.forEach((row, y) =>
      row.forEach((topId, x) => {
        const hiddenId = underlays?.get(y * width + x);
        const ids = hiddenId === undefined ? [topId] : [topId, hiddenId];
        for (const id of ids) {
          const tile = ConfigRegistry.getTile(id);
          if (tile.isTrap) trapCells.push({ x, y });
          if (tile.buttonAction === 'hold_trap') brownButtons++;
          if (tile.buttonAction === 'toggle_flames') orangeButtons++;
          if (tile.flameTogglesTo !== undefined) jetCells.push({ x, y });
          if (tile.facingTurn !== undefined) plateCells.push({ x, y });
          if (tile.railSides !== undefined && tile.togglesTo !== undefined) railSwitchCells.push({ x, y });
          if (tile.buttonAction === 'toggle_walls') greenButtons++;
          if (tile.relayPad !== undefined) {
            relayCells.push({ x, y });
            if (tile.relayPad === 'dark' && !(level.signalLinks ?? []).some((l) => l.toX === x && l.toY === y)) darkRelayCells.push({ x, y });
          } else if (tile.isTeleporter) {
            const group = tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP;
            teleportCellsByGroup.set(group, [...(teleportCellsByGroup.get(group) ?? []), { x, y }]);
            if (tile.portableTeleporter === true) portableGroups.add(group);
          }
          if (tile.laserGateGroup !== undefined) {
            gateCellsByGroup.set(tile.laserGateGroup, [...(gateCellsByGroup.get(tile.laserGateGroup) ?? []), { x, y }]);
          }
          if (tile.laserReceiverGroup !== undefined) receiverGroups.add(tile.laserReceiverGroup);
        }
        if (ConfigRegistry.getTile(topId).swivelTurns !== undefined && hiddenId === undefined) swivelCells.push({ x, y });
      })
    );

    if (trapCells.length > 0 && brownButtons === 0) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.trap_no_button.label', params: this.locationParams(trapCells) });
    }
    // Pocket pads link only with each other: gates and placed pads that cannot make a pair lead nowhere.
    const placedPadCount = teleportCellsByGroup.size === 0 ? 0 : [...portableGroups].reduce((n, g) => n + (teleportCellsByGroup.get(g)?.length ?? 0), 0);
    if (hasGate && gateCells.length + placedPadCount < MIN_POCKET_PADS) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.gate_no_pair.label', params: this.locationParams(gateCells) });
    }
    for (const [group, cells] of teleportCellsByGroup) {
      if (cells.length !== 1) continue;
      // A single placed pad is the other end of a pad the player sets down, when the level gives a gate.
      if (portableGroups.has(group) && hasGate) continue;
      issues.push(
        group === DEFAULT_TELEPORT_GROUP || portableGroups.has(group)
          ? { severity: 'warning', i18nKey: 'validator.issues.teleport_alone_plain.label', params: this.locationParams(cells) }
          : {
              severity: 'warning',
              i18nKey: 'validator.issues.teleport_alone.label',
              params: this.locationParams(cells, { color: this.colorName(group as ChannelColor) })
            }
      );
    }
    // Relay pads link only with each other, and a dark pad no signal link powers never works.
    if (darkRelayCells.length > 0) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.relay_pad_dark_unlinked.label', params: this.locationParams(darkRelayCells) });
    }
    if (relayCells.length > 0 && relayCells.length < MIN_RELAY_PADS) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.relay_group_alone.label', params: this.locationParams(relayCells) });
    }
    for (const [group, cells] of gateCellsByGroup) {
      if (receiverGroups.has(group)) continue;
      issues.push({
        severity: 'warning',
        i18nKey: 'validator.issues.laser_gate_no_receiver.label',
        params: this.locationParams(cells, { group })
      });
    }
    if (jetCells.length > 0 && orangeButtons === 0) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.flame_jets_no_button.label', params: this.locationParams(jetCells) });
    }
    // A switch a signal wire ends on has its controller: only the others wait for a green button.
    const unwiredSwitches = railSwitchCells.filter((cell) => !(level.signalLinks ?? []).some((l) => l.toX === cell.x && l.toY === cell.y));
    if (unwiredSwitches.length > 0 && greenButtons === 0) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.rail_switch_no_button.label', params: this.locationParams(unwiredSwitches) });
    }
    const sealed = swivelCells.filter((cell) => this.isSwivelSealed(level, cell, underlays));
    if (sealed.length > 0) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.swivel_sealed.label', params: this.locationParams(sealed) });
    }
    // A turn plate only turns an arrow block: placed on the map or made by a cloner.
    const hasArrowBlock =
      (level.entities ?? []).some((entity) => isArrowBlockEntityType(entity.type)) ||
      (level.cloneLinks ?? []).some((link) => isArrowBlockEntityType(link.templateType));
    if (plateCells.length > 0 && !hasArrowBlock) {
      issues.push({ severity: 'info', i18nKey: 'validator.issues.turn_plate_idle.label', params: this.locationParams(plateCells) });
    }
    const lockedArrowBlocks = (level.entities ?? [])
      .filter((entity) => this.isArrowBlockLocked(level, entity, underlays))
      .map((entity) => ({ x: entity.x, y: entity.y }))
      .filter((cell) => this.inGrid(level, cell));
    if (lockedArrowBlocks.length > 0) {
      issues.push({
        severity: 'info',
        i18nKey: 'validator.issues.arrow_block_locked.label',
        params: this.locationParams(lockedArrowBlocks)
      });
    }
  }

  /**
   * Whether an arrow block can never be pushed: each side it shows an arrow on (read from its starting direction)
   * faces the map edge, a thin wall (a cell edge or a thin wall tile) or a plain or invisible wall. A neighbour
   * that hides an underlay, or any other tile, is judged open, so the check never flags a block that may move.
   */
  private static isArrowBlockLocked(level: CompiledLevel, entity: EntityPlacement, underlays: ReadonlyMap<number, string> | null): boolean {
    const arrows = ConfigRegistry.getEntityDef(entity.type)?.pushArrows;
    if (arrows === undefined || arrows.length === 0) return false;
    const width = level.terrain[0]?.length ?? 0;
    const mask = cellEdgeMask(level);
    const own = level.terrain[entity.y]?.[entity.x];
    if (own === undefined) return false;
    const ownTile = ConfigRegistry.getTile(own);
    // A swivel door turns, so its static closed sides prove nothing.
    const ownBlockedEdges = ownTile.swivelTurns !== undefined ? [] : (ownTile.blockedEdges ?? []);
    // A rail straight or bend closes its other sides for good; a switch flips, so it proves nothing.
    const ownRailClosed = (side: Direction): boolean =>
      ownTile.railSides !== undefined && ownTile.togglesTo === undefined && !ownTile.railSides.includes(side);
    return arrows.every((turn) => {
      const dir = relativeTo(entity.dir, turn);
      const nx = entity.x + DIRECTION_VECTORS[dir].dx;
      const ny = entity.y + DIRECTION_VECTORS[dir].dy;
      const neighbourId = level.terrain[ny]?.[nx];
      if (neighbourId === undefined) return true;
      if (ownBlockedEdges.includes(dir) || ownRailClosed(dir)) return true;
      const opposite = OPPOSITE_DIRECTION[dir];
      if (mask !== null) {
        if ((mask[entity.y * width + entity.x] & CELL_EDGE_BITS[dir]) !== 0) return true;
        if ((mask[ny * width + nx] & CELL_EDGE_BITS[opposite]) !== 0) return true;
      }
      if (underlays?.has(ny * width + nx)) return false;
      const neighbour = ConfigRegistry.getTile(neighbourId);
      if (neighbour.swivelTurns !== undefined) return false;
      if (neighbour.blockedEdges?.includes(opposite)) return true;
      if (neighbour.railSides !== undefined && neighbour.togglesTo === undefined && !neighbour.railSides.includes(opposite)) return true;
      return SWIVEL_SEALING_TILE_IDS.has(neighbourId);
    });
  }

  /**
   * Whether every side a swivel door opens on faces something that always blocks: the map edge, a thin wall (a
   * cell edge or a thin wall tile) or a plain wall, invisible wall, laser emitter or laser receiver. A neighbour
   * that hides an underlay, or any other tile, is judged open. One-way swivel traps stay unflagged.
   */
  private static isSwivelSealed(level: CompiledLevel, cell: GridPoint, underlays: ReadonlyMap<number, string> | null): boolean {
    const width = level.terrain[0]?.length ?? 0;
    const mask = cellEdgeMask(level);
    const swivel = ConfigRegistry.getTile(level.terrain[cell.y][cell.x]);
    const closedSides = swivel.blockedEdges ?? [];
    const openSides = ORDERED_DIRECTIONS.filter((dir) => !closedSides.includes(dir));
    if (openSides.length === 0) return false;
    return openSides.every((dir) => {
      const nx = cell.x + DIRECTION_VECTORS[dir].dx;
      const ny = cell.y + DIRECTION_VECTORS[dir].dy;
      const neighbourId = level.terrain[ny]?.[nx];
      if (neighbourId === undefined) return true;
      const opposite = OPPOSITE_DIRECTION[dir];
      if (mask !== null) {
        if ((mask[cell.y * width + cell.x] & CELL_EDGE_BITS[dir]) !== 0) return true;
        if ((mask[ny * width + nx] & CELL_EDGE_BITS[opposite]) !== 0) return true;
      }
      if (underlays?.has(ny * width + nx)) return false;
      const neighbour = ConfigRegistry.getTile(neighbourId);
      if (neighbour.swivelTurns !== undefined) return false;
      if (neighbour.blockedEdges?.includes(opposite)) return true;
      return (
        SWIVEL_SEALING_TILE_IDS.has(neighbourId) ||
        neighbour.laserEmitter !== undefined ||
        neighbour.laserReceiverGroup !== undefined
      );
    });
  }

  /** The localized name of a channel colour, as the colour warnings show it. */
  private static colorName(color: ChannelColor): string {
    return t(`${CHANNEL_COLOR_NAME_KEY_PREFIX}${color}`);
  }

  /**
   * Warnings about the colour channels: a hold door whose colour has no plate (it can never open), colour
   * walls with no button of their channel, a colour button with no wall to move, and a hold door placed
   * in the state its plates will not leave it in at the start (the engine corrects it when the level loads).
   */
  private static checkColorChannels(level: CompiledLevel, issues: ValidationIssue[]): void {
    const platesByColor = new Map<ChannelColor, GridPoint[]>();
    const doorsByColor = new Map<ChannelColor, Array<GridPoint & { open: boolean }>>();
    const wallsByChannel = new Map<ChannelColor, GridPoint[]>();
    const buttonsByChannel = new Map<ChannelColor, number>();
    const push = <T>(map: Map<ChannelColor, T[]>, color: ChannelColor, value: T): void => {
      map.set(color, [...(map.get(color) ?? []), value]);
    };
    // Doors hidden under a removable top: their state is not judged against the plates, only their colour counts.
    const hiddenDoorCells = new Map<ChannelColor, GridPoint[]>();
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    level.terrain.forEach((row, y) =>
      row.forEach((id, x) => {
        const tile = ConfigRegistry.getTile(id);
        if (tile.plateColor !== undefined) push(platesByColor, tile.plateColor, { x, y });
        if (tile.holdDoorColor !== undefined) {
          push(doorsByColor, tile.holdDoorColor, { x, y, open: tile.holdDoorOpen === true });
        }
        if (tile.toggleChannel !== undefined) {
          push(wallsByChannel, tile.toggleChannel, { x, y });
        }
        const channel = channelOfButtonAction(tile.buttonAction);
        if (channel) buttonsByChannel.set(channel, (buttonsByChannel.get(channel) ?? 0) + 1);
        const hiddenId = underlays?.get(y * width + x);
        if (hiddenId === undefined) return;
        const hidden = ConfigRegistry.getTile(hiddenId);
        if (hidden.plateColor !== undefined) push(platesByColor, hidden.plateColor, { x, y });
        if (hidden.holdDoorColor !== undefined) push(hiddenDoorCells, hidden.holdDoorColor, { x, y });
        if (hidden.toggleChannel !== undefined) {
          push(wallsByChannel, hidden.toggleChannel, { x, y });
        }
        const hiddenChannel = channelOfButtonAction(hidden.buttonAction);
        if (hiddenChannel) buttonsByChannel.set(hiddenChannel, (buttonsByChannel.get(hiddenChannel) ?? 0) + 1);
      })
    );

    const pressedAtStart = (plate: GridPoint, color: ChannelColor): boolean =>
      (level.playerStart.x === plate.x && level.playerStart.y === plate.y) ||
      level.entities.some((e) => {
        if (e.x !== plate.x || e.y !== plate.y) return false;
        const kind = ConfigRegistry.getEntityDef(e.type)?.kind;
        return kind !== undefined && entityPressesPlate(e.type, kind, color);
      });

    // A colour whose doors a signal drives opens from the signals, not from plates.
    const signalColors = signalDrivenColors(level);
    for (const [color, cells] of hiddenDoorCells) {
      if (signalColors.has(color)) continue;
      if (!doorsByColor.has(color) && (platesByColor.get(color) ?? []).length === 0) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.hold_door_no_plate.label',
          params: this.locationParams(cells, { color: this.colorName(color) })
        });
      }
    }
    for (const [color, doors] of doorsByColor) {
      if (signalColors.has(color)) continue;
      const plates = platesByColor.get(color) ?? [];
      if (plates.length === 0) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.hold_door_no_plate.label',
          params: this.locationParams([...doors, ...(hiddenDoorCells.get(color) ?? [])], { color: this.colorName(color) })
        });
        continue;
      }
      const shouldBeOpen = plates.every((plate) => pressedAtStart(plate, color));
      if (doors.some((door) => door.open !== shouldBeOpen)) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.hold_door_wrong_start.label', params: { color: this.colorName(color) } });
      }
    }
    for (const [channel, cells] of wallsByChannel) {
      if (!buttonsByChannel.has(channel) && cells.length > 0) {
        issues.push({
          severity: 'warning',
          i18nKey: 'validator.issues.channel_walls_no_button.label',
          params: this.locationParams(cells, { color: this.colorName(channel) })
        });
      }
    }
    for (const channel of buttonsByChannel.keys()) {
      if (!wallsByChannel.has(channel)) {
        issues.push({ severity: 'warning', i18nKey: 'validator.issues.channel_button_no_walls.label', params: { color: this.colorName(channel) } });
      }
    }
  }

  /**
   * Applies the signal sinks that act on what the walk counts, as if the network had fired them. Same soundness
   * stance as the signal-driven hold doors: the sink is assumed to fire, whether or not the network ever does.
   * A clone machine holding a block grants the cloner allowance of that block type. A shot launcher removes every
   * bomb on the ray from its cell in its facing direction to the map edge, ignoring obstacles (an
   * over-approximation). A launcher is a terrain tile of its own, so no swivel can turn it: one direction.
   * A flip sink on a closed wall opens it (the green button's predicate: a tile the player cannot enter that has an
   * other form), so a wired wall with no green button is not reported unreachable. A rail switch is passable on both
   * forms and needs nothing.
   */
  private static applySignalSinks(
    level: CompiledLevel,
    blockTypes: ReadonlySet<string>,
    stockBlocks: (type: string, count: number) => void,
    simItems: (string | null)[][],
    simTerrain: string[][]
  ): void {
    const spec = level.ruleset !== 'lynx' && level.ruleset !== 'cc3d' ? compileSignalSpec(level, registryTileLookup) : undefined;
    if (spec === undefined) return;
    const width = level.terrain[0]?.length ?? 0;
    if (width === 0) return;
    const underlays = underlayMap(level);
    for (const node of spec.nodes) {
      if (node.kind !== 'sink' || node.fires === undefined) continue;
      const x = node.cell % width;
      const y = Math.floor(node.cell / width);
      if (node.fires === 'flip') {
        const tile = ConfigRegistry.getTile(simTerrain[y][x]);
        if (!tile.passableByPlayer && tile.togglesTo !== undefined) simTerrain[y][x] = tile.togglesTo;
        continue;
      }
      if (node.fires === 'cloner') {
        const held = level.entities.find((e) => e.x === x && e.y === y && blockTypes.has(e.type));
        if (held) stockBlocks(held.type, CLONER_BLOCK_ALLOWANCE);
        continue;
      }
      const hiddenId = underlays?.get(node.cell);
      const launcher =
        ConfigRegistry.getTile(level.terrain[y][x]).shotLauncher ??
        (hiddenId === undefined ? undefined : ConfigRegistry.getTile(hiddenId).shotLauncher);
      if (!launcher) continue;
      const vec = DIRECTION_VECTORS[launcher.dir];
      for (let cx = x + vec.dx, cy = y + vec.dy; simItems[cy]?.[cx] !== undefined; cx += vec.dx, cy += vec.dy) {
        const item = simItems[cy][cx];
        if (item && ConfigRegistry.getTile(item).hazard === 'bomb') simItems[cy][cx] = null;
      }
    }
  }

  /**
   * Colours whose hold doors the player can pass, as far as the level can tell: the colour has at least one
   * plate and at least as many things that can lie on a plate for good (blocks, monsters that press plates,
   * a cloned block) as it has plates. Walking monsters count as pressers (they press a plate when they stand on
   * it; only flying ones do not), which makes the "door not openable" warning deliberately more optimistic. The player cannot hold a plate and walk through the door too, except
   * when a plate of the colour touches a door of the colour: the player opens the door from the plate, steps
   * in, and the door shuts on the occupant, who may leave. Then the player counts as one presser.
   * A colour whose doors a signal sink drives is treated as openable. This is an optimistic heuristic: the
   * signal network may never open that door. The block solver bails on signal levels, so nothing checks it further.
   * Signal sinks that fire a clone machine or a shot launcher get the same stance in the reach walk (applySignalSinks).
   */
  private static openableHoldDoorColors(level: CompiledLevel): Set<ChannelColor> {
    const platesByColor = new Map<ChannelColor, number>();
    const doorColors = new Set<ChannelColor>();
    const adjacentColors = new Set<ChannelColor>();
    const underlays = underlayMap(level);
    const width = level.terrain[0]?.length ?? 0;
    level.terrain.forEach((row, y) => {
      row.forEach((id, x) => {
        // A plate or a door hidden under a removable top counts like one in plain sight.
        const hiddenId = underlays?.get(y * width + x);
        const hidden = hiddenId === undefined ? undefined : ConfigRegistry.getTile(hiddenId);
        for (const tile of hidden ? [ConfigRegistry.getTile(id), hidden] : [ConfigRegistry.getTile(id)]) {
          if (tile.plateColor !== undefined) platesByColor.set(tile.plateColor, (platesByColor.get(tile.plateColor) ?? 0) + 1);
          if (tile.holdDoorColor === undefined) continue;
          doorColors.add(tile.holdDoorColor);
          for (const dir of ORDERED_DIRECTIONS) {
            const vec = DIRECTION_VECTORS[dir];
            const neighbour = level.terrain[y + vec.dy]?.[x + vec.dx];
            if (neighbour !== undefined && ConfigRegistry.getTile(neighbour).plateColor === tile.holdDoorColor) {
              adjacentColors.add(tile.holdDoorColor);
            }
          }
        }
      });
    });
    const openable = new Set<ChannelColor>();
    // A colour whose doors a signal drives counts as openable: the signals open them, not plates.
    for (const color of signalDrivenColors(level)) if (doorColors.has(color)) openable.add(color);
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
      const playerPresses = adjacentColors.has(color) ? 1 : 0;
      if (pressers + playerPresses >= plates) openable.add(color);
    }
    return openable;
  }

  /** Replaces every tile for which `target` names a terrain, reporting each change. */
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

  /**
   * Boots held after entering a cell: its boot item is picked up first, then a thief takes everything. A level that
   * places a toll token is read as never robbing the player of boots (an over-approximation).
   */
  private static bootsOnArrival(
    boots: number,
    tile: TileDefinition,
    itemId: string | null,
    bootBits: Map<string, number>,
    hasToken: boolean
  ): number {
    if (tile.stealsBoots && !hasToken) return NO_BOOTS;
    return itemId ? boots | (bootBits.get(itemId) ?? NO_BOOTS) : boots;
  }

  /**
   * Retries the reach walk with other orders for the scarce-key doors when the greedy walk (walk 0) missed
   * chips or the exit. Limited discrepancy search: first every walk that differs from walk 0 in one decision
   * (the last decision first, its alternatives in ranked order), then, while budget remains, every walk that
   * differs from one of those in one decision more. A choice only changes which held-key door opens at a
   * fixpoint, a legal move under the same rules, so a walk that finds more proves more. Stops at the first walk
   * that misses nothing. Reports one walk whole: fewest misses, then most chips, and walk 0 on a tie.
   * Bounded by the walk cap of the mode and the step allowance (walk steps and ranking work together); a walk cut off by the budget is discarded.
   */
  private static searchDoorOrders(
    walk0: ReachOutcome,
    walkReach: (forced: readonly string[], stepLimit: number) => ReachOutcome,
    misses: (walk: ReachOutcome) => number,
    mode: DoorOrderSearchMode
  ): ReachOutcome {
    let best = walk0;
    const deep = mode === 'deep';
    let walksLeft = deep ? DOOR_ORDER_DEEP_MAX_WALKS : DOOR_ORDER_MAX_WALKS;
    const maxDiscrepancies = deep ? DOOR_ORDER_DEEP_MAX_DISCREPANCIES : DOOR_ORDER_MAX_DISCREPANCIES;
    let stepsLeft = doorOrderAllowance(walk0.steps, mode);
    // Walks to branch from, with how many of their decisions are already fixed (forced or branched).
    let frontier: { walk: ReachOutcome; fixed: number }[] = [{ walk: walk0, fixed: 0 }];
    for (let discrepancies = 1; discrepancies <= maxDiscrepancies; discrepancies++) {
      const next: { walk: ReachOutcome; fixed: number }[] = [];
      for (const { walk: parent, fixed } of frontier) {
        for (let at = parent.decisions.length - 1; at >= fixed; at--) {
          const prefix = parent.decisions.slice(0, at).map((d) => d.chosen);
          for (const alternative of parent.decisions[at].ranked.slice(1)) {
            if (walksLeft <= 0 || stepsLeft <= 0) return best;
            walksLeft--;
            const walk = walkReach([...prefix, alternative], stepsLeft);
            stepsLeft -= walk.steps;
            if (walk.aborted) continue;
            const walkMisses = misses(walk);
            if (walkMisses === 0) return walk;
            const bestMisses = misses(best);
            if (walkMisses < bestMisses || (walkMisses === bestMisses && walk.collectedChips > best.collectedChips)) {
              best = walk;
            }
            next.push({ walk, fixed: at + 1 });
          }
        }
      }
      frontier = next;
    }
    return best;
  }

  /**
   * Chooses which door a spent key opens first: the one whose room holds the
   * most keys, then chips, then the most cells not reached yet. Greedy reachability
   * cannot undo a key spent on the wrong door, so the order matters on key-order traps.
   *
   * The ranking flood starts at the door once open and counts only what lies beyond the cells the walk
   * already reached, so a door joining two known rooms gains nothing. It crosses a hazard only where the
   * boots the door was reached with protect, or where the block stock would still pay for it, and it
   * follows ice and force floors to where they really end, dropping a slide that drowns. A door that
   * reveals a deadly floor scores nothing. Ties keep the first door, in the order they were met.
   * Once the shared step budget is spent, the remaining doors are ranked by the plain flood.
   * Returns every door, best first; the search for another order tries the others after the first.
   */
  private static rankDoors(doors: DeferredDoor[], ctx: DoorRankContext): DeferredDoor[] {
    const closedByKey: Record<string, number> = {};
    if (ctx.meter) ctx.meter.cells += ctx.terrain.length * (ctx.terrain[0]?.length || 0);
    for (const row of ctx.terrain) {
      for (const id of row) {
        const required = ConfigRegistry.getTile(id).requiredKey;
        if (required) closedByKey[required] = (closedByKey[required] || 0) + 1;
      }
    }
    // One scoring mode for the whole call: the budget is read once, so doors are never compared across modes.
    const precise = ctx.budget.left > 0;
    const scored = doors.map((door) => ({
      door,
      score: (precise
        ? this.rankDoor(door, ctx, closedByKey)
        : [this.plainFloodScore(door, ctx.terrain, ctx.items, ctx.edgeMask, closedByKey, ctx.work, ctx.meter), 0]) as [number, number]
    }));
    // The sort is stable: doors that tie stay in the order they were met, so the first is today's pick.
    scored.sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1]);
    return scored.map((entry) => entry.door);
  }

  /** Scores one deferred door as [keys and chips weighed, cells not reached yet]; see rankDoors. */
  private static rankDoor(
    door: DeferredDoor,
    ctx: DoorRankContext,
    closedByKey: Readonly<Record<string, number>>
  ): [number, number] {
    const { terrain, hasBoot, bootBits } = ctx;
    const doorTile = ConfigRegistry.getTile(terrain[door.y][door.x]);
    const opened = openedTerrain(ctx.level, terrain, door.x, door.y, doorTile);
    const revealed = ConfigRegistry.getTile(opened);
    // What the door shows is entered at once: a wall shuts the way. Unprotected ice or a hazard is scored
    // pessimistically (nothing), without simulating the slide or the hazard.
    if (!revealed.passableByPlayer) return [0, 0];
    if (revealed.slideType && !hasBoot(door.boots, revealed.protectedByItem)) return [0, 0];
    if (revealed.hazard && !hasBoot(door.boots, revealed.protectedByItem)) return [0, 0];

    const heldKeys: Record<string, number> = { ...ctx.ownedKeys };
    heldKeys[door.keyId] = Math.max((heldKeys[door.keyId] || 0) - 1, 0);

    const closedId = terrain[door.y][door.x];
    terrain[door.y][door.x] = opened;
    try {
      let mask = door.boots;
      let result = { keys: 0, chips: 0, fresh: 0, mask };
      // A boot found beyond the door can open more of the flood: run it again with the grown mask (bounded).
      for (let round = 0; round <= bootBits.size; round++) {
        result = this.floodBeyondDoor(door, mask, heldKeys, ctx, closedByKey);
        if (result.mask === mask) break;
        mask = result.mask;
      }
      return [result.keys * DOOR_KEY_WEIGHT + result.chips, result.fresh];
    } finally {
      terrain[door.y][door.x] = closedId;
    }
  }

  /** One ranking flood from an open door cell with a fixed boot mask; the door cell must already be open. */
  private static floodBeyondDoor(
    door: DeferredDoor,
    startMask: number,
    heldKeys: Readonly<Record<string, number>>,
    ctx: DoorRankContext,
    closedByKey: Readonly<Record<string, number>>
  ): { keys: number; chips: number; fresh: number; mask: number } {
    const { terrain, items, hasBoot, bootBits } = ctx;
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const scored = new Uint8Array(width * height);
    const expanded = new Uint8Array(width * height);
    if (ctx.meter) ctx.meter.cells += 2 * width * height;
    let mask = startMask;
    let keys = 0;
    let chips = 0;
    let fresh = 0;
    const score = (cx: number, cy: number): void => {
      const index = cy * width + cx;
      if (scored[index] || ctx.reached[index]) return;
      scored[index] = 1;
      fresh++;
      const item = items[cy][cx];
      if (!item) return;
      const collectible = ConfigRegistry.getTile(item).collectible;
      // A key only counts while a door of its colour would still be closed once this one is open.
      if (collectible === 'key' && (closedByKey[item] || 0) - (item === door.keyId ? 1 : 0) > 0) keys++;
      else if (collectible === 'chip') chips++;
      else if (collectible === 'boot') mask |= bootBits.get(item) ?? NO_BOOTS;
    };
    const doorIndex = door.y * width + door.x;
    scored[doorIndex] = 1;
    expanded[doorIndex] = 1;
    const stack: GridPoint[] = [{ x: door.x, y: door.y }];
    while (stack.length > 0) {
      if (++ctx.work.spent > ctx.work.limit) break;
      if (ctx.meter) ctx.meter.cells++;
      const cell = stack.pop() as GridPoint;
      ctx.budget.left--;
      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = cell.x + vec.dx;
        const ny = cell.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const index = ny * width + nx;
        if (expanded[index] || ctx.reached[index]) continue;
        if (this.isEdgeBlocked(terrain, ctx.edgeMask, cell.x, cell.y, nx, ny, dir)) continue;
        const tile = ConfigRegistry.getTile(terrain[ny][nx]);
        if (!tile.passableByPlayer) continue;
        if (tile.hazard) {
          const meltedHere = tile.hazard === 'fire' && ctx.meltedFires.has(`${nx},${ny}`);
          if (!hasBoot(mask, meltedHere ? ctx.swimProtection : tile.protectedByItem)) {
            const swimming = hasBoot(mask, ctx.swimProtection);
            const use: BlockUse =
              tile.hazard === 'water' ? 'water' : tile.hazard === 'fire' ? (swimming ? 'melt' : 'fire') : 'other';
            if (!ctx.affords(use)) continue;
          }
        }
        const item = items[ny][nx];
        if (item && ConfigRegistry.getTile(item).hazard === 'bomb' && !ctx.affords('other')) continue;

        if (tile.slideType && !hasBoot(mask, tile.protectedByItem)) {
          const slide = this.simulateSlide(
            terrain,
            items,
            nx,
            ny,
            dir,
            mask,
            hasBoot,
            bootBits,
            ctx.edgeMask,
            heldKeys,
            ctx.collectedChips,
            ctx.chipsRequired,
            ctx.meltedFires,
            ctx.swimProtection,
            ctx.hasToken
          );
          if (ctx.meter) ctx.meter.cells += slide.path.length;
          if (slide.fatal || slide.opened) continue;
          mask |= slide.boots;
          for (const passed of slide.path) score(passed.x, passed.y);
          const endIndex = slide.end.y * width + slide.end.x;
          if (!expanded[endIndex] && !ctx.reached[endIndex]) {
            expanded[endIndex] = 1;
            stack.push(slide.end);
          }
          continue;
        }

        expanded[index] = 1;
        score(nx, ny);
        stack.push({ x: nx, y: ny });
      }
    }
    return { keys, chips, fresh, mask };
  }

  /**
   * The cheap ranking of a door, used once the step budget is spent: a flood over every walkable cell,
   * hazards and slides ignored, weighing the keys and chips lying in it.
   */
  private static plainFloodScore(
    door: { x: number; y: number; keyId: string },
    terrain: string[][],
    items: (string | null)[][],
    edgeMask: Uint8Array | null,
    closedByKey: Readonly<Record<string, number>>,
    work: { spent: number; limit: number },
    meter?: ValidateWorkMeter
  ): number {
    const height = terrain.length;
    const width = terrain[0]?.length || 0;
    const seen = new Set<string>([`${door.x},${door.y}`]);
    const stack: GridPoint[] = [{ x: door.x, y: door.y }];
    let keyCount = 0;
    let chipCount = 0;
    while (stack.length > 0) {
      if (++work.spent > work.limit) break;
      if (meter) meter.cells++;
      const cell = stack.pop() as GridPoint;
      const item = items[cell.y][cell.x];
      const collectible = item ? ConfigRegistry.getTile(item).collectible : undefined;
      if (item && collectible === 'key' && (closedByKey[item] || 0) - (item === door.keyId ? 1 : 0) > 0) {
        keyCount++;
      }
      if (collectible === 'chip') chipCount++;
      for (const dir of ORDERED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = cell.x + vec.dx;
        const ny = cell.y + vec.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen.has(`${nx},${ny}`)) continue;
        if (this.isEdgeBlocked(terrain, edgeMask, cell.x, cell.y, nx, ny, dir)) continue;
        if (!ConfigRegistry.getTile(terrain[ny][nx]).passableByPlayer) continue;
        seen.add(`${nx},${ny}`);
        stack.push({ x: nx, y: ny });
      }
    }
    return keyCount * DOOR_KEY_WEIGHT + chipCount;
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

  /**
   * Whether the exit can be reached without passing a socket. Thin walls bind
   * exactly as in the engine, and a key door is crossed only with a key of its
   * colour picked up on the way,
   * so a key kept behind the socket opens nothing here. A consumed key is
   * treated as reusable once one is held: this over-approximates, so a rare false
   * bypass is possible but a real one is never missed.
   * Hazards bind too: water, fire and slime stop the walk unless the boots picked up on the way protect.
   * A level with a block (or a cloner of blocks) keeps them walkable, since a block can fill the hazard,
   * which preserves the never-miss contract. Teleporters are not followed (a known gap).
   */
  private static canReachExitWithoutSocket(level: CompiledLevel): boolean {
    const height = level.terrain.length;
    const width = level.terrain[0]?.length || 0;
    const edgeMask = cellEdgeMask(level);
    const { x: sx, y: sy } = level.playerStart;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return false;
    }
    const terrain = level.terrain.map((row) => [...row]);
    const picked = new Set<string>();
    const ownedKeys: Record<string, number> = {};
    const bootBits = this.buildBootBits();
    let boots = NO_BOOTS;
    const blockTypes = new Set(
      Object.values(ConfigRegistry.getMonsters().entities)
        .filter((def) => def.kind === 'block')
        .map((def) => def.id)
    );
    const blocksExist =
      level.entities.some((e) => blockTypes.has(e.type)) ||
      (level.cloneLinks ?? []).some((link) => blockTypes.has(link.templateType));
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
        if (item && !picked.has(cellKey)) {
          const collectible = ConfigRegistry.getTile(item).collectible;
          if (collectible === 'key') {
            picked.add(cellKey);
            ownedKeys[item] = (ownedKeys[item] || 0) + 1;
            changed = true;
          } else if (collectible === 'boot') {
            picked.add(cellKey);
            const bit = bootBits.get(item) ?? NO_BOOTS;
            // A boot grows the mask for the whole walk (optimistic); the next pass crosses what it protects.
            if ((boots & bit) !== bit) {
              boots |= bit;
              changed = true;
            }
          }
        }
        for (const dir of ORDERED_DIRECTIONS) {
          const vec = DIRECTION_VECTORS[dir];
          const nx = curr.x + vec.dx;
          const ny = curr.y + vec.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ny][nx]) continue;
          if (this.isEdgeBlocked(terrain, edgeMask, curr.x, curr.y, nx, ny, dir)) continue;
          let nextTile = ConfigRegistry.getTile(terrain[ny][nx]);
          if (nextTile.requiresAllChips) continue;
          if (nextTile.revealsToOnTouch && nextTile.revealsToOnTouch !== terrain[ny][nx]) {
            terrain[ny][nx] = nextTile.revealsToOnTouch;
            nextTile = ConfigRegistry.getTile(terrain[ny][nx]);
            changed = true;
          }
          if (nextTile.transformsToOnStep) {
            const hidden = hiddenUnder(level, terrain, nx, ny);
            if (hidden !== undefined) {
              terrain[ny][nx] = hidden;
              nextTile = ConfigRegistry.getTile(hidden);
              changed = true;
            }
          }
          if (nextTile.requiredKey) {
            if ((ownedKeys[nextTile.requiredKey] || 0) <= 0) continue;
            terrain[ny][nx] = openedTerrain(level, terrain, nx, ny, nextTile);
            changed = true;
            // What the door hid may be a wall: the key is spent and the way stays shut.
            if (!ConfigRegistry.getTile(terrain[ny][nx]).passableByPlayer) continue;
          } else if (!nextTile.passableByPlayer) {
            continue;
          }
          const tileHere = ConfigRegistry.getTile(terrain[ny][nx]);
          // A jet the player can switch off (its other form is walkable) is no barrier: a bypass through it is real.
          const switchable = toggleWallOtherForm(tileHere);
          const switchedOff = switchable !== undefined && ConfigRegistry.getTile(switchable).passableByPlayer;
          if (tileHere.hazard && !blocksExist && !switchedOff) {
            const bit = tileHere.protectedByItem ? bootBits.get(tileHere.protectedByItem) : undefined;
            if (bit === undefined || (boots & bit) === 0) continue;
          }
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return false;
  }

  /** Whether the tile's closed sides change during play: a swivel door or a rail switch. */
  private static turnsItsEdges(tile: TileDefinition): boolean {
    return tile.swivelTurns !== undefined || (tile.railSides !== undefined && tile.togglesTo !== undefined);
  }

  private static isEdgeBlocked(
    terrain: string[][],
    mask: Uint8Array | null,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    dir: Direction
  ): boolean {
    const fromId = terrain[fromY][fromX];
    const toId = terrain[toY][toX];
    // A rail switch flips with the green button, so like a swivel door its own sides prove nothing (both forms are
    // taken as open); straights and bends keep their exact sides through the edge rules.
    const fromSwivel = this.turnsItsEdges(ConfigRegistry.getTile(fromId));
    const toSwivel = this.turnsItsEdges(ConfigRegistry.getTile(toId));
    if (!fromSwivel && !toSwivel) return isEdgeBlockedAt(terrain, mask, fromX, fromY, toX, toY, dir);
    // A swivel door turns behind whoever passes, so for reachability it is open on every side: its own
    // blockedEdges are ignored (over-approximation of every orientation, never a false unreachable). The
    // neighbour's edges and the cell edges (mask) still apply. Cost: a one-way swivel trap is not flagged.
    // The edge is read with a neutral tile standing in for the door; the terrain is never written.
    return isEdgeBlockedBetween(
      fromSwivel ? SWIVEL_NEUTRAL_TILE : fromId,
      toSwivel ? SWIVEL_NEUTRAL_TILE : toId,
      mask,
      terrain[0].length,
      fromX,
      fromY,
      toX,
      toY,
      dir
    );
  }
}
