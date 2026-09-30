import {
  ENCORE_GOLD, GOLD_BASE, LAYERS, METAS, MOD_BY_ID, MODS, RECORD_MULT, TRACKS, needMet,
  type ModDef, type TrackDef,
} from './defs';
import { arrangeStep } from '../audio/music';
import type { Judge, LayerId, MetaId, MetaState, ModId, NoteCounts, RunState } from './types';

export const emptyNotes = (): NoteCounts => ({
  kick: 0, hat: 0, clap: 0, bass: 0, chord: 0, lead: 0, bells: 0, choir: 0,
});

/** Discount shared by note, mod and permanent upgrade prices. */
export const UPGRADE_COST_SCALE = 0.5;

export function metaLevel(meta: MetaState, id: MetaId): number {
  return meta.upgrades[id] ?? 0;
}

export function newRun(track: number, meta: MetaState): RunState {
  const notes = emptyNotes();
  notes.kick = 1;
  let lit = false;
  let sparks = 0;
  if (metaLevel(meta, 'warm') > 0) {
    notes.kick = 4;
    notes.hat = 4;
    notes.clap = 1;
    lit = true;
    sparks = 50;
  }
  return {
    track, sparks, earned: 0, notes, mods: [], heat: 0, lit,
    drops: 0, perfectDrops: 0, flaresSeen: 0, flaresCaught: 0,
    autoBuy: true, bars: 0,
  };
}

export const trackOf = (r: RunState): TrackDef => TRACKS[r.track];
export const hasMod = (r: RunState, id: ModId): boolean => r.mods.includes(id);
export const barDuration = (t: TrackDef): number => (60 / t.bpm) * 4;

export function sockets(t: TrackDef, layer: LayerId): number[] {
  return t.sockets[layer] ?? [];
}

/** Steps currently occupied by a layer's notes. */
export function activeSteps(t: TrackDef, notes: NoteCounts, layer: LayerId): number[] {
  return sockets(t, layer).slice(0, notes[layer]);
}

export function isForged(r: RunState, layer: LayerId): boolean {
  const max = sockets(trackOf(r), layer).length;
  return max > 0 && r.notes[layer] >= max;
}

/** A layer is on the workbench once the previous layer has at least one note. */
export function layerVisible(r: RunState, layer: LayerId): boolean {
  const layers = trackOf(r).layers;
  const i = layers.indexOf(layer);
  if (i < 0) return false;
  if (i === 0) return true;
  return r.notes[layers[i - 1]] > 0;
}

export function unlockedLayers(r: RunState): LayerId[] {
  return trackOf(r).layers.filter((l) => r.notes[l] > 0);
}

export function noteCost(r: RunState, layer: LayerId): number | null {
  const t = trackOf(r);
  const max = sockets(t, layer).length;
  const n = r.notes[layer];
  if (n >= max || !layerVisible(r, layer)) return null;
  const info = LAYERS[layer];
  const bought = layer === 'kick' ? n - 1 : n;
  return Math.ceil(info.baseCost * t.costScale * UPGRADE_COST_SCALE * Math.pow(info.growth, Math.max(0, bought)));
}

export function modCost(r: RunState, m: ModDef): number {
  return Math.ceil(m.cost * trackOf(r).costScale * UPGRADE_COST_SCALE);
}

export function modAvailable(r: RunState, m: ModDef): boolean {
  if (hasMod(r, m.id)) return false;
  if (m.tracks && !m.tracks.includes(r.track)) return false;
  if (m.layer && !trackOf(r).layers.includes(m.layer)) return false;
  return needMet(r, m.need);
}

/** Mods that belong to this track (whether or not requirements are met), not yet owned. */
export function pendingMods(r: RunState): ModDef[] {
  return MODS.filter(
    (m) => !hasMod(r, m.id) && (!m.tracks || m.tracks.includes(r.track)) && (!m.layer || trackOf(r).layers.includes(m.layer)),
  );
}

export function globalMult(r: RunState, meta: MetaState): number {
  let m = 1;
  m *= 1 + r.notes.hat * (hasMod(r, 'openhat') ? 0.06 : 0.03);
  m *= Math.pow(1.3, r.notes.choir);
  if (hasMod(r, 'tape')) m *= 1.5;
  m *= Math.pow(RECORD_MULT, meta.records.length);
  m *= Math.pow(2, metaLevel(meta, 'overtone'));
  return m;
}

