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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDialogOpen } from './dialog';
import { pressKey, stubLayout } from '../test/domFixture';
import {
  DRAWER_OPEN_CLASS,
  DRAWER_SWIPE_CLOSE_MIN_PX,
  isSwipeTowardEdge,
  setupTouchDrawers,
  teardownTouchDrawer
} from './touchDrawers';
import type { TouchDrawers } from './touchDrawers';

const MARKUP = `
  <button id="tab-left" type="button">L</button>
  <button id="tab-right" type="button">R</button>
  <aside class="hud-panel" id="left-panel" role="group" aria-label="Level status">
    <h2 id="left-title">Level</h2><button id="left-btn" type="button">undo</button>
  </aside>
  <aside id="right-panel" class="hidden">
    <h2 id="right-title">Menu</h2><button id="right-btn" type="button">resume</button>
  </aside>
  <div id="scrim" class="hidden"></div>`;

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function pointer(type: string, target: Element, id: number, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y })
  );
}

describe('isSwipeTowardEdge', () => {
  it('needs the minimum travel toward the edge of the side', () => {
    expect(isSwipeTowardEdge('left', -DRAWER_SWIPE_CLOSE_MIN_PX, 0)).toBe(true);
    expect(isSwipeTowardEdge('left', -(DRAWER_SWIPE_CLOSE_MIN_PX - 1), 0)).toBe(false);
    expect(isSwipeTowardEdge('right', DRAWER_SWIPE_CLOSE_MIN_PX, 0)).toBe(true);
  });

  it('refuses the opposite direction and a travel that is too diagonal', () => {
    expect(isSwipeTowardEdge('left', DRAWER_SWIPE_CLOSE_MIN_PX, 0)).toBe(false);
    expect(isSwipeTowardEdge('right', -DRAWER_SWIPE_CLOSE_MIN_PX, 0)).toBe(false);
    expect(isSwipeTowardEdge('left', -60, 30)).toBe(false);
    expect(isSwipeTowardEdge('left', -60, 29)).toBe(true);
  });
});

describe('touch drawers', () => {
  let drawers: TouchDrawers;
  let opened: string[];
  let closed: string[];

  beforeEach(() => {
    stubLayout();
    document.body.innerHTML = MARKUP;
    opened = [];
    closed = [];
    drawers = setupTouchDrawers({
      left: { side: 'left', drawer: el('left-panel'), tab: el('tab-left'), titleId: 'left-title', hideWhenOff: false },
      right: { side: 'right', drawer: el('right-panel'), tab: el('tab-right'), titleId: 'right-title', hideWhenOff: true },
      scrim: el('scrim'),
      onOpen: (side) => opened.push(side),
      onClose: (side) => closed.push(side)
    });
  });

  afterEach(() => {
    drawers.destroy();
  });

  it('starts closed and inert, as modal dialogs named by their title, with wired tabs', () => {
    for (const [panel, tab, title] of [
      ['left-panel', 'tab-left', 'left-title'],
      ['right-panel', 'tab-right', 'right-title']
    ]) {
      expect(el(panel).getAttribute('role')).toBe('dialog');
      expect(el(panel).getAttribute('aria-modal')).toBe('true');
      expect(el(panel).getAttribute('aria-labelledby')).toBe(title);
      expect(el(panel).hasAttribute('inert')).toBe(true);
      expect(el(panel).classList.contains('hidden')).toBe(true);
      expect(el(tab).getAttribute('aria-expanded')).toBe('false');
      expect(el(tab).getAttribute('aria-controls')).toBe(el(panel).id);
    }
    expect(el('scrim').classList.contains('hidden')).toBe(true);
  });

  it('opens from the tab: dialog open, scrim shown, tab expanded', () => {
    el('tab-left').click();
    expect(isDialogOpen(el('left-panel'))).toBe(true);
    expect(el('left-panel').hasAttribute('inert')).toBe(false);
    expect(el('left-panel').classList.contains(DRAWER_OPEN_CLASS)).toBe(true);
    expect(el('left-panel').classList.contains('hidden')).toBe(false);
    expect(el('scrim').classList.contains('hidden')).toBe(false);
    expect(el('tab-left').getAttribute('aria-expanded')).toBe('true');
    expect(opened).toEqual(['left']);
    expect(drawers.isOpen('left')).toBe(true);
    expect(drawers.anyOpen()).toBe(true);
  });

  it('closes on a scrim click and gives focus back to the tab', () => {
    el('tab-right').focus();
    el('tab-right').click();
    expect(document.activeElement).toBe(el('right-btn'));
    el('scrim').click();
    expect(isDialogOpen(el('right-panel'))).toBe(false);
    expect(el('right-panel').hasAttribute('inert')).toBe(true);
    expect(el('scrim').classList.contains('hidden')).toBe(true);
    expect(el('tab-right').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('tab-right'));
    expect(closed).toEqual(['right']);
  });

  it('closes on Escape', () => {
    el('tab-left').click();
    pressKey(document.activeElement ?? document.body, 'Escape');
    expect(drawers.anyOpen()).toBe(false);
    expect(document.activeElement).toBe(el('tab-left'));
  });

  it('closes when the tab is pressed again', () => {
    el('tab-left').click();
    el('tab-left').click();
    expect(drawers.anyOpen()).toBe(false);
  });

  it('closes on a swipe toward its edge only', () => {
    el('tab-left').click();
    pointer('pointerdown', el('left-panel'), 1, 200, 300);
    pointer('pointermove', el('left-panel'), 1, 240, 300);
    expect(drawers.isOpen('left')).toBe(true);
    pointer('pointerup', el('left-panel'), 1, 240, 300);
    pointer('pointerdown', el('left-panel'), 2, 200, 300);
    pointer('pointermove', el('left-panel'), 2, 150, 340);
    expect(drawers.isOpen('left')).toBe(true);
    pointer('pointermove', el('left-panel'), 2, 150, 310);
    expect(drawers.isOpen('left')).toBe(false);

    el('tab-right').click();
    pointer('pointerdown', el('right-panel'), 3, 100, 300);
    pointer('pointermove', el('right-panel'), 3, 150, 300);
    expect(drawers.isOpen('right')).toBe(false);
  });

  it('keeps only one drawer open at a time', () => {
    el('tab-left').click();
    el('tab-right').click();
    expect(drawers.isOpen('left')).toBe(false);
    expect(drawers.isOpen('right')).toBe(true);
    expect(el('scrim').classList.contains('hidden')).toBe(false);
    expect(closed).toEqual(['left']);
  });
});

