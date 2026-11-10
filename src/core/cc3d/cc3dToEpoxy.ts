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

import type {
  CellEdge,
  CellUnderlay,
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  LauncherLink,
  TrapLink
} from '../types';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { entityPressesPlate } from '../epoxy/epoxyWorld';
import { CONVERTED_ID_SUFFIX } from './cc3dConstants';
import { cc3dLinks, holdDoorWanted, indicesWithLayer } from './cc3dLinks';
import { turnClockwise } from './cc3dWorld';
import { displayTerrainId } from './display';
import {
  classifyStack,
  elementKeys,
  EPOXY_COVERAGE,
  isShooterCovered,
  KEY_APPEARING_WALL_WITH_MONSTER,
  KEY_APPEARING_WALL_WITH_SLIDE,
  KEY_BOMB_WITH_ITEM,
  KEY_CLONE_SWITCH_EMPTY,
  KEY_GRAVEL_WITH_REFLECTOR,
  KEY_LASER_SHOOTER_COVERED,
  KEY_MONSTERS_MEET,
  KEY_ORBS_OVER_CAP,
  KEY_PANELS_ON_NONFLOOR,
  KEY_SOCKET_RED_STACKED,
  KEY_STACKED_RUNTIME,
  KEY_STACKED_TERRAIN,
  KEY_TRAP_UNWORKED
} from './epoxyCoverage';
import { CC3D_COLORS } from './model';
import type { Cc3dCell, Cc3dColor, Cc3dItem, Cc3dItemKind, Cc3dLevel, Cc3dMob, Cc3dMobKind, Cc3dTerrain, Cc3dTerrainKind } from './model';

/**
 * Converts a CC3D level to a native Epoxy level, once and for good: the result is an ordinary Epoxy level
 * (ruleset 'epoxy', no cc3d data) that the Epoxy engine plays. Pure and deterministic; the input is never mutated.
 * What Epoxy cannot hold is dropped, and every drop is named in the report next to the coverage verdicts.
 */

export { CONVERTED_ID_SUFFIX };

const EPOXY_RULESET = 'epoxy';
const PLAIN_FLOOR: Cc3dTerrainKind = 'floor';
const FLOOR_ID = 'floor';
const SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** The start facing of a stored level that carries none. */
const DEFAULT_PLAYER_DIR: Direction = 'W';
const BOMB_ITEM_ID = 'bomb';
const CHIP_ITEM_ID = 'chip';
const SLOW_TIME_ITEM_ID = 'slow_time';
/** The Epoxy tile of the CC3D red socket: a chip socket the player alone enters. */
const SOCKET_TILE_ID = 'socket';
/** The Epoxy tile of the CC3D blue socket: every mover enters it once the chips are in. */
const FISH_GATE_TILE_ID = 'fish_gate';
/** The Epoxy teleporters of the CC3D blue (leaves ahead only) and red (ahead, right, left, back) teleporters. */
const TELEPORT_FORWARD_TILE_ID = 'teleport_forward';
const TELEPORT_TURNING_TILE_ID = 'teleport_turning';
/** Every Epoxy tile that counts as a socket for the chips a level needs. */
const SOCKET_TILE_IDS: ReadonlySet<string> = new Set([SOCKET_TILE_ID, FISH_GATE_TILE_ID]);
const BUTTON_BROWN_ID = 'button_brown';
const TRAP_ID = 'trap';
/** The Epoxy trap no button opens (pack format 17), for a CC3D trap that no trap control works. */
const SEALED_TRAP_ID = 'trap_sealed';
const BUTTON_RED_ID = 'button_red';
const CLONE_MACHINE_ID = 'clone_machine';
const SHOT_TRIGGER_ID = 'shot_trigger';
const SHOT_LAUNCHER_PREFIX = 'shot_launcher_';
const SHOOTER_KIND: Cc3dMobKind = 'laser_shooter';
const QUARTER_TURN_CLOCKWISE = 1;
const QUARTER_TURN_COUNTER_CLOCKWISE = -1;
const NO_PLATES = 0;
const TOGGLE_PREFIX = 'toggle_wall_';
const GREEN: Cc3dColor = 'green';

