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

import { CC3D_RULES_VERSION, CC_RULES_VERSION, LYNX_RULES_VERSION, NATIVE_RULES_VERSION } from '../config/constants';
import { usesCcRules } from '../core/epoxy/ccRules';
import type { CompiledLevel } from '../core/types';

/** Level fields the signature reads. */
export type SignatureLevel = Pick<CompiledLevel, 'ruleset' | 'rulesFlavor' | 'cc2'>;

/**
 * Names the engine and rules version a replay was recorded on, such as "epoxy:1" or "epoxy-cc:1".
 * A replay plays back faithfully only on the same signature.
 */
export function replaySignature(level: SignatureLevel): string {
  if (level.ruleset === 'lynx') return `lynx:${LYNX_RULES_VERSION}`;
  if (level.ruleset === 'cc3d') return `cc3d:${CC3D_RULES_VERSION}`;
  return usesCcRules(level) ? `epoxy-cc:${CC_RULES_VERSION}` : `epoxy:${NATIVE_RULES_VERSION}`;
}

/**
 * True when a stored replay may be played on the level. A record without a signature predates the tag: it
 * matches only a native Epoxy level, whose engine did not change since.
 */
export function isReplayPlayable(level: SignatureLevel, storedSignature: string | undefined): boolean {
  const current = replaySignature(level);
  if (storedSignature === undefined) return current.startsWith('epoxy:');
  return storedSignature === current;
}
