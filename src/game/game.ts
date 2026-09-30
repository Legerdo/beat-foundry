import { AudioEngine, type UiSound } from '../audio/engine';
import { arrangeStep, chordMidis, chordRoot, isDropSection, type NoteEv } from '../audio/music';
import { Transport } from '../audio/transport';
import { HEAT_MAX, LAYERS, METAS, MOD_BY_ID, MODS, TRACKS, type ModDef } from './defs';
import {
  AUTO_CHARGE, FLARE_HEAT, HEAT_PER_BAR, HEAT_PER_KICK, HEAT_PER_STRIKE, autoCatchShare,
  barDuration, canCast, castCost, cheapestNote, dropBars, dropMult, dropPower, flareInterval, flareReward,
  goldForCast, hasMod, heatMult, isForged, metaCost, metaLevel, modAvailable, modCost, newRun, noteCost,
  noteValue, perSecond, strikeReward, timingWindows, trackOf,
} from './economy';
import { defaultMeta, defaultStats, writeSave, writeSettings, type SaveData } from './save';
import type { Judge, LayerId, MetaId, MetaState, ModId, RunState, Section, Settings, Stats } from './types';

export interface BarInfo {
  time: number;
  index: number;
  track: number;
  section: Section;
  sectionBar: number;
  sectionLen: number;
  prog: number;
  phrase: number;
  transpose: number;
  root: number;
  /** Spark multiplier for this bar (drop power while dropping). */
  mult: number;
  /** Set on the first bar of a section. */
  started: boolean;
}

export interface ChargeTarget {
  time: number;
  step: number;
  judged: Judge | null;
}

export interface Flare {
  layer: LayerId;
  socket: number;
  step: number;
  time: number;
  born: number;
}

export interface CastResult {
  gold: number;
  track: number;
  firstTime: boolean;
  finale: boolean;
}

/** Everything that wants to react to the game: renderer, HUD. All methods optional. */
export interface Fx {
  note?(layer: LayerId, socket: number, value: number, drop: boolean, echo: boolean): void;
  bar?(info: BarInfo): void;
  section?(info: BarInfo): void;
  strike?(judge: Judge, value: number, dt: number, kind: 'beat' | 'charge' | 'flare'): void;
  purchase?(layer: LayerId, socket: number, first: boolean): void;
  forged?(layer: LayerId): void;
  mod?(m: ModDef): void;
  flareSpawn?(f: Flare): void;
  flareCatch?(f: Flare, value: number, auto: boolean): void;
  flareMiss?(f: Flare): void;
  chargeMiss?(t: ChargeTarget): void;
  chargeHit?(t: ChargeTarget): void;
  castStart?(): void;
  castDone?(r: CastResult): void;
  trackStart?(track: number): void;
  offline?(gain: number, seconds: number): void;
  deny?(): void;
}

type Timed =
  | { kind: 'note'; time: number; ev: NoteEv; value: number; drop: boolean }
  | { kind: 'bar'; time: number; info: BarInfo };

const MAX_OFFLINE = 4 * 3600;
const SWING = 0.3; // fraction of a 16th the off-steps are delayed by

export type DebugAction = 'sparksSmall' | 'sparksLarge' | 'castBudget' | 'heat' | 'forge' | 'mods' | 'gold';

export class Game {
  run: RunState;
  meta: MetaState;
  stats: Stats;
  settings: Settings;
  hints: Set<string>;

  engine: AudioEngine | null = null;
  transport: Transport | null = null;
  readonly fx: Fx[] = [];

  started = false;
  muted = false;
  casting = false;
  pourQueued = false;
  castQueued = false;
  castResult: CastResult | null = null;

  /** The bar currently being heard. */
  audible: BarInfo;
  groove = 0;
  targets: ChargeTarget[] = [];
  lastCharge = 0;
  flare: Flare | null = null;

