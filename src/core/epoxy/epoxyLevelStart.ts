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
import { followsCcCadence, DEFAULT_MONSTER_MOVE_INTERVAL_TICKS, DEFAULT_PLAYER_CHARACTER, PULSE_WIRED_ACTION } from '../coreConstants';
import { SeededRandom } from '../Random';
import { compileSignalSpec } from '../signalLinks';
import { buildRailCells } from './epoxyRailsCc2';
import { CompiledLevel, Direction, PlayerCharacter, PlayerState } from '../types';
import { usesCc2Engine, usesCcRules } from './ccRules';
import { isConvertedCc3dLevel } from '../cc3d/cc3dConstants';
import { CC2_BLOB_BEHAVIOR_DEFAULT, initialBlobModifier, newCcGenerators } from './ccGenerators';
import { hasEntityFacing } from './epoxyArrowBlocks';
import { initialEmulationState } from './epoxyEmulation';
import { setHoldDoors, setPoweredCells } from './epoxyDevices';
import { createSignalRuntime, registryTileLookup, settleWorldSignals } from './epoxySignals';
import {
  BASE_LEVEL_SCORE_MULTIPLIER,
  EpoxyContext,
  NO_PLAY_START_TICK,
  buildLevelLookups,
  refreshTrapLatch
} from './epoxyWorld';

/** The terrain ids a picked-up yellow pad is set down as (the pad terrain named by each cc2YellowPadItem tile). */
function yellowPadTerrainIds(): Set<string> {
  const ids = new Set<string>();
  for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
    if (tile.cc2YellowPadItem === true && tile.dropsAsTerrain !== undefined) ids.add(tile.dropsAsTerrain);
  }
  return ids;
}

/**
 * Whether the yellow teleporters of a level are items a player picks up: only on a CC2-engine level that has more than one of
 * them at load (a single pad stays a pad, as in the source engine). Counted on the terrain grid as the level loads, once.
 */
export function yellowPadsAreItems(level: Pick<CompiledLevel, 'cc2' | 'terrain'>): boolean {
  if (!usesCc2Engine(level)) return false;
  const padIds = yellowPadTerrainIds();
  let pads = 0;
  for (const row of level.terrain) {
    for (const id of row) {
      if (padIds.has(id)) pads += 1;
      if (pads > 1) return true;
    }
  }
  return false;
}

/**
 * Puts the play state of a level into the world of `ctx`: terrain, items and links copied, the random
 * generator seeded (from the level id unless a seed is given), entities in uid order, the player at
 * the start, the lookups built and the hold doors set to the state their plates ask for. Everything
 * the engine keeps outside the world (clock, score, history) stays with the engine.
 */
