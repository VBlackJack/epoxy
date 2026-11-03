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
import { findSimilarRooms, findSimilarRoomsWithin, layoutFromLevel, RoomLayout } from '../generator/RoomFingerprint';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { loadReferenceRooms, REFERENCE_XSB_ENV } from '../test/referenceXsb';
import { ConfigRegistry } from './ConfigRegistry';

/** How many closest pairs a failure message lists. */
const REPORTED_PAIRS = 5;
/** Search floor that keeps every pair, so a message can always name the nearest ones. */
const NO_FLOOR = 0;

function formatPair(p: { candidate: string; reference: string; similarity: number; matchedCells: number }): string {
  return `${p.candidate} ~ ${p.reference}: similarity ${p.similarity.toFixed(3)} (${p.matchedCells} matching cells)`;
}

describe('campaign room originality', () => {
  let rooms: RoomLayout[];

  beforeAll(() => {
    loadTestConfigs();
    rooms = ConfigRegistry.getLevels().map((level) =>
      layoutFromLevel(
        `campaign #${level.number} ${level.id}`,
        level,
        (id) => ConfigRegistry.getTile(id),
        (id) => ConfigRegistry.getEntityDef(id)
      )
    );
  });

  it('keeps every campaign level unlike every other campaign level', () => {
    const { maxRoomSimilarity } = ConfigRegistry.getGame().campaignGuard;
    expect(rooms.length).toBeGreaterThan(1);
    const closest = findSimilarRoomsWithin(rooms, NO_FLOOR).slice(0, REPORTED_PAIRS);
    const offenders = closest.filter((p) => p.similarity >= maxRoomSimilarity);
    expect(offenders.map(formatPair), `closest pairs (threshold ${maxRoomSimilarity}):\n${closest.map(formatPair).join('\n')}`).toEqual([]);
  });

  it.skipIf(!process.env[REFERENCE_XSB_ENV])(
    'keeps every campaign room with targets unlike every reference Sokoban puzzle',
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
