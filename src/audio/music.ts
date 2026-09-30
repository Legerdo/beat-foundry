// The arranger: turns the machine the player has built into notes for one 16th step.
// Pure functions, so harmony and arrangement rules are testable without audio.
import { TRACKS, type TrackDef } from '../game/defs';
import type { LayerId, ModId, NoteCounts, Section } from '../game/types';
import type { Voice } from './engine';

export interface ArrangeCtx {
  track: TrackDef;
  notes: NoteCounts;
  mods: readonly ModId[];
  section: Section;
  sectionBar: number;
  sectionLen: number;
  /** Bar within the 4-bar chord loop. */
  prog: number;
  /** Bar within the 8-bar phrase. */
  phrase: number;
  step: number;
  stepDur: number;
  transpose: number;
  /** Groove bar right after a drop or at phrase start gets a crash. */
  crash: boolean;
}

export interface NoteEv {
  voice: Voice | null;
  layer: LayerId | null;
  /** Index into the layer's socket list (for visuals). */
  socket: number;
  /** Seconds after the step time. */
  offset: number;
  /** Share of the note's value this event earns. 0 = decoration. */
  earn: number;
  target?: boolean;
  kick?: boolean;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function degSemis(t: TrackDef, deg: number): number {
  return 12 * Math.floor(deg / 7) + t.scale[mod(deg, 7)];
}

/** Place a MIDI note into the octave window [lo, lo + 12). */
function inWindow(m: number, lo: number): number {
  return lo + mod(m - lo, 12);
}

export function chordRoot(t: TrackDef, prog: number): number {
  return t.progression[mod(prog, t.progression.length)];
}

/** Chord tones as MIDI notes voiced inside a window. Adds the 7th when it is a minor 7th. */
export function chordMidis(t: TrackDef, root: number, lo: number, transpose: number, seventh = true, major = false): number[] {
  const degs = [root, root + 2, root + 4];
  const semis = degs.map((d) => degSemis(t, d));
  if (major) semis[1] = semis[0] + 4;
  const sev = degSemis(t, root + 6);
  if (seventh && !major && mod(sev - semis[0], 12) === 10) semis.push(sev);
  return semis.map((s) => inWindow(t.tonic + s + transpose, lo)).sort((a, b) => a - b);
}

function bassMidi(t: TrackDef, root: number, offset: number, transpose: number): number {
  const r = inWindow(t.tonic + degSemis(t, root) + transpose, 38);
  return r + degSemis(t, root + offset) - degSemis(t, root);
}

function leadDegrees(t: TrackDef, prog: number, turn: boolean): number[] {
  return turn ? t.lead.turn : t.lead.bars[mod(prog, 4)];
}

/** Degree of a quoted melody from another track, re-harmonised for this track's chords. */
function quoteDegrees(from: TrackDef, to: TrackDef, prog: number): number[] {
  const b = mod(prog, 4);
  const shift = chordRoot(to, prog) - chordRoot(from, b);
  return from.lead.bars[b].map((d) => d + shift);
}

function gapAfter(steps: number[], step: number): number {
  const i = steps.indexOf(step);
  const next = i + 1 < steps.length ? steps[i + 1] : steps[0] + 16;
  return next - step;
}

const ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 2];

export function isDropSection(s: Section): boolean {
  return s === 'drop' || s === 'finale';
}

