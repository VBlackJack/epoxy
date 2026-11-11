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
 * Optional corpus check of the CC3D to Epoxy converter: runs only when CC3D_CORPUS_DIR names a directory of
 * level files (the data stays outside the repository). Prints ids and counts only, no level content.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { isCompiledLevelShape, normalizeUnderlays, sanitizeStoredLevels, stripInvalidTextFields } from '../../config/ConfigValidation';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../../formats/Cc3dXmlCodec';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { stableStringify } from '../engineSimHash';
import { GameEngine } from '../GameEngine';
import { LevelValidator } from '../LevelValidator';
import type { CompiledLevel, Direction } from '../types';
import { convertCc3dLevel } from './cc3dToEpoxy';
import type { ConversionResult } from './cc3dToEpoxy';
import { differentialWalk } from './cc3dToEpoxyDifferential';
import { classifyLevel } from './epoxyCoverage';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
/** When set, names a file that receives the validator issue keys of every map (kept out of git, under local/). */
const KEYS_OUT_FILE = process.env.CC3D_VALIDATOR_KEYS_OUT;
const TEST_TIMEOUT_MS = 600_000;
const ISSUE_PREFIX = 'validator.issues.';
const ISSUE_SUFFIX = '.label';
const CONVERTED_PREFIX = 'cc3d_';
/** Validator errors a converted level may keep: the CC3D rules cannot be expressed in the Epoxy ones (arbitration 3). */
const ALLOWED_ERROR_KEYS: readonly string[] = [
  'unreachable_chips',
  'unreachable_exit',
  'no_matching_key',
  'no_exit'
];
const PLATE_REGRESSION_MAP_ID = '17381';
const RED_HOLD_DOOR_PREFIX = 'hold_door_red';
const RED_HOLD_DOOR_OPEN = 'hold_door_red_open';
const IDLE_TICKS = 12;
const SCRIPT_STEPS = 72;
const TICKS_PER_STEP = 4;
const SCRIPT_SEED = 1;
const SCRIPT_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Seeds of the random walks played on each exact map. */
const WALK_SEEDS: readonly number[] = [7, 8, 9];
/** Most walks that may end as a monster timing difference (measured); a higher count means the tolerance grew. */
const MONSTER_TIMING_CEILING = 0;

