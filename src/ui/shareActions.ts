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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { LevelPack } from '../core/types';
import { t } from '../i18n/I18nManager';
import { encodeShareLink, ShareEncodeError, ShareEncodeResult } from '../packs/shareLink';
import { SHARE_REFUSAL_KEYS, shareRefusal } from './packManagerModel';
import { closeDialog, openDialog } from './dialog';
import { SHARE_COPY_TIMEOUT_MS } from './uiConstants';

/**
 * The "share" actions of the pack manager: making the link of a pack, copying it (with a
 * selectable field where the clipboard is out of reach) and handing it to the system share sheet.
 */

const LINK_MODAL_ID = 'share-link-modal';
const LINK_FIELD_ID = 'share-link-field';
const LINK_CLOSE_ID = 'share-link-close-btn';

let closeBound = false;

/** The link of a pack, or why it could not be made. `displayName` is the name written in the link. */
export async function makeShareLink(pack: LevelPack, displayName: string): Promise<ShareEncodeResult> {
  // Second guard, before anything is serialized: licensed CC2 content must never leave the device in a link.
  if (shareRefusal(pack.levels) === 'cc2_content') return { ok: false, error: 'cc2_content' };
  const text = ConfigRegistry.exportPackJson(pack.id, displayName, true);
  if (text === null) return { ok: false, error: 'unsupported' };
  return encodeShareLink(text, window.location.href, ConfigRegistry.getGame().share.maxLinkChars);
}

/** The message that tells why no link was made. */
export function shareEncodeErrorMessage(error: ShareEncodeError): string {
  if (error === 'cc2_content') return t(SHARE_REFUSAL_KEYS.cc2_content);
  return error === 'too_long' ? t('app.packs.share.too_long.label') : t('app.packs.share.error.encode.label');
}

/** True where the system share sheet exists. */
export function canShareNatively(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Shows the link in a read-only field, selected, for a copy by hand. */
export function showLinkFallback(url: string): void {
  const modal = document.getElementById(LINK_MODAL_ID);
  const field = document.getElementById(LINK_FIELD_ID) as HTMLInputElement | null;
  if (!modal || !field) return;
  if (!closeBound) {
    closeBound = true;
    document.getElementById(LINK_CLOSE_ID)?.addEventListener('click', () => closeDialog(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDialog(modal);
    });
  }
  field.value = url;
  openDialog(modal, document.activeElement as HTMLElement | null, { initialFocus: field });
  field.select();
}

/** Copies the link; where the clipboard refuses, the link is shown for a copy by hand. Resolves true when copied. */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    // A clipboard that neither answers nor refuses (a denied permission in some panes) counts as refused.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('clipboard timeout')), SHARE_COPY_TIMEOUT_MS);
    });
    try {
      await Promise.race([navigator.clipboard.writeText(url), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return true;
  } catch {
    showLinkFallback(url);
    return false;
  }
}

/** Hands the link to the system share sheet; a sheet the player dismissed is not an error. */
export async function shareLinkNatively(url: string, name: string): Promise<void> {
  try {
    await navigator.share({ title: name, text: t('app.packs.share.text.label', { name }), url });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    showLinkFallback(url);
  }
}
