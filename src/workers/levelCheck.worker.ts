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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { LevelValidator } from '../core/LevelValidator';
import { storedSolutionWins } from '../generator/SolutionReplay';
import { i18n } from '../i18n/I18nManager';
import { createLevelCheckWorkerCore } from './levelCheckWorkerCore';
import type { LevelCheckWorkerRequest, LevelCheckWorkerResponse } from './levelCheckProtocol';

/** Dedicated worker scope, typed by hand because the project compiles against the DOM lib. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<LevelCheckWorkerRequest>) => void) | null;
  postMessage(message: LevelCheckWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

const handle = createLevelCheckWorkerCore(
  {
    applyConfigs: (bundle) => ConfigRegistry.applyConfigs(bundle),
    setLocale: (locale) => i18n.setLocale(locale),
    validate: (level, solutionWins) => LevelValidator.validate(level, solutionWins),
    solutionWins: storedSolutionWins
  },
  (response) => scope.postMessage(response)
);

scope.onmessage = (event) => handle(event.data);
