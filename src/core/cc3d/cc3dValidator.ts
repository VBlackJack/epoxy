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

import { ORDERED_DIRECTIONS } from '../../config/constants';
import type { CompiledLevel, LevelValidationReport, ValidationIssue } from '../types';
import { REFLECTING_FACES } from './cc3dLasers';
import { cc3dLinks } from './cc3dLinks';
import {
  CC3D_BLOCKER_KINDS,
  CC3D_CLASS_FLOOR,
  CC3D_COLORS,
  CC3D_ITEM_KINDS,
  CC3D_MOB_KINDS,
  type Cc3dCell,
  type Cc3dLevel,
  type Cc3dTerrain,
  terrainClass,
  topTerrain
} from './model';

/**
 * The strict validator of a CC3D level: errors for what would make the engine or the display throw or
 * misbehave, warnings for devices that have nothing to work and starts that are probably a mistake. The
 * messages are i18n keys (validator.issues.cc3d_*); the importer's output never has an error.
 */

const DIRECTIONS: readonly string[] = ORDERED_DIRECTIONS;
const VERTICAL_SIDES: readonly string[] = ['N', 'S'];
const HORIZONTAL_SIDES: readonly string[] = ['E', 'W'];
const MIRROR_NAMES: readonly string[] = Object.keys(REFLECTING_FACES);
const CORNER_SIDE_COUNT = 2;

const COLORED_TERRAIN: readonly string[] = ['door', 'toggle_door', 'toggle_control', 'hold_door', 'plate'];
const HAZARD_KINDS: readonly string[] = ['water', 'fire', 'bomb'];
const TELEPORT_COLORS: Readonly<Record<string, string>> = { teleport_red: 'red', teleport_blue: 'blue' };

function isColor(value: unknown): boolean {
  return typeof value === 'string' && (CC3D_COLORS as readonly string[]).includes(value);
}

function isDirection(value: unknown): boolean {
  return typeof value === 'string' && DIRECTIONS.includes(value);
}

function isCorner(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== CORNER_SIDE_COUNT || !value.every(isDirection)) return false;
  // One closed side on each axis: display.ts reads the corner as north-or-south and east-or-west.
  return value.some((side) => VERTICAL_SIDES.includes(side)) && value.some((side) => HORIZONTAL_SIDES.includes(side));
}

function isMirror(value: unknown): boolean {
  return typeof value === 'string' && MIRROR_NAMES.includes(value.toUpperCase());
}

function isInside(level: Pick<Cc3dLevel, 'width' | 'height'>, x: unknown, y: unknown): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0 && (x as number) < level.width && (y as number) < level.height;
}

function checkTerrainLayer(layer: Cc3dTerrain, x: number, y: number, issues: ValidationIssue[]): void {
  const kind = layer.kind;
  if (COLORED_TERRAIN.includes(kind)) {
    if (layer.color === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_color.label', params: { kind, x, y } });
    else if (!isColor(layer.color)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind, x, y } });
  }
  if (kind === 'force') {
    if (layer.dir === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_dir.label', params: { kind, x, y } });
    else if (!isDirection(layer.dir)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind, x, y } });
  }
  if (kind === 'clone_machine' && layer.dir !== undefined && !isDirection(layer.dir)) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind, x, y } });
  }
  if (kind === 'ice_corner') {
    if (layer.corner === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_corner.label', params: { kind, x, y } });
    else if (!isCorner(layer.corner)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind, x, y } });
  }
}

/** Above the base: no second floor-like layer, devices before blockers. */
function isStackOrdered(classes: readonly number[]): boolean {
  return classes.slice(1).every((cls, i) => cls !== CC3D_CLASS_FLOOR && (i === 0 || cls >= classes[i]));
}

