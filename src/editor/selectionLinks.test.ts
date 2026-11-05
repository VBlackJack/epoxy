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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EditorMap } from './editorDocument';
import { clearRect, clipLinkCount, extractClip, pasteClip } from './selectionEdits';

/** A bordered map: wall ring, floor inside, player at (1, 1). */
function bordered(width: number, height: number): EditorMap {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push([]);
    items.push([]);
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      terrain[y].push(edge ? 'wall' : 'floor');
      items[y].push(null);
    }
  }
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 1, y: 1, dir: 'S' } };
}

/** Trap pair (2,2)-(4,2), clone pair (2,4)-(4,4) with a stored template, shot pair (2,6)-(4,6), in a 12 x 12 map. */
function withLinks(): EditorMap {
  const map = bordered(12, 12);
  map.terrain[2][2] = 'button_brown';
  map.terrain[2][4] = 'trap';
  map.terrain[4][2] = 'button_red';
  map.terrain[4][4] = 'clone_machine';
  map.terrain[6][2] = 'shot_trigger';
  map.terrain[6][4] = 'shot_launcher_e';
  map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 }];
  map.cloneLinks = [{ buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'E' }];
  map.launcherLinks = [{ buttonX: 2, buttonY: 6, launcherX: 4, launcherY: 6 }];
  return map;
}

const ALL_LINKS = { x: 2, y: 2, width: 3, height: 5 };

describe('extractClip links', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('carries the links with both ends inside, relative to the clip, and keeps the template', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    expect(clip.trapLinks).toEqual([{ buttonX: 0, buttonY: 0, trapX: 2, trapY: 0 }]);
    expect(clip.cloneLinks).toEqual([{ buttonX: 0, buttonY: 2, clonerX: 2, clonerY: 2, templateType: 'dirt_block', templateDir: 'E' }]);
    expect(clip.launcherLinks).toEqual([{ buttonX: 0, buttonY: 4, launcherX: 2, launcherY: 4 }]);
    expect(clip.linksLeftOut).toBeUndefined();
    expect(clipLinkCount(clip)).toBe(3);
  });

  it('leaves the link fields out of a clip that carries none', () => {
    const clip = extractClip(bordered(9, 9), { x: 2, y: 2, width: 3, height: 3 }, false);
    expect(clip.trapLinks).toBeUndefined();
    expect(clip.cloneLinks).toBeUndefined();
    expect(clip.launcherLinks).toBeUndefined();
    expect(clip.linksLeftOut).toBeUndefined();
  });

  it('never carries a crossing link and counts it as left out, on a cut too', () => {
    const map = withLinks();
    const copy = extractClip(map, { x: 2, y: 2, width: 2, height: 1 }, false);
    expect(copy.trapLinks).toBeUndefined();
    expect(copy.linksLeftOut).toBe(1);
    const cut = extractClip(map, { x: 2, y: 2, width: 2, height: 1 }, true);
    expect(cut.trapLinks).toBeUndefined();
    expect(cut.linksLeftOut).toBe(1);
  });

  it('does not carry a link with an end on the outer ring', () => {
    const map = bordered(9, 9);
    map.terrain[0][3] = 'button_brown';
    map.terrain[2][3] = 'trap';
    map.trapLinks = [{ buttonX: 3, buttonY: 0, trapX: 3, trapY: 2 }];
    const clip = extractClip(map, { x: 2, y: 0, width: 3, height: 4 }, false);
    expect(clip.trapLinks).toBeUndefined();
    expect(clip.linksLeftOut).toBe(1);
  });
});

