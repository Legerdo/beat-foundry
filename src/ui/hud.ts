import { LAYERS, METAS, MODS, RECORD_MULT, TRACKS, needMet, type ModDef, type ModNeed } from '../game/defs';
import {
  allLayersUnlocked, barBreakdown, barDuration, castCost, cheapestNote, isForged, layerVisible, metaCost,
  metaLevel, modAvailable, modCost, nextGoal, noteCost, pendingMods, perSecond, sockets,
} from '../game/economy';
import type { BarInfo, CastResult, Fx, Game } from '../game/game';
import type { SaveData } from '../game/save';
import type { Judge, LayerId, ModId, Settings } from '../game/types';
import { fmtShort } from '../format';
import {
  ROMAN, fmtTimeL, getLang, keyName, layerText, metaName, metaText, modName, modText, setLang, t, type Lang,
} from '../i18n';
import type { Renderer } from '../render/renderer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- write-if-changed helpers: the HUD refreshes 10x a second, most values do not change
const lastText = new WeakMap<Element, string>();
function setText(e: Element, v: string): void {
  if (lastText.get(e) !== v) {
    lastText.set(e, v);
    e.textContent = v;
  }
}
function setHTML(e: Element, v: string): void {
  if (lastText.get(e) !== v) {
    lastText.set(e, v);
    e.innerHTML = v;
  }
}
const lastStyle = new WeakMap<HTMLElement, string>();
function setFill(e: HTMLElement, frac: number): void {
  const v = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
  if (lastStyle.get(e) !== v) {
    lastStyle.set(e, v);
    e.style.transform = v;
  }
}
function setAttr(e: Element, name: string, v: string): void {
  if (e.getAttribute(name) !== v) e.setAttribute(name, v);
}

/** Clicks on a control that appeared or changed under the pointer this recently are ignored. */
const FRESH_MS = 350;
const UPGRADE_BANNER_SECONDS = 6;
const JUDGEMENT_SECONDS = 1.4;

interface Row {
  layer: LayerId;
  root: HTMLElement;
  cells: HTMLElement[];
  count: HTMLElement;
  rate: HTMLElement;
  btn: HTMLButtonElement;
  label: HTMLElement;
  cost: HTMLElement;
  cellKey: string;
}

type CoachId = 'strike' | 'forge' | 'lit' | 'pour' | 'charge' | 'flare' | 'mod' | 'cast';

interface CoachStep {
  id: CoachId;
  target: HTMLElement | null;
  progress?: string;
  key?: string;
}

export class Hud implements Fx {
  private rows: Row[] = [];
  private tick = 0;
  private modalKind: string | null = null;
  private modsKey = '';
  private modSlots: ModId[] = [];
  private shownSparks = 0;
  private coachShown = '';
  private coachTarget: HTMLElement | null = null;
  private born = new WeakMap<Element, number>();
  private benchHover = false;
  private lastBenchMove = 0;
  private castArmedUntil = 0;
  private posKey = '';
  private bannerAnim: Animation | null = null;
  private pausedAnimations: Animation[] = [];
  private toastTimer = 0;
  private lastJudge: Judge | null = null;
  private judgementUntil = 0;
  private judgementValue = 0;

  constructor(private game: Game, private renderer: Renderer) {
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-mute').addEventListener('click', () => this.toggleMute());
    $('pour').addEventListener('click', () => this.pour());
    $('cast-btn').addEventListener('click', (e) => {
      if (!this.fresh(e.currentTarget as Element)) this.castClick();
    });
    $('coach-skip').addEventListener('click', () => {
      this.game.setSettings({ ...this.game.settings, hints: false });
      this.update(true);
    });
    $('title-lang').addEventListener('click', () => this.setLanguage(getLang() === 'ko' ? 'en' : 'ko'));
    $<HTMLInputElement>('apprentice-toggle').addEventListener('change', (e) => {
      this.game.run.autoBuy = (e.target as HTMLInputElement).checked;
    });

    // Misclick protection: while the pointer is moving over the workbench, nothing on it
    // appears, disappears or moves. Deferred changes land once the pointer rests or leaves.
    const bench = $('bench');
    bench.addEventListener('pointerenter', () => {
      this.benchHover = true;
      this.lastBenchMove = performance.now();
    });
    bench.addEventListener('pointermove', () => (this.lastBenchMove = performance.now()));
    bench.addEventListener('pointerdown', () => (this.lastBenchMove = performance.now()));
    bench.addEventListener('pointerleave', () => {
      this.benchHover = false;
      this.update(false);
    });

    // A mouse click leaves focus on the button, so the next ENTER would press it again
    // instead of pouring. Drop focus after pointer clicks; keyboard focus stays.
    document.addEventListener('click', (e) => {
      if (e.detail > 0 && e.target instanceof Element) {
        const b = e.target.closest('button');
        if (b && !b.closest('#modal')) b.blur();
      }
    });

    this.applyStatic();
    this.buildRows();
  }

  get modalOpen(): boolean {
    return this.modalKind !== null;
  }

  private get frozen(): boolean {
    return this.benchHover && performance.now() - this.lastBenchMove < 1500;
  }

