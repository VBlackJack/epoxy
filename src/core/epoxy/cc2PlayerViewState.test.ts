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
import { copyCc2PlayerView, copyCc3dArrival } from './epoxyWorld';
import type { Cc2PlayerView, Cc3dPlayerArrival } from '../types';

describe('CC2 player view and step-end opening state', () => {
  it('copies the opening cell of a pending step end without sharing it', () => {
    const arrival: Cc3dPlayerArrival = { opening: { x: 3, y: 4 } };
    const copy = copyCc3dArrival(arrival);
    expect(copy).toEqual(arrival);
    expect(copy.opening).not.toBe(arrival.opening);
  });

  it('copies the player view with its source pad without sharing it', () => {
    const view: Cc2PlayerView = { x: 1, y: 2, dir: 'E', cooldown: 2, stepLength: 4, sourcePad: { x: 5, y: 6 } };
    const copy = copyCc2PlayerView(view);
    expect(copy).toEqual(view);
    expect(copy.sourcePad).not.toBe(view.sourcePad);
  });
});