  private sched = {
    section: 'groove' as Section,
    sectionBar: 0,
    sectionLen: 1,
    grooveBar: 0,
    crash: false,
    mult: 1,
    info: null as BarInfo | null,
  };
  private queue: Timed[] = [];
  private dueScratch: Timed[] = [];
  private lastStruckBeat = -999;
  private lastBeatSeen = -1;
  private stagger = 0;
  private nextFlareAt = 0;
  private saveTimer = 0;
  private dirty = false;
  private apprenticeTimer = 0;
  private hiddenAt = 0;
  private hiddenPaused = false;
  private settingsPaused = false;
  private focusPaused = false;
  private pausedTime = 0;
  private audioTransition = Promise.resolve();
  private pendingOffline = 0;
  private goodStrikes = 0;

  constructor(save: SaveData | null, settings: Settings) {
    this.meta = save?.meta ?? defaultMeta();
    this.run = save?.run ?? newRun(0, this.meta);
    this.stats = save?.stats ?? defaultStats();
    this.hints = new Set(save?.hints ?? []);
    this.settings = settings;
    this.audible = this.initialInfo(0);
    if (save) this.pendingOffline = Math.min(MAX_OFFLINE, Math.max(0, (Date.now() - save.time) / 1000));
  }

  get track() {
    return trackOf(this.run);
  }

  get barDur(): number {
    return barDuration(this.track);
  }

