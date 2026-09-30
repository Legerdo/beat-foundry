// Bar-level pacing simulation that uses the real economy functions.
import { HEAT_MAX, LAYERS, MODS } from '../src/game/defs';
import {
  AUTO_CHARGE, FLARE_HEAT, HEAT_PER_BAR, HEAT_PER_KICK, HEAT_PER_STRIKE, allLayersUnlocked, autoCatchShare,
  barDuration, barValue, castCost, dropBars, dropMult, dropPower, flareInterval, flareReward, hasMod,
  heatMult, modAvailable, modCost, newRun, noteCost, strikeReward, trackOf,
} from '../src/game/economy';
import type { LayerId, MetaState, ModId } from '../src/game/types';

export interface Profile {
  name: string;
  strikeRate: number; // share of beats struck
  perfect: number; // share of strikes that are perfect (rest good)
  groove: number; // average groove count while striking
  charge: number;
  flareCatch: number;
}

export const ACTIVE: Profile = { name: 'active', strikeRate: 0.85, perfect: 0.7, groove: 10, charge: 0.85, flareCatch: 0.8 };
export const CASUAL: Profile = { name: 'casual', strikeRate: 0.35, perfect: 0.5, groove: 3, charge: 0.55, flareCatch: 0.5 };

export interface SimResult {
  seconds: number;
  events: { t: number; what: string }[];
  purchases: number;
  longestGap: number;
  castWait: number;
  drops: number;
  finalPerBar: number;
}

export function simulateTrack(track: number, meta: MetaState, p: Profile, maxSeconds = 3600): SimResult {
  const r = newRun(track, meta);
  const t = trackOf(r);
  const bar = barDuration(t);
  let time = 0;
  let section: 'groove' | 'build' | 'drop' | 'break' = 'groove';
  let left = 0;
  let mult = 1;
  let nextFlare = 30;
  let lastBuy = 0;
  let longestGap = 0;
  let purchases = 0;
  const events: { t: number; what: string }[] = [];
  const seen = new Set<string>();
  const mark = (what: string) => {
    if (!seen.has(what)) {
      seen.add(what);
      events.push({ t: Math.round(time), what });
    }
  };

  while (time < maxSeconds) {
    // --- play one bar
    const sectionMult = section === 'drop' ? mult : 1;
    const gain = barValue(r, meta) * sectionMult;
    const strikes = section === 'build' ? 0 : 4 * p.strikeRate;
    const perStrike =
      p.perfect * strikeReward(r, meta, 'perfect', p.groove, sectionMult) +
      (1 - p.perfect) * strikeReward(r, meta, 'good', p.groove, sectionMult);
    const earned = gain + strikes * perStrike;
    r.sparks += earned;
    r.earned += earned;
    if (section === 'groove' && r.lit) {
      const hm = heatMult(r, meta);
      const strikeHeat = strikes * (p.perfect * HEAT_PER_STRIKE.perfect + (1 - p.perfect) * HEAT_PER_STRIKE.good);
      r.heat = Math.min(HEAT_MAX, r.heat + hm * (HEAT_PER_BAR + r.notes.kick * HEAT_PER_KICK + strikeHeat));
    }
    if (section === 'groove' && r.notes.hat > 0 && time >= nextFlare) {
      const [a, b] = flareInterval(meta);
      nextFlare = time + (a + b) / 2;
      r.flaresSeen++;
      const layer: LayerId = r.notes.lead > 0 ? 'lead' : 'kick';
      const share = Math.max(p.flareCatch, autoCatchShare(r, meta) * (1 - p.flareCatch) + p.flareCatch);
      const v = flareReward(r, meta, layer) * share;
      r.sparks += v;
      r.earned += v;
      r.flaresCaught++;
      if (r.lit) r.heat = Math.min(HEAT_MAX, r.heat + FLARE_HEAT * p.flareCatch);
    }
    time += bar;

    // --- section flow
    if (section === 'groove') {
      if (r.lit && r.heat >= HEAT_MAX) {
        section = 'build';
        left = 2;
        r.heat = 0;
      }
    } else if (--left <= 0) {
      if (section === 'build') {
        section = 'drop';
        left = dropBars(meta);
        const charge = Math.max(p.charge, hasMod(r, 'autopour') ? AUTO_CHARGE : 0);
        mult = dropMult(dropPower(r, meta), charge);
        r.drops++;
        if (charge >= 0.9) r.perfectDrops++;
        if (r.drops === 1) mark('first drop');
      } else if (section === 'drop') {
        section = 'break';
        left = 1;
      } else {
        section = 'groove';
      }
    }

    // --- shopping: cheapest first
    for (;;) {
      if (allLayersUnlocked(r) && r.sparks >= castCost(r)) {
        mark('CAST');
        return { seconds: time, events, purchases, longestGap: Math.max(longestGap, time - lastBuy), castWait: time - lastBuy, drops: r.drops, finalPerBar: barValue(r, meta) };
      }
      let best: { cost: number; buy: () => void } | null = null;
      for (const l of t.layers) {
        const c = noteCost(r, l);
        if (c !== null && c <= r.sparks && (!best || c < best.cost)) {
          best = {
            cost: c,
            buy: () => {
              if (r.notes[l] === 0) mark(`unlock ${LAYERS[l].name}`);
              r.notes[l]++;
              if (l === 'clap') r.lit = true;
              if (noteCost(r, l) === null) mark(`forged ${LAYERS[l].name}`);
            },
          };
        }
      }
      for (const m of MODS) {
        const mc = modCost(r, m);
        if (modAvailable(r, m) && mc <= r.sparks && (!best || mc < best.cost)) {
          best = { cost: mc, buy: () => { r.mods.push(m.id as ModId); mark(`mod ${m.name}`); } };
        }
      }
      if (!best) break;
      r.sparks -= best.cost;
      best.buy();
      purchases++;
      longestGap = Math.max(longestGap, time - lastBuy);
      lastBuy = time;
    }
  }
  return { seconds: time, events, purchases, longestGap, castWait: time - lastBuy, drops: r.drops, finalPerBar: barValue(r, meta) };
}