  private markFresh(e: Element): void {
    this.born.set(e, performance.now());
  }

  /** True if the element appeared too recently to have been aimed at. */
  private fresh(e: Element): boolean {
    const b = this.born.get(e);
    return b !== undefined && performance.now() - b < FRESH_MS;
  }

  // ------------------------------------------------------------------ language

  setLanguage(lang: Lang): void {
    setLang(lang);
    this.game.setSettings({ ...this.game.settings, lang });
    this.applyLanguage();
  }

  applyLanguage(): void {
    this.applyStatic();
    this.buildRows();
    this.modsKey = '';
    this.coachShown = '';
    this.update(true);
    if (this.modalKind === 'settings') this.openSettings();
  }

  private applyStatic(): void {
    for (const e of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      e.innerHTML = t(e.dataset.i18n as Parameters<typeof t>[0]);
    }
    for (const e of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
      const v = t(e.dataset.i18nAria as Parameters<typeof t>[0]);
      e.setAttribute('aria-label', v);
      e.title = v;
    }
    $('title-lang').textContent = t('top.lang');
    this.renderTitle(null);
  }

  private titleSave: SaveData | null = null;

  /** Title screen: continue line and button label for an existing save. */
  renderTitle(save: SaveData | null): void {
    if (save) this.titleSave = save;
    const s = this.titleSave;
    const start = $('start-btn');
    if (s && (s.run.notes.kick > 1 || s.meta.casts > 0 || s.run.earned > 0)) {
      const tr = TRACKS[s.run.track];
      start.textContent = t('title.continue');
      $('continue-line').textContent = t('title.continueLine', { n: ROMAN[tr.index], name: tr.name, r: s.meta.records.length });
    } else {
      start.textContent = t('title.start');
      $('continue-line').textContent = '';
    }
  }

  // ------------------------------------------------------------------ building

  trackStart(): void {
    this.lastJudge = null;
    this.updateJudgement();
    this.buildRows();
    this.modsKey = '';
    this.shownSparks = this.game.run.sparks;
    this.castArmedUntil = 0;
    this.update(true);
    this.renderer.resize();
  }

  private buildRows(): void {
    const g = this.game;
    const tr = g.track;
    const box = $('layers');
    box.textContent = '';
    this.rows = [];
    tr.layers.forEach((layer, i) => {
      const info = LAYERS[layer];
      const txt = layerText(layer);
      const root = el('div', 'row');
      root.style.setProperty('--c', info.color);
      root.hidden = true;
      const main = el('div', 'row-main');
      const title = el('div', 'row-title');
      const key = el('kbd', '', String(i + 1));
      key.setAttribute('aria-hidden', 'true');
      title.append(key, el('b', '', txt.name), el('span', 'role', txt.role));
      const count = el('span', 'count');
      const rate = el('span', 'rate');
      title.append(count);
      const strip = el('div', 'strip');
      strip.setAttribute('aria-hidden', 'true');
      const cells: HTMLElement[] = [];
      const socks = sockets(tr, layer);
      for (let s = 0; s < 16; s++) {
        const c = el('i');
        if (!socks.includes(s)) c.className = 'void';
        if (s % 4 === 0) c.classList.add('beat');
        strip.append(c);
        cells.push(c);
      }
      const desc = el('div', 'row-desc', txt.text);
      main.append(title, strip, desc);
      const btn = el('button', 'forge');
      const label = el('span', 'f-label', t('forge'));
      const cost = el('span', 'f-cost');
      btn.append(label, cost);
      btn.addEventListener('click', () => {
        if (!this.fresh(btn)) g.buyNote(layer);
      });
      btn.addEventListener('pointerenter', () => (this.renderer.previewLayer = layer));
      btn.addEventListener('pointerleave', () => (this.renderer.previewLayer = null));
      btn.addEventListener('focus', () => (this.renderer.previewLayer = layer));
      btn.addEventListener('blur', () => (this.renderer.previewLayer = null));
      root.addEventListener('pointerenter', () => (this.renderer.hoverLayer = layer));
      root.addEventListener('pointerleave', () => (this.renderer.hoverLayer = null));
      const side = el('div', 'row-side');
      side.append(btn, rate);
      root.append(main, side);
      box.append(root);
      this.rows.push({ layer, root, cells, count, rate, btn, label, cost, cellKey: '' });
    });
    const trd = TRACKS[g.run.track];
    setText($('t-name'), trd.name);
    setText($('t-meta'), t('track.meta', { n: ROMAN[trd.index], bpm: trd.bpm, key: keyName(trd.index) }));
  }

  // ------------------------------------------------------------------ per frame

  strike(judge: Judge, value: number): void {
    this.lastJudge = judge;
    this.judgementValue = value;
    this.judgementUntil = this.game.heardTime + JUDGEMENT_SECONDS;
    this.updateJudgement();
  }

