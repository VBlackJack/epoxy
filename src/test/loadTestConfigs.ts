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

import { ConfigBundle, ConfigRegistry } from '../config/ConfigRegistry';
import audio from '../../public/configs/audio.json';
import datFormat from '../../public/configs/dat_format.json';
import game from '../../public/configs/game.json';
import levels from '../../public/configs/levels.json';
import monsters from '../../public/configs/monsters.json';
import tiles from '../../public/configs/tiles.json';

/** Returns a deep copy of the shipped configs, safe to mutate in a test. */
export function createTestBundle(): ConfigBundle {
  return structuredClone({
    game,
    tiles,
    monsters,
    audio,
    levels,
    datFormat
  }) as unknown as ConfigBundle;
}

/** Installs the shipped configs into the registry singleton. */
export function loadTestConfigs(): ConfigBundle {
  const bundle = createTestBundle();
  ConfigRegistry.applyConfigs(bundle);
  return bundle;
}
