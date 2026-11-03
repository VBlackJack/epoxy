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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel } from '../core/types';
import { renderLevelThumbnail, ThumbnailBuffer, thumbnailDisplaySize, thumbnailSize } from './levelThumbnail';

/**
 * Canvas side of the level thumbnails: the elements, a cache of the pixel
 * buffers and the lazy drawing. The pixels come from the pure module; this one
 * only owns the DOM. Thumbnails are decorative (aria-hidden): rows keep their text.
 */

const THUMBNAIL_CLASS = 'packs-thumb';

/** Buffers already computed, by level object: a redraw of an unchanged level costs one putImageData. */
const bufferCache = new WeakMap<CompiledLevel, ThumbnailBuffer>();

function currentPalette(): Readonly<Record<string, string>> {
  // The registry holds no game config until the configs are loaded.
  return (ConfigRegistry.getGame() as { palette?: Record<string, string> } | undefined)?.palette ?? {};
}

function bufferOf(level: CompiledLevel): ThumbnailBuffer {
  let buffer = bufferCache.get(level);
  if (!buffer) {
    buffer = renderLevelThumbnail(level, currentPalette());
    bufferCache.set(level, buffer);
  }
  return buffer;
}

/** Paints the level on the canvas with a single putImageData; does nothing where canvas is unavailable. */
function draw(canvas: HTMLCanvasElement, level: CompiledLevel): void {
  if (typeof ImageData === 'undefined') return;
  const buffer = bufferOf(level);
  if (buffer.width === 0 || buffer.height === 0) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.putImageData(new ImageData(buffer.data, buffer.width, buffer.height), 0, 0);
}

/** An empty canvas sized for the level and fitted to `box` CSS pixels; a batch draws it later. */
function createCanvas(level: CompiledLevel, box: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = thumbnailSize(level);
  canvas.className = THUMBNAIL_CLASS;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = size.width;
  canvas.height = size.height;
  const shown = thumbnailDisplaySize(size.width, size.height, box);
  canvas.style.width = `${shown.width}px`;
  canvas.style.height = `${shown.height}px`;
  return canvas;
}

/**
 * The thumbnails of one redraw of a list. Each is drawn when it first scrolls
 * into view, or at once where IntersectionObserver is missing. `dispose`
 * before the list is rebuilt, so the observer never holds removed canvases.
 */
export class ThumbnailBatch {
  private readonly observer: IntersectionObserver | null;
  private readonly pending = new Map<Element, () => void>();

  public constructor() {
    this.observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const paint = this.pending.get(entry.target);
              this.pending.delete(entry.target);
              this.observer?.unobserve(entry.target);
              paint?.();
            }
          });
  }

  /** A canvas for the level, in a box of `box` CSS pixels, to be placed in the list. */
  public add(level: CompiledLevel, box: number): HTMLCanvasElement {
    const canvas = createCanvas(level, box);
    const paint = (): void => draw(canvas, level);
    if (this.observer) {
      this.pending.set(canvas, paint);
      this.observer.observe(canvas);
    } else {
      paint();
    }
    return canvas;
  }

  public dispose(): void {
    this.observer?.disconnect();
    this.pending.clear();
  }
}
