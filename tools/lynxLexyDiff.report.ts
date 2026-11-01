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
 * Differential test of Epoxy's Lynx engine against an external Lynx-compatible
 * implementation that lives outside the repository. Both engines load the same
 * DAT bytes and receive the same deterministic input script. After every tick
 * the harness compares Chip, completion, chips left, creatures and the terrain
 * of Chip's cell, and records the first divergence of each level.
 *
 * The other implementation is loaded from the directory given by the
 * EPOXY_LEXY_DIR environment variable; nothing of it is copied here.
 *
 * Tick alignment: one advance of the other engine (one call of its tic
 * function) is one Epoxy tick. For tick t the direction scripted for t is
 * written as the held direction of Epoxy (holdPlayerDirection) just before
 * tick(), and as the input bit mask of the other engine for the same advance.
 * Both engines therefore read the same direction at the moment Chip decides,
 * and "tick N" in the report means "after N advances of each engine".
 *
 * Run with: EPOXY_LEXY_DIR=<path> npm run report:lexy-diff
 * Output: local/lexy-diff/report.md and local/lexy-diff/report.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audio/AudioManager', () => import('../src/test/silentAudio'));

import { LynxEngine } from '../src/core/lynx/LynxEngine';
import { lynxLevel, monster } from '../src/core/lynx/lynxTestMaps';
import { CompiledLevel, Direction } from '../src/core/types';
import { DatCodec } from '../src/formats/DatCodec';
import { loadTestConfigs } from '../src/test/loadTestConfigs';

// ----------------------------------------------------------------- constants

const ENV_LEXY_DIR = 'EPOXY_LEXY_DIR';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(ROOT, 'local', 'lexy-diff');
const REPORT_MD = resolve(OUTPUT_DIR, 'report.md');
const REPORT_JSON = resolve(OUTPUT_DIR, 'report.json');

/** The report covers every level of five packs and takes a few minutes. */
const REPORT_TIMEOUT_MS = 1_800_000;

const PACK_FILES = ['TW_INTRO.DAT', 'CCLP1.DAT', 'CCLP3.DAT', 'CCLP4.DAT', 'CCLP5.DAT'];
const PACK_DIR = resolve(ROOT, 'public', 'packs');
const PACK_RULESET = 'lynx';
const LEXY_RULESET = 'lynx';

/** Longest run per level: 60 seconds at 20 ticks per second. */
const MAX_TICKS = 1200;
const TICKS_PER_SECOND = 20;
const HAND_CHECK_TICKS = 80;

/** Script: a held direction lasts this many ticks. */
const HOLD_MIN_TICKS = 4;
const HOLD_MAX_TICKS = 16;
/** Script: a wait lasts this many ticks. */
const WAIT_MIN_TICKS = 2;
const WAIT_MAX_TICKS = 8;
/** Script: one segment out of this many is a wait. */
const WAIT_ONE_IN = 5;
const SEED_MIX = 0x9e3779b1;
const LAST_INPUTS_SHOWN = 8;
const UINT32_RANGE = 4294967296;

/** Radius of the window printed around Chip (2 gives 5 by 5). */
const WINDOW_RADIUS = 2;
/** Radius of the neighbourhood searched for the rule guess (1 gives 3 by 3). */
const NEAR_RADIUS = 1;
const FIRST_DIVERGENCE_BUCKETS: ReadonlyArray<{ label: string; upTo: number }> = [
  { label: '0-20', upTo: 20 },
  { label: '21-100', upTo: 100 },
  { label: '101-400', upTo: 400 },
  { label: '401-1200', upTo: MAX_TICKS }
];

const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const LEXY_INPUT_BIT: Record<Direction, number> = { N: 0x10, E: 0x08, S: 0x02, W: 0x04 };

