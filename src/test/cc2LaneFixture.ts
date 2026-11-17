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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCc2Selection } from '../ui/cc2Import';
import type { CompiledLevel } from '../core/types';

/** Folder of the lane levels: small original constructions made from an empty grid, one per Lexy decision lane. */
const LANE_FIXTURE_DIR = new URL('../core/epoxy/__fixtures__/cc2-lanes/', import.meta.url);
const LANE_FILE_PREFIX = 'w20_';
const LANE_FILE_EXTENSION = '.c2m';
const IMPORT_MAX_BYTES = 1 << 20;

/**
 * Imports one lane level (for example `mixed_push`, file `w20_mixed_push.c2m`) through the CC2 importer, as a player would, and returns the
 * compiled level. Call loadTestConfigs() first. The level plays on the CC2 engine.
 */
export async function loadCc2Lane(lane: string): Promise<CompiledLevel> {
  const name = `${LANE_FILE_PREFIX}${lane}${LANE_FILE_EXTENSION}`;
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(name, LANE_FIXTURE_DIR))));
  const result = await importCc2Selection(
    [{ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }],
    IMPORT_MAX_BYTES,
    String
  );
  const level = result.levels[0];
  if (level === undefined) throw new Error(`lane ${lane} did not import: ${result.firstError?.key ?? 'no level'}`);
  return level;
}
