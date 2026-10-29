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

/** A light in canvas pixels: where it is, how far it reaches and its tint. */
export interface Light {
  x: number;
  y: number;
  radius: number;
  color: string;
}

/** Colours the layer needs, read from the palette by the renderer. */
export interface LightingColors {
  ambient: string;
  mask: string;
  vignette: string;
}

export interface LightingParams {
  ambientAlpha: number;
  tintAlpha: number;
  resolutionDivisor: number;
  vignetteAlpha: number;
  vignetteInnerRatio: number;
}

/** Light sprites are drawn once at this size and scaled to each light's radius. */
const LIGHT_SPRITE_PX = 64;
/** Fraction of a light's radius that stays fully lit before the falloff starts. */
const LIGHT_CORE_RATIO = 0.25;
/** Translucent discs stacked to build a light's falloff, and shells to build the vignette. */
const LIGHT_FALLOFF_RINGS = 12;
const VIGNETTE_SHELLS = 24;

/**
 * Darkness with holes around lights, a coloured glow added over each light and a
 * vignette. Everything heavy (gradients) is pre-rendered once; a frame costs one
 * small fill, one drawImage per light on the reduced darkness canvas and per tint,
 * and two full-size drawImage calls.
 */
export class LightingLayer {
  private darkness: HTMLCanvasElement | null = null;
  private darknessCtx: CanvasRenderingContext2D | null = null;
  private holeSprite: HTMLCanvasElement | null = null;
  private holeColor = '';
  private readonly tintSprites: Map<string, HTMLCanvasElement> = new Map();
  private vignette: HTMLCanvasElement | null = null;
  private vignetteKey = '';

  public render(
    ctx: CanvasRenderingContext2D,
    lights: readonly Light[],
    colors: LightingColors,
    params: LightingParams
  ): void {
    if (typeof document === 'undefined') return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    if (params.ambientAlpha > 0) {
      const dark = this.prepareDarkness(width, height, params.resolutionDivisor);
      const hole = this.getHoleSprite(colors.mask);
      if (dark && this.darknessCtx && hole) {
        const dctx = this.darknessCtx;
        const scale = dark.width / width;
        dctx.globalCompositeOperation = 'source-over';
        dctx.clearRect(0, 0, dark.width, dark.height);
        dctx.globalAlpha = params.ambientAlpha;
        dctx.fillStyle = colors.ambient;
        dctx.fillRect(0, 0, dark.width, dark.height);
        dctx.globalAlpha = 1;
        dctx.globalCompositeOperation = 'destination-out';
        for (const light of lights) {
          const r = light.radius * scale;
          dctx.drawImage(hole, light.x * scale - r, light.y * scale - r, r * 2, r * 2);
        }
        dctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(dark, 0, 0, width, height);
        ctx.restore();
      }
    }

    if (params.tintAlpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = params.tintAlpha;
      for (const light of lights) {
        const tint = this.getTintSprite(light.color);
        if (tint) ctx.drawImage(tint, light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
      }
      ctx.restore();
    }

    if (params.vignetteAlpha > 0) {
      const vignette = this.getVignette(width, height, colors.vignette, params);
      if (vignette) ctx.drawImage(vignette, 0, 0);
    }
  }

  private prepareDarkness(width: number, height: number, divisor: number): HTMLCanvasElement | null {
    const w = Math.max(1, Math.ceil(width / Math.max(1, divisor)));
    const h = Math.max(1, Math.ceil(height / Math.max(1, divisor)));
    if (!this.darkness) {
      this.darkness = document.createElement('canvas');
      this.darknessCtx = this.darkness.getContext('2d');
    }
    if (this.darkness.width !== w || this.darkness.height !== h) {
      this.darkness.width = w;
      this.darkness.height = h;
    }
    return this.darkness;
  }

  /** Opaque centre fading to transparent: erases darkness where it is drawn. */
  private getHoleSprite(color: string): HTMLCanvasElement | null {
    if (this.holeSprite && this.holeColor === color) return this.holeSprite;
    this.holeSprite = this.paintRadial(color);
    this.holeColor = color;
    return this.holeSprite;
  }

  private getTintSprite(color: string): HTMLCanvasElement | null {
    const cached = this.tintSprites.get(color);
    if (cached) return cached;
    const sprite = this.paintRadial(color);
    if (sprite) this.tintSprites.set(color, sprite);
    return sprite;
  }

  private paintRadial(color: string): HTMLCanvasElement | null {
    const canvas = document.createElement('canvas');
    canvas.width = LIGHT_SPRITE_PX;
    canvas.height = LIGHT_SPRITE_PX;
    const sctx = canvas.getContext('2d');
    if (!sctx) return null;
    const r = LIGHT_SPRITE_PX / 2;
    // Opacity falls off by stacking translucent discs of the light's own colour, so the
    // edge fades without a grey fringe and no transparent colour literal is needed.
    sctx.fillStyle = color;
    const rings = LIGHT_FALLOFF_RINGS;
    for (let i = rings; i >= 1; i--) {
      const ringR = r * (LIGHT_CORE_RATIO + ((1 - LIGHT_CORE_RATIO) * i) / rings);
      sctx.globalAlpha = 1 / rings;
      sctx.beginPath();
      sctx.arc(r, r, ringR, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;
    sctx.beginPath();
    sctx.arc(r, r, r * LIGHT_CORE_RATIO, 0, Math.PI * 2);
    sctx.fill();
    return canvas;
  }

  private getVignette(
    width: number,
    height: number,
    color: string,
    params: LightingParams
  ): HTMLCanvasElement | null {
    const key = `${width}|${height}|${color}|${params.vignetteAlpha}|${params.vignetteInnerRatio}`;
    if (this.vignette && this.vignetteKey === key) return this.vignette;
    const canvas = this.vignette ?? document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const vctx = canvas.getContext('2d');
    if (!vctx) return null;
    const cx = width / 2;
    const cy = height / 2;
    const outer = Math.hypot(cx, cy);
    const inner = outer * params.vignetteInnerRatio;
    vctx.clearRect(0, 0, width, height);
    vctx.fillStyle = color;
    // Concentric shells, each a little more opaque, from the clear centre to the corners.
    for (let i = 1; i <= VIGNETTE_SHELLS; i++) {
      const r = inner + ((outer - inner) * (i - 1)) / VIGNETTE_SHELLS;
      vctx.globalAlpha = params.vignetteAlpha / VIGNETTE_SHELLS;
      vctx.beginPath();
      vctx.rect(0, 0, width, height);
      vctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      vctx.fill('evenodd');
    }
    vctx.globalAlpha = 1;
    this.vignette = canvas;
    this.vignetteKey = key;
    return canvas;
  }
}
