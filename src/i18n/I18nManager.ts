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

import frLocale from '../locales/fr.json';
import enLocale from '../locales/en.json';
import { ENV_CONFIG } from '../config/constants';
import { MessageParams, TranslationNode, translate } from './messageFormat';

const LOCALES: Record<string, TranslationNode> = {
  fr: frLocale as TranslationNode,
  en: enLocale as TranslationNode
};

/**
 * DOM attributes that translateDOM fills from a translation key, mapped to
 * the element attribute (or property) they set. data-i18n sets the text.
 */
const ATTRIBUTE_BINDINGS: ReadonlyArray<{ dataAttr: string; target: string }> = [
  { dataAttr: 'data-i18n-placeholder', target: 'placeholder' },
  { dataAttr: 'data-i18n-title', target: 'title' },
  { dataAttr: 'data-i18n-aria-label', target: 'aria-label' },
  { dataAttr: 'data-i18n-alt', target: 'alt' }
];

class I18nService {
  private currentLocale: string = ENV_CONFIG.DEFAULT_LOCALE;
  private readonly fallbackLocale: string = ENV_CONFIG.DEFAULT_LOCALE;
  private listeners: Array<() => void> = [];

  public getLocale(): string {
    return this.currentLocale;
  }

  public setLocale(locale: string): void {
    if (LOCALES[locale]) {
      this.currentLocale = locale;
      if (typeof document !== 'undefined') {
        document.documentElement.lang = locale;
      }
      this.translateDOM();
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  public onChange(callback: () => void): void {
    this.listeners.push(callback);
  }

  public t(key: string, params?: MessageParams): string {
    return translate(LOCALES, this.currentLocale, this.fallbackLocale, key, params);
  }

  public translateDOM(root?: Document | HTMLElement): void {
    const scope = root ?? (typeof document !== 'undefined' ? document : undefined);
    if (!scope) return;

    scope.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    for (const binding of ATTRIBUTE_BINDINGS) {
      scope.querySelectorAll<HTMLElement>(`[${binding.dataAttr}]`).forEach((el) => {
        const key = el.getAttribute(binding.dataAttr);
        if (key) {
          el.setAttribute(binding.target, this.t(key));
        }
      });
    }
  }
}

export const i18n = new I18nService();
export const t = (key: string, params?: MessageParams): string => i18n.t(key, params);
