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

import { t } from '../i18n/I18nManager';
import { playtestFileName, PlaytestExport } from '../playtest/PlaytestStore';
import { confirmDialog } from './confirmDialog';
import { setToggleState } from './toggleState';

const TOGGLE_ID = 'btn-playtest-toggle';
const COUNT_ID = 'playtest-count';
const EXPORT_ID = 'btn-playtest-export';
const CLEAR_ID = 'btn-playtest-clear';
const BADGE_ID = 'hud-playtest-badge';
const HIDDEN_CLASS = 'hidden';

/** What the Options controls need from the playtest controller. */
export interface PlaytestOptionsModel {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  sessionCount(): number;
  buildExport(): PlaytestExport | null;
  clearData(): void;
}

export interface PlaytestOptionsHooks {
  save: (data: unknown, fileName: string) => void;
  notify: (message: string) => void;
  now: () => number;
  /** Runs after the toggle changed, e.g. to start a series on the level on screen. */
  onToggled?: (enabled: boolean) => void;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Shows the toggle, the badge and the session count as the model holds them. */
export function refreshPlaytestOptions(model: PlaytestOptionsModel): void {
  setToggleState(byId(TOGGLE_ID), model.isEnabled());
  byId(BADGE_ID)?.classList.toggle(HIDDEN_CLASS, !model.isEnabled());
  const count = byId(COUNT_ID);
  if (count) count.textContent = t('app.playtest.count.label', { count: model.sessionCount() });
}

/** Wires the Options controls of Playtest mode: toggle, export and clear. */
export function bindPlaytestOptions(model: PlaytestOptionsModel, hooks: PlaytestOptionsHooks): void {
  byId(TOGGLE_ID)?.addEventListener('click', () => {
    const next = !model.isEnabled();
    model.setEnabled(next);
    hooks.onToggled?.(next);
    refreshPlaytestOptions(model);
  });

  byId(EXPORT_ID)?.addEventListener('click', () => {
    const data = model.buildExport();
    if (!data) {
      hooks.notify(t('app.playtest.export.empty.label'));
      return;
    }
    hooks.save(data, playtestFileName(hooks.now()));
    hooks.notify(t('app.playtest.export.done.label'));
  });

  byId(CLEAR_ID)?.addEventListener('click', () => {
    void (async () => {
      if (model.sessionCount() === 0) return;
      const confirmed = await confirmDialog({
        title: t('app.confirm.title.label'),
        message: t('app.playtest.clear.confirm.message'),
        confirmLabel: t('app.playtest.clear.confirm.action'),
        cancelLabel: t('app.confirm.cancel.action')
      });
      if (!confirmed) return;
      model.clearData();
      refreshPlaytestOptions(model);
      hooks.notify(t('app.playtest.clear.done.label'));
    })();
  });
}
