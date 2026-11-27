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

import { TappedWalk } from './tappedWalk';
import { WalkForecaster } from './walkForecast';
import { WalkDetour } from './walkStepAside';

/**
 * The page builds the tapped walk and the step aside memory as fields of its application object, before the game config is
 * loaded: building them, starting a walk, clearing it and asking what is pending must read no config. (This file never loads
 * the config on purpose.)
 */
describe('the tapped walk built before the config is loaded', () => {
  it('builds the step aside memory, clears it and reports without reading the config', () => {
    expect(() => {
      const detour = new WalkDetour();
      detour.arm({ x: 1, y: 1 });
      detour.stepped();
      detour.clear();
      detour.disarm();
      expect(detour.pending).toBe(false);
      expect(detour.taken).toBe(0);
    }).not.toThrow();
  });

  it('builds the walk, begins a tapped one and a hint one, and clears them without reading the config', () => {
    expect(() => {
      const walk = new TappedWalk(new WalkForecaster());
      walk.begin(['E'], [{ x: 2, y: 1 }], true);
      expect(walk.active).toBe(true);
      walk.begin(['E'], [{ x: 2, y: 1 }], false);
      walk.clear();
      expect(walk.active).toBe(false);
      expect(walk.detour.pending).toBe(false);
    }).not.toThrow();
  });
});
