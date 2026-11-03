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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shared set-up of the DOM tests (files opting in with the happy-dom docblock).
 * The modals are copied from the real index.html, so the tests exercise the
 * markup the modules are written against.
 */

const INDEX_PATH = resolve(__dirname, '../../index.html');

/** The markup between the body tags: the head would make happy-dom try to load the stylesheet and scripts. */
function bodyOf(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error('index.html has no body');
  return match[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Replaces the page body with the given modals of index.html, by id. */
export function mountModals(...ids: string[]): void {
  const source = new DOMParser().parseFromString(`<body>${bodyOf(readFileSync(INDEX_PATH, 'utf8'))}</body>`, 'text/html');
  document.body.innerHTML = '';
  for (const id of ids) {
    const modal = source.getElementById(id);
    if (!modal) throw new Error(`Modal not found in index.html: ${id}`);
    document.body.appendChild(document.importNode(modal, true));
  }
}

/** happy-dom does no layout: report one box per element so the focus trap sees them as visible. */
export function stubLayout(): void {
  Element.prototype.getClientRects = function getClientRects(): DOMRectList {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  };
}

/** Dispatches a key press that bubbles up to the window listeners, as a real one does. */
export function pressKey(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Lets pending promise callbacks run, including those chained after an await. */
export async function settleAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

type Listener = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];
const windowListeners: Listener[] = [];
let tracking = false;

/**
 * The modules bind their listeners once, at module level, on the window. Each
 * test reloads them (vi.resetModules) and calls this to drop the listeners of
 * the previous copy, so two copies never answer the same key press.
 */
export function resetWindowListeners(): void {
  for (const [type, listener, options] of windowListeners) window.removeEventListener(type, listener, options);
  windowListeners.length = 0;
}

/** Starts recording the window listeners the modules add, so resetWindowListeners can drop them. Call once per file. */
export function trackWindowListeners(): void {
  if (tracking) return;
  tracking = true;
  const nativeAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    windowListeners.push([type, listener, options]);
    nativeAddEventListener(type, listener, options);
  }) as typeof window.addEventListener;
}