export function layerMult(r: RunState, layer: LayerId): number {
  let m = isForged(r, layer) ? 2 : 1;
  const n = r.notes;
  switch (layer) {
    case 'hat':
      if (hasMod(r, 'openhat')) m *= 3;
      if (hasMod(r, 'swing')) m *= 2;
      break;
    case 'bass':
      m *= 1 + n.kick * (hasMod(r, 'sidechain') ? 0.3 : 0.15);
      m *= 1 + n.chord * 0.2;
      break;
    case 'chord':
      if (hasMod(r, 'sidechain')) m *= 1 + n.kick * 0.15;
      break;
    case 'lead':
      m *= 1 + n.chord * 0.2;
      if (hasMod(r, 'octave')) m *= 2;
      break;
    case 'bells':
      if (hasMod(r, 'cascade')) m *= 2;
      break;
    default:
      break;
  }
  return m;
}

export function noteValue(r: RunState, meta: MetaState, layer: LayerId): number {
  return LAYERS[layer].value * layerMult(r, layer) * globalMult(r, meta);
}

/**
 * Sparks each layer produces in one groove bar. Computed by running the arranger itself,
 * so the number always matches what is actually heard (echoes included).
 */
export function barBreakdown(r: RunState, meta: MetaState): Partial<Record<LayerId, number>> {
  // Cached: the HUD, strikes and flares all ask for this many times per second.
  const n = r.notes;
  const key = `${r.track}|${n.kick},${n.hat},${n.clap},${n.bass},${n.chord},${n.lead},${n.bells},${n.choir}|${r.mods.join(',')}|${meta.records.length}|${metaLevel(meta, 'overtone')}`;
  if (key === bdKey && bdVal) return bdVal;
  bdVal = computeBreakdown(r, meta);
  bdKey = key;
  return bdVal;
}

let bdKey = '';
let bdVal: Partial<Record<LayerId, number>> | null = null;

function computeBreakdown(r: RunState, meta: MetaState): Partial<Record<LayerId, number>> {
  const t = trackOf(r);
  const out: Partial<Record<LayerId, number>> = {};
  const values: Partial<Record<LayerId, number>> = {};
  for (const l of t.layers) {
    if (r.notes[l] > 0) {
      values[l] = noteValue(r, meta, l);
      out[l] = 0;
    }
  }
  for (let step = 0; step < 16; step++) {
    const evs = arrangeStep({
      track: t, notes: r.notes, mods: r.mods, section: 'groove', sectionBar: 0, sectionLen: 1,
      prog: 0, phrase: 0, step, stepDur: 0.1, transpose: 0, crash: false,
    });
    for (const ev of evs) {
      if (ev.layer && ev.earn > 0) out[ev.layer] = (out[ev.layer] ?? 0) + (values[ev.layer] ?? 0) * ev.earn;
    }
  }
  return out;
}

/** Sparks produced by one groove bar (what you hear is what you earn). */
export function barValue(r: RunState, meta: MetaState): number {
  let sum = 0;
  for (const v of Object.values(barBreakdown(r, meta))) sum += v ?? 0;
  return sum;
}

export function perSecond(r: RunState, meta: MetaState): number {
  return barValue(r, meta) / barDuration(trackOf(r));
}

export function heatMult(r: RunState, meta: MetaState): number {
  let m = Math.pow(1.5, metaLevel(meta, 'bellows'));
  if (hasMod(r, 'cathedral')) m *= 1.4;
  return m;
}

export const HEAT_PER_KICK = 0.6;
export const HEAT_PER_BAR = 1.2;
export const HEAT_PER_STRIKE: Record<Judge, number> = { perfect: 0.8, good: 0.4, miss: 0 };
export const FLARE_HEAT = 12;

export function strikePower(r: RunState, meta: MetaState): number {
  return (1 + r.notes.clap * 0.25) * (metaLevel(meta, 'anvil') > 0 ? 2 : 1);
}

export function grooveMult(groove: number): number {
  return 1 + Math.min(groove, 16) / 16;
}

export const JUDGE_MULT: Record<Judge, number> = { perfect: 1, good: 0.5, miss: 0 };

