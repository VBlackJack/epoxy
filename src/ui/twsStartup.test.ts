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

import { describe, expect, it, vi } from 'vitest';

/**
 * A branch once crashed at startup because a new module read a config section in a field initializer, before the configs
 * were loaded. These build every new module with no config at all: only a call that needs a limit may read one.
 */
describe('the Tile World replay modules before the configs are loaded', () => {
  it('build and import without reading any config', async () => {
    vi.resetModules();
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    // No loadAll, no applyConfigs: any read of a section through the registry would fail.
    expect(ConfigRegistry.getGame()).toBeUndefined();
    const { TwsRun } = await import('./twsRun');
    const { TwsPackSection } = await import('./twsPackSection');
    const { TwsFiles } = await import('../storage/TwsFiles');
    const { TwsStorage } = await import('../storage/TwsStorage');
    await import('../core/cclp/twsReplay');
    await import('../formats/TwsCodec');
    await import('./twsSolution');
    await import('./twsLoadFlow');
    const run = new TwsRun();
    expect(run.replayActive(false)).toBe(false);
    expect(() => new TwsPackSection({ isOpen: () => false, notify: () => undefined, packDisplayName: (pack) => pack.name })).not.toThrow();
    expect(TwsFiles.peek('any')).toBeUndefined();
    expect(TwsStorage).toBeDefined();
  });
});
