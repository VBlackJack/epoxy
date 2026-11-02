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

import { BUILTIN_PACK_IDS } from '../config/constants';

/** The pack fields that decide whether a pack can be deleted. */
export interface RemovableCandidate {
  readonly id: string;
  readonly builtIn?: boolean;
}

/** True when a pack can be deleted: built-in packs, the campaign and custom packs never can. */
export function isRemovablePack(pack: RemovableCandidate): boolean {
  return (
    pack.builtIn !== true && pack.id !== BUILTIN_PACK_IDS.CAMPAIGN && pack.id !== BUILTIN_PACK_IDS.CUSTOM
  );
}

/** Ids of every pack the user may delete, in the given order, without duplicates. */
export function removablePackIds(packs: readonly RemovableCandidate[]): string[] {
  const ids: string[] = [];
  for (const pack of packs) {
    if (isRemovablePack(pack) && !ids.includes(pack.id)) ids.push(pack.id);
  }
  return ids;
}
