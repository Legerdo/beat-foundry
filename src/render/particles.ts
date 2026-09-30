import { rgba, type RGB } from './color';

const SPARK = 0;
const EMBER = 1;
const RING = 2;

interface P {
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: RGB;
  /** Palette index of the quantized color (sparks only). */
  pal: number;
  drag: number;
  grav: number;
  grow: number;
}

const ALPHA_STEPS = 6;
const WIDTH_STEPS = 3;

/**
 * Pooled additive particles in machine-local coordinates.
 * Sparks are batched: one path per (color, alpha step, width step) instead of one stroke each,
 * which keeps big drops cheap.
 */
export class Particles {
  private pool: P[] = [];
  private live: P[] = [];
  budget = 1400;

  // spark batching
  private palette: string[] = [];
  private palIndex = new Map<number, number>();
  private buckets: P[][] = [];
  private used: number[] = [];

  private get(): P | null {
    if (this.live.length >= this.budget) return null;
    const p = this.pool.pop() ?? ({} as P);
    this.live.push(p);
    return p;
  }

  private pal(c: RGB): number {
    // 5 bits per channel is plenty for glowing sparks
    const key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
    let i = this.palIndex.get(key);
    if (i === undefined) {
      i = this.palette.length;
      this.palette.push(`rgb(${(c[0] >> 3) << 3},${(c[1] >> 3) << 3},${(c[2] >> 3) << 3})`);
      this.palIndex.set(key, i);
    }
    return i;
  }

  spark(x: number, y: number, vx: number, vy: number, color: RGB, life = 0.6, size = 1.4, grav = 120): void {
    const p = this.get();
    if (!p) return;
    p.kind = SPARK; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
    p.size = size; p.color = color; p.pal = this.pal(color); p.drag = 2.2; p.grav = grav; p.grow = 0;
  }

  ember(x: number, y: number, vx: number, vy: number, color: RGB, life = 2, size = 1.6): void {
    const p = this.get();
    if (!p) return;
    p.kind = EMBER; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
    p.size = size; p.color = color; p.pal = 0; p.drag = 0.4; p.grav = -8; p.grow = 0;
  }

  ring(x: number, y: number, r0: number, grow: number, color: RGB, life = 0.5, width = 2): void {
    const p = this.get();
    if (!p) return;
    p.kind = RING; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.life = life; p.max = life;
    p.size = r0; p.color = color; p.pal = 0; p.drag = 0; p.grav = width; p.grow = grow;
  }

  burst(x: number, y: number, n: number, speed: number, color: RGB, life = 0.7, spread = Math.PI * 2, dir = 0): void {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, color, life * (0.6 + Math.random() * 0.6), 1 + Math.random() * 1.3);
    }
  }

  get count(): number {
    return this.live.length;
  }

  clear(): void {
    for (const p of this.live) this.pool.push(p);
    this.live.length = 0;
  }

  update(dt: number): void {
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) {
        live[i] = live[live.length - 1];
        live.pop();
        this.pool.push(p);
        continue;
      }
      if (p.kind === RING) {
        p.size += p.grow * dt;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, glow: (c: RGB) => HTMLCanvasElement): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // 1. bucket sparks
    const buckets = this.buckets;
    const used = this.used;
    for (const p of this.live) {
      if (p.kind === EMBER) {
        const k = p.life / p.max;
        const s = p.size * 6;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        ctx.drawImage(glow(p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === RING) {
        const k = p.life / p.max;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgba(p.color, k * 0.8);
        ctx.lineWidth = p.grav * (0.4 + k * 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const a = Math.min(ALPHA_STEPS - 1, Math.floor((p.life / p.max) * ALPHA_STEPS));
        const w = p.size < 1.5 ? 0 : p.size < 2.2 ? 1 : 2;
        const key = (p.pal * ALPHA_STEPS + a) * WIDTH_STEPS + w;
        let b = buckets[key];
        if (!b) b = buckets[key] = [];
        if (b.length === 0) used.push(key);
        b.push(p);
      }
    }

    // 2. one path per bucket
    for (const key of used) {
      const b = buckets[key];
      const w = key % WIDTH_STEPS;
      const a = Math.floor(key / WIDTH_STEPS) % ALPHA_STEPS;
      const pal = Math.floor(key / (WIDTH_STEPS * ALPHA_STEPS));
      ctx.globalAlpha = (a + 0.6) / ALPHA_STEPS;
      ctx.strokeStyle = this.palette[pal];
      ctx.lineWidth = w === 0 ? 1.2 : w === 1 ? 1.8 : 2.6;
      ctx.beginPath();
      for (const p of b) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      }
      ctx.stroke();
      b.length = 0;
    }
    used.length = 0;
    ctx.restore();
  }
}
