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
import { beforeEach, describe, expect, it } from 'vitest';
import { featuresFor } from '../core/RulesetFeatures';
import { AimMode, turnDirectionForChord } from './aimInput';
import type { MoveKeyCodes, TurnChord } from './aimInput';

const KEYS: MoveKeyCodes = {
  moveUp: ['ArrowUp', 'KeyW'],
  moveDown: ['ArrowDown', 'KeyS'],
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD']
};

const EPOXY_LEVEL = {};
const CLASSIC_LEVEL = { rulesFlavor: 'cc' as const };

function chord(code: string, patch: Partial<TurnChord> = {}): TurnChord {
  return { code, shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, ...patch };
}

function mountPage(): HTMLButtonElement {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  return document.getElementById('touch-btn-aim') as HTMLButtonElement;
}

/** What the game does on a level: the aim button shows when the ruleset turns in place and the level has a stone. */
function syncFor(aim: AimMode, level: object, levelHasStone: boolean, holdsStone: boolean): void {
  const turns = featuresFor(level).turnInPlace;
  aim.sync(turns && levelHasStone, holdsStone);
}

describe('Shift + arrow', () => {
  it('turns toward the key on an Epoxy level, by physical key (arrows, WASD)', () => {
    const turns = featuresFor(EPOXY_LEVEL).turnInPlace;
    expect(turns).toBe(true);
    expect(turnDirectionForChord(chord('ArrowUp'), KEYS, turns)).toBe('N');
    expect(turnDirectionForChord(chord('ArrowRight'), KEYS, turns)).toBe('E');
    expect(turnDirectionForChord(chord('KeyS'), KEYS, turns)).toBe('S');
    expect(turnDirectionForChord(chord('KeyA'), KEYS, turns)).toBe('W');
  });

  it('keeps moving on a classic-rules level', () => {
    const turns = featuresFor(CLASSIC_LEVEL).turnInPlace;
    expect(turns).toBe(false);
    expect(turnDirectionForChord(chord('ArrowUp'), KEYS, turns)).toBeNull();
  });

  it('is not a turn without Shift, with another command modifier, or on another key', () => {
    expect(turnDirectionForChord(chord('ArrowUp', { shiftKey: false }), KEYS, true)).toBeNull();
    expect(turnDirectionForChord(chord('ArrowUp', { ctrlKey: true }), KEYS, true)).toBeNull();
    expect(turnDirectionForChord(chord('KeyQ'), KEYS, true)).toBeNull();
  });
});

describe('aim button', () => {
  let button: HTMLButtonElement;
  let aim: AimMode;

  beforeEach(() => {
    button = mountPage();
    aim = new AimMode(button);
  });

  it('starts hidden and unpressed', () => {
    expect(button.classList.contains('hidden')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(aim.isOn()).toBe(false);
  });

  it('is hidden without a stone on the level and on a gated level', () => {
    syncFor(aim, EPOXY_LEVEL, false, false);
    expect(button.classList.contains('hidden')).toBe(true);
    syncFor(aim, CLASSIC_LEVEL, true, true);
    expect(button.classList.contains('hidden')).toBe(true);
  });

  it('shows disabled until a stone is held, then toggles aim mode with aria-pressed', () => {
    syncFor(aim, EPOXY_LEVEL, true, false);
    expect(button.classList.contains('hidden')).toBe(false);
    expect(button.disabled).toBe(true);
    aim.set(true);
    expect(aim.isOn()).toBe(false);

    syncFor(aim, EPOXY_LEVEL, true, true);
    expect(button.disabled).toBe(false);
    button.click();
    expect(aim.isOn()).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(aim.isOn()).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves aim mode when the stone is thrown or the level stops turning in place', () => {
    syncFor(aim, EPOXY_LEVEL, true, true);
    aim.set(true);
    syncFor(aim, EPOXY_LEVEL, true, false);
    expect(aim.isOn()).toBe(false);

    syncFor(aim, EPOXY_LEVEL, true, true);
    aim.set(true);
    syncFor(aim, CLASSIC_LEVEL, true, true);
    expect(aim.isOn()).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('resets on a level load', () => {
    syncFor(aim, EPOXY_LEVEL, true, true);
    aim.set(true);
    aim.set(false);
    expect(aim.isOn()).toBe(false);
  });
});
