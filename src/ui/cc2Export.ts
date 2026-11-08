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

import type { CompiledLevel } from '../core/types';
import { Cc2SourceStorage } from '../storage/Cc2SourceStorage';
import { bytesToBase64, cc2SourceHashes } from '../storage/cc2Sources';

/**
 * The raw CC2 sources a pack file may carry. They never travel in a share link; a pack file includes them only when
 * the player ticks "include CC2 source" (off by default).
 */

/** True when some level of the list was imported from a CC2 file. */
export function hasCc2Levels(levels: readonly Pick<CompiledLevel, 'cc2'>[]): boolean {
  return levels.some((level) => level.cc2 !== undefined);
}

/**
 * The sources of the levels as base64 by hash, read from the local sidecar; undefined when the sidecar holds none of
 * them (or cannot be read), so the file is then written without the field.
 */
export async function collectCc2Sources(
  levels: readonly Pick<CompiledLevel, 'cc2'>[]
): Promise<Record<string, string> | undefined> {
  const found = await Cc2SourceStorage.getMany(cc2SourceHashes(levels));
  if (!found || found.length === 0) return undefined;
  return Object.fromEntries(found.map((record) => [record.sha256, bytesToBase64(record.bytes)]));
}
