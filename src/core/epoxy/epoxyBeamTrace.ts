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

import { BeamCell, CompiledLevel, Direction, GridPoint } from '../types';
import { refreshBeams } from './epoxyLasers';
import { startLevelWorld } from './epoxyLevelStart';
import { getTurretDef } from './epoxyTurrets';
import { EpoxyContext, createEpoxyWorld } from './epoxyWorld';

/** Play start tick that arms the turrets which wait for the player's first step. */
const ARMED_PLAY_START_TICK = 0;

/** What a trace is run with. */
export interface BeamTraceOptions {
  /** True: every turret fires, as once the player has taken a first step. False: as at tick 0 of the engine. */
  readonly armTurrets: boolean;
  /** Facings to give turrets before tracing, keyed by the index of the turret in level.entities. */
  readonly turretFacings?: ReadonlyMap<number, Direction>;
}

/** The beams of a level as a freshly loaded engine shows them. */
export interface BeamTrace {
  /** The cells the laser emitters' beams cross, turret beams left out. */
  readonly emitterCells: BeamCell[];
  /** The cells the turret beams cross, as traced (not merged with the emitter cells). */
  readonly turretCells: BeamCell[];
  /** The receivers a beam reaches. */
  readonly litReceivers: GridPoint[];
}

const UNREACHABLE_MESSAGE = 'A beam trace never runs this part of the engine';

/** A context for a world that is only traced: nothing is shown, and the parts that move things are unreachable. */
function inertContext(world: EpoxyContext['world']): EpoxyContext {
  return {
    world,
    emitVisual: () => undefined,
    completeLevel: () => {
      throw new Error(UNREACHABLE_MESSAGE);
    },
    checkTargetsWin: () => undefined,
    triggerButton: () => {
      throw new Error(UNREACHABLE_MESSAGE);
    },
    teleportEntity: () => {
      throw new Error(UNREACHABLE_MESSAGE);
    }
  };
}

/**
 * Traces the beams of a level without a running engine: the level is started in a private world, as
 * GameEngine.loadLevel starts it (hold doors set by their plates, laser gates as placed, underlays not
 * revealed), and the beams are read from it once, in a single pass. The level is never changed.
 * Throws a RangeError when a facing is given for an index that is no entity or no turret.
 */
export function traceLevelBeams(level: CompiledLevel, options: BeamTraceOptions): BeamTrace {
  const world = createEpoxyWorld();
  const ctx = inertContext(world);
  startLevelWorld(ctx, level);
  for (const [index, facing] of options.turretFacings ?? []) {
    // Entities are created in the order of level.entities, so the index is the position in the world.
    const entity = Number.isInteger(index) ? world.entities[index] : undefined;
    if (!entity || !getTurretDef(entity.type)) {
      throw new RangeError(`turretFacings: entity ${index} is not a turret of the level`);
    }
    entity.facing = facing;
  }
  if (options.armTurrets) world.playStartTick = ARMED_PLAY_START_TICK;
  world.beamDirty = true;
  refreshBeams(world);
  return {
    emitterCells: world.beamCells.map((cell) => ({ ...cell })),
    turretCells: world.turretBeamCells.map((cell) => ({ ...cell })),
    litReceivers: world.litReceiverCells.map((cell) => ({ ...cell }))
  };
}
