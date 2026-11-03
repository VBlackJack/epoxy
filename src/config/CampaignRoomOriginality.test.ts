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

import { beforeAll, describe, expect, it } from 'vitest';
import { CompiledLevel } from '../core/types';
import {
  findSimilarRooms,
  findSimilarRoomsWithin,
  layoutFromLevel,
  RoomLayout,
  SimilarRoomPair
} from '../generator/RoomFingerprint';
import { buildTestLevel } from '../test/buildTestLevel';
import { DESIGN_PACK_IDS, designPack, DesignPackId } from '../test/designPacks';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { loadReferenceRooms, REFERENCE_XSB_ENV } from '../test/referenceXsb';
import { ConfigRegistry } from './ConfigRegistry';

/** How many closest pairs a failure message lists. */
const REPORTED_PAIRS = 5;

function formatPair(p: { candidate: string; reference: string; similarity: number; matchedCells: number }): string {
  return `${p.candidate} ~ ${p.reference}: similarity ${p.similarity.toFixed(3)} (${p.matchedCells} matching cells)`;
}

function roomLabel(packId: DesignPackId, level: CompiledLevel): string {
  return `${packId} #${level.number} ${level.id}`;
}

function roomsOf(packId: DesignPackId): RoomLayout[] {
  return designPack(packId)
    .levels()
    .map((level) =>
      layoutFromLevel(
        roomLabel(packId, level),
        level,
        (id) => ConfigRegistry.getTile(id),
        (id) => ConfigRegistry.getEntityDef(id)
      )
    );
}

/**
 * Drops the pairs a pilot level was explicitly reworked from: `reworkOf` maps a
 * level id to the one old level it may resemble, and exempts exactly that pair.
 */
function withoutReworkedPairs(
  pairs: SimilarRoomPair[],
  reworkOf: ReadonlyMap<string, string>,
  idOfLabel: (label: string) => string
): SimilarRoomPair[] {
  return pairs.filter((pair) => reworkOf.get(idOfLabel(pair.candidate)) !== idOfLabel(pair.reference));
}

/** The level id at the end of a room label. */
function idOfLabel(label: string): string {
  return label.slice(label.lastIndexOf(' ') + 1);
}

for (const packId of DESIGN_PACK_IDS) {
  describe(`${packId} room originality`, () => {
    let rooms: RoomLayout[];

    beforeAll(() => {
      loadTestConfigs();
      rooms = roomsOf(packId);
    });

    it(`keeps every ${packId} level unlike every other ${packId} level`, () => {
      const { maxRoomSimilarity } = ConfigRegistry.getGame().campaignGuard;
      // An empty pilot has nothing to compare and passes.
      if (packId === 'campaign') expect(rooms.length).toBeGreaterThan(1);
      const offenders = findSimilarRoomsWithin(rooms, maxRoomSimilarity).slice(0, REPORTED_PAIRS);
      expect(offenders.map(formatPair), `closest pairs at or above ${maxRoomSimilarity}`).toEqual([]);
    });

    it.skipIf(!process.env[REFERENCE_XSB_ENV])(
      `keeps every ${packId} room with targets unlike every reference Sokoban puzzle`,
      () => {
        const { maxSokobanSimilarity } = ConfigRegistry.getGame().campaignGuard;
        const reference = loadReferenceRooms(process.env[REFERENCE_XSB_ENV] as string);
        expect(reference.length, `no puzzle with targets found under ${REFERENCE_XSB_ENV}`).toBeGreaterThan(0);
        const offenders = findSimilarRooms(
          rooms.filter((r) => r.targets > 0),
          reference,
          maxSokobanSimilarity
        );
        expect(offenders.slice(0, REPORTED_PAIRS).map(formatPair)).toEqual([]);
      }
    );
  });
}

describe('pilot against the current campaign', () => {
  let pilot: RoomLayout[];
  let campaign: RoomLayout[];
  let reworkOf: Map<string, string>;

  beforeAll(() => {
    loadTestConfigs();
    pilot = roomsOf('pilot');
    campaign = roomsOf('campaign');
    reworkOf = new Map(
      ConfigRegistry.getPilotBlueprints().flatMap((blueprint) =>
        blueprint.reworkOf ? [[blueprint.id, blueprint.reworkOf] as [string, string]] : []
      )
    );
  });

  it('keeps every pilot level unlike every campaign level, except the one it explicitly reworks', () => {
    const { maxRoomSimilarity } = ConfigRegistry.getGame().campaignGuard;
    const offenders = withoutReworkedPairs(findSimilarRooms(pilot, campaign, maxRoomSimilarity), reworkOf, idOfLabel);
    expect(offenders.slice(0, REPORTED_PAIRS).map(formatPair), `pairs at or above ${maxRoomSimilarity}`).toEqual([]);
  });

  it('exempts a declared rework and nothing else', () => {
    const { maxRoomSimilarity } = ConfigRegistry.getGame().campaignGuard;
    // The seed pilot level is a copy of its campaign original: the raw comparison finds it, the exemption removes it.
    const raw = findSimilarRooms(pilot, campaign, maxRoomSimilarity);
    const declared = [...reworkOf.entries()];
    for (const [pilotId, oldId] of declared) {
      expect(raw.some((p) => idOfLabel(p.candidate) === pilotId && idOfLabel(p.reference) === oldId), pilotId).toBe(true);
    }
    expect(withoutReworkedPairs(raw, new Map(), idOfLabel)).toHaveLength(raw.length);
    if (declared.length > 0) expect(withoutReworkedPairs(raw, reworkOf, idOfLabel).length).toBeLessThan(raw.length);
  });
});

describe('rework exemption on a fixture', () => {
  const pair = (candidate: string, reference: string): SimilarRoomPair => ({
    candidate,
    reference,
    similarity: 1,
    matchedCells: 1
  });

  it('exempts only the declared pair', () => {
    const pairs = [pair('pilot #1 p1', 'campaign #1 c1'), pair('pilot #1 p1', 'campaign #2 c2'), pair('pilot #2 p2', 'campaign #1 c1')];
    const kept = withoutReworkedPairs(pairs, new Map([['p1', 'c1']]), idOfLabel);
    expect(kept.map((p) => `${idOfLabel(p.candidate)}~${idOfLabel(p.reference)}`)).toEqual(['p1~c2', 'p2~c1']);
  });

  it('finds an identical room, so an undeclared copy would fail', () => {
    loadTestConfigs();
    const level = buildTestLevel(['@.E', '...']);
    const layout = (label: string) =>
      layoutFromLevel(label, level, (id) => ConfigRegistry.getTile(id), (id) => ConfigRegistry.getEntityDef(id));
    const found = findSimilarRooms([layout('pilot #1 p1')], [layout('campaign #1 c1')], 0.5);
    expect(found).toHaveLength(1);
  });
});
