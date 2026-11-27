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

import type { CompiledLevel } from '../core/types';
import { sha256OfBytes } from '../storage/cc2Sources';

/** Separator of the passwords in a password signature. */
const PASSWORD_SEPARATOR = '\n';

/**
 * The password signature of a level set: SHA-256 of its passwords in file order, one per line. A leaf module, so
 * ConfigRegistry (stored pack moves) and the import path (datProfiles) share it without an import cycle.
 */
export async function passwordSignature(levels: readonly Pick<CompiledLevel, 'password'>[]): Promise<string> {
  return sha256OfBytes(new TextEncoder().encode(levels.map((level) => level.password).join(PASSWORD_SEPARATOR)));
}