/** Names of the other engine mapped to Epoxy ids; anything else passes through. */
const CREATURE_NAME_MAP: Record<string, string> = {
  ball: 'pink_ball',
  tank_blue: 'tank',
  tank_yellow: 'tank'
};
/**
 * The other engine turns the shared random force floor direction after using it, Epoxy and the
 * reference turn it before: starting one step earlier (east instead of north) lines them up.
 */
const LEXY_FORCE_FLOOR_START = 'east';
/** Divergence classes: a real rule difference, or both engines killed Chip in the same tick. */
const CLASS_RULE = 'rule difference';
const CLASS_REPORTING = 'reporting only';
const CHIP_MARK = 'CHIP';
const BLOCK_TYPES = new Set(['dirt_block', 'ice_block']);
const RANDOM_MONSTERS =new Set(['walker', 'blob']);
const RANDOM_FORCE_TILE = 'force_random';

/** Families used to guess the rule behind a divergence, most specific first. */
const RULE_FAMILIES: ReadonlyArray<{ pattern: RegExp; guess: string }> = [
  { pattern: /clone/, guess: 'clone machine release or cloning order' },
  { pattern: /trap/, guess: 'trap and brown button behaviour' },
  { pattern: /teleport/, guess: 'teleporter rules (destination search or exit blocking)' },
  { pattern: /force/, guess: 'force floor sliding or override' },
  { pattern: /ice/, guess: 'ice sliding and corner turns' },
  { pattern: /button|toggle/, guess: 'button press timing or toggle walls' },
  { pattern: /water|fire|flame|bomb/, guess: 'hazard handling (water, fire, bomb)' },
  { pattern: /recessed|popwall|pop/, guess: 'recessed wall timing' },
  { pattern: /thin|blue_wall|fake|invisible|appearing/, guess: 'thin wall or hidden wall collision' },
  { pattern: /thief/, guess: 'thief tile' },
  { pattern: /door|key|socket/, guess: 'door, key or socket handling' },
  { pattern: /dirt|gravel/, guess: 'dirt or gravel clearing' }
];

// --------------------------------------------------------------------- types

interface InputStep {
  dir: Direction | null;
}

interface Snapshot {
  chipX: number;
  chipY: number;
  alive: boolean;
  complete: boolean;
  chipsLeft: number;
  /** Sorted "type@x,y" strings of monsters and blocks. */
  creatures: string[];
  /** True when the terrain of Chip's cell differs from the start of the level. */
  terrainChanged: boolean;
  chipTerrain: string;
  /** Window around the requested center, rows of cell strings. */
  window: string[][];
}

interface Engine {
  advance(dir: Direction | null): void;
  snapshot(centerX: number, centerY: number): Snapshot;
  /** True when the engine can no longer be advanced. */
  finished(): boolean;
}

interface Divergence {
  tick: number;
  fields: string[];
  epoxy: Snapshot;
  lexy: Snapshot;
  lastInputs: string[];
  guess: string;
  /** CLASS_REPORTING when both engines killed Chip in this tick, CLASS_RULE otherwise. */
  kind: string;
}

interface LevelResult {
  pack: string;
  index: number;
  number: number;
  title: string;
  randomMonsters: boolean;
  ticksCompared: number;
  endedBy: string;
  divergence: Divergence | null;
  error?: string;
}

interface HandResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface LexyStored {
  number: number;
  title?: string;
}

interface LexyTile {
  type: { name: string; is_monster?: boolean; is_block?: boolean; ttl?: number };
  direction?: string;
  cell: LexyCell | null;
}

interface LexyCell extends Array<LexyTile | null> {
  x: number;
  y: number;
  get_terrain(): LexyTile | null;
  get_item(): LexyTile | null;
}

interface LexyLevel {
  state: string;
  width: number;
  height: number;
  player: LexyTile;
  actors: LexyTile[];
  chips_remaining: number;
  linear_cells: LexyCell[];
  force_floor_direction: string;
  step_parity: number;
  undo_enabled: boolean;
  sfx: unknown;
  _tw_rng: number;
  _rng1: number;
  _rng2: number;
  advance_tic(input: number): void;
  fail(...args: unknown[]): void;
}

