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
import { HeldKeys, supportsHeldMove } from './heldKeys';

describe('HeldKeys', () => {
  it('moves a fresh press of a held code to the front, but keeps place on auto-repeat', () => {
    const h = new HeldKeys();
    h.press('ArrowUp', 'N');
    h.press('ArrowRight', 'E');
    h.press('ArrowUp', 'N', true);
    expect(h.directions()).toEqual(['E', 'N']);
    h.press('ArrowUp', 'N');
    expect(h.directions()).toEqual(['N', 'E']);
    h.release('ArrowUp');
    expect(h.directions()).toEqual(['E']);
  });

  it('is empty at start', () => {
    const h = new HeldKeys();
    expect(h.current()).toBeNull();
    expect(h.directions()).toEqual([]);
  });

  it('orders directions most recent first', () => {
    const h = new HeldKeys();
    h.press('ArrowUp', 'N');
    h.press('ArrowRight', 'E');
    expect(h.directions()).toEqual(['E', 'N']);
    expect(h.current()).toBe('E');
  });

  it('keeps the order on key repeat', () => {
    const h = new HeldKeys();
    h.press('ArrowUp', 'N');
    h.press('ArrowRight', 'E');
    h.press('ArrowUp', 'N', true);
    expect(h.directions()).toEqual(['E', 'N']);
  });

  it('falls back to the older key on release', () => {
    const h = new HeldKeys();
    h.press('ArrowUp', 'N');
    h.press('ArrowRight', 'E');
    expect(h.release('ArrowRight')).toBe(true);
    expect(h.current()).toBe('N');
    expect(h.release('ArrowRight')).toBe(false);
  });

  it('lists a direction once when two codes map to it', () => {
    const h = new HeldKeys();
    h.press('KeyW', 'N');
    h.press('ArrowUp', 'N');
    expect(h.directions()).toEqual(['N']);
    h.release('ArrowUp');
    expect(h.current()).toBe('N');
  });

  it('clears everything', () => {
    const h = new HeldKeys();
    h.press('KeyW', 'N');
    h.clear();
    expect(h.current()).toBeNull();
    expect(h.has('KeyW')).toBe(false);
  });
});

describe('supportsHeldMove', () => {
  it('checks for the method', () => {
    expect(supportsHeldMove({})).toBe(false);
    expect(supportsHeldMove({ attemptPlayerMoveHeld: () => true })).toBe(true);
  });
});
