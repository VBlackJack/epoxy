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

import type { ConfigBundle } from '../config/ConfigRegistry';
import type { BlockPuzzleVerdict } from '../core/BlockPuzzleSolver';
import type { CompiledLevel } from '../core/types';

/** Messages the page sends to the block check worker. */
export type BlockCheckWorkerRequest =
  | { type: 'init'; bundle: ConfigBundle }
  | { type: 'check'; id: number; level: CompiledLevel };

/** Messages the block check worker answers with; a null verdict means the level is not one the line applies to. */
export type BlockCheckWorkerResponse =
  | { type: 'verdict'; id: number; verdict: BlockPuzzleVerdict | null }
  | { type: 'error'; id: number; message: string };
