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
import type { SolutionWins, ValidateOptions } from '../core/LevelValidator';
import type { CompiledLevel, LevelValidationReport } from '../core/types';
import type { LevelCheckWorkerRequest, LevelCheckWorkerResponse } from './levelCheckProtocol';

/** What the worker needs from the page code; injected so the logic is testable without a worker. */
export interface LevelCheckWorkerDeps {
  applyConfigs(bundle: ConfigBundle): void;
  setLocale(locale: string): void;
  validate(level: CompiledLevel, solutionWins: SolutionWins, options?: ValidateOptions): LevelValidationReport;
  /** Replays a stored solution in the engine; the validator trusts a level whose solution wins. */
  solutionWins: SolutionWins;
}

/**
 * Returns the request handler of the worker: each check installs its configs and locale, then answers one report.
 * Creating the handler announces the worker as ready, which tells the page the script loaded.
 */
export function createLevelCheckWorkerCore(
  deps: LevelCheckWorkerDeps,
  reply: (response: LevelCheckWorkerResponse) => void
): (request: LevelCheckWorkerRequest) => void {
  reply({ type: 'ready' });
  return (request) => {
    try {
      deps.applyConfigs(request.bundle);
      deps.setLocale(request.locale);
      reply({ type: 'report', id: request.id, report: deps.validate(request.level, deps.solutionWins, request.options) });
    } catch (err) {
      reply({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}
