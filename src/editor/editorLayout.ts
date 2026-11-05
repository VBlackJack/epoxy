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

import { EDITOR_ONE_COLUMN_BELOW_WIDTH, EDITOR_PORTRAIT_MIN_ASPECT, EDITOR_TWO_COLUMN_BELOW_WIDTH } from '../ui/uiConstants';

/** Columns the editor shows: palette | canvas | inspector, canvas | side column, or a single column. */
export type EditorLayoutMode = 'three' | 'two' | 'one';

/**
 * Layout for a view size in CSS pixels. A medium-width view that is clearly taller than wide (a portrait tablet)
 * gets one column, so the stage keeps the full width.
 */
export function layoutModeForSize(width: number, height: number): EditorLayoutMode {
  if (!Number.isFinite(width) || width < EDITOR_ONE_COLUMN_BELOW_WIDTH) return 'one';
  if (width >= EDITOR_TWO_COLUMN_BELOW_WIDTH) return 'three';
  if (Number.isFinite(height) && height >= width * EDITOR_PORTRAIT_MIN_ASPECT) return 'one';
  return 'two';
}

/** Layout for a view width alone, taking the view as not portrait. */
export function layoutModeForWidth(width: number): EditorLayoutMode {
  return layoutModeForSize(width, 0);
}
