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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DPAD_SIDE_CLASSES,
  ORIENTATION_CLASSES,
  TOUCH_CLUSTER_ID,
  TOUCH_OVERLAY_CLASS,
  TOUCH_PAD_ID,
  applyTouchOverlayClasses,
  bindDpadSideSelect,
  parseDpadSide,
  resolveTouchOverlay,
  syncHudGroup,
  syncInventoryInert,
  observeOverlayStrip,
  syncOverlayInert
} from './touchOverlay';
import type { DpadSide } from './touchOverlay';
import { i18n } from '../i18n/I18nManager';

const BODY_CLASS_BEFORE = 'fullscreen-mode';

function mountPage(): string {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.className = BODY_CLASS_BEFORE;
  return document.body.innerHTML;
}

function overlayClasses(): string[] {
  return Array.from(document.body.classList).filter((c) => c !== BODY_CLASS_BEFORE);
}

describe('body classes', () => {
  beforeEach(() => {
    mountPage();
  });

  for (const side of ['left', 'right'] as DpadSide[]) {
    for (const landscape of [true, false]) {
      it(`applies overlay, ${side} and ${landscape ? 'landscape' : 'portrait'}`, () => {
        applyTouchOverlayClasses(document.body, { active: true, side, landscape });
        const other: DpadSide = side === 'left' ? 'right' : 'left';
        expect(document.body.classList.contains(TOUCH_OVERLAY_CLASS)).toBe(true);
        expect(document.body.classList.contains(DPAD_SIDE_CLASSES[side])).toBe(true);
        expect(document.body.classList.contains(DPAD_SIDE_CLASSES[other])).toBe(false);
        expect(document.body.classList.contains(ORIENTATION_CLASSES.landscape)).toBe(landscape);
        expect(document.body.classList.contains(ORIENTATION_CLASSES.portrait)).toBe(!landscape);
        expect(document.body.classList.contains(BODY_CLASS_BEFORE)).toBe(true);
      });
    }
  }

  it('switches side and orientation without leaving the old classes behind', () => {
    applyTouchOverlayClasses(document.body, { active: true, side: 'right', landscape: true });
    applyTouchOverlayClasses(document.body, { active: true, side: 'left', landscape: false });
    expect(overlayClasses().sort()).toEqual(
      [TOUCH_OVERLAY_CLASS, DPAD_SIDE_CLASSES.left, ORIENTATION_CLASSES.portrait].sort()
    );
  });
});

describe('desktop', () => {
  it('leaves the classes and the markup untouched', () => {
    const before = mountPage();
    const active = resolveTouchOverlay({
      fullscreenClass: false,
      standalone: false,
      coarse: false,
      shortSide: 900,
      mode: 'play'
    });
    expect(active).toBe(false);
    applyTouchOverlayClasses(document.body, { active, side: 'right', landscape: true });
    syncOverlayInert(document, active, true);
    syncHudGroup(document.querySelector('.hud-panel'), active, 'unused');
    expect(overlayClasses()).toEqual([]);
    expect(document.body.className).toBe(BODY_CLASS_BEFORE);
    expect(document.body.innerHTML).toBe(before);
  });

  it('removes every overlay class when the layout turns off', () => {
    mountPage();
    applyTouchOverlayClasses(document.body, { active: true, side: 'left', landscape: true });
    applyTouchOverlayClasses(document.body, { active: false, side: 'left', landscape: true });
    expect(overlayClasses()).toEqual([]);
  });
});

describe('pad side select', () => {
  beforeEach(() => {
    mountPage();
  });

  it('is in the essential section of the drawer with both sides', () => {
    const select = document.getElementById('dpad-side-select') as HTMLSelectElement;
    expect(select.closest('.drawer-section')?.querySelector('#fov-select')).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['left', 'right']);
    expect(document.querySelector('label[for="dpad-side-select"]')).not.toBeNull();
  });

  it('reflects the saved side and saves the player choice', () => {
    const select = document.getElementById('dpad-side-select') as HTMLSelectElement;
    const stored: Record<string, string> = {};
    const saved: DpadSide[] = [];
    bindDpadSideSelect(select, parseDpadSide('left'), (side) => {
      saved.push(side);
      stored.dpadSide = side;
    });
    expect(select.value).toBe('left');
    select.value = 'right';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saved).toEqual(['right']);
    expect(stored.dpadSide).toBe('right');
  });

  it('shows the default right side for an invalid stored value', () => {
    const select = document.getElementById('dpad-side-select') as HTMLSelectElement;
    bindDpadSideSelect(select, parseDpadSide('middle'), () => undefined);
    expect(select.value).toBe('right');
  });
});

