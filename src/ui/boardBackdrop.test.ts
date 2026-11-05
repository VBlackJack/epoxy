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

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  applyBoardBackdrop,
  BOARD_BACKDROP_CSS_VAR,
  BOARD_BACKDROP_FALLBACK,
  isBoardBackdropColour
} from './boardBackdrop';

const read = (root: HTMLElement): string => root.style.getPropertyValue(BOARD_BACKDROP_CSS_VAR);

describe('applyBoardBackdrop', () => {
  it('sets a valid colour', () => {
    const root = document.createElement('div');
    applyBoardBackdrop(root, ' #1a2b3c ');
    expect(read(root)).toBe('#1a2b3c');
  });

  it('falls back when the first colour is invalid', () => {
    const root = document.createElement('div');
    applyBoardBackdrop(root, 'red; background: url(x)');
    expect(read(root)).toBe(BOARD_BACKDROP_FALLBACK);
  });

  it('keeps the previous colour when a later one is invalid', () => {
    const root = document.createElement('div');
    applyBoardBackdrop(root, '#123456');
    applyBoardBackdrop(root, 'not a colour');
    expect(read(root)).toBe('#123456');
  });

  it('accepts rgb and hsl functions and rejects empty strings', () => {
    expect(isBoardBackdropColour('rgb(1, 2, 3)')).toBe(true);
    expect(isBoardBackdropColour('hsl(10 20% 30%)')).toBe(true);
    expect(isBoardBackdropColour('')).toBe(false);
    expect(isBoardBackdropColour('#12')).toBe(false);
  });
});