/** What the converter dropped in one cell, by coverage key. */
export interface ConversionDrop {
  key: string;
  x: number;
  y: number;
}

export interface ConversionReportEntry {
  key: string;
  reason: string;
}

export interface ConversionReport {
  /** Coverage keys Epoxy plays as CC3D does. */
  exact: string[];
  /** Coverage keys Epoxy plays close to CC3D, with the difference. */
  approx: ConversionReportEntry[];
  /** Coverage keys Epoxy loses, including everything the converter dropped. */
  lost: ConversionReportEntry[];
  /** Where the converter itself dropped something (a subset of `lost`), one entry per cell and key. */
  drops: ConversionDrop[];
}

export interface ConversionResult {
  level: CompiledLevel;
  report: ConversionReport;
}

// ------------------------------------------------------------------ rule tables

function need<T>(value: T | undefined, what: string, kind: string): T {
  if (value === undefined) throw new Error(`CC3D converter: ${kind} needs ${what}`);
  return value;
}

interface RuleContext {
  /** Whether the hold doors of each colour start open (every plate of the colour pressed at load). */
  holdOpen: Record<Cc3dColor, boolean>;
}

interface TerrainRule {
  /** The Epoxy terrain id of the layer (an item id for a bomb, which the cell logic moves to the item grid). */
  id: (layer: Cc3dTerrain, context: RuleContext) => string;
  /** The coverage key carries the colour of the layer. */
  colored?: true;
}

/** A rule that gives the same id whatever the element. */
function fixed(id: string): () => string {
  return () => id;
}

function cornerId(layer: Cc3dTerrain): string {
  const sides = need(layer.corner, 'corner', layer.kind);
  const north = sides.includes('N');
  const south = sides.includes('S');
  const east = sides.includes('E');
  const west = sides.includes('W');
  if (north === south || east === west) throw new Error('CC3D converter: ice_corner needs one north or south side and one east or west side');
  return `ice_${north ? 'n' : 's'}${east ? 'e' : 'w'}`;
}

function toggleDoorId(layer: Cc3dTerrain): string {
  const color = need(layer.color, 'color', layer.kind);
  const state = layer.open === true ? 'open' : 'closed';
  return color === GREEN ? `${TOGGLE_PREFIX}${state}` : `${TOGGLE_PREFIX}${color}_${state}`;
}

/** Every CC3D terrain kind and the Epoxy tile it becomes. Typed over the whole kind list, so a new kind cannot be forgotten. */
const TERRAIN_RULES: Record<Cc3dTerrainKind, TerrainRule> = {
  floor: { id: fixed(FLOOR_ID) },
  wall: { id: fixed('wall') },
  water: { id: fixed('water') },
  fire: { id: fixed('fire') },
  ice: { id: fixed('ice') },
  ice_corner: { id: cornerId },
  force: { id: (layer) => `force_${need(layer.dir, 'dir', layer.kind).toLowerCase()}` },
  force_random: { id: fixed('force_cycle') },
  exit: { id: fixed('exit') },
  socket: { id: fixed(FISH_GATE_TILE_ID) },
  socket_red: { id: fixed(SOCKET_TILE_ID) },
  slime: { id: fixed('slime_3d') },
  turtle: { id: fixed('turtle') },
  dirt: { id: fixed('dirt_3d') },
  gravel: { id: fixed('gravel') },
  sand: { id: fixed('sand') },
  teleport_blue: { id: fixed(TELEPORT_FORWARD_TILE_ID) },
  teleport_red: { id: fixed(TELEPORT_TURNING_TILE_ID) },
  push_up_wall: { id: fixed('recessed_wall') },
  appearing_wall: { id: fixed('appearing_wall_any') },
  false_wall: { id: fixed('blue_wall_fake') },
  door: { id: (layer) => `door_${need(layer.color, 'color', layer.kind)}` },
  toggle_door: { id: toggleDoorId, colored: true },
  toggle_control: {
    id: (layer) => {
      const color = need(layer.color, 'color', layer.kind);
      return color === GREEN ? 'button_green' : `toggle_button_${color}`;
    },
    colored: true
  },
  hold_door: {
    id: (layer, context) => {
      const color = need(layer.color, 'color', layer.kind);
      return `hold_door_${color}_${context.holdOpen[color] ? 'open' : 'closed'}`;
    },
    colored: true
  },
  plate: { id: (layer) => `pressure_plate_${need(layer.color, 'color', layer.kind)}`, colored: true },
  trap: { id: fixed(TRAP_ID) },
  trap_control: { id: fixed(BUTTON_BROWN_ID) },
  clone_machine: { id: fixed(CLONE_MACHINE_ID) },
  clone_switch: { id: fixed(BUTTON_RED_ID) },
  golem_control_blue: { id: fixed('button_blue') },
  golem_control_yellow: { id: fixed('puppet_control') },
  laser_controller: { id: fixed(SHOT_TRIGGER_ID) },
  bomb: { id: fixed(BOMB_ITEM_ID) },
  gate_tools: { id: fixed('thief') },
  gate_keys: { id: fixed('thief_keys') }
};

