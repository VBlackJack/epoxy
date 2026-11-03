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
// DOM tests opt in with the line above; the default environment stays node (see vitest.config.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountModals, resetWindowListeners, settleAsync, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { PlaytestExport } from '../playtest/PlaytestStore';
import type { PlaytestOptionsModel } from './playtestOptions';

let bindPlaytestOptions: typeof import('./playtestOptions').bindPlaytestOptions;

function click(id: string): void {
  (document.getElementById(id) as HTMLElement).click();
}

function fakeModel(sessions: number): PlaytestOptionsModel & { enabled: boolean; count: number } {
  const model = {
    enabled: false,
    count: sessions,
    isEnabled: () => model.enabled,
    setEnabled: (on: boolean) => {
      model.enabled = on;
    },
    sessionCount: () => model.count,
    buildExport: (): PlaytestExport | null =>
      model.count === 0
        ? null
        : { format: 'epoxy-playtest', version: 1, exportedAt: '', appVersion: '', sessionCount: model.count, sessions: [] },
    clearData: () => {
      model.count = 0;
    }
  };
  return model;
}

beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('options-drawer', 'hud-playtest-badge', 'confirm-modal');
  ({ bindPlaytestOptions } = await import('./playtestOptions'));
});

afterEach(resetWindowListeners);

describe('playtest options (DOM)', () => {
  it('toggles the mode, its pressed state and the HUD badge', () => {
    const model = fakeModel(0);
    const onToggled = vi.fn();
    bindPlaytestOptions(model, { save: vi.fn(), notify: vi.fn(), now: () => 0, onToggled });
    const toggle = document.getElementById('btn-playtest-toggle') as HTMLElement;
    const badge = document.getElementById('hud-playtest-badge') as HTMLElement;

    click('btn-playtest-toggle');
    expect(model.enabled).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(onToggled).toHaveBeenCalledWith(true);

    click('btn-playtest-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(badge.classList.contains('hidden')).toBe(true);
  });

  it('downloads the export under a dated file name', () => {
    const save = vi.fn();
    bindPlaytestOptions(fakeModel(2), { save, notify: vi.fn(), now: () => Date.UTC(2026, 10, 3, 1, 2, 3) });
    click('btn-playtest-export');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe('epoxy-playtest-20261103-010203.json');
    expect((save.mock.calls[0][0] as PlaytestExport).sessionCount).toBe(2);
  });

  it('says so instead of downloading an empty file', () => {
    const save = vi.fn();
    const notify = vi.fn();
    bindPlaytestOptions(fakeModel(0), { save, notify, now: () => 0 });
    click('btn-playtest-export');
    expect(save).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('clears the data only after the confirmation', async () => {
    const model = fakeModel(3);
    bindPlaytestOptions(model, { save: vi.fn(), notify: vi.fn(), now: () => 0 });

    click('btn-playtest-clear');
    await settleAsync();
    click('confirm-cancel-btn');
    await settleAsync();
    expect(model.count).toBe(3);

    click('btn-playtest-clear');
    await settleAsync();
    click('confirm-ok-btn');
    await settleAsync();
    expect(model.count).toBe(0);
  });
});
