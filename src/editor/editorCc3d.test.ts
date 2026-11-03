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

import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { deriveDisplayLayers } from '../core/cc3d/cc3dLayers';
import { cellAt, type Cc3dLevel } from '../core/cc3d/model';
import { DEFAULT_WIN_RULE } from '../core/coreConstants';
import type { CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { placeLayer, setItem } from './cc3dEdits';
import { compiledCc3d, editableCc3dModel, smallCc3dLevel } from './cc3dEditorFixtures';
import { cloneDocument, cloneMap, sameDocument, snapshotDocument, withCc3d, type EditorDocument } from './editorDocument';
import { EditorHistory } from './editorHistory';
import { cc3dFishCount, documentFromLevel, levelFromDocument } from './editorLevelIo';

const TEXTS = { title: 'Title', hint: 'Hint' };
const EXPORT = { id: 'exported', number: 7, password: 'PASS', fallbackTitle: 'Untitled' };

beforeEach(() => {
  loadTestConfigs();
});

describe('documentFromLevel and levelFromDocument for a CC3D level', () => {
  it('holds the cc3d data by reference and derives the display layers', () => {
    const level = smallCc3dLevel();
    const doc = documentFromLevel(level, TEXTS);
    expect(doc.cc3d).toBe(level.cc3d);
    const derived = deriveDisplayLayers(level.cc3d as Cc3dLevel);
    expect(doc.terrain).toEqual(derived.terrain);
    expect(doc.items).toEqual(derived.items);
    expect(doc.entities).toEqual(derived.entities);
    expect(doc.playerStart).toEqual({ x: 1, y: 1, dir: 'W' });
  });

  it('exports cc3d and mapId, and recomputes the fish count', () => {
    const level = smallCc3dLevel();
    const doc = documentFromLevel(level, TEXTS);
    const edited = withCc3d(doc, setItem(setItem(doc.cc3d as Cc3dLevel, 3, 2, { kind: 'fish' }), 1, 2, { kind: 'fish' }));
    const out = levelFromDocument({ ...edited, chipsRequired: 0 }, EXPORT);
    expect(out.cc3d?.mapId).toBe('small');
    expect(out.cc3d).toBe(edited.cc3d);
    expect(out.ruleset).toBe('cc3d');
    expect(out.chipsRequired).toBe(3);
    expect(cc3dFishCount(out.cc3d as Cc3dLevel)).toBe(3);
    expect(out.terrain).toEqual(deriveDisplayLayers(out.cc3d as Cc3dLevel).terrain);
    expect(out.id).toBe('exported');
    expect(out.number).toBe(7);
  });

  it('round-trips an unedited level to an identical cc3d', () => {
    const level = smallCc3dLevel();
    const back = levelFromDocument(documentFromLevel(level, TEXTS), EXPORT);
    expect(JSON.stringify(back.cc3d)).toBe(JSON.stringify(level.cc3d));
  });
});

/** The conversion the editor did inline before it was extracted, kept as the oracle of the guard below. */
function legacyExport(level: CompiledLevel): CompiledLevel {
  const doc = {
    ...cloneMap(level),
    title: TEXTS.title,
    hint: TEXTS.hint,
    author: level.author ?? '',
    password: level.password,
    timeLimitSeconds: level.timeLimitSeconds,
    chipsRequired: level.chipsRequired,
    winRule: level.winRule ?? DEFAULT_WIN_RULE,
    ruleset: level.ruleset
  };
  return {
    id: EXPORT.id,
    ...(doc.winRule === DEFAULT_WIN_RULE ? {} : { winRule: doc.winRule }),
    ...(doc.ruleset ? { ruleset: doc.ruleset } : {}),
    number: EXPORT.number,
    customTitle: doc.title || EXPORT.fallbackTitle,
    customHint: doc.hint,
    ...(doc.author ? { author: doc.author } : {}),
    password: EXPORT.password,
    timeLimitSeconds: doc.timeLimitSeconds,
    chipsRequired: doc.chipsRequired,
    ...cloneMap(doc)
  };
}

describe('Epoxy and Lynx export guard', () => {
  it('exports every shipped level byte for byte as the editor did before', () => {
    const levels = ConfigRegistry.getLevels();
    expect(levels.length).toBeGreaterThan(0);
    const variants = levels.flatMap((level) => [level, { ...level, ruleset: 'lynx' as const }]);
    for (const level of variants) {
      const now = levelFromDocument(documentFromLevel(level, TEXTS), EXPORT);
      expect(JSON.stringify(now)).toBe(JSON.stringify(legacyExport(level)));
      expect('cc3d' in now).toBe(false);
    }
  });
});

describe('cc3d document copies, equality and history', () => {
  function doc(): EditorDocument {
    return documentFromLevel(smallCc3dLevel(), TEXTS);
  }

  it('clones by reference to the immutable level', () => {
    const d = doc();
    const copy = cloneDocument(d);
    expect(copy.cc3d).toBe(d.cc3d);
    expect(copy.terrain).not.toBe(d.terrain);
  });

  it('compares a cc3d document by reference, then by canonical content, and mob order counts', () => {
    const d = doc();
    const cc3d = d.cc3d as Cc3dLevel;
    expect(sameDocument(d, cloneDocument(d))).toBe(true);
    // Same content in another object with another key order.
    const reordered: Cc3dLevel = JSON.parse(JSON.stringify({ mobs: cc3d.mobs, cells: cc3d.cells, player: cc3d.player, height: cc3d.height, width: cc3d.width, mapId: cc3d.mapId }));
    expect(sameDocument(d, withCc3d(d, reordered))).toBe(true);
    const swapped: Cc3dLevel = { ...cc3d, mobs: [...cc3d.mobs].reverse() };
    expect(sameDocument(d, withCc3d(d, swapped))).toBe(false);
    const plain = { ...d, cc3d: undefined };
    expect(sameDocument(d, plain)).toBe(false);
  });

  it('records no step for a no-op edit and undoes an edit to the same document', () => {
    const d = doc();
    const cc3d = d.cc3d as Cc3dLevel;
    expect(withCc3d(d, placeLayer(cc3d, 2, 1, { kind: 'floor' }))).toBe(d);
    const history = new EditorHistory(10);
    const edited = withCc3d(d, placeLayer(cc3d, 2, 1, { kind: 'water' }));
    expect(sameDocument(d, edited)).toBe(false);
    history.push(d);
    const undone = history.undo(edited) as EditorDocument;
    expect(sameDocument(undone, d)).toBe(true);
    expect(undone.terrain).toEqual(d.terrain);
    expect(undone.entities).toEqual(d.entities);
    const redone = history.redo(undone) as EditorDocument;
    expect(sameDocument(redone, edited)).toBe(true);
    expect(redone.terrain).toEqual(edited.terrain);
  });
});

/** A garbage collection the test can ask for without a command line flag. */
function collectGarbage(): void {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  gc();
}

const MEMORY_LEVEL_WIDTH = 100;
const MEMORY_LEVEL_HEIGHT = 114;
const MEMORY_BYTES_PER_MEGABYTE = 1024 * 1024;
/** Generous: a step is one array of 11400 references (about 90 KB) plus the changed cell. */
const MEMORY_STEP_BOUND_BYTES = 1024 * 1024;

describe('history memory on a large cc3d level', () => {
  it('shares every untouched cell across 300 single-cell undo steps', () => {
    const steps = ConfigRegistry.getGame().timing.maxUndoSnapshots;
    const rows = Array.from({ length: MEMORY_LEVEL_HEIGHT }, (_, y) => {
      const row = '.'.repeat(MEMORY_LEVEL_WIDTH);
      return y === 0 ? `@${row.slice(2)}X` : row;
    });
    const first = documentFromLevel(compiledCc3d(editableCc3dModel(rows)), TEXTS);
    const originalCells = (first.cc3d as Cc3dLevel).cells;

    // Primary, deterministic checks: a snapshot is the level reference alone, with no derived layer.
    const snapshot = snapshotDocument(first);
    expect(snapshot.cc3d).toBe(first.cc3d);
    expect(snapshot.terrain).toEqual([]);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.entities).toEqual([]);

    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    const history = new EditorHistory(steps);
    let current = first;
    for (let step = 0; step < steps; step++) {
      history.push(current);
      const x = 1 + (step % (MEMORY_LEVEL_WIDTH - 2));
      const y = 1 + Math.floor(step / (MEMORY_LEVEL_WIDTH - 2));
      const kind = step % 2 === 0 ? 'wall' : 'water';
      current = withCc3d(current, placeLayer(current.cc3d as Cc3dLevel, x, y, { kind }));
    }
    // The live document keeps its own derived layers; drop it so only what history holds is measured.
    const finalCells = (current.cc3d as Cc3dLevel).cells;
    current = first;
    collectGarbage();
    const growth = process.memoryUsage().heapUsed - before;
    const perStep = growth / steps;
    console.info(`cc3d history: ${steps} steps on ${MEMORY_LEVEL_WIDTH}x${MEMORY_LEVEL_HEIGHT}, heap growth ${(growth / MEMORY_BYTES_PER_MEGABYTE).toFixed(1)} MB, ${(perStep / 1024).toFixed(1)} KB per step`);

    // Structural sharing: only the edited cells differ between the first and the last level.
    const differing = finalCells.filter((cell, index) => cell !== originalCells[index]).length;
    expect(differing).toBe(steps);
    // And the history can walk all the way back to the first level.
    let walker = withCc3d(first, { ...(first.cc3d as Cc3dLevel), cells: finalCells });
    let undone = 0;
    for (let step = steps; step > 0; step--) {
      const previous = history.undo(walker);
      if (!previous) break;
      walker = previous;
      undone++;
    }
    expect(undone).toBe(steps);
    expect(cellAt(walker.cc3d as Cc3dLevel, 1, 1)).toBe(cellAt(first.cc3d as Cc3dLevel, 1, 1));
    expect(walker.cc3d?.cells).toBe(originalCells);
    // Secondary and loose: the heap figure is noisy, so it only catches a return to deep copies.
    expect(perStep).toBeLessThan(MEMORY_STEP_BOUND_BYTES);
  });
});