describe('floating controls', () => {
  beforeEach(() => {
    mountPage();
  });

  it('keeps the original document order: board, pad, HUD, button cluster (the overlay positions them without reordering)', () => {
    const canvas = document.getElementById('game-canvas') as HTMLElement;
    const hud = document.querySelector('.hud-panel') as HTMLElement;
    const cluster = document.getElementById(TOUCH_CLUSTER_ID) as HTMLElement;
    const pad = document.getElementById(TOUCH_PAD_ID) as HTMLElement;
    const follows = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(canvas, pad)).toBe(true);
    expect(follows(pad, hud)).toBe(true);
    expect(follows(hud, cluster)).toBe(true);
  });

  it('has real, labelled buttons in the cluster and keeps it hidden by default', () => {
    const cluster = document.getElementById(TOUCH_CLUSTER_ID) as HTMLElement;
    expect(cluster.hasAttribute('hidden')).toBe(true);
    const buttons = Array.from(cluster.querySelectorAll('button'));
    expect(buttons.map((b) => b.id)).toEqual(['touch-btn-pause', 'touch-btn-undo', 'touch-btn-charge', 'touch-btn-gate', 'touch-btn-menu']);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('data-i18n-aria-label')).toBeTruthy();
      expect(button.getAttribute('data-i18n-title')).toBe(button.getAttribute('data-i18n-aria-label'));
      expect(button.hasAttribute('data-i18n')).toBe(false);
      const icon = button.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.innerHTML).toContain('currentColor');
    }
    expect(cluster.getAttribute('data-i18n-aria-label')).toBeTruthy();
  });

  it('fills the accessible name and tooltip of the icon buttons from the locale', () => {
    i18n.translateDOM(document);
    const names = ['touch-btn-pause', 'touch-btn-undo', 'touch-btn-menu'].map((id) => {
      const button = document.getElementById(id) as HTMLElement;
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.textContent?.trim()).toBe('');
      return button.getAttribute('aria-label');
    });
    expect(new Set(names).size).toBe(3);
  });

  it('gives every HUD counter label a short form hidden from screen readers next to the long one', () => {
    i18n.translateDOM(document);
    for (const id of ['hud-chips-label', 'hud-targets-label', 'hud-receivers-label']) {
      const label = document.getElementById(id) as HTMLElement;
      const long = label.querySelector('.led-label-long');
      const short = label.querySelector('.led-label-short');
      expect(long?.textContent).toBeTruthy();
      expect(short?.textContent).toBeTruthy();
      expect(short?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  describe('strip observer', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('observes the HUD and the cluster, reports size changes and disconnects', () => {
      const observed: Element[] = [];
      const disconnect = vi.fn();
      let notify: () => void = () => undefined;
      class FakeObserver {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe(el: Element): void {
          observed.push(el);
        }
        disconnect = disconnect;
      }
      vi.stubGlobal('ResizeObserver', FakeObserver);
      const onChange = vi.fn();
      const stop = observeOverlayStrip(document, onChange);
      expect(observed).toEqual([document.querySelector('.hud-panel'), document.getElementById(TOUCH_CLUSTER_ID)]);
      notify();
      expect(onChange).toHaveBeenCalledTimes(1);
      stop();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('is a harmless no-op without ResizeObserver', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      expect(() => observeOverlayStrip(document, () => undefined)()).not.toThrow();
    });
  });

  it('makes the pad and the cluster inert while the pause card shows', () => {
    const pad = document.getElementById(TOUCH_PAD_ID) as HTMLElement;
    const cluster = document.getElementById(TOUCH_CLUSTER_ID) as HTMLElement;
    syncOverlayInert(document, true, true);
    expect(pad.hasAttribute('inert')).toBe(true);
    expect(cluster.hasAttribute('inert')).toBe(true);
    syncOverlayInert(document, true, false);
    expect(pad.hasAttribute('inert')).toBe(false);
    expect(cluster.hasAttribute('inert')).toBe(false);
  });

  it('never makes them inert outside the overlay layout', () => {
    syncOverlayInert(document, false, true);
    expect(document.getElementById(TOUCH_PAD_ID)?.hasAttribute('inert')).toBe(false);
  });

  it('groups the HUD with a label only while it floats', () => {
    const hud = document.querySelector('.hud-panel') as HTMLElement;
    syncHudGroup(hud, true, 'Level status');
    expect(hud.getAttribute('role')).toBe('group');
    expect(hud.getAttribute('aria-label')).toBe('Level status');
    syncHudGroup(hud, false, 'Level status');
    expect(hud.hasAttribute('role')).toBe(false);
    expect(hud.hasAttribute('aria-label')).toBe(false);
  });

  it('makes the item strip inert in the overlay layout and active again after', () => {
    const hud = document.querySelector('.hud-panel');
    const strips = Array.from(document.querySelectorAll('.hud-panel .inventory-row-split'));
    expect(strips.length).toBeGreaterThan(0);
    syncInventoryInert(hud, true);
    expect(strips.every((s) => s.hasAttribute('inert'))).toBe(true);
    syncInventoryInert(hud, false);
    expect(strips.some((s) => s.hasAttribute('inert'))).toBe(false);
  });

  it('adds the extra pause card actions, hidden until the overlay layout needs them', () => {
    for (const id of ['overlay-btn-hint', 'overlay-btn-solution', 'overlay-btn-options', 'overlay-btn-exit-fullscreen']) {
      const button = document.getElementById(id);
      expect(button?.classList.contains('hidden')).toBe(true);
      expect(button?.closest('#viewport-overlay')).not.toBeNull();
    }
  });
});
