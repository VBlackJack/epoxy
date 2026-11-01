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

/** Public API of the 32-Bit Retro sprite derivation (pure, DOM-free). */

export { RETRO32_SPRITE_SIZE, rasterizeSprite32 } from './rasterize';
export { RETRO32_RAMP_TONES, deriveRetro32Ramps } from './ramps';
export { isFifteenBitColour } from './colour';
export { createRetro32SpriteCache, type Retro32SpriteCache } from './cache';
export {
  RETRO32_LAYER_SCALE,
  RETRO32_SPEC,
  RETRO32_STYLE_ID,
  createRetro32ThemeSprites,
  type Retro32Recolour,
  type Retro32ThemeSprites
} from './spriteStyle32';
