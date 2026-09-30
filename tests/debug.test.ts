import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { TRACKS } from '../src/game/defs';
import { castCost, newRun } from '../src/game/economy';
import { defaultSettings } from '../src/game/save';

describe('explicit debug cheats', () => {
  it('rejects actions before play or while casting without changing progress', () => {
    const game = new Game(null, defaultSettings());
    const before = JSON.stringify(game.run);
    expect(game.debug('forge')).toBe(false);
    game.started = true;
    game.casting = true;
    expect(game.debug('castBudget')).toBe(false);
    expect(game.debug('gold')).toBe(false);
    expect(JSON.stringify(game.run)).toBe(before);
    expect(game.meta.gold).toBe(0);
  });

  it('forges only current-track sockets and grants only current-track mods once', () => {
    const game = new Game(null, defaultSettings());
    game.started = true;
    for (const track of [0, 1, 2]) {
      game.run = newRun(track, game.meta);
      expect(game.debug('forge')).toBe(true);
      for (const layer of TRACKS[track].layers) expect(game.run.notes[layer]).toBe(TRACKS[track].sockets[layer]!.length);
      if (track < 2) expect(game.run.notes.choir).toBe(0);
      expect(game.debug('mods')).toBe(true);
      const mods = [...game.run.mods];
      game.debug('mods');
      expect(game.run.mods).toEqual(mods);
      expect(mods.includes('keychange')).toBe(track === 2);
      expect(mods.includes('swing')).toBe(track === 1);
    }
  });

  it('grants resources and casting budget without faking earned rewards or records', () => {
    const game = new Game(null, defaultSettings());
    game.started = true;
    const stats = { ...game.stats };
    game.debug('sparksSmall');
    game.debug('sparksLarge');
    expect(game.run.sparks).toBe(1001000000);
    game.debug('castBudget');
    expect(game.run.sparks).toBeGreaterThanOrEqual(castCost(game.run));
    expect(game.run.sparks).toBe(1001000000);
    game.run.track = 2;
    game.debug('castBudget');
    expect(game.run.sparks).toBe(castCost(game.run));
    game.debug('heat');
    game.debug('gold');
    expect(game.run.heat).toBe(100);
    expect(game.run.lit).toBe(true);
    expect(game.meta.gold).toBe(10);
    expect(game.run.earned).toBe(0);
    expect(game.meta.records).toEqual([]);
    expect(game.stats).toEqual(stats);
  });
});