export function strikeReward(r: RunState, meta: MetaState, judge: Judge, groove: number, sectionMult: number): number {
  // Early on the +1 dominates and striking is how you grow; later a strike is a ~20% bonus
  // on top of what the machine plays by itself.
  const base = 0.2 * (barValue(r, meta) / 4) * sectionMult + 1;
  return JUDGE_MULT[judge] * grooveMult(groove) * strikePower(r, meta) * base;
}

export function timingWindows(r: RunState, meta: MetaState): { perfect: number; good: number } {
  let k = metaLevel(meta, 'anvil') > 0 ? 1.2 : 1;
  if (hasMod(r, 'swing')) k *= 1.15;
  return { perfect: 0.05 * k, good: 0.11 * k };
}

export function dropPower(r: RunState, meta: MetaState): number {
  let p = 2 + 0.5 * unlockedLayers(r).length;
  if (hasMod(r, 'subdrop')) p += 1;
  if (hasMod(r, 'supersaw')) p += 1.5;
  if (hasMod(r, 'keychange')) p += 2;
  p += r.notes.bells * 0.25 * (hasMod(r, 'cascade') ? 2 : 1);
  p += 2 * metaLevel(meta, 'crucible');
  return p;
}

/** charge in [0,1] from the build-up performance. */
export function dropMult(power: number, charge: number): number {
  return power * (0.5 + Math.max(0, Math.min(1, charge)));
}

export const AUTO_CHARGE = 0.5;

export function dropBars(meta: MetaState): number {
  return 8 + (metaLevel(meta, 'longpour') > 0 ? 4 : 0);
}

export function flareInterval(meta: MetaState): [number, number] {
  return metaLevel(meta, 'lens') > 0 ? [14, 24] : [28, 44];
}

/** Share of a flare's value granted when it is caught automatically (0 = not caught). */
export function autoCatchShare(r: RunState, meta: MetaState): number {
  if (metaLevel(meta, 'lens') > 0) return 0.6;
  if (hasMod(r, 'catcher')) return 0.5;
  return 0;
}

export function flareReward(r: RunState, meta: MetaState, layer: LayerId): number {
  return perSecond(r, meta) * 20 * (layer === 'lead' ? 2 : 1) + 5;
}

export function castCost(r: RunState): number {
  return trackOf(r).castCost;
}

export function allLayersUnlocked(r: RunState): boolean {
  return trackOf(r).layers.every((l) => r.notes[l] > 0);
}

export function canCast(r: RunState): boolean {
  return allLayersUnlocked(r) && r.sparks >= castCost(r);
}

export function goldForCast(r: RunState, meta: MetaState): number {
  const repeat = meta.records.includes(r.track);
  const base = repeat ? ENCORE_GOLD : GOLD_BASE[r.track];
  const skill = Math.min(4, Math.floor(r.perfectDrops / 2)) + (r.flaresCaught >= 6 ? 1 : 0);
  return base + skill;
}

export function metaCost(meta: MetaState, id: MetaId): number | null {
  const def = METAS.find((m) => m.id === id)!;
  const lvl = metaLevel(meta, id);
  return lvl < def.costs.length ? Math.max(1, Math.round(def.costs[lvl] * UPGRADE_COST_SCALE)) : null;
}

/** What the player should aim for next, for the goal line. */
export function nextGoal(r: RunState): { kind: 'layer'; layer: LayerId; cost: number } | { kind: 'cast'; cost: number } {
  const t = trackOf(r);
  for (const l of t.layers) {
    if (r.notes[l] === 0) return { kind: 'layer', layer: l, cost: noteCost(r, l) ?? Math.ceil(LAYERS[l].baseCost * t.costScale * UPGRADE_COST_SCALE) };
  }
  return { kind: 'cast', cost: castCost(r) };
}

/** Cheapest affordable note, used by the Apprentice. */
export function cheapestNote(r: RunState): { layer: LayerId; cost: number } | null {
  let best: { layer: LayerId; cost: number } | null = null;
  for (const l of trackOf(r).layers) {
    const c = noteCost(r, l);
    if (c !== null && (!best || c < best.cost)) best = { layer: l, cost: c };
  }
  return best;
}

export function modById(id: ModId): ModDef {
  return MOD_BY_ID[id];
}
