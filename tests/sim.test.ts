import { describe, expect, it } from 'vitest';
import type { MetaState } from '../src/game/types';
import { ACTIVE, CASUAL, simulateTrack, type Profile } from './simulate';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const META: MetaState[] = [
  { gold: 0, records: [], upgrades: {}, completed: false, casts: 0 },
  // after Track I: ~6-8 gold spent
  { gold: 0, records: [0], upgrades: { warm: 1, overtone: 1, bellows: 1 }, completed: false, casts: 1 },
  // after Track II: ~15 gold spent in total
  { gold: 0, records: [0, 1], upgrades: { warm: 1, overtone: 2, bellows: 1, anvil: 1, crucible: 1, apprentice: 1 }, completed: false, casts: 2 },
];

function report(track: number, p: Profile) {
  const res = simulateTrack(track, META[track], p);
  const lines = res.events.map((e) => `  ${fmt(e.t).padStart(6)}  ${e.what}`);
  console.log(
    `\nTrack ${track + 1} [${p.name}] total ${fmt(res.seconds)}, purchases ${res.purchases}, ` +
      `longest wait ${fmt(res.longestGap)}, cast wait ${fmt(res.castWait)}, drops ${res.drops}, final bar value ${res.finalPerBar.toExponential(2)}\n${lines.join('\n')}`,
  );
  return res;
}

describe('pacing', () => {
  for (const track of [0, 1, 2]) {
    it(`track ${track + 1} is completable in a sensible time`, () => {
      const a = report(track, ACTIVE);
      const c = report(track, CASUAL);
      expect(a.seconds).toBeGreaterThan([5, 3, 3][track] * 60);
      // Cost rebalance: preserve the full progression while preventing late-track grind.
      expect(a.seconds).toBeLessThan([10, 7, 6][track] * 60);
      expect(c.seconds).toBeLessThan([15, 11, 10][track] * 60);
      expect(a.longestGap).toBeLessThan(60);
      expect(c.longestGap).toBeLessThan(90);
      expect(a.castWait).toBeLessThan(60);
      expect(c.castWait).toBeLessThan(60);
    });
  }
});
