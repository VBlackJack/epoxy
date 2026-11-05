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

/** CSS custom property read by the board stylesheet for the space around a level. */
export const BOARD_BACKDROP_CSS_VAR = '--board-backdrop';
/** Colour used when none was ever applied successfully. */
export const BOARD_BACKDROP_FALLBACK = '#000';

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_COLOUR = /^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%,/\s]+\)$/i;

/** True for a hex, rgb() or hsl() colour; anything else could break the declaration. */
export function isBoardBackdropColour(colour: string): boolean {
  const value = colour.trim();
  return HEX_COLOUR.test(value) || FUNCTION_COLOUR.test(value);
}

/**
 * Sets the board backdrop variable on `root`. An invalid colour keeps the previous value, or sets
 * the fallback when none was set yet.
 */
export function applyBoardBackdrop(root: HTMLElement, colour: string): void {
  const value = typeof colour === 'string' ? colour.trim() : '';
  if (isBoardBackdropColour(value)) {
    root.style.setProperty(BOARD_BACKDROP_CSS_VAR, value);
    return;
  }
  if (!root.style.getPropertyValue(BOARD_BACKDROP_CSS_VAR)) {
    root.style.setProperty(BOARD_BACKDROP_CSS_VAR, BOARD_BACKDROP_FALLBACK);
  }
}
