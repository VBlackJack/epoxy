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
import { TWS_FILE_ACCEPT } from '../config/constants';
import type { TwsLevel } from '../core/cclp/twsReplay';
import { t } from '../i18n/I18nManager';
import { TwsFiles } from '../storage/TwsFiles';
import { combineStatusMessages } from './levelFeedback';
import { twsLoadOutcome, TwsLoadRefusal, twsSizeRefusal } from './twsSolution';

const TWS_INPUT_ID = 'tws-file-input';
const NOT_STORED_KEY = 'app.errors.tws.not_stored.label';
const LOADED_KEY = 'hud.messages.tws_loaded.label';

let pendingPick: ((file: File | null) => void) | null = null;
let pickerBound = false;

function settlePick(file: File | null): void {
  const resolve = pendingPick;
  pendingPick = null;
  resolve?.(file);
}

function bindPickerOnce(input: HTMLInputElement): void {
  if (pickerBound) return;
  pickerBound = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0] ?? null;
    // The same file can be picked again next time: the field starts empty after every pick.
    input.value = '';
    settlePick(file);
  });
  input.addEventListener('cancel', () => settlePick(null));
}

/**
 * Opens the system file picker for a .tws file and resolves with the chosen file, or null when the player cancels (or
 * there is no picker). Call it straight from the click handler or from the answer of a dialog, with no await between: a
 * browser only opens a picker for a gesture that is still fresh.
 */
export function pickTwsFile(): Promise<File | null> {
  const input = document.getElementById(TWS_INPUT_ID) as HTMLInputElement | null;
  if (!input) return Promise.resolve(null);
  bindPickerOnce(input);
  // A picker still open from an earlier ask is abandoned, never left hanging.
  settlePick(null);
  input.accept = TWS_FILE_ACCEPT;
  input.value = '';
  const picked = new Promise<File | null>((resolve) => {
    pendingPick = resolve;
  });
  input.click();
  return picked;
}

/** What loading a file for a pack came to. */
export type TwsLoadResult = { ok: true; matched: number; total: number; persisted: boolean } | TwsLoadRefusal;

/**
 * Reads, checks and keeps a picked file as the solution file of a pack. The size is checked before a byte is read. A file
 * that is refused, or that plays none of the pack's levels, stores nothing; a file that cannot be stored still plays until
 * the page is left. Limits are read here, at use.
 */
export async function loadTwsFileForPack(packId: string, levels: readonly TwsLevel[], file: File): Promise<TwsLoadResult> {
  const limits = ConfigRegistry.getGame().twsReplay;
  const tooLarge = twsSizeRefusal(file.size, limits);
  if (tooLarge) return tooLarge;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const outcome = twsLoadOutcome(bytes, levels, limits);
  if (!outcome.ok) return outcome;
  const persisted = await TwsFiles.adopt(packId, file.name, bytes, outcome.index);
  return { ok: true, matched: outcome.matched, total: outcome.total, persisted };
}

/** The sentence that tells the player what loading a file came to. */
export function twsLoadMessage(result: TwsLoadResult): string {
  if (!result.ok) return t(result.errorKey, result.params);
  const loaded = t(LOADED_KEY, { matched: result.matched, total: result.total });
  return result.persisted ? loaded : combineStatusMessages(loaded, t(NOT_STORED_KEY));
}
