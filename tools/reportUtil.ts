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

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Helpers shared by the report tools; registers no test. */

const C2M_EXTENSION = '.c2m';
const PERCENT = 100;
const UNLISTED = '-';

/** Every .c2m under a folder, sorted by relative path. */
export function listLevels(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(C2M_EXTENSION)) out.push(full);
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export const pct = (part: number, whole: number): string => (whole === 0 ? UNLISTED : `${Math.round((part * PERCENT) / whole)}%`);


export function table(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`)
  ];
}

