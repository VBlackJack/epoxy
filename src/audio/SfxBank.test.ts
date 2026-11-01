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
import { AudioEffectConfig } from '../core/types';
import { FetchLike, SfxBank } from './SfxBank';

const SAMPLE_VOLUME = 0.2;
const EFFECT_GAIN = 0.5;
const CAP_MS = 400;
const FADE_MS = 150;
const MS_PER_SECOND = 1000;
const CONTEXT_START_SEC = 1;
const BASE_URL = 'x';

interface GainCall {
  kind: 'set' | 'ramp';
  value: number;
  time: number;
}

class FakeSource {
  public buffer: unknown = null;
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;
  public onended: (() => void) | null = null;
  public connect(): void {}
  public disconnect(): void {}
  public start(time: number): void {
    this.startedAt = time;
  }
  public stop(time: number): void {
    this.stoppedAt = time;
  }
}

class FakeGain {
  public readonly calls: GainCall[] = [];
  public readonly gain = {
    setValueAtTime: (value: number, time: number): void => {
      this.calls.push({ kind: 'set', value, time });
    },
    linearRampToValueAtTime: (value: number, time: number): void => {
      this.calls.push({ kind: 'ramp', value, time });
    }
  };
  public connect(): void {}
  public disconnect(): void {}
}

class FakeContext {
  public currentTime = CONTEXT_START_SEC;
  public readonly destination = {};
  public readonly sources: FakeSource[] = [];
  public readonly gains: FakeGain[] = [];
  public decodeCalls = 0;
  /** Byte lengths that make decodeAudioData reject. */
  public failingLengths = new Set<number>();
  /** Lengths whose decode completes only when released, to test out-of-order completion. */
  public deferredLengths = new Set<number>();
  private readonly deferred: Array<() => void> = [];
  public releaseDeferred(): void {
    this.deferred.splice(0).forEach((release) => release());
  }
  public decodeAudioData(
    data: ArrayBuffer,
    ok: (buffer: unknown) => void,
    ko: (error: unknown) => void
  ): Promise<unknown> {
    this.decodeCalls++;
    const settle = (): Promise<unknown> => {
      if (this.failingLengths.has(data.byteLength)) {
        const error = new Error('bad data');
        ko(error);
        return Promise.reject(error);
      }
      const buf = { id: data.byteLength };
      ok(buf);
      return Promise.resolve(buf);
    };
    if (!this.deferredLengths.has(data.byteLength)) return settle();
    return new Promise((resolve) => {
      this.deferred.push(() => resolve(settle()));
    });
  }
  public createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  public createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

/** Serves files whose byte length is the length of the URL, so a test can tell them apart. */
function fakeFetch(missing: readonly string[] = []): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    if (missing.some((name) => url.endsWith(name))) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(url.length) };
  };
  return { fetch, urls };
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const asContext = (ctx: FakeContext): AudioContext => ctx as unknown as AudioContext;

const urlLength = (file: string): number => `${BASE_URL}/${file}`.length;

function effect(overrides: Partial<AudioEffectConfig> = {}): AudioEffectConfig {
  return { waveform: 'square', notes: [], files: ['a.wav'], ...overrides };
}

/** Loads one effect into a fresh bank and waits for the decoding to settle. */
async function loadedBank(
  id: string,
  config: AudioEffectConfig,
  ctx: FakeContext,
  fetch: FetchLike = fakeFetch().fetch
): Promise<SfxBank> {
  const bank = new SfxBank(fetch);
  bank.load(asContext(ctx), { [id]: config }, BASE_URL);
  await flushPromises();
  return bank;
}

