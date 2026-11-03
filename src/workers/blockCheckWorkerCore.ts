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

const NOT_INITIALISED_MESSAGE = 'Block check worker received a request before its configuration';

/** Returns the request handler of the worker: init installs the configs, check answers one verdict. */
export function createBlockCheckWorkerCore(
  deps: BlockCheckWorkerDeps,
  reply: (response: BlockCheckWorkerResponse) => void
): (request: BlockCheckWorkerRequest) => void {
  let initialised = false;
  return (request) => {
    if (request.type === 'init') {
      deps.applyConfigs(request.bundle);
      initialised = true;
      return;
    }
    if (!initialised) {
      reply({ type: 'error', id: request.id, message: NOT_INITIALISED_MESSAGE });
      return;
    }
    try {
      reply({ type: 'verdict', id: request.id, verdict: deps.check(request.level) });
    } catch (err) {
      reply({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}