interface LexyModules {
  Level: new (stored: LexyStored, compat: Record<string, boolean>) => LexyLevel;
  parseGame: (buffer: ArrayBuffer) => { load_level(index: number): LexyStored };
  compat: Record<string, boolean>;
}

// --------------------------------------------------------------- input script

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

function intBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** The same script for both engines: held directions for 4 to 16 ticks, some waits. */
function buildScript(levelNumber: number, length: number): InputStep[] {
  const random = mulberry32(Math.imul(levelNumber, SEED_MIX) ^ SEED_MIX);
  const script: InputStep[] = [];
  while (script.length < length) {
    const wait = random() * WAIT_ONE_IN < 1;
    const duration = wait
      ? intBetween(random, WAIT_MIN_TICKS, WAIT_MAX_TICKS)
      : intBetween(random, HOLD_MIN_TICKS, HOLD_MAX_TICKS);
    const dir = wait ? null : DIRECTIONS[intBetween(random, 0, DIRECTIONS.length - 1)];
    for (let i = 0; i < duration && script.length < length; i++) script.push({ dir });
  }
  return script;
}

// --------------------------------------------------------------- engine sides

const SILENT_SOUND = { effect: () => undefined, step: () => undefined };

function cellText(terrain: string, item: string | null, creature: string | null): string {
  return `${terrain}${item ? `+${item}` : ''}${creature ? `[${creature}]` : ''}`;
}

function buildWindow(read: (x: number, y: number) => string | null, cx: number, cy: number): string[][] {
  const rows: string[][] = [];
  for (let y = cy - WINDOW_RADIUS; y <= cy + WINDOW_RADIUS; y++) {
    const row: string[] = [];
    for (let x = cx - WINDOW_RADIUS; x <= cx + WINDOW_RADIUS; x++) row.push(read(x, y) ?? 'OUT');
    rows.push(row);
  }
  return rows;
}

function epoxySide(level: CompiledLevel, seed: number): Engine {
  const engine = new LynxEngine(SILENT_SOUND);
  engine.loadLevel(level, seed);
  const initialTerrain = engine.getTerrain().map((row) => [...row]);
  return {
    advance(dir) {
      engine.holdPlayerDirection(dir);
      engine.tick();
    },
    finished() {
      return !engine.getPlayer().alive || engine.isLevelCompleted();
    },
    snapshot(cx, cy) {
      const player = engine.getPlayer();
      const terrain = engine.getTerrain();
      const items = engine.getItems();
      const entities = engine.getEntities();
      const at = (x: number, y: number): string | null => {
        const t = terrain[y]?.[x];
        if (t === undefined) return null;
        const here = entities.find((e) => e.x === x && e.y === y);
        const chip = player.x === x && player.y === y ? CHIP_MARK : null;
        const who = [here ? `${here.type}:${here.dir}` : null, chip].filter(Boolean).join(',');
        return cellText(t, items[y]?.[x] ?? null, who || null);
      };
      return {
        chipX: player.x,
        chipY: player.y,
        alive: player.alive,
        complete: engine.isLevelCompleted(),
        chipsLeft: engine.getChipsRemaining(),
        creatures: entities.map((e) => `${e.type}@${e.x},${e.y}`).sort(),
        terrainChanged: terrain[player.y]?.[player.x] !== initialTerrain[player.y]?.[player.x],
        chipTerrain: terrain[player.y]?.[player.x] ?? '',
        window: buildWindow(at, cx, cy)
      };
    }
  };
}

function normalizeName(name: string): string {
  return CREATURE_NAME_MAP[name] ?? name;
}

