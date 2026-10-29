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

class AudioService {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private musicEnabled: boolean = false;
  private musicTimerId: number | null = null;
  private musicStepIndex: number = 0;
  private activeTrackIndex: number = 0;

  private ensureContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
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
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) {
      this.startMusicLoop();
    } else {
      this.stopMusicLoop();
    }
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

  public playSfx(effectId: string): void {
    if (!this.sfxEnabled) return;
    const audioCfg = ConfigRegistry.getAudio();
    const effect = audioCfg.effects[effectId];
    if (!effect) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    let offsetSec = ctx.currentTime;
    for (const note of effect.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = effect.waveform;
      osc.frequency.setValueAtTime(note.freq, offsetSec);

      const durationSec = note.durationMs / 1000;
      const peakGain = note.gain * audioCfg.masterVolume * audioCfg.sfxVolume;

      gain.gain.setValueAtTime(peakGain, offsetSec);
      gain.gain.exponentialRampToValueAtTime(0.001, offsetSec + durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(offsetSec);
      osc.stop(offsetSec + durationSec);
      offsetSec += durationSec;
    }
  }

  public setTrackById(trackId: string): void {
    const tracks = ConfigRegistry.getAudio().tracks;
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
    const tracks = ConfigRegistry.getAudio().tracks;
    if (!tracks || tracks.length === 0) return 'cyber_pulse';
    this.activeTrackIndex = (this.activeTrackIndex + 1) % tracks.length;
    this.musicStepIndex = 0;
    if (this.musicEnabled) {
      this.startMusicLoop();
    }
    return tracks[this.activeTrackIndex].id;
  }

  private startMusicLoop(): void {
    this.stopMusicLoop();
    const audioCfg = ConfigRegistry.getAudio();
    const activeTrack = audioCfg.tracks?.[this.activeTrackIndex] || audioCfg.music;
    this.musicTimerId = window.setInterval(() => {
      if (!this.musicEnabled) return;
      const ctx = this.ensureContext();
      if (!ctx) return;

      const { leadNotes, bassNotes, leadWaveform, bassWaveform, stepDurationMs } = activeTrack;
      const leadFreq = leadNotes[this.musicStepIndex % leadNotes.length];
      const bassFreq = bassNotes[this.musicStepIndex % bassNotes.length];
      const durSec = (stepDurationMs * 0.85) / 1000;
      const now = ctx.currentTime;

      if (leadFreq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = leadWaveform;
        osc.frequency.setValueAtTime(leadFreq, now);
        const peak = audioCfg.masterVolume * audioCfg.musicVolume * 0.45;
        gain.gain.setValueAtTime(peak, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + durSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + durSec);
      }

      if (bassFreq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = bassWaveform;
        osc.frequency.setValueAtTime(bassFreq, now);
        const peak = audioCfg.masterVolume * audioCfg.musicVolume * 0.35;
        gain.gain.setValueAtTime(peak, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + durSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + durSec);
      }

      this.musicStepIndex++;
    }, activeTrack.stepDurationMs);
  }

  public stopMusicLoop(): void {
    if (this.musicTimerId !== null) {
      clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
  }
}

export const AudioManager = new AudioService();
