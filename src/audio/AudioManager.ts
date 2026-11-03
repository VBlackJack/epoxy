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
  isMusicMode,
  MusicMode,
  pickTrack,
  sanitizeMusicSettings
} from './musicSelection';
import { effectiveVolume, sanitizeVolumePercent, VOLUME_PERCENT_DEFAULT } from './volumeSettings';

/** Used only when audio.json omits `musicMix` or one of its keys. */
const DEFAULT_MUSIC_MIX: MusicMixConfig = {
  releaseFloorGain: 0.001,
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

/** Effect played for a step when the terrain is unmapped or its effect does not exist. */
const DEFAULT_STEP_EFFECT_ID = 'step';

/** A music track as the settings UI lists it. */
export interface MusicTrackOption {
  id: string;
  i18nKey: string;
}

export class AudioService {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private musicEnabled: boolean = false;
  private sfxVolumePercent: number = VOLUME_PERCENT_DEFAULT;
  private musicVolumePercent: number = VOLUME_PERCENT_DEFAULT;
  private activeTrackId: string | null = null;
  private musicMode: MusicMode = FALLBACK_MUSIC_MODE;
  private customTrackIds: string[] = [];
  /** Track of the biome on screen, played in the 'default' mode. */
  private themeTrackId: string | null = null;
  /** Tracks of the endless run while it is on screen, null otherwise; see TrackPickContext. */
  private endlessTrackIds: readonly string[] | null = null;
  /** Level the last pick was made for; a pick happens only when another level loads. */
  private lastLevelId: string | null = null;
  /** Tracks that failed to play, left out of every pick for the rest of the session. */
  private readonly failedTrackIds = new Set<string>();
  private readonly filePlayer: FileMusicPlayer;
  private sfxBank: SfxBank | null = null;
  private fileRetryArmed: boolean = false;
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
      if (this.filePlayer.isActive()) {
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

  /** The chosen track, or null when none can play: music is then silent. A failed track is never returned. */
  private getActiveTrack(): MusicTrackConfig | null {
    const id = this.activeTrackId;
    if (id === null || this.failedTrackIds.has(id)) return null;
    return this.getTracks().find((track) => track.id === id) ?? null;
  }

  /** Schedules one enveloped sound effect tone and releases its nodes once it has played. */
  private scheduleTone(
    ctx: AudioContext,
    waveform: OscillatorType,
    freq: number,
    peakGain: number,
    startSec: number,
    durationSec: number,
    releaseFloorGain: number,
    slideToFreq?: number,
    attackSec = 0
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, startSec);
    if (slideToFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(slideToFreq, startSec + durationSec);
    if (attackSec > 0) {
      gain.gain.setValueAtTime(releaseFloorGain, startSec);
      gain.gain.linearRampToValueAtTime(peakGain, startSec + attackSec);
    } else {
      gain.gain.setValueAtTime(peakGain, startSec);
    }
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
      // Turning music on again is a fresh start: tracks that failed earlier get another chance.
      this.failedTrackIds.clear();
      if (this.activeTrackId === null) this.chooseTrack();
      if (!this.filePlayer.isActive()) this.startMusicLoop();
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

  /** Plays the footstep of a terrain (a tile `slideType` or `hazard`), or the plain step when it has none. */
  public playStep(terrain: string | null): void {
    const audioCfg = this.getConfig();
    const map = audioCfg.terrainStepEffects;
    const mapped = terrain !== null && map !== undefined && Object.hasOwn(map, terrain) ? map[terrain] : undefined;
    const effectId = mapped !== undefined && Object.hasOwn(audioCfg.effects, mapped) ? mapped : DEFAULT_STEP_EFFECT_ID;
    this.playSfx(effectId);
  }

  public getSfxVolumePercent(): number {
    return this.sfxVolumePercent;
  }

  public getMusicVolumePercent(): number {
    return this.musicVolumePercent;
  }

  /** Sets the effects volume (see sanitizeVolumePercent); it applies to the next effect. */
  public setSfxVolumePercent(percent: unknown): void {
    this.sfxVolumePercent = sanitizeVolumePercent(percent);
  }

  /** Sets the music volume (see sanitizeVolumePercent) and applies it at once to the playing track. */
  public setMusicVolumePercent(percent: unknown): void {
    this.musicVolumePercent = sanitizeVolumePercent(percent);
    const ctx = this.ctx;
    if (ctx && (ctx.state as string) !== 'closed') this.filePlayer.setVolume(ctx, this.getMusicVolume());
  }

  private getMusicVolume(): number {
    const audioCfg = this.getConfig();
    return effectiveVolume(audioCfg.masterVolume, audioCfg.musicVolume, this.musicVolumePercent);
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

    const sfxVolume = effectiveVolume(audioCfg.masterVolume, audioCfg.sfxVolume, this.sfxVolumePercent);
    if (this.sfxBank?.play(ctx, effectId, effect, sfxVolume)) return;

    const { releaseFloorGain } = this.getMix();
    let offsetSec = ctx.currentTime;
    for (const note of effect.notes) {
      const durationSec = note.durationMs / MS_PER_SECOND;
      const peakGain = note.gain * sfxVolume;
      const attackSec = (note.attackMs ?? 0) / MS_PER_SECOND;
      this.scheduleTone(
        ctx,
        effect.waveform,
        note.freq,
        peakGain,
        offsetSec,
        durationSec,
        releaseFloorGain,
        note.slideToFreq,
        attackSec
      );
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
    if (this.musicMode === 'default' && this.endlessTrackIds === null) this.chooseTrack();
  }

  /**
   * Tells which tracks the endless run plays (null when it is not the pack on screen). While set,
   * the 'default' mode picks among them for each new level instead of following the biome. Call it
   * before onLevelLoaded; leaving the run goes back to the biome track at once.
   */
  public setEndlessTracks(ids: readonly string[] | null): void {
    const wasEndless = this.endlessTrackIds !== null;
    this.endlessTrackIds = ids;
    if (ids !== null) {
      if (!wasEndless) this.lastLevelId = null;
    } else if (wasEndless && this.musicMode === 'default') {
      this.chooseTrack();
    }
  }

  /** Called when a level loads: a level other than the last one means a new pick in 'random' and 'custom'. */
  public onLevelLoaded(levelId: string): void {
    if (levelId === this.lastLevelId) return;
    this.lastLevelId = levelId;
    if (this.musicMode !== 'default' || this.endlessTrackIds !== null) this.chooseTrack();
  }

  /** Picks the track for the current mode and plays it; music stays silent when none is eligible. */
  private chooseTrack(): void {
    const picked = pickTrack(this.musicMode, {
      themeTrackId: this.themeTrackId,
      endlessTrackIds: this.endlessTrackIds,
      allIds: this.getAllTrackIds(),
      customIds: this.customTrackIds,
      previousId: this.activeTrackId,
      excludedIds: this.failedTrackIds,
      random: Math.random
    });
    this.selectTrack(picked ?? null);
  }

  private selectTrack(trackId: string | null): void {
    if (trackId === this.activeTrackId) return;
    this.activeTrackId = trackId;
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
  }

  private onFileTrackFailed(trackId: string, reason: string): void {
    this.failedTrackIds.add(trackId);
    this.disarmFileRetry();
    if (this.activeTrackId === trackId) {
      this.activeTrackId = null;
      // Each failure adds to failedTrackIds, so a chain of picks ends after at most one try per track.
      this.chooseTrack();
    }
    const outcome =
      this.activeTrackId === null ? 'no other track can play, music stays silent' : 'it is skipped until music is turned back on';
    console.warn(`Music track "${trackId}" cannot be played (${reason}); ${outcome}.`);
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
    if (track) this.startFileTrack(track);
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
      volume: this.getMusicVolume(),
      fadeInMs: this.getMix().fileFadeInMs
    });
  }

  /** Starts the chosen file track if it could not start earlier because the context was not running. */
  private startFileTrackIfWaiting(): void {
    if (!this.musicEnabled || this.pausedWhileHidden || this.filePlayer.isActive()) return;
    const track = this.getActiveTrack();
    if (track) this.startFileTrack(track);
  }

  public stopMusicLoop(): void {
    this.filePlayer.dispose();
    this.disarmFileRetry();
  }
}

export const AudioManager = new AudioService();
