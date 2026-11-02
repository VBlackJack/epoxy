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

import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CompiledLevel, GridPoint, WinRule } from '../core/types';

const STATUS_SEPARATOR = ' ';

/** Dead-end message for a level, by the way it is won (literal keys, so key scans find them). */
export function stuckMessageKey(winRule: WinRule | undefined): string {
  return winRule === 'targets'
    ? 'hud.messages.blocks_stuck_targets.label'
    : 'hud.messages.blocks_stuck.label';
}

/** True when the HUD counts covered targets instead of remaining chips. */
export function showsTargetsCounter(winRule: WinRule | undefined): boolean {
  return winRule === 'targets';
}

/** True when the HUD counts lit laser receivers instead of remaining chips. */
export function showsReceiversCounter(winRule: WinRule | undefined): boolean {
  return winRule === 'receivers';
}

/** Lit receivers over all the receivers the terrain holds, for the HUD counter of a 'receivers' level. */
export function receiversProgress(
  terrain: readonly (readonly string[])[],
  lit: readonly GridPoint[]
): { lit: number; total: number } {
  let total = 0;
  for (const row of terrain) {
    for (const id of row) {
      if (ConfigRegistry.getTile(id).laserReceiverGroup !== undefined) total++;
    }
  }
  return { lit: lit.length, total };
}

/** Objective message key of a level, by the way it is won; null when it needs no announcement. */
export function objectiveMessageKey(winRule: WinRule | undefined): string | null {
  if (winRule === 'targets') return 'hud.messages.objective_targets.label';
  if (winRule === 'receivers') return 'hud.messages.objective_receivers.label';
  return null;
}

/** True when the Sokoban skin can change what is drawn, i.e. the level is won by covering targets. */
export function isSokobanSkinApplicable(winRule: WinRule | undefined): boolean {
  return winRule === 'targets';
}

/** True when the level has a clock, so a time bonus and a best time mean something. */
export function isTimedLevel(timeLimitSeconds: number): boolean {
  return timeLimitSeconds > 0;
}

/** True when the level carries a stored solution the replay can play. */
export function hasStoredSolution(level: Pick<CompiledLevel, 'solution'>): boolean {
  return Boolean(level.solution);
}

/** True when starting this level should state its objective. */
export function shouldAnnounceObjective(winRule: WinRule | undefined): boolean {
  return objectiveMessageKey(winRule) !== null;
}

/**
 * Joins the status messages that must be seen together into one toast, since a
 * new toast replaces the previous one. Empty or missing parts are skipped.
 */
export function combineStatusMessages(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(STATUS_SEPARATOR);
}
