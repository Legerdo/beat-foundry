import type { LayerId, MetaId, ModId, RunState } from './types';

export const LAYER_ORDER: LayerId[] = ['kick', 'hat', 'clap', 'bass', 'chord', 'lead', 'bells', 'choir'];

export interface LayerInfo {
  id: LayerId;
  name: string;
  color: string;
  /** Sparks earned each time one of this layer's notes sounds. */
  value: number;
  baseCost: number;
  growth: number;
}

// Warm colors are rhythm, cool colors are pitch. Heat radiates outward from the crucible.
export const LAYERS: Record<LayerId, LayerInfo> = {
  kick: {
    id: 'kick', name: 'KICK', color: '#ff4a2a',
    value: 1, baseCost: 7, growth: 2.1,
  },
  hat: {
    id: 'hat', name: 'HAT', color: '#ff9a3c',
    value: 3, baseCost: 30, growth: 1.42,
  },
  clap: {
    id: 'clap', name: 'CLAP', color: '#ffd35a',
    value: 16, baseCost: 350, growth: 1.9,
  },
  bass: {
    id: 'bass', name: 'BASS', color: '#36d6b0',
    value: 90, baseCost: 5000, growth: 1.8,
  },
  chord: {
    id: 'chord', name: 'CHORD', color: '#4fb4ff',
    value: 700, baseCost: 1e5, growth: 2.0,
  },
  lead: {
    id: 'lead', name: 'LEAD', color: '#a18cff',
    value: 5200, baseCost: 1.5e6, growth: 1.7,
  },
  bells: {
    id: 'bells', name: 'BELLS', color: '#ef9bff',
    value: 3.5e4, baseCost: 3.0e7, growth: 1.45,
  },
  choir: {
    id: 'choir', name: 'CHOIR', color: '#f4f1ff',
    value: 6.0e5, baseCost: 1.2e9, growth: 2.6,
  },
};

export type Kit = 'house' | 'break' | 'anthem';

