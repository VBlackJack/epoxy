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
import type { BlockCheckWorkerRequest, BlockCheckWorkerResponse } from './blockCheckProtocol';

/** What the worker needs from the solver; injected so the logic is testable without a worker. */
export interface BlockCheckWorkerDeps {
  applyConfigs(bundle: ConfigBundle): void;
  check(level: CompiledLevel): BlockPuzzleVerdict | null;
}

/** Returns the request handler of the worker: each check installs its configs, then answers one verdict. */
export function createBlockCheckWorkerCore(
  deps: BlockCheckWorkerDeps,
  reply: (response: BlockCheckWorkerResponse) => void
): (request: BlockCheckWorkerRequest) => void {
  return (request) => {
    try {
      deps.applyConfigs(request.bundle);
      reply({ type: 'verdict', id: request.id, verdict: deps.check(request.level) });
    } catch (err) {
      reply({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}
