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

import { CC3D_PACE_VERSION, CC3D_RULES_VERSION, CC_RULES_VERSION, LYNX_RULES_VERSION, NATIVE_RULES_VERSION } from '../config/constants';
import { isConvertedCc3dLevel } from '../core/cc3d/cc3dConstants';
import { usesCcRules } from '../core/epoxy/ccRules';
import type { CompiledLevel } from '../core/types';

/** Level fields the signature reads. */
export type SignatureLevel = Pick<CompiledLevel, 'ruleset' | 'rulesFlavor' | 'cc2' | 'cc3dSource'> & { id?: string };

/**
 * Names the engine and rules version a replay was recorded on, such as "epoxy:1", "epoxy-cc:1" or "epoxy-3d:1".
 * A replay plays back faithfully only on the same signature.
 */
export function replaySignature(level: SignatureLevel): string {
  if (level.ruleset === 'lynx') return `lynx:${LYNX_RULES_VERSION}`;
  if (level.ruleset === 'cc3d') return `cc3d:${CC3D_RULES_VERSION}`;
  if (usesCcRules(level)) return `epoxy-cc:${CC_RULES_VERSION}`;
  // A CC3D level converted to Epoxy plays at the CC3D pace; a replay of it from before the pace never plays again.
  return isConvertedCc3dLevel({ id: level.id ?? '', cc3dSource: level.cc3dSource }) ? `epoxy-3d:${CC3D_PACE_VERSION}` : `epoxy:${NATIVE_RULES_VERSION}`;
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

/** Stored in place of a signature that is present but malformed: it matches no level, so its replay is never played. */
export const UNKNOWN_REPLAY_SIGNATURE = 'unknown';

/**
 * Decides whether the replay of a win replaces the stored one. A first win, a better run, or a stored replay that
 * cannot be played on the level now (other engine or rules version, no replay) replaces it; a worse run keeps a
 * replay that still plays.
 */
export function shouldReplaceReplay(
  level: SignatureLevel,
  existing: { replayTimedMoves?: unknown[]; replaySignature?: string } | undefined,
  isBetterRun: boolean
): boolean {
  if (!existing || isBetterRun) return true;
  const hasReplay = (existing.replayTimedMoves?.length ?? 0) > 0;
  return !hasReplay || !isReplayPlayable(level, existing.replaySignature);
}
