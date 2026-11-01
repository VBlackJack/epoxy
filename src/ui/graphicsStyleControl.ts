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
 * Pure helpers behind the render style selector of the options drawer: the option list, the
 * initial style resolution and the canvas classes to drop when a style is applied.
 */

import {
  DEFAULT_RENDER_STYLE_ID,
  RENDER_STYLES,
  getRenderStyle,
  parseRenderStyleId,
  type RenderStyleDescriptor,
  type RenderStyleId
} from '../render/styles/renderStyles';

export interface GraphicsStyleOption {
  readonly value: RenderStyleId;
  readonly labelKey: string;
}

/** One option per registered style, in cycle order. */
export function buildGraphicsStyleOptions(
  styles: readonly RenderStyleDescriptor[] = RENDER_STYLES
): GraphicsStyleOption[] {
  return styles.map((style) => ({ value: style.id, labelKey: style.labelKey }));
}

/** Saved style first, then the configured default; unknown values fall through to the built-in default. */
export function resolveInitialGraphicsStyle(saved: unknown, configDefault: unknown): RenderStyleId {
  return parseRenderStyleId(saved) ?? parseRenderStyleId(configDefault) ?? DEFAULT_RENDER_STYLE_ID;
}

/** Whether the LCD toggle can be used with the style. */
export function isLcdAvailable(style: RenderStyleId): boolean {
  return getRenderStyle(style).lcdAllowed;
}

/** Canvas classes to remove so that only the class of `style` remains. */
export function canvasClassesToRemove(style: RenderStyleId): string[] {
  const keep = getRenderStyle(style).canvasClass;
  const all = RENDER_STYLES.map((s) => s.canvasClass).filter((c): c is string => c !== null);
  return [...new Set(all)].filter((c) => c !== keep);
}
