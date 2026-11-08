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

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { Direction } from '../../types';
import { opposite } from '../../lynx/directions';
import { RuleContext, RuleModule, StepAttempt, StepProbe, TileRule } from '../../lynx/ruleApi';
import { ADMISSION } from '../../lynx/tileRules';

/*
 * CC2 swivel doors. A door has two adjacent closed sides. Nobody walks in
 * through a closed side. A creature that walks out through a closed side pushes
 * the door a quarter turn: clockwise when the side clockwise of its exit is
 * closed too, counter-clockwise otherwise. Out through an open side the door
 * stays. The door state is its tile id, so the rule of the new id applies at once.
 */

/** The same rotation rule as leaveSwivel in src/core/epoxy/epoxySwivels.ts (CC2 branch): keep the two in step. */
const SWIVEL_DOORS: readonly string[] = [
  'swivel_door_cc2_ne',
  'swivel_door_cc2_se',
  'swivel_door_cc2_sw',
  'swivel_door_cc2_nw'
];

/** The side clockwise of each side. */
const CLOCKWISE_SIDE: Readonly<Record<Direction, Direction>> = { N: 'E', E: 'S', S: 'W', W: 'N' };

function closedSides(tileId: string): readonly Direction[] {
  return (ConfigRegistry.getTile(tileId).blockedEdges ?? []) as Direction[];
}

const swivelDoor: TileRule = {
  admits: ADMISSION.everyone,
  mayEnter: (probe: StepProbe) => !closedSides(probe.ctx.tileIdAt(probe.to.x, probe.to.y)).includes(opposite(probe.dir))
};

/** The creature left a swivel door by a closed side: the door turns. */
function turnDoor(ctx: RuleContext, attempt: StepAttempt): void {
  if (attempt.outcome === 'refused') return;
  const tileId = ctx.tileIdAt(attempt.from.x, attempt.from.y);
  if (!SWIVEL_DOORS.includes(tileId)) return;
  const closed = closedSides(tileId);
  if (!closed.includes(attempt.dir)) return;
  const turns = ConfigRegistry.getTile(tileId).swivelTurns;
  if (!turns) return;
  ctx.setTerrain(attempt.from.x, attempt.from.y, closed.includes(CLOCKWISE_SIDE[attempt.dir]) ? turns.cw : turns.ccw);
}

export const swivelRules: RuleModule = {
  name: 'cc2Swivels',
  tiles: Object.fromEntries(SWIVEL_DOORS.map((id) => [id, swivelDoor])),
  onStepAttempt: turnDoor
};
