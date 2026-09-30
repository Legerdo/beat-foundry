// The machine: concentric sequencer rings around a crucible. Everything here reads game state
// and the audio clock; it never decides timing.
//
// Performance notes: static geometry (blueprint, beam trail, vignette, soft glows) is rendered
// once into cached canvases; sparks are batched by color; resolution adapts when frames run long.
import { isDropSection } from '../audio/music';
import { LAYERS, TRACKS, type ModDef } from '../game/defs';
import { layerVisible, noteCost, sockets, timingWindows } from '../game/economy';
import type { BarInfo, CastResult, ChargeTarget, Flare, Fx, Game } from '../game/game';
import type { Judge, LayerId } from '../game/types';
import { fmtShort } from '../format';
import { FONT_STACK, ROMAN, layerText, t } from '../i18n';
import { GOLD, WHITE, heat, hexToRgb, mix, rgba, type RGB } from './color';
import { Particles } from './particles';

interface Layout {
  w: number;
  h: number;
  dpr: number;
  cx: number;
  cy: number;
  R: number;
  rC: number;
  rim: number;
  rings: number[];
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: RGB;
}

const TAU = Math.PI * 2;
const stepAngle = (s: number) => -Math.PI / 2 + (s / 16) * TAU;
const FONT = FONT_STACK;
const colorKey = (c: RGB) => ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

export class Renderer implements Fx {
  private ctx: CanvasRenderingContext2D;
  private L!: Layout;
  private parts = new Particles();
  private texts: FloatText[] = [];
  private glowCache = new Map<number, HTMLCanvasElement>();
  private softCache = new Map<number, HTMLCanvasElement>();
  private pulses = new Map<LayerId, Float32Array>();
  private ringFlash = new Map<LayerId, number>();
  private ringBirth = new Map<LayerId, number>();
  private ringSweep = new Map<LayerId, number>();
  private tickFlash = new Float32Array(16);
  private colors = new Map<LayerId, RGB>();

  // cached layers (rebuilt on resize / resolution change)
  private blueprint: HTMLCanvasElement | null = null;
  private trails: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  private vignette: HTMLCanvasElement | null = null;

  // adaptive resolution
  private scale = 1;
  private scaleCap = 2;
  private slowTime = 0;
  private fastTime = 0;
  private upLocked = 0;
  private frameEma = 1 / 60;

  private kick = 0;
  private crucibleJolt = 0;
  private zoom = 0;
  private shake = 0;
  private flash = 0;
  private wave = -1;
  private energy = 0.1;
  private heatShown = 0;
  private time = 0;
  private emberAcc = 0;
  private pourAcc = 0;
  private outroStart = -1;
  private recordSpin = 0;
  private lastCue = 0;
  private redraw = true;

  hoverLayer: LayerId | null = null;
  previewLayer: LayerId | null = null;
  /** Set by the tutorial: emphasise the beat guide and show the strike key. */
  coachStrike = false;
  /** Set by the tutorial: emphasise charge markers. */
  coachCharge = false;

  constructor(private cv: HTMLCanvasElement, private game: Game) {
    this.ctx = cv.getContext('2d', { alpha: false, desynchronized: true })!;
    for (const l of Object.keys(LAYERS) as LayerId[]) this.colors.set(l, hexToRgb(LAYERS[l].color));
    this.applyQuality();
    this.resize();
    this.trackStart();
  }

  // ------------------------------------------------------------------ layout + quality

  /** Called when the graphics setting changes. */
  applyQuality(): void {
    const dpr = window.devicePixelRatio || 1;
    const q = this.game.settings.quality;
    this.scaleCap = q === 'low' ? Math.min(1, dpr) : Math.min(2, dpr);
    this.scale = this.scaleCap;
    this.upLocked = 0;
    this.slowTime = this.fastTime = 0;
    if (this.L) this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = this.scale;
    this.cv.width = Math.round(w * s);
    this.cv.height = Math.round(h * s);
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
    // Lay out as if the workbench were already open, so the machine never jumps.
    const bench = document.getElementById('bench');
    const bw = bench?.offsetWidth ?? 0;
    const bh = bench?.offsetHeight ?? 0;
    const side = bw > 0 && bw < w * 0.8;
    const x0 = 0;
    let x1 = w;
    const y0 = w <= 900 ? 136 : 104;
    let y1 = h - 58;
    if (side) x1 = w - bw;
    else if (bh > 0) y1 = h - bh - 40;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const R = Math.max(90, Math.min((x1 - x0) / 2 - 36, (y1 - y0) / 2 - 22));
    const n = this.game.track.layers.length;
    const inner = R * 0.33;
    const outer = R * 0.9;
    const rings = Array.from({ length: n }, (_, i) => inner + ((outer - inner) * i) / Math.max(1, n - 1));
    this.L = { w, h, dpr: s, cx, cy, R, rC: R * 0.19, rim: R * 0.99, rings };
    this.buildCaches();
    this.redraw = true;
  }

  /** Step resolution down when frames run long, back up when there is headroom. */
  private adapt(dt: number): void {
    if (this.game.settings.quality !== 'auto' || dt <= 0 || dt > 0.25) return;
    this.frameEma += (dt - this.frameEma) * 0.08;
    this.upLocked = Math.max(0, this.upLocked - dt);
    if (this.frameEma > 1 / 48) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (this.frameEma < 1 / 57) {
      this.fastTime += dt;
      this.slowTime = 0;
    } else {
      this.slowTime = this.fastTime = 0;
    }
    if (this.slowTime > 1.2 && this.scale > 0.75) {
      this.scale = Math.max(0.75, +(this.scale - 0.25).toFixed(2));
      this.slowTime = 0;
      this.upLocked = 20; // do not bounce straight back up
      this.resize();
    } else if (this.fastTime > 6 && this.upLocked <= 0 && this.scale < this.scaleCap) {
      this.scale = Math.min(this.scaleCap, +(this.scale + 0.25).toFixed(2));
      this.fastTime = 0;
      this.resize();
    }
  }

