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

import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';

/**
 * True when at least one level of the pack carries a real code. A pack whose
 * levels all use the default code (imported packs, Sokoban collections) has
 * nothing to enter: the code badge, buttons and column are hidden for it.
 */
export function packUsesPasswords(levels: ReadonlyArray<{ password: string }>): boolean {
  return levels.some((level) => level.password !== DEFAULT_LEVEL_PASSWORD);
}
