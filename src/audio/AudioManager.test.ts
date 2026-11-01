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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = () => void;

/** Stands in for window and AudioContext: records listeners and lets a test pick the resume outcome. */
class FakeEnvironment {
  public readonly listeners = new Map<string, Set<Handler>>();
  public contexts: FakeAudioContext[] = [];
  /** State the next resume() call settles into. */
  public stateAfterResume = 'running';
  public readonly window = {
    addEventListener: (type: string, handler: Handler): void => {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)?.add(handler);
    },
    removeEventListener: (type: string, handler: Handler): void => {
      this.listeners.get(type)?.delete(handler);
    },
    AudioContext: class {} as unknown,
    /** Records scheduler timers so a test can tell whether the synth loop runs. */
    setInterval: (): number => {
      this.intervalsStarted++;
      return this.intervalsStarted;
    }
  };
  public intervalsStarted = 0;
  public readonly documentListeners = new Map<string, Set<Handler>>();
  public readonly document = {
    hidden: false,
    addEventListener: (type: string, handler: Handler): void => {
      if (!this.documentListeners.has(type)) this.documentListeners.set(type, new Set());
      this.documentListeners.get(type)?.add(handler);
    }
  };

  constructor() {
    const env = this;
    this.window.AudioContext = class extends FakeAudioContext {
      constructor() {
        super(env);
        env.contexts.push(this);
      }
    };
  }

  public listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  public fire(type: string): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler();
  }
}

class FakeAudioNode {
  public disconnectCalls = 0;
  public readonly gain = {
    setValueAtTime: (): void => {},
    linearRampToValueAtTime: (): void => {},
    exponentialRampToValueAtTime: (): void => {}
  };
  public readonly frequency = { setValueAtTime: (): void => {} };
  public type = '';
  public onended: (() => void) | null = null;
  public start(): void {}
  public stop(): void {}
  public connect(): void {}
  public disconnect(): void {
    this.disconnectCalls++;
  }
}

class FakeAudioContext {
  public state = 'suspended';
  public resumeCalls = 0;
  public currentTime = 0;
  public readonly destination = {};
  public readonly nodes: FakeAudioNode[] = [];
  public createMediaElementSource(): FakeAudioNode {
    const node = new FakeAudioNode();
    this.nodes.push(node);
    return node;
  }
  public oscillatorsCreated = 0;
  public createOscillator(): FakeAudioNode {
    this.oscillatorsCreated++;
    return new FakeAudioNode();
  }
  public createGain(): FakeAudioNode {
    const node = new FakeAudioNode();
    this.nodes.push(node);
    return node;
  }
  constructor(private readonly env: FakeEnvironment) {}
  public resume(): Promise<void> {
    this.resumeCalls++;
    this.state = this.env.stateAfterResume;
    return Promise.resolve();
  }
}

async function loadManager(env: FakeEnvironment): Promise<void> {
  vi.resetModules();
  vi.stubGlobal('window', env.window);
  await import('./AudioManager');
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AudioManager gesture unlock', () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listens to touchend and click as well as the original gestures', async () => {
    await loadManager(env);
    expect([...env.listeners.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'touchend', 'touchstart']);
  });

  it('creates and resumes the context on the first gesture, then releases the listeners', async () => {
    await loadManager(env);
    env.fire('pointerdown');
    await flushPromises();
    expect(env.contexts).toHaveLength(1);
    expect(env.contexts[0].resumeCalls).toBe(1);
    expect(env.listenerCount()).toBe(0);
  });

  it('keeps listening while the context stays interrupted, and resumes on the next gesture', async () => {
    env.stateAfterResume = 'interrupted';
    await loadManager(env);
    env.fire('touchstart');
    await flushPromises();
    expect(env.contexts[0].state).toBe('interrupted');
    expect(env.listenerCount()).toBeGreaterThan(0);

    env.stateAfterResume = 'running';
    env.fire('touchend');
    await flushPromises();
    expect(env.contexts[0].resumeCalls).toBe(2);
    expect(env.contexts[0].state).toBe('running');
    expect(env.listenerCount()).toBe(0);
  });

  it('never resumes a closed context', async () => {
    env.stateAfterResume = 'closed';
    await loadManager(env);
    env.fire('click');
    await flushPromises();
    env.fire('click');
    await flushPromises();
    expect(env.contexts[0].state).toBe('closed');
    expect(env.contexts[0].resumeCalls).toBe(1);
  });
});