const ITEM_RULES: Record<Cc3dItemKind, (item: Cc3dItem) => string> = {
  fish: fixed(CHIP_ITEM_ID),
  fish_extra: fixed(CHIP_ITEM_ID),
  key: (item) => `key_${need(item.color, 'color', item.kind)}`,
  orb_ice: fixed('boots_ice'),
  orb_force: fixed('boots_force'),
  orb_fire: fixed('boots_fire'),
  orb_water: fixed('boots_water'),
  orb_speed: fixed(SLOW_TIME_ITEM_ID)
};

/** The one-sided mirror Epoxy uses for a reflector, by the two letters of its stored name (its reflecting faces). */
const REFLECTOR_IDS: Readonly<Record<string, string>> = {
  LU: 'one_sided_mirror_sw',
  DL: 'one_sided_mirror_nw',
  UR: 'one_sided_mirror_se',
  RD: 'one_sided_mirror_ne'
};

type ConvertibleMobKind = Exclude<Cc3dMobKind, 'shot'>;

interface MobRule {
  /** The Epoxy entity type; null for a shooter, which becomes terrain. */
  type: ((mob: Cc3dMob) => string) | null;
  /** Quarter turns clockwise added to the facing at placement. */
  turns?: number;
  /** The coverage key carries the colour of the mob. */
  colored?: true;
}

const MOB_RULES: Record<ConvertibleMobKind, MobRule> = {
  block_dirt: { type: fixed('dirt_block_3d') },
  block_ice: { type: fixed('ice_block_3d') },
  block_color: { type: (mob) => `color_block_${need(mob.color, 'color', mob.kind)}`, colored: true },
  reflector: {
    type: (mob) => {
      const id = REFLECTOR_IDS[need(mob.mirror, 'mirror', mob.kind).toUpperCase()];
      return need(id, 'a known mirror', mob.kind);
    }
  },
  walker: { type: fixed('walker_3d') },
  legs_green: { type: fixed('legs_green') },
  legs_red: { type: fixed('legs_red') },
  blinky: { type: fixed('blinky') },
  baby_blinky: { type: fixed('baby_blinky') },
  limpa: { type: fixed('limpa') },
  limpy: { type: fixed('limpy') },
  bouncer: { type: fixed('bouncer') },
  omni: { type: fixed('omni') },
  screamer: { type: fixed('screamer') },
  baby_screamer: { type: fixed('baby_screamer') },
  snappy: { type: fixed('snappy') },
  nibble: { type: fixed('nibble') },
  golem_blue: { type: fixed('golem_blue') },
  golem_yellow: { type: fixed('golem_yellow') },
  laser_shooter: { type: null },
  bot_static: { type: fixed('turret_fixed') },
  // Epoxy makes no turn at the first step, so a rotating turret is placed one quarter turn ahead.
  bot_cw: { type: fixed('turret_cw'), turns: QUARTER_TURN_CLOCKWISE },
  bot_ccw: { type: fixed('turret_ccw'), turns: QUARTER_TURN_COUNTER_CLOCKWISE },
  bot_multi: { type: fixed('turret_multi') }
};

