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

/** The part of an element the toggle helper writes to. */
export interface ToggleElement {
  classList: { toggle(token: string, force?: boolean): boolean };
  setAttribute(name: string, value: string): void;
}

const ACTIVE_CLASS = 'active';
const PRESSED_ATTRIBUTE = 'aria-pressed';

/**
 * Shows a toggle button as on or off: the visual `.active` class and the
 * `aria-pressed` state stay in step so assistive technology reads what the
 * eye sees. Not for buttons whose label flips with the state.
 */
export function setToggleState(el: ToggleElement | null, on: boolean): void {
  if (!el) return;
  el.classList.toggle(ACTIVE_CLASS, on);
  el.setAttribute(PRESSED_ATTRIBUTE, String(on));
}