describe('SfxBank', () => {
  it('fetches and decodes every file once, under the base URL', async () => {
    const { fetch, urls } = fakeFetch();
    const ctx = new FakeContext();
    const bank = new SfxBank(fetch);
    bank.load(asContext(ctx), { step: effect({ files: ['a.wav', 'b.wav'] }), chip: effect({ files: ['c.wav'] }) }, './audio/sfx/');
    await flushPromises();
    expect([...urls].sort()).toEqual(['./audio/sfx/a.wav', './audio/sfx/b.wav', './audio/sfx/c.wav']);
    expect(ctx.decodeCalls).toBe(3);
    expect(bank.has('step')).toBe(true);
  });

  it('plays nothing for an effect without a decoded buffer', () => {
    const ctx = new FakeContext();
    const bank = new SfxBank(fakeFetch().fetch);
    expect(bank.play(asContext(ctx), 'step', effect(), SAMPLE_VOLUME)).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it('alternates the variants round-robin', async () => {
    const ctx = new FakeContext();
    const step = effect({ files: ['a.wav', 'bb.wav'] });
    const bank = await loadedBank('step', step, ctx);
    for (let i = 0; i < 3; i++) expect(bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME)).toBe(true);
    const ids = ctx.sources.map((source) => (source.buffer as { id: number }).id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe(ids[0]);
  });

  it('applies the effect gain to the volume and plays the whole buffer without a cap', async () => {
    const ctx = new FakeContext();
    const chip = effect({ gain: EFFECT_GAIN });
    const bank = await loadedBank('chip', chip, ctx);
    bank.play(asContext(ctx), 'chip', chip, SAMPLE_VOLUME);
    expect(ctx.gains[0].calls).toEqual([{ kind: 'set', value: SAMPLE_VOLUME * EFFECT_GAIN, time: CONTEXT_START_SEC }]);
    expect(ctx.sources[0].startedAt).toBe(CONTEXT_START_SEC);
    expect(ctx.sources[0].stoppedAt).toBeNull();
  });

  it('uses a gain of 1 when the effect sets none', async () => {
    const ctx = new FakeContext();
    const chip = effect();
    const bank = await loadedBank('chip', chip, ctx);
    bank.play(asContext(ctx), 'chip', chip, SAMPLE_VOLUME);
    expect(ctx.gains[0].calls[0].value).toBe(SAMPLE_VOLUME);
  });

  it('stops at the cap and fades out linearly so that it ends at the cap', async () => {
    const ctx = new FakeContext();
    const teleport = effect({ maxDurationMs: CAP_MS, fadeOutMs: FADE_MS });
    const bank = await loadedBank('teleport', teleport, ctx);
    bank.play(asContext(ctx), 'teleport', teleport, SAMPLE_VOLUME);
    const end = CONTEXT_START_SEC + CAP_MS / MS_PER_SECOND;
    expect(ctx.sources[0].stoppedAt).toBeCloseTo(end);
    const calls = ctx.gains[0].calls;
    expect(calls[1].kind).toBe('set');
    expect(calls[1].time).toBeCloseTo(end - FADE_MS / MS_PER_SECOND);
    expect(calls[1].value).toBe(SAMPLE_VOLUME);
    expect(calls[2]).toMatchObject({ kind: 'ramp', value: 0 });
    expect(calls[2].time).toBeCloseTo(end);
  });

  it('caps without any fade ramp when fadeOutMs is absent', async () => {
    const ctx = new FakeContext();
    const blocked = effect({ maxDurationMs: CAP_MS });
    const bank = await loadedBank('blocked', blocked, ctx);
    bank.play(asContext(ctx), 'blocked', blocked, SAMPLE_VOLUME);
    expect(ctx.sources[0].stoppedAt).toBeCloseTo(CONTEXT_START_SEC + CAP_MS / MS_PER_SECOND);
    expect(ctx.gains[0].calls.some((call) => call.kind === 'ramp')).toBe(false);
  });

  it('keeps the other variants when one file fails to fetch or decode', async () => {
    const ctx = new FakeContext();
    ctx.failingLengths.add(urlLength('bad.wav'));
    const step = effect({ files: ['gone.wav', 'bad.wav', 'good.wav'] });
    const bank = await loadedBank('step', step, ctx, fakeFetch(['gone.wav']).fetch);
    expect(bank.has('step')).toBe(true);
    bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME);
    bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME);
    const ids = ctx.sources.map((source) => (source.buffer as { id: number }).id);
    expect(ids).toEqual([urlLength('good.wav'), urlLength('good.wav')]);
  });

  it('follows the order of files even when decoding completes out of order', async () => {
    const ctx = new FakeContext();
    ctx.deferredLengths.add(urlLength('first.wav'));
    const step = effect({ files: ['first.wav', 'second.wav'] });
    const bank = await loadedBank('step', step, ctx);
    ctx.releaseDeferred();
    await flushPromises();
    bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME);
    bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME);
    const ids = ctx.sources.map((source) => (source.buffer as { id: number }).id);
    expect(ids).toEqual([urlLength('first.wav'), urlLength('second.wav')]);
  });

  it('leaves no unhandled rejection when a decode fails', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const ctx = new FakeContext();
      ctx.failingLengths.add(urlLength('a.wav'));
      const bank = await loadedBank('step', effect(), ctx);
      await flushPromises();
      expect(bank.has('step')).toBe(false);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('leaves the effect to the synth when fetch throws', async () => {
    const ctx = new FakeContext();
    const step = effect();
    const bank = await loadedBank('step', step, ctx, async () => {
      throw new Error('offline');
    });
    expect(bank.has('step')).toBe(false);
    expect(bank.play(asContext(ctx), 'step', step, SAMPLE_VOLUME)).toBe(false);
  });

  it('does nothing and does not throw when the context cannot decode', () => {
    const { fetch, urls } = fakeFetch();
    const bank = new SfxBank(fetch);
    expect(() => bank.load({} as unknown as AudioContext, { step: effect() }, BASE_URL)).not.toThrow();
    expect(urls).toHaveLength(0);
  });

  it('ignores effects that declare no files', async () => {
    const { fetch, urls } = fakeFetch();
    await loadedBank('splash', effect({ files: undefined }), new FakeContext(), fetch);
    expect(urls).toHaveLength(0);
  });
});
