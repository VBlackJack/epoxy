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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dppxQuery, watchDevicePixelRatio } from './displayWatchers';
import { isPointerActivation } from './focusHandoff';
import { getEditorChordAction, hasCommandModifier, isUndoChord, KeyChord } from './inputGuards';
import { watchReducedMotion } from './motion';
import { setToggleState } from './toggleState';

function chord(overrides: Partial<KeyChord> = {}): KeyChord {
  return { key: 'a', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe('key chords', () => {
  it('detects command modifiers but not Shift', () => {
    expect(hasCommandModifier(chord())).toBe(false);
    expect(hasCommandModifier(chord({ shiftKey: true }))).toBe(false);
    expect(hasCommandModifier(chord({ ctrlKey: true }))).toBe(true);
    expect(hasCommandModifier(chord({ metaKey: true }))).toBe(true);
    expect(hasCommandModifier(chord({ altKey: true }))).toBe(true);
  });

  it('matches the undo chord on the produced character, in either case', () => {
    expect(isUndoChord(chord({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(isUndoChord(chord({ key: 'Z', metaKey: true, shiftKey: true }))).toBe(true);
    expect(isUndoChord(chord({ key: 'z' }))).toBe(false);
    expect(isUndoChord(chord({ key: 'w', ctrlKey: true }))).toBe(false);
  });

  it('keeps undo on QWERTY, AZERTY and non-Latin layouts', () => {
    expect(isUndoChord(chord({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBe(true);
    // AZERTY: Z is produced by the key whose code is KeyW.
    expect(isUndoChord(chord({ key: 'z', code: 'KeyW', ctrlKey: true }))).toBe(true);
    expect(isUndoChord(chord({ key: 'w', code: 'KeyZ', ctrlKey: true }))).toBe(false);
    // Cyrillic and Greek: the key is not an ASCII letter, the physical code decides.
    expect(isUndoChord(chord({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toBe(true);
    expect(isUndoChord(chord({ key: 'ζ', code: 'KeyZ', metaKey: true }))).toBe(true);
    expect(isUndoChord(chord({ key: 'я', code: 'KeyQ', ctrlKey: true }))).toBe(false);
    expect(isUndoChord(chord({ key: 'я', code: 'KeyZ' }))).toBe(false);
  });

  it('maps editor redo on non-Latin layouts through the key code', () => {
    expect(getEditorChordAction(chord({ key: 'у', code: 'KeyY', ctrlKey: true }))).toBe('redo');
    expect(
      getEditorChordAction(chord({ key: 'я', code: 'KeyZ', ctrlKey: true, shiftKey: true }))
    ).toBe('redo');
  });

  it('maps editor chords to undo and redo', () => {
    expect(getEditorChordAction(chord({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(getEditorChordAction(chord({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(getEditorChordAction(chord({ key: 'y', metaKey: true }))).toBe('redo');
    expect(getEditorChordAction(chord({ key: 'y' }))).toBeNull();
    expect(getEditorChordAction(chord({ key: 'w', ctrlKey: true }))).toBeNull();
  });
});

describe('isPointerActivation', () => {
  it('tells a pointer click from a keyboard activation', () => {
    expect(isPointerActivation(1)).toBe(true);
    expect(isPointerActivation(2)).toBe(true);
    expect(isPointerActivation(0)).toBe(false);
  });
});

describe('setToggleState', () => {
  it('keeps the active class and aria-pressed in step', () => {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const el = {
      classList: {
        toggle: (token: string, force?: boolean) => {
          const on = force ?? !classes.has(token);
          if (on) classes.add(token);
          else classes.delete(token);
          return on;
        }
      },
      setAttribute: (name: string, value: string) => void attributes.set(name, value)
    };
    setToggleState(el, true);
    expect(classes.has('active')).toBe(true);
    expect(attributes.get('aria-pressed')).toBe('true');
    setToggleState(el, false);
    expect(classes.has('active')).toBe(false);
    expect(attributes.get('aria-pressed')).toBe('false');
  });

  it('ignores a missing element', () => {
    expect(() => setToggleState(null, true)).not.toThrow();
  });
});

interface FakeQuery {
  media: string;
  matches: boolean;
  listeners: Array<(e: { matches: boolean }) => void>;
  addEventListener: (type: string, fn: (e: { matches: boolean }) => void) => void;
  removeEventListener: (type: string, fn: (e: { matches: boolean }) => void) => void;
}

function stubWindow(devicePixelRatio: number): { queries: FakeQuery[]; setRatio: (r: number) => void } {
  const queries: FakeQuery[] = [];
  const win = {
    devicePixelRatio,
    matchMedia: (media: string): FakeQuery => {
      const query: FakeQuery = {
        media,
        matches: false,
        listeners: [],
        addEventListener: (_type, fn) => void query.listeners.push(fn),
        removeEventListener: (_type, fn) => {
          query.listeners = query.listeners.filter((l) => l !== fn);
        }
      };
      queries.push(query);
      return query;
    }
  };
  vi.stubGlobal('window', win);
  return { queries, setRatio: (r) => void (win.devicePixelRatio = r) };
}

describe('display watchers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a resolution query', () => {
    expect(dppxQuery(2)).toBe('(resolution: 2dppx)');
    expect(dppxQuery(1.25)).toBe('(resolution: 1.25dppx)');
  });

  it('re-arms the pixel ratio query after each change', () => {
    const env = stubWindow(1);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    expect(env.queries).toHaveLength(1);
    expect(env.queries[0].media).toBe('(resolution: 1dppx)');

    env.setRatio(2);
    env.queries[0].listeners[0]({ matches: false });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(env.queries).toHaveLength(2);
    expect(env.queries[1].media).toBe('(resolution: 2dppx)');
  });

  it('stops watching when told to', () => {
    const env = stubWindow(1);
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange);
    stop();
    expect(env.queries[0].listeners).toHaveLength(0);
  });

  it('pushes the new reduced motion value', () => {
    const env = stubWindow(1);
    const onChange = vi.fn();
    watchReducedMotion(onChange);
    env.queries[0].listeners[0]({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