function lexySide(modules: LexyModules, stored: LexyStored, seed: number): Engine {
  const level = new modules.Level(stored, modules.compat);
  level.sfx = { play() {}, play_once() {} };
  level.undo_enabled = false;
  level.force_floor_direction = LEXY_FORCE_FLOOR_START;
  level.step_parity = 0;
  level._tw_rng = seed;
  level._rng1 = 0;
  level._rng2 = 0;
  const cellOf = (x: number, y: number): LexyCell | null =>
    x >= 0 && y >= 0 && x < level.width && y < level.height ? level.linear_cells[y * level.width + x] : null;
  const initialTerrain = level.linear_cells.map((cell) => cell.get_terrain()?.type.name ?? '');
  let lastChip = { x: level.player.cell?.x ?? 0, y: level.player.cell?.y ?? 0 };
  // A dead Chip still completes his step in the other engine: his cell is recorded when the level is failed.
  const originalFail = level.fail.bind(level);
  level.fail = (...args: unknown[]): void => {
    if (level.state === 'playing' && level.player.cell) {
      lastChip = { x: level.player.cell.x, y: level.player.cell.y };
    }
    originalFail(...args);
  };
  let failed = false;
  const creatureList = (): Array<{ name: string; x: number; y: number; dir: string }> => {
    const found: Array<{ name: string; x: number; y: number; dir: string }> = [];
    for (const actor of level.actors) {
      if (!actor.cell || actor.type.ttl) continue;
      if (!actor.type.is_monster && !actor.type.is_block) continue;
      found.push({ name: normalizeName(actor.type.name), x: actor.cell.x, y: actor.cell.y, dir: actor.direction ?? '' });
    }
    return found;
  };
  return {
    advance(dir) {
      level.advance_tic(dir === null ? 0 : LEXY_INPUT_BIT[dir]);
    },
    finished() {
      return level.state !== 'playing';
    },
    snapshot(cx, cy) {
      failed = failed || level.state === 'failure';
      if (!failed && level.player.cell) lastChip = { x: level.player.cell.x, y: level.player.cell.y };
      const creatures = creatureList();
      const at = (x: number, y: number): string | null => {
        const cell = cellOf(x, y);
        if (!cell) return null;
        const here = creatures.find((c) => c.x === x && c.y === y);
        const chip = lastChip.x === x && lastChip.y === y ? CHIP_MARK : null;
        const who = [here ? `${here.name}:${here.dir}` : null, chip].filter(Boolean).join(',');
        const itemName = cell.get_item()?.type.name ?? null;
        return cellText(cell.get_terrain()?.type.name ?? '', itemName, who || null);
      };
      const chipTerrain = cellOf(lastChip.x, lastChip.y)?.get_terrain()?.type.name ?? '';
      return {
        chipX: lastChip.x,
        chipY: lastChip.y,
        alive: level.state !== 'failure',
        complete: level.state === 'success',
        chipsLeft: Math.max(0, level.chips_remaining),
        creatures: creatures.map((c) => `${c.name}@${c.x},${c.y}`).sort(),
        terrainChanged: chipTerrain !== initialTerrain[lastChip.y * level.width + lastChip.x],
        chipTerrain,
        window: buildWindow(at, cx, cy)
      };
    }
  };
}

// ------------------------------------------------------------------ comparing

function differingFields(a: Snapshot, b: Snapshot): string[] {
  const fields: string[] = [];
  if (a.chipX !== b.chipX || a.chipY !== b.chipY) fields.push('chipCell');
  if (a.alive !== b.alive) fields.push('alive');
  if (a.complete !== b.complete) fields.push('complete');
  if (a.chipsLeft !== b.chipsLeft) fields.push('chipsLeft');
  // Once Chip is dead in either engine the creature lists are not comparable: the killer is
  // removed or kept depending on how each engine records the death.
  const chipDead = !a.alive || !b.alive;
  if (!chipDead && a.creatures.join('|') !== b.creatures.join('|')) fields.push('creatures');
  if (a.terrainChanged !== b.terrainChanged) fields.push('chipCellTerrainChanged');
  return fields;
}

