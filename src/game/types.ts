export type LayerId = 'kick' | 'hat' | 'clap' | 'bass' | 'chord' | 'lead' | 'bells' | 'choir';

export type Section =
  | 'groove'
  | 'build'
  | 'drop'
  | 'break'
  | 'castbuild'
  | 'finale'
  | 'outro'
  | 'end';

export type ModId =
  | 'openhat'
  | 'echo'
  | 'sidechain'
  | 'autopour'
  | 'catcher'
  | 'cathedral'
  | 'subdrop'
  | 'supersaw'
  | 'octave'
  | 'tape'
  | 'swing'
  | 'cascade'
  | 'keychange';

export type MetaId =
  | 'warm'
  | 'overtone'
  | 'bellows'
  | 'anvil'
  | 'apprentice'
  | 'crucible'
  | 'longpour'
  | 'lens';

export type NoteCounts = Record<LayerId, number>;

/** State of the current track (run). Reset on every cast. */
export interface RunState {
  track: number;
  sparks: number;
  earned: number;
  notes: NoteCounts;
  mods: ModId[];
  heat: number;
  lit: boolean;
  drops: number;
  perfectDrops: number;
  flaresSeen: number;
  flaresCaught: number;
  autoBuy: boolean;
  bars: number;
}

/** Permanent progress across tracks. */
export interface MetaState {
  gold: number;
  records: number[];
  upgrades: Partial<Record<MetaId, number>>;
  completed: boolean;
  casts: number;
}

export interface Stats {
  playTime: number;
  totalSparks: number;
  strikes: number;
  perfects: number;
  drops: number;
  flares: number;
  bestDrop: number;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  shake: number;
  flash: number;
  reducedMotion: boolean;
  inputOffsetMs: number;
  hints: boolean;
  /** Approach ring. */
  guide: boolean;
  lang: 'en' | 'ko';
  quality: 'auto' | 'high' | 'low';
}

export type Judge = 'perfect' | 'good' | 'miss';
