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

import { OBJECT_URL_REVOKE_DELAY_MS } from './uiConstants';

export const MIME_JSON = 'application/json';
export const MIME_BINARY = 'application/octet-stream';
const JSON_EXPORT_INDENT = 2;

/**
 * Saves a blob through a temporary link. The object URL is revoked after a
 * delay: revoking it synchronously after click() can cancel the download in
 * some browsers.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: MIME_BINARY }), fileName);
}

export function downloadJson(value: unknown, fileName: string): void {
  downloadBlob(new Blob([JSON.stringify(value, null, JSON_EXPORT_INDENT)], { type: MIME_JSON }), fileName);
}
