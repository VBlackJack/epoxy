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

import type { CompiledLevel } from './types';

/**
 * The text of the hint tile at (x, y) when the level gives that tile a text of its own, else the level hint
 * (its custom text, else the text its key names, translated by `translateKey`), else an empty string.
 */
export function hintTextAt(
  level: Pick<CompiledLevel, 'cellHints' | 'customHint' | 'hintKey'>,
  x: number,
  y: number,
  translateKey: (key: string) => string
): string {
  const own = level.cellHints?.find((entry) => entry.x === x && entry.y === y)?.text;
  if (own) return own;
  return level.customHint || (level.hintKey ? translateKey(level.hintKey) : '');
}
