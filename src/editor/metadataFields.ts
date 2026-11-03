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

import { isRuleset, isWinRule } from '../config/ConfigValidation';
import { Ruleset, WinRule } from '../core/types';

/** Win rule field: an unknown entry keeps `current`. */
export function parseWinRule(raw: string, current: WinRule): WinRule {
  return isWinRule(raw) ? raw : current;
}

/** Win rules only the Epoxy engine plays: a level using one cannot be a Lynx level. */
export const EPOXY_ONLY_WIN_RULES: readonly WinRule[] = ['targets', 'receivers'];

/**
 * Whether a level can only be played under Epoxy rules: it is won with block
 * targets or laser receivers, or it places laser tiles or mirrors.
 */
export function requiresEpoxyRules(winRule: WinRule, hasLaserContent: boolean): boolean {
  return hasLaserContent || EPOXY_ONLY_WIN_RULES.includes(winRule);
}

/**
 * Whether the editor can open a level of this ruleset. Epoxy and Lynx levels are plain layers the editor
 * paints; a cc3d level is edited through its own cells, layers and mobs (cc3dEdits).
 */
export function isEditableRuleset(ruleset: Ruleset | undefined): boolean {
  switch (ruleset) {
    case undefined:
    case 'epoxy':
    case 'lynx':
    case 'cc3d':
      return true;
    default: {
      const unreachable: never = ruleset;
      throw new Error(`Unknown ruleset: ${String(unreachable)}`);
    }
  }
}

/** Ruleset field: an unknown entry keeps `current`. */
export function parseRuleset(raw: string, current: Ruleset): Ruleset {
  return isRuleset(raw) ? raw : current;
}

/**
 * Reads a whole number field. An empty or invalid entry keeps `current`; a
 * finite number is floored and never goes below zero.
 */
function parseNonNegativeInteger(raw: string, current: number): number {
  if (raw.trim() === '') return current;
  const value = Number(raw);
  if (!Number.isFinite(value)) return current;
  return Math.max(0, Math.floor(value));
}

/** Time limit field: 0 means the level is untimed, and 0 is a valid entry. */
export function parseTimeLimit(raw: string, current: number): number {
  return parseNonNegativeInteger(raw, current);
}

/** Chips needed field: 0 means no chip is required. */
export function parseChipsRequired(raw: string, current: number): number {
  return parseNonNegativeInteger(raw, current);
}
