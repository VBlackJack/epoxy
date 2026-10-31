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

/** What decides whether the first-launch "How to play" dialog opens. */
export interface OnboardingContext {
  /** The seen flag was read from storage or set earlier in this session. */
  flagSeen: boolean;
  /** A saved game existed before this launch. */
  hasSave: boolean;
  /** At least one level record existed before this launch. */
  hasScores: boolean;
  /** An endless run is active. */
  endless: boolean;
  mode: 'play' | 'editor';
  /** Another dialog is already open. */
  dialogOpen: boolean;
}

/**
 * The dialog shows once, on a genuine first launch: a player with a save or
 * records already knows the game even when the flag was never written.
 */
export function shouldShowOnboarding(context: OnboardingContext): boolean {
  if (context.flagSeen || context.hasSave || context.hasScores) return false;
  if (context.endless || context.dialogOpen) return false;
  return context.mode === 'play';
}
