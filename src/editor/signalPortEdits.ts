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

import { cloneMap } from './editorDocument';
import type { EditorMap } from './editorDocument';
import { swapSignalPorts } from './editorSignalLinks';
import type { SignalPortSide } from './signalPortRoles';

/** The outcome of a port swap: the map to use, and whether any wire moved. */
export interface SignalPortSwapResult {
  map: EditorMap;
  changed: boolean;
}

/**
 * Swaps the ports of the wires on one side of a data latch or a counter, as one edit on a copy. Unchanged (same map)
 * when the cell holds no such gate, has no wire on that side, or the map is a CC3D room.
 */
export function swapGatePorts(source: EditorMap, cell: { x: number; y: number }, side: SignalPortSide): SignalPortSwapResult {
  if (source.cc3d) return { map: source, changed: false };
  const map = cloneMap(source);
  const moved = swapSignalPorts(map, cell, side);
  return moved > 0 ? { map, changed: true } : { map: source, changed: false };
}