function familyOf(names: string[]): string | null {
  for (const family of RULE_FAMILIES) {
    if (names.some((name) => family.pattern.test(name))) return family.guess;
  }
  return null;
}

/** Terrain and item names of the 3x3 cells around the center of a window. */
function nearNames(snap: Snapshot): string[] {
  const names: string[] = [];
  for (let dy = -NEAR_RADIUS; dy <= NEAR_RADIUS; dy++) {
    for (let dx = -NEAR_RADIUS; dx <= NEAR_RADIUS; dx++) {
      const cell = snap.window[WINDOW_RADIUS + dy]?.[WINDOW_RADIUS + dx] ?? '';
      names.push(...cell.split('[')[0].split('+'));
    }
  }
  return names;
}

/** Monster types (not blocks) standing in the window of a snapshot. */
function monstersInWindow(snap: Snapshot): string[] {
  const found: string[] = [];
  for (const row of snap.window) {
    for (const cell of row) {
      const inside = cell.split('[')[1]?.replace(']', '') ?? '';
      for (const part of inside.split(',')) {
        const type = part.split(':')[0];
        if (type !== '' && type !== CHIP_MARK && !BLOCK_TYPES.has(type)) found.push(type);
      }
    }
  }
  return found;
}

function guessRule(epoxy: Snapshot, lexy: Snapshot, fields: string[], inputs: string[]): string {
  const killers = [...new Set([...monstersInWindow(epoxy), ...monstersInWindow(lexy)])];
  if ((!epoxy.alive || !lexy.alive) && killers.length > 0) {
    return `Chip death versus ${killers.join('/')}: kill or collision timing (epoxy alive=${epoxy.alive}, other alive=${lexy.alive})`;
  }
  const own = familyOf([epoxy.chipTerrain, lexy.chipTerrain]);
  if (own) return `${own} (on Chip's cell)`;
  const near = familyOf([...nearNames(epoxy), ...nearNames(lexy)]);
  if (fields.includes('creatures')) {
    const types = new Set([...differentCreatures(epoxy, lexy), ...differentCreatures(lexy, epoxy)].map((c) => c.split('@')[0]));
    return `${[...types].join('/')} position differs${near ? `, near ${near}` : ''}`;
  }
  if (near) return `${near} (next to Chip)`;
  return `plain movement or timing (last input ${inputs[inputs.length - 1] ?? 'none'})`;
}

function differentCreatures(a: Snapshot, b: Snapshot): string[] {
  return a.creatures.filter((c) => !b.creatures.includes(c));
}

function creatureDiff(a: Snapshot, b: Snapshot): string {
  const only = (x: string[], y: string[]): string[] => x.filter((c) => !y.includes(c));
  return `epoxy only: ${only(a.creatures, b.creatures).join(' ') || '-'}; other only: ${only(b.creatures, a.creatures).join(' ') || '-'}`;
}

interface PairInput {
  epoxy: Engine;
  lexy: Engine;
  script: InputStep[];
  maxTicks: number;
}