export function arrangeStep(a: ArrangeCtx): NoteEv[] {
  const { track: t, notes, section, step } = a;
  const out: NoteEv[] = [];
  if (section === 'end') return out;
  const has = (m: ModId) => a.mods.includes(m);
  const drop = isDropSection(section);
  const building = section === 'build' || section === 'castbuild';
  const lastBuildBar = building && a.sectionBar === a.sectionLen - 1;
  const tr = a.transpose;
  const root = chordRoot(t, a.prog);

  if (section === 'outro') return arrangeOutro(a, root);
  if (building && lastBuildBar && step >= 12) return out; // the silence before the drop

  const socketIndex = (layer: LayerId): number => {
    const s = t.sockets[layer];
    if (!s) return -1;
    const i = s.indexOf(step);
    return i >= 0 && i < notes[layer] ? i : -1;
  };
  const push = (layer: LayerId | null, socket: number, voice: Voice | null, extra: Partial<NoteEv> = {}) => {
    out.push({ voice, layer, socket, offset: 0, earn: layer ? 1 : 0, ...extra });
  };
  const echo = (layer: LayerId, socket: number) => {
    out.push({ voice: null, layer, socket, offset: a.stepDur * 3, earn: 0.5 });
  };

  // ---- kick
  const k = socketIndex('kick');
  if (k >= 0 && section !== 'break') {
    const quarter = step % 4 === 0;
    if (!building || (quarter && !lastBuildBar)) {
      push('kick', k, {
        inst: 'kick', midi: [36], vel: 0.95, dur: 0.4, drop, kit: t.kit,
        bright: drop && has('subdrop') ? 1 : 0,
      }, { kick: true });
    }
  }

  // ---- hats
  const h = socketIndex('hat');
  if (h >= 0 && section !== 'break') {
    const off8 = step % 4 === 2;
    const open = has('openhat') && off8;
    const vel = (off8 ? 0.2 : 0.11) * (open ? 1.05 : 1) * (building ? 0.8 : 1) * (drop ? 1.15 : 1);
    push('hat', h, { inst: 'hat', midi: [0], vel, dur: 0.05, open, drop, pan: step % 2 ? 0.3 : -0.18 });
  }

  // ---- clap / snare
  const c = socketIndex('clap');
  if (c >= 0 && !building && section !== 'break') {
    const back = step === 4 || step === 12;
    const e = has('echo') && back;
    push('clap', c, { inst: 'clap', midi: [0], vel: back ? 0.55 : 0.2, dur: 0.2, drop, kit: t.kit, echo: e });
    if (e) echo('clap', c);
  }

  // ---- groove fills and crashes
  if (section === 'groove') {
    if (a.phrase === 7 && notes.clap >= 2 && step >= 13) {
      push(null, -1, { inst: 'roll', midi: [0], vel: 0.18 + (step - 13) * 0.08, dur: 0.1, bright: (step - 13) / 3 });
    }
    if (a.crash && step === 0 && notes.hat >= 4) push(null, -1, { inst: 'crash', midi: [0], vel: 0.18, dur: 1 });
  }
  if (drop && step === 0 && a.sectionBar % 4 === 0 && a.sectionBar > 0) {
    push(null, -1, { inst: 'crash', midi: [0], vel: 0.26, dur: 1 });
  }

  // ---- bass
  const b = socketIndex('bass');
  if (b >= 0 && !building && section !== 'break') {
    const off = t.bassShape[step] ?? 0;
    const dur = Math.min(0.32, a.stepDur * (drop ? 1.6 : 1.8));
    push('bass', b, { inst: 'bass', midi: [bassMidi(t, root, off, tr)], vel: drop ? 0.3 : 0.34, dur, drop });
  }

  // ---- chords: socket 0 is a pad held for the bar, the rest are stabs
  const ch = socketIndex('chord');
  if (ch >= 0) {
    if (step === 0) {
      const pad = chordMidis(t, root, 55, tr);
      const big = drop && has('supersaw');
      push('chord', ch, {
        inst: 'pad', midi: big ? [...pad, pad[0] + 12] : pad,
        vel: big ? 0.05 : section === 'break' ? 0.07 : 0.06,
        dur: a.stepDur * 16 * (section === 'break' ? 1.2 : 0.96), drop: big,
      });
    } else if (!building && section !== 'break') {
      push('chord', ch, { inst: 'stab', midi: chordMidis(t, root, 60, tr, false), vel: drop ? 0.075 : 0.07, dur: 0.2, drop });
    }
  }

  // ---- lead
  const l = socketIndex('lead');
  if (l >= 0 && section !== 'break' && !lastBuildBar) {
    const i = t.lead.steps.indexOf(step);
    const turn = drop ? a.sectionBar % 8 === 7 : section === 'groove' && a.phrase === 7;
    const deg = leadDegrees(t, a.prog, turn)[i];
    const dur = Math.min(0.45, gapAfter(t.lead.steps, step) * a.stepDur * 0.9);
    const e = has('echo');
    push('lead', l, {
      inst: 'lead', midi: [t.leadBase + degSemis(t, deg) + tr], vel: drop ? 0.13 : 0.15, dur, drop,
      octave: has('octave'), echo: e,
    });
    if (e) echo('lead', l);
  }

  // ---- bells: an arpeggio over the chord
  const be = socketIndex('bells');
  if (be >= 0) {
    const tones = [0, 2, 4];
    const idx = ARP[step];
    const deg = root + tones[idx % 3] + 7 * Math.floor(idx / 3);
    const midi = inWindow(t.tonic + degSemis(t, root) + tr, 67) + degSemis(t, deg) - degSemis(t, root);
    const e = has('cascade');
    push('bells', be, {
      inst: 'bell', midi: [midi], vel: (drop ? 0.1 : 0.085) * (section === 'break' ? 0.7 : 1), dur: 0.3,
      drop, pan: step % 2 ? 0.4 : -0.4, echo: e,
    });
    if (e) echo('bells', be);
  }

  // ---- choir
  const co = socketIndex('choir');
  if (co >= 0) {
    const triad = chordMidis(t, root, 57, tr, false);
    if (step === 0) {
      push('choir', co, { inst: 'choir', midi: triad, vel: drop ? 0.1 : 0.085, dur: a.stepDur * 15 });
    } else if (step === 8 && !lastBuildBar) {
      push('choir', co, { inst: 'choir', midi: [triad[1] + 12], vel: 0.07, dur: a.stepDur * 7 });
    } else if (!building && section !== 'break') {
      push('choir', co, { inst: 'choir', midi: triad.map((m) => m + 12), vel: 0.07, dur: a.stepDur * 1.5 });
    }
  }

  // ---- build: the snare roll whose hits are charge targets
  if (building) {
    const len = a.sectionLen;
    const bar = a.sectionBar;
    const progress = (bar * 16 + step) / (len * 16);
    let hit = false;
    let target = false;
    if (len <= 2) {
      hit = bar === 0 ? step % 4 === 0 : step % 2 === 0;
      target = hit;
    } else {
      const fromEnd = len - bar;
      if (fromEnd >= 4) hit = step % 8 === 0;
      else if (fromEnd === 3) hit = step % 4 === 0;
      else if (fromEnd === 2) hit = step % 2 === 0;
      else hit = true;
      target = hit && step % 2 === 0;
    }
    if (hit) {
      push(null, -1, { inst: 'roll', midi: [0], vel: 0.16 + 0.34 * progress, dur: 0.1, bright: progress }, { target });
    }
  }

  // ---- finale: quotes from the records already cast, and a key change for the last act
  if (section === 'finale') {
    const quotes: { from: TrackDef; inst: 'bell' | 'call'; shift: number }[] = [];
    const bar = a.sectionBar;
    if (t.index >= 1 && bar >= 4 && (bar < 8 || bar >= 12)) quotes.push({ from: TRACKS[0], inst: 'bell', shift: 12 });
    if (t.index >= 2 && bar >= 8) quotes.push({ from: TRACKS[1], inst: 'call', shift: -12 });
    for (const q of quotes) {
      const qi = q.from.lead.steps.indexOf(step);
      if (qi < 0) continue;
      const deg = quoteDegrees(q.from, t, a.prog)[qi];
      const dur = Math.min(0.5, gapAfter(q.from.lead.steps, step) * a.stepDur * 0.95);
      push(null, -1, {
        inst: q.inst, midi: [t.leadBase + degSemis(t, deg) + q.shift + tr],
        vel: q.inst === 'bell' ? 0.085 : 0.11, dur, drop: q.inst === 'bell', pan: q.inst === 'bell' ? 0.25 : -0.2,
      });
    }
  }

  return out;
}