function loadLevels(): CompiledLevel[] {
  const dir = CORPUS_DIR as string;
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
  const { levels, failures } = decodeCc3dFiles(files, 'corpus');
  expect(failures).toEqual([]);
  return levels;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** SHA-256 of the engine state after load, the idle ticks and every scripted step; throws if the engine does. */
function scriptedPlayHash(level: CompiledLevel): string {
  const hash = createHash('sha256');
  const engine = new GameEngine();
  engine.loadLevel(level, SCRIPT_SEED);
  const record = (): void => {
    hash.update(
      stableStringify({
        tick: engine.getTick(),
        player: engine.getPlayer(),
        entities: engine.getEntities(),
        terrain: engine.getTerrain(),
        items: engine.getItems(),
        chips: engine.getChipsRemaining(),
        completed: engine.isLevelCompleted()
      })
    );
  };
  record();
  for (let i = 0; i < IDLE_TICKS; i++) {
    engine.tick();
    record();
  }
  for (let step = 0; step < SCRIPT_STEPS; step++) {
    engine.attemptPlayerMove(SCRIPT_DIRECTIONS[step % SCRIPT_DIRECTIONS.length]);
    for (let i = 0; i < TICKS_PER_STEP; i++) {
      engine.tick();
      record();
    }
  }
  return hash.digest('hex');
}

describe.skipIf(!CORPUS_DIR)('cc3d to epoxy conversion of the corpus', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('runs with the registered tile lookup: an underlay that must be dropped is dropped', () => {
    // A wall is no removable top, so nothing can hide under it; without the lookup the entry would be kept.
    expect(normalizeUnderlays([{ x: 0, y: 0, terrain: 'water' }], [['wall']], 'epoxy')).toBeNull();
    expect(normalizeUnderlays([{ x: 0, y: 0, terrain: 'water' }], [['wall']], 'epoxy', null)).not.toBeNull();
  });

  it('converts every map to a level the stored-level checks accept, with known validator errors only', { timeout: TEST_TIMEOUT_MS }, () => {
    const levels = loadLevels();
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const limits = ConfigRegistry.getLevelTextLimits();
    const tiles = ConfigRegistry.getTiles().tiles;
    const errorKeys: Record<string, number> = {};
    const errorMaps: Record<string, number> = {};
    const warningKeys: Record<string, number> = {};
    const infoKeys: Record<string, number> = {};
    const lostKeys: Record<string, number> = {};
    const lostMaps: string[] = [];
    const verdicts: Record<string, number> = { exact: 0, approx: 0, lost: 0 };
    const problems: string[] = [];
    const keysPerMap: Record<string, string[]> = {};
    let waterFireBlocks = 0;
    let dropCount = 0;
    for (const source of levels) {
      const cc3d = source.cc3d;
      if (!cc3d) throw new Error(`${source.id} has no cc3d data`);
      const result: ConversionResult = convertCc3dLevel(source);
      const { level, report } = result;

      if (stripInvalidTextFields(level) !== level) problems.push(`${source.id}: stripInvalidTextFields changes the level`);
      if (!isCompiledLevelShape(level, bounds, true)) problems.push(`${source.id}: not a compiled level shape`);
      const sanitized = sanitizeStoredLevels([level], bounds, limits);
      if (JSON.stringify(sanitized) !== JSON.stringify([level])) problems.push(`${source.id}: sanitizeStoredLevels changes the level`);

      const ids = [
        ...level.terrain.flat(),
        ...level.items.flat().filter((id): id is string => id !== null),
        ...level.entities.map((e) => e.type),
        ...level.cloneLinks.map((l) => l.templateType),
        ...(level.underlays ?? []).map((u) => u.terrain)
      ];
      for (const id of ids) if (id.startsWith(CONVERTED_PREFIX)) problems.push(`${source.id}: id ${id} starts with ${CONVERTED_PREFIX}`);
      for (const id of level.terrain.flat()) if (tiles[id]?.layer !== 'terrain') problems.push(`${source.id}: terrain ${id} does not resolve`);
      for (const id of level.items.flat()) if (id !== null && tiles[id]?.layer !== 'item') problems.push(`${source.id}: item ${id} does not resolve`);
      for (const entity of level.entities) if (!ConfigRegistry.getEntityDef(entity.type)) problems.push(`${source.id}: entity ${entity.type} does not resolve`);
      for (const link of level.cloneLinks) if (!ConfigRegistry.getEntityDef(link.templateType)) problems.push(`${source.id}: template ${link.templateType} does not resolve`);

      const validation = LevelValidator.validate(level, undefined, { doorOrderSearch: 'deep' });
      const seen = new Set<string>();
      keysPerMap[source.id] = validation.issues
        .map((issue) => `${issue.severity}:${issue.i18nKey.slice(ISSUE_PREFIX.length).replace(ISSUE_SUFFIX, '')}`)
        .sort();
      for (const issue of validation.issues) {
        const key = issue.i18nKey.slice(ISSUE_PREFIX.length).replace(ISSUE_SUFFIX, '');
        if (issue.severity === 'error') {
          bump(errorKeys, key);
          if (!seen.has(key)) bump(errorMaps, key);
          seen.add(key);
          if (!ALLOWED_ERROR_KEYS.includes(key)) problems.push(`${source.id}: validator error ${key}`);
        } else if (issue.severity === 'warning') bump(warningKeys, key);
        else bump(infoKeys, key);
      }

      // A block that starts on water or fire stays an entity (measured, not an error).
      for (const entity of level.entities) {
        const under = level.terrain[entity.y][entity.x];
        if (under === 'water' || under === 'fire') waterFireBlocks += 1;
      }
      dropCount += report.drops.length;
      bump(verdicts, classifyLevel(cc3d, source.timeLimitSeconds).verdict);
      if (report.lost.length > 0) {
        lostMaps.push(source.id);
        for (const entry of report.lost) bump(lostKeys, entry.key);
      }
    }
    if (KEYS_OUT_FILE) writeFileSync(KEYS_OUT_FILE, JSON.stringify(keysPerMap, null, 1));
    console.info(`cc3d to epoxy: ${levels.length} maps, verdicts ${JSON.stringify(verdicts)}`);
    console.info(`validator errors (count) ${JSON.stringify(errorKeys)}`);
    console.info(`validator errors (maps) ${JSON.stringify(errorMaps)}`);
    console.info(`validator warnings ${JSON.stringify(warningKeys)}`);
    console.info(`validator info ${JSON.stringify(infoKeys)}`);
    console.info(`maps with lost keys: ${lostMaps.length}; per key (maps) ${JSON.stringify(lostKeys)}`);
    console.info(`blocks starting on water or fire: ${waterFireBlocks}; converter drops: ${dropCount}`);
    expect(problems).toEqual([]);
  });

  it('plays a scripted run on Epoxy without throwing, identically twice', { timeout: TEST_TIMEOUT_MS }, () => {
    const levels = loadLevels();
    const failures: string[] = [];
    for (const source of levels) {
      const { level } = convertCc3dLevel(source);
      try {
        const first = scriptedPlayHash(level);
        const second = scriptedPlayHash(level);
        if (first !== second) failures.push(`${source.id}: not deterministic`);
      } catch (error) {
        failures.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.info(`scripted play: ${levels.length} maps, ${failures.length} failures`);
    expect(failures).toEqual([]);
  });

  it('plays the maps of an exact verdict as CC3D does (seeded random walks)', { timeout: TEST_TIMEOUT_MS }, () => {
    const levels = loadLevels();
    const mismatches: string[] = [];
    const byField: Record<string, number> = {};
    const loops: string[] = [];
    let exactMaps = 0;
    let walks = 0;
    let touchedWalks = 0;
    const monsterTimingWalks: string[] = [];
    let moves = 0;
    for (const source of levels) {
      const cc3d = source.cc3d;
      if (!cc3d || classifyLevel(cc3d, source.timeLimitSeconds).verdict !== 'exact') continue;
      exactMaps += 1;
      const { level } = convertCc3dLevel(source);
      for (const seed of WALK_SEEDS) {
        const walk = differentialWalk(source, level, seed);
        walks += 1;
        moves += walk.moves;
        if (walk.touched) touchedWalks += 1;
        if (walk.monsterTiming) monsterTimingWalks.push(`${source.id}/${seed}@${walk.moves}:${walk.monsterType ?? '?'}`);
        if (walk.looping) loops.push(`${source.id}/${seed}@${walk.moves}`);
        if (walk.mismatch) {
          bump(byField, walk.mismatch.field);
          mismatches.push(`${source.id}/${seed}: move ${walk.mismatch.move} ${walk.mismatch.field} ${walk.mismatch.detail}`);
        }
      }
    }
    console.info(
      `differential: ${exactMaps} exact maps, ${walks} walks, ${moves} moves, ${touchedWalks} walks changed chips, keys or cells, ` +
        `${mismatches.length} mismatches ${JSON.stringify(byField)}, ${monsterTimingWalks.length} walks ended as monster_timing (reported, not failures); walks ended in a perpetual slide: ${loops.join(' ')}`
    );
    console.info(`monster_timing walks (map/seed@step:monster): ${monsterTimingWalks.join(' ')}`);
    for (const line of mismatches) console.info(`  mismatch ${line}`);
    expect(monsterTimingWalks.length).toBeLessThanOrEqual(MONSTER_TIMING_CEILING);
    expect(exactMaps).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it('opens the red hold doors of map 17381 at load: the golems stand on the red plates', { timeout: TEST_TIMEOUT_MS }, () => {
    const source = loadLevels().find((level) => level.id.endsWith(PLATE_REGRESSION_MAP_ID));
    if (!source) throw new Error('map 17381 is missing from the corpus');
    const { level } = convertCc3dLevel(source);
    const doors = level.terrain.flat().filter((id) => id.startsWith(RED_HOLD_DOOR_PREFIX));
    expect(doors.length).toBeGreaterThan(0);
    expect(doors.every((id) => id === RED_HOLD_DOOR_OPEN)).toBe(true);
    const engine = new GameEngine();
    engine.loadLevel(level, SCRIPT_SEED);
    const loaded = engine.getTerrain().flat().filter((id) => id.startsWith(RED_HOLD_DOOR_PREFIX));
    expect(loaded.every((id) => id === RED_HOLD_DOOR_OPEN)).toBe(true);
  });
});
