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

import { normalizeLauncherLinks } from '../config/ConfigValidation';
import { DEFAULT_RULESET } from '../core/coreConstants';
import type { CellUnderlay, LauncherLink } from '../core/types';

/** The shot trigger to shot launcher links of a map, as the editor reads and rewrites them (Epoxy levels only, never CC3D). */
export interface LauncherLinkHolder {
  terrain: string[][];
  underlays?: CellUnderlay[];
  launcherLinks?: LauncherLink[];
}

/**
 * The launcher links in canonical form (see normalizeLauncherLinks): only those whose ends still hold a
 * trigger and a launcher, sorted, one per pair. Undefined when none is left.
 */
export function canonicalLauncherLinks(
  links: readonly LauncherLink[] | undefined,
  terrain: readonly (readonly string[])[],
  underlays?: readonly CellUnderlay[]
): LauncherLink[] | undefined {
  if (!links || links.length === 0) return undefined;
  return normalizeLauncherLinks(links, terrain, DEFAULT_RULESET, underlays ?? null) ?? undefined;
}

/** Deep copy of a list of launcher links; undefined when it is absent or empty. */
export function cloneLauncherLinks(links: readonly LauncherLink[] | undefined): LauncherLink[] | undefined {
  if (!links || links.length === 0) return undefined;
  return links.map((l) => ({ buttonX: l.buttonX, buttonY: l.buttonY, launcherX: l.launcherX, launcherY: l.launcherY }));
}

/** True when the map holds at least one launcher link. */
export function hasLauncherLinks(map: Pick<LauncherLinkHolder, 'launcherLinks'>): boolean {
  return (map.launcherLinks?.length ?? 0) > 0;
}

/** Whether a link has one of its two ends on the cell. */
export function launcherLinkTouches(link: LauncherLink, x: number, y: number): boolean {
  return (link.buttonX === x && link.buttonY === y) || (link.launcherX === x && link.launcherY === y);
}

/**
 * Stores the links of a map in the canonical order of normalizeLauncherLinks (row of the trigger, then its column,
 * then the launcher's), one per pair, so exports are stable after a move. The terrain is not checked here: callers
 * store links while the terrain or the hidden terrain is still being rebuilt (see pruneLauncherLinks for that).
 * Removes the field when none is left.
 */
export function setLauncherLinks(map: LauncherLinkHolder, links: readonly LauncherLink[]): void {
  if (links.length === 0) {
    delete map.launcherLinks;
    return;
  }
  const unique = new Map<string, LauncherLink>();
  for (const l of links) unique.set(linkKey(l), { buttonX: l.buttonX, buttonY: l.buttonY, launcherX: l.launcherX, launcherY: l.launcherY });
  map.launcherLinks = [...unique.values()].sort(
    (a, b) => a.buttonY - b.buttonY || a.buttonX - b.buttonX || a.launcherY - b.launcherY || a.launcherX - b.launcherX
  );
}

/** Removes the links that touch the cell; returns how many were removed. The map is changed in place. */
export function dropLauncherLinksAt(map: LauncherLinkHolder, x: number, y: number): number {
  const before = map.launcherLinks ?? [];
  const kept = before.filter((l) => !launcherLinkTouches(l, x, y));
  if (kept.length !== before.length) setLauncherLinks(map, kept);
  return before.length - kept.length;
}

/** The links moved by a step; links with an end leaving the grid are dropped. */
export function translateLauncherLinks(
  links: readonly LauncherLink[],
  dx: number,
  dy: number,
  width: number,
  height: number
): LauncherLink[] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  return links
    .map((l) => ({ buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, launcherX: l.launcherX + dx, launcherY: l.launcherY + dy }))
    .filter((l) => inside(l.buttonX, l.buttonY) && inside(l.launcherX, l.launcherY));
}

/**
 * Drops the links whose ends no longer hold a trigger and a launcher (the terrain was changed under them).
 * Returns how many were dropped. The map is changed in place.
 */
export function pruneLauncherLinks(map: LauncherLinkHolder): number {
  const before = map.launcherLinks;
  if (!before || before.length === 0) return 0;
  const canonical = canonicalLauncherLinks(before, map.terrain, map.underlays);
  if (canonical) map.launcherLinks = canonical;
  else delete map.launcherLinks;
  return before.length - (canonical?.length ?? 0);
}

const linkKey = (l: LauncherLink): string => [l.buttonX, l.buttonY, l.launcherX, l.launcherY].join('|');

/** The links held by only one of two lists. */
export function differingLauncherLinks(before: readonly LauncherLink[] | undefined, after: readonly LauncherLink[] | undefined): LauncherLink[] {
  const left = new Set((before ?? []).map(linkKey));
  const right = new Set((after ?? []).map(linkKey));
  return [...(before ?? []).filter((l) => !right.has(linkKey(l))), ...(after ?? []).filter((l) => !left.has(linkKey(l)))];
}
