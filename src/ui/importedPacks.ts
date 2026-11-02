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
  /** True for a pack the player created; absent on an imported one. */
  readonly userCreated?: boolean;
}

/** True when a pack can be deleted: any pack but the built-in ones and the campaign. */
export function isRemovablePack(pack: RemovableCandidate): boolean {
  return pack.builtIn !== true && pack.id !== BUILTIN_PACK_IDS.CAMPAIGN;
}

/**
 * Ids of the imported packs "delete all imported packs" removes, in the given
 * order, without duplicates. The packs the player created, and the custom pack
 * whatever its flag says, are never in it.
 */
export function removablePackIds(packs: readonly RemovableCandidate[]): string[] {
  const ids: string[] = [];
  for (const pack of packs) {
    if (
      isRemovablePack(pack) &&
      pack.id !== BUILTIN_PACK_IDS.CUSTOM &&
      pack.userCreated !== true &&
      !ids.includes(pack.id)
    ) {
      ids.push(pack.id);
    }
  }
  return ids;
}