  get renderScale(): number {
    return this.scale;
  }

  /** Center of the machine in CSS pixels, for positioning HUD elements. */
  get center(): { x: number; y: number; r: number; rC: number } {
    return { x: this.L.cx, y: this.L.cy, r: this.L.R, rC: this.L.rC };
  }

  private buildCaches(): void {
    const L = this.L;
    const s = L.dpr;

    // blueprint: 16 spokes and the rim, drawn once
    {
      const half = L.rim + 4;
      const [c, x] = canvas(half * 2 * s, half * 2 * s);
      x.setTransform(s, 0, 0, s, half * s, half * s);
      x.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const a = stepAngle(i);
        x.strokeStyle = `rgba(255,220,190,${i % 4 === 0 ? 0.08 : 0.04})`;
        x.beginPath();
        x.moveTo(Math.cos(a) * (L.rC + 12), Math.sin(a) * (L.rC + 12));
        x.lineTo(Math.cos(a) * L.rim, Math.sin(a) * L.rim);
        x.stroke();
      }
      x.strokeStyle = 'rgba(255,220,190,0.08)';
      x.beginPath();
      x.arc(0, 0, L.rim, 0, TAU);
      x.stroke();
      this.blueprint = c;
    }

    // beam trails (groove + drop), pointing at angle 0; rotated at draw time
    const trail = (span: number, color: RGB): HTMLCanvasElement => {
      const half = L.rim + 2;
      const [c, x] = canvas(half * 2 * s, half * 2 * s);
      x.setTransform(s, 0, 0, s, half * s, half * s);
      const grd = x.createConicGradient(-span, 0, 0);
      const edge = span / TAU;
      grd.addColorStop(0, rgba(color, 0));
      grd.addColorStop(edge * 0.999, rgba(color, 1));
      grd.addColorStop(Math.min(1, edge + 0.001), rgba(color, 0));
      grd.addColorStop(1, rgba(color, 0));
      x.fillStyle = grd;
      x.beginPath();
      x.arc(0, 0, L.rim, -span, 0);
      x.arc(0, 0, L.rC + 10, 0, -span, true);
      x.closePath();
      x.fill();
      return c;
    };
    this.trails = [trail(0.9, heat(0.6)), trail(1.3, heat(0.85))];

