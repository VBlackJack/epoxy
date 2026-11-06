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
import { BeamCell, Direction, RuntimeEntity, TurretBeamDefinition } from '../types';
import { EpoxyWorld, NO_PLAY_START_TICK, getEntityAt, isEdgeBlocked, isInBounds, mapWidth } from './epoxyWorld';

/** Whether a push turns a turret toward the push when the definition does not say. */
const DEFAULT_FACE_ON_PUSH = true;
/** Beam opacity of a turret when the definition does not say. */
const DEFAULT_TURRET_OPACITY = 'block';
/** Whether a turret waits for the first step when the definition does not say. */
const DEFAULT_FIRES_AFTER_FIRST_STEP = true;

/** The turret definition of an entity type, undefined for any other entity. */
export function getTurretDef(type: string): TurretBeamDefinition | undefined {
  return ConfigRegistry.getEntityDef(type)?.turretBeam;
}

/** The direction a turret fires in: its facing, which is its direction until it is given one. */
export function turretFacing(entity: RuntimeEntity): Direction {
  return entity.facing ?? entity.dir;
}

/** Whether a push by the player turns this turret toward the push. */
export function turnsOnPush(def: TurretBeamDefinition): boolean {
  return def.faceOnPush ?? DEFAULT_FACE_ON_PUSH;
}

/** Whether the player has taken a first step in this level. */
function hasPlayStarted(w: EpoxyWorld): boolean {
  return w.playStartTick !== NO_PLAY_START_TICK;
}

/** Whether a turret of this definition is armed now: from load, or from the player's first step. */
function isArmed(w: EpoxyWorld, def: TurretBeamDefinition): boolean {
  return !(def.firesAfterFirstStep ?? DEFAULT_FIRES_AFTER_FIRST_STEP) || hasPlayStarted(w);
}

/**
 * Turns every turning turret a quarter turn when a whole number of periods has passed since its clock
 * started: the player's first step for a turret that waits for it, the load of the level otherwise.
 * A turret that waits for the first step stays still until then. Marks the beams dirty when one turned.
 */
export function turnTurrets(w: EpoxyWorld, ticksElapsed: number): void {
  if (!w.hasTurrets) return;
  for (const entity of w.entities) {
    const def = getTurretDef(entity.type);
    if (!def || def.turn === 0 || !isArmed(w, def)) continue;
    const origin = (def.firesAfterFirstStep ?? DEFAULT_FIRES_AFTER_FIRST_STEP) ? w.playStartTick : 0;
    const elapsed = ticksElapsed - origin;
    if (elapsed <= 0 || elapsed % def.turnPeriodTicks !== 0) continue;
    const count = ORDERED_DIRECTIONS.length;
    const index = ORDERED_DIRECTIONS.indexOf(turretFacing(entity));
    entity.facing = ORDERED_DIRECTIONS[(index + def.turn + count) % count];
    w.beamDirty = true;
  }
}

function markAxis(cell: BeamCell, dir: Direction): void {
  if (dir === 'E' || dir === 'W') cell.horizontal = true;
  else cell.vertical = true;
}

/**
 * Traces the beam of every armed turret. A beam leaves the cell its turret faces and goes on for at
 * most the turret's length. It stops, without covering the cell, at the map edge, a thin wall, a cell
 * a block could not enter (or a cell that is not laser transparent, for opacity 'laser') and any
 * block, mirrors included: a turret beam is never reflected. It covers the first cell holding the
 * player or a monster and ends there. Receivers are not lit by a turret.
 */
export function traceTurretBeams(w: EpoxyWorld): BeamCell[] {
  const crossed = new Map<number, BeamCell>();
  const width = mapWidth(w);
  for (const turret of w.entities) {
    const def = getTurretDef(turret.type);
    if (!def || !isArmed(w, def)) continue;
    const facing = turretFacing(turret);
    const dirs: readonly Direction[] = def.allSides ? ORDERED_DIRECTIONS : [facing];
    for (const dir of dirs) {
      const vec = DIRECTION_VECTORS[dir];
      let { x, y } = turret;
      for (let step = 0; step < def.length; step++) {
        const nx = x + vec.dx;
        const ny = y + vec.dy;
        if (!isInBounds(w, nx, ny) || isEdgeBlocked(w, x, y, nx, ny, dir, true)) break;
        if (blocksTurretBeam(w, def, nx, ny)) break;
        const index = ny * width + nx;
        const cell = crossed.get(index) ?? { x: nx, y: ny, horizontal: false, vertical: false };
        crossed.set(index, cell);
        markAxis(cell, dir);
        if (isPlayerOrMonsterAt(w, nx, ny)) break;
        x = nx;
        y = ny;
      }
    }
  }
  return [...crossed.values()];
}

/** Whether the cell stops a turret beam without being covered by it. */
function blocksTurretBeam(w: EpoxyWorld, def: TurretBeamDefinition, x: number, y: number): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (tile.laserReceiverGroup !== undefined) return true;
  const opaqueTerrain = (def.opacity ?? DEFAULT_TURRET_OPACITY) === 'block' ? !tile.passableByBlock : tile.laserTransparent !== true;
  if (opaqueTerrain) return true;
  if ((def.opacity ?? DEFAULT_TURRET_OPACITY) === 'block') {
    const item = w.items[y][x];
    if (item && ConfigRegistry.getTile(item).passableByBlock === false) return true;
  }
  const occupant = getEntityAt(w, x, y);
  return occupant !== undefined && occupant.kind === 'block';
}

function isPlayerOrMonsterAt(w: EpoxyWorld, x: number, y: number): boolean {
  if (w.player.alive && w.player.x === x && w.player.y === y) return true;
  return w.entities.some((e) => e.kind === 'monster' && e.x === x && e.y === y);
}

/**
 * The emitter beam cells with the turret beam cells merged in, by axis. A fresh list of copied cells,
 * so the cached emitter cells are never changed; the cached list itself when no turret beam exists.
 */
export function mergeBeamCells(emitterCells: BeamCell[], turretCells: BeamCell[]): BeamCell[] {
  if (turretCells.length === 0) return emitterCells;
  const merged = new Map<string, BeamCell>();
  for (const cell of [...emitterCells, ...turretCells]) {
    const key = `${cell.x},${cell.y}`;
    const existing = merged.get(key);
    if (existing) {
      existing.horizontal = existing.horizontal || cell.horizontal;
      existing.vertical = existing.vertical || cell.vertical;
    } else {
      merged.set(key, { ...cell });
    }
  }
  return [...merged.values()];
}

/**
 * Identity of the turrets' clock for the exhaustive searches: empty on a level without turrets, else
 * whether the player has stepped and, for each distinct turn period, how far into it the clock is. The
 * facings are part of the entities; this adds the phase that decides when they turn next.
 */
export function turretPhaseKey(w: EpoxyWorld, ticksElapsed: number): string {
  if (!w.hasTurrets) return '';
  const phases = new Set<string>();
  const defs = [
    ...w.entities.map((e) => getTurretDef(e.type)),
    ...w.cloneLinks.map((link) => getTurretDef(link.templateType))
  ];
  for (const def of defs) {
    if (!def || def.turn === 0) continue;
    const waits = def.firesAfterFirstStep ?? DEFAULT_FIRES_AFTER_FIRST_STEP;
    const origin = waits ? w.playStartTick : 0;
    phases.add(waits && !hasPlayStarted(w) ? 'idle' : `${def.turnPeriodTicks}:${(ticksElapsed - origin) % def.turnPeriodTicks}`);
  }
  return `${hasPlayStarted(w)}|${[...phases].sort().join(',')}`;
}
