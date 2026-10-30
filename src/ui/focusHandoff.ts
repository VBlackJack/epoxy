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

/**
 * Hands keyboard focus back to the game after a pointer interaction, so the
 * game keys work again, without taking focus away from keyboard users.
 */

/**
 * A click that comes from a pointer reports a detail of 1 or more; a click
 * synthesized by Enter or Space on a focused button reports 0.
 */
export function isPointerActivation(clickDetail: number): boolean {
  return clickDetail > 0;
}

/**
 * Blurs a button after a pointer click on it, inside `container`. One
 * delegated listener covers every button, present or added later. Focus that
 * a click handler moved elsewhere (a dialog opening) is left alone.
 */
export function bindButtonPointerBlur(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    if (!isPointerActivation(e.detail)) return;
    const target = e.target instanceof Element ? e.target : null;
    const button = target?.closest('button');
    if (button && document.activeElement === button) button.blur();
  });
}

/**
 * Blurs a select once the player changed it with the pointer. A keyboard user
 * arrowing through the options keeps focus on the select: the pointer flag is
 * set on pointerdown and cleared on blur, on any key press and after a change.
 */
export function bindSelectPointerBlur(select: HTMLSelectElement | null): void {
  if (!select) return;
  let pointerDriven = false;
  select.addEventListener('pointerdown', () => {
    pointerDriven = true;
  });
  select.addEventListener('keydown', () => {
    pointerDriven = false;
  });
  select.addEventListener('blur', () => {
    pointerDriven = false;
  });
  select.addEventListener('change', () => {
    if (pointerDriven) select.blur();
    pointerDriven = false;
  });
}
