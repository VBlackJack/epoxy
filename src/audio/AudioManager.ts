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
import { AudioConfig, MusicTrackConfig } from '../core/types';

/** Mixing and scheduling parameters read from the optional `musicMix` block of audio.json. */
interface MusicMixConfig {
  /** Fraction of a step a music note sounds for. */
  noteLengthRatio: number;
  /** Lead voice gain relative to the music volume. */
  leadGain: number;
  /** Bass voice gain relative to the music volume. */
  bassGain: number;
  /** Gain an envelope ramps down to (exponential ramps cannot reach zero). */
  releaseFloorGain: number;
  /** How often the look-ahead scheduler wakes up. */
  schedulerIntervalMs: number;
  /** How far ahead of the audio clock notes are scheduled. */
  scheduleAheadMs: number;
}

/** Audio config keys this service reads beyond the shared AudioConfig shape. */
interface AudioRuntimeConfig extends AudioConfig {
  defaultTrackId?: string;
  musicMix?: Partial<MusicMixConfig>;
}

/** Used only when audio.json omits `musicMix` or one of its keys. */
const DEFAULT_MUSIC_MIX: MusicMixConfig = {
  noteLengthRatio: 0.85,
  leadGain: 0.45,
  bassGain: 0.35,
  releaseFloorGain: 0.001,
  schedulerIntervalMs: 25,
  scheduleAheadMs: 100
};

/** Events that count as a user gesture and therefore unlock audio playback. */
const USER_GESTURE_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click'];

const MS_PER_SECOND = 1000;

class AudioService {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private musicEnabled: boolean = false;
  private schedulerTimerId: number | null = null;
  private musicStepIndex: number = 0;
  private activeTrackIndex: number = 0;
  private nextNoteTime: number = 0;
  private userGestureSeen: boolean = false;
  private pausedWhileHidden: boolean = false;
  /** Nesting depth of runSilently calls; effects play only at zero. */
  private silenceDepth: number = 0;

  private readonly onUserGesture = (): void => {
    const firstGesture = !this.userGestureSeen;
    this.userGestureSeen = true;
    this.ensureContext();
    if (firstGesture && this.musicEnabled) {
      this.startMusicLoop();
    }
    this.releaseGestureListenersWhenRunning();
  };

