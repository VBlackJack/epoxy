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
import type { CompiledLevel } from '../core/types';

/*
 * DatCodec.buildField stores each link field behind a one-byte length (255 bytes at most) and keeps only the whole
 * records that fit: 255 / 10 bytes per trap link, 255 / 8 bytes per clone link. The codec does not export those limits,
 * so they are repeated here to warn the author before links are silently left out. Keep them in step with DatCodec.
 */
/** Most trap links a .DAT level keeps (DatCodec: MAX_FIELD_PAYLOAD_BYTES / TRAP_LINK_RECORD_BYTES, rounded down). */
export const DAT_MAX_TRAP_LINKS = 25;
/** Most clone links a .DAT level keeps (DatCodec: MAX_FIELD_PAYLOAD_BYTES / CLONE_LINK_RECORD_BYTES, rounded down). */
export const DAT_MAX_CLONE_LINKS = 31;

/** Separates the two warnings of one notice. */
const NOTICE_SEPARATOR = ' ';

/**
 * The warning to show after a .CCL export of a level that holds more trap or clone links than the .DAT format keeps,
 * or null when every link fits.
 */
export function datLinkCapNotice(level: Pick<CompiledLevel, 'trapLinks' | 'cloneLinks'>): string | null {
  const parts: string[] = [];
  const trapOver = level.trapLinks.length - DAT_MAX_TRAP_LINKS;
  if (trapOver > 0) parts.push(t('app.export.trap_links_capped.label', { max: DAT_MAX_TRAP_LINKS, count: trapOver }));
  const cloneOver = level.cloneLinks.length - DAT_MAX_CLONE_LINKS;
  if (cloneOver > 0) parts.push(t('app.export.clone_links_capped.label', { max: DAT_MAX_CLONE_LINKS, count: cloneOver }));
  return parts.length > 0 ? parts.join(NOTICE_SEPARATOR) : null;
}
