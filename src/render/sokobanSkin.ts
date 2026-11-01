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

import type { SokobanSkinConfig } from '../core/types';

/** Something the loader can fetch and decode: an HTMLImageElement, or a stand-in in tests. */
export interface SkinImage {
  src: string;
  decode(): Promise<void>;
}

/** Creates an empty image to load; undefined where images do not exist (node). */
export type SkinImageFactory = () => SkinImage | undefined;

/** Draws the layers of a role into one canvas; undefined where no canvas exists. */
export type SkinComposer = (layers: readonly CanvasImageSource[]) => CanvasImageSource | undefined;

const defaultImageFactory: SkinImageFactory = () => (typeof Image === 'undefined' ? undefined : new Image());

/** Stacks layers on a canvas the size of the first one. */
const defaultComposer: SkinComposer = (layers) => {
  if (typeof document === 'undefined') return undefined;
  const first = layers[0] as { width?: number; height?: number } | undefined;
  const canvas = document.createElement('canvas');
  canvas.width = first?.width || 1;
  canvas.height = first?.height || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  for (const layer of layers) ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/**
 * Preloads the images of the Sokoban skin once and answers synchronous lookups. It never throws:
 * when images are unavailable or any file fails to load, `ready` stays false and the renderer
 * keeps the current style.
 */
export class SokobanSkinLoader {
  private readonly terrain = new Map<string, readonly CanvasImageSource[]>();
  private readonly entities = new Map<string, readonly CanvasImageSource[]>();
  private blockOnTargetImages: readonly CanvasImageSource[] | null = null;
  private isReady = false;
  private loadVersion = 0;
  private started = false;

  constructor(
    private readonly config: Readonly<SokobanSkinConfig>,
    private readonly createImage: SkinImageFactory = defaultImageFactory,
    private readonly compose: SkinComposer = defaultComposer
  ) {}

  /** True once every image of the skin has loaded. */
  public get ready(): boolean {
    return this.isReady;
  }

  /** Bumps when loading finishes, so caches drawn without the images can be rebuilt. */
  public get version(): number {
    return this.loadVersion;
  }

  /** Image layers, bottom to top, that draw a tile; null when the skin does not cover it. */
  public getTerrain(tileId: string): readonly CanvasImageSource[] | null {
    return this.isReady ? (this.terrain.get(tileId) ?? null) : null;
  }

  /** Image layers that draw an entity type; null when the skin does not cover it. */
  public getEntity(type: string): readonly CanvasImageSource[] | null {
    return this.isReady ? (this.entities.get(type) ?? null) : null;
  }

  /** Image layers for a block standing on a block target. */
  public getBlockOnTarget(): readonly CanvasImageSource[] | null {
    return this.isReady ? this.blockOnTargetImages : null;
  }

  /** Starts loading once; resolves when done, whether or not it succeeded. */
  public async load(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const files = new Set<string>();
      for (const layers of Object.values(this.config.terrain)) layers.forEach((file) => files.add(file));
      Object.values(this.config.entities).forEach((file) => files.add(file));
      files.add(this.config.blockOnTarget);

      const images = new Map<string, CanvasImageSource>();
      await Promise.all(
        [...files].map(async (file) => {
          const img = this.createImage();
          if (!img) throw new Error('images unavailable');
          img.src = `${this.config.baseUrl}/${file}`;
          await img.decode();
          images.set(file, img as unknown as CanvasImageSource);
        })
      );

      const stack = (layerFiles: readonly string[]): readonly CanvasImageSource[] => {
        const layers = layerFiles.map((file) => images.get(file) as CanvasImageSource);
        const merged = layers.length > 1 ? this.compose(layers) : undefined;
        return merged ? [merged] : layers;
      };
      for (const [tileId, layerFiles] of Object.entries(this.config.terrain)) {
        this.terrain.set(tileId, stack(layerFiles));
      }
      for (const [type, file] of Object.entries(this.config.entities)) {
        this.entities.set(type, stack([file]));
      }
      this.blockOnTargetImages = stack([this.config.blockOnTarget]);
      this.isReady = true;
      this.loadVersion += 1;
    } catch {
      // A missing or undecodable file leaves the skin off; the current style keeps drawing.
      this.isReady = false;
    }
  }
}