describe('teardown', () => {
  beforeEach(() => {
    stubLayout();
    document.body.innerHTML = MARKUP;
  });

  function setup(): TouchDrawers {
    return setupTouchDrawers({
      left: { side: 'left', drawer: el('left-panel'), tab: el('tab-left'), titleId: 'left-title', hideWhenOff: false },
      right: { side: 'right', drawer: el('right-panel'), tab: el('tab-right'), titleId: 'right-title', hideWhenOff: true },
      scrim: el('scrim')
    });
  }

  function expectPlainPanel(panel: HTMLElement): void {
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(panel.classList.contains(DRAWER_OPEN_CLASS)).toBe(false);
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(panel.getAttribute('role')).not.toBe('dialog');
    expect(panel.hasAttribute('aria-labelledby')).toBe(false);
    expect(panel.hasAttribute('data-touch-drawer')).toBe(false);
    expect(panel.hasAttribute('tabindex')).toBe(false);
  }

  it('turns the HUD panel back into plain markup when the drawer is closed', () => {
    const drawers = setup();
    el('left-panel').setAttribute('hidden', '');
    drawers.destroy();
    expectPlainPanel(el('left-panel'));
    expect(isDialogOpen()).toBe(false);
  });

  it('closes an open drawer, then strips it', () => {
    const drawers = setup();
    el('tab-left').click();
    expect(isDialogOpen(el('left-panel'))).toBe(true);
    drawers.destroy();
    expect(isDialogOpen()).toBe(false);
    expectPlainPanel(el('left-panel'));
    expect(el('tab-left').hasAttribute('aria-expanded')).toBe(false);
    expect(el('tab-left').hasAttribute('aria-controls')).toBe(false);
    expect(el('scrim').classList.contains('hidden')).toBe(true);
  });

  it('leaves the right drawer closed, not shown', () => {
    const drawers = setup();
    el('tab-right').click();
    drawers.destroy();
    expect(isDialogOpen()).toBe(false);
    expect(el('right-panel').classList.contains('hidden')).toBe(true);
    expect(el('right-panel').hasAttribute('inert')).toBe(false);
    expect(el('right-panel').getAttribute('role')).toBeNull();
  });

  it('stops answering the tabs, the scrim and the swipe', () => {
    const drawers = setup();
    drawers.destroy();
    el('tab-left').click();
    expect(isDialogOpen()).toBe(false);
  });

  it('keeps the group role the HUD had when it is not a dialog', () => {
    teardownTouchDrawer(el('left-panel'));
    expect(el('left-panel').getAttribute('role')).toBe('group');
    expect(el('left-panel').getAttribute('aria-label')).toBe('Level status');
  });

  it('does nothing harmful to an element that never was a drawer', () => {
    expect(() => teardownTouchDrawer(el('left-btn'))).not.toThrow();
    expect(el('left-btn').getAttribute('type')).toBe('button');
  });
});
