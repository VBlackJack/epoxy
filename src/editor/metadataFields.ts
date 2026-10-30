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

/**
 * Reads a whole number field. An empty or invalid entry keeps `current`; a
 * finite number is floored and never goes below zero.
 */
function parseNonNegativeInteger(raw: string, current: number): number {
  if (raw.trim() === '') return current;
  const value = Number(raw);
  if (!Number.isFinite(value)) return current;
  return Math.max(0, Math.floor(value));
}

/** Time limit field: 0 means the level is untimed, and 0 is a valid entry. */
export function parseTimeLimit(raw: string, current: number): number {
  return parseNonNegativeInteger(raw, current);
}

/** Chips needed field: 0 means no chip is required. */
export function parseChipsRequired(raw: string, current: number): number {
  return parseNonNegativeInteger(raw, current);
}
