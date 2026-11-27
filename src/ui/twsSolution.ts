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
 * The page logic of the Tile World solution replay that needs no DOM: what the Solution button does on a level, what a
 * loaded file says about a pack, which message explains a refusal, and when a win may be recorded. main.ts only routes.
 */

import { countPlayableLevels, TwsLevel, TwsMatch } from '../core/cclp/twsReplay';
import { parseTwsIndex, TwsErrorCode, TwsIndex, TwsLimits, TwsParseError } from '../formats/TwsCodec';
import type { TwsFileState } from '../storage/TwsFiles';

const BYTES_PER_KB = 1024;

/** Ids of the answers of the dialog that follows a stored file the reader refuses. */
export const TWS_FORGET_CHOICE = 'forget';
export const TWS_RELOAD_CHOICE = 'reload';

/** What the Solution button does on the level on screen. */
export type SolutionAction =
  /** The stored solution of an Epoxy or official CC1 level. */
  | 'stored'
  /** The Tile World solution of the pack's file plays. */
  | 'tws'
  /** A CCLP engine level and no file for its pack yet: the button offers to load one. */
  | 'offer_load'
  /** The pack's file is being read from storage. */
  | 'loading'
  /** A stored file the reader now refuses: the button offers to forget it or load another. */
  | 'error'
  /** Nothing plays on this level (the reason is the title). */
  | 'none';

export interface SolutionControl {
  action: SolutionAction;
  enabled: boolean;
  /** Key of the tooltip of the desktop button (the reason when it is disabled). */
  titleKey: string;
  /** Parameters of the title message (the level number the password message names). */
  titleParams: Record<string, number>;
}

const STORED_HINT_KEY = 'hud.controls.solution.hint';
const STORED_UNAVAILABLE_KEY = 'hud.controls.solution_unavailable.label';
const TWS_LOAD_HINT_KEY = 'hud.controls.solution_tws_load.hint';
const TWS_LOADING_KEY = 'hud.controls.solution_tws_loading.label';
const TWS_ERROR_HINT_KEY = 'hud.controls.solution_tws_error.hint';
const NO_MATCH_KEY = 'app.errors.tws.no_match.label';

/** The message that tells why the level on screen has no solution in the loaded file. */
const MATCH_REASON_KEYS: Readonly<Record<Exclude<TwsMatch['kind'], 'playable'>, string>> = {
  not_cclp: STORED_UNAVAILABLE_KEY,
  ms_ruleset: 'hud.messages.tws_ms_ruleset.label',
  no_record: 'hud.messages.tws_no_record.label',
  no_solution: 'hud.messages.tws_no_solution.label',
  password_mismatch: 'hud.messages.tws_password_mismatch.label',
  mouse_moves: 'hud.messages.tws_mouse_moves.label'
};

/** Key of the message for a level the file cannot play. */
export function twsMatchMessageKey(kind: Exclude<TwsMatch['kind'], 'playable'>): string {
  return MATCH_REASON_KEYS[kind];
}

/** Key of the message for a refused file. */
const ERROR_KEYS: Readonly<Record<TwsErrorCode, string>> = {
  too_large: 'app.errors.tws.too_large.label',
  signature: 'app.errors.tws.signature.label',
  ruleset: 'app.errors.tws.ruleset.label',
  truncated: 'app.errors.tws.damaged.label',
  record_size: 'app.errors.tws.damaged.label',
  start_state: 'app.errors.tws.damaged.label',
  too_long: 'app.errors.tws.too_long.label'
};

export function twsErrorKey(code: TwsErrorCode): string {
  return ERROR_KEYS[code];
}

/** Every message key this module can name, so a test can check each one exists in both languages. */
export function twsMessageKeys(): string[] {
  return [
    ...new Set([
      ...Object.values(MATCH_REASON_KEYS),
      ...Object.values(ERROR_KEYS),
      STORED_HINT_KEY,
      STORED_UNAVAILABLE_KEY,
      TWS_LOAD_HINT_KEY,
      TWS_LOADING_KEY,
      TWS_ERROR_HINT_KEY,
      NO_MATCH_KEY
    ])
  ];
}