/** The stack of one cell: known kinds, a floor-like base, devices before blockers, fields the display needs. */
function checkCell(cell: Cc3dCell, x: number, y: number, issues: ValidationIssue[]): void {
  if (!Array.isArray(cell.terrain) || cell.terrain.length === 0) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_empty_stack.label', params: { x, y } });
    return;
  }
  let known = true;
  for (const layer of cell.terrain) {
    if (terrainClass(layer.kind) === undefined) {
      known = false;
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_unknown_terrain.label', params: { kind: String(layer.kind), x, y } });
    } else {
      checkTerrainLayer(layer, x, y, issues);
    }
  }
  if (known) {
    const classes = cell.terrain.map((layer) => terrainClass(layer.kind) as number);
    if (classes[0] !== CC3D_CLASS_FLOOR) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_base_not_floor.label', params: { kind: cell.terrain[0].kind, x, y } });
    } else if (!isStackOrdered(classes)) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_stack_order.label', params: { x, y } });
    }
  }
  const repeated = cell.terrain.find((layer, i) => cell.terrain.findIndex((other) => other.kind === layer.kind) !== i);
  if (repeated) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_duplicate_layer.label', params: { kind: String(repeated.kind), x, y } });
  }
  if (!Array.isArray(cell.panels) || !cell.panels.every(isDirection) || new Set(cell.panels).size !== cell.panels.length) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: 'panel', x, y } });
  }
  const item = cell.item;
  if (item !== null && item !== undefined) {
    if (!(CC3D_ITEM_KINDS as readonly string[]).includes(item.kind)) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_unknown_item.label', params: { kind: String(item.kind), x, y } });
    } else if (item.kind === 'key') {
      if (item.color === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_color.label', params: { kind: item.kind, x, y } });
      else if (!isColor(item.color)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: item.kind, x, y } });
    }
  }
}

function checkMobs(level: Cc3dLevel, issues: ValidationIssue[]): void {
  const occupied = new Set<number>();
  for (const mob of level.mobs) {
    const { x, y } = mob;
    if (!isInside(level, x, y)) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_mob_off_grid.label', params: { kind: String(mob.kind), x: Number(x), y: Number(y) } });
      continue;
    }
    const key = y * level.width + x;
    if (occupied.has(key)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_two_mobs.label', params: { x, y } });
    occupied.add(key);
    if (!(CC3D_MOB_KINDS as readonly string[]).includes(mob.kind)) {
      issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_unknown_mob.label', params: { kind: String(mob.kind), x, y } });
      continue;
    }
    if (mob.dir === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_dir.label', params: { kind: mob.kind, x, y } });
    else if (!isDirection(mob.dir)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: mob.kind, x, y } });
    if (mob.kind === 'block_color') {
      if (mob.color === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_color.label', params: { kind: mob.kind, x, y } });
      else if (!isColor(mob.color)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: mob.kind, x, y } });
    }
    if (mob.kind === 'reflector') {
      if (mob.mirror === undefined) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_missing_mirror.label', params: { kind: mob.kind, x, y } });
      else if (!isMirror(mob.mirror)) issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: mob.kind, x, y } });
    }
  }
}

function checkPlayer(level: Cc3dLevel, issues: ValidationIssue[]): boolean {
  const { player } = level;
  if (!player) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_no_player.label' });
    return false;
  }
  if (!isInside(level, player.x, player.y)) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_player_off_grid.label' });
    return false;
  }
  if (player.dir !== undefined && !isDirection(player.dir)) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_invalid_value.label', params: { kind: 'player', x: player.x, y: player.y } });
  }
  return true;
}

/** Starts on a closed blocker or a hazard are legal but almost always a mistake. */
function checkStart(level: Cc3dLevel, issues: ValidationIssue[]): void {
  const { x, y } = level.player;
  const cell = level.cells[y * level.width + x];
  if (!cell || !Array.isArray(cell.terrain) || cell.terrain.length === 0) return;
  const top = topTerrain(cell);
  const closedBlocker = (CC3D_BLOCKER_KINDS as readonly string[]).includes(top.kind) && top.open !== true;
  if (closedBlocker) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_start_on_blocker.label', params: { x, y } });
  else if (HAZARD_KINDS.includes(top.kind)) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_start_on_hazard.label', params: { x, y } });
}

function pointOf(level: Cc3dLevel, index: number): { x: number; y: number } {
  return { x: index % level.width, y: Math.floor(index / level.width) };
}

