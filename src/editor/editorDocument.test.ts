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
import { cloneDocument, EditorDocument, sameDocument, withEditedMap } from './editorDocument';
import { paintPlayerStart, paintTerrain } from './mapEdits';

function doc(): EditorDocument {
  return {
    terrain: [
      ['wall', 'wall'],
      ['wall', 'floor']
    ],
    items: [
      [null, null],
      [null, null]
    ],
    entities: [
      { x: 1, y: 1, type: 'bug', dir: 'N' },
      { x: 0, y: 1, type: 'tank', dir: 'S' }
    ],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 0, dir: 'S' },
    title: 'A',
    hint: '',
    author: '',
    password: 'ABCD',
    timeLimitSeconds: 100,
    chipsRequired: 1,
    winRule: 'exit',
    ruleset: undefined
  };
}

describe('sameDocument', () => {
  it('is true for a clone', () => {
    expect(sameDocument(doc(), cloneDocument(doc()))).toBe(true);
  });

  it('ignores the order of the entities', () => {
    const other = doc();
    other.entities.reverse();
    expect(sameDocument(doc(), other)).toBe(true);
  });

  it('treats an absent ruleset as the default one', () => {
    const other = doc();
    other.ruleset = 'epoxy';
    expect(sameDocument(doc(), other)).toBe(true);
    other.ruleset = 'lynx';
    expect(sameDocument(doc(), other)).toBe(false);
  });

  it('sees a changed cell, field or facing', () => {
    const cell = doc();
    cell.terrain[1][1] = 'wall';
    expect(sameDocument(doc(), cell)).toBe(false);
    const field = doc();
    field.title = 'B';
    expect(sameDocument(doc(), field)).toBe(false);
    const facing = doc();
    facing.entities[0].dir = 'E';
    expect(sameDocument(doc(), facing)).toBe(false);
  });
});

describe('missing player start', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('is carried by a copy, counts as a difference, and is cleared only by placing a start', () => {
    const flagged: EditorDocument = { ...doc(), missingStart: true };
    expect(cloneDocument(flagged).missingStart).toBe(true);
    expect(sameDocument(flagged, doc())).toBe(false);
    // An edit that does not place a start keeps the flag
    const kept = withEditedMap(flagged, { ...flagged, terrain: flagged.terrain.map((row) => [...row]) });
    expect(kept.missingStart).toBe(true);
    // Placing a start clears it, and the document does not bring it back
    const painted = paintPlayerStart(flagged, 0, 0, 'E');
    expect(painted.map.missingStart).toBeUndefined();
    expect(withEditedMap(flagged, painted.map).missingStart).toBeUndefined();
  });

  it('keeps the flag through a wall edit', () => {
    const flagged: EditorDocument = { ...doc(), missingStart: true };
    const edited = withEditedMap(flagged, paintTerrain(flagged, 1, 1, 'wall').map);
    expect(edited.missingStart).toBe(true);
  });
});
