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
import { AudioConfig, FileTrackConfig, MusicMixConfig, MusicTrackConfig } from '../core/types';
import { FileMusicPlayer } from './FileMusicPlayer';
import { SfxBank } from './SfxBank';
import {
  FALLBACK_MUSIC_MODE,
  isFileTrack,
  isMusicMode,
  MusicMode,
  pickTrack,
  sanitizeMusicSettings
} from './musicSelection';

/** Used only when audio.json omits `musicMix` or one of its keys. */
const DEFAULT_MUSIC_MIX: MusicMixConfig = {
  noteLengthRatio: 0.85,
  leadGain: 0.45,
  bassGain: 0.35,
  releaseFloorGain: 0.001,
  schedulerIntervalMs: 25,
  scheduleAheadMs: 100,
  fileFadeInMs: 400
};

/** Folder and MIME map used when audio.json declares a file track but omits them. */
const DEFAULT_MUSIC_BASE_URL = './audio/music';
/** Folder the sampled effect files are loaded from when audio.json omits `sfxBaseUrl`. */
const DEFAULT_SFX_BASE_URL = './audio/sfx';
const DEFAULT_FILE_MIME_TYPES: Readonly<Record<string, string>> = { ogg: 'audio/ogg', mp3: 'audio/mpeg' };

/** Events that count as a user gesture and therefore unlock audio playback. */
const USER_GESTURE_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click'];

const MS_PER_SECOND = 1000;

/** A music track as the settings UI lists it. */
export interface MusicTrackOption {
  id: string;
  i18nKey: string;
}

export class AudioService {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private musicEnabled: boolean = false;
  private schedulerTimerId: number | null = null;
  private musicStepIndex: number = 0;
  private activeTrackId: string | null = null;
  private musicMode: MusicMode = FALLBACK_MUSIC_MODE;
  private customTrackIds: string[] = [];
  /** Track of the biome on screen, played in the 'default' mode. */
  private themeTrackId: string | null = null;
  /** Level the last pick was made for; a pick happens only when another level loads. */
  private lastLevelId: string | null = null;
  /** Tracks that failed to play, left out of every pick for the rest of the session. */
  private readonly failedTrackIds = new Set<string>();
  private readonly filePlayer: FileMusicPlayer;
  private sfxBank: SfxBank | null = null;
  private fileRetryArmed: boolean = false;
  private nextNoteTime: number = 0;
  private userGestureSeen: boolean = false;
  private pausedWhileHidden: boolean = false;
  /** Nesting depth of runSilently calls; effects play only at zero. */
  private silenceDepth: number = 0;
  /** Audio clock time, in seconds, each effect last started; read by `minIntervalMs`. */
  private readonly lastSfxStartSec = new Map<string, number>();

  private readonly onUserGesture = (): void => {
    const firstGesture = !this.userGestureSeen;
    this.userGestureSeen = true;
    this.ensureContext();
    if (firstGesture && this.musicEnabled) {
      this.startMusicLoop();
    } else {
      this.startFileTrackIfWaiting();
    }
    this.releaseGestureListenersWhenRunning();
  };

  /** Playback of a file track was refused by the browser: the next gesture starts it. */
  private readonly onRetryGesture = (): void => {
    this.disarmFileRetry();
    this.ensureContext();
    this.filePlayer.resume();
  };

  private armFileRetry(): void {
    if (this.fileRetryArmed || typeof window === 'undefined') return;
    this.fileRetryArmed = true;
    for (const type of USER_GESTURE_EVENTS) {
      window.addEventListener(type, this.onRetryGesture, { capture: true, passive: true });
    }
  }