/** Warnings for devices with nothing to work, read from the same links the engine uses. */
function checkLinks(level: Cc3dLevel, issues: ValidationIssue[]): void {
  const links = cc3dLinks(level);
  for (const link of links.trapControls) {
    if (link.to === null) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_trap_control_no_trap.label', params: pointOf(level, link.from) });
  }
  for (const link of links.cloneSwitches) {
    if (link.to === null) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_clone_switch_no_machine.label', params: pointOf(level, link.from) });
  }
  for (const link of links.cloneMachines) {
    if (link.to === null) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_machine_no_template.label', params: pointOf(level, link.from) });
  }
  for (const link of links.laserControllers) {
    if (link.to === null) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_laser_controller_no_shooter.label', params: pointOf(level, link.from) });
  }
  for (const group of links.toggles) {
    if (group.targets.length > 0) continue;
    // One warning per colour, at its first control: a level can hold hundreds of them.
    if (group.controls.length > 0) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_toggle_control_no_door.label', params: { ...pointOf(level, group.controls[0]), color: group.color } });
    }
  }
  for (const group of links.holds) {
    if (group.targets.length > 0) continue;
    // One warning per colour, at its first control: a level can hold hundreds of them.
    if (group.controls.length > 0) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_plate_no_door.label', params: { ...pointOf(level, group.controls[0]), color: group.color } });
    }
  }
  for (const group of [links.golems.blue, links.golems.yellow]) {
    if (group.targets.length > 0) continue;
    // One warning per colour, at its first control: a level can hold hundreds of them.
    if (group.controls.length > 0) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_golem_control_no_golem.label', params: { ...pointOf(level, group.controls[0]), color: group.color } });
    }
  }
}

/** Keys whose colour has no door, and teleport colours with a single teleport. */
function checkColours(level: Cc3dLevel, issues: ValidationIssue[]): void {
  const doorColours = new Set<string>();
  const keyColours = new Set<string>();
  const teleportCounts: Record<string, number> = {};
  for (const cell of level.cells) {
    for (const layer of cell.terrain) {
      if (layer.kind === 'door' && layer.color) doorColours.add(layer.color);
    }
    if (cell.item?.kind === 'key' && cell.item.color) keyColours.add(cell.item.color);
    const colour = TELEPORT_COLORS[topTerrain(cell).kind];
    if (colour) teleportCounts[colour] = (teleportCounts[colour] ?? 0) + 1;
  }
  for (const colour of CC3D_COLORS) {
    if (keyColours.has(colour) && !doorColours.has(colour)) {
      issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_key_no_door.label', params: { color: colour } });
    }
  }
  for (const [colour, count] of Object.entries(teleportCounts)) {
    if (count === 1) issues.push({ severity: 'warning', i18nKey: 'validator.issues.cc3d_single_teleport.label', params: { color: colour } });
  }
}

/** Every problem of a CC3D level. Warnings are only looked for once the level has no error. */
export function validateCc3dLevel(level: Cc3dLevel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const gridOk =
    Number.isInteger(level.width) &&
    Number.isInteger(level.height) &&
    level.width > 0 &&
    level.height > 0 &&
    Array.isArray(level.cells) &&
    level.cells.length === level.width * level.height &&
    Array.isArray(level.mobs);
  if (!gridOk) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_bad_grid.label' });
    return issues;
  }
  level.cells.forEach((cell, index) => checkCell(cell, index % level.width, Math.floor(index / level.width), issues));
  checkMobs(level, issues);
  const playerOk = checkPlayer(level, issues);
  if (!level.cells.some((cell) => cell.terrain?.some((layer) => layer.kind === 'exit'))) {
    issues.push({ severity: 'error', i18nKey: 'validator.issues.cc3d_no_exit.label' });
  }
  // The stack checks above guarantee what the link and colour scans read; skip them when a stack is broken.
  if (issues.some((issue) => issue.severity === 'error')) return issues;
  if (playerOk) checkStart(level, issues);
  checkLinks(level, issues);
  checkColours(level, issues);
  return issues;
}

/**
 * The validation report of a compiled CC3D level, in the format LevelValidator returns. Nothing is simulated:
 * the reach stats only repeat what is placed.
 */
export function cc3dValidationReport(level: CompiledLevel): LevelValidationReport {
  const cc3d = level.cc3d;
  const issues = cc3d ? validateCc3dLevel(cc3d) : [{ severity: 'error' as const, i18nKey: 'validator.issues.cc3d_bad_grid.label' }];
  const cells = cc3d?.cells ?? [];
  const fish = cells.filter((cell) => cell?.item?.kind === 'fish').length;
  const exits = cells.filter((cell) => cell?.terrain?.some((layer) => layer.kind === 'exit')).length;
  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    stats: {
      chipsPlaced: fish,
      chipsRequired: level.chipsRequired,
      exitCount: exits,
      reachableChips: fish,
      reachableExit: exits > 0,
      targetCount: 0
    }
  };
}
