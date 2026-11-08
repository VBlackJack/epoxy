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

/** Inspector sections the player can fold, in display order. */
export const INSPECTOR_SECTIONS = ['level', 'rules', 'layers', 'connections', 'cell', 'mechanisms', 'issues', 'size', 'generate'] as const;

export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

export type SectionState = Record<InspectorSection, boolean>;

/** Open state of a section the player never touched: the mechanisms card, the issues list and the generator start closed. */
export const DEFAULT_SECTION_STATE: SectionState = {
  level: true,
  rules: true,
  layers: true,
  connections: true,
  cell: true,
  mechanisms: false,
  issues: false,
  size: true,
  generate: false
};

/** Reads a stored section state; a missing or damaged value keeps the defaults. */
export function parseSectionState(raw: string | null): SectionState {
  const state: SectionState = { ...DEFAULT_SECTION_STATE };
  if (!raw) return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return state;
  }
  if (typeof parsed !== 'object' || parsed === null) return state;
  const stored = parsed as Record<string, unknown>;
  for (const section of INSPECTOR_SECTIONS) {
    const value = stored[section];
    if (typeof value === 'boolean') state[section] = value;
  }
  return state;
}

export function serializeSectionState(state: SectionState): string {
  return JSON.stringify(state);
}
