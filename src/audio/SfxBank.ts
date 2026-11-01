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

import { AudioEffectConfig } from '../core/types';
import { joinUrl } from './FileMusicPlayer';

const MS_PER_SECOND = 1000;

export type FetchLike = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Wraps the callback form of decodeAudioData, the only one old Safari offers. */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const pending = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    // Modern browsers also return a promise; its rejection is already handled through `reject`.
    pending?.catch?.(() => {});
  });
}

/**
 * Decoded sound effect files. Every file of every effect is fetched and decoded
 * once, in the background; an effect plays from its buffers as soon as one is
 * ready and the caller falls back to synthesised notes until then (or for good
 * when a file cannot be loaded). Buffers are played through one-shot source
 * nodes, so effects overlap freely.
 */
export class SfxBank {
  private readonly buffers = new Map<string, Array<AudioBuffer | undefined>>();
  private readonly nextVariant = new Map<string, number>();

  /** @param fetchFn Loads a file; tests pass a fake. */
  constructor(private readonly fetchFn: FetchLike = (url) => globalThis.fetch(url)) {}

  /** Starts decoding every effect file. Never throws: a file that fails is left out. */
  public load(ctx: AudioContext, effects: Record<string, AudioEffectConfig>, baseUrl: string): void {
    if (typeof ctx.decodeAudioData !== 'function') return;
    for (const [id, effect] of Object.entries(effects)) {
      (effect.files ?? []).forEach((file, index) => {
        this.loadFile(ctx, id, index, joinUrl(baseUrl, file)).catch(() => {});
      });
    }
  }

  private async loadFile(ctx: AudioContext, effectId: string, index: number, url: string): Promise<void> {
    try {
      const response = await this.fetchFn(url);
      if (!response.ok) return;
      const buffer = await decode(ctx, await response.arrayBuffer());
      const decoded = this.buffers.get(effectId) ?? [];
      decoded[index] = buffer; // Stored by position so variants follow the order of `files`.
      this.buffers.set(effectId, decoded);
    } catch {
      // The effect keeps its synthesised notes.
    }
  }

  private decodedBuffers(effectId: string): AudioBuffer[] {
    return (this.buffers.get(effectId) ?? []).filter((buffer): buffer is AudioBuffer => buffer !== undefined);
  }

  /** True once at least one file of the effect is decoded. */
  public has(effectId: string): boolean {
    return this.decodedBuffers(effectId).length > 0;
  }

  /**
   * Plays the next decoded variant of an effect.
   * @param volume Master and effects volume already multiplied.
   * @returns False when no buffer is ready, so the caller synthesises instead.
   */
  public play(ctx: AudioContext, effectId: string, effect: AudioEffectConfig, volume: number): boolean {
    const decoded = this.decodedBuffers(effectId);
    if (decoded.length === 0) return false;
    const index = (this.nextVariant.get(effectId) ?? 0) % decoded.length;
    this.nextVariant.set(effectId, index + 1);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const peak = volume * (effect.gain ?? 1);
    const start = ctx.currentTime;
    source.buffer = decoded[index];
    gain.gain.setValueAtTime(peak, start);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(start);

    if (effect.maxDurationMs !== undefined) {
      const end = start + effect.maxDurationMs / MS_PER_SECOND;
      const fadeSec = (effect.fadeOutMs ?? 0) / MS_PER_SECOND;
      if (fadeSec > 0) {
        gain.gain.setValueAtTime(peak, end - fadeSec);
        gain.gain.linearRampToValueAtTime(0, end);
      }
      source.stop(end);
    }
    return true;
  }
}
