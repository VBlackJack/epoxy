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

import { FileTrackConfig } from '../core/types';

const MS_PER_SECOND = 1000;

/** Name of the DOMException a browser raises when playback needs a user gesture. */
const BLOCKED_ERROR_NAME = 'NotAllowedError';
/** Name of the DOMException raised when pause() or a new load interrupts a pending play(). */
const ABORTED_ERROR_NAME = 'AbortError';

/** What the player needs to start a file track. */
export interface FileTrackSettings {
  /** Folder the track files live in. */
  baseUrl: string;
  /** MIME type by lower-case file extension. */
  mimeTypes: Readonly<Record<string, string>>;
  /** Master volume times music volume. */
  volume: number;
  /** Fade-in length; 0 starts at full volume. */
  fadeInMs: number;
}

/** Callbacks the player uses to report what it cannot fix itself. */
export interface FileMusicEvents {
  /** The browser refused to start playback until the next user gesture. */
  onBlocked: (trackId: string) => void;
  /** The track cannot be played (no usable source, network or decoding error). */
  onFailed: (trackId: string, reason: string) => void;
}

interface ActiveFileTrack {
  trackId: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  onError: () => void;
}

/** First file of the list whose extension maps to a MIME type the element says it can play. */
export function pickPlayableFile(
  element: { canPlayType: (type: string) => string },
  files: readonly string[],
  mimeTypes: Readonly<Record<string, string>>
): string | null {
  for (const file of files) {
    const extension = file.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
    const mime = Object.prototype.hasOwnProperty.call(mimeTypes, extension) ? mimeTypes[extension] : undefined;
    if (mime && element.canPlayType(mime) !== '') return file;
  }
  return null;
}

export function joinUrl(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}

/**
 * Streams one audio file at a time through the Web Audio graph
 * (element -> media source -> gain -> destination). The element is created
 * when the track starts and thrown away when it stops, so unused tracks cost
 * nothing, and the file is never decoded into a buffer.
 */
export class FileMusicPlayer {
  private active: ActiveFileTrack | null = null;

  constructor(
    private readonly events: FileMusicEvents,
    private readonly createElement: () => HTMLAudioElement = () => new Audio()
  ) {}

  /** True from start() until dispose(), including while the browser keeps playback blocked. */
  public isActive(): boolean {
    return this.active !== null;
  }

  public activeTrackId(): string | null {
    return this.active?.trackId ?? null;
  }

  /** Replaces whatever plays with the given track. */
  public start(ctx: AudioContext, track: FileTrackConfig, settings: FileTrackSettings): void {
    this.dispose();
    const element = this.createElement();
    const file = pickPlayableFile(element, track.files, settings.mimeTypes);
    if (file === null) {
      this.discardElement(element);
      this.events.onFailed(track.id, 'no playable source');
      return;
    }
    let source: MediaElementAudioSourceNode | null = null;
    let gain: GainNode | null = null;
    try {
      // CORS mode must be set before the source, or the media element source outputs silence.
      element.crossOrigin = 'anonymous';
      element.loop = true;
      element.preload = 'auto';
      element.src = joinUrl(settings.baseUrl, file);

      source = ctx.createMediaElementSource(element);
      gain = ctx.createGain();
      const target = settings.volume * (track.gain ?? 1);
      const now = ctx.currentTime;
      if (settings.fadeInMs > 0) {
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(target, now + settings.fadeInMs / MS_PER_SECOND);
      } else {
        gain.gain.setValueAtTime(target, now);
      }
      source.connect(gain);
      gain.connect(ctx.destination);
    } catch (error) {
      // Nothing may keep downloading or stay connected after a failed setup.
      this.discardElement(element);
      source?.disconnect();
      gain?.disconnect();
      this.events.onFailed(track.id, error instanceof Error ? error.message : 'setup failed');
      return;
    }

    const entry: ActiveFileTrack = {
      trackId: track.id,
      element,
      source,
      gain,
      onError: () => this.fail(entry, 'media error')
    };
    element.addEventListener('error', entry.onError);
    this.active = entry;
    this.attemptPlay(entry);
  }

  /** Starts playback of the current track again (after a pause or a blocked attempt). */
  public resume(): void {
    if (this.active) this.attemptPlay(this.active);
  }

  public pause(): void {
    this.active?.element.pause();
  }

  /** Stops the track and releases its element and audio nodes. */
  public dispose(): void {
    const entry = this.active;
    if (!entry) return;
    this.active = null;
    entry.element.removeEventListener('error', entry.onError);
    this.discardElement(entry.element);
    entry.source.disconnect();
    entry.gain.disconnect();
  }

  private discardElement(element: HTMLAudioElement): void {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }

  private attemptPlay(entry: ActiveFileTrack): void {
    let pending: Promise<void> | undefined;
    try {
      pending = entry.element.play();
    } catch (error) {
      this.handlePlayError(entry, error);
      return;
    }
    pending?.catch((error: unknown) => this.handlePlayError(entry, error));
  }

  private handlePlayError(entry: ActiveFileTrack, error: unknown): void {
    // A result for an element that was already replaced or disposed is of no interest.
    if (this.active !== entry) return;
    const name = error instanceof Error ? error.name : '';
    if (name === ABORTED_ERROR_NAME) return;
    if (name === BLOCKED_ERROR_NAME) {
      this.events.onBlocked(entry.trackId);
      return;
    }
    this.fail(entry, name || 'play failed');
  }

  private fail(entry: ActiveFileTrack, reason: string): void {
    if (this.active !== entry) return;
    this.dispose();
    this.events.onFailed(entry.trackId, reason);
  }
}
