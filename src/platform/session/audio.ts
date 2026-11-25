import type { SoundEventKind } from '../games/contracts';

/**
 * 轻量级程序化 Web Audio 音效合成器：无需外部音频文件，
 * 支持静音开关及 ±8% 音高微调，在无音频设备或无头环境中安全降级。
 */
class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  play(kind: SoundEventKind): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pitchJitter = 0.92 + Math.random() * 0.16;

    switch (kind) {
      case 'fire_normal':
        this.tone(ctx, now, 'triangle', 260 * pitchJitter, 110 * pitchJitter, 0.085, 0.13);
        break;
      case 'fire_shotgun':
        this.tone(ctx, now, 'sawtooth', 220 * pitchJitter, 70, 0.14, 0.16);
        this.noiseBurst(ctx, now, 0.1, 0.12);
        break;
      case 'fire_laser':
        this.tone(ctx, now, 'sine', 960 * pitchJitter, 340, 0.18, 0.14);
        this.tone(ctx, now, 'triangle', 1420 * pitchJitter, 580, 0.14, 0.07);
        break;
      case 'fire_homing':
        this.tone(ctx, now, 'sawtooth', 320, 620, 0.16, 0.1);
        break;
      case 'fire_frag':
        this.tone(ctx, now, 'square', 200 * pitchJitter, 95, 0.13, 0.11);
        break;
      case 'place_mine':
        this.tone(ctx, now, 'sine', 420, 260, 0.09, 0.12);
        break;
      case 'bounce':
        this.tone(ctx, now, 'sine', 540 * pitchJitter, 420 * pitchJitter, 0.045, 0.055);
        break;
      case 'cancel_bullet':
        this.tone(ctx, now, 'triangle', 680 * pitchJitter, 240, 0.06, 0.08);
        break;
      case 'pickup':
        this.tone(ctx, now, 'sine', 520, 780, 0.1, 0.12);
        this.tone(ctx, now + 0.07, 'sine', 780, 1040, 0.11, 0.1);
        break;
      case 'shield_break':
        this.tone(ctx, now, 'sawtooth', 620, 180, 0.18, 0.14);
        this.noiseBurst(ctx, now, 0.12, 0.1);
        break;
      case 'explosion':
        this.tone(ctx, now, 'sawtooth', 140, 38, 0.28, 0.22);
        this.noiseBurst(ctx, now, 0.24, 0.18);
        break;
      case 'countdown_tick':
        this.tone(ctx, now, 'sine', 520, 520, 0.07, 0.09);
        break;
      case 'countdown_go':
        this.tone(ctx, now, 'triangle', 740, 980, 0.16, 0.13);
        break;
      case 'round_win':
        this.tone(ctx, now, 'triangle', 523.25, 523.25, 0.12, 0.12);
        this.tone(ctx, now + 0.1, 'triangle', 659.25, 659.25, 0.14, 0.12);
        this.tone(ctx, now + 0.2, 'triangle', 783.99, 783.99, 0.22, 0.13);
        break;
      case 'round_draw':
        this.tone(ctx, now, 'sine', 392, 349.23, 0.24, 0.11);
        break;
      case 'match_win':
        this.tone(ctx, now, 'triangle', 523.25, 523.25, 0.12, 0.13);
        this.tone(ctx, now + 0.11, 'triangle', 659.25, 659.25, 0.12, 0.13);
        this.tone(ctx, now + 0.22, 'triangle', 783.99, 783.99, 0.14, 0.13);
        this.tone(ctx, now + 0.34, 'triangle', 1046.5, 1046.5, 0.32, 0.14);
        break;
    }
  }

  private tone(
    ctx: AudioContext,
    startTime: number,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    duration: number,
    gainPeak: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freqStart), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), startTime + duration);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private noiseBurst(ctx: AudioContext, startTime: number, duration: number, gainPeak: number): void {
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, startTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(startTime);
  }
}

export const soundEngine = new ProceduralAudio();