function comparePair(pair: PairInput): { divergence: Divergence | null; ticksCompared: number; endedBy: string } {
  const sent: string[] = [];
  const check = (tick: number): Divergence | null => {
    const probe = pair.epoxy.snapshot(0, 0);
    const epoxy = pair.epoxy.snapshot(probe.chipX, probe.chipY);
    const lexy = pair.lexy.snapshot(probe.chipX, probe.chipY);
    const fields = differingFields(epoxy, lexy);
    if (fields.length === 0) return null;
    return {
      tick,
      fields,
      epoxy,
      lexy,
      lastInputs: sent.slice(-LAST_INPUTS_SHOWN),
      guess: guessRule(epoxy, lexy, fields, sent),
      kind: !epoxy.alive && !lexy.alive ? CLASS_REPORTING : CLASS_RULE
    };
  };
  const initial = check(0);
  if (initial) return { divergence: initial, ticksCompared: 0, endedBy: 'diverged at load' };
  for (let t = 0; t < pair.maxTicks; t++) {
    const dir = pair.script[t]?.dir ?? null;
    sent.push(dir ?? '.');
    pair.epoxy.advance(dir);
    pair.lexy.advance(dir);
    const found = check(t + 1);
    if (found) return { divergence: found, ticksCompared: t + 1, endedBy: 'diverged' };
    if (pair.epoxy.finished() || pair.lexy.finished()) {
      const done = pair.epoxy.snapshot(0, 0);
      return { divergence: null, ticksCompared: t + 1, endedBy: done.complete ? 'level completed' : 'Chip died' };
    }
  }
  return { divergence: null, ticksCompared: pair.maxTicks, endedBy: 'tick limit' };
}

// ------------------------------------------------------------------- loading

