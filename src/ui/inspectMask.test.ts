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

import { describe, expect, it } from 'vitest';
import { inspectDisplayTileId } from './inspectMask';

describe('inspectDisplayTileId', () => {
  it('passes the hidden walls off as floor without the eye boots', () => {
    expect(inspectDisplayTileId('invisible_wall', false)).toBe('floor');
    expect(inspectDisplayTileId('appearing_wall', false)).toBe('floor');
    expect(inspectDisplayTileId('blue_wall_fake', false)).toBe('blue_wall_real');
  });

  it('shows the invisible and appearing walls with the eye boots but keeps the fake blue wall masked', () => {
    expect(inspectDisplayTileId('invisible_wall', true)).toBe('invisible_wall');
    expect(inspectDisplayTileId('appearing_wall', true)).toBe('appearing_wall');
    expect(inspectDisplayTileId('blue_wall_fake', true)).toBe('blue_wall_real');
  });

  it('leaves every other tile alone', () => {
    expect(inspectDisplayTileId('wall', false)).toBe('wall');
    expect(inspectDisplayTileId('floor', true)).toBe('floor');
  });
});
