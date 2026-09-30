import './style.css';
import { Game } from './game/game';
import { loadSave, loadSettings } from './game/save';
import type { LayerId } from './game/types';
import { setLang } from './i18n';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';

const save = loadSave();
const settings = loadSettings();
setLang(settings.lang);
const game = new Game(save, settings);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas, game);
const hud = new Hud(game, renderer);
game.fx.push(renderer, hud);

// ------------------------------------------------------------ title screen

const title = document.getElementById('title')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
hud.renderTitle(save);

let starting = false;
async function begin(): Promise<void> {
  if (starting || game.started) return;
  starting = true;
  title.classList.add('gone');
  await game.start();
  window.setTimeout(() => (title.hidden = true), 900);
  if (game.castResult) hud.openFoundry();
}
startBtn.addEventListener('click', () => void begin());

// ------------------------------------------------------------ input

const STRIKE_KEYS = new Set([' ', 'f', 'j', 'd', 'k']);
const MOD_KEYS: Record<string, number> = { q: 0, w: 1, e: 2 };

/** A control the player reached with the keyboard (Tab), not one left focused by a click. */
function keyboardFocused(): boolean {
  const f = document.activeElement;
  if (!(f instanceof HTMLButtonElement || f instanceof HTMLInputElement)) return false;
  try {
    return f.matches(':focus-visible');
  } catch {
    return false;
  }
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (hud.modalOpen) {
      hud.handleModalKey(e);
      return;
    }
    if (game.paused) return;
    if (!game.started) {
      if (e.key === 'Tab') return;
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.id === 'title-lang') return;
      e.preventDefault();
      void begin();
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (STRIKE_KEYS.has(k)) {
      e.preventDefault();
      if (!e.repeat) game.strike(e.timeStamp);
      return;
    }
    if (e.repeat) return;
    if (k === 'Enter') {
      if (keyboardFocused()) return; // let the focused control handle it
      e.preventDefault();
      hud.pour();
    } else if (/^[1-8]$/.test(k)) {
      const layer = game.track.layers[Number(k) - 1] as LayerId | undefined;
      if (layer) game.buyNote(layer);
    } else if (k in MOD_KEYS) {
      hud.buyModSlot(MOD_KEYS[k]);
    } else if (k === 'c') {
      hud.castClick();
    } else if (k === 'm') {
      hud.toggleMute();
    } else if (k === 'Escape') {
      hud.handleEscape();
    }
  },
  { capture: true },
);

// Keep SPACE from also "clicking" a focused button.
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && game.started && !hud.modalOpen) e.preventDefault();
}, { capture: true });

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || hud.modalOpen || game.paused) return;
  if (!game.started) {
    void begin();
    return;
  }
  game.strike(e.timeStamp);
});

const syncFocus = () => {
  game.setFocused(document.hasFocus());
  hud.syncPause();
};
window.addEventListener('blur', () => {
  game.setFocused(false);
  hud.syncPause();
});
window.addEventListener('focus', syncFocus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onHidden();
  else {
    game.setFocused(document.hasFocus());
    game.onVisible();
  }
  hud.syncPause();
});
syncFocus();
window.addEventListener('pagehide', () => game.save());
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => renderer.resize());
});

// ------------------------------------------------------------ loop

let last = performance.now();
// Main-thread work per frame (update + render + HUD), for the dev probe.
const work = new Float32Array(240);
let workIdx = 0;
function frame(ts: number): void {
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
  last = ts;
  const t0 = performance.now();
  game.update(dt);
  renderer.render(dt);
  hud.frame(dt);
  work[workIdx++ % work.length] = performance.now() - t0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------ dev hooks (?dev)

if (new URLSearchParams(location.search).has('dev')) {
  const w = window as unknown as Record<string, unknown>;
  w.bf = {
    game,
    renderer,
    hud,
    give: (n: number) => (game.run.sparks += n),
    heat: () => (game.run.heat = 100),
    fill: (upTo = 99) => {
      for (const l of game.track.layers) game.run.notes[l] = Math.min(upTo, game.track.sockets[l]!.length);
      game.run.lit = true;
    },
    notes: (layer: LayerId, n: number) => {
      game.run.notes[layer] = n;
      if (layer === 'clap' && n > 0) game.run.lit = true;
    },
    mods: (...ids: string[]) => game.run.mods.push(...(ids as never[])),
    track: (i: number) => game.startTrack(i),
    levels: () => game.engine?.levels(),
    /** Frame work in ms over the last 240 frames: mean, p95, max. */
    perf: () => {
      const s = [...work].sort((a, b) => a - b);
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      return {
        mean: +mean.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2),
        scale: renderer.renderScale,
      };
    },
    begin,
  };
}
