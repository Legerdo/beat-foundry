import { describe, expect, it } from 'vitest';
import { arrangeStep, chordMidis, degSemis, type ArrangeCtx } from '../src/audio/music';
import { TRACKS } from '../src/game/defs';
import { emptyNotes } from '../src/game/economy';
import type { ModId, NoteCounts, Section } from '../src/game/types';

function full(track: number): NoteCounts {
  const n = emptyNotes();
  for (const l of TRACKS[track].layers) n[l] = TRACKS[track].sockets[l]!.length;
  return n;
}

function bar(track: number, notes: NoteCounts, section: Section, opts: Partial<ArrangeCtx> = {}) {
  const out = [];
  for (let step = 0; step < 16; step++) {
    out.push(
      ...arrangeStep({
        track: TRACKS[track], notes, mods: [], section, sectionBar: 0, sectionLen: 1, prog: 0, phrase: 0,
        step, stepDur: 0.15, transpose: 0, crash: false, ...opts,
      }).map((e) => ({ ...e, step })),
    );
  }
  return out;
}

describe('track data', () => {
  for (const t of TRACKS) {
    it(`${t.name}: sockets and melody are consistent`, () => {
      for (const l of t.layers) {
        const s = t.sockets[l]!;
        expect(new Set(s).size).toBe(s.length);
        for (const step of s) expect(step).toBeGreaterThanOrEqual(0), expect(step).toBeLessThan(16);
      }
      expect([...t.sockets.lead!].sort((a, b) => a - b)).toEqual(t.lead.steps);
      for (const b of [...t.lead.bars, t.lead.turn]) expect(b.length).toBe(t.lead.steps.length);
    });

    it(`${t.name}: chord tones are voiced inside their window and in key`, () => {
      const scale = new Set(t.scale.map((s) => (s + t.tonic) % 12));
      for (const root of t.progression) {
        const m = chordMidis(t, root, 55, 0);
        for (const x of m) {
          expect(x).toBeGreaterThanOrEqual(55);
          expect(x).toBeLessThan(67);
          expect(scale.has(x % 12)).toBe(true);
        }
      }
    });

    it(`${t.name}: melody on strong beats sits on chord tones`, () => {
      t.lead.bars.forEach((degs, b) => {
        const root = t.progression[b];
        const chord = new Set([0, 2, 4].map((d) => ((degSemis(t, root + d) % 12) + 12) % 12));
        t.lead.steps.forEach((step, i) => {
          if (step % 8 !== 0) return;
          const pc = ((degSemis(t, degs[i]) % 12) + 12) % 12;
          expect(chord.has(pc), `${t.name} bar ${b} step ${step}`).toBe(true);
        });
      });
    });
  }
});

describe('arrangement', () => {
  it('a single kick is the whole song at the start', () => {
    const n = emptyNotes();
    n.kick = 1;
    const evs = bar(0, n, 'groove');
    expect(evs).toHaveLength(1);
    expect(evs[0].voice?.inst).toBe('kick');
    expect(evs[0].step).toBe(0);
  });

  it('every forged note earns exactly once per groove bar without echoes', () => {
    for (const t of TRACKS) {
      const n = full(t.index);
      const earning = bar(t.index, n, 'groove').filter((e) => e.layer && e.earn === 1);
      const total = t.layers.reduce((s, l) => s + n[l], 0);
      expect(earning.length, t.name).toBe(total);
    }
  });

  it('echo mod adds half-value echo events for lead notes', () => {
    const n = full(0);
    const mods: ModId[] = ['echo'];
    const evs = bar(0, n, 'groove', { mods });
    const echoes = evs.filter((e) => e.layer === 'lead' && e.earn === 0.5);
    expect(echoes).toHaveLength(n.lead);
  });

  it('the last beat of a build is silent and the roll provides charge targets', () => {
    for (const len of [2, 4]) {
      let targets = 0;
      for (let b = 0; b < len; b++) {
        const evs = bar(2, full(2), len === 2 ? 'build' : 'castbuild', { sectionBar: b, sectionLen: len });
        targets += evs.filter((e) => e.target).length;
        if (b === len - 1) expect(evs.filter((e) => e.step >= 12)).toHaveLength(0);
      }
      expect(targets).toBe(len === 2 ? 10 : 20);
    }
  });

  it('drops use the heavy patches and bass returns', () => {
    const evs = bar(0, full(0), 'drop', { sectionBar: 0, sectionLen: 8 });
    expect(evs.some((e) => e.voice?.inst === 'bass' && e.voice.drop)).toBe(true);
    expect(evs.some((e) => e.voice?.inst === 'kick' && e.voice.drop)).toBe(true);
  });

  it('the finale of the last track quotes both earlier melodies', () => {
    const insts = new Set<string>();
    for (const b of [4, 8, 12]) {
      for (const e of bar(2, full(2), 'finale', { sectionBar: b, sectionLen: 16 })) if (e.voice) insts.add(e.voice.inst);
    }
    expect(insts.has('bell')).toBe(true);
    expect(insts.has('call')).toBe(true);
  });

  it('the outro ends on a major tonic chord', () => {
    const evs = bar(0, full(0), 'outro', { sectionBar: 0, sectionLen: 2 });
    const pad = evs.find((e) => e.voice?.inst === 'pad')!;
    const pcs = pad.voice!.midi.map((m) => m % 12);
    const tonic = TRACKS[0].tonic % 12;
    expect(pcs).toContain((tonic + 4) % 12);
    expect(pcs).not.toContain((tonic + 3) % 12);
  });
});
