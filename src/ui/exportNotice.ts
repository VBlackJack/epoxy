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
import { t } from '../i18n/I18nManager';
import { DatEncodeResult, DatRefusalReason } from '../formats/DatCodec';

/** Translated tile or entity name. */
function elementName(id: string): string {
  const key = ConfigRegistry.getEntityDef(id)?.i18nKey ?? ConfigRegistry.getTile(id).i18nKey;
  return t(key);
}

/** Translated tile names, joined for a notice. */
function tileNames(ids: readonly string[]): string {
  return ids.map(elementName).join(t('app.export.list_separator.label'));
}

/** Level ids, joined for a notice. */
function levelNames(ids: readonly string[]): string {
  return ids.join(t('app.export.list_separator.label'));
}

/**
 * The message to show after a .CCL export that could not carry every tile,
 * or null when the export was exact.
 */
export function lossyExportNotice(
  result: Pick<DatEncodeResult, 'replaced' | 'lost'> & Partial<Pick<DatEncodeResult, 'padded' | 'refused'>>
): string | null {
  const parts: string[] = [];
  const refused = result.refused ?? [];
  const padded = result.padded ?? [];
  const refusedFor = (reason: DatRefusalReason): string[] =>
    refused.filter((r) => r.reason === reason).map((r) => r.levelId);
  if (refusedFor('too_large').length > 0) {
    parts.push(t('app.export.refused_too_large.label', { levels: levelNames(refusedFor('too_large')) }));
  }
  if (refusedFor('player_out_of_range').length > 0) {
    parts.push(
      t('app.export.refused_player_out_of_range.label', { levels: levelNames(refusedFor('player_out_of_range')) })
    );
  }
  if (refusedFor('targets_win_rule').length > 0) {
    parts.push(
      t('app.export.refused_targets_win_rule.label', { levels: levelNames(refusedFor('targets_win_rule')) })
    );
  }
  if (padded.length > 0) {
    parts.push(t('app.export.padded.label', { levels: levelNames(padded) }));
  }
  if (result.replaced.length > 0) {
    parts.push(t('app.export.lossy_replaced.label', { tiles: tileNames(result.replaced) }));
  }
  if (result.lost.length > 0) {
    parts.push(t('app.export.lossy_lost.label', { tiles: tileNames(result.lost) }));
  }
  return parts.length > 0 ? parts.join(t('app.export.list_separator.label')) : null;
}
