import { describe, expect, it } from 'vitest';
import { MOD_BY_ID, TRACKS } from '../src/game/defs';
import {
  barValue, canCast, castCost, dropMult, goldForCast, metaCost, modAvailable, modCost, newRun, noteCost, noteValue, strikeReward, timingWindows,
} from '../src/game/economy';
import { defaultMeta, defaultStats, parseSave } from '../src/game/save';

describe('economy', () => {
  it('starts with one kick and a cheap second note', () => {
    const r = newRun(0, defaultMeta());
    expect(r.notes.kick).toBe(1);
    expect(noteCost(r, 'kick')).toBe(4);
    expect(noteCost(r, 'clap')).toBeNull(); // not visible yet
    expect(barValue(r, defaultMeta())).toBeCloseTo(1);
  });

  it('note prices rise and stop when a layer is forged', () => {
    const r = newRun(0, defaultMeta());
    const a = noteCost(r, 'kick')!;
    r.notes.kick = 2;
    expect(noteCost(r, 'kick')!).toBeGreaterThan(a);
    r.notes.kick = TRACKS[0].sockets.kick!.length;
    expect(noteCost(r, 'kick')).toBeNull();
  });

  it('forging a layer doubles its notes', () => {
    const meta = defaultMeta();
    const r = newRun(0, meta);
    r.notes.kick = 4;
    const v = noteValue(r, meta, 'kick');
    r.notes.kick = 5;
    expect(noteValue(r, meta, 'kick')).toBeCloseTo(v * 2);
  });

  it('discounts every OPUS choir note and keeps track availability intact', () => {
    const r = newRun(2, defaultMeta());
    expect(noteCost(r, 'choir')).toBeNull();
    r.notes.bells = 1;
    const prices = [10.8e9, 28.08e9, 73.008e9, 189.8208e9];
    for (const price of prices) {
      // Floating-point growth followed by ceil can add one spark at billion-scale prices.
      expect(Math.abs(noteCost(r, 'choir')! - price)).toBeLessThanOrEqual(1);
      r.notes.choir++;
    }
    expect(noteCost(r, 'choir')).toBeNull();
    expect(noteCost(newRun(0, defaultMeta()), 'choir')).toBeNull();
    expect(noteCost(newRun(1, defaultMeta()), 'choir')).toBeNull();
  });

  it('discounts notes, mods and gold upgrades without changing judgement windows', () => {
    const meta = defaultMeta();
    for (const [track, hatPrice, tapePrice] of [[0, 15, 75e6], [1, 45, 225e6], [2, 270, 1350e6]]) {
      const r = newRun(track, meta);
      expect(noteCost(r, 'hat')).toBe(hatPrice);
      expect(modCost(r, MOD_BY_ID.tape)).toBe(tapePrice);
      expect(timingWindows(r, meta)).toEqual({ perfect: 0.05, good: 0.11 });
    }
    expect(metaCost(meta, 'warm')).toBe(1);
    expect(metaCost({ ...meta, upgrades: { overtone: 2 } }, 'overtone')).toBe(4);
    expect(metaCost({ ...meta, upgrades: { overtone: 3 } }, 'overtone')).toBeNull();
  });

  it('records and overtones multiply everything', () => {
    const meta = defaultMeta();
    const r = newRun(0, meta);
    const base = barValue(r, meta);
    const m2 = { ...meta, records: [0], upgrades: { overtone: 1 } };
    expect(barValue(r, m2)).toBeCloseTo(base * 6);
  });

  it('warm start skips the first minute', () => {
    const r = newRun(1, { ...defaultMeta(), upgrades: { warm: 1 } });
    expect(r.notes.kick).toBe(4);
    expect(r.lit).toBe(true);
  });

  it('track-specific mods only appear on their track', () => {
    const r = newRun(0, defaultMeta());
    r.notes.hat = 12;
    expect(modAvailable(r, MOD_BY_ID.swing)).toBe(false);
    const r2 = newRun(1, defaultMeta());
    r2.notes.hat = 12;
    expect(modAvailable(r2, MOD_BY_ID.swing)).toBe(true);
  });

  it('strikes pay nothing on a miss and more with groove', () => {
    const meta = defaultMeta();
    const r = newRun(0, meta);
    expect(strikeReward(r, meta, 'miss', 5, 1)).toBe(0);
    expect(strikeReward(r, meta, 'perfect', 8, 1)).toBeGreaterThan(strikeReward(r, meta, 'perfect', 0, 1));
    expect(strikeReward(r, meta, 'perfect', 0, 1)).toBeGreaterThan(strikeReward(r, meta, 'good', 0, 1));
  });

  it('charge scales the drop', () => {
    expect(dropMult(5, 1)).toBeGreaterThan(dropMult(5, 0.5));
    expect(dropMult(5, 2)).toBe(dropMult(5, 1));
  });

  it('casting needs every layer and the price', () => {
    const r = newRun(0, defaultMeta());
    r.sparks = 1e20;
    expect(canCast(r)).toBe(false);
    for (const l of TRACKS[0].layers) r.notes[l] = 1;
    expect(canCast(r)).toBe(true);
  });

  it('uses the lower casting targets while requiring every layer to be live', () => {
    for (const [track, target] of [[0, 120e6], [1, 2.4e9], [2, 400e9]]) {
      const r = newRun(track, defaultMeta());
      expect(castCost(r)).toBe(target);
      r.sparks = target;
      expect(canCast(r)).toBe(false);
      for (const layer of TRACKS[track].layers) r.notes[layer] = 1;
      r.sparks = target - 1;
      expect(canCast(r)).toBe(false);
      r.sparks = target;
      expect(canCast(r)).toBe(true);
    }
  });

  it('encore casts pay less gold than the first cast', () => {
    const r = newRun(0, defaultMeta());
    const first = goldForCast(r, defaultMeta());
    const again = goldForCast(r, { ...defaultMeta(), records: [0] });
    expect(first).toBeGreaterThan(again);
  });
});

describe('save', () => {
  it('round-trips and clamps bad values', () => {
    const meta = defaultMeta();
    const run = newRun(1, meta);
    run.notes.hat = 999;
    run.sparks = -5;
    const raw = JSON.stringify({ v: 1, time: 123, run, meta: { ...meta, gold: 4, records: [0, 0, 7] }, stats: defaultStats(), hints: ['strike'] });
    const s = parseSave(raw)!;
    expect(s.run.track).toBe(1);
    expect(s.run.notes.hat).toBe(TRACKS[1].sockets.hat!.length);
    expect(s.run.sparks).toBe(0);
    expect(s.meta.records).toEqual([0]);
    expect(s.meta.gold).toBe(4);
    expect(s.hints).toEqual(['strike']);
  });

  it('rejects garbage', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('{"v":2}')).toBeNull();
  });
});