/** Coverage keys the cell logic handles on top of the per-kind rules. */
const STRUCTURAL_RULE_KEYS: readonly string[] = [
  KEY_STACKED_TERRAIN,
  KEY_STACKED_RUNTIME,
  KEY_PANELS_ON_NONFLOOR,
  KEY_SOCKET_RED_STACKED,
  KEY_BOMB_WITH_ITEM,
  KEY_CLONE_SWITCH_EMPTY,
  KEY_LASER_SHOOTER_COVERED,
  KEY_TRAP_UNWORKED,
  KEY_GRAVEL_WITH_REFLECTOR,
  KEY_ORBS_OVER_CAP,
  KEY_APPEARING_WALL_WITH_MONSTER,
  KEY_APPEARING_WALL_WITH_SLIDE,
  KEY_MONSTERS_MEET
];

/** Every coverage key the converter has a rule for (drift-tested against EPOXY_COVERAGE). */
export function converterRuleKeys(): string[] {
  const keys = new Set<string>(STRUCTURAL_RULE_KEYS);
  for (const [kind, rule] of Object.entries(TERRAIN_RULES)) {
    if (rule.colored) for (const color of CC3D_COLORS) keys.add(`${kind}_${color}`);
    else keys.add(kind);
  }
  for (const kind of Object.keys(ITEM_RULES)) keys.add(kind);
  for (const [kind, rule] of Object.entries(MOB_RULES)) {
    if (rule.colored) for (const color of CC3D_COLORS) keys.add(`${kind}_${color}`);
    else keys.add(kind);
  }
  return [...keys].sort();
}

// ---------------------------------------------------------------------- helpers

function terrainOf(layer: Cc3dTerrain, context: RuleContext): string {
  return TERRAIN_RULES[layer.kind].id(layer, context);
}

function entityTypeOf(mob: Cc3dMob): string {
  const rule = MOB_RULES[mob.kind as ConvertibleMobKind];
  if (!rule || rule.type === null) throw new Error(`CC3D converter: ${mob.kind} has no entity type`);
  return rule.type(mob);
}

function placedDir(mob: Cc3dMob): Direction {
  const turns = MOB_RULES[mob.kind as ConvertibleMobKind]?.turns ?? 0;
  return turns === 0 ? mob.dir : turnClockwise(mob.dir, turns);
}

function isSocketKind(kind: Cc3dTerrainKind): boolean {
  return kind === 'socket' || kind === 'socket_red';
}

/**
 * Whether something standing on a plate of the colour presses it once converted. Epoxy settles its hold doors at
 * load by its own rule, so the state written here is the engine's: the mapped Epoxy entity presses or not
 * (`entityPressesPlate`), whatever CC3D would do with the original.
 */
function pressesPlate(mob: Cc3dMob, color: Cc3dColor): boolean {
  if (MOB_RULES[mob.kind as ConvertibleMobKind]?.type == null) return false;
  const type = entityTypeOf(mob);
  const kind = ConfigRegistry.getEntityDef(type)?.kind;
  return kind !== undefined && entityPressesPlate(type, kind, color);
}

/** For each colour: do the hold doors start open, that is, is every plate of the colour pressed at load. */
function holdDoorsOpenAtLoad(level: Cc3dLevel): Record<Cc3dColor, boolean> {
  const open: Record<Cc3dColor, boolean> = { red: false, green: false, blue: false, yellow: false };
  const plates = indicesWithLayer(level.cells, 'plate');
  for (const color of CC3D_COLORS) {
    let total = NO_PLATES;
    let pressed = NO_PLATES;
    for (const index of plates) {
      if (level.cells[index].terrain.find((layer) => layer.kind === 'plate')?.color !== color) continue;
      total += 1;
      const x = index % level.width;
      const y = Math.floor(index / level.width);
      const playerHere = level.player.x === x && level.player.y === y;
      if (playerHere || level.mobs.some((mob) => mob.x === x && mob.y === y && pressesPlate(mob, color))) pressed += 1;
    }
    open[color] = holdDoorWanted(total, pressed);
  }
  return open;
}

function thinWallIdOf(panels: readonly Direction[]): string {
  return displayTerrainId({ terrain: [{ kind: PLAIN_FLOOR }], panels: [...panels], item: null });
}

