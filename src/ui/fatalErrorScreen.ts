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

import { ConfigLoadError } from '../config/ConfigValidation';
import { t } from '../i18n/I18nManager';

/** Translation key and parameters describing why start-up failed. */
export function describeInitError(err: unknown): { key: string; params?: Record<string, string> } {
  if (err instanceof ConfigLoadError) {
    return { key: 'app.errors.config_load.label', params: { source: err.source } };
  }
  return { key: 'app.errors.init_failed.label' };
}

/**
 * Replaces the application with a full screen error card and a retry button.
 * Locales are bundled, so translations work even when configs failed.
 */
export function showFatalErrorScreen(err: unknown): void {
  const { key, params } = describeInitError(err);

  const screen = document.createElement('div');
  screen.className = 'fatal-error-screen';
  screen.setAttribute('role', 'alert');

  const card = document.createElement('div');
  card.className = 'fatal-error-card';

  const title = document.createElement('h2');
  title.textContent = t('app.errors.title.label');

  const message = document.createElement('p');
  message.textContent = t(key, params);

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'action-btn primary';
  retryBtn.textContent = t('app.errors.retry.action');
  retryBtn.addEventListener('click', () => {
    window.location.reload();
  });

  card.append(title, message, retryBtn);
  screen.appendChild(card);

  const app = document.getElementById('app');
  if (app) {
    app.replaceChildren(screen);
  } else {
    document.body.replaceChildren(screen);
  }
  retryBtn.focus();
}
