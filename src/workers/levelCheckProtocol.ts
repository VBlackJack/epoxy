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
import type { CompiledLevel, LevelValidationReport } from '../core/types';

/** Messages the page sends to the level check worker; each carries the configs and locale it must validate with. */
export type LevelCheckWorkerRequest = {
  type: 'check';
  id: number;
  level: CompiledLevel;
  bundle: ConfigBundle;
  /** The page language: the validator words some issues (colour names) in it. */
  locale: string;
};

/** Messages the level check worker answers with. */
export type LevelCheckWorkerResponse =
  /** Posted once when the worker script has loaded: a worker that failed before this is unusable on this page. */
  | { type: 'ready' }
  | { type: 'report'; id: number; report: LevelValidationReport }
  | { type: 'error'; id: number; message: string };