function nonFloor(layers: readonly Cc3dTerrain[]): Cc3dTerrain[] {
  return layers.filter((layer) => layer.kind !== PLAIN_FLOOR);
}

// ------------------------------------------------------------------- the cells

interface ConvertedCell {
  terrain: string;
  item: string | null;
  underlay: string | null;
  edges: Direction[];
}

/**
 * The layers of a cell once a run of sockets (blockers are kept in input order, so they are adjacent) is one
 * plain socket: the lower ones are never seen. The colour of the top socket of the run still decides which Epoxy
 * tile is placed (see convertCell).
 */
function reduceLayers(layers: readonly Cc3dTerrain[]): Cc3dTerrain[] {
  const kept: Cc3dTerrain[] = [];
  let socketsInRun = 0;
  for (const layer of layers) {
    if (!isSocketKind(layer.kind)) {
      socketsInRun = 0;
      kept.push(layer);
      continue;
    }
    socketsInRun += 1;
    if (socketsInRun === 1) kept.push(layer);
    else kept[kept.length - 1] = { kind: 'socket' };
  }
  return kept;
}

function convertCell(
  cell: Cc3dCell,
  shooter: Cc3dMob | undefined,
  context: RuleContext,
  drop: (key: string) => void
): ConvertedCell {
  const edges = SIDE_ORDER.filter((side) => cell.panels.includes(side));
  if (shooter !== undefined) {
    // The inert ground under a shooter (SHOOTER_INERT_KINDS) is dropped without a loss: nothing in CC3D acts on it.
    if (isShooterCovered(cell)) drop(KEY_LASER_SHOOTER_COVERED);
    return { terrain: `${SHOT_LAUNCHER_PREFIX}${shooter.dir.toLowerCase()}`, item: null, underlay: null, edges };
  }

  let layers = cell.terrain.filter((layer) => layer.kind !== 'bomb');
  let item = cell.item === null ? null : ITEM_RULES[cell.item.kind](cell.item);
  if (layers.length !== cell.terrain.length) {
    if (cell.item === null) item = BOMB_ITEM_ID;
    else drop(KEY_BOMB_WITH_ITEM);
  }
  const sourceTop = layers[layers.length - 1];
  layers = reduceLayers(layers);
  const top = layers[layers.length - 1];
  const kind = classifyStack({ terrain: layers, panels: [], item: cell.item });
  let underlay: string | null = null;
  if (kind === 'underlay') underlay = terrainOf(nonFloor(layers)[0], context);
  // A run of sockets is one socket of the colour of its top one: a red top keeps the player-only socket.
  const terrain = sourceTop?.kind === 'socket_red' && top.kind === 'socket' ? SOCKET_TILE_ID : terrainOf(top, context);
  if (terrain === FLOOR_ID && edges.length > 0) return { terrain: thinWallIdOf(edges), item, underlay, edges: [] };
  return { terrain, item, underlay, edges };
}

// ------------------------------------------------------------------- the links

interface LinkInput {
  level: Cc3dLevel;
  terrain: string[][];
  underlays: Map<number, string>;
  /** Mob index -> true when the mob became a launcher. */
  launchers: ReadonlySet<number>;
  drop: (key: string, x: number, y: number) => void;
}

function terrainAt(input: LinkInput, index: number): string {
  const { width } = input.level;
  return input.terrain[Math.floor(index / width)][index % width];
}

function hasDevice(input: LinkInput, index: number, id: string): boolean {
  return terrainAt(input, index) === id || input.underlays.get(index) === id;
}

function pointOf(input: LinkInput, index: number): { x: number; y: number } {
  return { x: index % input.level.width, y: Math.floor(index / input.level.width) };
}

