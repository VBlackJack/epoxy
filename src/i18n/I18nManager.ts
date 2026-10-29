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

type TranslationNode = string | { [key: string]: TranslationNode };

const LOCALES: Record<string, TranslationNode> = {
  fr: frLocale as TranslationNode,
  en: enLocale as TranslationNode
};

class I18nService {
  private currentLocale: string = ENV_CONFIG.DEFAULT_LOCALE;
  private listeners: Array<() => void> = [];

  public getLocale(): string {
    return this.currentLocale;
  }

  public setLocale(locale: string): void {
    if (LOCALES[locale]) {
      this.currentLocale = locale;
      this.translateDOM();
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  public onChange(callback: () => void): void {
    this.listeners.push(callback);
  }

  public t(key: string, params?: Record<string, string | number>): string {
    const segments = key.split('.');
    let cursor: TranslationNode | undefined = LOCALES[this.currentLocale];

    for (const seg of segments) {
      if (cursor && typeof cursor === 'object' && seg in cursor) {
        cursor = cursor[seg];
      } else {
        cursor = undefined;
        break;
      }
    }

    let resolved: string | undefined;
    if (typeof cursor === 'string') {
      resolved = cursor;
    } else if (cursor && typeof cursor === 'object') {
      const firstVal = Object.values(cursor)[0];
      if (typeof firstVal === 'string') {
        resolved = firstVal;
      }
    }

    if (!resolved) {
      return key;
    }

    if (params) {
      for (const [paramKey, paramVal] of Object.entries(params)) {
        resolved = resolved.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
      }
    }

    return resolved;
  }

  public translateDOM(root: Document | HTMLElement = document): void {
    const textElements = root.querySelectorAll<HTMLElement>('[data-i18n]');
    textElements.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    const placeholderElements = root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]');
    placeholderElements.forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = this.t(key);
      }
    });

    const titleElements = root.querySelectorAll<HTMLElement>('[data-i18n-title]');
    titleElements.forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = this.t(key);
      }
    });
  }
}

export const i18n = new I18nService();
export const t = (key: string, params?: Record<string, string | number>): string =>
  i18n.t(key, params);
