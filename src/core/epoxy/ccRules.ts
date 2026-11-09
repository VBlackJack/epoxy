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

import type { CompiledLevel } from '../types';

/**
 * True when the Epoxy engine plays the level with the classic Chip's Challenge timing rules: the level asks for
 * them (`rulesFlavor` 'cc') or is a stored CC2 import (it carries `cc2`), so an import made before the flag existed
 * gets the rules without being imported again.
 */
export function usesCcRules(level: Pick<CompiledLevel, 'rulesFlavor' | 'cc2'>): boolean {
  return level.rulesFlavor === 'cc' || level.cc2 !== undefined;
}
