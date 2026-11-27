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

import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { WalkWait } from './epoxyAutoWalk';
import { ObjectiveMarker } from './objectiveMarker';
import { WalkForecaster } from './walkForecast';

/**
 * The page builds these as fields of its application object, before the game config is loaded: building them must read
 * no config. (This file never loads the config on purpose.)
 */
describe('the walk aids built before the config is loaded', () => {
  it('builds the wait counter, the forecaster and the objective marker without reading the config', () => {
    expect(() => {
      new WalkWait();
      new WalkForecaster();
      new ObjectiveMarker();
    }).not.toThrow();
  });

  it('forgets and resets without reading the config either', () => {
    const forecaster = new WalkForecaster();
    const marker = new ObjectiveMarker();
    const wait = new WalkWait();
    expect(() => {
      forecaster.reset();
      marker.forget();
      wait.clear();
    }).not.toThrow();
  });
});
