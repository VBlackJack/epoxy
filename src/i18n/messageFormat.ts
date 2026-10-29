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

/**
 * Pure message resolution and formatting, kept free of DOM and bundled
 * locales so it can be unit tested.
 *
 * Placeholders:
 *   {name}                                   replaced by params.name
 *
 * Plurals (a minimal subset of the ICU syntax):
 *   {name, plural, one {# chip} other {# chips}}
 *
 *   The branch is chosen with Intl.PluralRules for the active locale applied
 *   to Number(params.name); "#" inside the branch is replaced by the number.
 *   Supported categories are the Intl ones (zero, one, two, few, many, other);
 *   "other" is the mandatory fallback. Branch text cannot contain braces, so
 *   a placeholder cannot be nested inside a plural branch: use "#" instead.
 *   A plural block whose parameter is missing is left untouched.
 */

export type TranslationNode = string | { [key: string]: TranslationNode };
export type MessageParams = Record<string, string | number>;

const PLURAL_BLOCK = /\{(\w+),\s*plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/g;
const PLURAL_BRANCH = /(\w+)\s*\{([^{}]*)\}/g;
const PLURAL_FALLBACK_CATEGORY = 'other';
const PLURAL_NUMBER_TOKEN = /#/g;

/**
 * Walks a translation tree with a dotted key. A key that stops on an object
 * resolves to that object's first string value, so "a.b" and "a.b.label"
 * both work for a { label } leaf.
 */
export function resolveMessage(tree: TranslationNode | undefined, key: string): string | undefined {
  let cursor: TranslationNode | undefined = tree;
  for (const seg of key.split('.')) {
    if (cursor && typeof cursor === 'object' && seg in cursor) {
      cursor = cursor[seg];
    } else {
      return undefined;
    }
  }
  if (typeof cursor === 'string') {
    return cursor;
  }
  if (cursor && typeof cursor === 'object') {
    const firstVal = Object.values(cursor)[0];
    if (typeof firstVal === 'string') {
      return firstVal;
    }
  }
  return undefined;
}

function selectPluralBranch(branches: string, count: number, locale: string): string | undefined {
  const forms: Record<string, string> = {};
  for (const match of branches.matchAll(PLURAL_BRANCH)) {
    forms[match[1]] = match[2];
  }
  let category: string = PLURAL_FALLBACK_CATEGORY;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    // Unknown locale tag: keep the fallback category
  }
  return forms[category] ?? forms[PLURAL_FALLBACK_CATEGORY];
}

/** Applies plural blocks then simple placeholders. */
export function formatMessage(template: string, params: MessageParams | undefined, locale: string): string {
  if (!params) {
    return template;
  }
  const withPlurals = template.replace(PLURAL_BLOCK, (whole, name: string, branches: string) => {
    if (!(name in params)) {
      return whole;
    }
    const count = Number(params[name]);
    const branch = selectPluralBranch(branches, count, locale);
    return branch === undefined ? whole : branch.replace(PLURAL_NUMBER_TOKEN, String(params[name]));
  });
  return withPlurals.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}

/**
 * Resolves a key in the current locale, then in the fallback locale, and
 * finally returns the key itself so a missing translation stays visible.
 */
export function translate(
  locales: Record<string, TranslationNode>,
  currentLocale: string,
  fallbackLocale: string,
  key: string,
  params?: MessageParams
): string {
  const current = resolveMessage(locales[currentLocale], key);
  if (current !== undefined && current !== '') {
    return formatMessage(current, params, currentLocale);
  }
  const fallback = resolveMessage(locales[fallbackLocale], key);
  if (fallback !== undefined && fallback !== '') {
    return formatMessage(fallback, params, fallbackLocale);
  }
  return key;
}
