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

import { CompiledLevel, RulesProfile } from '../core/types';

/** The only ruleset a rule profile applies to. */
const PROFILED_RULESET = 'lynx';

/**
 * Gives the levels a pack's rule profile; a level of another ruleset is left as it is. A leaf module (types only), so
 * ConfigRegistry and the import path can both use it without an import cycle.
 */
export function applyRulesProfile(levels: CompiledLevel[], profile: RulesProfile | undefined): void {
  if (profile === undefined) return;
  for (const level of levels) if (level.ruleset === PROFILED_RULESET) level.rulesProfile = profile;
}