function buildTrapLinks(input: LinkInput): TrapLink[] {
  const links: TrapLink[] = [];
  const worked = new Set<number>();
  const trapLinks = cc3dLinks(input.level).trapControls;
  for (const link of trapLinks) if (link.to !== null) worked.add(link.to);
  input.level.cells.forEach((cell, index) => {
    // A map without any trap control keeps the plain trap: it stays shut in both engines (cc3dEvidenceDevices.test.ts).
    // On a map that has controls, a trap none of them works is sealed: Epoxy would open an unlinked trap with any brown button.
    if (trapLinks.length === 0 || !cell.terrain.some((layer) => layer.kind === 'trap') || worked.has(index)) return;
    const { x, y } = pointOf(input, index);
    if (input.terrain[y][x] === TRAP_ID) input.terrain[y][x] = SEALED_TRAP_ID;
    else if (input.underlays.get(index) === TRAP_ID) input.underlays.set(index, SEALED_TRAP_ID);
  });
  for (const link of trapLinks) {
    if (link.to === null) continue;
    if (terrainAt(input, link.from) !== BUTTON_BROWN_ID || terrainAt(input, link.to) !== TRAP_ID) continue;
    const button = pointOf(input, link.from);
    const trap = pointOf(input, link.to);
    links.push({ buttonX: button.x, buttonY: button.y, trapX: trap.x, trapY: trap.y });
  }
  return links;
}

/**
 * The clone machine's own direction is kept when it has one. Without one the template's start direction is used,
 * while CC3D bots were already turned at the start of play (bot behaviour is approximate anyway).
 */
function buildCloneLinks(input: LinkInput): CloneLink[] {
  const { level } = input;
  const links = cc3dLinks(level);
  const templates = new Map<number, number | null>(links.cloneMachines.map((link) => [link.from, link.to]));
  const result: CloneLink[] = [];
  for (const link of links.cloneSwitches) {
    if (link.to === null) continue;
    const templateIndex = templates.get(link.to) ?? null;
    const button = pointOf(input, link.from);
    if (templateIndex === null || level.mobs[templateIndex].kind === SHOOTER_KIND) {
      input.drop(KEY_CLONE_SWITCH_EMPTY, button.x, button.y);
      continue;
    }
    if (terrainAt(input, link.from) !== BUTTON_RED_ID || terrainAt(input, link.to) !== CLONE_MACHINE_ID) continue;
    const template = level.mobs[templateIndex];
    const machine = pointOf(input, link.to);
    const machineLayer = level.cells[link.to].terrain.find((layer) => layer.kind === 'clone_machine');
    result.push({
      buttonX: button.x,
      buttonY: button.y,
      clonerX: machine.x,
      clonerY: machine.y,
      templateType: entityTypeOf(template),
      templateDir: machineLayer?.dir ?? template.dir
    });
  }
  return result;
}

function buildLauncherLinks(input: LinkInput): LauncherLink[] {
  const kept = new Map<string, LauncherLink>();
  for (const link of cc3dLinks(input.level).laserControllers) {
    if (link.to === null || !input.launchers.has(link.to)) continue;
    if (!hasDevice(input, link.from, SHOT_TRIGGER_ID)) continue;
    const button = pointOf(input, link.from);
    const shooter = input.level.mobs[link.to];
    const entry: LauncherLink = { buttonX: button.x, buttonY: button.y, launcherX: shooter.x, launcherY: shooter.y };
    kept.set(`${entry.buttonY},${entry.buttonX},${entry.launcherY},${entry.launcherX}`, entry);
  }
  return [...kept.values()].sort(
    (a, b) => a.buttonY - b.buttonY || a.buttonX - b.buttonX || a.launcherY - b.launcherY || a.launcherX - b.launcherX
  );
}

// ------------------------------------------------------------------ the report

function buildReport(source: Cc3dLevel, drops: readonly ConversionDrop[]): ConversionReport {
  const keys = elementKeys(source);
  for (const drop of drops) keys.add(drop.key);
  const exact: string[] = [];
  const approx: ConversionReportEntry[] = [];
  const lost: ConversionReportEntry[] = [];
  for (const key of [...keys].sort()) {
    const found = EPOXY_COVERAGE[key];
    if (!found) throw new Error(`CC3D converter: no coverage entry for ${key}`);
    if (found.level === 'exact') exact.push(key);
    else if (found.level === 'approx') approx.push({ key, reason: found.reason });
    else lost.push({ key, reason: found.reason });
  }
  return { exact, approx, lost, drops: [...drops] };
}

// -------------------------------------------------------------------- the level

