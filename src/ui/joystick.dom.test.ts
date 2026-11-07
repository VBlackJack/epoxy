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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Direction } from '../core/types';
import { FloatingJoystick, JOYSTICK_ACTIVE_CLASS, JOYSTICK_BASE_CLASS, joystickOptionsFromTouchConfig } from './joystick';

const OPTIONS = joystickOptionsFromTouchConfig();

interface Harness {
  zone: HTMLElement;
  button: HTMLElement;
  joystick: FloatingJoystick;
  directions: Array<Direction | null>;
  taps: Array<[number, number]>;
  engages: Direction[];
  clock: { now: number };
}

function pointer(type: string, target: Element, id: number, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    ...init
  });
  target.dispatchEvent(event);
  return event;
}

function setup(): Harness {
  document.body.innerHTML = '<div id="zone"><button id="b" type="button">x</button></div>';
  const zone = document.getElementById('zone') as HTMLElement;
  const button = document.getElementById('b') as HTMLElement;
  const directions: Array<Direction | null> = [];
  const taps: Array<[number, number]> = [];
  const engages: Direction[] = [];
  const clock = { now: 0 };
  const joystick = new FloatingJoystick(
    zone,
    OPTIONS,
    {
      onDirection: (dir) => directions.push(dir),
      onTap: (x, y) => taps.push([x, y]),
      onEngage: (dir) => engages.push(dir)
    },
    () => clock.now
  );
  return { zone, button, joystick, directions, taps, engages, clock };
}

describe('FloatingJoystick', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('shows the base at the touch point and hides it on release', () => {
    const base = h.zone.querySelector(`.${JOYSTICK_BASE_CLASS}`) as HTMLElement;
    expect(base.hidden).toBe(true);
    pointer('pointerdown', h.zone, 1, 120, 300);
    expect(base.hidden).toBe(false);
    expect(base.style.transform).toBe('translate(120px, 300px)');
    expect(h.zone.classList.contains(JOYSTICK_ACTIVE_CLASS)).toBe(true);
    pointer('pointerup', h.zone, 1, 120, 300);
    expect(base.hidden).toBe(true);
    expect(h.zone.classList.contains(JOYSTICK_ACTIVE_CLASS)).toBe(false);
  });

  it('reports the engage once, each change of direction, and the release', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 108, 100);
    expect(h.directions).toEqual([]);
    pointer('pointermove', h.zone, 1, 116, 100);
    pointer('pointermove', h.zone, 1, 118, 100);
    expect(h.directions).toEqual(['E']);
    expect(h.engages).toEqual(['E']);
    pointer('pointermove', h.zone, 1, 89, 100);
    expect(h.directions).toEqual(['E', 'W']);
    expect(h.engages).toEqual(['E']);
    pointer('pointerup', h.zone, 1, 89, 100);
    expect(h.directions).toEqual(['E', 'W', null]);
    expect(h.taps).toEqual([]);
  });

  it('releases under the release radius while the finger stays down', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 116, 100);
    pointer('pointermove', h.zone, 1, 104, 100);
    expect(h.directions).toEqual(['E', null]);
    pointer('pointermove', h.zone, 1, 120, 100);
    expect(h.engages).toEqual(['E', 'E']);
  });

  it('reports a tap for a short, small touch and not for a long or moving one', () => {
    pointer('pointerdown', h.zone, 1, 50, 60);
    h.clock.now = 100;
    pointer('pointerup', h.zone, 1, 52, 61);
    expect(h.taps).toEqual([[52, 61]]);

    pointer('pointerdown', h.zone, 2, 50, 60);
    h.clock.now = 100 + OPTIONS.tapMaxDurationMs + 1;
    pointer('pointerup', h.zone, 2, 50, 60);
    expect(h.taps).toHaveLength(1);

    h.clock.now = 1000;
    pointer('pointerdown', h.zone, 3, 50, 60);
    pointer('pointermove', h.zone, 3, 50 + OPTIONS.tapMaxDistancePx + 1, 60);
    pointer('pointermove', h.zone, 3, 50, 60);
    pointer('pointerup', h.zone, 3, 50, 60);
    expect(h.taps).toHaveLength(1);
  });

  it('ignores a pointerdown that lands on a button', () => {
    pointer('pointerdown', h.button, 1, 10, 10);
    pointer('pointermove', h.zone, 1, 60, 10);
    expect(h.directions).toEqual([]);
    expect(h.zone.classList.contains(JOYSTICK_ACTIVE_CLASS)).toBe(false);
  });

  it('follows the first pointer only', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointerdown', h.zone, 2, 300, 300);
    pointer('pointermove', h.zone, 2, 360, 300);
    expect(h.directions).toEqual([]);
    pointer('pointermove', h.zone, 1, 120, 100);
    expect(h.directions).toEqual(['E']);
    pointer('pointerup', h.zone, 2, 360, 300);
    expect(h.directions).toEqual(['E']);
    pointer('pointerup', h.zone, 1, 120, 100);
    expect(h.directions).toEqual(['E', null]);
  });

  it('lets go on pointercancel without a tap', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 120, 100);
    pointer('pointercancel', h.zone, 1, 120, 100);
    expect(h.directions).toEqual(['E', null]);
    expect(h.taps).toEqual([]);
    pointer('pointermove', h.zone, 1, 140, 100);
    expect(h.directions).toEqual(['E', null]);
  });

  it('lets go on lostpointercapture', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 100, 80);
    expect(h.directions).toEqual(['N']);
    pointer('lostpointercapture', h.zone, 1, 100, 80);
    expect(h.directions).toEqual(['N', null]);
    expect(h.taps).toEqual([]);
  });

  it('asks for the capture on pointerdown and gives it back on pointerup', () => {
    const set = vi.fn();
    const release = vi.fn();
    h.zone.setPointerCapture = set;
    h.zone.releasePointerCapture = release;
    pointer('pointerdown', h.zone, 7, 10, 10);
    expect(set).toHaveBeenCalledWith(7);
    pointer('pointerup', h.zone, 7, 10, 10);
    expect(release).toHaveBeenCalledWith(7);
  });

  it('needs a fresh pointerdown after requireFreshPointerDown', () => {
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 120, 100);
    h.joystick.requireFreshPointerDown();
    expect(h.directions).toEqual(['E', null]);
    pointer('pointermove', h.zone, 1, 140, 100);
    pointer('pointerup', h.zone, 1, 140, 100);
    expect(h.directions).toEqual(['E', null]);
    expect(h.taps).toEqual([]);
    pointer('pointerdown', h.zone, 2, 100, 100);
    pointer('pointermove', h.zone, 2, 100, 120);
    expect(h.directions).toEqual(['E', null, 'S']);
  });

  it('ignores touches while disabled and after destroy', () => {
    h.joystick.setEnabled(false);
    pointer('pointerdown', h.zone, 1, 100, 100);
    pointer('pointermove', h.zone, 1, 140, 100);
    expect(h.directions).toEqual([]);
    h.joystick.setEnabled(true);
    h.joystick.destroy();
    expect(h.zone.querySelector(`.${JOYSTICK_BASE_CLASS}`)).toBeNull();
    pointer('pointerdown', h.zone, 2, 100, 100);
    pointer('pointermove', h.zone, 2, 140, 100);
    expect(h.directions).toEqual([]);
  });

  it('ignores a right mouse button', () => {
    pointer('pointerdown', h.zone, 1, 100, 100, { pointerType: 'mouse', button: 2 });
    pointer('pointermove', h.zone, 1, 140, 100, { pointerType: 'mouse' });
    expect(h.directions).toEqual([]);
  });
});