/** Stands in for an HTMLAudioElement; play() outcomes are scripted by the test. */
class FakeMusicElement {
  public crossOrigin: string | null = null;
  public loop = false;
  public preload = '';
  public src = '';
  public playCalls = 0;
  public pauseCalls = 0;
  public playOutcome: string | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();

  public canPlayType(): string {
    return 'maybe';
  }
  public play(): Promise<void> {
    this.playCalls++;
    if (this.playOutcome === null) return Promise.resolve();
    const error = new Error('play failed');
    error.name = this.playOutcome;
    return Promise.reject(error);
  }
  public pause(): void {
    this.pauseCalls++;
  }
  public loadCalls = 0;
  public removedAttributes: string[] = [];
  public load(): void {
    this.loadCalls++;
  }
  public removeAttribute(name: string): void {
    this.removedAttributes.push(name);
  }
  public addEventListener(type: string, handler: Handler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)?.add(handler);
  }
  public removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }
  public emit(type: string): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler();
  }
}

/** A synth track that schedules no tone, so the scheduler runs without oscillator fakes. */
const SILENT_SYNTH = {
  stepDurationMs: 100,
  leadWaveform: 'square',
  bassWaveform: 'triangle',
  leadNotes: [0],
  bassNotes: [0]
};

interface MusicFixture {
  manager: import('./AudioManager').AudioService;
  elements: FakeMusicElement[];
  /** Outcome every element created from now on gets for its play() calls. */
  script: { playOutcome: string | null };
}

/**
 * Builds a manager over three tracks: two silent synth tracks and one file
 * track. Modules load before the window is stubbed so that only this manager
 * listens to the fake gestures.
 */
async function createMusicFixture(env: FakeEnvironment): Promise<MusicFixture> {
  vi.resetModules();
  const { ConfigRegistry } = await import('../config/ConfigRegistry');
  const { createTestBundle } = await import('../test/loadTestConfigs');
  const { AudioService } = await import('./AudioManager');
  const bundle = createTestBundle();
  bundle.audio.defaultTrackId = 'synth_a';
  bundle.audio.tracks = [
    { id: 'synth_a', i18nKey: 'app.music.cyber_pulse.label', ...SILENT_SYNTH },
    { id: 'synth_b', i18nKey: 'app.music.arctic_synth.label', ...SILENT_SYNTH },
    { id: 'file_c', i18nKey: 'app.music.magma_drive.label', source: 'file', files: ['c.ogg'] }
  ] as unknown as typeof bundle.audio.tracks;
  bundle.game.themes!.cyber_neon.musicTrackId = 'file_c';
  bundle.game.themes!.arctic_lab.musicTrackId = 'synth_b';
  bundle.game.themes!.magma_core.musicTrackId = 'synth_a';
  bundle.game.themes!.lynx_lcd.musicTrackId = 'synth_a';
  bundle.game.endlessUi.musicTrackIds = ['synth_a', 'synth_b'];
  ConfigRegistry.applyConfigs(bundle);
  vi.stubGlobal('window', env.window);
  vi.stubGlobal('document', env.document);
  const elements: FakeMusicElement[] = [];
  const script: { playOutcome: string | null } = { playOutcome: null };
  const manager = new AudioService(() => {
    const element = new FakeMusicElement();
    element.playOutcome = script.playOutcome;
    elements.push(element);
    return element as unknown as HTMLAudioElement;
  });
  return { manager, elements, script };
}

function fireVisibilityChange(env: FakeEnvironment): void {
  for (const handler of env.documentListeners.get('visibilitychange') ?? []) handler();
}