/** Converts a CC3D level; throws when it carries no cc3d data. */
export function convertCc3dLevel(source: CompiledLevel): ConversionResult {
  const cc3d = source.cc3d;
  if (!cc3d) throw new Error(`CC3D converter: level ${source.id} carries no cc3d data`);
  const { width, height } = cc3d;
  const context: RuleContext = { holdOpen: holdDoorsOpenAtLoad(cc3d) };
  const drops: ConversionDrop[] = [];
  const seenDrops = new Set<string>();
  const recordDrop = (key: string, x: number, y: number): void => {
    const id = `${key}@${x},${y}`;
    if (seenDrops.has(id)) return;
    seenDrops.add(id);
    drops.push({ key, x, y });
  };

  // The first shooter of a cell becomes its launcher; another one in the same cell is dropped.
  const shooters = new Map<number, Cc3dMob>();
  const launchers = new Set<number>();
  cc3d.mobs.forEach((mob, index) => {
    if (mob.kind !== SHOOTER_KIND) return;
    const cellIndex = mob.y * width + mob.x;
    if (shooters.has(cellIndex)) recordDrop(KEY_LASER_SHOOTER_COVERED, mob.x, mob.y);
    else {
      shooters.set(cellIndex, mob);
      launchers.add(index);
    }
  });

  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  const underlays = new Map<number, string>();
  const edges: CellEdge[] = [];
  let plainFish = 0;
  let hasSocket = false;
  for (let y = 0; y < height; y++) {
    const terrainRow: string[] = [];
    const itemRow: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const cell = cc3d.cells[index];
      const converted = convertCell(cell, shooters.get(index), context, (key) => recordDrop(key, x, y));
      terrainRow.push(converted.terrain);
      itemRow.push(converted.item);
      if (converted.item !== null && cell.item?.kind === 'fish') plainFish += 1;
      if (converted.underlay !== null) underlays.set(index, converted.underlay);
      if (converted.edges.length > 0) edges.push({ x, y, sides: converted.edges });
      if (SOCKET_TILE_IDS.has(converted.terrain) || (converted.underlay !== null && SOCKET_TILE_IDS.has(converted.underlay))) hasSocket = true;
    }
    terrain.push(terrainRow);
    items.push(itemRow);
  }

  const entities: EntityPlacement[] = [];
  for (const mob of cc3d.mobs) {
    if (mob.kind === SHOOTER_KIND || mob.kind === 'shot') continue;
    entities.push({ x: mob.x, y: mob.y, type: entityTypeOf(mob), dir: placedDir(mob) });
  }

  const input: LinkInput = { level: cc3d, terrain, underlays, launchers, drop: recordDrop };
  const trapLinks = buildTrapLinks(input);
  const cloneLinks = buildCloneLinks(input);
  const launcherLinks = buildLauncherLinks(input);

  const level: CompiledLevel = {
    id: `${source.id}${CONVERTED_ID_SUFFIX}`,
    ruleset: EPOXY_RULESET,
    number: source.number,
    ...(source.customTitle !== undefined ? { customTitle: source.customTitle } : {}),
    ...(source.customHint !== undefined ? { customHint: source.customHint } : {}),
    ...(source.author !== undefined ? { author: source.author } : {}),
    password: source.password,
    timeLimitSeconds: 0,
    // The Epoxy engine never checks chips at the exit; only the validator does (LevelValidator), which is why
    // a level without a socket needs chipsRequired 0 while CC3D asks for the fish at the socket only.
    chipsRequired: hasSocket ? plainFish : 0,
    playerStart: { x: cc3d.player.x, y: cc3d.player.y, dir: cc3d.player.dir ?? DEFAULT_PLAYER_DIR },
    terrain,
    items,
    entities,
    trapLinks,
    cloneLinks
  };
  if (edges.length > 0) level.cellEdges = edges;
  if (underlays.size > 0) {
    level.underlays = [...underlays.keys()]
      .sort((a, b) => a - b)
      .map((index): CellUnderlay => ({ x: index % width, y: Math.floor(index / width), terrain: underlays.get(index) as string }));
  }
  if (launcherLinks.length > 0) level.launcherLinks = launcherLinks;
  return { level, report: buildReport(cc3d, drops) };
}
