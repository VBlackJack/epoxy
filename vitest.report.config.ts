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

import { defineConfig } from 'vitest/config';

/** Mining pieces takes the longest of the authoring tools, about half an hour. */
const AUTHORING_TOOL_TIMEOUT_MS = 3600000;

/** Runs the measurement and authoring tools, which are too slow for the regular test suite. */
export default defineConfig({
  test: {
    include: ['tools/**/*.report.ts'],
    environment: 'node',
    testTimeout: AUTHORING_TOOL_TIMEOUT_MS
  }
});
