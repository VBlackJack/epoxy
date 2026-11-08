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
import { DEFAULT_MONSTER_MOVE_INTERVAL_TICKS, PULSE_WIRED_ACTION } from '../coreConstants';
import { SeededRandom } from '../Random';
import { compileSignalSpec } from '../signalLinks';
import { CompiledLevel } from '../types';
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
  w.rng = new SeededRandom(seed ?? SeededRandom.seedFromString(level.id));

  w.entities = level.entities.map((e) => {
    const def = ConfigRegistry.getEntityDef(e.type);
    return {
      uid: w.nextEntityUid++,
      type: e.type,
      kind: def?.kind || 'monster',
      x: e.x,
      y: e.y,
      dir: e.dir,
      cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
      isSliding: false,
      // A turret fires, and an arrow block shows its arrows, the way it was placed; its direction stays the way it is pushed or slides.
      ...(hasEntityFacing(def) ? { facing: e.dir } : {}),
      // A rover starts on the first behaviour of its list; no other entity has these fields.
      ...initialEmulationState(def)
    };
  });

  w.player = {
    x: level.playerStart.x,
    y: level.playerStart.y,
    dir: level.playerStart.dir,
    alive: true,
    deathReasonKey: null,
    isSliding: false,
    slideDir: null,
    moveCooldown: 0,
    slideCooldown: 0,
    inWater: false,
    keys: {},
    boots: new Set<string>()
  };

  w.chipsRemaining = level.chipsRequired;
  w.playStartTick = NO_PLAY_START_TICK;
  w.extraTimeSeconds = 0;
  w.levelBonusPoints = 0;
  w.levelScoreMultiplier = BASE_LEVEL_SCORE_MULTIPLIER;
  w.levelCompleted = false;
  w.statusBannerKey = null;
  w.removedUids.clear();
  w.swivelEntry.clear();
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
