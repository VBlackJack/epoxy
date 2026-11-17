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

/**
 * Test seam for the point of a tick where Lexy takes its frame-2 decisions: the entity pass has run the pre-pass frames and the frame
 * wire phases, and the decisions are not planned yet. The engine has no hook there; a test mocks epoxyFrames with
 * `decisionSamplingFrames` (vi.mock factory) and registers its sampler with `sampleAtDecisions`. The sampler runs only from the
 * entity pass (the pass is open), never from the tick end that also finishes the frame wire phases, and only while the player is alive
 * and the level not completed (a pass cut short by a death or a win reaches no decision). On a level with actor order the point comes
 * after the pre-pass moves and the frame wire phases; on a level without it (parked players, who step at the input) the pre-pass and
 * the phases already ran at the end of the previous tick, so the point is after the player's own move.
 *
 * Usage in a test file:
 *   vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal()));
 */

import type * as Frames from '../core/epoxy/epoxyFrames';

let sampler: (() => void) | undefined;

/** Registers (or clears, with undefined) the function called at the decision point of every tick. */
export function sampleAtDecisions(fn: (() => void) | undefined): void {
  sampler = fn;
}

/** The real epoxyFrames module, its finishFrameWirePhases followed by the registered sampler when called by the entity pass. */
export function decisionSamplingFrames(real: typeof Frames): typeof Frames {
  return {
    ...real,
    finishFrameWirePhases: (ctx) => {
      real.finishFrameWirePhases(ctx);
      if (ctx.world.ccPassOpen && ctx.world.player.alive && !ctx.world.levelCompleted) sampler?.();
    }
  };
}

/**
 * Runs `tick`, returning what `read` saw at the decision point inside it (undefined when the pass never reached it) and what it sees
 * right after the tick.
 */
export function readAtDecisionAndAfter<T>(tick: () => void, read: () => T): { decision: T | undefined; after: T } {
  let decision: T | undefined;
  sampleAtDecisions(() => {
    decision = read();
  });
  try {
    tick();
  } finally {
    sampleAtDecisions(undefined);
  }
  return { decision, after: read() };
}
