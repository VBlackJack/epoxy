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
 * The two side drawers of the phone layout (level and inventory on the left, game menu on the right).
 * They are modal dialogs: src/ui/dialog.ts shows them, traps focus, closes on Escape and gives focus back
 * to the tab that opened them, and the open dialog is what freezes the game. A tab opens a drawer; the
 * scrim, Escape, or a swipe on the drawer toward its edge closes it. There is no edge swipe to open:
 * the screen edges belong to the operating system gestures.
 */

import { closeDialog, isDialogOpen, openDialog } from './dialog';

export type DrawerSide = 'left' | 'right';

/** Class set on the drawer while it shows (the stylesheet slides it in). */
export const DRAWER_OPEN_CLASS = 'touch-drawer-open';
/** Attribute marking an element that was set up as a drawer, with its side. */
export const DRAWER_MARK_ATTRIBUTE = 'data-touch-drawer';
/** Class dialog.ts uses to hide a dialog. */
const HIDDEN_CLASS = 'hidden';
const DIALOG_ROLE = 'dialog';
/** Fallback ids for a drawer or a tab whose markup has none. */
const FALLBACK_DRAWER_IDS: Record<DrawerSide, string> = { left: 'touch-drawer-left', right: 'touch-drawer-right' };

/** A swipe on a drawer toward its edge closes it from this horizontal distance. */
export const DRAWER_SWIPE_CLOSE_MIN_PX = 40;
/** ...when the horizontal travel exceeds the vertical travel by this factor. */
export const DRAWER_SWIPE_AXIS_RATIO = 2;

export interface DrawerSpec {
  side: DrawerSide;
  /** The panel. */
  drawer: HTMLElement;
  /** The button that opens it and gets focus back when it closes. */
  tab: HTMLElement;
  /** Id of the element inside the drawer that names it (aria-labelledby). */
  titleId: string;
  /** What to do with the element when the drawers are torn down: closed (true) or shown as plain markup (false). */
  hideWhenOff: boolean;
}

export interface TouchDrawersOptions {
  left: DrawerSpec;
  right: DrawerSpec;
  /** The dimmer behind an open drawer; a tap on it closes the drawer. */
  scrim: HTMLElement;
  /** A drawer opened (the caller clears held input here). */
  onOpen?: (side: DrawerSide) => void;
  /** A drawer closed, whatever closed it. */
  onClose?: (side: DrawerSide) => void;
}

export interface TouchDrawers {
  open: (side: DrawerSide) => void;
  close: (side: DrawerSide) => void;
  closeAll: () => void;
  isOpen: (side: DrawerSide) => boolean;
  anyOpen: () => boolean;
  /** Closes both, unbinds every listener and strips the drawer attributes. */
  destroy: () => void;
}

/** True when a horizontal travel of `dx` and a vertical one of `dy` is a swipe toward the edge of `side`. */
export function isSwipeTowardEdge(side: DrawerSide, dx: number, dy: number): boolean {
  const toward = side === 'left' ? -dx : dx;
  return toward >= DRAWER_SWIPE_CLOSE_MIN_PX && Math.abs(dx) > DRAWER_SWIPE_AXIS_RATIO * Math.abs(dy);
}

/**
 * Closes an element that was used as a drawer and strips what the drawer setup put on it: role dialog,
 * aria-modal, inert, aria-labelledby, the open class and the hidden state. With `hide` the element is left
 * closed (a drawer that only exists in the phone layout); without it the element is plain markup again
 * (the HUD panel, which shows on every layout). Safe to call on an element that never was a drawer.
 */
export function teardownTouchDrawer(el: HTMLElement, hide = false): void {
  closeDialog(el);
  el.classList.remove(DRAWER_OPEN_CLASS, HIDDEN_CLASS);
  el.removeAttribute('hidden');
  el.removeAttribute('inert');
  el.removeAttribute('aria-modal');
  if (el.getAttribute('role') === DIALOG_ROLE) el.removeAttribute('role');
  if (el.hasAttribute(DRAWER_MARK_ATTRIBUTE)) {
    el.removeAttribute('aria-labelledby');
    el.removeAttribute(DRAWER_MARK_ATTRIBUTE);
  }
  // openDialog gives a drawer without focusable content a tabindex of -1 so it can take focus.
  if (el.getAttribute('tabindex') === '-1') el.removeAttribute('tabindex');
  if (hide) el.classList.add(HIDDEN_CLASS);
}

