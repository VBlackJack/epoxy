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

import { describe, expect, it } from 'vitest';
import { OnboardingContext, shouldShowOnboarding } from './onboarding';

const firstLaunch: OnboardingContext = {
  flagSeen: false,
  hasSave: false,
  hasScores: false,
  endless: false,
  mode: 'play',
  dialogOpen: false
};

describe('shouldShowOnboarding', () => {
  it('shows on a first launch', () => {
    expect(shouldShowOnboarding(firstLaunch)).toBe(true);
  });

  it('does not show again once seen', () => {
    expect(shouldShowOnboarding({ ...firstLaunch, flagSeen: true })).toBe(false);
  });

  it('spares a player who already has a save or records', () => {
    expect(shouldShowOnboarding({ ...firstLaunch, hasSave: true })).toBe(false);
    expect(shouldShowOnboarding({ ...firstLaunch, hasScores: true })).toBe(false);
  });

  it('waits out endless runs, other dialogs and the editor', () => {
    expect(shouldShowOnboarding({ ...firstLaunch, endless: true })).toBe(false);
    expect(shouldShowOnboarding({ ...firstLaunch, dialogOpen: true })).toBe(false);
    expect(shouldShowOnboarding({ ...firstLaunch, mode: 'editor' })).toBe(false);
  });
});