/**
 * What the Solution button does. `tws` says the level is played by the CCLP engine; `file` is what the page holds for its
 * pack (undefined until the first read starts); `match` is the file's answer for this level once a file is held.
 */
export function solutionControlState(input: {
  tws: boolean;
  storedAvailable: boolean;
  file: TwsFileState | undefined;
  match: TwsMatch | null;
  levelNumber?: number;
}): SolutionControl {
  const titleParams = { number: input.levelNumber ?? 0 };
  if (!input.tws) {
    return {
      action: 'stored',
      enabled: input.storedAvailable,
      titleKey: input.storedAvailable ? STORED_HINT_KEY : STORED_UNAVAILABLE_KEY,
      titleParams
    };
  }
  const file = input.file;
  if (file === undefined || file.kind === 'loading') return { action: 'loading', enabled: true, titleKey: TWS_LOADING_KEY, titleParams };
  if (file.kind === 'none') return { action: 'offer_load', enabled: true, titleKey: TWS_LOAD_HINT_KEY, titleParams };
  if (file.kind === 'error') return { action: 'error', enabled: true, titleKey: TWS_ERROR_HINT_KEY, titleParams };
  const match = input.match;
  if (match === null || match.kind === 'playable') return { action: 'tws', enabled: true, titleKey: STORED_HINT_KEY, titleParams };
  return { action: 'none', enabled: false, titleKey: MATCH_REASON_KEYS[match.kind], titleParams };
}

/** A refused file: the message key and its parameters. */
export interface TwsLoadRefusal {
  ok: false;
  errorKey: string;
  params: Record<string, number>;
}

/** An accepted file: its index, and how many of the pack's levels it plays. */
export interface TwsLoadAccepted {
  ok: true;
  index: TwsIndex;
  matched: number;
  total: number;
}

function sizeParams(limits: TwsLimits): Record<string, number> {
  return { max: Math.floor(limits.maxFileBytes / BYTES_PER_KB) };
}

/** The refusal of a file by its size alone, before any byte of it is read; null when the size is fine. */
export function twsSizeRefusal(size: number, limits: TwsLimits): TwsLoadRefusal | null {
  return size > limits.maxFileBytes ? { ok: false, errorKey: ERROR_KEYS.too_large, params: sizeParams(limits) } : null;
}

/** The refusal message of a stored file the reader now refuses. */
export function twsParseRefusal(code: TwsErrorCode, limits: TwsLimits): TwsLoadRefusal {
  return { ok: false, errorKey: ERROR_KEYS[code], params: sizeParams(limits) };
}

/**
 * Judges a file the player picked for a pack: parsed, then compared with the pack's levels. A file of MS solutions, and a
 * file that plays none of the pack's levels, are refused (nothing is stored for them).
 */
export function twsLoadOutcome(bytes: Uint8Array, levels: readonly TwsLevel[], limits: TwsLimits): TwsLoadAccepted | TwsLoadRefusal {
  let index: TwsIndex;
  try {
    index = parseTwsIndex(bytes, limits);
  } catch (e) {
    if (!(e instanceof TwsParseError)) throw e;
    return twsParseRefusal(e.code, limits);
  }
  if (index.ruleset !== 'lynx') return { ok: false, errorKey: MATCH_REASON_KEYS.ms_ruleset, params: {} };
  const matched = countPlayableLevels(index, levels);
  if (matched === 0) return { ok: false, errorKey: NO_MATCH_KEY, params: {} };
  return { ok: true, index, matched, total: levels.length };
}

/**
 * Whether a win may be recorded (high score, completion, saved progress). Never during a replay of any kind, never in a run
 * that started from a TWS load (its seed and stepping are the file's, so its moves would not replay from the default
 * start), and never in the test play of an editor draft.
 */
export function mayRecordWin(state: { replaying: boolean; tws: boolean; seededRun: boolean; testPlaying: boolean }): boolean {
  return !state.replaying && !state.tws && !state.seededRun && !state.testPlaying;
}
