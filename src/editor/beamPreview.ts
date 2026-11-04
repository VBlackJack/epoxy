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

/**
 * Beam preview of the level editor: where the laser beams run on the level as it stands, with the
 * turrets armed as they are at tick 0. Pure module (no DOM): the level is loaded into a private
 * engine and read through its public API only, so the editor never traces a beam on its own.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { ORDERED_DIRECTIONS } from '../config/constants';
import { GameEngine } from '../core/GameEngine';
import { hasLaserContent } from '../core/RulesetFeatures';
import { BeamCell, CompiledLevel, Direction, GridPoint } from '../core/types';

/** Play start tick that arms the turrets which wait for the player's first step. */
const ARMED_PLAY_START_TICK = 0;
/** Quarter turns a turning turret makes after tick 0 that the preview shows dimmed. */
const PREVIEW_TURN_STEPS = 3;

/** What the editor draws and announces for the beams of a level. */
export interface BeamPreview {
  /** Whether the level has laser content at all; false for a level the preview does not cover. */
  readonly hasLasers: boolean;
  /** Every cell a beam crosses at tick 0, emitter and turret beams together. */
  readonly beamCells: readonly BeamCell[];
  /** The cells the emitter beams cross at tick 0. */
  readonly emitterCells: readonly BeamCell[];
  /** The cells the turret beams cross at tick 0, beyond what the emitter beams already cover. */
  readonly turretCells: readonly BeamCell[];
  /** The cells a turning turret reaches at its later facings, beyond everything shown at tick 0. */
  readonly dimTurretCells: readonly BeamCell[];
  /** The receivers a beam reaches at tick 0. */
  readonly litReceivers: readonly GridPoint[];
  /** The closed gates whose receiver group is lit: they open on the first pass. */
  readonly gatesOpening: readonly GridPoint[];
  /** Every receiver of the level. */
  readonly totalReceivers: number;
}

export const EMPTY_BEAM_PREVIEW: BeamPreview = {
  hasLasers: false,
  beamCells: [],
  emitterCells: [],
  turretCells: [],
  dimTurretCells: [],
  litReceivers: [],
  gatesOpening: [],
  totalReceivers: 0
};

/**
 * The one place that reaches into the engine's state to arm the turrets as they are once the player
 * has taken a first step, so that the preview shows them firing. Pinned by a test: the engine is to
 * offer a direct trace of a level's beams, and this adapter goes then.
 */
export function armTurretsAtTickZero(engine: GameEngine): void {
  engine.restoreState({ ...engine.captureState(), playStartTick: ARMED_PLAY_START_TICK });
}

/** The cells of `cells` with the axes `covered` already holds taken away; a cell left with no axis is dropped. */
function subtractAxes(cells: readonly BeamCell[], covered: readonly BeamCell[]): BeamCell[] {
  const held = new Map<string, BeamCell>(covered.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const rest: BeamCell[] = [];
  for (const cell of cells) {
    const other = held.get(`${cell.x},${cell.y}`);
    const horizontal = cell.horizontal && !other?.horizontal;
    const vertical = cell.vertical && !other?.vertical;
    if (horizontal || vertical) rest.push({ x: cell.x, y: cell.y, horizontal, vertical });
  }
  return rest;
}

/** The cells of several lists merged by position, their axes combined. */
function unionCells(lists: readonly (readonly BeamCell[])[]): BeamCell[] {
  const merged = new Map<string, BeamCell>();
  for (const cell of lists.flat()) {
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

/** The beam cells at the facings a turning turret takes after `steps` quarter turns, in the state the engine holds. */
function turnedTurretCells(engine: GameEngine, steps: number): readonly BeamCell[] {
  const snapshot = engine.captureState();
  let turning = false;
  const entities = snapshot.entities.map((entity) => {
    const turn = ConfigRegistry.getEntityDef(entity.type)?.turretBeam?.turn ?? 0;
    if (turn === 0) return entity;
    turning = true;
    const facing: Direction = entity.facing ?? entity.dir;
    const count = ORDERED_DIRECTIONS.length;
    const index = ORDERED_DIRECTIONS.indexOf(facing);
    return { ...entity, facing: ORDERED_DIRECTIONS[(((index + turn * steps) % count) + count) % count] };
  });
  if (!turning) return [];
  engine.restoreState({ ...snapshot, entities });
  const emitter = engine.getEmitterBeamCells();
  const cells = subtractAxes(engine.getBeamCells(), emitter);
  engine.restoreState(snapshot);
  return cells;
}

/** The closed laser gates whose receiver group a lit receiver belongs to. */
function gatesOpening(level: CompiledLevel, lit: readonly GridPoint[]): GridPoint[] {
  const litGroups = new Set<string>();
  for (const { x, y } of lit) {
    const group = ConfigRegistry.getTile(level.terrain[y][x]).laserReceiverGroup;
    if (group !== undefined) litGroups.add(group);
  }
  const opening: GridPoint[] = [];
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      const tile = ConfigRegistry.getTile(id);
      if (tile.laserGateTogglesTo && tile.laserGateOpen === false && tile.laserGateGroup !== undefined && litGroups.has(tile.laserGateGroup)) {
        opening.push({ x, y });
      }
    })
  );
  return opening;
}

function countReceivers(level: CompiledLevel): number {
  let total = 0;
  for (const row of level.terrain) {
    for (const id of row) if (ConfigRegistry.getTile(id).laserReceiverGroup !== undefined) total++;
  }
  return total;
}

/**
 * The beams of a level at tick 0, with the turrets armed. Empty for a level without laser content, for
 * any ruleset but Epoxy, and for a level the engine cannot load.
 */
export function computeBeamPreview(level: CompiledLevel): BeamPreview {
  const ruleset = level.ruleset ?? 'epoxy';
  if (ruleset !== 'epoxy') return EMPTY_BEAM_PREVIEW;
  try {
    if (!hasLaserContent(level)) return EMPTY_BEAM_PREVIEW;
    const engine = new GameEngine();
    engine.loadLevel(level);
    armTurretsAtTickZero(engine);
    const beamCells = engine.getBeamCells().map((cell) => ({ ...cell }));
    const emitterCells = engine.getEmitterBeamCells().map((cell) => ({ ...cell }));
    const litReceivers = engine.getLitReceivers().map((cell) => ({ ...cell }));
    const turretCells = subtractAxes(beamCells, emitterCells);
    const later: BeamCell[][] = [];
    for (let step = 1; step <= PREVIEW_TURN_STEPS; step++) later.push([...turnedTurretCells(engine, step)]);
    return {
      hasLasers: true,
      beamCells,
      emitterCells,
      turretCells,
      dimTurretCells: subtractAxes(unionCells(later), beamCells),
      litReceivers,
      gatesOpening: gatesOpening(level, litReceivers),
      totalReceivers: countReceivers(level)
    };
  } catch (err) {
    console.error('Beam preview failed:', err);
    return EMPTY_BEAM_PREVIEW;
  }
}
