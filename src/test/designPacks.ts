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

/// <reference types="node" />

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { CampaignChapter, CompiledLevel } from '../core/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The built-in packs whose levels are designed by hand and checked by the design tests and tools. */
export const DESIGN_PACK_IDS = ['campaign', 'pilot'] as const;
export type DesignPackId = (typeof DESIGN_PACK_IDS)[number];

/** Environment variables that pick the pack a tool works on; absent means the campaign. */
export const DESIGN_PACK_VARIABLES = {
  ROUTE: 'EPOXY_ROUTE_PACK',
  DIFFICULTY: 'EPOXY_DIFFICULTY_PACK'
} as const;

/** Where a hand-designed pack keeps its files, and how to read its levels once the configs are loaded. */
export interface DesignPack {
  id: DesignPackId;
  /** public/configs file holding the level blueprints. */
  levelsFile: string;
  routesFile: string;
  rhythmFile: string;
  /** Compiled levels in play order; call after loadTestConfigs. */
  levels: () => CompiledLevel[];
  /** Chapters in play order; call after loadTestConfigs. */
  chapters: () => CampaignChapter[];
}

const CONFIG_DIR = resolve(ROOT, 'public', 'configs');
const TOOLS_DIR = resolve(ROOT, 'tools');

const PACKS: Record<DesignPackId, DesignPack> = {
  campaign: {
    id: 'campaign',
    levelsFile: resolve(CONFIG_DIR, 'levels.json'),
    routesFile: resolve(TOOLS_DIR, 'campaign-routes.json'),
    rhythmFile: resolve(TOOLS_DIR, 'campaign-rhythm.json'),
    levels: () => ConfigRegistry.getLevels(),
    chapters: () => ConfigRegistry.getCampaignChapters()
  },
  pilot: {
    id: 'pilot',
    levelsFile: resolve(CONFIG_DIR, 'pilot-levels.json'),
    routesFile: resolve(TOOLS_DIR, 'pilot-routes.json'),
    rhythmFile: resolve(TOOLS_DIR, 'pilot-rhythm.json'),
    levels: () => ConfigRegistry.getPilotLevels(),
    chapters: () => ConfigRegistry.getPilotChapters()
  }
};

export function designPack(id: DesignPackId): DesignPack {
  return PACKS[id];
}

/** The pack named by an environment variable; an unknown name is an error, not a silent campaign. */
export function designPackFromEnv(variable: string): DesignPack {
  const name = process.env[variable] ?? DESIGN_PACK_IDS[0];
  const id = DESIGN_PACK_IDS.find((candidate) => candidate === name);
  if (!id) throw new Error(`${variable}=${name}: expected one of ${DESIGN_PACK_IDS.join(', ')}`);
  return PACKS[id];
}
