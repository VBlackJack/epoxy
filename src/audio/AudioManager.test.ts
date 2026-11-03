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
    AudioContext: class {} as unknown
  };
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
  /** Every automation call on the gain, in order, as [method, ...arguments]. */
  public readonly gainCalls: Array<[string, ...number[]]> = [];
  public readonly gain = {
    value: 0,
    setValueAtTime: (...args: number[]): void => {
      this.gainCalls.push(['setValueAtTime', ...args]);
    },
    linearRampToValueAtTime: (...args: number[]): void => {
      this.gainCalls.push(['linearRampToValueAtTime', ...args]);
    },
    exponentialRampToValueAtTime: (...args: number[]): void => {
      this.gainCalls.push(['exponentialRampToValueAtTime', ...args]);
    },
    cancelScheduledValues: (...args: number[]): void => {
      this.gainCalls.push(['cancelScheduledValues', ...args]);
    },
    setTargetAtTime: (...args: number[]): void => {
      this.gainCalls.push(['setTargetAtTime', ...args]);
    }
  };
  /** Every automation call on the frequency, in order, as [method, ...arguments]. */
  public readonly frequencyCalls: Array<[string, ...number[]]> = [];
  public readonly frequency = {
    setValueAtTime: (...args: number[]): void => {
      this.frequencyCalls.push(['setValueAtTime', ...args]);
    },
    exponentialRampToValueAtTime: (...args: number[]): void => {
      this.frequencyCalls.push(['exponentialRampToValueAtTime', ...args]);
    }
  };
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
  public readonly oscillators: FakeAudioNode[] = [];
  public createOscillator(): FakeAudioNode {
    this.oscillatorsCreated++;
    const node = new FakeAudioNode();
    this.oscillators.push(node);
    return node;
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
  /** False makes canPlayType refuse every type, so the track has no playable source. */
  public canPlay = true;
  private readonly handlers = new Map<string, Set<Handler>>();

  public canPlayType(): string {
    return this.canPlay ? 'maybe' : '';
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

interface MusicFixture {
  manager: import('./AudioManager').AudioService;
  elements: FakeMusicElement[];
  /** Outcome every element created from now on gets for its play() calls, and whether it can play any file. */
  script: { playOutcome: string | null; canPlay: boolean };
}

/**
 * Builds a manager over three file tracks. Modules load before the window is stubbed so that only this manager
 * listens to the fake gestures.
 */
async function createMusicFixture(env: FakeEnvironment): Promise<MusicFixture> {
  vi.resetModules();
  const { ConfigRegistry } = await import('../config/ConfigRegistry');
  const { createTestBundle } = await import('../test/loadTestConfigs');
  const { AudioService } = await import('./AudioManager');
  const bundle = createTestBundle();
  bundle.audio.tracks = [
    { id: 'file_a', i18nKey: 'app.music.odyssey_8bit.label', source: 'file', files: ['a.ogg'] },
    { id: 'file_b', i18nKey: 'app.music.subterranean_pulse_1.label', source: 'file', files: ['b.ogg'] },
    { id: 'file_c', i18nKey: 'app.music.subterranean_pulse_2.label', source: 'file', files: ['c.ogg'] }
  ];
  bundle.game.themes!.cyber_neon.musicTrackId = 'file_c';
  bundle.game.themes!.arctic_lab.musicTrackId = 'file_b';
  bundle.game.themes!.magma_core.musicTrackId = 'file_a';
  bundle.game.themes!.lynx_lcd.musicTrackId = 'file_a';
  bundle.game.endlessUi.musicTrackIds = ['file_a', 'file_b'];
  ConfigRegistry.applyConfigs(bundle);
  vi.stubGlobal('window', env.window);
  vi.stubGlobal('document', env.document);
  const elements: FakeMusicElement[] = [];
  const script: { playOutcome: string | null; canPlay: boolean } = { playOutcome: null, canPlay: true };
  const manager = new AudioService(() => {
    const element = new FakeMusicElement();
    element.playOutcome = script.playOutcome;
    element.canPlay = script.canPlay;
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
    expect(env.contexts[0].oscillatorsCreated).toBe(0);
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

  it('starts no oscillator when music starts', async () => {
    await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    expect(env.contexts[0].oscillatorsCreated).toBe(0);
  });

  it('switches a failing file track to another eligible file track for the session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, elements } = await createMusicFixture(env);
    manager.configureMusic('random', undefined);
    manager.setMusicEnabled(true);
    env.fire('pointerdown');
    await flushPromises();
    expect(elements).toHaveLength(1);
    const failing = manager.getActiveTrackId() as string;

    elements[0].emit('error');
    expect(warn).toHaveBeenCalledTimes(1);
    const next = manager.getActiveTrackId();
    expect(next).not.toBeNull();
    expect(next).not.toBe(failing);
    expect(elements).toHaveLength(2);

    // The failed track is not picked again by a later level.
    for (let i = 0; i < 20; i++) {
      manager.onLevelLoaded(`later_${i}`);
      expect(manager.getActiveTrackId()).not.toBe(failing);
    }
  });

  it('turns silent when the last eligible file track fails, without creating another element', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, elements } = await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    manager.configureMusic('custom', ['file_c']);
    manager.setCustomTracks(['file_c']);

    elements[elements.length - 1].emit('error');
    expect(manager.getActiveTrackId()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const created = elements.length;

    // Nothing retries: neither a biome change nor a new level creates an element.
    manager.setThemeTrack('file_c');
    manager.onLevelLoaded('level_after_failure');
    expect(elements).toHaveLength(created);
    expect(manager.getActiveTrackId()).toBeNull();
    // The toggle itself is untouched.
    expect(manager.isMusicEnabled()).toBe(true);
  });

  it('does not recurse when a track has no playable source', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fixture = await createMusicFixture(env);
    fixture.script.canPlay = false;
    fixture.manager.configureMusic('random', undefined);
    fixture.manager.setMusicEnabled(true);
    env.fire('pointerdown');
    await flushPromises();
    // Each track is tried once, then music is silent.
    expect(fixture.elements).toHaveLength(3);
    expect(fixture.manager.getActiveTrackId()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);

    const created = fixture.elements.length;
    fixture.manager.onLevelLoaded('another_level');
    expect(fixture.elements).toHaveLength(created);
    expect(fixture.manager.isMusicEnabled()).toBe(true);
  });

  it('gives failed tracks another chance when music is turned back on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, elements } = await playingFileTrack();
    env.fire('pointerdown');
    await flushPromises();
    manager.configureMusic('default', undefined);
    manager.setThemeTrack('file_c');
    elements[elements.length - 1].emit('error');
    expect(manager.getActiveTrackId()).toBeNull();

    manager.setMusicEnabled(false);
    const created = elements.length;
    manager.setMusicEnabled(true);
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe('file_c');
    expect(elements.length).toBe(created + 1);
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
    manager.setThemeTrack('file_b');
    expect(manager.getActiveTrackId()).toBe('file_b');
    manager.setThemeTrack('file_a');
    expect(manager.getActiveTrackId()).toBe('file_a');
  });

  it('replaces invalid stored settings in memory only', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('bogus', ['zzz', 7]);
    expect(manager.getMusicMode()).toBe('default');
    expect(manager.getCustomTrackIds()).toEqual(['file_a', 'file_b', 'file_c']);
  });

  it('picks a new track only when a level with another id loads, and ignores biome changes', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['file_a', 'file_b']);
    manager.onLevelLoaded('level_1');
    const first = manager.getActiveTrackId();
    expect(['file_a', 'file_b']).toContain(first);

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

    manager.setEndlessTracks(['file_a', 'file_b']);
    manager.onLevelLoaded('endless_1');
    const first = manager.getActiveTrackId();
    expect(['file_a', 'file_b']).toContain(first);

    manager.onLevelLoaded('endless_1');
    manager.setThemeTrack('file_c');
    expect(manager.getActiveTrackId()).toBe(first);

    manager.onLevelLoaded('endless_2');
    const second = manager.getActiveTrackId();
    expect(['file_a', 'file_b']).toContain(second);
    expect(second).not.toBe(first);

    manager.setEndlessTracks(null);
    expect(manager.getActiveTrackId()).toBe('file_c');
  });

  it('leaves the random and custom modes alone during an endless run', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['file_c']);
    manager.setEndlessTracks(['file_a', 'file_b']);
    manager.onLevelLoaded('endless_1');
    expect(manager.getActiveTrackId()).toBe('file_c');
  });

  it('applies a mode switch at once', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('random', undefined);
    manager.setThemeTrack('file_b');
    manager.onLevelLoaded('level_1');
    manager.setMusicMode('default');
    expect(manager.getActiveTrackId()).toBe('file_b');
    manager.setMusicMode('custom');
    expect(manager.getActiveTrackId()).not.toBe('file_b');
  });

  it('picks another track at once when the playing one is unticked in custom mode', async () => {
    const { manager } = await createMusicFixture(env);
    manager.configureMusic('custom', ['file_a', 'file_b']);
    manager.onLevelLoaded('level_1');
    const playing = manager.getActiveTrackId() as string;
    const other = playing === 'file_a' ? 'file_b' : 'file_a';
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
    bundle.audio.terrainStepEffects = {};
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

describe('AudioManager terrain steps', () => {
  let env: FakeEnvironment;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A manager over synthesized `step` and `step_ice` effects, with ice mapped and `mud` mapped to a missing effect. */
  async function createStepFixture(): Promise<{ manager: import('./AudioManager').AudioService; ctx: FakeAudioContext }> {
    vi.resetModules();
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    const { createTestBundle } = await import('../test/loadTestConfigs');
    const { AudioService } = await import('./AudioManager');
    const bundle = createTestBundle();
    const single = (freq: number) => ({ waveform: 'square', notes: [{ freq, durationMs: 50, gain: 0.3 }] });
    bundle.audio.effects = { step: single(190), step_ice: single(900) } as unknown as typeof bundle.audio.effects;
    bundle.audio.terrainStepEffects = { ice: 'step_ice' };
    ConfigRegistry.applyConfigs(bundle);
    // The validator refuses a missing effect, so the dangling entry goes in after loading.
    bundle.audio.terrainStepEffects.mud = 'step_mud';
    vi.stubGlobal('window', env.window);
    vi.stubGlobal('document', env.document);
    const manager = new AudioService();
    env.fire('pointerdown');
    await flushPromises();
    return { manager, ctx: env.contexts[0] };
  }

  it('plays the effect mapped to the terrain', async () => {
    const { manager, ctx } = await createStepFixture();
    const spy = vi.spyOn(manager, 'playSfx');
    manager.playStep('ice');
    expect(spy).toHaveBeenCalledWith('step_ice');
    expect(ctx.oscillatorsCreated).toBe(1);
  });

  it('falls back to the plain step for no terrain, an unmapped one or a missing effect', async () => {
    const { manager } = await createStepFixture();
    const spy = vi.spyOn(manager, 'playSfx');
    manager.playStep(null);
    manager.playStep('water');
    manager.playStep('mud');
    expect(spy.mock.calls).toEqual([['step'], ['step'], ['step']]);
  });

  it('falls back to the plain step for a terrain named after an Object.prototype member', async () => {
    const { manager } = await createStepFixture();
    const spy = vi.spyOn(manager, 'playSfx');
    manager.playStep('toString');
    expect(spy.mock.calls).toEqual([['step']]);
  });
});

describe('AudioManager volumes', () => {
  let env: FakeEnvironment;
  const NOTE_GAIN = 0.3;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Gain value the first scheduled effect tone starts at. */
  async function firstToneGain(percent: unknown): Promise<{ gain: number; master: number; sfx: number }> {
    vi.resetModules();
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    const { createTestBundle } = await import('../test/loadTestConfigs');
    const { AudioService } = await import('./AudioManager');
    const bundle = createTestBundle();
    bundle.audio.effects = {
      beep: { waveform: 'square', notes: [{ freq: 110, durationMs: 50, gain: NOTE_GAIN }] }
    } as unknown as typeof bundle.audio.effects;
    bundle.audio.terrainStepEffects = {};
    ConfigRegistry.applyConfigs(bundle);
    vi.stubGlobal('window', env.window);
    vi.stubGlobal('document', env.document);
    const manager = new AudioService();
    if (percent !== undefined) manager.setSfxVolumePercent(percent);
    env.fire('pointerdown');
    await flushPromises();
    manager.playSfx('beep');
    const gainNode = env.contexts[0].nodes.find((node) => node.gainCalls.length > 0);
    return {
      gain: gainNode?.gainCalls[0][1] ?? Number.NaN,
      master: bundle.audio.masterVolume,
      sfx: bundle.audio.sfxVolume
    };
  }

  it('keeps today loudness for effects at 100 percent, which is the default', async () => {
    const { gain, master, sfx } = await firstToneGain(undefined);
    expect(gain).toBeCloseTo(NOTE_GAIN * master * sfx, 10);
  });

  it('scales effects by master volume, effects volume and the percentage', async () => {
    const { gain, master, sfx } = await firstToneGain(40);
    expect(gain).toBeCloseTo(NOTE_GAIN * master * sfx * 0.4, 10);
  });

  it('silences effects at 0 percent without touching the toggle', async () => {
    const { gain } = await firstToneGain(0);
    expect(gain).toBe(0);
  });

  it('replaces an invalid effects volume with the default', async () => {
    const { gain, master, sfx } = await firstToneGain('loud');
    expect(gain).toBeCloseTo(NOTE_GAIN * master * sfx, 10);
  });

  it('sanitizes the volumes it is given', async () => {
    const { manager } = await createMusicFixture(env);
    manager.setMusicVolumePercent(103);
    expect(manager.getMusicVolumePercent()).toBe(100);
    manager.setMusicVolumePercent(-5);
    expect(manager.getMusicVolumePercent()).toBe(0);
    manager.setMusicVolumePercent(37);
    expect(manager.getMusicVolumePercent()).toBe(35);
    manager.setSfxVolumePercent(null);
    expect(manager.getSfxVolumePercent()).toBe(100);
  });

  async function playingMusic(percent?: number): Promise<{ gainNode: FakeAudioNode; master: number; music: number; manager: import('./AudioManager').AudioService }> {
    const { manager } = await createMusicFixture(env);
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    const audio = ConfigRegistry.getAudio();
    manager.configureMusic('default', undefined);
    manager.setThemeTrack('file_c');
    if (percent !== undefined) manager.setMusicVolumePercent(percent);
    manager.setMusicEnabled(true);
    env.fire('pointerdown');
    await flushPromises();
    const gainNode = env.contexts[0].nodes.find((node) => node.gainCalls.length > 0) as FakeAudioNode;
    return { gainNode, master: audio.masterVolume, music: audio.musicVolume, manager };
  }

  it('starts a music track at master volume times music volume times the percentage', async () => {
    const { gainNode, master, music } = await playingMusic(60);
    const ramp = gainNode.gainCalls.find((call) => call[0] === 'linearRampToValueAtTime');
    expect(ramp?.[1]).toBeCloseTo(master * music * 0.6, 10);
  });

  it('applies a music volume change to the playing track, also during the fade-in', async () => {
    const { gainNode, master, music, manager } = await playingMusic();
    // The context clock has not moved: the 400 ms fade-in ramp is still pending.
    manager.setMusicVolumePercent(50);
    const names = gainNode.gainCalls.map((call) => call[0]);
    const cancelIndex = names.lastIndexOf('cancelScheduledValues');
    expect(cancelIndex).toBeGreaterThan(names.indexOf('linearRampToValueAtTime'));
    const target = gainNode.gainCalls[gainNode.gainCalls.length - 1];
    expect(target[0]).toBe('setTargetAtTime');
    expect(target[1]).toBeCloseTo(master * music * 0.5, 10);
  });

  it('changes nothing in the audio graph when no music plays', async () => {
    const { manager } = await createMusicFixture(env);
    expect(() => manager.setMusicVolumePercent(20)).not.toThrow();
    expect(env.contexts).toHaveLength(0);
  });
});

describe('AudioManager note glide and attack', () => {
  let env: FakeEnvironment;
  const START_FREQ = 220;
  const END_FREQ = 520;
  const NOTE_MS = 70;
  const ATTACK_MS = 12;
  const NOTE_GAIN = 0.3;
  const MS_PER_SECOND = 1000;

  beforeEach(() => {
    env = new FakeEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function playNote(note: Record<string, number>): Promise<{ ctx: FakeAudioContext; floor: number }> {
    vi.resetModules();
    const { ConfigRegistry } = await import('../config/ConfigRegistry');
    const { createTestBundle } = await import('../test/loadTestConfigs');
    const { AudioService } = await import('./AudioManager');
    const bundle = createTestBundle();
    bundle.audio.effects = {
      bloop: { waveform: 'sine', notes: [note] }
    } as unknown as typeof bundle.audio.effects;
    bundle.audio.terrainStepEffects = {};
    ConfigRegistry.applyConfigs(bundle);
    vi.stubGlobal('window', env.window);
    vi.stubGlobal('document', env.document);
    const manager = new AudioService();
    env.fire('pointerdown');
    await flushPromises();
    manager.playSfx('bloop');
    return { ctx: env.contexts[0], floor: bundle.audio.musicMix?.releaseFloorGain ?? Number.NaN };
  }

  it('glides the pitch to slideToFreq by the end of the note', async () => {
    const { ctx } = await playNote({ freq: START_FREQ, slideToFreq: END_FREQ, durationMs: NOTE_MS, gain: NOTE_GAIN });
    expect(ctx.oscillators[0].frequencyCalls).toEqual([
      ['setValueAtTime', START_FREQ, 0],
      ['exponentialRampToValueAtTime', END_FREQ, NOTE_MS / MS_PER_SECOND]
    ]);
  });

  it('keeps a constant pitch and an immediate start without the new fields', async () => {
    const { ctx } = await playNote({ freq: START_FREQ, durationMs: NOTE_MS, gain: NOTE_GAIN });
    expect(ctx.oscillators[0].frequencyCalls).toEqual([['setValueAtTime', START_FREQ, 0]]);
    const gainNode = ctx.nodes.find((node) => node.gainCalls.length > 0);
    expect(gainNode?.gainCalls[0][0]).toBe('setValueAtTime');
    expect(gainNode?.gainCalls.some((call) => call[0] === 'linearRampToValueAtTime')).toBe(false);
  });

  it('rises from the release floor to the note gain over attackMs', async () => {
    const { ctx, floor } = await playNote({ freq: START_FREQ, attackMs: ATTACK_MS, durationMs: NOTE_MS, gain: NOTE_GAIN });
    const gainNode = ctx.nodes.find((node) => node.gainCalls.length > 0);
    const calls = gainNode?.gainCalls ?? [];
    expect(calls[0]).toEqual(['setValueAtTime', floor, 0]);
    expect(calls[1][0]).toBe('linearRampToValueAtTime');
    expect(calls[1][2]).toBeCloseTo(ATTACK_MS / MS_PER_SECOND, 10);
    expect(calls[2][0]).toBe('exponentialRampToValueAtTime');
  });
});