    // drop vignette at quarter resolution: it is a smooth gradient, so nobody can tell
    {
      const q = 0.25;
      const [c, x] = canvas(L.w * q, L.h * q);
      const cx = L.cx * q;
      const cy = L.cy * q;
      const g = x.createRadialGradient(cx, cy, Math.min(L.w, L.h) * q * 0.35, cx, cy, Math.max(L.w, L.h) * q * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, rgba(heat(0.6), 1));
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      this.vignette = c;
    }
  }

  /** Bright point glow (white core). */
  private glow(c: RGB): HTMLCanvasElement {
    const key = colorKey(c);
    let g = this.glowCache.get(key);
    if (!g) {
      const [cv, x] = canvas(64, 64);
      const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, rgba(mix(c, WHITE, 0.6), 1));
      grd.addColorStop(0.18, rgba(c, 0.85));
      grd.addColorStop(0.45, rgba(c, 0.22));
      grd.addColorStop(1, rgba(c, 0));
      x.fillStyle = grd;
      x.fillRect(0, 0, 64, 64);
      if (this.glowCache.size > 160) this.glowCache.clear();
      this.glowCache.set(key, cv);
      g = cv;
    }
    return g;
  }

  /** Wide soft glow for backgrounds (no core). */
  private soft(c: RGB): HTMLCanvasElement {
    const key = colorKey(c);
    let g = this.softCache.get(key);
    if (!g) {
      const [cv, x] = canvas(128, 128);
      const grd = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, rgba(c, 1));
      grd.addColorStop(0.3, rgba(c, 0.55));
      grd.addColorStop(0.6, rgba(c, 0.18));
      grd.addColorStop(1, rgba(c, 0));
      x.fillStyle = grd;
      x.fillRect(0, 0, 128, 128);
      if (this.softCache.size > 64) this.softCache.clear();
      this.softCache.set(key, cv);
      g = cv;
    }
    return g;
  }

  private socketPos(i: number, step: number, scale = 1): [number, number] {
    const r = this.L.rings[i] * scale;
    const a = stepAngle(step);
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  private layerIndex(l: LayerId): number {
    return this.game.track.layers.indexOf(l);
  }

  private get motion(): number {
    return this.game.settings.reducedMotion ? 0 : 1;
  }

  // ------------------------------------------------------------------ fx hooks

  trackStart(): void {
    this.pulses.clear();
    for (const l of this.game.track.layers) this.pulses.set(l, new Float32Array(sockets(this.game.track, l).length));
    this.parts.clear();
    this.texts = [];
    this.outroStart = -1;
    this.wave = -1;
    this.resize();
  }

  note(layer: LayerId, socket: number, _value: number, drop: boolean, echo: boolean): void {
    const p = this.pulses.get(layer);
    if (!p || socket >= p.length) return;
    p[socket] = Math.max(p[socket], echo ? 0.45 : 1);
    const i = this.layerIndex(layer);
    const step = sockets(this.game.track, layer)[socket];
    const [x, y] = this.socketPos(i, step);
    const c = this.colors.get(layer)!;
    if (layer === 'kick' && !echo) {
      this.kick = 1;
      if (drop) {
        this.parts.ring(0, 0, this.L.rC, this.L.R * 1.4, heat(0.8), 0.7, 3);
        this.zoom += 0.012 * this.motion;
      }
    }
    if (echo) {
      this.parts.ring(x, y, 3, 40, c, 0.35, 1);
      return;
    }
    const n = drop ? 3 : Math.random() < 0.3 ? 1 : 0;
    const a = stepAngle(step) + Math.PI / 2;
    for (let k = 0; k < n; k++) {
      const s = 60 + Math.random() * (drop ? 160 : 70);
      const d = a + (Math.random() - 0.5) * 1.2;
      this.parts.spark(x, y, Math.cos(d) * s, Math.sin(d) * s - 30, mix(c, WHITE, 0.3), 0.45, 1.2, 160);
    }
  }

  section(info: BarInfo): void {
    if (info.section === 'drop' || info.section === 'finale') {
      const big = info.section === 'finale' ? 1.4 : 1;
      this.flash = 1;
      this.shake = 16 * big;
      this.zoom += 0.08 * big * this.motion;
      this.wave = 0;
      const n = Math.round((this.game.settings.reducedMotion ? 60 : 180) * big);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU;
        const s = 250 + Math.random() * 700;
        this.parts.spark(Math.cos(a) * this.L.rC, Math.sin(a) * this.L.rC, Math.cos(a) * s, Math.sin(a) * s, heat(0.75 + Math.random() * 0.25), 0.9 + Math.random() * 0.6, 1.2 + Math.random() * 1.8, 60);
      }
      this.parts.ring(0, 0, this.L.rC, this.L.R * 2.2, WHITE, 0.9, 6);
    }
    if (info.section === 'outro') this.outroStart = this.game.heardTime;
    if (info.section === 'groove' && info.index > 0) this.parts.ring(0, 0, this.L.rC, this.L.R * 0.8, heat(0.5), 0.6, 2);
  }

  strike(judge: Judge, _value: number, _dt: number, kind: 'beat' | 'charge' | 'flare'): void {
    const L = this.L;
    if (judge === 'miss') {
      this.crucibleJolt = 1;
      return;
    }
    const perfect = judge === 'perfect';
    const c = perfect ? GOLD : heat(0.7);
    this.kick = Math.max(this.kick, perfect ? 1 : 0.6);
    if (kind === 'beat') {
      const step = ((Math.round(this.game.heardStep / 4) * 4) % 16 + 16) % 16;
      this.tickFlash[step] = 1;
      this.parts.ring(0, 0, L.rC + 4, perfect ? 260 : 160, c, 0.35, perfect ? 2.5 : 1.5);
      this.parts.burst(0, -L.rC * 0.6, perfect ? 10 : 5, perfect ? 320 : 200, c, 0.55, 1.4, -Math.PI / 2);
    }
  }

  chargeHit(tg: ChargeTarget): void {
    const a = stepAngle(tg.step);
    const r = this.L.rim + 16;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const perfect = tg.judged === 'perfect';
    this.parts.burst(x, y, perfect ? 16 : 8, perfect ? 300 : 180, perfect ? GOLD : heat(0.7), 0.5);
    this.parts.ring(x, y, 4, 90, perfect ? GOLD : heat(0.7), 0.35, 2);
  }

  chargeMiss(): void {
    /* drawn as a dim marker */
  }

  purchase(layer: LayerId, socket: number, first: boolean): void {
    const p = this.pulses.get(layer);
    if (p) p[socket] = 2.4;
    const i = this.layerIndex(layer);
    const step = sockets(this.game.track, layer)[socket];
    const [x, y] = this.socketPos(i, step);
    const c = this.colors.get(layer)!;
    this.parts.burst(x, y, 16, 240, mix(c, WHITE, 0.35), 0.55);
    this.parts.ring(x, y, 4, 120, c, 0.4, 2);
    this.ringFlash.set(layer, 0.8);
    if (first) {
      this.ringBirth.set(layer, 0);
      this.zoom += 0.025 * this.motion;
      this.shake = Math.max(this.shake, 3);
      this.parts.ring(0, 0, this.L.rC, (this.L.rings[i] - this.L.rC) * 2, c, 0.5, 3);
      this.text(layerText(layer).name, 0, -this.L.rings[i] - 14, 16, mix(c, WHITE, 0.3), 1.4, -10);
    }
  }

  forged(layer: LayerId): void {
    this.ringSweep.set(layer, 0);
    this.zoom += 0.02 * this.motion;
    const i = this.layerIndex(layer);
    const c = this.colors.get(layer)!;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU;
      const r = this.L.rings[i];
      this.parts.spark(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * 120, Math.sin(a) * 120, mix(c, GOLD, 0.5), 0.8, 1.5, 40);
    }
  }

  mod(m: ModDef): void {
    const layers = m.layer ? [m.layer] : this.game.track.layers.filter((l) => this.game.run.notes[l] > 0);
    for (const l of layers) this.ringFlash.set(l, 1);
    this.parts.ring(0, 0, this.L.rC, this.L.R * 1.2, m.layer ? this.colors.get(m.layer)! : WHITE, 0.8, 2);
    this.zoom += 0.02 * this.motion;
  }

  flareSpawn(f: Flare): void {
    const [x, y] = this.socketPos(this.layerIndex(f.layer), f.step);
    this.parts.burst(x, y, 12, 120, GOLD, 0.6);
  }

  flareCatch(f: Flare, value: number, auto: boolean): void {
    const [x, y] = this.socketPos(this.layerIndex(f.layer), f.step);
    const n = auto ? 14 : 44;
    this.parts.burst(x, y, n, auto ? 200 : 420, GOLD, 0.8);
    this.parts.ring(x, y, 6, auto ? 90 : 220, GOLD, 0.5, auto ? 1.5 : 3);
    this.text(`+${fmtShort(value)}`, x, y - 18, auto ? 14 : 22, GOLD, 1.2, -36);
    if (!auto) {
      this.flash = Math.max(this.flash, 0.22);
      this.zoom += 0.015 * this.motion;
    }
  }

  flareMiss(f: Flare): void {
    const [x, y] = this.socketPos(this.layerIndex(f.layer), f.step);
    this.parts.burst(x, y, 6, 60, [120, 110, 100], 0.5);
  }

  castDone(_r: CastResult): void {
    /* the record keeps spinning under the foundry panel */
  }

  private text(text: string, x: number, y: number, size: number, color: RGB, life: number, vy: number): void {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ text, x, y, vy, life, max: life, size, color });
  }

  // ------------------------------------------------------------------ frame

  render(dt: number): void {
    if (this.game.paused) {
      if (!this.redraw) return;
      dt = 0;
    }
    this.redraw = false;
    this.adapt(dt);
    const g = this.game;
    const ctx = this.ctx;
    const L = this.L;
    const tr = g.track;
    const run = g.run;
    const info = g.audible;
    this.time += dt;
    const now = g.heardTime;
    const stepF = g.started ? g.heardStep : this.time * 6.66;
    const barPos = ((stepF % 16) + 16) % 16;
    const angle = stepAngle(barPos);
    const drop = isDropSection(info.section);
    const building = info.section === 'build' || info.section === 'castbuild';
    const lastBuild = building && info.sectionBar === info.sectionLen - 1;
    const hold = lastBuild && barPos >= 12 ? Math.min(1, (barPos - 12) / 4) : 0;
    const brk = info.section === 'break';
    const outroP = this.outroStart >= 0 ? Math.min(1, (now - this.outroStart) / (g.barDur * 1.6)) : 0;
    const low = g.settings.quality === 'low' || g.settings.reducedMotion;

    // ---- decays
    const k9 = Math.exp(-9 * dt);
    this.kick *= k9;
    this.shake *= k9;
    this.flash *= k9;
    this.crucibleJolt *= Math.exp(-10 * dt);
    this.zoom *= Math.exp(-4.5 * dt);
    const k6 = Math.exp(-6 * dt);
    for (let i = 0; i < 16; i++) this.tickFlash[i] *= k6;
    const k8 = Math.exp(-8 * dt);
    for (const p of this.pulses.values()) for (let i = 0; i < p.length; i++) p[i] = p[i] > 1 ? p[i] - dt * 6 : p[i] * k8;
    const k3 = Math.exp(-3 * dt);
    for (const [k, v] of this.ringFlash) this.ringFlash.set(k, v * k3);
    for (const [k, v] of this.ringBirth) v >= 1 ? this.ringBirth.delete(k) : this.ringBirth.set(k, v + dt * 2);
    for (const [k, v] of this.ringSweep) v >= 1.4 ? this.ringSweep.delete(k) : this.ringSweep.set(k, v + dt * 1.3);
    if (this.wave >= 0) this.wave = this.wave > 1.5 ? -1 : this.wave + dt * 1.6;

    // ---- energy: how alive the machine is
    let filled = 0;
    let total = 0;
    for (const l of tr.layers) {
      filled += run.notes[l];
      total += sockets(tr, l).length;
    }
    const progress = filled / total;
    const target = (0.12 + progress * 0.7) * (drop ? 1.7 : building ? 1.15 : brk ? 0.55 : 1) * (1 - hold * 0.8);
    this.energy += (target - this.energy) * Math.min(1, dt * (drop ? 8 : 2.5));
    const E = this.energy;

    const shownHeat = building ? 1 - (info.sectionBar * 16 + barPos) / (info.sectionLen * 16) : run.lit ? run.heat / 100 : 0;
    this.heatShown += (shownHeat - this.heatShown) * Math.min(1, dt * 6);

    this.parts.budget = low ? 500 : 1400;
    this.parts.update(dt);
    let alive = 0;
    for (const f of this.texts) {
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= Math.exp(-2 * dt);
      if (f.life > 0) this.texts[alive++] = f;
    }
    this.texts.length = alive;

    // while dropping, the crucible pours: a steady fountain of molten sparks
    if (drop) {
      this.pourAcc += dt * (low ? 25 : 90) * (0.6 + this.kick);
      while (this.pourAcc > 1) {
        this.pourAcc -= 1;
        const a = Math.random() * TAU;
        const s = 160 + Math.random() * 420;
        this.parts.spark(Math.cos(a) * L.rC, Math.sin(a) * L.rC, Math.cos(a) * s, Math.sin(a) * s, heat(0.7 + Math.random() * 0.3), 0.6 + Math.random() * 0.5, 1 + Math.random() * 1.4, 30);
      }
    }

    // ambient embers scale with the machine's energy
    this.emberAcc += dt * E * (low ? 6 : 22);
    while (this.emberAcc > 1) {
      this.emberAcc -= 1;
      const a = Math.random() * TAU;
      const r = L.rC + Math.random() * L.rim;
      this.parts.ember(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 12, -10 - Math.random() * 24, heat(0.55 + Math.random() * 0.4), 2 + Math.random() * 2, 1 + Math.random());
    }

    // ---- camera
    const z = 1 + this.zoom + hold * 0.05 - outroP * 0.05;
    const sh = this.shake * g.settings.shake * this.motion;
    const sx = g.paused ? 0 : (Math.random() - 0.5) * sh;
    const sy = g.paused ? 0 : (Math.random() - 0.5) * sh;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#060507';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(L.dpr * z, 0, 0, L.dpr * z, L.dpr * (L.cx + sx), L.dpr * (L.cy + sy));

    this.drawBackground(E, drop, hold);

    const machineScale = 1 - outroP * 0.5;
    const machineAlpha = 1 - outroP;
    if (machineAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = machineAlpha;
      ctx.scale(machineScale, machineScale);
      this.drawTrail(angle, E, drop, hold, machineAlpha);
      this.drawRings(E, drop, hold);
      this.drawBeam(angle, E, drop, hold);
      this.drawRim(barPos, now, hold);
      this.drawFlare(now);
      this.drawCrucible(drop, building, info, stepF);
      this.drawGuide(now, hold);
      ctx.restore();
    }
    if (outroP > 0) this.drawRecord(outroP, dt);

    this.parts.draw(ctx, (c) => this.glow(c));
    this.drawTexts();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (drop && this.vignette) {
      // heat haze at the edges of the screen, breathing with the kick
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + this.kick * 0.14;
      ctx.drawImage(this.vignette, 0, 0, this.cv.width, this.cv.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (hold > 0) {
      ctx.fillStyle = `rgba(0,0,0,${(hold * 0.45).toFixed(3)})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    }
    const fl = this.flash * g.settings.flash;
    if (fl > 0.01) {
      ctx.fillStyle = `rgba(255,236,210,${(fl * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    }
  }

  private drawBackground(E: number, drop: boolean, hold: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const k = this.kick;
    const glowA = (0.08 + E * 0.22 + k * (drop ? 0.12 : 0.04)) * (1 - hold);
    const size = L.R * 2 * (1.5 + (drop ? 0.4 : 0));
    ctx.globalAlpha = Math.min(1, glowA * 1.3);
    ctx.drawImage(this.soft(heat(0.32 + E * 0.32)), -size / 2, -size / 2, size, size);
    if (drop) {
      // the whole machine glows from inside while the metal flows
      const s2 = L.rim * 2.3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, 0.22 + k * 0.2);
      ctx.drawImage(this.soft(heat(0.8)), -s2 / 2, -s2 / 2, s2, s2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.blueprint) {
      const half = L.rim + 4;
      ctx.globalAlpha = Math.min(1, (0.62 + E * 0.3) * (1 - hold));
      ctx.drawImage(this.blueprint, -half, -half, half * 2, half * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawTrail(angle: number, E: number, drop: boolean, hold: number, base: number): void {
    if (!this.trails) return;
    const ctx = this.ctx;
    const L = this.L;
    const img = this.trails[drop ? 1 : 0];
    const half = L.rim + 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.globalAlpha = base * (0.07 + E * 0.1 + (drop ? 0.12 : 0)) * (1 - hold);
    ctx.drawImage(img, -half, -half, half * 2, half * 2);
    ctx.restore();
  }

  private drawRings(E: number, drop: boolean, hold: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const g = this.game;
    const tr = g.track;
    const run = g.run;
    const waveR = this.wave >= 0 ? L.rC + this.wave * L.R * 1.1 : -999;
    const spacing = L.rings.length > 1 ? L.rings[1] - L.rings[0] : L.R * 0.2;
    const size = Math.max(2.6, Math.min(7, spacing * 0.2));
    const labelFont = `600 ${Math.max(9, Math.min(11, spacing * 0.36))}px ${FONT}`;
    const heatDrop = heat(0.95);

    for (let i = 0; i < tr.layers.length; i++) {
      const layer = tr.layers[i];
      const n = run.notes[layer];
      const unlocked = n > 0;
      if (!unlocked && !layerVisible(run, layer)) continue;
      const c = this.colors.get(layer)!;
      let r = L.rings[i];
      const birth = this.ringBirth.get(layer);
      if (birth !== undefined) r = L.rC + (r - L.rC) * easeOutBack(Math.min(1, birth));
      const hot = Math.max(0, 1 - Math.abs(waveR - r) / 50);
      const flash = (this.ringFlash.get(layer) ?? 0) + hot;
      const hover = this.hoverLayer === layer ? 1 : 0;
      const col = drop ? mix(c, heatDrop, 0.25 + hot * 0.5) : c;
      const socks = sockets(tr, layer);
      const pulses = this.pulses.get(layer)!;

      if (!unlocked) {
        const cost = noteCost(run, layer);
        const afford = cost !== null && run.sparks >= cost;
        ctx.setLineDash([3, 7]);
        ctx.strokeStyle = rgba(c, (afford ? 0.3 + 0.15 * Math.sin(this.time * 5) : 0.1) + hover * 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }

      const forged = n >= socks.length;
      const dropGlow = drop ? 0.22 + this.kick * 0.25 : 0;
      ctx.strokeStyle = rgba(forged ? mix(col, GOLD, 0.35) : col, (0.12 + E * 0.16 + flash * 0.5 + hover * 0.3 + dropGlow) * (1 - hold * 0.7));
      ctx.lineWidth = (forged ? 2.2 : 1.2) + (drop ? 1 : 0);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();

      // a light running around a freshly forged ring
      const sweep = this.ringSweep.get(layer);
      if (sweep !== undefined && sweep < 1) {
        const a = -Math.PI / 2 + sweep * TAU;
        ctx.strokeStyle = rgba(mix(c, WHITE, 0.6), 0.9 * (1 - sweep));
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, r, a - 0.6, a);
        ctx.stroke();
      }

      // label
      ctx.fillStyle = rgba(c, 0.38 + hover * 0.5 + flash * 0.3);
      ctx.font = labelFont;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(layerText(layer).name, -size * 2.2, -r);

      // sockets: glows first, then cores, so the state changes stay minimal
      ctx.globalCompositeOperation = 'lighter';
      const glowImg = this.glow(col);
      for (let k = 0; k < n; k++) {
        const a = stepAngle(socks[k]);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const p = Math.min(2.4, pulses[k]);
        const pp = Math.min(1, p);
        const s = size * (1 + 0.5 * p) * (drop ? 1.15 : 1);
        const gs = s * (3.2 + 3 * pp + (drop ? 2 : 0) + E * 1.5);
        ctx.globalAlpha = Math.min(1, (0.22 + E * 0.25 + 0.55 * pp + flash * 0.3) * (1 - hold * 0.6));
        ctx.drawImage(glowImg, x - gs / 2, y - gs / 2, gs, gs);
      }
      ctx.globalAlpha = 1;
      for (let k = 0; k < n; k++) {
        const a = stepAngle(socks[k]);
        const p = Math.min(2.4, pulses[k]);
        const pp = Math.min(1, p);
        const s = size * (1 + 0.5 * p) * (drop ? 1.15 : 1);
        ctx.fillStyle = rgba(mix(col, WHITE, 0.15 + pp * 0.7), 0.95);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, s, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // empty sockets
      const previewing = this.previewLayer === layer || this.hoverLayer === layer;
      ctx.strokeStyle = rgba(c, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = n + (previewing ? 1 : 0); k < socks.length; k++) {
        const a = stepAngle(socks[k]);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        ctx.moveTo(x + size * 0.62, y);
        ctx.arc(x, y, size * 0.62, 0, TAU);
      }
      ctx.stroke();
      if (previewing && n < socks.length) {
        const a = stepAngle(socks[n]);
        const blink = 0.5 + 0.5 * Math.sin(this.time * 10);
        ctx.strokeStyle = rgba(c, 0.18 + blink * 0.6);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, size * 1.1, 0, TAU);
        ctx.stroke();
      }
    }
  }

  private drawBeam(angle: number, E: number, drop: boolean, hold: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const x0 = Math.cos(angle) * (L.rC + 10);
    const y0 = Math.sin(angle) * (L.rC + 10);
    const x1 = Math.cos(angle) * (L.rim + 8);
    const y1 = Math.sin(angle) * (L.rim + 8);
    const a = 1 - hold;
    const c = heat(drop ? 0.95 : 0.7 + E * 0.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(c, 0.16 * a);
    ctx.lineWidth = drop ? 12 : 7;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const grd = ctx.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, rgba(WHITE, 0.9 * a));
    grd.addColorStop(1, rgba(c, 0.25 * a));
    ctx.strokeStyle = grd;
    ctx.lineWidth = drop ? 3.2 : 1.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  private drawRim(barPos: number, now: number, hold: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const g = this.game;
    ctx.save();
    ctx.lineCap = 'round';
    for (let s = 0; s < 16; s++) {
      const a = stepAngle(s);
      const beat = s % 4 === 0;
      const ahead = (s - barPos + 16) % 16;
      const approach = beat && ahead < 2.5 ? 1 - ahead / 2.5 : 0;
      const f = this.tickFlash[s];
      const len = beat ? 9 + approach * 5 + f * 6 : 4;
      const alpha = (beat ? 0.3 + approach * 0.6 : 0.14) + f;
      ctx.strokeStyle = rgba(f > 0.05 ? mix(heat(0.8), GOLD, f) : heat(0.75), alpha * (1 - hold));
      ctx.lineWidth = beat ? 2.4 + approach : 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (L.rim + 2), Math.sin(a) * (L.rim + 2));
      ctx.lineTo(Math.cos(a) * (L.rim + 2 + len), Math.sin(a) * (L.rim + 2 + len));
      ctx.stroke();
    }

    // charge markers during a build, each with its own closing ring
    const bd = g.barDur;
    let nextT: ChargeTarget | null = null;
    for (const tgt of g.targets) {
      if (!tgt.judged && tgt.time > now - 0.03 && (!nextT || tgt.time < nextT.time)) nextT = tgt;
    }
    for (const tgt of g.targets) {
      const dtt = tgt.time - now;
      if (dtt < -0.5 || dtt > bd * 1.02) continue;
      const a = stepAngle(tgt.step);
      const r = L.rim + 20;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const close = Math.max(0, 1 - Math.abs(dtt) / (bd / 4));
      const s = 5 + close * 4;
      ctx.save();
      ctx.translate(x, y);
      if (tgt === nextT && dtt > 0) {
        // shrinking ring that lands on the marker exactly on time
        const p = Math.min(1, dtt / (bd / 4));
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(WHITE, 0.3 + 0.7 * (1 - p));
        ctx.lineWidth = 1.5 + (1 - p) * 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.7 + 22 * p, 0, TAU);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.rotate(a + Math.PI / 4);
      if (tgt.judged === 'perfect' || tgt.judged === 'good') {
        const c = tgt.judged === 'perfect' ? GOLD : heat(0.7);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(c, 0.9);
        ctx.fillRect(-s / 2, -s / 2, s, s);
      } else if (tgt.judged === 'miss') {
        ctx.strokeStyle = 'rgba(120,110,105,0.5)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.25 + close * 0.6) * (this.coachCharge ? 1.3 : 1);
        const gs = s * (this.coachCharge ? 7 : 5);
        ctx.drawImage(this.glow(WHITE), -gs / 2, -gs / 2, gs, gs);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgba(WHITE, 0.55 + close * 0.45);
        ctx.lineWidth = 1.6;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawFlare(now: number): void {
    const f = this.game.flare;
    if (!f) return;
    const ctx = this.ctx;
    const L = this.L;
    const [x, y] = this.socketPos(this.layerIndex(f.layer), f.step);
    const left = f.time - now;
    const k = Math.max(0, Math.min(1, left / this.game.barDur));
    const born = Math.min(1, (now - f.born) * 3);
    const win = timingWindows(this.game.run, this.game.meta);
    const inWindow = Math.abs(left) <= win.good;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gs = (inWindow ? 52 : 34) + 10 * Math.sin(this.time * 12);
    ctx.globalAlpha = 0.8 * born;
    ctx.drawImage(this.glow(GOLD), x - gs / 2, y - gs / 2, gs, gs);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(GOLD, (0.35 + 0.65 * (1 - k)) * born);
    ctx.lineWidth = 2 + (1 - k) * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 7 + 46 * k, 0, TAU);
    ctx.stroke();
    if (inWindow) {
      ctx.fillStyle = rgba(GOLD, 0.95);
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('c.now'), x, y - 20);
    }
    // a golden tick on the rim so the eye can find it
    const a = stepAngle(f.step);
    ctx.strokeStyle = rgba(GOLD, 0.8 * born);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (L.rim + 3), Math.sin(a) * (L.rim + 3));
    ctx.lineTo(Math.cos(a) * (L.rim + 18), Math.sin(a) * (L.rim + 18));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The beat guide: a ring that shrinks onto the crucible's rim and lands exactly when you
   * should strike. Judgement text and timing-history overlays are intentionally absent.
   */
  private drawGuide(now: number, hold: number): void {
    const g = this.game;
    const on = g.settings.guide || this.coachStrike;
    if (!on || !g.started) return;
    const ctx = this.ctx;
    const L = this.L;
    const rT = L.rC + 8;
    const cue = g.nextCue(now);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (on && cue && hold < 0.5) {
      // metronome pulse on the target ring when a beat passes
      if (this.lastCue > 0 && cue.time > this.lastCue + 0.01 && this.lastCue <= now + 0.005 && cue.kind === 'beat') {
        this.parts.ring(0, 0, rT, 50, heat(0.8), 0.3, this.coachStrike ? 2.2 : 1.2);
      }
      this.lastCue = cue.time;
      const span = Math.max(0.05, cue.time - cue.prev);
      const p = Math.max(0, Math.min(1, (cue.time - now) / span));
      const strength = this.coachStrike ? 1 : 0.65;
      const charge = cue.kind === 'charge';
      const r = rT + p * L.rC * (charge ? 1.1 : 1.4);
      const close = 1 - p;
      const c = charge ? WHITE : mix(heat(0.8), GOLD, close * close);
      // target ring (where the approach ring lands)
      ctx.strokeStyle = rgba(c, (0.1 + close * close * 0.35) * strength);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, rT, 0, TAU);
      ctx.stroke();
      // approach ring
      ctx.strokeStyle = rgba(c, (0.12 + 0.8 * close * close) * strength);
      ctx.lineWidth = 1.5 + close * 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawCrucible(drop: boolean, building: boolean, info: BarInfo, stepF: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const g = this.game;
    const run = g.run;
    const rC = L.rC;
    const k = this.kick;
    const h = this.heatShown;
    const jolt = this.crucibleJolt * Math.sin(this.time * 70) * 3;
    ctx.save();
    ctx.translate(jolt, 0);
    ctx.scale(1 + 0.06 * k, 1 - 0.035 * k);

    // halo
    ctx.globalCompositeOperation = 'lighter';
    const halo = rC * (3 + h * 2 + (drop ? 2 : 0));
    ctx.globalAlpha = Math.min(1, 0.12 + h * 0.4 + k * 0.25 + (drop ? 0.4 : 0));
    ctx.drawImage(this.glow(heat(0.4 + h * 0.5)), -halo / 2, -halo / 2, halo, halo);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // vessel
    ctx.fillStyle = '#0d0b0a';
    ctx.beginPath();
    ctx.arc(0, 0, rC, 0, TAU);
    ctx.fill();

    // molten metal
    const level = drop ? 1 : h;
    if (level > 0.005) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, rC - 4, 0, TAU);
      ctx.clip();
      const top = rC - 4 - (rC - 4) * 2 * level;
      ctx.beginPath();
      ctx.moveTo(-rC, rC);
      for (let x = -rC; x <= rC; x += 5) {
        ctx.lineTo(x, top + Math.sin(x * 0.09 + this.time * 3.2) * (1.5 + level * 2.5) + Math.sin(x * 0.21 - this.time * 5) * 1.2);
      }
      ctx.lineTo(rC, rC);
      ctx.closePath();
      const grd = ctx.createLinearGradient(0, top, 0, rC);
      const hc = heat(drop ? 1 : 0.45 + level * 0.5);
      grd.addColorStop(0, rgba(mix(hc, WHITE, 0.2), 1));
      grd.addColorStop(1, rgba(heat(0.3 + level * 0.3), 1));
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.restore();
    }

    // rim and heat gauge
    ctx.strokeStyle = '#2e2622';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, rC, 0, TAU);
    ctx.stroke();
    if (run.lit || building) {
      ctx.strokeStyle = 'rgba(255,200,160,0.08)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, rC + 8, 0, TAU);
      ctx.stroke();
      const full = run.heat >= 100 && info.section === 'groove';
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(full ? mix(heat(1), GOLD, 0.5 + 0.5 * Math.sin(this.time * 8)) : heat(0.45 + h * 0.5), 0.95);
      ctx.lineWidth = full ? 4.5 : 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, rC + 8, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.002, h));
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    // readout
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const light = level > 0.45;
    ctx.fillStyle = light ? 'rgba(30,10,4,0.9)' : 'rgba(255,225,200,0.85)';
    if (drop) {
      ctx.fillStyle = 'rgba(40,12,4,0.92)';
      ctx.font = `700 ${Math.round(rC * 0.52)}px ${FONT}`;
      ctx.fillText(`×${info.mult.toFixed(1)}`, 0, 1);
    } else if (building) {
      let judged = 0;
      for (const x of g.targets) if (x.judged === 'perfect' || x.judged === 'good') judged++;
      ctx.fillStyle = 'rgba(255,240,225,0.95)';
      ctx.font = `600 ${Math.round(rC * 0.2)}px ${FONT}`;
      ctx.fillText(t('c.charge'), 0, -rC * 0.22);
      ctx.font = `700 ${Math.round(rC * 0.42)}px ${FONT}`;
      ctx.fillText(`${judged}/${info.sectionLen <= 2 ? 10 : 20}`, 0, rC * 0.16);
    } else if (run.lit && !this.coachStrike) {
      if (run.heat >= 100 && info.section === 'groove') {
        ctx.fillStyle = light ? 'rgba(40,12,4,0.95)' : '#fff';
        ctx.font = `700 ${Math.round(rC * 0.34)}px ${FONT}`;
        ctx.fillText(t('c.pour'), 0, -rC * 0.08);
        ctx.font = `600 ${Math.round(rC * 0.16)}px ${FONT}`;
        ctx.fillText(g.pourQueued ? t('c.nextBar') : t('c.enter'), 0, rC * 0.3);
      } else {
        ctx.font = `700 ${Math.round(rC * 0.34)}px ${FONT}`;
        ctx.fillText(`${Math.floor(run.heat)}`, 0, -rC * 0.04);
        ctx.font = `600 ${Math.round(rC * 0.14)}px ${FONT}`;
        ctx.fillText(t('c.heat'), 0, rC * 0.32);
      }
    } else if (this.coachStrike && g.started) {
      // tutorial: the key to press, pulsing on every beat
      const frac = (((stepF / 4) % 1) + 1) % 1;
      const pulse = Math.exp(-frac * 5);
      ctx.fillStyle = light ? `rgba(40,12,4,${(0.5 + 0.5 * pulse).toFixed(3)})` : `rgba(255,236,210,${(0.35 + 0.65 * pulse).toFixed(3)})`;
      ctx.font = `700 ${Math.round(rC * (0.26 + 0.05 * pulse))}px ${FONT}`;
      ctx.fillText(COARSE ? t('c.tap') : t('c.strike'), 0, 0);
    }
    ctx.restore();
  }

  private drawRecord(p: number, dt: number): void {
    const ctx = this.ctx;
    const L = this.L;
    const tr = TRACKS[this.game.audible.track];
    this.recordSpin += dt * (1 + p * 3);
    const r = L.R * 0.62 * easeOutBack(p);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 1.5);
    ctx.rotate(this.recordSpin);
    ctx.fillStyle = '#0b0a0b';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 26; i++) {
      const rr = r * (0.38 + (i / 26) * 0.6);
      ctx.strokeStyle = `rgba(255,220,190,${0.04 + (i % 3 === 0 ? 0.04 : 0)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.stroke();
    }
    // light catching the grooves
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,230,200,0.12)';
    ctx.lineWidth = r * 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.68, -0.35, 0.05);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    const lab = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.34);
    lab.addColorStop(0, rgba(heat(0.95), 1));
    lab.addColorStop(1, rgba(heat(0.55), 1));
    ctx.fillStyle = lab;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,12,4,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(r * 0.09)}px ${FONT}`;
    ctx.fillText(tr.name, 0, -r * 0.07);
    ctx.font = `600 ${Math.round(r * 0.045)}px ${FONT}`;
    ctx.fillText(t('c.record', { n: ROMAN[tr.index] }), 0, r * 0.08);
    ctx.fillStyle = '#0b0a0b';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.025, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawTexts(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.texts) {
      const k = f.life / f.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 2.2 : 1;
      ctx.font = `700 ${Math.round(f.size * pop)}px ${FONT}`;
      ctx.fillStyle = rgba(f.color, Math.min(1, k * 2.2));
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