describe('AudioManager file tracks', () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function playingFileTrack(playOutcome: string | null = null): Promise<MusicFixture> {
    const fixture = await createMusicFixture(env);
    fixture.script.playOutcome = playOutcome;
    fixture.manager.configureMusic('default', undefined);
    fixture.manager.setThemeTrack('file_c');
    fixture.manager.setMusicEnabled(true);
    return fixture;
  }

  it('creates no element before the gesture, then one looping element under the base url', async () => {
    const { elements } = await playingFileTrack();
    expect(elements).toHaveLength(0);

    env.fire('pointerdown');
    await flushPromises();
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);
    expect(elements[0].loop).toBe(true);
    expect(elements[0].src).toBe('./audio/music/c.ogg');
    expect(env.intervalsStarted).toBe(0);
  });

  it('keeps a track the browser refused and retries on the next gesture only', async () => {
    const { elements, script } = await playingFileTrack('NotAllowedError');
    env.fire('pointerdown');
    await flushPromises();
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);
    // The context runs, so the unlock listeners are gone; the retry listeners replace them.
    expect(env.listenerCount()).toBeGreaterThan(0);

    script.playOutcome = null;
    elements[0].playOutcome = null;
    env.fire('click');
    await flushPromises();
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(2);
    expect(env.listenerCount()).toBe(0);
  });

  it('skips a failing file track for the session and falls back to the default synth track', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, elements } = await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    expect(env.intervalsStarted).toBe(0);

    elements[0].emit('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(manager.getActiveTrackId()).toBe('synth_a');
    expect(env.intervalsStarted).toBe(1);

    // The failed track is not retried when its biome shows again.
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe('synth_a');
    expect(elements).toHaveLength(1);
  });

  it('pauses the playing element while the page is hidden and resumes it when shown', async () => {
    const { elements } = await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    const resumesBefore = env.contexts[0].resumeCalls;

    env.document.hidden = true;
    fireVisibilityChange(env);
    expect(elements[0].pauseCalls).toBe(1);

    env.document.hidden = false;
    env.contexts[0].state = 'interrupted';
    fireVisibilityChange(env);
    expect(elements[0].playCalls).toBe(2);
    expect(env.contexts[0].resumeCalls).toBe(resumesBefore + 1);
    expect(elements).toHaveLength(1);
  });

  it('stops and discards the element when music is turned off', async () => {
    const { manager, elements } = await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    manager.setMusicEnabled(false);
    expect(elements[0].pauseCalls).toBe(1);
    expect(elements[0].removedAttributes).toEqual(['src']);
    expect(elements[0].loadCalls).toBe(1);
    expect(env.contexts[0].nodes).toHaveLength(2);
    expect(env.contexts[0].nodes.map((node) => node.disconnectCalls)).toEqual([1, 1]);
  });

  it('plays the element inside the gesture even while the context is still suspended', async () => {
    env.stateAfterResume = 'suspended';
    const { elements } = await playingFileTrack();
    env.fire('pointerdown');
    // No await: play() has to run synchronously in the gesture handler.
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);
    await flushPromises();
    // The resume handler does not start a second element.
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);
  });
});

describe('AudioManager music modes', () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('follows the biome in default mode', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('default', undefined);
    manager.setThemeTrack('synth_b');
    expect(manager.getActiveTrackId()).toBe('synth_b');
    manager.setThemeTrack('synth_a');
    expect(manager.getActiveTrackId()).toBe('synth_a');
  });

  it('replaces invalid stored settings in memory only', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('bogus', ['zzz', 7]);
    expect(manager.getMusicMode()).toBe('default');
    expect(manager.getCustomTrackIds()).toEqual(['synth_a', 'synth_b', 'file_c']);
  });

  it('picks a new track only when a level with another id loads, and ignores biome changes', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['synth_a', 'synth_b']);
    manager.onLevelLoaded('level_1');
    const first = manager.getActiveTrackId();
    expect(['synth_a', 'synth_b']).toContain(first);

    manager.onLevelLoaded('level_1');
    expect(manager.getActiveTrackId()).toBe(first);
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe(first);

    manager.onLevelLoaded('level_2');
    expect(manager.getActiveTrackId()).not.toBe(first);
  });

  it('plays the endless tracks in default mode, one per level, and goes back to the biome when the run ends', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('default', undefined);
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe('file_c');

    manager.setEndlessTracks(['synth_a', 'synth_b']);
    manager.onLevelLoaded('endless_1');
    const first = manager.getActiveTrackId();
    expect(['synth_a', 'synth_b']).toContain(first);

    manager.onLevelLoaded('endless_1');
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe(first);

    manager.onLevelLoaded('endless_2');
    const second = manager.getActiveTrackId();
    expect(['synth_a', 'synth_b']).toContain(second);
    expect(second).not.toBe(first);

    manager.setEndlessTracks(null);
    expect(manager.getActiveTrackId()).toBe('file_c');
  });

  it('leaves the random and custom modes alone during an endless run', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['file_c']);
    manager.setEndlessTracks(['synth_a', 'synth_b']);
    manager.onLevelLoaded('endless_1');
    expect(manager.getActiveTrackId()).toBe('file_c');
  });

  it('applies a mode switch at once', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('random', undefined);
    manager.setThemeTrack('synth_b');
    manager.onLevelLoaded('level_1');
    manager.setMusicMode('default');
    expect(manager.getActiveTrackId()).toBe('synth_b');
    manager.setMusicMode('custom');
    expect(manager.getActiveTrackId()).not.toBe('synth_b');
  });

  it('picks another track at once when the playing one is unticked in custom mode', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['synth_a', 'synth_b']);
    manager.onLevelLoaded('level_1');
    const playing = manager.getActiveTrackId() as string;
    const other = playing === 'synth_a' ? 'synth_b' : 'synth_a';
    manager.setCustomTracks([other]);
    expect(manager.getActiveTrackId()).toBe(other);
    expect(manager.getCustomTrackIds()).toEqual([other]);
  });
});

