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
 * Loads a reference Sokoban collection from disk for the opt-in originality
 * checks. The path comes from EPOXY_REFERENCE_XSB, is a single file or a folder
 * (searched recursively), and its content is never copied into the repository.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseXsbCollection, XSB_EXTENSIONS } from '../formats/XsbCodec';
import { layoutFromXsb, RoomLayout } from '../generator/RoomFingerprint';

/** Environment variable naming the reference collection. */
export const REFERENCE_XSB_ENV = 'EPOXY_REFERENCE_XSB';
/** Extensions read from a reference folder; a plain .txt is allowed here, unlike in the editor. */
const REFERENCE_EXTENSIONS: readonly string[] = [...XSB_EXTENSIONS, '.txt'];

/** Lists the collection files under a path, sorted for a stable report. */
export function listReferenceFiles(path: string): string[] {
  const root = resolve(path);
  if (statSync(root).isFile()) return [root];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (REFERENCE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

/** Every puzzle with at least one target of the collection(s) at `path`, as a room layout. */
export function loadReferenceRooms(path: string): RoomLayout[] {
  const rooms: RoomLayout[] = [];
  for (const file of listReferenceFiles(path)) {
    parseXsbCollection(readFileSync(file, 'utf-8')).forEach((level, i) => {
      if (level.unsupported) return;
      const room = layoutFromXsb(`${basename(file)} #${i + 1} ${level.title}`, level);
      if (room.targets > 0) rooms.push(room);
    });
  }
  return rooms;
}