  // ------------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.started) return;
    this.engine = new AudioEngine();
    await this.engine.resume();
    this.transport = new Transport(this.engine.ctx, (i, t) => this.onStep(i, t));
    this.applyVolumes();
    this.started = true;
    this.beginTrackAudio();
    this.syncAudioState();
    if (this.pendingOffline > 10) this.grantOffline(this.pendingOffline);
    this.pendingOffline = 0;
  }

  private beginTrackAudio(): void {
    const e = this.engine!;
    e.resetFilters();
    e.setTempo(this.track.bpm);
    e.setTape(hasMod(this.run, 'tape'));
    this.sched = { section: 'groove', sectionBar: 0, sectionLen: 1, grooveBar: 0, crash: false, mult: 1, info: null };
    this.queue = [];
    this.targets = [];
    this.flare = null;
    this.groove = 0;
    this.lastStruckBeat = -999;
    this.lastBeatSeen = -1;
    this.audible = this.initialInfo(this.run.track);
    this.transport!.start(this.track.bpm);
    if (this.paused) this.transport!.stop();
    this.nextFlareAt = e.now + 26;
  }

  private initialInfo(track: number): BarInfo {
    const t = TRACKS[track];
    return {
      time: 0, index: -1, track, section: 'groove', sectionBar: 0, sectionLen: 1, prog: 0, phrase: 0,
      transpose: 0, root: t.progression[0], mult: 1, started: false,
    };
  }

  applyVolumes(): void {
    const s = this.settings;
    this.engine?.setVolumes(s.master, s.music, s.sfx, this.muted);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    writeSettings(s);
    this.applyVolumes();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyVolumes();
  }

  get paused(): boolean {
    return this.settingsPaused || this.focusPaused || this.hiddenAt > 0;
  }

  setFocused(focused: boolean): void {
    const paused = !focused;
    if (this.focusPaused === paused) return;
    if (paused && !this.paused) this.pausedTime = this.heardTime;
    this.focusPaused = paused;
    this.syncAudioState();
  }

  setPaused(paused: boolean): void {
    if (this.settingsPaused === paused) return;
    if (paused && !this.paused) this.pausedTime = this.heardTime;
    this.settingsPaused = paused;
    this.syncAudioState();
  }

  /** Serialize suspend/resume so a quick close cannot leave a late suspend behind. */
  private syncAudioState(): void {
    if (!this.started) return;
    if (this.paused) this.transport!.stop();
    this.audioTransition = this.audioTransition.then(async () => {
      if (this.paused) await this.engine!.suspend();
      else {
        await this.engine!.resume();
        if (!this.paused) this.transport!.resume();
      }
    });
  }

  onHidden(): void {
    this.save();
    if (!this.started) return;
    this.hiddenPaused = this.settingsPaused;
    if (!this.paused) this.pausedTime = this.heardTime;
    this.hiddenAt = Date.now();
    this.syncAudioState();
  }

  onVisible(): void {
    if (!this.started || !this.hiddenAt) return;
    const away = (Date.now() - this.hiddenAt) / 1000;
    this.hiddenAt = 0;
    this.syncAudioState();
    // Tab-away income is an existing feature; visible focus loss itself earns nothing.
    if (away > 10 && !this.casting && !this.hiddenPaused && !this.settingsPaused) this.grantOffline(Math.min(MAX_OFFLINE, away));
  }

  private grantOffline(seconds: number): void {
    const gain = perSecond(this.run, this.meta) * seconds;
    if (gain <= 0) return;
    this.earn(gain);
    for (const f of this.fx) f.offline?.(gain, seconds);
  }

  // ------------------------------------------------------------------ time

  /** Audio time the player is hearing right now. */
  get heardTime(): number {
    if (this.paused) return this.pausedTime;
    const e = this.engine;
    return e ? e.now - e.outputLatency : 0;
  }

  /** Fractional global step being heard. */
  get heardStep(): number {
    return this.transport ? this.transport.stepAt(this.heardTime) : 0;
  }

  private swingOffset(step: number): number {
    return hasMod(this.run, 'swing') && step % 2 === 1 ? SWING * this.transport!.stepDur : 0;
  }

  // ------------------------------------------------------------------ scheduling (runs ahead of audio)

  private onStep(i: number, time: number): void {
    const step = i % 16;
    if (step === 0) this.beginBar(i / 16, time);
    const s = this.sched;
    if (s.section === 'end' || !s.info) return;
    const e = this.engine!;
    const run = this.run;
    const drop = isDropSection(s.section);
    const evs = arrangeStep({
      track: this.track, notes: run.notes, mods: run.mods, section: s.section, sectionBar: s.sectionBar,
      sectionLen: s.sectionLen, prog: s.info.prog, phrase: s.info.phrase, step, stepDur: this.transport!.stepDur,
      transpose: s.info.transpose, crash: s.crash,
    });
    const swing = this.swingOffset(step);
    const side = hasMod(run, 'sidechain');
    for (const ev of evs) {
      const at = time + swing + ev.offset;
      if (ev.voice) e.play(ev.voice, at);
      if (ev.kick && (side || drop)) e.pumpAt(at, side ? 0.68 : 0.32);
      if (ev.target) this.targets.push({ time: at, step, judged: null });
      const value = ev.layer && ev.earn > 0 ? noteValue(run, this.meta, ev.layer) * ev.earn * s.mult : 0;
      this.queue.push({ kind: 'note', time: at, ev, value, drop });
    }
  }

  private beginBar(bar: number, time: number): void {
    const s = this.sched;
    const t = this.track;
    const prev = s.section;
    s.crash = false;
    if (bar === 0) {
      s.section = 'groove';
      s.sectionBar = 0;
      s.sectionLen = 1;
      s.grooveBar = 0;
    } else {
      switch (s.section) {
        case 'groove':
          if (this.castQueued) {
            this.castQueued = false;
            this.pourQueued = false;
            this.enter('castbuild', 4);
          } else if (this.pourQueued) {
            this.pourQueued = false;
            this.enter('build', 2);
          } else {
            s.grooveBar++;
          }
          break;
        case 'build':
        case 'castbuild':
          if (++s.sectionBar >= s.sectionLen) {
            const cast = s.section === 'castbuild';
            this.enter(cast ? 'finale' : 'drop', cast ? t.castDropBars : dropBars(this.meta));
            this.computeDrop(cast);
          }
          break;
        case 'drop':
          if (++s.sectionBar >= s.sectionLen) this.enter('break', 1);
          break;
        case 'break':
          if (++s.sectionBar >= s.sectionLen) {
            this.enter('groove', 1);
            s.grooveBar = 0;
            s.crash = true;
          }
          break;
        case 'finale':
          if (++s.sectionBar >= s.sectionLen) this.enter('outro', 2);
          break;
        case 'outro':
          if (++s.sectionBar >= s.sectionLen) this.enter('end', 1);
          break;
        case 'end':
          s.sectionBar++;
          break;
      }
    }
    const started = bar === 0 || s.section !== prev;
    if (s.section === 'groove' && s.grooveBar > 0 && s.grooveBar % 8 === 0) s.crash = true;

    let prog = 0;
    let phrase = 0;
    switch (s.section) {
      case 'groove':
        prog = s.grooveBar % 4;
        phrase = s.grooveBar % 8;
        break;
      case 'build':
      case 'castbuild':
        prog = s.sectionLen === 2 ? 2 + s.sectionBar : s.sectionBar % 4;
        break;
      case 'drop':
      case 'finale':
        prog = s.sectionBar % 4;
        phrase = s.sectionBar % 8;
        break;
      default:
        prog = 0;
    }
    let transpose = 0;
    if (s.section === 'drop' && hasMod(this.run, 'keychange')) transpose = 2;
    if (t.index === TRACKS.length - 1 && ((s.section === 'finale' && s.sectionBar >= 8) || s.section === 'outro')) transpose = 2;
    const info: BarInfo = {
      time, index: bar, track: t.index, section: s.section, sectionBar: s.sectionBar, sectionLen: s.sectionLen,
      prog, phrase, transpose, root: chordRoot(t, prog), mult: isDropSection(s.section) ? s.mult : 1, started,
    };
    s.info = info;

    const e = this.engine!;
    const bd = this.barDur;
    if (started) {
      if (s.section === 'build' || s.section === 'castbuild') {
        this.targets = [];
        e.build(time, time + s.sectionLen * bd, s.section === 'castbuild' ? 1 : 0.4);
        e.sectionLevel(time, 0.92, time + s.sectionLen * bd - 0.05);
      } else if (s.section === 'drop' || s.section === 'finale') {
        e.impact(time, s.section === 'finale' ? 1.25 : 1);
        e.sectionLevel(time, 1);
      } else if (s.section === 'break') {
        e.breathe(time, time + bd * 1.1);
        e.sectionLevel(time, 0.78, time + bd);
      } else if (s.section === 'groove') {
        e.sectionLevel(time, 0.78);
      }
    } else if (s.section === 'finale' && t.index === TRACKS.length - 1 && s.sectionBar === 8) {
      e.impact(time, 1.1); // the key change
    }
    this.queue.push({ kind: 'bar', time, info });
  }

  private enter(section: Section, len: number): void {
    this.sched.section = section;
    this.sched.sectionBar = 0;
    this.sched.sectionLen = len;
  }

  private computeDrop(cast: boolean): void {
    let score = 0;
    for (const tgt of this.targets) {
      if (tgt.judged === 'perfect') score += 1;
      else if (tgt.judged === 'good') score += 0.6;
    }
    const charge = this.targets.length ? score / this.targets.length : 0;
    this.lastCharge = charge;
    const floor = hasMod(this.run, 'autopour') ? AUTO_CHARGE : 0;
    const c = Math.max(charge, floor);
    let power = dropPower(this.run, this.meta);
    if (cast) power *= 1.5;
    this.sched.mult = dropMult(power, c);
    if (!cast) {
      this.run.drops++;
      if (charge >= 0.9) this.run.perfectDrops++;
    }
    this.stats.drops++;
    this.stats.bestDrop = Math.max(this.stats.bestDrop, this.sched.mult);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    if (!this.started || this.paused) return;
    const now = this.heardTime;
    if (!this.hiddenAt) this.stats.playTime += dt;
    const run = this.run;

    // due events, in time order (in-place partition, no per-frame allocation)
    const q = this.queue;
    if (q.length) {
      const due = this.dueScratch;
      let w = 0;
      for (let i = 0; i < q.length; i++) {
        const ev = q[i];
        if (ev.time <= now) due.push(ev);
        else q[w++] = ev;
      }
      q.length = w;
      if (due.length) {
        if (due.length > 1) due.sort((a, b) => a.time - b.time);
        for (let i = 0; i < due.length; i++) this.handle(due[i]);
        due.length = 0;
      }
    }

    const win = timingWindows(run, this.meta);
    for (const tgt of this.targets) {
      if (!tgt.judged && now > tgt.time + win.good) {
        tgt.judged = 'miss';
        for (const f of this.fx) f.chargeMiss?.(tgt);
      }
    }

    // groove decays one step for every beat you let pass
    const beat = Math.floor(this.heardStep / 4);
    if (beat > this.lastBeatSeen) {
      if (this.lastBeatSeen >= 0 && this.lastStruckBeat < beat - 1 && this.groove > 0) this.groove--;
      this.lastBeatSeen = beat;
    }

    this.updateFlare(now);

    if (hasMod(run, 'autopour') && this.canPour()) this.requestPour();

    if (metaLevel(this.meta, 'apprentice') > 0 && run.autoBuy && !this.casting) {
      this.apprenticeTimer -= dt;
      if (this.apprenticeTimer <= 0) {
        this.apprenticeTimer = 0.6;
        const c = cheapestNote(run);
        if (c && c.cost <= run.sparks) this.buyNote(c.layer);
      }
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0 || (this.dirty && this.saveTimer < 8)) this.save();
  }

  private handle(q: Timed): void {
    const run = this.run;
    if (q.kind === 'note') {
      const ev = q.ev;
      if (q.value > 0) this.earn(q.value);
      if (ev.kick && this.audible.section === 'groove' && run.lit) {
        this.addHeat(HEAT_PER_KICK * heatMult(run, this.meta));
      }
      if (ev.layer && ev.socket >= 0) {
        for (const f of this.fx) f.note?.(ev.layer, ev.socket, q.value, q.drop, ev.earn < 1);
      }
      return;
    }
    const info = q.info;
    this.audible = info;
    run.bars++;
    if (info.section === 'groove' && run.lit) this.addHeat(HEAT_PER_BAR * heatMult(run, this.meta));
    if (info.started) {
      if (info.section === 'build') {
        run.heat = 0;
        this.hints.add('pour');
      }
      if (info.section === 'drop') this.hints.add('charge');
      for (const f of this.fx) f.section?.(info);
      if (info.section === 'end') this.finishCast();
    }
    for (const f of this.fx) f.bar?.(info);
  }

  private earn(v: number): void {
    this.run.sparks += v;
    this.run.earned += v;
    this.stats.totalSparks += v;
  }

  private addHeat(v: number): void {
    this.run.heat = Math.min(HEAT_MAX, this.run.heat + v);
    if (this.run.heat >= 30) this.hints.add('lit');
  }

  // ------------------------------------------------------------------ flares

  private updateFlare(now: number): void {
    const run = this.run;
    const f = this.flare;
    if (!f) {
      if (
        now >= this.nextFlareAt && this.audible.section === 'groove' && this.sched.section === 'groove' &&
        !this.pourQueued && !this.casting && run.notes.hat > 0
      ) {
        this.spawnFlare(now);
      }
      return;
    }
    const win = timingWindows(run, this.meta);
    if (now > f.time + win.good) {
      const share = autoCatchShare(run, this.meta);
      if (share > 0) this.catchFlare(share, true);
      else for (const x of this.fx) x.flareMiss?.(f);
      this.endFlare(now);
    }
  }

  private spawnFlare(now: number): void {
    const run = this.run;
    const t = this.track;
    const layers = t.layers.filter((l) => run.notes[l] > 0);
    const layer: LayerId = run.notes.lead > 0 && Math.random() < 0.5 ? 'lead' : layers[Math.floor(Math.random() * layers.length)];
    const socket = Math.floor(Math.random() * run.notes[layer]);
    const step = t.sockets[layer]![socket];
    const cur = this.heardStep;
    const i = Math.ceil((cur + 16 - step) / 16) * 16 + step;
    const time = this.transport!.timeOfStep(i) + this.swingOffset(step);
    this.flare = { layer, socket, step, time, born: now };
    run.flaresSeen++;
    for (const x of this.fx) x.flareSpawn?.(this.flare);
  }

  private catchFlare(share: number, auto: boolean): void {
    const f = this.flare!;
    const run = this.run;
    const v = flareReward(run, this.meta, f.layer) * share;
    this.earn(v);
    run.flaresCaught++;
    this.stats.flares++;
    if (run.lit && this.audible.section === 'groove') this.addHeat(FLARE_HEAT);
    this.engine?.ui('flare', this.uiMidi(0));
    for (const x of this.fx) x.flareCatch?.(f, v, auto);
  }

  private endFlare(now: number): void {
    this.flare = null;
    this.hints.add('flare');
    const [a, b] = flareInterval(this.meta);
    this.nextFlareAt = now + a + Math.random() * (b - a);
  }

  // ------------------------------------------------------------------ player input

  strike(eventStamp?: number): void {
    if (!this.started || this.paused || !this.engine || !this.transport) return;
    const sec = this.audible.section;
    if (sec === 'outro' || sec === 'end') return;
    const e = this.engine;
    const lag = eventStamp !== undefined ? Math.max(0, Math.min(0.1, (performance.now() - eventStamp) / 1000)) : 0;
    const tp = e.now - lag - e.outputLatency - this.settings.inputOffsetMs / 1000;
    if (e.now < this.stagger) {
      e.ui('miss');
      return;
    }
    const run = this.run;
    const win = timingWindows(run, this.meta);
    const judgeOf = (dt: number): Judge => (Math.abs(dt) <= win.perfect ? 'perfect' : Math.abs(dt) <= win.good ? 'good' : 'miss');
    const emit = (j: Judge, v: number, dt: number, kind: 'beat' | 'charge' | 'flare') => {
      for (const f of this.fx) f.strike?.(j, v, dt, kind);
    };
    this.stats.strikes++;

    // 1. flare
    const f = this.flare;
    if (f && Math.abs(tp - f.time) <= win.good) {
      const j = judgeOf(tp - f.time);
      e.strike(this.strikeMidi(), j);
      emit(j, 0, tp - f.time, 'flare');
      this.catchFlare(j === 'perfect' ? 1 : 0.7, false);
      if (j === 'perfect') this.stats.perfects++;
      this.endFlare(this.heardTime);
      return;
    }

    // 2. charge targets during a build (checked by time, so an early first hit still counts)
    let best: ChargeTarget | null = null;
    for (const tgt of this.targets) {
      if (tgt.judged) continue;
      if (!best || Math.abs(tgt.time - tp) < Math.abs(best.time - tp)) best = tgt;
    }
    if (best && judgeOf(tp - best.time) !== 'miss') {
      const dt = tp - best.time;
      const j = judgeOf(dt);
      best.judged = j;
      this.groove++;
      if (j === 'perfect') this.stats.perfects++;
      e.strike(this.strikeMidi(), j);
      emit(j, 0, dt, 'charge');
      for (const f of this.fx) f.chargeHit?.(best);
      return;
    }
    if (sec === 'build' || sec === 'castbuild') {
      this.missed(best ? tp - best.time : 1);
      return;
    }

    // 3. the beat
    const beatDur = this.transport.stepDur * 4;
    const bi = Math.round((tp - this.transport.origin) / beatDur);
    const dt = tp - (this.transport.origin + bi * beatDur);
    const j = judgeOf(dt);
    if (j === 'miss' || bi === this.lastStruckBeat) {
      this.missed(dt);
      return;
    }
    this.lastStruckBeat = bi;
    this.groove++;
    const v = strikeReward(run, this.meta, j, this.groove, this.audible.mult);
    this.earn(v);
    if (run.lit && sec === 'groove') this.addHeat(HEAT_PER_STRIKE[j] * heatMult(run, this.meta));
    if (j === 'perfect') this.stats.perfects++;
    if (++this.goodStrikes >= 4) this.hints.add('strike');
    e.strike(this.strikeMidi(), j);
    emit(j, v, dt, 'beat');
  }

  private missed(dt: number): void {
    const e = this.engine!;
    this.groove = 0;
    this.stagger = e.now + this.transport!.stepDur * 1.4;
    e.strike(0, 'miss');
    for (const f of this.fx) f.strike?.('miss', 0, dt, 'beat');
  }

  /** The anvil climbs the current chord as your groove grows. */
  private strikeMidi(): number {
    const tones = chordMidis(this.track, this.audible.root, 69, this.audible.transpose, false);
    const seq = [0, 1, 2, 3, 2, 1];
    const k = seq[this.groove % seq.length];
    return k === 3 ? tones[0] + 12 : tones[k];
  }

  private uiMidi(n: number): number {
    const tones = chordMidis(this.track, this.audible.root, 72, this.audible.transpose, false);
    return tones[n % tones.length] + 12 * Math.floor((n % 6) / 3);
  }

  private ui(kind: UiSound, n = 0): void {
    this.engine?.ui(kind, this.uiMidi(n));
  }

  canPour(): boolean {
    return (
      this.run.lit && this.run.heat >= HEAT_MAX && !this.pourQueued && !this.casting &&
      this.sched.section === 'groove' && this.audible.section === 'groove'
    );
  }

  requestPour(): boolean {
    if (!this.canPour()) return false;
    this.pourQueued = true;
    this.hints.add('pour');
    return true;
  }

  // ------------------------------------------------------------------ economy actions

  buyNote(layer: LayerId): boolean {
    const run = this.run;
    const cost = noteCost(run, layer);
    if (this.casting || cost === null || run.sparks < cost) {
      this.denied();
      return false;
    }
    run.sparks -= cost;
    const first = run.notes[layer] === 0;
    run.notes[layer]++;
    const socket = run.notes[layer] - 1;
    if (layer === 'clap' && !run.lit) run.lit = true;
    const total = Object.values(run.notes).reduce((a, b) => a + b, 0);
    const forged = isForged(run, layer);
    this.ui(forged ? 'forged' : first ? 'unlock' : 'buy', total);
    this.hints.add('forge');
    for (const f of this.fx) f.purchase?.(layer, socket, first);
    if (forged) for (const f of this.fx) f.forged?.(layer);
    this.dirty = true;
    return true;
  }

  buyMod(id: ModId): boolean {
    const run = this.run;
    const m = MOD_BY_ID[id];
    const cost = modCost(run, m);
    if (this.casting || !modAvailable(run, m) || run.sparks < cost) {
      this.denied();
      return false;
    }
    run.sparks -= cost;
    run.mods.push(id);
    this.hints.add('mod');
    if (id === 'tape') this.engine?.setTape(true);
    this.ui('mod');
    for (const f of this.fx) f.mod?.(m);
    this.dirty = true;
    return true;
  }

  requestCast(): boolean {
    if (this.casting || !canCast(this.run)) {
      this.denied();
      return false;
    }
    this.run.sparks -= castCost(this.run);
    this.casting = true;
    this.castQueued = true;
    this.pourQueued = false;
    this.flare = null;
    this.hints.add('cast');
    this.ui('forged');
    for (const f of this.fx) f.castStart?.();
    this.dirty = true;
    return true;
  }

  private finishCast(): void {
    const run = this.run;
    const meta = this.meta;
    const firstTime = !meta.records.includes(run.track);
    const gold = goldForCast(run, meta);
    meta.gold += gold;
    meta.casts++;
    if (firstTime) meta.records.push(run.track);
    const finale = run.track === TRACKS.length - 1 && !meta.completed;
    if (finale) meta.completed = true;
    this.castResult = { gold, track: run.track, firstTime, finale };
    this.save();
    for (const f of this.fx) f.castDone?.(this.castResult);
  }

  /** Track the player will forge next after a cast. */
  nextTrack(): number {
    if (this.meta.completed) return this.run.track;
    for (let i = 0; i < TRACKS.length; i++) if (!this.meta.records.includes(i)) return i;
    return TRACKS.length - 1;
  }

  startTrack(i: number): void {
    this.run = newRun(i, this.meta);
    this.casting = false;
    this.castQueued = false;
    this.pourQueued = false;
    this.castResult = null;
    if (this.started) this.beginTrackAudio();
    for (const f of this.fx) f.trackStart?.(i);
    this.save();
  }

  buyMeta(id: MetaId): boolean {
    const cost = metaCost(this.meta, id);
    if (cost === null || this.meta.gold < cost) {
      this.denied();
      return false;
    }
    this.meta.gold -= cost;
    this.meta.upgrades[id] = metaLevel(this.meta, id) + 1;
    this.ui('mod');
    this.save();
    return true;
  }

  private denied(): void {
    this.engine?.ui('deny');
    for (const f of this.fx) f.deny?.();
  }

  /** Explicit local cheats from the menu; never alter timing rules or lifetime earnings. */
  debug(action: DebugAction): boolean {
    if (!this.started || this.casting || this.castResult) return false;
    switch (action) {
      case 'sparksSmall': this.run.sparks += 1e6; break;
      case 'sparksLarge': this.run.sparks += 1e9; break;
      case 'castBudget': this.run.sparks = Math.max(this.run.sparks, castCost(this.run)); break;
      case 'heat': this.run.heat = HEAT_MAX; this.run.lit = true; break;
      case 'forge':
        for (const layer of this.track.layers) this.run.notes[layer] = this.track.sockets[layer]!.length;
        this.run.lit = true;
        break;
      case 'mods':
        for (const mod of MODS) {
          if ((!mod.tracks || mod.tracks.includes(this.run.track)) && (!mod.layer || this.track.layers.includes(mod.layer)) && !hasMod(this.run, mod.id)) this.run.mods.push(mod.id);
        }
        this.engine?.setTape(hasMod(this.run, 'tape'));
        break;
      case 'gold': this.meta.gold += 10; break;
      default: return false;
    }
    this.save();
    return true;
  }

  // ------------------------------------------------------------------ hints

  /** On-beat strikes so far, for the first tutorial step. */
  get strikeProgress(): number {
    return this.goodStrikes;
  }

  replayTutorial(): void {
    this.hints.clear();
    this.goodStrikes = 0;
    this.settings = { ...this.settings, hints: true };
    writeSettings(this.settings);
    this.save();
  }

  /**
   * The next moment the player should strike, and the previous one, so the renderer can
   * draw an approach ring. Charge markers during builds, the beat grid otherwise.
   */
  nextCue(now: number): { time: number; prev: number; kind: 'beat' | 'charge' } | null {
    const tr = this.transport;
    if (!this.started || !tr) return null;
    const sec = this.audible.section;
    if (sec === 'outro' || sec === 'end') return null;
    const building = sec === 'build' || sec === 'castbuild';
    const upcoming = this.sched.section === 'build' || this.sched.section === 'castbuild';
    if (building || (upcoming && this.targets.length)) {
      let next: ChargeTarget | null = null;
      let prev = -Infinity;
      for (const tgt of this.targets) {
        if (tgt.judged) {
          prev = Math.max(prev, tgt.time);
          continue;
        }
        if (tgt.time < now - 0.02) continue;
        if (!next || tgt.time < next.time) next = tgt;
      }
      if (!next) return null;
      for (const tgt of this.targets) if (tgt.time < next.time) prev = Math.max(prev, tgt.time);
      const beat = tr.stepDur * 4;
      return { time: next.time, prev: Number.isFinite(prev) ? Math.max(prev, next.time - beat) : next.time - beat, kind: 'charge' };
    }
    const beat = tr.stepDur * 4;
    const k = Math.ceil((now - tr.origin - 0.02) / beat);
    const time = tr.origin + k * beat;
    return { time, prev: time - beat, kind: 'beat' };
  }

  // ------------------------------------------------------------------ persistence

  save(): void {
    this.saveTimer = 10;
    this.dirty = false;
    let run = this.run;
    if (this.castResult) {
      // The record is cast: a reload continues on the next track.
      run = newRun(this.nextTrack(), this.meta);
    } else if (this.casting) {
      // Mid-cast: a reload gives the cast price back so it can be cast again.
      run = { ...run, sparks: run.sparks + castCost(run) };
    }
    writeSave({ run, meta: this.meta, stats: this.stats, hints: [...this.hints] });
  }

  resetAll(): void {
    this.meta = defaultMeta();
    this.stats = defaultStats();
    this.hints = new Set();
    this.goodStrikes = 0;
    this.startTrack(0);
  }

  // ------------------------------------------------------------------ helpers for UI

  layerInfo(l: LayerId) {
    return LAYERS[l];
  }

  metaDefs() {
    return METAS;
  }
}
