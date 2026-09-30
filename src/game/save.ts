import { MODS, TRACKS } from './defs';
import { emptyNotes, newRun } from './economy';
import { detectLang } from '../i18n';
import type { MetaState, ModId, RunState, Settings, Stats } from './types';

const SAVE_KEY = 'beatfoundry.save.v1';
const SETTINGS_KEY = 'beatfoundry.settings.v1';

export interface SaveData {
  v: 1;
  time: number;
  run: RunState;
  meta: MetaState;
  stats: Stats;
  hints: string[];
}

export const defaultMeta = (): MetaState => ({ gold: 0, records: [], upgrades: {}, completed: false, casts: 0 });

export const defaultStats = (): Stats => ({
  playTime: 0, totalSparks: 0, strikes: 0, perfects: 0, drops: 0, flares: 0, bestDrop: 0,
});

export function defaultSettings(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    master: 0.8, music: 0.85, sfx: 0.8,
    shake: reduce ? 0 : 0.6, flash: reduce ? 0.2 : 0.7,
    reducedMotion: reduce, inputOffsetMs: 0, hints: true,
    guide: true, lang: detectLang(), quality: 'auto',
  };
}

const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

function sanitizeRun(raw: unknown, meta: MetaState): RunState {
  const r = (raw ?? {}) as Partial<RunState>;
  const track = num(r.track, 0, 0, TRACKS.length - 1) | 0;
  const base = newRun(track, meta);
  const notes = emptyNotes();
  const t = TRACKS[track];
  for (const k of Object.keys(notes) as (keyof typeof notes)[]) {
    const max = t.sockets[k]?.length ?? 0;
    notes[k] = num(r.notes?.[k], base.notes[k], 0, max) | 0;
  }
  if (notes.kick < 1) notes.kick = 1;
  const validMods = new Set(MODS.map((m) => m.id));
  const mods = Array.isArray(r.mods) ? (r.mods.filter((m) => validMods.has(m as ModId)) as ModId[]) : [];
  return {
    track,
    sparks: num(r.sparks, 0, 0),
    earned: num(r.earned, 0, 0),
    notes,
    mods: [...new Set(mods)],
    heat: num(r.heat, 0, 0, 100),
    lit: typeof r.lit === 'boolean' ? r.lit : notes.clap > 0,
    drops: num(r.drops, 0, 0) | 0,
    perfectDrops: num(r.perfectDrops, 0, 0) | 0,
    flaresSeen: num(r.flaresSeen, 0, 0) | 0,
    flaresCaught: num(r.flaresCaught, 0, 0) | 0,
    autoBuy: typeof r.autoBuy === 'boolean' ? r.autoBuy : true,
    bars: num(r.bars, 0, 0) | 0,
  };
}

function sanitizeMeta(raw: unknown): MetaState {
  const m = (raw ?? {}) as Partial<MetaState>;
  const d = defaultMeta();
  const upgrades: MetaState['upgrades'] = {};
  if (m.upgrades && typeof m.upgrades === 'object') {
    for (const [k, v] of Object.entries(m.upgrades)) upgrades[k as keyof typeof upgrades] = num(v, 0, 0, 5) | 0;
  }
  return {
    gold: num(m.gold, d.gold, 0),
    records: Array.isArray(m.records) ? [...new Set(m.records.filter((x) => typeof x === 'number' && x >= 0 && x < TRACKS.length))] : [],
    upgrades,
    completed: !!m.completed,
    casts: num(m.casts, 0, 0) | 0,
  };
}

function sanitizeStats(raw: unknown): Stats {
  const s = (raw ?? {}) as Partial<Stats>;
  const d = defaultStats();
  return {
    playTime: num(s.playTime, d.playTime, 0),
    totalSparks: num(s.totalSparks, 0, 0),
    strikes: num(s.strikes, 0, 0),
    perfects: num(s.perfects, 0, 0),
    drops: num(s.drops, 0, 0),
    flares: num(s.flares, 0, 0),
    bestDrop: num(s.bestDrop, 0, 0),
  };
}

export function parseSave(json: string): SaveData | null {
  try {
    const raw = JSON.parse(json) as Partial<SaveData>;
    if (!raw || raw.v !== 1) return null;
    const meta = sanitizeMeta(raw.meta);
    return {
      v: 1,
      time: num(raw.time, Date.now()),
      run: sanitizeRun(raw.run, meta),
      meta,
      stats: sanitizeStats(raw.stats),
      hints: Array.isArray(raw.hints) ? raw.hints.filter((h) => typeof h === 'string') : [],
    };
  } catch {
    return null;
  }
}

export function loadSave(): SaveData | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? parseSave(s) : null;
  } catch {
    return null;
  }
}

export function writeSave(data: Omit<SaveData, 'v' | 'time'>): void {
  try {
    const out: SaveData = { v: 1, time: Date.now(), ...data };
    localStorage.setItem(SAVE_KEY, JSON.stringify(out));
  } catch {
    // storage full or blocked: the game keeps running
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw) return d;
    return {
      master: num(raw.master, d.master, 0, 1),
      music: num(raw.music, d.music, 0, 1),
      sfx: num(raw.sfx, d.sfx, 0, 1),
      shake: num(raw.shake, d.shake, 0, 1),
      flash: num(raw.flash, d.flash, 0, 1),
      reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : d.reducedMotion,
      inputOffsetMs: num(raw.inputOffsetMs, 0, -200, 200),
      hints: typeof raw.hints === 'boolean' ? raw.hints : true,
      guide: typeof raw.guide === 'boolean' ? raw.guide : true,
      lang: raw.lang === 'ko' || raw.lang === 'en' ? raw.lang : d.lang,
      quality: raw.quality === 'high' || raw.quality === 'low' || raw.quality === 'auto' ? raw.quality : 'auto',
    };
  } catch {
    return d;
  }
}

export function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
