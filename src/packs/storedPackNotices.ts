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

import type { Cc3dMigrationReport } from './cc3dMigration';
import type { CclpMoveReport } from './cclpMigration';

type Translate = (key: string, params?: Record<string, number>) => string;

/** The one start-up message about stored packs, and the kept packs it names (to mark as told once it is shown). */
export interface StoredPackNotice {
  readonly message: string | null;
  readonly keptPackIdsTold: readonly string[];
}

/**
 * Merges what the load-time migrations did into one message, so no notice replaces another: the CC3D conversion, the packs
 * moved to the CCLP engine, and the .DAT packs that keep their old rules and were not told yet.
 */
export function storedPackNotice(
  cc3d: Cc3dMigrationReport | null,
  cclp: CclpMoveReport | null,
  keptPackIdsAlreadyTold: readonly string[],
  translate: Translate,
  hudBusy = false
): StoredPackNotice {
  const lines: string[] = [];
  if (cc3d) {
    lines.push(translate('cc3d.import.migration.converted.label', { count: cc3d.converted }));
    if (cc3d.kept > 0) lines.push(translate('cc3d.import.migration.kept.label', { kept: cc3d.kept }));
  }
  if (cclp && cclp.movedPacks > 0) lines.push(translate('app.packs.cclp_move.moved.label', { packs: cclp.movedPacks }));
  // While a dialog is open or about to open the kept line waits: it is not shown, so it is not marked told either.
  const fresh = hudBusy ? [] : (cclp?.keptPackIds ?? []).filter((id) => !keptPackIdsAlreadyTold.includes(id));
  if (fresh.length > 0) lines.push(translate('app.packs.cclp_move.kept.label', { count: fresh.length }));
  return { message: lines.length > 0 ? lines.join(' ') : null, keptPackIdsTold: fresh };
}
