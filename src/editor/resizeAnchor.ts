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


/** Which cell of the 3 x 3 grid of anchors a resize keeps fixed: 0 = start edge, 1 = centre, 2 = end edge. */
export interface ResizeAnchor {
  col: ResizeAnchorStep;
  row: ResizeAnchorStep;
}

export type ResizeAnchorStep = 0 | 1 | 2;

export const ANCHOR_START: ResizeAnchorStep = 0;
export const ANCHOR_CENTRE: ResizeAnchorStep = 1;
export const ANCHOR_END: ResizeAnchorStep = 2;

/** Number of anchor positions along one axis. */
export const ANCHOR_STEPS = 3;

/** The anchor a resize uses when none is given: the top-left cell. */
export const TOP_LEFT_ANCHOR: ResizeAnchor = { col: ANCHOR_START, row: ANCHOR_START };

function offsetAlong(step: ResizeAnchorStep, delta: number): number {
  if (step === ANCHOR_START) return 0;
  if (step === ANCHOR_END) return delta;
  return Math.trunc(delta / 2);
}

/**
 * Where the old top-left cell lands in the new grid, for a size change of (dw, dh) = new - old.
 * The centre rounds toward zero: growing by an odd amount leaves the extra column on the end side,
 * shrinking by an odd amount crops the extra column on the end side too.
 */
export function anchorOffset(anchor: ResizeAnchor, dw: number, dh: number): { dx: number; dy: number } {
  return { dx: offsetAlong(anchor.col, dw), dy: offsetAlong(anchor.row, dh) };
}