describe('AudioManager effect throttling', () => {
  let env: FakeEnvironment;
  const NOTE_COUNT = 2;
  const THROTTLE_MS = 250;
  const MS_PER_SECOND = 1000;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A manager over two synthesized effects; `limited` carries the interval, `free` has none. */
  async function createSfxFixture(minIntervalMs: number | undefined): Promise<{
    manager: import('./AudioManager').AudioService;
    ctx: FakeAudioContext;
  }> {
    vi.resetModules();
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    const { createTestBundle } = await import('../test/loadTestConfigs');
    const { AudioService } = await import('./AudioManager');
    const bundle = createTestBundle();
    const notes = Array.from({ length: NOTE_COUNT }, () => ({ freq: 110, durationMs: 50, gain: 0.3 }));
    bundle.audio.effects = {
      limited: { waveform: 'square', notes, ...(minIntervalMs === undefined ? {} : { minIntervalMs }) },
      free: { waveform: 'square', notes, ...(minIntervalMs === undefined ? {} : { minIntervalMs }) }
    } as unknown as typeof bundle.audio.effects;
    if (minIntervalMs !== undefined) delete (bundle.audio.effects.free as { minIntervalMs?: number }).minIntervalMs;
    ConfigRegistry.applyConfigs(bundle);
    vi.stubGlobal('window', env.window);
    vi.stubGlobal('document', env.document);
    const manager = new AudioService();
    env.fire('pointerdown');
    await flushPromises();
    return { manager, ctx: env.contexts[0] };
  }

  it('plays a throttled effect once for rapid repeats inside the interval', async () => {
    const { manager, ctx } = await createSfxFixture(THROTTLE_MS);
    manager.playSfx('limited');
    ctx.currentTime += (THROTTLE_MS - 1) / MS_PER_SECOND;
    manager.playSfx('limited');
    manager.playSfx('limited');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT);
  });

  it('plays again once the interval has passed, counted from the last start', async () => {
    const { manager, ctx } = await createSfxFixture(THROTTLE_MS);
    manager.playSfx('limited');
    ctx.currentTime += THROTTLE_MS / MS_PER_SECOND;
    manager.playSfx('limited');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT * 2);
    ctx.currentTime += (THROTTLE_MS - 1) / MS_PER_SECOND;
    manager.playSfx('limited');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT * 2);
  });

  it('does not throttle another effect id', async () => {
    const { manager, ctx } = await createSfxFixture(THROTTLE_MS);
    manager.playSfx('limited');
    manager.playSfx('free');
    manager.playSfx('free');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT * 3);
  });

  it('does not throttle an effect without minIntervalMs', async () => {
    const { manager, ctx } = await createSfxFixture(undefined);
    manager.playSfx('limited');
    manager.playSfx('limited');
    manager.playSfx('limited');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT * 3);
  });

  it('does not record a start for a call made inside runSilently', async () => {
    const { manager, ctx } = await createSfxFixture(THROTTLE_MS);
    manager.runSilently(() => manager.playSfx('limited'));
    manager.playSfx('limited');
    expect(ctx.oscillatorsCreated).toBe(NOTE_COUNT);
  });
});
