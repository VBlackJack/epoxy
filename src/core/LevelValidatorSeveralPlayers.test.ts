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
 * The validator on a level with several players: every start floods the level and shares the inventory (keys, chips,
 * opened doors) with the others, a start that cannot reach an exit is an error, one exit may serve every player (an
 * exited player leaves the map), and two starts on one cell are a warning. The validator never claims a level solvable.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, ExtraPlayerStart, PlayerCharacter } from './types';

const UNREACHABLE_PLAYER = 'validator.issues.player_unreachable_exit.label';
const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
const SHARED_START = 'validator.issues.players_share_start.label';

const TERRAIN: Record<string, string> = { '#': 'wall', '.': 'floor', P: 'floor', Q: 'floor', E: 'exit', D: 'door_red', r: 'floor' };

/** Rows of a level: P is the first start, Q an extra start (in reading order), r a red key, D a red door, E an exit. */
function level(rows: string[], characters: PlayerCharacter[] = []): CompiledLevel {
  let start = { x: 0, y: 0 };
  const extraPlayers: ExtraPlayerStart[] = [];
  const terrain = rows.map((row) => [...row].map((ch) => TERRAIN[ch]));
  const items = rows.map((row) => [...row].map((ch) => (ch === 'r' ? 'key_red' : null)));
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === 'Q') extraPlayers.push({ x, y, dir: 'S', character: characters[extraPlayers.length] ?? 'melinda' });
    })
  );
  return {
    id: 'validator_several_players',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    ...(extraPlayers.length > 0 ? { extraPlayers } : {}),
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

const keysOf = (l: CompiledLevel): string[] => LevelValidator.validate(l).issues.map((i) => i.i18nKey);
const errorsOf = (l: CompiledLevel): string[] =>
  LevelValidator.validate(l).issues.filter((i) => i.severity === 'error').map((i) => i.i18nKey);

describe('LevelValidator with several players', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('accepts two players that share one exit', () => {
    const report = LevelValidator.validate(level(['#####', '#PQE#', '#####']));
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('names the player that cannot reach the exit when another can', () => {
    const report = LevelValidator.validate(level(['#######', '#P.E#Q#', '#######']));
    expect(report.valid).toBe(false);
    const stranded = report.issues.filter((i) => i.i18nKey === UNREACHABLE_PLAYER);
    expect(stranded).toHaveLength(1);
    expect(stranded[0]).toMatchObject({ severity: 'error', params: { player: 2 } });
    expect(report.stats.reachableExit).toBe(false);
  });

  it('names the first player when the extra one is the one that reaches the exit', () => {
    const report = LevelValidator.validate(level(['#######', '#P#QE.#', '#######']));
    expect(report.issues.filter((i) => i.i18nKey === UNREACHABLE_PLAYER).map((i) => i.params)).toEqual([{ player: 1 }]);
  });

  it('keeps the plain error when no player reaches an exit', () => {
    const found = keysOf(level(['#######', '#P#Q#E#', '#######']));
    expect(found).toContain(UNREACHABLE_EXIT);
    expect(found).not.toContain(UNREACHABLE_PLAYER);
  });

  it('lets one player open a door with a key only the other can fetch', () => {
    const shared = level(['#########', '#P.D.rQE#', '#########']);
    expect(errorsOf(shared)).toEqual([]);
    // Without the second player the key lies behind the door and the exit is out of reach.
    const alone = { ...shared } as CompiledLevel;
    delete alone.extraPlayers;
    expect(errorsOf(alone)).toContain(UNREACHABLE_EXIT);
  });

  it('warns about two starts on the same cell', () => {
    const doubled = level(['#####', '#PQE#', '#####']);
    doubled.extraPlayers = [{ x: 1, y: 1, dir: 'S', character: 'melinda' }];
    const report = LevelValidator.validate(doubled);
    expect(report.issues.find((i) => i.i18nKey === SHARED_START)).toMatchObject({ severity: 'warning', params: { x: 1, y: 1 } });
    expect(report.valid).toBe(true);
    expect(keysOf(level(['#####', '#PQE#', '#####']))).not.toContain(SHARED_START);
  });

  it('reads a level of one player exactly as before', () => {
    expect(errorsOf(level(['#####', '#P.E#', '#####']))).toEqual([]);
    expect(errorsOf(level(['#####', '#P#E#', '#####']))).toEqual([UNREACHABLE_EXIT]);
  });

  it('reports no stranded player once a stored solution wins, as for one player', () => {
    const stranded = { ...level(['#######', '#P.E#Q#', '#######']), solution: 'EE' };
    const report = LevelValidator.validate(stranded, () => true);
    expect(report.issues.map((i) => i.i18nKey)).not.toContain(UNREACHABLE_PLAYER);
    expect(report.valid).toBe(true);
  });
});
