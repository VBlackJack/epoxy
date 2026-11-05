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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import type { Ruleset } from '../core/types';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { resolveMessage, type TranslationNode } from '../i18n/messageFormat';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { EditorMap } from './editorDocument';
import { holdsLinkEnd } from './mapEdits';
import {
  MECHANISM_STAMPS,
  mechanismStampClip,
  mechanismStampsFor,
  STAMP_DEFAULT_LAYOUT,
  turnedStampLayout,
  type StampLayout
} from './mechanismStamps';
import { entityAvailability, tileAvailability } from './paletteAvailability';
import { pasteClip } from './selectionEdits';

const LAYOUTS: readonly StampLayout[] = ['horizontal', 'vertical'];
const MAP_SIZE = 9;
const ORIGIN = { x: 3, y: 3 };
const STAMP_CELLS = 3;

/** A bordered map: wall ring, floor inside, player at (1, 1). */
function bordered(): EditorMap {
  const terrain = Array.from({ length: MAP_SIZE }, (_, y) =>
    Array.from({ length: MAP_SIZE }, (_, x) => (x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1 ? 'wall' : 'floor'))
  );
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('mechanism stamps', () => {
  it('has unique ids and names and describes every stamp in both languages', () => {
    expect(new Set(MECHANISM_STAMPS.map((stamp) => stamp.id)).size).toBe(MECHANISM_STAMPS.length);
    for (const locale of [enLocale, frLocale] as TranslationNode[]) {
      for (const stamp of MECHANISM_STAMPS) {
        expect(typeof resolveMessage(locale, stamp.i18nKey), stamp.i18nKey).toBe('string');
        expect(typeof resolveMessage(locale, stamp.descI18nKey), stamp.descI18nKey).toBe('string');
      }
    }
  });

  it.each(MECHANISM_STAMPS.map((stamp) => [stamp.id, stamp] as const))('%s: every tile and entity exists and is available to its rulesets', (_id, stamp) => {
    for (const layout of LAYOUTS) {
      const clip = mechanismStampClip(stamp, layout);
      for (const id of clip.terrain.flat()) expect(ConfigRegistry.isTerrainTile(id), id).toBe(true);
      for (const entity of clip.entities) expect(ConfigRegistry.getEntityDef(entity.type), entity.type).toBeDefined();
      for (const ruleset of stamp.rulesets) {
        for (const id of clip.terrain.flat()) expect(tileAvailability(ruleset, id).available, `${ruleset} ${id}`).toBe(true);
        for (const entity of clip.entities) expect(entityAvailability(ruleset, entity.type).available, `${ruleset} ${entity.type}`).toBe(true);
      }
    }
  });

  it('lists all three on Epoxy, trap and clone on Lynx, and none on CC3D', () => {
    expect(mechanismStampsFor('epoxy').map((stamp) => stamp.id)).toEqual(['trap', 'clone', 'shot']);
    expect(mechanismStampsFor('lynx').map((stamp) => stamp.id)).toEqual(['trap', 'clone']);
    expect(mechanismStampsFor('cc3d')).toEqual([]);
  });

  it('turns between the two layouts and back', () => {
    expect(STAMP_DEFAULT_LAYOUT).toBe('horizontal');
    expect(turnedStampLayout('horizontal')).toBe('vertical');
    expect(turnedStampLayout('vertical')).toBe('horizontal');
  });

  it('lays each stamp out with one floor cell between its two ends, in a row or a column', () => {
    for (const stamp of MECHANISM_STAMPS) {
      const row = mechanismStampClip(stamp, 'horizontal');
      expect([row.width, row.height]).toEqual([STAMP_CELLS, 1]);
      expect(row.terrain[0][0]).toBe(stamp.buttonTile);
      expect(row.terrain[0][1]).toBe('floor');
      const column = mechanismStampClip(stamp, 'vertical');
      expect([column.width, column.height]).toEqual([1, STAMP_CELLS]);
      expect(column.terrain[0][0]).toBe(stamp.buttonTile);
      expect(column.terrain[1][0]).toBe('floor');
      // The device end is the same tile in both layouts, but for a launcher, which turns to face its button.
      if (stamp.system !== 'shot') expect(column.terrain[2][0]).toBe(row.terrain[0][2]);
    }
  });

  it('carries exactly one link of its own system, and the clone stamp a block template facing the button', () => {
    const trap = mechanismStampClip(MECHANISM_STAMPS[0], 'horizontal');
    expect(trap.trapLinks).toEqual([{ buttonX: 0, buttonY: 0, trapX: 2, trapY: 0 }]);
    expect(trap.cloneLinks).toBeUndefined();
    const clone = mechanismStampClip(MECHANISM_STAMPS[1], 'vertical');
    expect(clone.cloneLinks).toEqual([{ buttonX: 0, buttonY: 0, clonerX: 0, clonerY: 2, templateType: 'dirt_block', templateDir: 'N' }]);
    expect(clone.entities).toEqual([{ dx: 0, dy: 2, type: 'dirt_block', dir: 'N' }]);
    const shot = mechanismStampClip(MECHANISM_STAMPS[2], 'horizontal');
    expect(shot.launcherLinks).toEqual([{ buttonX: 0, buttonY: 0, launcherX: 2, launcherY: 0 }]);
  });

  it('points the launcher away from its trigger in both layouts, so its shot never crosses the trigger cell', () => {
    expect(mechanismStampClip(MECHANISM_STAMPS[2], 'horizontal').terrain[0][2]).toBe('shot_launcher_e');
    expect(mechanismStampClip(MECHANISM_STAMPS[2], 'vertical').terrain[2][0]).toBe('shot_launcher_s');
  });

  it('shares one clip per stamp and layout', () => {
    expect(mechanismStampClip(MECHANISM_STAMPS[0], 'vertical')).toBe(mechanismStampClip(MECHANISM_STAMPS[0], 'vertical'));
    expect(mechanismStampClip(MECHANISM_STAMPS[0], 'vertical')).not.toBe(mechanismStampClip(MECHANISM_STAMPS[0], 'horizontal'));
  });

  describe.each(MECHANISM_STAMPS.flatMap((stamp) => stamp.rulesets.map((ruleset) => [stamp.id, ruleset, stamp] as const)))('placing %s on %s rules', (_id, ruleset, stamp) => {
    it.each(LAYOUTS)('writes its link between two cells that hold the devices (%s)', (layout) => {
      const source = bordered();
      const result = pasteClip(source, mechanismStampClip(stamp, layout), ORIGIN.x, ORIGIN.y, ruleset as Ruleset);
      expect(result.changed).toBe(true);
      expect(result.pastedLinks).toBe(1);
      expect(result.linksNotPasted).toBeUndefined();
      expect(result.skipped).toBe(0);
      const links = stamp.system === 'trap' ? result.map.trapLinks : stamp.system === 'clone' ? result.map.cloneLinks : (result.map.launcherLinks ?? []);
      expect(links).toHaveLength(1);
      const link = links[0] as unknown as Record<string, number>;
      const targetX = link.trapX ?? link.clonerX ?? link.launcherX;
      const targetY = link.trapY ?? link.clonerY ?? link.launcherY;
      expect(holdsLinkEnd(result.map, stamp.system, 'button', link.buttonX, link.buttonY)).toBe(true);
      expect(holdsLinkEnd(result.map, stamp.system, 'target', targetX, targetY)).toBe(true);
      // The two ends are two cells apart, with one cell between them.
      expect(Math.abs(targetX - link.buttonX) + Math.abs(targetY - link.buttonY)).toBe(STAMP_CELLS - 1);
      // The source map is never modified.
      expect(source.trapLinks).toEqual([]);
    });
  });

  it('keeps the block of the clone stamp on the machine, and the template follows it', () => {
    const result = pasteClip(bordered(), mechanismStampClip(MECHANISM_STAMPS[1], 'horizontal'), ORIGIN.x, ORIGIN.y, 'lynx');
    expect(result.map.entities).toEqual([{ x: ORIGIN.x + 2, y: ORIGIN.y, type: 'dirt_block', dir: 'W' }]);
    expect(result.map.cloneLinks[0]).toMatchObject({ clonerX: ORIGIN.x + 2, clonerY: ORIGIN.y, templateType: 'dirt_block', templateDir: 'W' });
  });
});