describe('pasteClip links', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('writes the trap, clone and launcher links at their new place and counts them', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    const result = pasteClip(bordered(12, 12), clip, 5, 3, 'epoxy');
    expect(result.map.trapLinks).toEqual([{ buttonX: 5, buttonY: 3, trapX: 7, trapY: 3 }]);
    // No creature stands on the cloner, so the stored template is kept.
    expect(result.map.cloneLinks).toEqual([{ buttonX: 5, buttonY: 5, clonerX: 7, clonerY: 5, templateType: 'dirt_block', templateDir: 'E' }]);
    expect(result.map.launcherLinks).toEqual([{ buttonX: 5, buttonY: 7, launcherX: 7, launcherY: 7 }]);
    expect(result.pastedLinks).toBe(3);
    expect(result.linksNotPasted).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it('makes a clone link copy the creature pasted on its cloner', () => {
    const map = withLinks();
    map.entities = [{ x: 4, y: 4, type: 'tank', dir: 'N' }];
    const clip = extractClip(map, ALL_LINKS, false);
    const result = pasteClip(bordered(12, 12), clip, 5, 3, 'epoxy');
    expect(result.map.cloneLinks[0]).toMatchObject({ clonerX: 7, clonerY: 5, templateType: 'tank', templateDir: 'N' });
  });

  it('pastes twice into two independent sets', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    const first = pasteClip(bordered(12, 12), clip, 1, 1, 'epoxy');
    const second = pasteClip(first.map, clip, 6, 1, 'epoxy');
    expect(second.map.trapLinks).toEqual([
      { buttonX: 1, buttonY: 1, trapX: 3, trapY: 1 },
      { buttonX: 6, buttonY: 1, trapX: 8, trapY: 1 }
    ]);
    expect(second.map.cloneLinks).toHaveLength(2);
    expect(second.map.launcherLinks).toHaveLength(2);
  });

  it('does not alias the clip links', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    const result = pasteClip(bordered(12, 12), clip, 5, 3, 'epoxy');
    result.map.cloneLinks[0].templateType = 'walker';
    expect(clip.cloneLinks?.[0].templateType).toBe('dirt_block');
  });

  it('drops the link whose end falls on the outer ring, and counts it', () => {
    const map = bordered(9, 9);
    map.terrain[2][2] = 'button_brown';
    map.terrain[2][4] = 'trap';
    map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 }];
    const clip = extractClip(map, { x: 2, y: 2, width: 3, height: 1 }, false);
    // The ring cell already holds a trap, so only the "cell was written" check can reject the link.
    const destination = bordered(9, 9);
    destination.terrain[3][8] = 'trap';
    const result = pasteClip(destination, clip, 6, 3, 'epoxy');
    expect(result.borderSkipped).toBe(1);
    expect(result.map.terrain[3][8]).toBe('trap');
    expect(result.map.trapLinks).toEqual([]);
    expect(result.pastedLinks).toBeUndefined();
    expect(result.linksNotPasted).toBe(1);
  });

  it('reports nothing and records no change when a clip is pasted onto its own cells', () => {
    const map = withLinks();
    const clip = extractClip(map, ALL_LINKS, false);
    const result = pasteClip(map, clip, ALL_LINKS.x, ALL_LINKS.y, 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.droppedLinks).toBe(0);
    expect(result.pastedLinks).toBeUndefined();
    expect(result.linksNotPasted).toBeUndefined();
    expect(result.map.trapLinks).toEqual(map.trapLinks);
    expect(result.map.launcherLinks).toEqual(map.launcherLinks);
  });

  it('keeps the order of the links of a system when they are pasted onto their own cells', () => {
    const map = bordered(12, 12);
    map.terrain[2][2] = 'button_brown';
    map.terrain[2][4] = 'trap';
    map.terrain[3][4] = 'trap';
    map.terrain[6][6] = 'button_brown';
    map.terrain[6][8] = 'trap';
    // Two links of one button in a meaningful order (Lynx reads the first valid one), then an unrelated one outside the clip.
    map.trapLinks = [
      { buttonX: 2, buttonY: 2, trapX: 4, trapY: 3 },
      { buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 },
      { buttonX: 6, buttonY: 6, trapX: 8, trapY: 6 }
    ];
    const clip = extractClip(map, { x: 2, y: 2, width: 3, height: 2 }, false);
    const result = pasteClip(map, clip, 2, 2, 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.droppedLinks).toBe(0);
    expect(result.map.trapLinks).toEqual(map.trapLinks);
    // Under Lynx the same paste really changes the level: only the first link of the button survives.
    const lynx = pasteClip(map, clip, 2, 2, 'lynx');
    expect(lynx.map.trapLinks).toHaveLength(2);
    expect(lynx.map.trapLinks).toContainEqual(map.trapLinks[0]);
    expect(lynx.map.trapLinks).toContainEqual(map.trapLinks[2]);
    expect(lynx.droppedLinks).toBe(1);
  });

  it('counts a stale launcher link pruned by the paste as dropped', () => {
    const map = withLinks();
    map.launcherLinks = [...(map.launcherLinks ?? []), { buttonX: 9, buttonY: 9, launcherX: 8, launcherY: 9 }];
    const clip = extractClip(map, ALL_LINKS, false);
    const result = pasteClip(map, clip, 6, 6, 'epoxy');
    expect(result.droppedLinks).toBe(1);
    expect(result.pastedLinks).toBe(3);
  });

  it('drops the link whose end falls off the map', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    const result = pasteClip(bordered(12, 12), clip, 10, 3, 'epoxy');
    expect(result.map.trapLinks).toEqual([]);
    expect(result.linksNotPasted).toBe(3);
  });

  it('drops the shot links under Lynx and keeps the others', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    const result = pasteClip(bordered(12, 12), clip, 5, 3, 'lynx');
    // Lynx cannot play the shot devices, so their cells are skipped whole: the written-cell check already rejects the link
    // and the ruleset guard is a second line that no real clip can reach alone.
    expect(result.map.terrain[7][5]).toBe('floor');
    expect(result.map.terrain[7][7]).toBe('floor');
    expect(result.map.launcherLinks).toBeUndefined();
    expect(result.map.trapLinks).toHaveLength(1);
    expect(result.map.cloneLinks).toHaveLength(1);
    expect(result.pastedLinks).toBe(2);
    expect(result.linksNotPasted).toBe(1);
  });

  it('keeps only the first trap and the first clone link of a button under Lynx', () => {
    const map = bordered(12, 12);
    map.terrain[2][2] = 'button_brown';
    map.terrain[2][4] = 'trap';
    map.terrain[3][4] = 'trap';
    map.terrain[4][2] = 'button_red';
    map.terrain[4][4] = 'clone_machine';
    map.terrain[5][4] = 'clone_machine';
    map.trapLinks = [
      { buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 },
      { buttonX: 2, buttonY: 2, trapX: 4, trapY: 3 }
    ];
    map.cloneLinks = [
      { buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'S' },
      { buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 5, templateType: 'dirt_block', templateDir: 'S' }
    ];
    const clip = extractClip(map, { x: 2, y: 2, width: 3, height: 4 }, false);
    const lynx = pasteClip(bordered(12, 12), clip, 5, 3, 'lynx');
    expect(lynx.map.trapLinks).toEqual([{ buttonX: 5, buttonY: 3, trapX: 7, trapY: 3 }]);
    expect(lynx.map.cloneLinks).toHaveLength(1);
    expect(lynx.pastedLinks).toBe(2);
    expect(lynx.linksNotPasted).toBe(2);
    const epoxy = pasteClip(bordered(12, 12), clip, 5, 3, 'epoxy');
    expect(epoxy.map.trapLinks).toHaveLength(2);
    expect(epoxy.map.cloneLinks).toHaveLength(2);
  });

  it('drops a link whose end no longer holds its device after the paste', () => {
    const clip = extractClip(withLinks(), ALL_LINKS, false);
    clip.terrain[0][2] = 'floor'; // the trap was edited out of the clip
    const result = pasteClip(bordered(12, 12), clip, 5, 3, 'epoxy');
    expect(result.map.trapLinks).toEqual([]);
    expect(result.linksNotPasted).toBe(1);
  });

  it('round-trips a cut: the links come back when the clip is pasted where it was', () => {
    const map = withLinks();
    const clip = extractClip(map, ALL_LINKS, true);
    const cleared = clearRect(map, ALL_LINKS);
    expect(cleared.map.trapLinks).toEqual([]);
    expect(cleared.droppedLinks).toBe(clipLinkCount(clip));
    const back = pasteClip(cleared.map, clip, ALL_LINKS.x, ALL_LINKS.y, 'epoxy');
    expect(back.map.trapLinks).toEqual(map.trapLinks);
    expect(back.map.cloneLinks).toEqual(map.cloneLinks);
    expect(back.map.launcherLinks).toEqual(map.launcherLinks);
  });

  it('still drops the links ending on a cell it overwrites', () => {
    const map = withLinks();
    const clip = extractClip(bordered(12, 12), { x: 5, y: 5, width: 1, height: 1 }, false);
    const result = pasteClip(map, clip, 4, 2, 'epoxy');
    expect(result.map.trapLinks).toEqual([]);
    expect(result.droppedLinks).toBe(1);
  });
});
