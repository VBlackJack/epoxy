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

import { FEATURE_FLAGS } from './constants';

let foreignAuthoringOverride: boolean | null = null;

/**
 * Whether the editor still offers the Lynx and CC3D rule sets for new levels,
 * the CC3D room template and the .DAT / CC3D XML exports.
 */
export function isForeignAuthoringEnabled(): boolean {
  return foreignAuthoringOverride ?? FEATURE_FLAGS.foreignAuthoring;
}

/** Test hook: forces the flag on or off; null restores the configured value. */
export function setForeignAuthoringOverride(value: boolean | null): void {
  foreignAuthoringOverride = value;
}
