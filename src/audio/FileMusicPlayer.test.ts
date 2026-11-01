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

import { beforeEach, describe, expect, it } from 'vitest';
import { FileTrackConfig } from '../core/types';
import { FileMusicEvents, FileMusicPlayer, FileTrackSettings, pickPlayableFile } from './FileMusicPlayer';

/** Stands in for an HTMLAudioElement and records every call made on it. */
class FakeAudioElement {
  public crossOrigin: string | null = null;
  public loop = false;
  public preload = '';
  public src = '';
  public readonly calls: string[] = [];
  public readonly listeners = new Map<string, Set<() => void>>();
  /** Mime types canPlayType answers 'maybe' for. */
  public playable: string[] = ['audio/ogg', 'audio/mpeg'];
  /** What the next play() call does: resolves, or rejects with this error name. */
  public playOutcome: string | null = null;

  public canPlayType(mime: string): string {
    return this.playable.includes(mime) ? 'maybe' : '';
  }

  public play(): Promise<void> {
    this.calls.push('play');
    if (this.playOutcome === null) return Promise.resolve();
    const error = new Error('play failed');
    error.name = this.playOutcome;
    return Promise.reject(error);
  }

  public pause(): void {
    this.calls.push('pause');
  }

  public load(): void {
    this.calls.push('load');
  }

  public removeAttribute(name: string): void {
    this.calls.push(`removeAttribute:${name}`);
    if (name === 'src') this.src = '';
  }

  public addEventListener(type: string, handler: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(handler);
  }

  public removeEventListener(type: string, handler: () => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  public emit(type: string): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler();
  }
}

class FakeNode {
  public readonly events: string[] = [];
  public connectedTo: unknown = null;
  public readonly gain = {
    calls: [] as Array<[string, number, number?]>,
    setValueAtTime: (value: number, time: number): void => {
      this.gain.calls.push(['set', value, time]);
    },
    linearRampToValueAtTime: (value: number, time: number): void => {
      this.gain.calls.push(['ramp', value, time]);
    }
  };

  constructor(public readonly kind: string, private readonly log: string[]) {}

  public connect(target: unknown): void {
    this.connectedTo = target;
    this.log.push(`connect:${this.kind}`);
  }

  public disconnect(): void {
    this.log.push(`disconnect:${this.kind}`);
  }
}

/** Stands in for an AudioContext: only what the file player touches. */
class FakeContext {
  public readonly log: string[] = [];
  public readonly destination = { kind: 'destination' };
  public currentTime = 2;
  public readonly sources: FakeNode[] = [];
  public readonly gains: FakeNode[] = [];
  public readonly sourceElements: unknown[] = [];

  public createMediaElementSource(element: unknown): FakeNode {
    this.sourceElements.push(element);
    const node = new FakeNode('source', this.log);
    this.sources.push(node);
    return node;
  }

  public createGain(): FakeNode {
    const node = new FakeNode('gain', this.log);
    this.gains.push(node);
    return node;
  }
}

const TRACK: FileTrackConfig = {
  id: 'orchestral',
  i18nKey: 'app.music.orchestral.label',
  source: 'file',
  files: ['orchestral.wav', 'orchestral.ogg', 'orchestral.mp3'],
  gain: 0.5
};

const SETTINGS: FileTrackSettings = {
  baseUrl: './audio/music/',
  mimeTypes: { ogg: 'audio/ogg', mp3: 'audio/mpeg' },
  volume: 0.1,
  fadeInMs: 500
};

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('pickPlayableFile', () => {
  it('skips files whose extension has no mime type and files the browser cannot play', () => {
    const element = new FakeAudioElement();
    expect(pickPlayableFile(element, ['a.wav', 'a.ogg', 'a.mp3'], SETTINGS.mimeTypes)).toBe('a.ogg');
    element.playable = ['audio/mpeg'];
    expect(pickPlayableFile(element, ['a.ogg', 'a.MP3'], SETTINGS.mimeTypes)).toBe('a.MP3');
    element.playable = [];
    expect(pickPlayableFile(element, ['a.ogg', 'a.mp3'], SETTINGS.mimeTypes)).toBeNull();
  });
});

