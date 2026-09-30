// All sound is synthesized here. Timing is always expressed in AudioContext seconds.
import type { Kit } from '../game/defs';

export type Inst =
  | 'kick' | 'hat' | 'clap' | 'bass' | 'pad' | 'stab' | 'lead' | 'bell' | 'choir' | 'crash' | 'roll' | 'call';

export interface Voice {
  inst: Inst;
  midi: number[];
  vel: number;
  /** Seconds, for sustained voices. */
  dur: number;
  drop?: boolean;
  open?: boolean;
  octave?: boolean;
  echo?: boolean;
  pan?: number;
  /** 0..1, instrument-specific brightness (rolls rise, heavy kicks). */
  bright?: number;
  kit?: Kit;
}

export type UiSound = 'buy' | 'unlock' | 'mod' | 'forged' | 'deny' | 'flare' | 'miss';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function tanhCurve(k: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private musicGain: GainNode;
  private sfxGain: GainNode;
  private tape: WaveShaperNode;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private sectionGain: GainNode;
  private drumBus: GainNode;
  private kickDrive: WaveShaperNode;
  private pump: GainNode;
  private pumpBus: GainNode;
  private leadBus: GainNode;
  private fxBus: GainNode;
  private reverbIn: GainNode;
  private delayIn: GainNode;
  private delay: DelayNode;
  private noise: AudioBuffer;
  private analyser: AnalyserNode;
  private scratch: Float32Array<ArrayBuffer>;

  constructor() {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.scratch = new Float32Array(this.analyser.fftSize);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 10;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.012;
    glue.release.value = 0.2;

    this.tape = ctx.createWaveShaper();
    this.tape.oversample = '2x';

    glue.connect(this.tape);
    this.tape.connect(limiter);
    limiter.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain.connect(glue);
    this.sfxGain.connect(glue);

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 20;
    this.hp.Q.value = 0.9;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 18000;
    this.lp.Q.value = 0.6;
    this.hp.connect(this.lp);
    // Arrangement level: grooves sit lower so drops have headroom to jump into.
    this.sectionGain = ctx.createGain();
    this.sectionGain.gain.value = 0.78;
    this.lp.connect(this.sectionGain);
    this.sectionGain.connect(this.musicGain);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.9;
    this.drumBus.connect(this.hp);

    this.kickDrive = ctx.createWaveShaper();
    this.kickDrive.curve = tanhCurve(2.4);
    const kickDriveOut = ctx.createGain();
    kickDriveOut.gain.value = 0.8;
    this.kickDrive.connect(kickDriveOut);
    kickDriveOut.connect(this.drumBus);

    this.pumpBus = ctx.createGain();
    this.pump = ctx.createGain();
    this.pumpBus.connect(this.pump);
    this.pump.connect(this.hp);

    this.leadBus = ctx.createGain();
    this.leadBus.connect(this.hp);

    // Risers and impacts bypass the build filter so they stay huge.
    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 0.9;
    this.fxBus.connect(this.musicGain);

    // Reverb
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverbIn.connect(conv);
    conv.connect(revOut);
    revOut.connect(this.hp);

    // Tempo-synced echo
    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 3200;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;
    this.delayIn.connect(this.delay);
    this.delay.connect(fbFilter);
    fbFilter.connect(fb);
    fb.connect(this.delay);
    fbFilter.connect(delayOut);
    delayOut.connect(this.hp);
    delayOut.connect(this.reverbIn);

    this.noise = this.makeNoise(2);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Seconds between scheduling a sound and hearing it. */
  get outputLatency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    const v = (c.outputLatency ?? 0) + (c.baseLatency ?? 0);
    return Number.isFinite(v) ? Math.min(v, 0.25) : 0;
  }

  resume(): Promise<void> {
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
  }

  suspend(): Promise<void> {
    return this.ctx.state === 'running' ? this.ctx.suspend() : Promise.resolve();
  }

  setVolumes(master: number, music: number, sfx: number, muted: boolean): void {
    const t = this.ctx.currentTime;
    const m = muted ? 0 : master;
    this.master.gain.setTargetAtTime(m * m * 0.95, t, 0.03);
    this.musicGain.gain.setTargetAtTime(music * music, t, 0.03);
    this.sfxGain.gain.setTargetAtTime(sfx * sfx * 0.9, t, 0.03);
  }

  setTempo(bpm: number): void {
    const step = 60 / bpm / 4;
    this.delay.delayTime.setValueAtTime(step * 3, this.ctx.currentTime);
  }

  setTape(on: boolean): void {
    this.tape.curve = on ? tanhCurve(1.6) : null;
  }

  /** Current output level, for diagnostics. */
  levels(): { rms: number; peak: number } {
    this.analyser.getFloatTimeDomainData(this.scratch);
    let sum = 0;
    let peak = 0;
    for (const v of this.scratch) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    return { rms: Math.sqrt(sum / this.scratch.length), peak };
  }

  // ---------------------------------------------------------------- helpers

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const decay = Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.6);
        // darken the tail: a one-pole lowpass whose cutoff falls over time
        const k = 0.55 - 0.45 * (i / len);
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * decay * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return buf;
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const offset = Math.random() * (this.noise.duration - dur - 0.05);
    src.start(t, Math.max(0, offset), dur + 0.02);
    return src;
  }

  private osc(type: OscillatorType, freq: number, t: number, stop: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private send(node: AudioNode, reverb: number, echo = 0): void {
    if (reverb > 0) {
      const g = this.gain(reverb);
      node.connect(g);
      g.connect(this.reverbIn);
    }
    if (echo > 0) {
      const g = this.gain(echo);
      node.connect(g);
      g.connect(this.delayIn);
    }
  }

  private panned(node: AudioNode, pan: number, dest: AudioNode): void {
    if (!pan) {
      node.connect(dest);
      return;
    }
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(dest);
  }

  // ---------------------------------------------------------------- music

  play(v: Voice, t: number): void {
    switch (v.inst) {
      case 'kick': return this.kick(t, v);
      case 'hat': return this.hat(t, v);
      case 'clap': return this.clap(t, v);
      case 'roll': return this.roll(t, v);
      case 'bass': return this.bass(t, v);
      case 'pad': return this.pad(t, v);
      case 'stab': return this.stab(t, v);
      case 'lead': return this.lead(t, v, false);
      case 'call': return this.lead(t, v, true);
      case 'bell': return this.bell(t, v);
      case 'choir': return this.choir(t, v);
      case 'crash': return this.crash(t, v.vel);
    }
  }

  /** Sidechain duck on the pumped bus. */
  pumpAt(t: number, depth: number): void {
    const g = this.pump.gain;
    g.setTargetAtTime(1 - depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.035, 0.085);
  }

  private kick(t: number, v: Voice): void {
    const heavy = !!v.drop;
    const f0 = v.kit === 'break' ? 125 : v.kit === 'anthem' ? 165 : 150;
    const end = t + (heavy ? 0.9 : 0.6);
    const o = this.osc('sine', f0 * (heavy ? 1.15 : 1), t, end);
    o.frequency.exponentialRampToValueAtTime(54, t + 0.055);
    o.frequency.exponentialRampToValueAtTime(heavy ? 37 : 42, t + 0.32);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.05, heavy ? 0.12 + (v.bright ?? 0) * 0.08 : 0.085);
    o.connect(g);
    g.connect(heavy ? this.kickDrive : this.drumBus);

    const click = this.noiseSrc(t, 0.02);
    const hp = this.filter('highpass', 1400);
    const cg = this.gain();
    cg.gain.setValueAtTime(v.vel * 0.3, t);
    cg.gain.setTargetAtTime(0, t, 0.005);
    click.connect(hp);
    hp.connect(cg);
    cg.connect(this.drumBus);
  }

  private hat(t: number, v: Voice): void {
    const open = !!v.open;
    const dur = open ? 0.45 : 0.09;
    const src = this.noiseSrc(t, dur);
    const hp = this.filter('highpass', open ? 6800 : 7800, 0.8);
    const peak = this.filter('peaking', 10500, 1.2);
    peak.gain.value = 5;
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.002, open ? 0.1 : v.drop ? 0.02 : 0.014);
    src.connect(hp);
    hp.connect(peak);
    peak.connect(g);
    this.panned(g, v.pan ?? 0, this.drumBus);
    if (open) this.send(g, 0.1);
  }

  private clap(t: number, v: Voice): void {
    const kit = v.kit ?? 'house';
    const vel = v.vel;
    if (kit !== 'break') {
      // three quick bursts and a tail: a clap
      const src = this.noiseSrc(t, 0.45);
      const bp = this.filter('bandpass', v.drop ? 1500 : 1250, 1.1);
      const g = this.gain();
      g.gain.setValueAtTime(0, t);
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.0105;
        g.gain.setValueAtTime(vel * (0.8 + k * 0.1), tk);
        g.gain.setTargetAtTime(vel * 0.1, tk + 0.0005, 0.0035);
      }
      g.gain.setValueAtTime(vel, t + 0.032);
      g.gain.setTargetAtTime(0, t + 0.033, 0.055);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.drumBus);
      this.send(g, 0.28, v.echo ? 0.35 : 0);
    }
    if (kit !== 'house') {
      // a snare body under (breaks) or layered in (anthem)
      const body = this.osc('triangle', 195, t, t + 0.2);
      body.frequency.exponentialRampToValueAtTime(150, t + 0.05);
      const bg = this.gain();
      bg.gain.setValueAtTime(vel * 0.55, t);
      bg.gain.setTargetAtTime(0, t, 0.045);
      body.connect(bg);
      bg.connect(this.drumBus);
      const src = this.noiseSrc(t, 0.3);
      const hp = this.filter('highpass', 1700, 0.7);
      const ng = this.gain();
      ng.gain.setValueAtTime(vel * (kit === 'break' ? 0.75 : 0.4), t);
      ng.gain.setTargetAtTime(0, t, kit === 'break' ? 0.06 : 0.05);
      src.connect(hp);
      hp.connect(ng);
      ng.connect(this.drumBus);
      this.send(ng, 0.2, v.echo ? 0.3 : 0);
    }
  }

  private roll(t: number, v: Voice): void {
    const b = v.bright ?? 0;
    const src = this.noiseSrc(t, 0.2);
    const bp = this.filter('bandpass', 1300 + b * 3200, 0.9);
    const g = this.gain();
    g.gain.setValueAtTime(v.vel, t);
    g.gain.setTargetAtTime(0, t, 0.04 + b * 0.02);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.fxBus);
    this.send(g, 0.25);
    const body = this.osc('triangle', 180 + b * 260, t, t + 0.12);
    const bg = this.gain();
    bg.gain.setValueAtTime(v.vel * 0.4, t);
    bg.gain.setTargetAtTime(0, t, 0.03);
    body.connect(bg);
    bg.connect(this.fxBus);
  }

  private bass(t: number, v: Voice): void {
    const f = mtof(v.midi[0]);
    const drop = !!v.drop;
    const end = t + v.dur + 0.25;
    const lp = this.filter('lowpass', drop ? 2600 : 1150, drop ? 7 : 4.5);
    lp.frequency.setValueAtTime(drop ? 2600 : 1150, t);
    lp.frequency.setTargetAtTime(drop ? 620 : 300, t + 0.004, drop ? 0.09 : 0.075);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.004);
    g.gain.setTargetAtTime(v.vel * 0.72, t + 0.02, 0.1);
    g.gain.setTargetAtTime(0, t + v.dur, 0.025);
    const o1 = this.osc('sawtooth', f, t, end);
    o1.connect(lp);
    if (drop) {
      const o2 = this.osc('sawtooth', f, t, end, 14);
      const o3 = this.osc('square', f / 2, t, end);
      const g3 = this.gain(0.35);
      o2.connect(lp);
      o3.connect(g3);
      g3.connect(lp);
    }
    lp.connect(g);
    const sub = this.osc('sine', f, t, end);
    const sg = this.gain(0.75);
    sub.connect(sg);
    sg.connect(g);
    g.connect(this.pumpBus);
  }

  private pad(t: number, v: Voice): void {
    const drop = !!v.drop;
    const end = t + v.dur + 1.4;
    const lp = this.filter('lowpass', drop ? 3400 : 1700, 0.6);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + (drop ? 0.03 : 0.2));
    g.gain.setTargetAtTime(0, t + v.dur, 0.28);
    const dets = drop ? [-14, -5, 5, 14] : [-8, 8];
    for (const m of v.midi) {
      for (const d of dets) {
        const o = this.osc('sawtooth', mtof(m), t, end, d);
        o.connect(lp);
      }
    }
    lp.connect(g);
    g.connect(this.pumpBus);
    this.send(g, drop ? 0.25 : 0.4);
  }

  private stab(t: number, v: Voice): void {
    const drop = !!v.drop;
    const end = t + 0.7;
    const lp = this.filter('lowpass', drop ? 5200 : 3600, 3);
    lp.frequency.setTargetAtTime(drop ? 1300 : 850, t + 0.003, 0.07);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.01, drop ? 0.13 : 0.09);
    for (const m of v.midi) {
      this.osc('sawtooth', mtof(m), t, end, -6).connect(lp);
      this.osc('square', mtof(m), t, end, 6).connect(lp);
      if (drop) this.osc('sawtooth', mtof(m + 12), t, end, 9).connect(lp);
    }
    lp.connect(g);
    g.connect(this.pumpBus);
    this.send(g, 0.22);
  }

  private lead(t: number, v: Voice, call: boolean): void {
    const m = v.midi[0];
    const f = mtof(m);
    const drop = !!v.drop;
    const end = t + v.dur + 0.4;
    const lp = this.filter('lowpass', drop ? 7000 : call ? 2600 : 5200, call ? 1 : 2.5);
    lp.frequency.setTargetAtTime(drop ? 2400 : call ? 1400 : 1600, t + 0.004, 0.12);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.005);
    g.gain.setTargetAtTime(v.vel * 0.6, t + 0.02, 0.12);
    g.gain.setTargetAtTime(0, t + v.dur, 0.06);
    if (call) {
      this.osc('sawtooth', f, t, end, -7).connect(lp);
      this.osc('sawtooth', f, t, end, 7).connect(lp);
    } else {
      this.osc('square', f, t, end).connect(lp);
      this.osc('sawtooth', f, t, end, 6).connect(lp);
      if (drop) {
        this.osc('sawtooth', f, t, end, -13).connect(lp);
        const hi = this.gain(0.4);
        this.osc('sawtooth', f * 2, t, end, 4).connect(hi);
        hi.connect(lp);
      }
      if (v.octave) {
        const og = this.gain(0.45);
        this.osc('square', f * 2, t, end, -3).connect(og);
        og.connect(lp);
      }
    }
    lp.connect(g);
    g.connect(this.leadBus);
    this.send(g, call ? 0.45 : 0.22, v.echo ? 0.4 : 0);
  }

  private bell(t: number, v: Voice): void {
    const f = mtof(v.midi[0]);
    const end = t + 2.2;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f * 3.5, t, end);
    const mg = this.gain();
    mg.gain.setValueAtTime(f * (v.drop ? 3 : 2.2), t);
    mg.gain.setTargetAtTime(f * 0.15, t, 0.22);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v.vel, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.003, v.drop ? 0.3 : 0.42);
    car.connect(g);
    this.panned(g, v.pan ?? 0, this.leadBus);
    this.send(g, 0.35, v.echo ? 0.32 : 0);
  }

  private choir(t: number, v: Voice): void {
    const end = t + v.dur + 2.2;
    const lfo = this.osc('sine', 5.1, t, end);
    const lfoG = this.gain(7);
    lfo.connect(lfoG);
    const mix = this.gain(1);
    for (const m of v.midi) {
      for (const d of [-9, 9]) {
        const o = this.osc('sawtooth', mtof(m), t, end, d);
        lfoG.connect(o.detune);
        o.connect(mix);
      }
    }
    const f1 = this.filter('bandpass', 720, 5);
    const f2 = this.filter('bandpass', 1120, 6);
    const f3 = this.filter('bandpass', 2600, 7);
    const g3 = this.gain(0.35);
    const g = this.gain();
    mix.connect(f1);
    mix.connect(f2);
    mix.connect(f3);
    f3.connect(g3);
    f1.connect(g);
    f2.connect(g);
    g3.connect(g);
    const out = this.gain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(v.vel, t + (v.dur < 0.5 ? 0.04 : 0.32));
    out.gain.setTargetAtTime(0, t + v.dur, v.dur < 0.5 ? 0.12 : 0.45);
    g.connect(out);
    out.connect(this.leadBus);
    this.send(out, 0.55);
  }

  private crash(t: number, vel: number): void {
    const src = this.noiseSrc(t, 2.6);
    const hp = this.filter('highpass', 4200, 0.6);
    const pk = this.filter('peaking', 7600, 2);
    pk.gain.value = 6;
    const g = this.gain();
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t, 0.55);
    src.connect(hp);
    hp.connect(pk);
    pk.connect(g);
    g.connect(this.drumBus);
    this.send(g, 0.2);
  }

  // ---------------------------------------------------------------- arrangement fx

  /** Filter sweep, riser and swell for a build between t0 and the drop at t1. */
  build(t0: number, t1: number, size: number): void {
    const hp = this.hp.frequency;
    hp.cancelScheduledValues(t0);
    hp.setValueAtTime(20, t0);
    hp.exponentialRampToValueAtTime(420 + 300 * size, t1 - 0.02);
    hp.setValueAtTime(20, t1);
    const lp = this.lp.frequency;
    lp.cancelScheduledValues(t0);
    lp.setValueAtTime(18000, t0);

    const len = t1 - t0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t0);
    src.stop(t1);
    const bp = this.filter('bandpass', 300, 2.5);
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(7500, t1);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 + 0.08 * size, t1 - 0.01);
    g.gain.setValueAtTime(0, t1);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.fxBus);
    this.send(g, 0.2);

    const saw = this.osc('sawtooth', 110, t0, t1);
    saw.frequency.exponentialRampToValueAtTime(110 * Math.pow(2, 2 + size), t1);
    const sl = this.filter('lowpass', 1800, 1);
    const sg = this.gain();
    sg.gain.setValueAtTime(0, t0);
    sg.gain.linearRampToValueAtTime(0.045, t1 - len * 0.1);
    sg.gain.setValueAtTime(0, t1);
    saw.connect(sl);
    sl.connect(sg);
    sg.connect(this.fxBus);
  }

  /** The hit that lands on the first beat of a drop. */
  impact(t: number, size: number): void {
    const sub = this.osc('sine', 95, t, t + 2.4);
    sub.frequency.exponentialRampToValueAtTime(31, t + 1.2);
    const sg = this.gain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.75 * size, t + 0.004);
    sg.gain.setTargetAtTime(0, t + 0.05, 0.45);
    sub.connect(sg);
    sg.connect(this.fxBus);

    const src = this.noiseSrc(t, 1.2);
    const lp = this.filter('lowpass', 500, 0.8);
    lp.frequency.setTargetAtTime(120, t, 0.25);
    const ng = this.gain();
    ng.gain.setValueAtTime(0.5 * size, t);
    ng.gain.setTargetAtTime(0, t, 0.22);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.fxBus);
    this.send(ng, 0.4);
    this.crash(t, 0.32 + 0.1 * size);
  }

  /** Close the lowpass and open it again: a breath after the drop. */
  breathe(t0: number, t1: number): void {
    const lp = this.lp.frequency;
    lp.cancelScheduledValues(t0);
    lp.setValueAtTime(600, t0);
    lp.exponentialRampToValueAtTime(18000, t1);
    const hp = this.hp.frequency;
    hp.cancelScheduledValues(t0);
    hp.setValueAtTime(20, t0);
  }

  /** Move the arrangement level to `level`, arriving at t1 (a step at t0 when t1 is omitted). */
  sectionLevel(t0: number, level: number, t1?: number): void {
    const g = this.sectionGain.gain;
    g.cancelScheduledValues(t0);
    if (t1 === undefined) {
      g.setValueAtTime(level, t0);
    } else {
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(level, t1);
    }
  }

  resetFilters(): void {
    const t = this.ctx.currentTime;
    for (const p of [this.hp.frequency, this.lp.frequency]) p.cancelScheduledValues(t);
    this.hp.frequency.setValueAtTime(20, t);
    this.lp.frequency.setValueAtTime(18000, t);
    this.pump.gain.cancelScheduledValues(t);
    this.pump.gain.setValueAtTime(1, t);
    this.sectionGain.gain.cancelScheduledValues(t);
    this.sectionGain.gain.setValueAtTime(0.78, t);
  }

  // ---------------------------------------------------------------- player + ui

  /** The anvil the player strikes. Always immediate. */
  strike(midi: number, judge: 'perfect' | 'good' | 'miss'): void {
    const t = this.ctx.currentTime + 0.002;
    if (judge === 'miss') {
      const o = this.osc('sine', 110, t, t + 0.2);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      const g = this.gain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.setTargetAtTime(0, t, 0.04);
      o.connect(g);
      g.connect(this.sfxGain);
      return;
    }
    const perfect = judge === 'perfect';
    const f = mtof(midi);
    const end = t + 1.6;
    const car = this.osc('sine', f, t, end);
    const mod = this.osc('sine', f * 2.76, t, end);
    const mg = this.gain();
    mg.gain.setValueAtTime(f * (perfect ? 2.6 : 1.5), t);
    mg.gain.setTargetAtTime(f * 0.1, t, 0.09);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(perfect ? 0.3 : 0.2, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.004, perfect ? 0.32 : 0.2);
    car.connect(g);
    if (perfect) {
      const hi = this.osc('sine', f * 2, t, t + 0.8);
      const hg = this.gain();
      hg.gain.setValueAtTime(0.09, t);
      hg.gain.setTargetAtTime(0, t, 0.18);
      hi.connect(hg);
      hg.connect(g);
    }
    const tick = this.noiseSrc(t, 0.03);
    const hp = this.filter('highpass', 3500);
    const tg = this.gain();
    tg.gain.setValueAtTime(0.12, t);
    tg.gain.setTargetAtTime(0, t, 0.008);
    tick.connect(hp);
    hp.connect(tg);
    tg.connect(this.sfxGain);
    g.connect(this.sfxGain);
    this.send(g, 0.25);
  }

  ui(kind: UiSound, midi = 72): void {
    const t = this.ctx.currentTime + 0.005;
    const bell = (m: number, at: number, vel: number, decay: number) => {
      const f = mtof(m);
      const car = this.osc('sine', f, at, at + decay * 6);
      const mod = this.osc('sine', f * 4, at, at + decay * 6);
      const mg = this.gain();
      mg.gain.setValueAtTime(f * 1.4, at);
      mg.gain.setTargetAtTime(0, at, decay * 0.6);
      mod.connect(mg);
      mg.connect(car.frequency);
      const g = this.gain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vel, at + 0.002);
      g.gain.setTargetAtTime(0, at + 0.003, decay);
      car.connect(g);
      g.connect(this.sfxGain);
      this.send(g, 0.3);
    };
    switch (kind) {
      case 'buy':
        bell(midi, t, 0.14, 0.12);
        bell(midi + 12, t + 0.03, 0.06, 0.08);
        break;
      case 'unlock':
        [0, 4, 7, 12].forEach((d, i) => bell(midi + d, t + i * 0.06, 0.12, 0.3));
        break;
      case 'mod':
        [0, 7, 12, 16, 19].forEach((d, i) => bell(midi + d, t + i * 0.045, 0.1, 0.35));
        break;
      case 'forged':
        [0, 4, 7, 12, 16, 19, 24].forEach((d, i) => bell(midi + d, t + i * 0.035, 0.09, 0.4));
        break;
      case 'flare':
        bell(midi + 24, t, 0.14, 0.5);
        bell(midi + 31, t + 0.05, 0.1, 0.5);
        bell(midi + 36, t + 0.1, 0.07, 0.6);
        break;
      case 'deny': {
        const o = this.osc('triangle', 92, t, t + 0.15);
        const g = this.gain();
        g.gain.setValueAtTime(0.12, t);
        g.gain.setTargetAtTime(0, t, 0.03);
        o.connect(g);
        g.connect(this.sfxGain);
        break;
      }
      case 'miss': {
        const src = this.noiseSrc(t, 0.3);
        const bp = this.filter('bandpass', 2400, 3);
        bp.frequency.setTargetAtTime(500, t, 0.08);
        const g = this.gain();
        g.gain.setValueAtTime(0.06, t);
        g.gain.setTargetAtTime(0, t, 0.08);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.sfxGain);
        break;
      }
    }
  }
}