/** Sets the two drawers up closed and binds the tabs, the scrim and the close swipe. */
export function setupTouchDrawers(options: TouchDrawersOptions): TouchDrawers {
  const specs: Record<DrawerSide, DrawerSpec> = { left: options.left, right: options.right };
  const sides: DrawerSide[] = ['left', 'right'];
  const cleanups: Array<() => void> = [];

  const showScrim = (): void => {
    options.scrim.classList.toggle(HIDDEN_CLASS, !sides.some((s) => isDialogOpen(specs[s].drawer)));
  };

  const markClosed = (spec: DrawerSpec): void => {
    spec.drawer.classList.remove(DRAWER_OPEN_CLASS);
    spec.drawer.classList.add(HIDDEN_CLASS);
    spec.drawer.setAttribute('inert', '');
    spec.tab.setAttribute('aria-expanded', 'false');
  };

  const close = (side: DrawerSide): void => {
    const spec = specs[side];
    if (isDialogOpen(spec.drawer)) closeDialog(spec.drawer);
  };

  const open = (side: DrawerSide): void => {
    const spec = specs[side];
    if (isDialogOpen(spec.drawer)) return;
    const other: DrawerSide = side === 'left' ? 'right' : 'left';
    close(other);
    spec.drawer.removeAttribute('inert');
    spec.drawer.classList.add(DRAWER_OPEN_CLASS);
    spec.tab.setAttribute('aria-expanded', 'true');
    options.scrim.classList.remove(HIDDEN_CLASS);
    options.onOpen?.(side);
    openDialog(spec.drawer, spec.tab, {
      onClose: () => {
        markClosed(spec);
        showScrim();
        options.onClose?.(side);
      }
    });
  };

  for (const side of sides) {
    const spec = specs[side];
    if (!spec.drawer.id) spec.drawer.id = FALLBACK_DRAWER_IDS[side];
    spec.drawer.setAttribute(DRAWER_MARK_ATTRIBUTE, side);
    spec.drawer.setAttribute('role', DIALOG_ROLE);
    spec.drawer.setAttribute('aria-modal', 'true');
    spec.drawer.setAttribute('aria-labelledby', spec.titleId);
    spec.tab.setAttribute('aria-controls', spec.drawer.id);
    markClosed(spec);

    const onTab = (): void => {
      if (isDialogOpen(spec.drawer)) close(side);
      else open(side);
    };
    spec.tab.addEventListener('click', onTab);
    cleanups.push(() => spec.tab.removeEventListener('click', onTab));

    // Swipe toward the edge: one finger, decided as soon as the travel is clear.
    let swipe: { pointerId: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent): void => {
      if (swipe === null) swipe = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent): void => {
      if (swipe === null || e.pointerId !== swipe.pointerId) return;
      if (isSwipeTowardEdge(side, e.clientX - swipe.x, e.clientY - swipe.y)) {
        swipe = null;
        close(side);
      }
    };
    const onEnd = (e: PointerEvent): void => {
      if (swipe !== null && e.pointerId === swipe.pointerId) swipe = null;
    };
    spec.drawer.addEventListener('pointerdown', onDown);
    spec.drawer.addEventListener('pointermove', onMove);
    spec.drawer.addEventListener('pointerup', onEnd);
    spec.drawer.addEventListener('pointercancel', onEnd);
    cleanups.push(() => {
      spec.drawer.removeEventListener('pointerdown', onDown);
      spec.drawer.removeEventListener('pointermove', onMove);
      spec.drawer.removeEventListener('pointerup', onEnd);
      spec.drawer.removeEventListener('pointercancel', onEnd);
    });
  }

  const onScrim = (): void => {
    for (const side of sides) close(side);
  };
  options.scrim.addEventListener('click', onScrim);
  cleanups.push(() => options.scrim.removeEventListener('click', onScrim));
  options.scrim.classList.add(HIDDEN_CLASS);

  return {
    open,
    close,
    closeAll: onScrim,
    isOpen: (side) => isDialogOpen(specs[side].drawer),
    anyOpen: () => sides.some((s) => isDialogOpen(specs[s].drawer)),
    destroy: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const side of sides) {
        const spec = specs[side];
        teardownTouchDrawer(spec.drawer, spec.hideWhenOff);
        spec.tab.removeAttribute('aria-expanded');
        spec.tab.removeAttribute('aria-controls');
      }
      options.scrim.classList.add(HIDDEN_CLASS);
    }
  };
}
