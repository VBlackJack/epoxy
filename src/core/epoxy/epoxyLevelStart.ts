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
import { CC_CADENCE_TYPES, DEFAULT_MONSTER_MOVE_INTERVAL_TICKS, DEFAULT_PLAYER_CHARACTER, PULSE_WIRED_ACTION } from '../coreConstants';
import { SeededRandom } from '../Random';
import { compileSignalSpec } from '../signalLinks';
import { buildRailCells } from './epoxyRailsCc2';
import { CompiledLevel, Direction, PlayerCharacter, PlayerState } from '../types';
import { usesCcRules } from './ccRules';
import { newCcGenerators } from './ccGenerators';
import { hasEntityFacing } from './epoxyArrowBlocks';
import { initialEmulationState } from './epoxyEmulation';
import { setHoldDoors, setPoweredCells } from './epoxyDevices';
import { createSignalRuntime, registryTileLookup, settleWorldSignals } from './epoxySignals';
import {
  BASE_LEVEL_SCORE_MULTIPLIER,
  EpoxyContext,
  NO_PLAY_START_TICK,
  buildLevelLookups
} from './epoxyWorld';

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
  w.ccArrivals = [];
  w.ccArrivalsRunning = false;
  const ccCadence = usesCcRules(level);
  const levelSeed = seed ?? SeededRandom.seedFromString(level.id);
  w.rng = new SeededRandom(levelSeed);
  // Every classic-rules level (a .DAT import and a CC2 import alike) draws walker and blob turns from the classic
  // generators. Calibrated against Chip's Challenge 1 and the official Chip's Challenge 2 levels.
  w.ccGenerators = ccCadence ? newCcGenerators(levelSeed) : null;

  w.entities = level.entities.map((e) => {
    const def = ConfigRegistry.getEntityDef(e.type);
    return {
      uid: w.nextEntityUid++,
      type: e.type,
      kind: def?.kind || 'monster',
      x: e.x,
      y: e.y,
      dir: e.dir,
      // A classic-rules monster decides at tick 0; any other monster waits out its first interval.
      cooldownTicks: ccCadence && CC_CADENCE_TYPES.includes(e.type) ? 0 : def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
      isSliding: false,
      // A turret fires, and an arrow block shows its arrows, the way it was placed; its direction stays the way it is pushed or slides.
      ...(hasEntityFacing(def) ? { facing: e.dir } : {}),
      // A rover starts on the first behaviour of its list; no other entity has these fields.
      ...initialEmulationState(def),
      // A monster with a trail that starts on slime has stood on it already.
      ...(def?.trailTile !== undefined && def.immuneToSlime === true && ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]).hazard === 'slime' ? { slimed: true } : {})
    };
  });

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
}