export interface TrackDef {
  index: number;
  name: string;
  bpm: number;
  kit: Kit;
  /** MIDI note of the tonic used as degree 0 for harmony. */
  tonic: number;
  /** MIDI note of degree 0 for the lead melody. */
  leadBase: number;
  scale: number[];
  /** Chord root per bar, as scale degrees relative to the tonic (4-bar loop). */
  progression: number[];
  layers: LayerId[];
  /** Steps (0..15) each layer can occupy, in the order they are forged. */
  sockets: Partial<Record<LayerId, number[]>>;
  /** Lead melody: steps sorted ascending and degrees per bar (4 bars + phrase-ending variant). */
  lead: { steps: number[]; bars: number[][]; turn: number[] };
  /** Bass: scale-degree offset from the chord root for specific steps. */
  bassShape: Record<number, number>;
  castCost: number;
  castDropBars: number;
  /** Multiplies every note and mod price on this track. */
  costScale: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const TRACKS: TrackDef[] = [
  {
    index: 0,
    name: 'IGNITION',
    bpm: 100,
    kit: 'house',
    tonic: 57,
    leadBase: 69,
    scale: MINOR,
    progression: [0, -2, 2, -1], // Am F C G
    layers: ['kick', 'hat', 'clap', 'bass', 'chord', 'lead'],
    sockets: {
      kick: [0, 8, 4, 12, 14],
      hat: [2, 10, 6, 14, 15, 7, 11, 3, 13, 5, 9, 1],
      clap: [4, 12, 15, 10, 7, 13],
      bass: [2, 10, 6, 14, 7, 15, 11, 3],
      chord: [0, 6, 14, 3, 11, 9],
      lead: [0, 8, 6, 3, 12, 10, 14],
    },
    lead: {
      steps: [0, 3, 6, 8, 10, 12, 14],
      bars: [
        [4, 0, 2, 4, 3, 2, 1],
        [2, -2, 0, 2, 3, 2, 0],
        [4, -1, 2, 4, 5, 4, 3],
        [3, -1, 1, 3, 4, 3, 1],
      ],
      turn: [3, -1, 1, 3, 4, 6, 7],
    },
    bassShape: { 7: 4, 15: 7, 3: 7 },
    castCost: 1.2e8,
    castDropBars: 8,
    costScale: 1,
  },
  {
    index: 1,
    name: 'TEMPER',
    bpm: 112,
    kit: 'break',
    tonic: 62,
    leadBase: 74,
    scale: MINOR,
    progression: [0, 3, -1, 2], // Dm Gm C F
    layers: ['kick', 'hat', 'clap', 'bass', 'chord', 'lead', 'bells'],
    sockets: {
      kick: [0, 10, 3, 8, 14],
      hat: [2, 6, 10, 14, 0, 4, 8, 12, 7, 15, 11, 3],
      clap: [4, 12, 7, 15, 13, 6],
      bass: [0, 10, 3, 8, 14, 6, 11, 15],
      chord: [0, 7, 13, 10, 3, 5],
      lead: [0, 4, 10, 7, 12, 2, 14],
      bells: [0, 8, 4, 12, 2, 10, 6, 14, 3, 11, 7, 15],
    },
    lead: {
      steps: [0, 2, 4, 7, 10, 12, 14],
      bars: [
        [-3, 0, 2, 1, 0, -1, -3],
        [-2, 0, 3, 2, 0, -1, -2],
        [-4, -1, 1, 0, -1, -2, -4],
        [-3, -1, 2, 1, 2, 4, 3],
      ],
      turn: [-3, -1, 2, 3, 4, 6, 7],
    },
    bassShape: { 8: 7, 14: 4, 6: 7, 15: 2 },
    castCost: 2.4e9,
    castDropBars: 8,
    costScale: 3,
  },
  {
    index: 2,
    name: 'OPUS',
    bpm: 124,
    kit: 'anthem',
    tonic: 64,
    leadBase: 76,
    scale: MINOR,
    progression: [-2, -1, 0, 0], // C D Em Em
    layers: ['kick', 'hat', 'clap', 'bass', 'chord', 'lead', 'bells', 'choir'],
    sockets: {
      kick: [0, 8, 4, 12, 14],
      hat: [2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],
      clap: [4, 12, 14, 15, 7, 11],
      bass: [2, 10, 6, 14, 3, 11, 7, 15, 1, 9, 5, 13],
      chord: [0, 10, 6, 14, 3, 12],
      lead: [0, 6, 12, 3, 10, 14],
      bells: [0, 8, 4, 12, 2, 10, 6, 14, 3, 11, 7, 15],
      choir: [0, 8, 4, 12],
    },
    lead: {
      steps: [0, 3, 6, 10, 12, 14],
      bars: [
        [2, 0, -2, 0, 2, 3],
        [3, 1, -1, 1, 3, 4],
        [4, 2, 0, 2, 4, 6],
        [4, 3, 2, 1, 0, -1],
      ],
      turn: [4, 6, 7, 6, 4, 2],
    },
    bassShape: { 3: 7, 7: 7, 11: 7, 15: 7 },
    castCost: 4e11,
    castDropBars: 16,
    costScale: 18,
  },
];

export type ModNeed = { layer: LayerId; n: number } | { drops: number } | { flares: number };

export function needMet(r: RunState, need: ModNeed): boolean {
  if ('layer' in need) return r.notes[need.layer] >= need.n;
  if ('drops' in need) return r.drops >= need.drops;
  return r.flaresSeen >= need.flares;
}

export interface ModDef {
  id: ModId;
  name: string;
  cost: number;
  layer: LayerId | null;
  tracks?: number[];
  need: ModNeed;
}

export const MODS: ModDef[] = [
  {
    id: 'openhat', name: 'OPEN HATS', layer: 'hat', cost: 600,
    need: { layer: 'hat', n: 4 },
  },
  {
    id: 'echo', name: 'ECHO CHAMBER', layer: 'clap', cost: 8000,
    need: { layer: 'clap', n: 3 },
  },
  {
    id: 'sidechain', name: 'SIDECHAIN PUMP', layer: 'bass', cost: 6e4,
    need: { layer: 'bass', n: 2 },
  },
  {
    id: 'autopour', name: 'AUTO-POUR', layer: null, cost: 1.2e5,
    need: { drops: 2 },
  },
  {
    id: 'catcher', name: 'FLARE CATCHER', layer: null, cost: 2e5,
    need: { flares: 3 },
  },
  {
    id: 'cathedral', name: 'CATHEDRAL', layer: 'chord', cost: 8e5,
    need: { layer: 'chord', n: 2 },
  },
  {
    id: 'subdrop', name: 'SUB PRESSURE', layer: 'bass', cost: 1.5e6,
    need: { layer: 'bass', n: 6 },
  },
  {
    id: 'supersaw', name: 'SUPERSAW WALL', layer: 'chord', cost: 6e6,
    need: { layer: 'chord', n: 4 },
  },
  {
    id: 'octave', name: 'OCTAVE SPLIT', layer: 'lead', cost: 4e7,
    need: { layer: 'lead', n: 3 },
  },
  {
    id: 'tape', name: 'TAPE SATURATION', layer: null, cost: 1.5e8,
    need: { layer: 'lead', n: 6 },
  },
  {
    id: 'swing', name: 'SWING', layer: 'hat', cost: 3e4, tracks: [1],
    need: { layer: 'hat', n: 6 },
  },
  {
    id: 'cascade', name: 'BELL CASCADE', layer: 'bells', cost: 1.2e9, tracks: [1, 2],
    need: { layer: 'bells', n: 6 },
  },
  {
    id: 'keychange', name: 'KEY CHANGE', layer: 'choir', cost: 7e9, tracks: [2],
    need: { layer: 'choir', n: 2 },
  },
];

export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m])) as Record<ModId, ModDef>;

export interface MetaDef {
  id: MetaId;
  name: string;
  costs: number[];
}

export const METAS: MetaDef[] = [
  { id: 'warm', name: 'WARM START', costs: [2] },
  { id: 'overtone', name: 'OVERTONES', costs: [2, 4, 8] },
  { id: 'bellows', name: 'BELLOWS', costs: [2, 4] },
  { id: 'anvil', name: 'TUNED ANVIL', costs: [2] },
  { id: 'apprentice', name: 'APPRENTICE', costs: [3] },
  { id: 'crucible', name: 'DEEP CRUCIBLE', costs: [3, 5] },
  { id: 'longpour', name: 'LONG POUR', costs: [4] },
  { id: 'lens', name: 'FLARE LENS', costs: [2] },
];

export const HEAT_MAX = 100;
export const RECORD_MULT = 3;
export const GOLD_BASE = [5, 7, 10];
export const ENCORE_GOLD = 3;