describe('FileMusicPlayer', () => {
  let elements: FakeAudioElement[];
  let ctx: FakeContext;
  let blocked: string[];
  let failed: Array<[string, string]>;
  let player: FileMusicPlayer;

  beforeEach(() => {
    elements = [];
    ctx = new FakeContext();
    blocked = [];
    failed = [];
    const events: FileMusicEvents = {
      onBlocked: (id) => blocked.push(id),
      onFailed: (id, reason) => failed.push([id, reason])
    };
    player = new FileMusicPlayer(events, () => {
      const element = new FakeAudioElement();
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    });
  });

  const start = (settings: FileTrackSettings = SETTINGS, track: FileTrackConfig = TRACK): void =>
    player.start(ctx as unknown as AudioContext, track, settings);

  it('creates no element until a track starts', () => {
    expect(elements).toHaveLength(0);
    expect(player.isActive()).toBe(false);
    start();
    expect(elements).toHaveLength(1);
    expect(player.isActive()).toBe(true);
  });

  it('configures the element and plays the first playable file under the base url', () => {
    start();
    const [element] = elements;
    expect(element.src).toBe('./audio/music/orchestral.ogg');
    expect(element.loop).toBe(true);
    expect(element.crossOrigin).toBe('anonymous');
    expect(element.preload).toBe('auto');
    expect(element.calls).toContain('play');
  });

  it('routes element -> source -> gain -> destination with master * music * track gain', () => {
    start();
    expect(ctx.sourceElements).toEqual([elements[0]]);
    expect(ctx.sources[0].connectedTo).toBe(ctx.gains[0]);
    expect(ctx.gains[0].connectedTo).toBe(ctx.destination);
    expect(ctx.gains[0].gain.calls).toEqual([
      ['set', 0, 2],
      ['ramp', 0.1 * 0.5, 2.5]
    ]);
  });

  it('uses the track gain of 1 when none is configured and starts at full volume without a fade', () => {
    start({ ...SETTINGS, fadeInMs: 0 }, { ...TRACK, gain: undefined });
    expect(ctx.gains[0].gain.calls).toEqual([['set', 0.1, 2]]);
  });

  it('creates a new element and a new media source for each play, one source per element', () => {
    start();
    start();
    expect(elements).toHaveLength(2);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sourceElements).toEqual([elements[0], elements[1]]);
  });

  it('releases the element and the nodes on dispose', () => {
    start();
    player.dispose();
    const [element] = elements;
    expect(element.calls.slice(-3)).toEqual(['pause', 'removeAttribute:src', 'load']);
    expect(ctx.log).toContain('disconnect:source');
    expect(ctx.log).toContain('disconnect:gain');
    expect(element.listeners.get('error')?.size).toBe(0);
    expect(player.isActive()).toBe(false);
    player.dispose();
    expect(element.calls.filter((c) => c === 'load')).toHaveLength(1);
  });

  it('disposes the previous track when another one starts', () => {
    start();
    start();
    expect(elements[0].calls).toContain('removeAttribute:src');
    expect(elements[1].calls).not.toContain('removeAttribute:src');
  });

  it('reports a blocked play and keeps the track so a gesture can resume it', async () => {
    const first = new FakeAudioElement();
    first.playOutcome = 'NotAllowedError';
    const blockedPlayer = new FileMusicPlayer(
      { onBlocked: (id) => blocked.push(id), onFailed: (id, reason) => failed.push([id, reason]) },
      () => {
        elements.push(first);
        return first as unknown as HTMLAudioElement;
      }
    );
    blockedPlayer.start(ctx as unknown as AudioContext, TRACK, SETTINGS);
    await flushPromises();
    expect(blocked).toEqual(['orchestral']);
    expect(failed).toEqual([]);
    expect(blockedPlayer.isActive()).toBe(true);
    first.playOutcome = null;
    blockedPlayer.resume();
    expect(first.calls.filter((c) => c === 'play')).toHaveLength(2);
  });

  it('ignores an AbortError caused by a pause before play resolved', async () => {
    const element = new FakeAudioElement();
    element.playOutcome = 'AbortError';
    const abortPlayer = new FileMusicPlayer(
      { onBlocked: (id) => blocked.push(id), onFailed: (id, reason) => failed.push([id, reason]) },
      () => element as unknown as HTMLAudioElement
    );
    abortPlayer.start(ctx as unknown as AudioContext, TRACK, SETTINGS);
    await flushPromises();
    expect(blocked).toEqual([]);
    expect(failed).toEqual([]);
    expect(abortPlayer.isActive()).toBe(true);
  });

  it('fails the track and disposes it when play rejects for another reason', async () => {
    const element = new FakeAudioElement();
    element.playOutcome = 'NotSupportedError';
    const failPlayer = new FileMusicPlayer(
      { onBlocked: (id) => blocked.push(id), onFailed: (id, reason) => failed.push([id, reason]) },
      () => element as unknown as HTMLAudioElement
    );
    failPlayer.start(ctx as unknown as AudioContext, TRACK, SETTINGS);
    await flushPromises();
    expect(failed).toEqual([['orchestral', 'NotSupportedError']]);
    expect(failPlayer.isActive()).toBe(false);
    expect(element.calls).toContain('removeAttribute:src');
  });

  it('fails the track on an element error event, once', () => {
    start();
    elements[0].emit('error');
    elements[0].emit('error');
    expect(failed).toEqual([['orchestral', 'media error']]);
    expect(player.isActive()).toBe(false);
  });

  it('fails without creating audio nodes when no file is playable', () => {
    start({ ...SETTINGS, mimeTypes: { wav: 'audio/wav' } });
    expect(failed).toEqual([['orchestral', 'no playable source']]);
    expect(ctx.sources).toHaveLength(0);
    expect(elements[0].calls).toContain('removeAttribute:src');
    expect(player.isActive()).toBe(false);
  });

  it('releases the element and nodes and reports a failure when the setup throws', () => {
    const broken = new FakeContext();
    broken.createGain = (): FakeNode => {
      throw new Error('no gain');
    };
    player.start(broken as unknown as AudioContext, TRACK, SETTINGS);
    expect(failed).toEqual([['orchestral', 'no gain']]);
    expect(player.isActive()).toBe(false);
    expect(elements[0].calls).toEqual(['pause', 'removeAttribute:src', 'load']);
    expect(broken.log).toContain('disconnect:source');
  });

  it('ignores a rejection that arrives after another track replaced the one that was refused', async () => {
    const rejecters: Array<(error: Error) => void> = [];
    const slowPlayer = new FileMusicPlayer(
      { onBlocked: (id) => blocked.push(id), onFailed: (id, reason) => failed.push([id, reason]) },
      () => {
        const element = new FakeAudioElement();
        element.play = (): Promise<void> =>
          new Promise<void>((_resolve, reject) => {
            rejecters.push(reject);
          });
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      }
    );
    const other: FileTrackConfig = { ...TRACK, id: 'second' };
    slowPlayer.start(ctx as unknown as AudioContext, TRACK, SETTINGS);
    slowPlayer.start(ctx as unknown as AudioContext, other, SETTINGS);
    for (const name of ['NotAllowedError', 'NotSupportedError']) {
      const error = new Error('late');
      error.name = name;
      rejecters[0](error);
      await flushPromises();
      expect(blocked).toEqual([]);
      expect(failed).toEqual([]);
      expect(slowPlayer.activeTrackId()).toBe('second');
    }
  });

  it('pauses and resumes the playing element', () => {
    start();
    player.pause();
    player.resume();
    expect(elements[0].calls).toEqual(['play', 'pause', 'play']);
  });
});
