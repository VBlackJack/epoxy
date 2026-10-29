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
 * Stand-in for the AudioManager module in node tests, which have no Web Audio.
 * Every method is a no-op, except runSilently, which must still run its task.
 *
 * Use with: vi.mock('<path>/audio/AudioManager', () => import('<path>/test/silentAudio'));
 */
const methods: Record<string, unknown> = {
  runSilently: <T>(task: () => T): T => task()
};

export const AudioManager = new Proxy(methods, {
  get: (target, name: string) => target[name] ?? (() => undefined)
});
