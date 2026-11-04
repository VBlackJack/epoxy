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
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import { LASER_VISITS_PER_CELL, reflectOnMirror } from '../coreConstants';
import { BeamCell, Direction, GridPoint, RuntimeEntity } from '../types';
import {
  EpoxyContext,
  EpoxyWorld,
  getEntityAt,
  isEdgeBlocked,
  isInBounds,
  killPlayer,
  litLaserGroups,
  mapHeight,
  mapWidth,
  removeEntity
} from './epoxyWorld';
import { traceTurretBeams } from './epoxyTurrets';

/** Sound played when a beam kills a monster or the player. */
const LASER_DEATH_SFX = 'burn';
/** Sound played when laser gates open or close. */
const LASER_GATE_SFX = 'door';

export function refreshBeams(w: EpoxyWorld): void {
  if (w.beamDirty) traceBeams(w);
}

/**
 * Traces every beam on the current terrain and entities and stores the cells
 * crossed, the receivers reached and whether a mirror on a path is sliding.
 * A beam leaves its emitter in the emitter's direction and goes on until the
 * map edge, a thin wall on the edge it crosses, an opaque cell (the receiver
 * it lights included) or a block that is not a mirror. A mirror, at rest or
 * sliding, turns it (a one-sided mirror only on its front faces; its back stops the beam). Players and monsters do not stop it, teleporters do not
 * move it and bombs are not set off. The emitter cell and the cell that stops
 * a beam are not beam cells.
 */
function traceBeams(w: EpoxyWorld): void {
  w.beamDirty = false;
  w.beamHasSlidingMirror = false;
  const crossed = new Map<number, BeamCell>();
  const lit = new Map<number, GridPoint>();
  if (w.laserEmitters.length > 0) {
    const width = mapWidth(w);
    const blocksByCell = new Map<number, RuntimeEntity>();
    for (const entity of w.entities) {
      const index = entity.y * width + entity.x;
      if (entity.kind === 'block' && !blocksByCell.has(index)) blocksByCell.set(index, entity);
    }
    const visited = new Set<number>();
    const maxVisits = width * mapHeight(w) * LASER_VISITS_PER_CELL;
    for (const emitter of w.laserEmitters) {
      // An emitter hidden under a removable top fires only once the top is gone.
      if (ConfigRegistry.getTile(w.terrain[emitter.y][emitter.x]).laserEmitter !== emitter.dir) continue;
      let { x, y, dir } = emitter;
      while (visited.size < maxVisits) {
        const vec = DIRECTION_VECTORS[dir];
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        if (!isInBounds(w, nx, ny) || isEdgeBlocked(w, x, y, nx, ny, dir)) break;
        const index = ny * width + nx;
        const tile = ConfigRegistry.getTile(w.terrain[ny][nx]);
        if (tile.laserReceiverGroup !== undefined) {
          if (!lit.has(index)) lit.set(index, { x: nx, y: ny });
          break;
        }
        if (tile.laserTransparent !== true) break;
        const block = blocksByCell.get(index);
        const mirror = block ? ConfigRegistry.getEntityDef(block.type) : undefined;
        const axis = mirror?.mirrorAxis;
        if (block && !axis) break;
        // A one-sided mirror turns the beam on its front faces; on its back faces it stops it, uncovered and unharmed.
        const turned = axis ? reflectOnMirror(axis, mirror?.mirrorFrontCorner, dir) : null;
        if (block && axis && turned === null) break;
        const visit = index * ORDERED_DIRECTIONS.length + ORDERED_DIRECTIONS.indexOf(dir);
        if (visited.has(visit)) break;
        visited.add(visit);

        const cell = crossed.get(index) ?? { x: nx, y: ny, horizontal: false, vertical: false };
        crossed.set(index, cell);
        markBeamAxis(cell, dir);
        if (block && axis && turned !== null) {
          if (block.isSliding) w.beamHasSlidingMirror = true;
          dir = turned;
          markBeamAxis(cell, dir);
        }
        x = nx;
        y = ny;
      }
    }
  }
  w.beamCells = [...crossed.values()];
  w.turretBeamCells = w.hasTurrets ? traceTurretBeams(w) : [];
  w.litReceiverCells = [...lit.values()];
}

function markBeamAxis(cell: BeamCell, dir: Direction): void {
  if (dir === 'E' || dir === 'W') {
    cell.horizontal = true;
  } else {
    cell.vertical = true;
  }
}

/**
 * Settles the lasers after the player moved or a tick passed: traces the
 * beams, kills the monsters and then the player on a beam cell, sets the
 * gates and ends a 'receivers' level once every receiver is lit. Gates are
 * set from this trace and not traced again, so a gate takes effect on the
 * next pass: beams and gates never chase each other within one pass.
 */
export function resolveLasers(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (w.laserEmitters.length + w.laserReceivers.length + w.laserGates.length === 0 && !w.hasTurrets) return;
  if (!w.player.alive || w.levelCompleted) {
    // Nothing is settled, but a mirror may have moved this pass: leave the cache to be retraced.
    w.beamDirty = true;
    return;
  }

  traceBeams(w);
  const width = mapWidth(w);
  const beamIndexes = new Set([...w.beamCells, ...w.turretBeamCells].map((cell) => cell.y * width + cell.x));
  for (const entity of [...w.entities]) {
    if (entity.kind !== 'monster' || !beamIndexes.has(entity.y * width + entity.x)) continue;
    removeEntity(w, entity.uid);
    AudioManager.playSfx(LASER_DEATH_SFX);
    ctx.emitVisual('explosion', entity.x, entity.y);
    // The beam that ended on the monster goes on through its cell.
    if (w.hasTurrets) w.beamDirty = true;
  }
  if (beamIndexes.has(w.player.y * width + w.player.x)) {
    killPlayer(ctx, 'hud.messages.death_laser', LASER_DEATH_SFX);
    return;
  }

  setLaserGates(w);
  checkReceiversWin(ctx);
}

/**
 * Sets each gate open while any receiver of its group is lit and closed
 * otherwise. A gate never closes on a cell the player or an entity occupies.
 */
function setLaserGates(w: EpoxyWorld): void {
  const litGroups = litLaserGroups(w);
  let changed = false;
  for (const { x, y } of w.laserGates) {
    const tile = ConfigRegistry.getTile(w.terrain[y][x]);
    const wantsOpen = tile.laserGateGroup !== undefined && litGroups.has(tile.laserGateGroup);
    if (!tile.laserGateTogglesTo || tile.laserGateOpen === wantsOpen) continue;
    const occupied = (w.player.x === x && w.player.y === y) || getEntityAt(w, x, y) !== undefined;
    if (!wantsOpen && occupied) continue;
    w.terrain[y][x] = tile.laserGateTogglesTo;
    changed = true;
  }
  if (changed) {
    AudioManager.playSfx(LASER_GATE_SFX);
    w.beamDirty = true;
  }
}

/** Ends a 'receivers' level once every receiver is lit and no mirror on a beam path is still sliding. */
function checkReceiversWin(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (w.level.winRule !== 'receivers' || w.laserReceivers.length === 0) return;
  if (w.litReceiverCells.length < w.laserReceivers.length || w.beamHasSlidingMirror) return;
  ctx.emitVisual('win', w.player.x, w.player.y);
  ctx.completeLevel();
}
