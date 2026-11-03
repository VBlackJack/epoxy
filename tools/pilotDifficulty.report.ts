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
 * Measures the Epoxy pilot pack (tools/pilot-rhythm.json and
 * public/configs/pilot-levels.json). It is campaignDifficulty.report.ts with the
 * pack set, so the npm script needs no shell-specific environment syntax.
 *
 * Run with: npm run report:difficulty:pilot
 */

/// <reference types="node" />

import { DESIGN_PACK_VARIABLES } from '../src/test/designPacks';

process.env[DESIGN_PACK_VARIABLES.DIFFICULTY] = 'pilot';
await import('./campaignDifficulty.report');
