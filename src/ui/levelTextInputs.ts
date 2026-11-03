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

import { LevelTextConfig } from '../core/types';

/** Editor text inputs and the limit each one follows. */
const INPUT_LIMITS: ReadonlyArray<readonly [string, keyof LevelTextConfig]> = [
  ['editor-meta-title', 'titleMaxLength'],
  ['editor-meta-hint', 'hintMaxLength'],
  ['editor-meta-author', 'authorMaxLength'],
  ['editor-meta-password', 'passwordMaxLength']
];

/** Caps the editor's text inputs at the configured level text limits; a tighter cap already set is kept. */
export function applyLevelTextInputLimits(limits: LevelTextConfig, root: ParentNode = document): void {
  for (const [id, key] of INPUT_LIMITS) {
    const input = root.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) continue;
    const current = input.maxLength;
    input.maxLength = current >= 0 ? Math.min(current, limits[key]) : limits[key];
  }
}
