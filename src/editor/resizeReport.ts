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

import { ResizeResult } from './mapEdits';

/** One line of the report after a resize: a locale key and its parameters. */
export interface ResizeNote {
  key: string;
  params?: Record<string, string | number>;
}

export const RESIZE_DONE_KEY = 'editor.layout.size.resized';
export const RESIZE_UNCHANGED_KEY = 'editor.layout.size.unchanged';
export const RESIZE_DROPPED_ENTITIES_KEY = 'editor.layout.size.dropped_entities';
export const RESIZE_DROPPED_LINKS_KEY = 'editor.layout.size.dropped_links';
export const RESIZE_START_MOVED_KEY = 'editor.layout.size.start_moved';
export const RESIZE_BORDER_KEY = 'editor.layout.size.border_kept';

/** What a resize did, as the notes to announce: the new size first, then what was dropped or moved. */
export function describeResize(result: ResizeResult): ResizeNote[] {
  if (!result.changed) return [{ key: RESIZE_UNCHANGED_KEY, params: { width: result.width, height: result.height } }];
  const notes: ResizeNote[] = [{ key: RESIZE_DONE_KEY, params: { width: result.width, height: result.height } }];
  const { report } = result;
  if (report.droppedEntities > 0) notes.push({ key: RESIZE_DROPPED_ENTITIES_KEY, params: { count: report.droppedEntities } });
  const links = report.droppedTrapLinks + report.droppedCloneLinks;
  if (links > 0) notes.push({ key: RESIZE_DROPPED_LINKS_KEY, params: { count: links } });
  if (report.playerStartMoved) notes.push({ key: RESIZE_START_MOVED_KEY });
  if (report.borderKept) notes.push({ key: RESIZE_BORDER_KEY });
  return notes;
}
