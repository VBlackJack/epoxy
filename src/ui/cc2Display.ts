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
import { CC2_ID_PREFIX } from '../core/coreConstants';
import type { Cc2CoverageVerdict, CompiledLevel } from '../core/types';
import { t } from '../i18n/I18nManager';
import type { Cc2ImportSummary } from './cc2Import';

/**
 * What the player sees of a level imported from a CC2 file: its coverage badge in the level lists, the banner while
 * it is played, and the summary shown after an import. Pure text and elements; no state.
 */

const BADGE_CLASS = 'packs-badge';
const BADGE_VERDICT_CLASS_PREFIX = 'packs-badge-cc2-';
const UNDERSCORE_PATTERN = /_/g;
const MECHANIC_SEPARATOR = ', ';

/** Translation key of the badge text of a verdict. */
export function cc2BadgeLabelKey(verdict: Cc2CoverageVerdict): string {
  return `cc2.coverage.badge.${verdict}.label`;
}

/** Readable name of a coverage key: the name of its reserved element when there is one, else the key in words. */
export function cc2MechanicLabel(key: string): string {
  const reserved = ConfigRegistry.getCc2Tiles();
  const id = `${CC2_ID_PREFIX}${key}`;
  const definition = reserved.tiles[id] ?? reserved.entities[id];
  return definition ? t(definition.i18nKey) : key.replace(UNDERSCORE_PATTERN, ' ');
}

/** The coverage badge of a level imported from CC2, or null for any other level. */
export function cc2CoverageBadge(level: Pick<CompiledLevel, 'cc2'>): HTMLElement | null {
  const coverage = level.cc2?.coverage;
  if (!coverage) return null;
  const badge = document.createElement('span');
  badge.className = `${BADGE_CLASS} ${BADGE_VERDICT_CLASS_PREFIX}${coverage.verdict}`;
  badge.textContent = t(cc2BadgeLabelKey(coverage.verdict));
  badge.title = t('cc2.coverage.title.label');
  return badge;
}

/** The banner of a level that holds mechanics Epoxy does not play, or null when it holds none. */
export function cc2PlayBannerText(level: Pick<CompiledLevel, 'cc2'>): string | null {
  const lost = level.cc2?.coverage.lost ?? [];
  if (lost.length === 0) return null;
  return t('cc2.play.banner.unsupported.label', { mechanics: lost.map(cc2MechanicLabel).join(MECHANIC_SEPARATOR) });
}

/** The lines of the import summary, in the order they are read: counts, then what needs a human eye. */
export function cc2SummaryLines(summary: Cc2ImportSummary): string[] {
  const lines = [
    t('cc2.import.report.summary.label', {
      count: summary.levelCount,
      exact: summary.exact,
      approx: summary.approx,
      lost: summary.lost
    })
  ];
  if (summary.lostKeys.length > 0) {
    lines.push(t('cc2.import.report.mechanics.label', { mechanics: summary.lostKeys.map(cc2MechanicLabel).join(MECHANIC_SEPARATOR) }));
  }
  if (summary.appended > 0) lines.push(t('cc2.import.report.order_appended.label', { count: summary.appended }));
  if (summary.skipped > 0) lines.push(t('cc2.import.report.skipped.label', { skipped: summary.skipped }));
  if (summary.tooLarge > 0) lines.push(t('cc2.import.report.too_large.label', { count: summary.tooLarge }));
  if (summary.warningCount > 0) lines.push(t('cc2.import.report.warnings.label', { count: summary.warningCount }));
  return lines;
}

/** The summary lines and, when the original files could not be stored, the notice that the opt-in export will lack them. */
export function cc2ImportNoticeLines(summary: Cc2ImportSummary, sourcesKept: boolean): string[] {
  const lines = cc2SummaryLines(summary);
  if (!sourcesKept) lines.push(t('cc2.import.sources_not_kept.label'));
  return lines;
}
