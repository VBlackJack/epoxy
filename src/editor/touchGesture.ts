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

/** Pure geometry of the two-finger gesture of the editor canvas (pan and pinch zoom). */

export interface TouchPoint {
  x: number;
  y: number;
}

/** The two-finger gesture in progress: the pointers it follows and the numbers its moves are measured from. */
export interface TouchGestureState {
  ids: readonly [number, number];
  lastMid: TouchPoint;
  /** Distance the next zoom step is measured from; moved to the current distance after each step attempt. */
  refDist: number;
  /** Distance when the second finger landed, to tell a pinch from a pan. */
  startDist: number;
  pinching: boolean;
}

const HALF = 2;

export function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / HALF, y: (a.y + b.y) / HALF };
}

export function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True once the fingers have moved apart or together by more than the start threshold. */
export function startsPinch(dist: number, startDist: number, thresholdPx: number): boolean {
  return Math.abs(dist - startDist) > thresholdPx;
}

/** Which way one zoom step goes for the current distance, or null while it stays within the ratio of the reference. */
export function pinchStep(dist: number, refDist: number, ratio: number): 'in' | 'out' | null {
  if (refDist <= 0 || ratio <= 1) return null;
  const scale = dist / refDist;
  if (scale >= ratio) return 'in';
  if (scale <= 1 / ratio) return 'out';
  return null;
}