  /** Stops listening for gestures once the context runs; until then every gesture retries the resume. */
  private releaseGestureListenersWhenRunning(): void {
    if (this.ctx?.state !== 'running' || typeof window === 'undefined') return;
    for (const type of USER_GESTURE_EVENTS) {
      window.removeEventListener(type, this.onUserGesture, true);
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.schedulerTimerId !== null) {
        this.stopMusicLoop();
        this.pausedWhileHidden = true;
      }
    } else if (this.pausedWhileHidden) {
      this.pausedWhileHidden = false;
      if (this.musicEnabled) {
        this.startMusicLoop();
      }
    }
  };

  constructor() {
    if (typeof window === 'undefined') return;
    // Browsers only allow an AudioContext to run after a user gesture: creating it
    // earlier leaves it suspended while notes pile up at a frozen clock.
    for (const type of USER_GESTURE_EVENTS) {
      window.addEventListener(type, this.onUserGesture, { capture: true, passive: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Returns a running context, or null when audio cannot play yet. */
  private ensureContext(): AudioContext | null {
    if (!this.userGestureSeen || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    // Any state but running or closed needs a resume, including the 'interrupted' state of iOS.
    const state: string = this.ctx.state;
    if (state !== 'running' && state !== 'closed') {
      this.ctx
        .resume()
        .then(() => this.releaseGestureListenersWhenRunning())
        .catch(() => {});
    }
    return this.ctx.state === 'running' ? this.ctx : null;
  }

  private getConfig(): AudioRuntimeConfig {
    return ConfigRegistry.getAudio() as AudioRuntimeConfig;
  }

  private getMix(): MusicMixConfig {
    return { ...DEFAULT_MUSIC_MIX, ...this.getConfig().musicMix };
  }

  private getActiveTrack(): MusicTrackConfig | null {
    const tracks = this.getConfig().tracks;
    if (!tracks || tracks.length === 0) return null;
    return tracks[this.activeTrackIndex % tracks.length];
  }

  /** Schedules one enveloped tone and releases its nodes once it has played. */
  private scheduleTone(
    ctx: AudioContext,
    waveform: OscillatorType,
    freq: number,
    peakGain: number,
    startSec: number,
    durationSec: number,
    releaseFloorGain: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, startSec);
    gain.gain.setValueAtTime(peakGain, startSec);
    gain.gain.exponentialRampToValueAtTime(releaseFloorGain, startSec + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(startSec);
    osc.stop(startSec + durationSec);
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public toggleSfx(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    return this.sfxEnabled;
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  public toggleMusic(): boolean {
    this.setMusicEnabled(!this.musicEnabled);
    return this.musicEnabled;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (this.musicEnabled) {
      this.startMusicLoop();
    } else {
      this.stopMusicLoop();
    }
  }

  /**
   * Runs a task with sound effects muted. The level generator replays whole
   * levels in a GameEngine to prove them; the player must not hear it.
   */
  public runSilently<T>(task: () => T): T {
    this.silenceDepth++;
    try {
      return task();
    } finally {
      this.silenceDepth--;
    }
  }

  public playSfx(effectId: string): void {
    if (!this.sfxEnabled || this.silenceDepth > 0) return;
    const audioCfg = this.getConfig();
    const effect = audioCfg.effects[effectId];
    if (!effect) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const { releaseFloorGain } = this.getMix();
    let offsetSec = ctx.currentTime;
    for (const note of effect.notes) {
      const durationSec = note.durationMs / MS_PER_SECOND;
      const peakGain = note.gain * audioCfg.masterVolume * audioCfg.sfxVolume;
      this.scheduleTone(ctx, effect.waveform, note.freq, peakGain, offsetSec, durationSec, releaseFloorGain);
      offsetSec += durationSec;
    }
  }

  public setTrackById(trackId: string): void {
    const tracks = this.getConfig().tracks;
    if (!tracks || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx >= 0) {
      this.activeTrackIndex = idx;
      this.musicStepIndex = 0;
      if (this.musicEnabled) {
        this.startMusicLoop();
      }
    }
  }

  public cycleTrack(): string {
    const audioCfg = this.getConfig();
    const tracks = audioCfg.tracks;
    if (!tracks || tracks.length === 0) return audioCfg.defaultTrackId ?? '';
    this.activeTrackIndex = (this.activeTrackIndex + 1) % tracks.length;
    this.musicStepIndex = 0;
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
    return tracks[this.activeTrackIndex].id;
  }

  private startMusicLoop(): void {
    this.stopMusicLoop();
    // The gesture handler restarts the loop once audio is unlocked; the visibility
    // handler restarts it when the tab is shown again.
    if (!this.userGestureSeen) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.pausedWhileHidden = true;
      return;
    }
    this.nextNoteTime = 0;
    this.schedulerTimerId = window.setInterval(() => this.scheduleAhead(), this.getMix().schedulerIntervalMs);
    this.scheduleAhead();
  }

  /** Look-ahead scheduler: queues every step that falls inside the scheduling window. */
  private scheduleAhead(): void {
    if (!this.musicEnabled) return;
    const ctx = this.ensureContext();
    const track = this.getActiveTrack();
    if (!ctx || !track) return;

    const audioCfg = this.getConfig();
    const mix = this.getMix();
    const stepSec = track.stepDurationMs / MS_PER_SECOND;
    const noteSec = stepSec * mix.noteLengthRatio;
    const horizon = ctx.currentTime + mix.scheduleAheadMs / MS_PER_SECOND;
    const musicGain = audioCfg.masterVolume * audioCfg.musicVolume;

    // After a stall (suspended context, throttled timer) restart from now instead of
    // replaying every missed step at once.
    if (this.nextNoteTime < ctx.currentTime) {
      this.nextNoteTime = ctx.currentTime;
    }

    while (this.nextNoteTime < horizon) {
      const { leadNotes, bassNotes, leadWaveform, bassWaveform } = track;
      const leadFreq = leadNotes[this.musicStepIndex % leadNotes.length];
      const bassFreq = bassNotes[this.musicStepIndex % bassNotes.length];
      if (leadFreq > 0) {
        this.scheduleTone(ctx, leadWaveform, leadFreq, musicGain * mix.leadGain, this.nextNoteTime, noteSec, mix.releaseFloorGain);
      }
      if (bassFreq > 0) {
        this.scheduleTone(ctx, bassWaveform, bassFreq, musicGain * mix.bassGain, this.nextNoteTime, noteSec, mix.releaseFloorGain);
      }
      this.musicStepIndex++;
      this.nextNoteTime += stepSec;
    }
  }

  public stopMusicLoop(): void {
    if (this.schedulerTimerId !== null) {
      clearInterval(this.schedulerTimerId);
      this.schedulerTimerId = null;
    }
  }
}

export const AudioManager = new AudioService();
