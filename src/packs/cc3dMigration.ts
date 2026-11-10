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

import type { CompiledLevel, LevelPack } from '../core/types';
import { convertCc3dLevel } from '../core/cc3d/cc3dToEpoxy';

/** What the load-time migration did to the stored CC3D levels. */
export interface Cc3dMigrationReport {
  /** Levels now played on the Epoxy engine. */
  readonly converted: number;
  /** Levels whose conversion failed or is lost: they stay CC3D levels, still playable on the CC3D engine. */
  readonly kept: number;
}

export interface Cc3dPackMigration {
  readonly pack: LevelPack;
  readonly converted: number;
  readonly kept: number;
}

/** A stored level still played by the CC3D engine. */
export function isStoredCc3dLevel(level: CompiledLevel): boolean {
  return level.ruleset === 'cc3d' && level.cc3d !== undefined;
}

/**
 * Converts the CC3D levels of a stored pack to Epoxy levels. The converted level keeps the id of the level it replaces
 * (so scores and completion stay attached) and the CC3D payload in `cc3dSource` (so it counts as converted and can be
 * converted again). A level whose conversion throws, or which the converter reports as lost, stays as it is. A pack without a CC3D level is returned unchanged,
 * which makes a second run a no-op.
 */
export function migrateCc3dPack(pack: LevelPack): Cc3dPackMigration {
  let converted = 0;
  let kept = 0;
  const levels = pack.levels.map((level) => {
    if (!isStoredCc3dLevel(level)) return level;
    let result: ReturnType<typeof convertCc3dLevel>;
    try {
      result = convertCc3dLevel(level);
    } catch {
      kept++;
      return level;
    }
    // A level the converter reports as lost holds mechanics Epoxy cannot play: the CC3D engine keeps it.
    if (result.report.lost.length > 0) {
      kept++;
      return level;
    }
    converted++;
    return { ...result.level, id: level.id, cc3dSource: level.cc3d };
  });
  return { pack: converted > 0 ? { ...pack, levels } : pack, converted, kept };
}
