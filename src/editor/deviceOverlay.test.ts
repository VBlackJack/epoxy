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

import { describe, expect, it } from 'vitest';
import type { DeviceRelations, Relation } from '../core/DeviceRelations';
import { EDITOR_RELATION_COLORS, EDITOR_RELATION_MAX_ARROWS } from '../ui/uiConstants';
import { deviceOverlayFor } from './deviceOverlay';

const CELL = { x: 5, y: 5 };

const relations = (controls: Relation[], controlledBy: Relation[] = []): DeviceRelations => ({
  role: null,
  facet: null,
  controls,
  controlledBy
});

describe('deviceOverlayFor', () => {
  it('draws what the cell controls from it and what controls it towards it', () => {
    const overlay = deviceOverlayFor(
      relations(
        [{ x: 8, y: 5, kind: 'link', system: 'trap' }],
        [{ x: 1, y: 5, kind: 'link', system: 'clone' }]
      ),
      CELL
    );
    expect(overlay.arrows).toEqual([
      { system: 'trap', from: CELL, to: { x: 8, y: 5 } },
      { system: 'clone', from: { x: 1, y: 5 }, to: CELL }
    ]);
    expect(overlay.highlights).toEqual([]);
  });

  it('outlines the teleporters of the group and draws no arrow for them', () => {
    const overlay = deviceOverlayFor(
      relations(
        [{ x: 8, y: 1, kind: 'colour', system: 'teleport', channel: 'red' }],
        [{ x: 8, y: 1, kind: 'colour', system: 'teleport', channel: 'red' }]
      ),
      CELL
    );
    expect(overlay.arrows).toEqual([]);
    expect(overlay.highlights).toEqual([{ x: 8, y: 1, system: 'teleport' }]);
  });

  it('caps the colour and level arrows, turns the rest into outlines, and never cuts a link', () => {
    const level: Relation[] = Array.from({ length: EDITOR_RELATION_MAX_ARROWS + 2 }, (_, i) => ({
      x: i,
      y: 0,
      kind: 'level' as const,
      system: 'tank' as const
    }));
    const link: Relation = { x: 9, y: 9, kind: 'link', system: 'trap' };
    const overlay = deviceOverlayFor(relations([...level, link]), CELL);
    // The link comes first and is not counted against the cap.
    expect(overlay.arrows[0]).toEqual({ system: 'trap', from: CELL, to: { x: 9, y: 9 } });
    expect(overlay.arrows).toHaveLength(EDITOR_RELATION_MAX_ARROWS + 1);
    expect(overlay.highlights.map((h) => h.x)).toEqual([EDITOR_RELATION_MAX_ARROWS, EDITOR_RELATION_MAX_ARROWS + 1]);
  });

  it('drops a relation of the cell to itself', () => {
    const overlay = deviceOverlayFor(
      relations([{ ...CELL, kind: 'level', system: 'swap' }], [{ ...CELL, kind: 'level', system: 'swap' }]),
      CELL
    );
    expect(overlay).toEqual({ arrows: [], highlights: [] });
  });

  it('has a colour for every mechanism', () => {
    expect(Object.keys(EDITOR_RELATION_COLORS)).toHaveLength(12);
  });
});