export function startLevelWorld(ctx: EpoxyContext, level: CompiledLevel, seed?: number): void {
  const w = ctx.world;
  w.level = level;
  w.terrain = level.terrain.map((row) => [...row]);
  w.items = level.items.map((row) => [...row]);
  w.trapLinks = level.trapLinks.map((l) => ({ ...l }));
  w.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
  w.nextEntityUid = 1;
  w.ccMonsterClock = 0;
  // The world object is reused across levels: the apparent player position of the last level must not leak into this one.
  w.cc2PlayerView = undefined;
  w.ccArrivals = [];
  w.ccArrivalsRunning = false;
  // Deferred wire-fired sink edges of the last level must not fire in this one.
  w.cc2DeferredSinkEdges = [];
  // A brown button held by the last level must not stay held in this one.
  w.cc2BrownHeld = undefined;
  // Buttons toggled by a rolling ball of the last level must not stay held in this one.
  w.cc2ToggledButtonCells = [];
  w.cc2YellowPadsAreItems = yellowPadsAreItems(level);
  const ccCadence = usesCcRules(level);
  const cc3dLevel = !ccCadence && isConvertedCc3dLevel(level);
  const levelSeed = seed ?? SeededRandom.seedFromString(level.id);
  w.rng = new SeededRandom(levelSeed);
  // Every classic-rules level (a .DAT import and a CC2 import alike) draws walker and blob turns from the classic
  // generators. Calibrated against Chip's Challenge 1 and the official Chip's Challenge 2 levels.
  w.ccGenerators = ccCadence ? newCcGenerators(levelSeed) : null;
  // A CC2 blob also draws a modifier of its own; a replay hands it over as the seed.
  if (w.ccGenerators !== null && usesCc2Engine(level)) {
    w.ccGenerators.blobModifier = initialBlobModifier(level.cc2?.blobBehavior ?? CC2_BLOB_BEHAVIOR_DEFAULT, levelSeed, seed !== undefined);
  }

  w.entities = level.entities.map((e) => {
    const def = ConfigRegistry.getEntityDef(e.type);
    return {
      uid: w.nextEntityUid++,
      type: e.type,
      kind: def?.kind || 'monster',
      x: e.x,
      y: e.y,
      dir: e.dir,
      // A classic-rules monster, a CC2 yellow tank and a monster of a converted CC3D level decide at tick 0; any other monster waits out its first interval.
      cooldownTicks: (usesCc2Engine(level) && def?.steeredBy !== undefined) || (ccCadence && followsCcCadence(e.type, usesCc2Engine(level))) || (cc3dLevel && (def?.kind ?? 'monster') === 'monster') ? 0 : def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
      isSliding: false,
      // A turret fires, and an arrow block shows its arrows, the way it was placed; its direction stays the way it is pushed or slides.
      ...(hasEntityFacing(def) ? { facing: e.dir } : {}),
      // A rover starts on the first behaviour of its list; no other entity has these fields.
      ...initialEmulationState(def),
      // A monster with a trail that starts on slime has stood on it already.
      ...(def?.trailTile !== undefined && def.immuneToSlime === true && ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]).hazard === 'slime' ? { slimed: true } : {})
    };
  });

  // The classic game keeps its creatures in numbered slots; a clone takes the first free one (see addClonedEntity).
  w.ccSlots = ccCadence ? w.entities.map((e) => e.uid) : [];

  const newPlayer = (x: number, y: number, dir: Direction, character?: PlayerCharacter): PlayerState => ({
    x,
    y,
    dir,
    alive: true,
    deathReasonKey: null,
    isSliding: false,
    slideDir: null,
    moveCooldown: 0,
    slideCooldown: 0,
    inWater: false,
    keys: {},
    boots: new Set<string>(),
    ...(character !== undefined ? { character } : {})
  });
  w.player = newPlayer(level.playerStart.x, level.playerStart.y, level.playerStart.dir);
  // A level with several players: the others start parked, in swap order, each with its own character.
  const extras = level.extraPlayers ?? [];
  w.parked = extras.map((p) => newPlayer(p.x, p.y, p.dir, p.character));
  if (extras.length > 0) w.player.character = level.character ?? DEFAULT_PLAYER_CHARACTER;
  w.exitedPlayers = 0;
  w.swappedIn = null;

  // A converted CC3D level: a block that rests on a force floor at the start is carried as soon as play starts.
  if (cc3dLevel) {
    for (const e of w.entities) {
      if (e.kind !== 'block') continue;
      const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
      if (tile.slideType !== 'force' || !tile.forceDirection || tile.forceDirection === 'RANDOM' || tile.forceCycle === true) continue;
      if (ConfigRegistry.getEntityDef(e.type)?.slidesOnForce !== true) continue;
      e.isSliding = true;
      e.dir = tile.forceDirection;
      e.cooldownTicks = 0;
    }
  }

  w.chipsRemaining = level.chipsRequired;
  w.playStartTick = NO_PLAY_START_TICK;
  w.extraTimeSeconds = 0;
  w.levelBonusPoints = 0;
  w.levelScoreMultiplier = BASE_LEVEL_SCORE_MULTIPLIER;
  w.levelCompleted = false;
  w.statusBannerKey = null;
  w.removedUids.clear();
  w.swivelEntry.clear();
  buildRailCells(w);
  buildLevelLookups(w);
  const signalSpec = compileSignalSpec(level, registryTileLookup);
  // A level with a gray area button needs a runtime even with no wire, to hold the devices the button reaches on.
  const needsRuntime = signalSpec === undefined && level.terrain.some((row) => row.some((id) => ConfigRegistry.getTile(id).buttonAction === PULSE_WIRED_ACTION));
  w.signals = signalSpec !== undefined ? createSignalRuntime(signalSpec) : needsRuntime ? createSignalRuntime({ nodes: [], links: [] }) : undefined;
  // The signals settle first, from a fresh beam trace, so a door never starts in a form its signals would undo.
  w.beamDirty = true;
  settleWorldSignals(w, true);
  // A relay pad starts in the form of its input; no sound and no jump at load.
  setPoweredCells(ctx);
  // A hold door starts in the state its plates ask for (a block may start on a plate); no sound at load.
  setHoldDoors(ctx, false);
  w.beamDirty = true;
  refreshTrapLatch(w);
}
