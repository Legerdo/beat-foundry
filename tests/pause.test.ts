import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/save';

describe('independent pause reasons', () => {
  it('keeps open settings paused when focus returns', () => {
    const game = new Game(null, defaultSettings());
    game.setFocused(false);
    expect(game.paused).toBe(true);
    game.setPaused(true);
    game.setFocused(true);
    expect(game.paused).toBe(true);
    game.setPaused(false);
    expect(game.paused).toBe(false);
  });

  it('keeps focus loss paused when settings close', () => {
    const game = new Game(null, defaultSettings());
    game.setPaused(true);
    game.setFocused(false);
    game.setPaused(false);
    expect(game.paused).toBe(true);
    game.setFocused(false);
    expect(game.paused).toBe(true);
    game.setFocused(true);
    expect(game.paused).toBe(false);
  });
});