  private updateJudgement(): void {
    const e = $('judgement');
    const active = this.lastJudge !== null && this.game.heardTime < this.judgementUntil;
    setAttr(e, 'data-active', String(active));
    if (active && this.lastJudge) {
      setAttr(e, 'data-judge', this.lastJudge);
      setText($('judgement-label'), t(`hit.${this.lastJudge}`));
      setText($('judgement-value'), `+${fmtShort(this.judgementValue)} ✦`);
      const remaining = this.judgementUntil - this.game.heardTime;
      const age = JUDGEMENT_SECONDS - remaining;
      const entry = Math.min(1, age / 0.12);
      // Audio-clock fade/pop also freezes with every pause reason.
      const opacity = String(+Math.min(entry, remaining / 0.22).toFixed(2));
      if (e.style.opacity !== opacity) e.style.opacity = opacity;
      const rise = `${((1 - entry) * 3).toFixed(1)}px`;
      if (e.style.getPropertyValue('--popup-rise') !== rise) e.style.setProperty('--popup-rise', rise);
    }
  }

  frame(dt: number): void {
    const g = this.game;
    // The audio clock freezes during settings, focus and visibility pauses.
    this.updateJudgement();
    // counter eases toward the real value so income reads as motion
    const target = g.run.sparks;
    const diff = target - this.shownSparks;
    this.shownSparks = Math.abs(diff) < 0.5 || diff < 0 ? target : this.shownSparks + diff * Math.min(1, dt * 14);
    setText($('sparks'), fmtShort(this.shownSparks));

    this.position();
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.1;
      this.update(false);
    }
  }

  private update(force: boolean): void {
    const g = this.game;
    const run = g.run;
    const tr = g.track;
    const bar = barDuration(tr);
    const meta = g.meta;
    const casting = g.casting;
    const frozen = !force && this.frozen;
    const body = document.body.classList;
    body.toggle('casting', casting);
    body.toggle('started', g.started);

    setText($('rate'), t('rate', { v: fmtShort(perSecond(run, meta) * g.audible.mult) }));

    // workbench rows
    const breakdown = barBreakdown(run, meta);
    let visibleCount = 0;
    for (const r of this.rows) {
      const n = run.notes[r.layer];
      const want = layerVisible(run, r.layer);
      if (!want) {
        r.root.hidden = true;
        continue;
      }
      if (r.root.hidden) {
        if (frozen) continue; // reveal later, never under a moving pointer
        r.root.hidden = false;
        this.markFresh(r.btn);
      }
      visibleCount++;
      const socks = sockets(tr, r.layer);
      const cost = noteCost(run, r.layer);
      const forged = isForged(run, r.layer);
      r.root.classList.toggle('locked', n === 0);
      r.root.classList.toggle('forged', forged);
      setText(r.count, `${n}/${socks.length}`);
      setText(r.rate, n > 0 ? `+${fmtShort((breakdown[r.layer] ?? 0) / bar)}/s` : '');
      const cellKey = `${n}`;
      if (cellKey !== r.cellKey) {
        r.cellKey = cellKey;
        socks.forEach((s, k) => {
          r.cells[s].classList.toggle('on', k < n);
          r.cells[s].classList.toggle('next', k === n);
        });
      }
      const name = layerText(r.layer).name;
      if (cost === null) {
        r.btn.disabled = true;
        setText(r.label, t('forged'));
        setText(r.cost, '×2');
        r.btn.classList.remove('afford');
        setAttr(r.btn, 'aria-label', t('aria.forged', { name }));
      } else {
        const afford = run.sparks >= cost && !casting;
        r.btn.disabled = casting;
        r.btn.classList.toggle('afford', afford);
        setText(r.label, n === 0 ? t('unlock') : t('forge'));
        setText(r.cost, `✦ ${fmtShort(cost)}`);
        setAttr(r.btn, 'aria-label', t(n === 0 ? 'aria.unlock' : 'aria.forge', { name, cost: fmtShort(cost) }));
      }
    }
    if (!frozen) $('more-layers').hidden = visibleCount >= tr.layers.length;
    body.toggle('bench-on', run.sparks >= 5 || run.notes.kick > 1 || g.meta.casts > 0 || visibleCount > 1);

    this.updateMods(force, frozen);
    this.updateCast(frozen);
    this.updateGoal();
    this.updateSection(g.audible);
    this.updateApprentice();
    this.updateCoach();

    const pour = $('pour');
    pour.hidden = !(g.canPour() || g.pourQueued);
    pour.classList.toggle('queued', g.pourQueued);
    setHTML(pour, g.pourQueued ? t('pour.queued') : t('pour'));
  }

  private updateMods(force: boolean, frozen: boolean): void {
    const g = this.game;
    const run = g.run;
    const avail = MODS.filter((m) => modAvailable(run, m)).sort((a, b) => modCost(run, a) - modCost(run, b)).slice(0, 3);
    const key = avail.map((m) => m.id).join(',');
    const box = $('mods');
    const keys = ['Q', 'W', 'E'];
    if ((key !== this.modsKey && !frozen) || force) {
      this.modsKey = key;
      this.modSlots = avail.map((m) => m.id);
      box.textContent = '';
      avail.forEach((m, i) => {
        const card = el('div', 'mod');
        if (m.layer) card.style.setProperty('--c', LAYERS[m.layer].color);
        const head = el('div', 'mod-head');
        const title = el('b', '', modName(m.id));
        const kbd = el('kbd', '', keys[i]);
        kbd.setAttribute('aria-hidden', 'true');
        head.append(kbd, title);
        const btn = el('button', 'forge mod-btn');
        btn.dataset.mod = m.id;
        btn.append(el('span', 'f-cost', `✦ ${fmtShort(modCost(run, m))}`));
        btn.setAttribute('aria-label', t('aria.mod', { name: modName(m.id), cost: fmtShort(modCost(run, m)) }));
        btn.addEventListener('click', () => {
          if (!this.fresh(btn)) g.buyMod(m.id);
        });
        this.markFresh(btn);
        if (m.layer) {
          const l = m.layer;
          card.addEventListener('pointerenter', () => (this.renderer.hoverLayer = l));
          card.addEventListener('pointerleave', () => (this.renderer.hoverLayer = null));
        }
        head.append(btn);
        card.append(head, el('div', 'mod-text', modText(m.id)));
        box.append(card);
      });
    }
    for (const b of box.querySelectorAll<HTMLButtonElement>('button[data-mod]')) {
      const id = b.dataset.mod as ModId;
      const m = MODS.find((x) => x.id === id)!;
      if (run.mods.includes(id)) {
        // bought while the list is frozen: stays in place, marked as owned
        b.disabled = true;
        b.classList.remove('afford');
        b.classList.add('owned');
        setText(b, t('mod.owned'));
        continue;
      }
      b.classList.toggle('afford', run.sparks >= modCost(run, m) && !g.casting);
      b.disabled = g.casting;
    }
    const pending = pendingMods(run).filter((m) => !modAvailable(run, m));
    const next = pending.find((m) => !needMet(run, m.need));
    setText($('mods-hint'), next ? t('mods.next', { req: this.needText(next.need) }) : '');
    if (!frozen) {
      $('mods-wrap').hidden = avail.length === 0 && !next && box.childElementCount === 0;
    }
  }

  private needText(need: ModNeed): string {
    if ('layer' in need) return t('need.layer', { layer: layerText(need.layer).name, n: need.n });
    if ('drops' in need) return t('need.drops', { n: need.drops });
    return t('need.flares', { n: need.flares });
  }

  private updateCast(frozen: boolean): void {
    const g = this.game;
    const run = g.run;
    const box = $('cast');
    const show = allLayersUnlocked(run) || g.casting;
    const btn = $<HTMLButtonElement>('cast-btn');
    if (!show) {
      box.hidden = true;
      return;
    }
    if (box.hidden) {
      if (frozen) return;
      box.hidden = false;
      this.markFresh(btn);
    }
    const cost = castCost(run);
    if (g.casting) {
      btn.disabled = true;
      btn.classList.remove('afford', 'armed');
      setText(btn, t('cast.casting'));
      setFill($('cast-fill'), 1);
      return;
    }
    const afford = run.sparks >= cost;
    const armed = afford && performance.now() < this.castArmedUntil;
    btn.disabled = false;
    btn.classList.toggle('afford', afford);
    btn.classList.toggle('armed', armed);
    setText(btn, armed ? t('cast.confirm') : t('cast.btn', { cost: fmtShort(cost) }));
    setAttr(btn, 'aria-label', t('cast.aria', { cost: fmtShort(cost) }));
    setFill($('cast-fill'), run.sparks / cost);
  }

  private updateGoal(): void {
    const g = this.game;
    const run = g.run;
    const text = $('goal-text');
    const fill = $('goal-fill');
    if (g.casting) {
      setText(text, t('goal.casting'));
      setFill(fill, 1);
      return;
    }
    const goal = nextGoal(run);
    if (goal.kind === 'layer') {
      setHTML(text, t('goal.layer', { color: LAYERS[goal.layer].color, name: layerText(goal.layer).name, cost: fmtShort(goal.cost) }));
    } else {
      setHTML(text, t('goal.cast', { cost: fmtShort(goal.cost) }));
    }
    setFill(fill, run.sparks / goal.cost);
  }

  private updateSection(info: BarInfo): void {
    const tag = $('sectiontag');
    let text = '';
    let cls = '';
    const g = this.game;
    switch (info.section) {
      case 'build':
        text = t('sec.build');
        cls = 'build';
        break;
      case 'castbuild':
        text = t('sec.castbuild');
        cls = 'build';
        break;
      case 'drop': {
        const left = info.sectionLen - info.sectionBar;
        text = left === 1 ? t('sec.drop1') : t('sec.drop', { n: left });
        cls = 'drop';
        break;
      }
      case 'finale':
        text = t('sec.finale', { m: info.mult.toFixed(1) });
        cls = 'drop';
        break;
      case 'break':
        text = t('sec.break');
        break;
      case 'outro':
      case 'end':
        text = t('sec.outro');
        cls = 'drop';
        break;
      default:
        if (g.groove >= 4) {
          text = t('sec.groove', { n: g.groove });
          cls = 'groove';
        }
    }
    setText(tag, text);
    if (tag.className !== cls) tag.className = cls;
  }

  private updateApprentice(): void {
    const g = this.game;
    const has = metaLevel(g.meta, 'apprentice') > 0;
    $('apprentice').hidden = !has;
    if (has) $<HTMLInputElement>('apprentice-toggle').checked = g.run.autoBuy;
  }

  // ------------------------------------------------------------------ tutorial coach

  private coachStep(): CoachStep | null {
    const g = this.game;
    if (!g.settings.hints || !g.started || g.casting || this.modalKind) return null;
    const h = g.hints;
    const run = g.run;
    const sec = g.audible.section;
    if (sec === 'build' || sec === 'castbuild') return h.has('charge') ? null : { id: 'charge', target: null };
    if (sec !== 'groove') return null;
    if (g.flare && !h.has('flare')) return { id: 'flare', target: null };
    if (!h.has('strike')) return { id: 'strike', target: null, progress: `${Math.min(4, g.strikeProgress)}/4` };
    const cheap = cheapestNote(run);
    if (!h.has('forge') && cheap && cheap.cost <= run.sparks) {
      const row = this.rows.find((r) => r.layer === cheap.layer);
      return { id: 'forge', target: row?.btn ?? null, key: String(g.track.layers.indexOf(cheap.layer) + 1) };
    }
    if (g.canPour() && !h.has('pour')) return { id: 'pour', target: $('pour') };
    if (run.lit && !h.has('lit')) return { id: 'lit', target: null };
    if (!h.has('mod')) {
      const b = $('mods').querySelector<HTMLButtonElement>('button.afford');
      if (b) return { id: 'mod', target: b };
    }
    if (allLayersUnlocked(run) && !h.has('cast')) return { id: 'cast', target: $('cast') };
    return null;
  }

  private updateCoach(): void {
    const step = this.coachStep();
    this.renderer.coachStrike = step?.id === 'strike';
    this.renderer.coachCharge = step?.id === 'charge';
    const box = $('coach');
    const key = step ? `${step.id}|${step.progress ?? ''}|${step.key ?? ''}|${getLang()}` : '';
    if (key !== this.coachShown) {
      this.coachShown = key;
      box.classList.toggle('show', !!step);
      document.body.classList.toggle('hinting', !!step);
      if (step) {
        setText($('coach-label'), t('coach.label'));
        setText($('coach-skip'), t('coach.skip'));
        setText($('coach-title'), t(`coach.${step.id}.t` as Parameters<typeof t>[0]));
        setText($('coach-body'), t(`coach.${step.id}.b` as Parameters<typeof t>[0], { key: step.key ?? '1' }));
        setText($('coach-progress'), step.progress ?? '');
      }
    }
    const target = step?.target ?? null;
    if (target !== this.coachTarget) {
      this.coachTarget?.classList.remove('coach-target');
      this.coachTarget = target;
      if (target) {
        target.classList.add('coach-target');
        if (target.closest('#bench')) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  private position(): void {
    const c = this.renderer.center;
    const key = `${c.x}|${c.y}|${c.rC}`;
    if (key === this.posKey) return;
    this.posKey = key;
    const x = `${c.x}px`;
    const p = $('pour');
    p.style.left = x;
    p.style.top = `${c.y + c.rC + 22}px`;
    const judgement = $('judgement');
    judgement.style.left = x;
    // Keep the multiplier/charge text above and the sequencer rings outside.
    judgement.style.top = `${c.y + Math.max(9, c.rC * 0.42)}px`;
    for (const id of ['counter', 'sectiontag', 'goal', 'coach', 'banner']) $(id).style.left = x;
  }

  // ------------------------------------------------------------------ actions

  pour(): void {
    if (!this.game.requestPour()) this.game.engine?.ui('deny');
  }

  /** Casting ends the track, so it takes two presses within three seconds. */
  castClick(): void {
    const g = this.game;
    if (g.casting) return;
    if (!allLayersUnlocked(g.run) || g.run.sparks < castCost(g.run)) {
      g.engine?.ui('deny');
      return;
    }
    if (performance.now() < this.castArmedUntil) {
      this.castArmedUntil = 0;
      g.requestCast();
    } else {
      this.castArmedUntil = performance.now() + 3000;
      g.engine?.ui('buy');
    }
    this.update(true);
  }

  /** Q / W / E: buy the mod in that slot. */
  buyModSlot(i: number): void {
    const id = this.modSlots[i];
    if (!id || this.game.run.mods.includes(id)) {
      this.game.engine?.ui('deny');
      return;
    }
    this.game.buyMod(id);
  }

  toggleMute(): void {
    this.game.toggleMute();
    $('btn-mute').classList.toggle('off', this.game.muted);
    setAttr($('btn-mute'), 'aria-label', this.game.muted ? t('top.unmute') : t('top.mute'));
  }

  // ------------------------------------------------------------------ fx

  private banner(title: string, sub: string, color = '#ffb35c', time = 2.4): void {
    const b = $('banner');
    b.textContent = '';
    const h = el('div', 'b-title', title);
    h.style.color = color;
    b.append(h, el('div', 'b-sub', sub));
    this.bannerAnim?.cancel();
    const reduced = this.game.settings.reducedMotion;
    const duration = time * 1000;
    const enter = 160 / duration;
    const exit = 1 - 300 / duration;
    const frames: Keyframe[] = reduced
      ? [
          { opacity: 0, easing: 'ease-out' },
          { opacity: 1, offset: enter },
          { opacity: 1, offset: exit, easing: 'ease-in' },
          { opacity: 0 },
        ]
      : [
          { opacity: 0, transform: 'translateX(-50%) scale(1.25)', filter: 'blur(6px)', easing: 'ease-out' },
          { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0px)', offset: enter },
          { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0px)', offset: exit, easing: 'ease-in' },
          { opacity: 0, transform: 'translateX(-50%) translateY(-8px)', filter: 'blur(0px)' },
        ];
    this.bannerAnim = b.animate(frames, { duration, easing: 'linear', fill: 'forwards' });
  }

  purchase(layer: LayerId, _socket: number, first: boolean): void {
    const txt = layerText(layer);
    if (first) this.banner(t('b.newLayer', { name: txt.name }), `${txt.role} — ${txt.text}`, LAYERS[layer].color, UPGRADE_BANNER_SECONDS);
    const row = this.rows.find((r) => r.layer === layer);
    row?.root.animate(
      [{ backgroundColor: 'rgba(255, 190, 140, 0.14)' }, { backgroundColor: 'rgba(255, 235, 220, 0.018)' }],
      { duration: 350, easing: 'ease-out' },
    );
    this.update(false);
  }

  forged(layer: LayerId): void {
    this.banner(t('b.forged', { name: layerText(layer).name }), t('b.forgedSub'), LAYERS[layer].color, UPGRADE_BANNER_SECONDS);
  }

  mod(m: ModDef): void {
    this.banner(modName(m.id), modText(m.id), m.layer ? LAYERS[m.layer].color : '#ffe3b0', UPGRADE_BANNER_SECONDS);
    this.update(false);
  }

  section(info: BarInfo): void {
    if (info.section === 'build' && this.game.run.drops === 0) this.banner(t('b.pour'), t('b.pourSub'), '#fff0d0', 2);
    if (info.section === 'drop') {
      const perfect = this.game.lastCharge >= 0.9;
      this.banner(
        t('b.drop', { m: info.mult.toFixed(1) }),
        perfect ? t('b.perfectCharge') : t('b.charge', { p: Math.round(this.game.lastCharge * 100) }),
        '#fff4d6', 2.2,
      );
    }
    if (info.section === 'finale') this.banner(t('b.master'), t('b.masterSub', { m: info.mult.toFixed(1) }), '#fff4d6', 3);
  }

  castStart(): void {
    this.banner(t('b.casting'), t('b.castingSub'), '#ffd678', 3);
    this.update(true);
  }

  flareCatch(_f: unknown, value: number, auto: boolean): void {
    if (!auto) {
      this.judgementValue = value;
      this.updateJudgement();
    }
    if (!auto && this.game.run.flaresCaught <= 1) this.banner(t('b.flare'), t('b.flareSub', { v: fmtShort(value) }), '#ffd678', 2);
  }

  offline(gain: number, seconds: number): void {
    this.toast(t('toast.offline', { time: fmtTimeL(seconds), v: fmtShort(gain) }));
  }

  toast(text: string): void {
    const tt = $('toast');
    tt.textContent = text;
    tt.classList.remove('show');
    requestAnimationFrame(() => tt.classList.add('show'));
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => tt.classList.remove('show'), 5000);
  }

  deny(): void {
    /* the sound says enough */
  }

  castDone(r: CastResult): void {
    // let the record spin for a moment before the panel slides in
    window.setTimeout(() => (r.finale ? this.openCredits() : this.openFoundry()), 1600);
  }

  // ------------------------------------------------------------------ modals

  /** Keep visual pauses aligned with every active game pause reason. */
  syncPause(): void {
    const root = document.documentElement;
    if (this.game.paused && !root.classList.contains('game-paused')) {
      this.pausedAnimations = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && !target.closest('#modal') && animation.playState === 'running';
      });
      for (const animation of this.pausedAnimations) {
        const time = animation.currentTime;
        animation.pause();
        // Fix the hold time now; otherwise pending CSS pauses settle a frame later.
        if (time !== null) animation.currentTime = time;
      }
    } else if (!this.game.paused && root.classList.contains('game-paused')) {
      for (const animation of this.pausedAnimations) if (animation.playState === 'paused') animation.play();
      this.pausedAnimations = [];
    }
    root.classList.toggle('game-paused', this.game.paused);
  }

  private openModal(kind: string, build: (panel: HTMLElement) => void): void {
    this.game.setPaused(kind === 'settings' || kind === 'debug');
    this.syncPause();
    const modal = $('modal');
    const panel = $('modal-panel');
    panel.textContent = '';
    panel.className = `panel ${kind}`;
    build(panel);
    modal.hidden = false;
    this.modalKind = kind;
    const first = panel.querySelector<HTMLElement>('button, input');
    first?.focus({ preventScroll: true });
  }

  closeModal(): void {
    if (this.modalKind === 'foundry' || this.modalKind === 'credits') return; // must choose a track
    this.forceClose();
  }

  private forceClose(): void {
    $('modal').hidden = true;
    this.modalKind = null;
    this.game.setPaused(false);
    this.syncPause();
  }

  handleEscape(): void {
    if (this.modalKind) this.closeModal();
    else this.openSettings();
  }

  openSettings(): void {
    const g = this.game;
    this.openModal('settings', (p) => {
      p.append(el('h2', '', t('set.title')));
      p.append(el('div', 'set-note', t('set.paused')));
      const s: Settings = { ...g.settings };
      const apply = () => {
        const qualityChanged = s.quality !== g.settings.quality;
        g.setSettings({ ...s });
        if (qualityChanged) this.renderer.applyQuality();
      };
      const choice = <K extends keyof Settings>(label: string, key: K, options: [Settings[K], string][], onPick?: (v: Settings[K]) => void) => {
        const row = el('div', 'set-row');
        row.append(el('span', 'set-name', label));
        const seg = el('div', 'seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', label);
        for (const [v, name] of options) {
          const b = el('button', 'seg-btn', name);
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(s[key] === v));
          b.addEventListener('click', () => {
            s[key] = v;
            for (const x of seg.children) x.setAttribute('aria-checked', 'false');
            b.setAttribute('aria-checked', 'true');
            if (onPick) onPick(v);
            else apply();
          });
          seg.append(b);
        }
        row.append(seg, el('span'));
        p.append(row);
      };
      const slider = (label: string, key: keyof Settings, min: number, max: number, scale: number, fmt: (v: number) => string, note?: string) => {
        const row = el('label', 'set-row');
        const name = el('span', 'set-name', label);
        const input = el('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.value = String(Math.round((s[key] as number) * scale));
        const out = el('span', 'set-val', fmt(Number(input.value)));
        input.addEventListener('input', () => {
          (s[key] as number) = Number(input.value) / scale;
          out.textContent = fmt(Number(input.value));
          apply();
        });
        row.append(name, input, out);
        p.append(row);
        if (note) p.append(el('div', 'set-note', note));
      };
      const toggle = (label: string, key: keyof Settings) => {
        const row = el('label', 'set-row check');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = s[key] as boolean;
        input.addEventListener('change', () => {
          (s[key] as boolean) = input.checked;
          apply();
        });
        row.append(input, el('span', 'set-name', label));
        p.append(row);
      };
      const pct = (v: number) => `${v}%`;
      choice(t('set.language'), 'lang', [['en', 'English'], ['ko', '한국어']], (v) => this.setLanguage(v as Lang));
      slider(t('set.master'), 'master', 0, 100, 100, pct);
      slider(t('set.music'), 'music', 0, 100, 100, pct);
      slider(t('set.sfx'), 'sfx', 0, 100, 100, pct);
      slider(t('set.shake'), 'shake', 0, 100, 100, pct);
      slider(t('set.flash'), 'flash', 0, 100, 100, pct);
      choice(t('set.quality'), 'quality', [['auto', t('set.quality.auto')], ['high', t('set.quality.high')], ['low', t('set.quality.low')]]);
      toggle(t('set.reduced'), 'reducedMotion');
      toggle(t('set.guide'), 'guide');
      toggle(t('set.hints'), 'hints');
      slider(t('set.offset'), 'inputOffsetMs', -150, 150, 1, (v) => `${v > 0 ? '+' : ''}${v} ms`, t('set.offsetNote'));
      p.append(el('div', 'set-keys', t('set.keys')));
      const debug = el('button', 'ghost', t('debug.title'));
      debug.addEventListener('click', () => this.openDebug());
      p.append(debug);
      const foot = el('div', 'modal-foot');
      const reset = el('button', 'ghost danger', t('set.reset'));
      reset.addEventListener('click', () => {
        if (reset.dataset.armed) {
          this.forceClose();
          g.resetAll();
          this.toast(t('toast.reset'));
        } else {
          reset.dataset.armed = '1';
          reset.textContent = t('set.resetArm');
        }
      });
      const replay = el('button', 'ghost', t('set.replay'));
      replay.addEventListener('click', () => {
        g.replayTutorial();
        this.forceClose();
        this.coachShown = '';
        this.update(true);
        this.toast(t('toast.tutorial'));
      });
      const close = el('button', 'primary', t('set.back'));
      close.addEventListener('click', () => this.closeModal());
      foot.append(reset, replay, close);
      p.append(foot);
    });
  }

  private openDebug(): void {
    this.openModal('debug', (p) => {
      p.append(el('h2', '', t('debug.title')));
      p.append(el('p', 'set-note', t('debug.note')));
      const status = el('div', 'debug-status');
      const refresh = () => {
        const g = this.game;
        status.textContent = t('debug.status', { sparks: fmtShort(g.run.sparks), gold: g.meta.gold, heat: Math.floor(g.run.heat) });
      };
      refresh();
      p.append(status);
      const actions = el('div', 'debug-actions');
      for (const action of ['sparksSmall', 'sparksLarge', 'castBudget', 'heat', 'forge', 'mods', 'gold'] as const) {
        const button = el('button', 'ghost', t(`debug.${action}`));
        button.disabled = !this.game.started || this.game.casting || this.game.castResult !== null;
        button.addEventListener('click', () => {
          if (!this.game.debug(action)) return;
          this.shownSparks = this.game.run.sparks;
          this.update(true);
          refresh();
        });
        actions.append(button);
      }
      p.append(actions);
      const foot = el('div', 'modal-foot');
      const back = el('button', 'ghost', t('debug.back'));
      back.addEventListener('click', () => this.openSettings());
      const close = el('button', 'primary', t('set.back'));
      close.addEventListener('click', () => this.closeModal());
      foot.append(back, close);
      p.append(foot);
    });
  }

  openCredits(): void {
    const g = this.game;
    const st = g.stats;
    this.openModal('credits', (p) => {
      p.append(el('div', 'kicker', t('cr.kicker')));
      p.append(el('h1', '', t('cr.title')));
      p.append(el('p', 'lede', t('cr.lede')));
      const grid = el('div', 'stats');
      const stat = (k: string, v: string) => {
        const c = el('div', 'stat');
        c.append(el('b', '', v), el('span', '', k));
        grid.append(c);
      };
      stat(t('cr.time'), fmtTimeL(st.playTime));
      stat(t('cr.sparks'), fmtShort(st.totalSparks));
      stat(t('cr.drops'), String(st.drops));
      stat(t('cr.best'), `×${st.bestDrop.toFixed(1)}`);
      stat(t('cr.perfects'), String(st.perfects));
      stat(t('cr.flares'), String(st.flares));
      p.append(grid);
      p.append(el('p', 'small', t('cr.after')));
      const foot = el('div', 'modal-foot');
      const go = el('button', 'primary', t('cr.go'));
      go.addEventListener('click', () => this.openFoundry());
      foot.append(go);
      p.append(foot);
    });
  }

  openFoundry(): void {
    const g = this.game;
    const r = g.castResult;
    this.openModal('foundry', (p) => {
      const tr = r ? TRACKS[r.track] : g.track;
      p.append(el('div', 'kicker', r?.firstTime ? t('fd.first') : t('fd.encore')));
      p.append(el('h1', '', tr.name));
      const gold = el('div', 'goldline');
      const renderGold = () => (gold.innerHTML = t('fd.gold', { g: r?.gold ?? 0, total: g.meta.gold }));
      renderGold();
      p.append(gold);

      const shelf = el('div', 'shelf');
      TRACKS.forEach((x) => {
        const cast = g.meta.records.includes(x.index);
        const d = el('div', `disc${cast ? ' cast' : ''}`);
        d.append(el('span', 'disc-label', cast ? x.name : '?'));
        shelf.append(d);
      });
      p.append(shelf);
      p.append(el('div', 'small', t('fd.mult', { m: RECORD_MULT, now: Math.pow(RECORD_MULT, g.meta.records.length) })));

      const list = el('div', 'metas');
      const renderMetas = () => {
        list.textContent = '';
        for (const m of METAS) {
          const lvl = metaLevel(g.meta, m.id);
          const cost = metaCost(g.meta, m.id);
          const row = el('div', 'meta');
          const info = el('div', 'meta-info');
          const pips = el('span', 'pips', '■'.repeat(lvl) + '□'.repeat(m.costs.length - lvl));
          info.append(el('b', '', metaName(m.id)), pips, el('div', 'meta-text', metaText(m.id)));
          const btn = el('button', 'forge');
          if (cost === null) {
            btn.textContent = t('fd.owned');
            btn.disabled = true;
          } else {
            btn.textContent = t('fd.cost', { c: cost });
            btn.classList.toggle('afford', g.meta.gold >= cost);
            btn.setAttribute('aria-label', t('fd.aria', { name: metaName(m.id), c: cost }));
            btn.addEventListener('click', () => {
              if (g.buyMeta(m.id)) {
                renderMetas();
                renderGold();
              }
            });
          }
          row.append(info, btn);
          list.append(row);
        }
      };
      renderMetas();
      p.append(el('h3', '', t('fd.upgrades')), list);

      const foot = el('div', 'modal-foot');
      const start = (i: number) => {
        this.forceClose();
        g.startTrack(i);
      };
      if (g.meta.completed) {
        for (const x of TRACKS) {
          const b = el('button', x.index === TRACKS.length - 1 ? 'primary' : 'ghost', t('fd.reforge', { name: x.name }));
          b.addEventListener('click', () => start(x.index));
          foot.append(b);
        }
      } else {
        const next = g.nextTrack();
        const b = el('button', 'primary', t('fd.next', { n: ROMAN[next], name: TRACKS[next].name }));
        b.addEventListener('click', () => start(next));
        foot.append(b);
      }
      p.append(foot);
    });
  }

  handleModalKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeModal();
    }
  }
}
