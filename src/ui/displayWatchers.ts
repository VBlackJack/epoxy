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

/** Media query that matches while the screen has exactly this pixel ratio. */
export function dppxQuery(ratio: number): string {
  return `(resolution: ${ratio}dppx)`;
}

/**
 * Calls `onChange` each time the device pixel ratio changes (browser zoom,
 * moving the window to another screen). A resolution query matches one ratio
 * only, so it is armed again for the new ratio after every change. Returns a
 * function that stops watching.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  let query: MediaQueryList | null = null;
  let stopped = false;

  const handle = (): void => {
    if (stopped) return;
    onChange();
    arm();
  };
  const arm = (): void => {
    query = window.matchMedia(dppxQuery(window.devicePixelRatio || 1));
    query.addEventListener('change', handle, { once: true });
  };
  arm();

  return () => {
    stopped = true;
    query?.removeEventListener('change', handle);
  };
}
