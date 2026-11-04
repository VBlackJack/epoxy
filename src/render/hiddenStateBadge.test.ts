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

/** The stored-state badge of a hidden toggle wall or hold door: editor only, drawn beside the hidden marker. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { hiddenTerrainClosed } from '../editor/editorUnderlays';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_HIDDEN_STATE_BADGE_FILL } from '../ui/uiConstants';
import { PixelRenderer } from './PixelRenderer';

const TILE = 32;

interface Call {
  readonly name: string;
  readonly fill: unknown;
  readonly stroke: unknown;
}

/** A context that records the rectangles it is asked to draw, with the colours in force. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1 };
  const ctx = new Proxy(state, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop as keyof typeof target];
      return (): void => {
        calls.push({ name: prop, fill: target.fillStyle, stroke: target.strokeStyle });
      };
    },
    set: (target, prop: string, value) => {
      (target as Record<string, unknown>)[prop] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function badgeCalls(calls: readonly Call[]): Call[] {
  return calls.filter((call) => call.name === 'strokeRect' || (call.name === 'fillRect' && call.fill === EDITOR_HIDDEN_STATE_BADGE_FILL));
}

describe('stored-state badge of hidden terrain', () => {
  let renderer: PixelRenderer;

  beforeEach(() => {
    loadTestConfigs();
    renderer = new PixelRenderer();
  });

  it('reads the state from the tile config for toggle walls and hold doors only', () => {
    expect(hiddenTerrainClosed('toggle_wall_closed')).toBe(true);
    expect(hiddenTerrainClosed('toggle_wall_open')).toBe(false);
    expect(hiddenTerrainClosed('toggle_wall_blue_closed')).toBe(true);
    expect(hiddenTerrainClosed('toggle_wall_blue_open')).toBe(false);
    expect(hiddenTerrainClosed('hold_door_green_closed')).toBe(true);
    expect(hiddenTerrainClosed('hold_door_green_open')).toBe(false);
    for (const other of ['socket', 'dirt', 'blue_wall_fake', 'pressure_plate_red', 'ice', 'floor', 'not_a_tile', 'key_red']) {
      expect(hiddenTerrainClosed(other), other).toBeUndefined();
    }
  });

  it('draws a filled square for a closed state and an outlined one for an open state', () => {
    renderer.setHiddenLayerMarkers(true);
    const closed = recordingContext();
    renderer.drawCellOverlay(closed.ctx, undefined, true, 0, 0, TILE, true);
    expect(badgeCalls(closed.calls).map((call) => call.name)).toEqual(['fillRect']);

    const open = recordingContext();
    renderer.drawCellOverlay(open.ctx, undefined, true, 0, 0, TILE, false);
    expect(badgeCalls(open.calls).map((call) => call.name)).toEqual(['strokeRect']);
  });

  it('draws no badge for other hidden terrain, an unmarked cell, or while the markers are off (play)', () => {
    const spy = vi.spyOn(renderer as unknown as { drawHiddenStateBadge: () => void }, 'drawHiddenStateBadge');
    renderer.setHiddenLayerMarkers(true);
    renderer.drawCellOverlay(recordingContext().ctx, undefined, true, 0, 0, TILE);
    renderer.drawCellOverlay(recordingContext().ctx, undefined, false, 0, 0, TILE, true);
    expect(spy).not.toHaveBeenCalled();
    renderer.setHiddenLayerMarkers(false);
    renderer.drawCellOverlay(recordingContext().ctx, undefined, true, 0, 0, TILE, true);
    expect(spy).not.toHaveBeenCalled();
  });
});