/** Final bars: a major tonic chord (the Picardy third) ringing out. */
function arrangeOutro(a: ArrangeCtx, root: number): NoteEv[] {
  const t = a.track;
  const out: NoteEv[] = [];
  if (a.sectionBar !== 0) return out;
  const tr = a.transpose;
  const push = (voice: Voice) => out.push({ voice, layer: null, socket: -1, offset: 0, earn: 0 });
  if (a.step === 0) {
    const chord = chordMidis(t, root, 55, tr, false, true);
    push({ inst: 'pad', midi: [...chord, chord[0] + 12], vel: 0.075, dur: a.stepDur * 28, drop: true });
    push({ inst: 'bass', midi: [inWindow(t.tonic + tr, 38)], vel: 0.32, dur: a.stepDur * 12 });
    push({ inst: 'kick', midi: [36], vel: 0.95, dur: 0.5, drop: true, kit: t.kit, bright: 1 });
    push({ inst: 'crash', midi: [0], vel: 0.3, dur: 2 });
    if (a.notes.choir > 0) push({ inst: 'choir', midi: chord.map((m) => m + 12), vel: 0.1, dur: a.stepDur * 26 });
  }
  if (a.step % 2 === 0) {
    const chord = chordMidis(t, root, 67, tr, false, true);
    const tones = [...chord, chord[0] + 12, chord[1] + 12];
    const m = tones[(a.step / 2) % tones.length];
    push({ inst: 'bell', midi: [m], vel: 0.07 * (1 - a.step / 20), dur: 0.4, pan: a.step % 4 ? 0.35 : -0.35 });
  }
  return out;
}