  private disarmFileRetry(): void {
    if (!this.fileRetryArmed || typeof window === 'undefined') return;
    this.fileRetryArmed = false;
    for (const type of USER_GESTURE_EVENTS) {
      window.removeEventListener(type, this.onRetryGesture, true);
    }
  }

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
      } else if (this.filePlayer.isActive()) {
        this.filePlayer.pause();
        this.pausedWhileHidden = true;
      }
    } else if (this.pausedWhileHidden) {
      this.pausedWhileHidden = false;
      if (!this.musicEnabled) return;
      if (this.filePlayer.isActive()) {
        // Re-run the context check first: iOS leaves it 'interrupted' after a spell in the background.
        this.ensureContext();
        this.filePlayer.resume();
      } else {
        this.startMusicLoop();
      }
    }
  };

  /** @param createAudioElement Builds the element a file track plays through; tests pass a fake. */
  constructor(createAudioElement?: () => HTMLAudioElement) {
    this.filePlayer = new FileMusicPlayer(
      {
        onBlocked: () => this.armFileRetry(),
        onFailed: (trackId, reason) => this.onFileTrackFailed(trackId, reason)
      },
      createAudioElement
    );
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
      this.loadSfxBank(this.ctx);
    }
    // Any state but running or closed needs a resume, including the 'interrupted' state of iOS.
    const state: string = this.ctx.state;
    if (state !== 'running' && state !== 'closed') {
      this.ctx
        .resume()
        .then(() => {
          this.releaseGestureListenersWhenRunning();
          this.startFileTrackIfWaiting();
        })
        .catch(() => {});
    }
    return this.ctx.state === 'running' ? this.ctx : null;
  }

  /**
   * Decodes the sampled effects in the background. Effects played before the
   * decoding ends (right after the first gesture) use their synthesised notes.
   */
  private loadSfxBank(ctx: AudioContext): void {
    let audioCfg: AudioConfig;
    try {
      audioCfg = this.getConfig();
    } catch {
      return;
    }
    if (!audioCfg?.effects) return;
    this.sfxBank = new SfxBank();
    this.sfxBank.load(ctx, audioCfg.effects, audioCfg.sfxBaseUrl ?? DEFAULT_SFX_BASE_URL);
  }

  private getConfig(): AudioConfig {
    return ConfigRegistry.getAudio();
  }

  private getMix(): MusicMixConfig {
    return { ...DEFAULT_MUSIC_MIX, ...this.getConfig().musicMix };
  }

  private getTracks(): MusicTrackConfig[] {
    return this.getConfig().tracks ?? [];
  }

  private getAllTrackIds(): string[] {
    return this.getTracks().map((track) => track.id);
  }

  /** The chosen track, else the default synth track, else the first one. */
  private getActiveTrack(): MusicTrackConfig | null {
    const tracks = this.getTracks();
    if (tracks.length === 0) return null;
    const byId = (id: string | null | undefined): MusicTrackConfig | undefined =>
      id ? tracks.find((track) => track.id === id) : undefined;
    return byId(this.activeTrackId) ?? byId(this.getConfig().defaultTrackId) ?? tracks[0];
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

    const { minIntervalMs } = effect;
    if (minIntervalMs !== undefined) {
      const lastStart = this.lastSfxStartSec.get(effectId);
      if (lastStart !== undefined && ctx.currentTime - lastStart < minIntervalMs / MS_PER_SECOND) return;
    }
    this.lastSfxStartSec.set(effectId, ctx.currentTime);

    const sfxVolume = audioCfg.masterVolume * audioCfg.sfxVolume;
    if (this.sfxBank?.play(ctx, effectId, effect, sfxVolume)) return;

    const { releaseFloorGain } = this.getMix();
    let offsetSec = ctx.currentTime;
    for (const note of effect.notes) {
      const durationSec = note.durationMs / MS_PER_SECOND;
      const peakGain = note.gain * sfxVolume;
      this.scheduleTone(ctx, effect.waveform, note.freq, peakGain, offsetSec, durationSec, releaseFloorGain);
      offsetSec += durationSec;
    }
  }

  // -- Music modes -----------------------------------------------------

  public getMusicMode(): MusicMode {
    return this.musicMode;
  }

  public getCustomTrackIds(): string[] {
    return [...this.customTrackIds];
  }

  /** The music mode audio.json starts players in. */
  public getDefaultMusicMode(): MusicMode {
    const configured = this.getConfig().defaultMusicMode;
    return isMusicMode(configured) ? configured : FALLBACK_MUSIC_MODE;
  }

  /** Id of the track that plays, or would play once music is on. */
  public getActiveTrackId(): string | null {
    return this.getActiveTrack()?.id ?? null;
  }

  public getTrackOptions(): MusicTrackOption[] {
    return this.getTracks().map(({ id, i18nKey }) => ({ id, i18nKey }));
  }

  /**
   * Installs stored music settings, replacing invalid values. It does not
   * choose a track: setThemeTrack and onLevelLoaded do.
   */
  public configureMusic(rawMode: unknown, rawCustom: unknown): void {
    const settings = sanitizeMusicSettings(rawMode, rawCustom, this.getAllTrackIds(), this.getDefaultMusicMode());
    this.musicMode = settings.mode;
    this.customTrackIds = settings.customIds;
  }

  /** Changes the mode and applies it at once. */
  public setMusicMode(mode: MusicMode): void {
    this.musicMode = mode;
    this.chooseTrack();
  }

  /** Changes the ticked tracks; in 'custom' mode a playing track that was unticked is replaced. */
  public setCustomTracks(ids: readonly string[]): void {
    this.customTrackIds = sanitizeMusicSettings(this.musicMode, ids, this.getAllTrackIds(), this.getDefaultMusicMode()).customIds;
    const playing = this.activeTrackId;
    if (this.musicMode === 'custom' && (playing === null || !this.customTrackIds.includes(playing))) {
      this.chooseTrack();
    }
  }

  /** Records the track of the biome on screen; it plays only in the 'default' mode. */
  public setThemeTrack(trackId: string | null | undefined): void {
    this.themeTrackId = trackId ?? null;
    if (this.musicMode === 'default') this.chooseTrack();
  }

  /** Called when a level loads: a level other than the last one means a new pick in 'random' and 'custom'. */
  public onLevelLoaded(levelId: string): void {
    if (levelId === this.lastLevelId) return;
    this.lastLevelId = levelId;
    if (this.musicMode !== 'default') this.chooseTrack();
  }

  /** Picks the track for the current mode and plays it; the default synth track when none is eligible. */
  private chooseTrack(): void {
    const picked = pickTrack(this.musicMode, {
      themeTrackId: this.themeTrackId,
      allIds: this.getAllTrackIds(),
      customIds: this.customTrackIds,
      previousId: this.activeTrackId,
      excludedIds: this.failedTrackIds,
      random: Math.random
    });
    this.selectTrack(picked ?? this.getConfig().defaultTrackId ?? null);
  }

  private selectTrack(trackId: string | null): void {
    if (trackId === this.activeTrackId) return;
    this.activeTrackId = trackId;
    this.musicStepIndex = 0;
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
  }

  private onFileTrackFailed(trackId: string, reason: string): void {
    console.warn(`Music track "${trackId}" cannot be played (${reason}); it is skipped for this session.`);
    this.failedTrackIds.add(trackId);
    this.disarmFileRetry();
    if (this.activeTrackId === trackId) {
      this.activeTrackId = null;
      this.chooseTrack();
    }
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
    const track = this.getActiveTrack();
    if (!track) return;
    if (isFileTrack(track)) {
      this.startFileTrack(track);
      return;
    }
    this.nextNoteTime = 0;
    this.schedulerTimerId = window.setInterval(() => this.scheduleAhead(), this.getMix().schedulerIntervalMs);
    this.scheduleAhead();
  }

  private startFileTrack(track: FileTrackConfig): void {
    this.ensureContext();
    // play() must run inside the user gesture (iOS), so the element starts even while the
    // context is still resuming; its sound begins once the context runs. The resume
    // handler retries through startFileTrackIfWaiting if nothing could start here.
    const ctx = this.ctx;
    if (!ctx || (ctx.state as string) === 'closed') return;
    const audioCfg = this.getConfig();
    this.filePlayer.start(ctx, track, {
      baseUrl: audioCfg.musicBaseUrl ?? DEFAULT_MUSIC_BASE_URL,
      mimeTypes: audioCfg.fileMimeTypes ?? DEFAULT_FILE_MIME_TYPES,
      volume: audioCfg.masterVolume * audioCfg.musicVolume,
      fadeInMs: this.getMix().fileFadeInMs
    });
  }

  /** Starts the chosen file track if it could not start earlier because the context was not running. */
  private startFileTrackIfWaiting(): void {
    if (!this.musicEnabled || this.pausedWhileHidden || this.filePlayer.isActive()) return;
    const track = this.getActiveTrack();
    if (track && isFileTrack(track)) this.startFileTrack(track);
  }

  /** Look-ahead scheduler: queues every step that falls inside the scheduling window. */
  private scheduleAhead(): void {
    if (!this.musicEnabled) return;
    const ctx = this.ensureContext();
    const track = this.getActiveTrack();
    // The scheduler only ever plays synth tracks; file tracks go through the file player.
    if (!ctx || !track || isFileTrack(track)) return;

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
    this.filePlayer.dispose();
    this.disarmFileRetry();
  }
}

export const AudioManager = new AudioService();