async function loadLexy(dir: string): Promise<LexyModules> {
  const load = (file: string): Promise<Record<string, unknown>> =>
    import(/* @vite-ignore */ pathToFileURL(resolve(dir, 'js', file)).href);
  const defs = await load('defs.js');
  const game = await load('game.js');
  const formatDat = await load('format-dat.js');
  return {
    Level: game.Level as LexyModules['Level'],
    parseGame: formatDat.parse_game as LexyModules['parseGame'],
    compat: (defs.compat_flags_for_ruleset as (r: string) => Record<string, boolean>)(LEXY_RULESET)
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hasRandomMonsters(level: CompiledLevel): boolean {
  if (level.entities.some((e) => RANDOM_MONSTERS.has(e.type))) return true;
  return level.terrain.some((row) => row.includes(RANDOM_FORCE_TILE));
}

function tickBudget(level: CompiledLevel): number {
  if (level.timeLimitSeconds <= 0) return MAX_TICKS;
  return Math.min(MAX_TICKS, level.timeLimitSeconds * TICKS_PER_SECOND - 1);
}

// ------------------------------------------------------------------- hand checks

interface HandCheck {
  name: string;
  level: CompiledLevel;
  script: InputStep[];
}

function repeat(dir: Direction | null, count: number): InputStep[] {
  return Array.from({ length: count }, () => ({ dir }));
}

function handChecks(): HandCheck[] {
  return [
    {
      name: 'Chip walks east on floor into a wall',
      level: lynxLevel(['#######', '#@....#', '#######']),
      script: repeat('E', HAND_CHECK_TICKS)
    },
    {
      name: 'Chip walks south, north, east, west and bumps the border',
      level: lynxLevel(['#####', '#...#', '#...#', '#@..#', '#####']),
      script: [...repeat('N', 6), ...repeat('S', 6), ...repeat('E', 12), ...repeat('W', 30)]
    },
    {
      name: 'Chip takes a chip item and reaches the exit',
      level: lynxLevel(['#######', '#@.i.X#', '#######'], { chipsRequired: 1 }),
      script: repeat('E', HAND_CHECK_TICKS)
    },
    {
      name: 'A bug walks along the walls of a room while Chip waits',
      level: lynxLevel(['#######', '#.....#', '#.....#', '#.....#', '#@....#', '#######'], {
        entities: [monster('bug', 4, 1, 'W')]
      }),
      script: repeat(null, HAND_CHECK_TICKS)
    }
  ];
}

function runHandCheck(modules: LexyModules, check: HandCheck): HandResult {
  const bytes = toArrayBuffer(DatCodec.encodeLevels([check.level]));
  const epoxyLevel = DatCodec.decodeBuffer(bytes, 'hand', PACK_RULESET)[0];
  const stored = modules.parseGame(bytes).load_level(0);
  const seed = 1;
  const result = comparePair({
    epoxy: epoxySide(epoxyLevel, seed),
    lexy: lexySide(modules, stored, seed),
    script: check.script,
    maxTicks: check.script.length
  });
  const d = result.divergence;
  const detail = d
    ? `diverged at tick ${d.tick}: ${d.fields.join(', ')} (epoxy chip ${d.epoxy.chipX},${d.epoxy.chipY}; other chip ${d.lexy.chipX},${d.lexy.chipY}; ${creatureDiff(d.epoxy, d.lexy)})`
    : `identical for ${result.ticksCompared} ticks (${result.endedBy})`;
  return { name: check.name, ok: d === null, detail };
}

// ------------------------------------------------------------------- reporting

function bucketOf(tick: number): string {
  return (FIRST_DIVERGENCE_BUCKETS.find((b) => tick <= b.upTo) ?? FIRST_DIVERGENCE_BUCKETS[FIRST_DIVERGENCE_BUCKETS.length - 1]).label;
}

function windowText(snapshot: Snapshot): string {
  return snapshot.window.map((row) => row.join(' | ')).join('\n');
}

function summaryRows(results: LevelResult[]): string[] {
  const header = [
    'Pack',
    'Levels',
    'Identical',
    'Divergent',
    CLASS_RULE,
    CLASS_REPORTING,
    'Divergent with random monsters',
    'Errors',
    'Levels with random monsters',
    ...FIRST_DIVERGENCE_BUCKETS.map((b) => `First divergence at tick ${b.label}`)
  ];
  const lines = [`| ${header.join(' | ')} |`, `|${' --- |'.repeat(header.length)}`];
  const packs = [...new Set(results.map((r) => r.pack))];
  for (const pack of [...packs, 'ALL']) {
    const rows = pack === 'ALL' ? results : results.filter((r) => r.pack === pack);
    const diverged = rows.filter((r) => r.divergence);
    const counts = FIRST_DIVERGENCE_BUCKETS.map((b) => diverged.filter((r) => r.divergence && bucketOf(r.divergence.tick) === b.label).length);
    const cells = [
      pack,
      rows.length,
      rows.filter((r) => !r.divergence && !r.error).length,
      diverged.length,
      diverged.filter((r) => r.divergence?.kind === CLASS_RULE).length,
      diverged.filter((r) => r.divergence?.kind === CLASS_REPORTING).length,
      diverged.filter((r) => r.randomMonsters).length,
      rows.filter((r) => r.error).length,
      rows.filter((r) => r.randomMonsters).length,
      ...counts
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

function divergentSection(result: LevelResult, d: Divergence): string[] {
  const random = result.randomMonsters ? ' (random monsters: walkers, blobs or random force floors)' : '';
  return [
    `### ${result.pack} #${result.number} "${result.title}" - tick ${d.tick}${random}`,
    '',
    `- Class: ${d.kind}`,
    `- Differs: ${d.fields.join(', ')}`,
    `- Chip: epoxy ${d.epoxy.chipX},${d.epoxy.chipY} alive=${d.epoxy.alive} complete=${d.epoxy.complete} chipsLeft=${d.epoxy.chipsLeft}; other ${d.lexy.chipX},${d.lexy.chipY} alive=${d.lexy.alive} complete=${d.lexy.complete} chipsLeft=${d.lexy.chipsLeft}`,
    `- Terrain at Chip cell: epoxy "${d.epoxy.chipTerrain}" changed=${d.epoxy.terrainChanged}; other "${d.lexy.chipTerrain}" changed=${d.lexy.terrainChanged}`,
    `- Creatures: ${creatureDiff(d.epoxy, d.lexy)}`,
    `- Last inputs (oldest first, . is a wait): ${d.lastInputs.join(' ')}`,
    `- Rule guess: ${d.guess}`,
    '',
    `5x5 window centered on the Epoxy Chip (${d.epoxy.chipX},${d.epoxy.chipY}), Epoxy:`,
    '```',
    windowText(d.epoxy),
    '```',
    'Other engine:',
    '```',
    windowText(d.lexy),
    '```',
    ''
  ];
}

function writeReports(results: LevelResult[], hand: HandResult[]): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const divergent = results
    .filter((r): r is LevelResult & { divergence: Divergence } => r.divergence !== null)
    .sort((a, b) => a.divergence.tick - b.divergence.tick);
  const errors = results.filter((r) => r.error);
  const md = [
    '# Epoxy Lynx engine versus the external Lynx-compatible engine',
    '',
    `Script: seeded random holds of ${HOLD_MIN_TICKS} to ${HOLD_MAX_TICKS} ticks and waits of ${WAIT_MIN_TICKS} to ${WAIT_MAX_TICKS} ticks, up to ${MAX_TICKS} ticks (less for timed levels).`,
    '',
    '## Hand checks',
    '',
    ...hand.map((h) => `- ${h.ok ? 'PASS' : 'FAIL'}: ${h.name}: ${h.detail}`),
    '',
    '## Summary',
    '',
    ...summaryRows(results),
    '',
    errors.length > 0 ? `Errors: ${errors.map((e) => `${e.pack} #${e.number}: ${e.error}`).join('; ')}` : 'No level raised an error.',
    '',
    `## Divergent levels (${divergent.length}, earliest first)`,
    '',
    ...divergent.flatMap((r) => divergentSection(r, r.divergence))
  ];
  writeFileSync(REPORT_MD, `${md.join('\n')}\n`);
  writeFileSync(REPORT_JSON, `${JSON.stringify({ hand, results }, null, 2)}\n`);
}

// ------------------------------------------------------------------------- run

const lexyDir = process.env[ENV_LEXY_DIR];

describe('Lynx differential test', () => {
  if (!lexyDir) {
    console.warn(`Skipping the Lynx differential test: set ${ENV_LEXY_DIR} to the directory of the other engine.`);
    it.skip(`needs ${ENV_LEXY_DIR}`, () => undefined);
    return;
  }

  it('compares the bundled Lynx packs', { timeout: REPORT_TIMEOUT_MS }, async () => {
    loadTestConfigs();
    const modules = await loadLexy(lexyDir);

    const hand = handChecks().map((check) => runHandCheck(modules, check));
    for (const h of hand) console.log(`hand check ${h.ok ? 'PASS' : 'FAIL'}: ${h.name}: ${h.detail}`);

    const results: LevelResult[] = [];
    for (const file of PACK_FILES) {
      const buffer = toArrayBuffer(readFileSync(resolve(PACK_DIR, file)));
      const pack = file.replace(/\.DAT$/i, '');
      const levels = DatCodec.decodeBuffer(buffer, pack.toLowerCase(), PACK_RULESET);
      const lexyGame = modules.parseGame(buffer);
      for (const [index, level] of levels.entries()) {
        const base = { pack, index, number: level.number, randomMonsters: hasRandomMonsters(level) };
        try {
          const stored = lexyGame.load_level(index);
          const seed = level.number;
          const run = comparePair({
            epoxy: epoxySide(level, seed),
            lexy: lexySide(modules, stored, seed),
            script: buildScript(level.number, MAX_TICKS),
            maxTicks: tickBudget(level)
          });
          results.push({
            ...base,
            title: level.customTitle ?? stored.title ?? '',
            ticksCompared: run.ticksCompared,
            endedBy: run.endedBy,
            divergence: run.divergence
          });
        } catch (error) {
          results.push({ ...base, title: level.customTitle ?? '', ticksCompared: 0, endedBy: 'error', divergence: null, error: String(error) });
        }
      }
      console.log(`${pack}: ${levels.length} levels compared`);
    }
    writeReports(results, hand);
    expect(hand.filter((h) => !h.ok).map((h) => h.name)).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });
});
