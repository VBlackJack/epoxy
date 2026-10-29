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

export interface InventorySlotState {
  owned: boolean;
  /** Badge text; empty hides the badge. */
  badge: string;
  label: string;
  iconUrl: string;
}

/** True when the slot DOM must be touched to show `next`. */
export function slotStateChanged(prev: InventorySlotState | null, next: InventorySlotState): boolean {
  return (
    !prev ||
    prev.owned !== next.owned ||
    prev.badge !== next.badge ||
    prev.label !== next.label ||
    prev.iconUrl !== next.iconUrl
  );
}

/**
 * One HUD inventory slot. The elements are created once; update() writes to
 * the DOM only when the displayed state changed, so it is cheap per tick.
 */
export class InventorySlotView {
  private readonly slot: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly badgeEl: HTMLSpanElement;
  private state: InventorySlotState | null = null;

  public constructor(container: HTMLElement) {
    this.slot = document.createElement('div');
    this.slot.className = 'inv-slot';
    this.img = document.createElement('img');
    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'inv-count hidden';
    this.slot.append(this.img, this.badgeEl);
    container.appendChild(this.slot);
  }

  public update(next: InventorySlotState): void {
    if (!slotStateChanged(this.state, next)) return;
    this.slot.classList.toggle('owned', next.owned);
    this.slot.title = next.label;
    this.img.alt = next.label;
    if (this.img.src !== next.iconUrl) {
      this.img.src = next.iconUrl;
    }
    this.badgeEl.textContent = next.badge;
    this.badgeEl.classList.toggle('hidden', next.badge === '');
    this.state = { ...next };
  }
}
