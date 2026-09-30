// Drives the real game in headless Edge/Chrome: screenshots of key moments, console errors,
// audio levels per section. Usage: node scripts/playtest.mjs [url] [scenario]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { fmtShort } from '../src/format.ts';

const url = process.argv[2] ?? 'http://localhost:5173/?dev';
const scenario = process.argv[3] ?? 'all';
const out = 'playtest-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name}`);
};
const ev = (fn, arg) => page.evaluate(fn, arg);

/** Strike the next n beats (or charge targets) with the given timing error in ms. */
const strikeBeats = (n, errMs = 0) =>
  ev(({ n, errMs }) => new Promise((resolve) => {
    const g = window.bf.game;
    const tr = g.transport;
    const beat = tr.stepDur * 4;
    const heard = g.heardTime;
    let k = Math.ceil((heard - tr.origin) / beat + 0.25);
    let done = 0;
    const next = () => {
      const t = tr.origin + k * beat + errMs / 1000;
      const delay = (t - g.heardTime) * 1000;
      setTimeout(() => {
        g.strike(performance.now());
        k++;
        if (++done >= n) setTimeout(resolve, 50);
        else next();
      }, Math.max(0, delay));
    };
    next();
  }), { n, errMs });

const strikeTargets = (share = 1) =>
  ev((share) => new Promise((resolve) => {
    const g = window.bf.game;
    const check = () => {
      const pending = g.targets.filter((t) => !t.judged && t.time > g.heardTime + 0.01);
      if (!pending.length) {
        if (g.audible.section === 'drop' || g.audible.section === 'finale') return resolve(g.lastCharge);
        return setTimeout(check, 30);
      }
      const t = pending[0];
      setTimeout(() => {
        if (Math.random() < share) g.strike(performance.now());
        else t.judged = t.judged ?? null;
        setTimeout(check, 20);
      }, Math.max(0, (t.time - g.heardTime) * 1000));
    };
    check();
  }), share);

const waitSection = (name, timeout = 60000) =>
  page.waitForFunction((n) => window.bf.game.audible.section === n, name, { timeout, polling: 20 });

const levels = async (ms) => {
  const r = await ev((ms) => new Promise((resolve) => {
    const s = [];
    const id = setInterval(() => s.push(window.bf.levels()), 40);
    setTimeout(() => {
      clearInterval(id);
      const rms = s.reduce((a, b) => a + b.rms, 0) / s.length;
      const peak = Math.max(...s.map((x) => x.peak));
      const clip = s.filter((x) => x.peak > 0.99).length / s.length;
      resolve({ rms: +rms.toFixed(4), peak: +peak.toFixed(3), clip: +clip.toFixed(3) });
    }, ms);
  }), ms);
  return r;
};

const state = () => ev(() => {
  const g = window.bf.game;
  return {
    section: g.audible.section, sparks: Math.round(g.run.sparks), heat: Math.round(g.run.heat),
    groove: g.groove, strikes: g.stats.strikes, perfects: g.stats.perfects, drops: g.stats.drops,
    ctx: g.engine?.ctx.state, t: g.engine?.ctx.currentTime.toFixed(2), latency: g.engine?.outputLatency,
  };
});

const frozenState = async () => {
  const snapshot = await ev(() => ({
    run: JSON.stringify(window.bf.game.run),
    stats: JSON.stringify(window.bf.game.stats),
    heard: window.bf.game.heardTime,
    next: window.bf.game.transport.nextIndex,
    origin: window.bf.game.transport.origin,
    targets: JSON.stringify(window.bf.game.targets),
    visualTime: window.bf.renderer.time,
    canvas: document.querySelector('#stage').toDataURL(),
    animations: window.bf.hud.pausedAnimations.map((animation) => ({ time: animation.currentTime, state: animation.playState })),
  }));
  snapshot.canvas = createHash('sha256').update(snapshot.canvas).digest('hex');
  return snapshot;
};

await page.goto(url);
await wait(800);

if (scenario === 'all' || scenario === 'early') {
  await ev(() => localStorage.clear());
  await page.reload();
  await wait(700);
  await shot('01-title');
  await page.click('#start-btn');
  await wait(2600);
  await shot('02-first-pulse');
  console.log('state after start', await state());
  await strikeBeats(8, 0);
  console.log('after 8 on-beat strikes', await state());
  await strikeBeats(4, 70);
  console.log('after 4 late strikes', await state());
  await ev(() => window.bf.give(60));
  await wait(300);
  await shot('03-affordable');
  for (let i = 0; i < 3; i++) await page.keyboard.press('1');
  await wait(2600);
  await shot('04-four-kicks');
  console.log('levels groove early', await levels(2000));
}

if (scenario === 'all' || scenario === 'mid') {
  await ev(() => {
    const b = window.bf;
    if (!b.game.started) return b.begin();
  });
  await wait(500);
  await ev(() => {
    const b = window.bf;
    b.notes('kick', 5); b.notes('hat', 8); b.notes('clap', 4); b.notes('bass', 4); b.notes('chord', 2);
    b.mods('openhat', 'sidechain');
    b.give(5e4);
  });
  await wait(3000);
  await shot('05-mid-groove');
  console.log('levels mid groove', await levels(2400));
  await ev(() => window.bf.heat());
  await wait(1500);
  await shot('06-pour-ready');
  await page.keyboard.press('Enter');
  await waitSection('build');
  await wait(900);
  await shot('07-build');
  const charge = strikeTargets(1);
  await page.waitForFunction(() => {
    const g = window.bf.game;
    const i = g.audible;
    const pos = ((g.heardStep % 16) + 16) % 16;
    return i.section === 'build' && i.sectionBar === 1 && pos > 12.8;
  }, null, { timeout: 20000, polling: 10 });
  await shot('08-hold');
  await waitSection('drop');
  console.log('charge', await charge);
  await wait(250);
  await shot('09-drop-impact');
  await wait(2500);
  await shot('10-drop-sustain');
  console.log('levels mid drop', await levels(2400));
  console.log(await state());
}

if (scenario === 'all' || scenario === 'late') {
  await ev(() => {
    const b = window.bf;
    if (!b.game.started) return b.begin();
  });
  await wait(300);
  await ev(() => {
    const b = window.bf;
    b.fill();
    b.mods('openhat', 'sidechain', 'echo', 'cathedral', 'supersaw', 'subdrop', 'octave', 'tape');
    b.game.engine.setTape(true);
  });
  await waitSection('groove', 40000);
  await wait(2600);
  await shot('11-late-groove');
  console.log('levels late groove', await levels(2400));
  await ev(() => window.bf.heat());
  await wait(800);
  await page.keyboard.press('Enter');
  await waitSection('build', 10000);
  await strikeTargets(0.8);
  await wait(300);
  await shot('12-late-drop');
  console.log('levels late drop', await levels(3000));
}

if (scenario === 'all' || scenario === 'cast') {
  await ev(() => {
    const b = window.bf;
    if (!b.game.started) return b.begin();
  });
  await wait(300);
  await ev(() => { const b = window.bf; b.fill(); b.give(1e13); });
  await waitSection('groove', 40000);
  await page.click('#cast-btn', { delay: 20 });
  await page.waitForTimeout(450);
  await page.click('#cast-btn');
  await waitSection('castbuild', 10000);
  await wait(1200);
  await shot('13-castbuild');
  await strikeTargets(0.9);
  await wait(400);
  await shot('14-master-pour');
  await waitSection('outro', 60000);
  await wait(1800);
  await shot('15-outro-record');
  await page.waitForSelector('#modal:not([hidden])', { timeout: 20000 });
  await wait(600);
  await shot('16-foundry');
  const btn = await page.$('.metas .forge.afford');
  if (btn) await btn.click();
  await wait(300);
  await page.click('.modal-foot .primary');
  await wait(3000);
  await shot('17-track2');
  console.log('track 2 state', await state());
}

if (scenario === 'all' || scenario === 'finale') {
  await ev(() => {
    const b = window.bf;
    if (!b.game.started) return b.begin();
  });
  await wait(300);
  const reset = await ev(() => {
    const b = window.bf;
    b.game.meta.records = [0, 1];
    b.track(2);
    return {
      track: b.game.run.track,
      rings: b.renderer.pulses.size,
      particles: b.renderer.parts.live.length,
      texts: b.renderer.texts.length,
    };
  });
  assert.deepEqual(reset, { track: 2, rings: 8, particles: 0, texts: 0 }, 'track transition must reset renderer effects');
  console.log('track transition renderer reset', reset);
  await wait(1500);
  await ev(() => { const b = window.bf; b.fill(); b.give(1e15); });
  await wait(2500);
  await shot('18-opus-full');
  console.log('levels opus groove', await levels(2400));
  await page.click('#cast-btn', { delay: 20 });
  await page.waitForTimeout(450);
  await page.click('#cast-btn');
  await waitSection('finale', 20000);
  await wait(1500);
  await shot('19-opus-finale');
  console.log('levels opus finale', await levels(3000));
  await page.waitForFunction(() => window.bf.game.audible.section === 'finale' && window.bf.game.audible.sectionBar >= 9, null, { timeout: 40000 });
  await shot('20-opus-keychange');
  await page.waitForSelector('#modal:not([hidden])', { timeout: 60000 });
  await wait(600);
  await shot('21-credits');
}

if (scenario === 'all' || scenario === 'reload') {
  // pagehide saves the active game during reload. Reset it first so an earlier
  // finale cannot silently restore its track/records after localStorage.clear().
  await ev(() => {
    window.bf.game.resetAll();
    localStorage.clear();
  });
  await page.reload();
  await wait(600);
  const fresh = await ev(() => ({ track: window.bf.game.run.track, records: window.bf.game.meta.records }));
  assert.deepEqual(fresh, { track: 0, records: [] }, 'save/reload scenario must start with a fresh Track I');
  await page.click('#start-btn');
  await wait(1500);
  await ev(() => window.bf.give(400));
  for (let i = 0; i < 3; i++) await page.keyboard.press('1');
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  const before = await ev(() => ({ notes: { ...window.bf.game.run.notes }, sparks: Math.floor(window.bf.game.run.sparks) }));
  await ev(() => window.bf.game.save());
  await page.reload();
  await wait(900);
  await shot('22-reload-title');
  console.log('continue line:', await page.textContent('#continue-line'));
  await page.keyboard.press('Space');
  await wait(1200);
  const after = await ev(() => ({ notes: { ...window.bf.game.run.notes }, sparks: Math.floor(window.bf.game.run.sparks), started: window.bf.game.started }));
  console.log('before reload', JSON.stringify(before));
  console.log('after reload ', JSON.stringify(after));
  assert.equal(after.started, true, 'Space must resume a saved game');
  assert.deepEqual(after.notes, before.notes, 'reload must preserve forged notes');
  assert.ok(after.sparks >= before.sparks, 'reload must preserve sparks');
  // settings persist
  await page.keyboard.press('Escape');
  await wait(300);
  await shot('23-settings');
  await page.keyboard.press('Escape');
}

if (scenario === 'pause') {
  await page.click('#start-btn');
  await wait(1500);
  const openPaused = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.bf.game.paused && window.bf.game.engine.ctx.state === 'suspended');
    assert.equal(await ev(() => window.bf.game.transport.running), false, 'settings must stop scheduling');
  };
  const resume = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.bf.game.paused && window.bf.game.engine.ctx.state === 'running' && window.bf.game.transport.running);
  };
  await openPaused();
  const before = await frozenState();
  await page.keyboard.press('Space');
  await page.dispatchEvent('#stage', 'pointerdown', { button: 0 });
  await ev(() => window.bf.game.strike(performance.now()));
  await wait(900);
  assert.deepEqual(await frozenState(), before, 'settings must freeze economy, clock, targets, input and canvas');
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await page.getByRole('radio', { name: 'Low', exact: true }).click();
  await wait(150);
  const resized = await frozenState();
  assert.equal(resized.run, before.run);
  assert.equal(resized.heard, before.heard);
  assert.ok(await ev(() => document.querySelector('#stage').width > 0), 'graphics changes must keep a valid paused canvas');
  await ev(() => { window.bf.game.onHidden(); window.bf.game.onVisible(); });
  await wait(300);
  assert.deepEqual(await frozenState(), resized, 'visibility changes must not resume settings');
  await shot('pause-settings');
  await resume();
  await wait(800);
  const continued = await frozenState();
  assert.ok(continued.heard > before.heard, 'closing settings must continue the audio clock');
  assert.equal(continued.origin, before.origin, 'resume must preserve the original beat grid');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  await page.waitForFunction(() => !window.bf.game.paused && window.bf.game.engine.ctx.state === 'running' && window.bf.game.transport.running);
  await ev(() => { const b = window.bf; b.notes('clap', 1); b.heat(); });
  await page.keyboard.press('Enter');
  await waitSection('build');
  await wait(350);
  await openPaused();
  const build = await frozenState();
  assert.ok(build.animations.length > 0, 'build must exercise real paused UI animations');
  assert.ok(build.animations.every((animation) => animation.state === 'paused'));
  await wait(1000);
  assert.deepEqual(await frozenState(), build, 'a paused build must not advance or miss charge targets');
  await resume();
  await waitSection('drop', 15000);
  console.log('settings pause/resume, hidden overlap, rapid toggles and build continuation: passed');
}

if (scenario === 'banner') {
  await page.click('#start-btn');
  await wait(1000);
  await ev(() => window.bf.give(10000));
  const bannerState = () => ev(() => ({
    title: document.querySelector('#banner .b-title')?.textContent,
    sub: document.querySelector('#banner .b-sub')?.textContent,
    opacity: Number(getComputedStyle(document.querySelector('#banner')).opacity),
    time: window.bf.hud.bannerAnim.currentTime,
  }));
  const readable = async (title) => {
    const current = await bannerState();
    assert.equal(current.title, title, 'the upgrade explanation must remain the same');
    assert.ok(current.sub?.length > 0, 'the upgrade must have a description');
    assert.ok(current.opacity >= 0.99, 'upgrade text must stay fully legible during the reading interval');
  };
  await page.keyboard.press('2'); // unlock the hat through the actual purchase path
  const layer = await bannerState();
  await wait(3200);
  await readable(layer.title);
  await shot('upgrade-description');
  await wait(1800);
  await readable(layer.title);
  await wait(1300);
  assert.ok((await bannerState()).opacity < 0.01, 'upgrade banner must still clear after six seconds');

  await ev(() => window.bf.notes('kick', 4));
  await page.keyboard.press('1'); // forge the full ring
  const forged = await bannerState();
  assert.notEqual(forged.title, layer.title);
  await wait(3200);
  await readable(forged.title);

  await page.keyboard.press('Escape');
  await page.getByText(/^(Reduced motion|모션 줄이기)/).click();
  await page.keyboard.press('Escape');
  await ev(() => window.bf.notes('hat', 4));
  await wait(450);
  await page.keyboard.press('q'); // purchase the first available mod
  const mod = await bannerState();
  assert.notEqual(mod.title, forged.title);
  await wait(2200);
  await readable(mod.title);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.bf.game.engine.ctx.state === 'suspended');
  const paused = await bannerState();
  await wait(1800);
  assert.equal((await bannerState()).time, paused.time, 'settings must pause the upgrade reading timer');
  await page.keyboard.press('Escape');
  await wait(2000);
  await readable(mod.title);
  await wait(2200);
  assert.ok((await bannerState()).opacity < 0.01, 'reduced-motion banner must finish after its remaining reading time');
  console.log('layer unlock, forged ring, mod description, six-second visibility, reduced motion and paused reading timer: passed');
}

if (scenario === 'focus') {
  await page.click('#start-btn');
  await wait(1200);
  const stopped = () => page.waitForFunction(() => window.bf.game.paused && window.bf.game.engine.ctx.state === 'suspended' && !window.bf.game.transport.running);
  const running = () => page.waitForFunction(() => !window.bf.game.paused && window.bf.game.engine.ctx.state === 'running' && window.bf.game.transport.running);
  const unchanged = async (message) => {
    const before = await frozenState();
    await wait(650);
    assert.deepEqual(await frozenState(), before, message);
    return before;
  };
  // Exercise the window event path without changing the user's foreground app.
  await ev(() => window.dispatchEvent(new Event('blur')));
  await stopped();
  assert.equal(await ev(() => document.hidden), false, 'blur must pause even while visible');
  await page.keyboard.press('1');
  await page.keyboard.press('Space');
  const blurred = await unchanged('visible focus loss must freeze clock, economy, targets and visuals');
  await shot('focus-paused');
  await ev(() => window.dispatchEvent(new Event('focus')));
  await running();
  assert.equal((await frozenState()).origin, blurred.origin, 'focus return must preserve the beat grid');

  // Real browser tab activation tests document.hasFocus and visibility event ordering.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const other = await page.context().newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  console.log('inactive tab', await ev(() => ({ focus: document.hasFocus(), visibility: document.visibilityState, paused: window.bf.game.paused })));
  await stopped();
  assert.equal(await ev(() => document.hasFocus()), false, 'another active tab must remove game focus');
  await unchanged('switching tabs must freeze the game');
  await page.bringToFront();
  await running();

  await page.keyboard.press('Escape');
  await stopped();
  await other.bringToFront();
  await page.waitForFunction(() => !document.hasFocus());
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus());
  await stopped();
  await unchanged('returning focus must not override open settings');
  await ev(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.press('Escape');
  await stopped();
  assert.equal(await ev(() => window.bf.hud.modalOpen), false, 'closing settings without focus must remain paused');
  await ev(() => window.dispatchEvent(new Event('focus')));
  await running();
  for (let i = 0; i < 6; i++) {
    await ev(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  }
  await running();

  await ev(() => { const b = window.bf; b.notes('clap', 1); b.heat(); });
  await page.keyboard.press('Enter');
  await waitSection('build');
  await wait(350);
  await ev(() => window.dispatchEvent(new Event('blur')));
  await stopped();
  await unchanged('focus loss during a build must preserve charge targets and UI animations');
  await ev(() => window.dispatchEvent(new Event('focus')));
  await running();
  await waitSection('drop', 15000);
  await other.close();
  console.log('visible blur, real tab switches, settings overlap, rapid focus changes and build continuation: passed');
}

if (scenario === 'timing') {
  await page.click('#start-btn');
  await wait(1200);
  const checkFeedback = async (judge, lang, gain) => {
    const label = { ko: { perfect: '퍼펙트', good: '굿', miss: '미스' }, en: { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' } };
    assert.equal(await page.locator('#judgement-label').textContent(), label[lang][judge]);
    const reward = gain ?? await ev(() => window.bf.judgements.at(-1).value);
    assert.equal(await page.locator('#judgement-value').textContent(), `+${fmtShort(reward)} ✦`, 'popup must show the actual reward');
    assert.equal(await page.locator('#judgement').getAttribute('data-judge'), judge);
    assert.ok(await page.locator('#judgement').isVisible());
    const bounds = await ev(() => {
      const e = document.getElementById('judgement');
      const r = e.getBoundingClientRect();
      const c = window.bf.renderer.center;
      const overlaps = ['counter', 'goal', 'top-actions'].filter((id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      });
      const style = getComputedStyle(e);
      return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, x: (r.left + r.right) / 2, center: c, overlaps, font: parseFloat(style.fontSize), pointer: style.pointerEvents };
    });
    assert.ok(bounds.height <= 32 && bounds.width <= 84 && bounds.font <= 12, 'popup must stay compact with judgement and reward');
    assert.ok(Math.abs(bounds.x - bounds.center.x) < 1, 'popup must follow the machine center');
    assert.ok(bounds.top >= bounds.center.y + bounds.center.rC * 0.26 + 2, 'popup must sit below the multiplier');
    assert.ok(bounds.bottom <= bounds.center.y + bounds.center.rC + 26, 'popup must stay near the center');
    assert.equal(bounds.pointer, 'none', 'popup must not intercept strikes');
    assert.deepEqual(bounds.overlaps, [], 'feedback must not overlap HUD controls');
  };
  // Observe real canvas text while still drawing it normally.
  await ev(() => {
    window.bf.drawnText = [];
    window.bf.judgements = [];
    window.bf.game.fx.push({
      strike(judge, value, dt, kind) { window.bf.judgements.push({ judge, value, dt, kind }); },
      flareCatch(_flare, value, auto) { if (!auto) window.bf.caughtReward = value; },
    });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      window.bf.drawnText.push(String(args[0]));
      if (window.bf.drawnText.length > 1000) window.bf.drawnText.shift();
      return original.apply(this, args);
    };
  });
  for (const lang of ['ko', 'en']) {
    await page.keyboard.press('Escape');
    await page.getByRole('radio', { name: lang === 'ko' ? '한국어' : 'English', exact: true }).click();
    await page.keyboard.press('Escape');
    for (const [error, expected] of [[-70, 'good'], [70, 'good'], [0, 'perfect'], [170, 'miss']]) {
      await ev(() => { window.bf.drawnText.length = 0; });
      const perfects = await ev(() => window.bf.game.stats.perfects);
      await strikeBeats(1, error);
      await wait(150);
      const result = await ev(() => ({ last: window.bf.judgements.at(-1), text: window.bf.drawnText, perfects: window.bf.game.stats.perfects }));
      assert.equal(result.last.judge, expected, 'compact feedback must preserve strike judgement');
      assert.equal(result.last.kind, 'beat');
      assert.equal(result.perfects, perfects + (expected === 'perfect' ? 1 : 0));
      if (expected === 'miss') assert.equal(result.last.value, 0);
      else assert.ok(result.last.value > 0, 'successful strikes must still pay rewards');
      assert.ok(result.text.length > 0, 'the real canvas must still render game content');
      const overlay = /^(PERFECT|GOOD|MISS|EARLY|LATE|퍼펙트|굿|미스|빠름|느림)$|keep this timing|press a little|다음엔 조금|눌렀어요|다음 박자에 링/;
      assert.ok(result.text.every((line) => !overlay.test(line)), 'judgement text and timing advice must not cover the canvas');
      await checkFeedback(expected, lang);
      await shot(`timing-compact-${expected}-${error}-${lang}`);
    }
  }
  await page.keyboard.press('Escape');
  await page.getByText('Beat guide (approach ring)', { exact: true }).click();
  await page.keyboard.press('Escape');
  await ev(() => { window.bf.drawnText.length = 0; });
  await strikeBeats(1, 0);
  await wait(150);
  assert.equal(await ev(() => window.bf.game.settings.guide), false);
  assert.ok(await ev(() => window.bf.drawnText.every((line) => !/^(PERFECT|GOOD|MISS|퍼펙트|굿|미스)$|keep this timing|press a little/.test(line))), 'guide off must not restore judgement text');
  await checkFeedback('perfect', 'en');
  await page.keyboard.press('Escape');
  const pausedPopup = await page.locator('#judgement').getAttribute('style');
  await wait(1700);
  assert.equal(await page.locator('#judgement').getAttribute('style'), pausedPopup, 'popup fade/pop must freeze while paused');
  assert.equal(await page.locator('#judgement').getAttribute('data-active'), 'true', 'settings pause must retain the feedback reading time');
  await page.keyboard.press('Escape');
  await wait(150);
  await checkFeedback('perfect', 'en');
  await wait(1500);
  assert.equal(await page.locator('#judgement').getAttribute('data-active'), 'false', 'feedback must expire after active play resumes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#coach-skip');
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: '한국어', exact: true }).click();
  await page.keyboard.press('Escape');
  await strikeBeats(1, -70);
  await checkFeedback('good', 'ko');
  await shot('timing-mobile-ko');
  await page.setViewportSize({ width: 320, height: 640 });
  await strikeBeats(1, 170);
  await checkFeedback('miss', 'ko');
  await shot('timing-small-mobile-ko');
  await ev(() => window.bf.game.startTrack(1));
  assert.equal(await page.locator('#judgement').getAttribute('data-active'), 'false', 'new tracks must clear the previous judgement');
  await ev(() => { const g = window.bf.game; g.run.notes.hat = 1; g.nextFlareAt = g.heardTime + 0.2; });
  await page.waitForFunction(() => window.bf.game.flare !== null, null, { timeout: 6000 });
  await ev(() => new Promise((resolve) => {
    const g = window.bf.game;
    setTimeout(() => { g.strike(performance.now()); setTimeout(resolve, 150); }, Math.max(0, (g.flare.time - g.heardTime) * 1000));
  }));
  assert.equal(await ev(() => window.bf.judgements.at(-1).kind), 'flare');
  const caught = await ev(() => window.bf.caughtReward);
  assert.ok(caught > 0, 'a caught flare must pay a real reward');
  await checkFeedback('perfect', 'ko', caught);
  await shot('timing-flare-reward-ko');
  // Recreate a dense OPUS drop through the actual pour/build/drop flow.
  await page.setViewportSize({ width: 1905, height: 892 });
  await ev(() => { window.bf.game.startTrack(2); window.bf.fill(); window.bf.heat(); });
  await wait(300);
  await page.keyboard.press('Enter');
  await waitSection('build', 15000);
  await strikeTargets(1);
  assert.ok(await ev(() => window.bf.judgements.some((hit) => hit.kind === 'charge' && hit.value === 0)), 'charge hits must not invent immediate spark rewards');
  await waitSection('drop', 15000);
  await strikeBeats(1, 0);
  await wait(150);
  await checkFeedback('perfect', 'ko');
  await shot('timing-opus-drop-popup-ko');
  await page.setViewportSize({ width: 390, height: 844 });
  await strikeBeats(1, 170);
  await wait(150);
  await checkFeedback('miss', 'ko');
  await shot('timing-mobile-drop-popup-ko');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await strikeBeats(1, 0);
  await wait(150);
  await checkFeedback('perfect', 'ko');
  const popupBox = await page.locator('#judgement').boundingBox();
  const strikesBeforeClick = await ev(() => window.bf.game.stats.strikes);
  await page.mouse.click(popupBox.x + popupBox.width / 2, popupBox.y + popupBox.height / 2);
  assert.equal(await ev(() => window.bf.game.stats.strikes), strikesBeforeClick + 1, 'clicking through the popup must strike the machine');
  await ev(() => {
    const b = window.bf; b.game.startTrack(2); b.fill();
    b.game.run.notes.choir = 0; b.game.run.autoBuy = false; b.game.run.sparks = 10.8e9 + 1e6;
  });
  await wait(300);
  const choirRow = page.locator('.row').filter({ has: page.getByText('합창', { exact: true }) });
  assert.ok((await choirRow.textContent()).includes('10.8B'), 'workbench must display the reduced first choir price');
  await page.keyboard.press('8');
  assert.equal(await ev(() => window.bf.game.run.notes.choir), 1, 'real input must buy choir with a budget below the old price');
  await wait(200);
  assert.ok((await choirRow.textContent()).includes('28.0B'), 'next choir price must use the same reduced curve');
  await shot('timing-choir-purchase-ko');
  console.log('Central popup with actual beat/flare rewards, charge/miss zero gain, desktop/mobile/drop placement, paused fade, reduced motion, click-through, track reset and reduced choir purchase: passed');
}

if (scenario === 'economy') {
  await page.click('#start-btn');
  await wait(300);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await page.keyboard.press('Escape');
  for (const [track, target] of [[0, 120e6], [1, 2.4e9], [2, 400e9]]) {
    // Leave the workbench so its deliberate pointer-hover freeze can release.
    await page.mouse.move(20, 120);
    await ev(({ track, target }) => {
      const b = window.bf; b.track(track); b.fill(1);
      b.game.run.autoBuy = false; b.game.run.sparks = target * 0.9;
      b.castTransaction = null;
    }, { track, target });
    await wait(400);
    assert.ok((await page.locator('#goal-text').textContent()).includes(fmtShort(target)), 'goal must show the actual reduced casting target');
    assert.ok((await page.locator('#cast-btn').textContent()).includes(fmtShort(target)), 'cast control must show the same target');
    await page.click('#cast-btn');
    assert.equal(await ev(() => window.bf.game.casting), false, 'below-budget input must not start casting');
    await ev((target) => {
      const b = window.bf;
      b.game.run.sparks = target + 1e6;
    }, target);
    await wait(400);
    const before = await ev(() => ({ sparks: window.bf.game.run.sparks, earned: window.bf.game.run.earned }));
    await ev(() => {
      const b = window.bf;
      b.game.fx.push({ castStart() { b.castTransaction = { sparks: b.game.run.sparks, earned: b.game.run.earned }; } });
    });
    await page.click('#cast-btn');
    await wait(450);
    await page.click('#cast-btn');
    const result = await ev(() => ({ casting: window.bf.game.casting, transaction: window.bf.castTransaction }));
    assert.equal(result.casting, true);
    assert.ok(result.transaction);
    const paid = before.sparks + (result.transaction.earned - before.earned) - result.transaction.sparks;
    assert.ok(Math.abs(paid - target) < 1, 'real cast input must deduct exactly the displayed target, accounting for production');
    await shot(`economy-cast-track-${track + 1}`);
  }
  await waitSection('finale', 20000);
  await page.waitForSelector('.panel.credits', { state: 'visible', timeout: 60000 });
  assert.equal(await ev(() => window.bf.game.meta.completed), true, 'lower OPUS goal must still complete the normal finale');
  await shot('economy-opus-credits');
  console.log('All casting targets, below-budget rejection, real displayed-price deduction and OPUS finale: passed');
}

if (scenario === 'debug') {
  // This scenario runs on the normal production URL without ?dev or game hooks.
  assert.equal(new URL(url).searchParams.has('dev'), false);
  const saved = () => ev(() => JSON.parse(localStorage.getItem('beatfoundry.save.v1')));
  await page.click('#start-btn');
  await wait(500);
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'DEBUG / CHEATS', exact: true }).click();
  assert.ok(await ev(() => document.documentElement.classList.contains('game-paused')));
  await wait(200);
  const frozen = await ev(() => document.getElementById('stage').toDataURL());
  await wait(400);
  assert.equal(await ev(() => document.getElementById('stage').toDataURL()), frozen, 'debug menu must keep the real canvas paused');
  await page.getByRole('button', { name: '+1M SPARKS', exact: true }).click();
  const initial = await saved();
  assert.ok(initial.run.sparks >= 1e6);
  await page.getByRole('button', { name: '+1B SPARKS', exact: true }).click();
  assert.equal((await saved()).run.sparks, initial.run.sparks + 1e9);
  await page.getByRole('button', { name: '+10 GOLD', exact: true }).click();
  assert.equal((await saved()).meta.gold, initial.meta.gold + 10);
  await page.getByRole('button', { name: 'FORGE ALL CURRENT LAYERS', exact: true }).click();
  assert.deepEqual((await saved()).run.notes, { kick: 5, hat: 12, clap: 6, bass: 8, chord: 6, lead: 7, bells: 0, choir: 0 });
  await page.getByRole('button', { name: 'UNLOCK ALL CURRENT MODS', exact: true }).click();
  const mods = (await saved()).run.mods;
  assert.ok(mods.includes('tape') && !mods.includes('keychange') && !mods.includes('swing'));
  await page.getByRole('button', { name: 'UNLOCK ALL CURRENT MODS', exact: true }).click();
  assert.deepEqual((await saved()).run.mods, mods);
  await page.getByRole('button', { name: 'FILL HEAT TO 100', exact: true }).click();
  assert.equal((await saved()).run.heat, 100);
  await page.getByRole('button', { name: 'FILL CASTING BUDGET', exact: true }).click();
  const cheated = await saved();
  assert.ok(cheated.run.sparks >= 120e6);
  assert.equal(cheated.run.earned, initial.run.earned, 'cheats must not invent lifetime production');
  assert.deepEqual(cheated.stats, initial.stats);
  await shot('debug-menu-en');
  await page.getByRole('button', { name: 'BACK TO SETTINGS', exact: true }).click();
  assert.ok(await ev(() => document.documentElement.classList.contains('game-paused')), 'returning to settings must stay paused');
  await page.getByRole('radio', { name: '한국어', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '디버그 / 치트', exact: true }).click();
  const panel = await page.locator('.panel.debug').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390, 'debug controls must fit the mobile viewport');
  await shot('debug-menu-mobile-ko');
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => document.documentElement.classList.contains('game-paused')), false);
  await wait(500);
  await page.click('#cast-btn');
  await wait(450);
  await page.click('#cast-btn');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '디버그 / 치트', exact: true }).click();
  assert.equal(await page.locator('.debug-actions button:disabled').count(), 7, 'casting must disable cheats');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.panel.foundry', { state: 'visible', timeout: 60000 });
  const goldBefore = (await saved()).meta.gold;
  await page.locator('.metas .meta button').first().click();
  assert.equal((await saved()).meta.gold, goldBefore - 1, 'real permanent upgrade must use discounted gold cost');
  await page.getByRole('button', { name: '트랙 II 단조 — TEMPER ▸', exact: true }).click();
  await wait(300);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '디버그 / 치트', exact: true }).click();
  await page.getByRole('button', { name: '레코드 굽기 자금 채우기', exact: true }).click();
  const persisted = await saved();
  assert.equal(persisted.run.track, 1);
  assert.equal(persisted.run.sparks, 2.4e9);
  await page.reload();
  await page.click('#start-btn');
  assert.equal(await page.locator('#t-name').textContent(), 'TEMPER');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '디버그 / 치트', exact: true }).click();
  assert.ok((await page.locator('.debug-status').textContent()).includes('2.40B'));
  console.log('Production menu cheats, save readback/reload, pause, English/Korean/mobile, real casting, disabled casting actions and discounted gold purchase: passed');
}

if (scenario === 'tutorial') {
  // A real first session, driven only through inputs, in the language given by LANG.
  const lang = process.env.LANG_UI ?? 'ko';
  await ev((l) => {
    localStorage.clear();
    localStorage.setItem('beatfoundry.settings.v1', JSON.stringify({ lang: l }));
  }, lang);
  await page.reload();
  await wait(700);
  await shot(`t0-title-${lang}`);
  await page.click('#start-btn');
  await wait(1800);
  await shot(`t1-coach-strike-${lang}`);
  console.log('coach:', await page.textContent('#coach-title'));
  await strikeBeats(5, 0);
  await wait(300);
  console.log('after strikes coach:', await page.textContent('#coach-title'), '| sparks', await ev(() => Math.floor(window.bf.game.run.sparks)));
  // play on the beat until a note is affordable
  for (let i = 0; i < 12 && !(await ev(() => window.bf.game.run.sparks >= 7)); i++) await strikeBeats(2, 0);
  await wait(300);
  await shot(`t2-coach-forge-${lang}`);
  console.log('coach:', await page.textContent('#coach-title'), '| target:', await ev(() => document.querySelector('.coach-target')?.className));
  // misclick check: click the forge button with the mouse, then ENTER must not buy again
  const kicksBefore = await ev(() => window.bf.game.run.notes.kick);
  await page.click('.row .forge.afford');
  const focusAfterClick = await ev(() => document.activeElement?.tagName);
  await ev(() => window.bf.give(40));
  await page.keyboard.press('Enter');
  const kicksAfter = await ev(() => window.bf.game.run.notes.kick);
  console.log(`kicks ${kicksBefore} -> ${kicksAfter} (one click, then ENTER), focus after click: ${focusAfterClick}`);
  assert.equal(kicksAfter, kicksBefore + 1, 'Enter after a pointer purchase must not buy again');
  assert.notEqual(focusAfterClick, 'BUTTON', 'pointer purchase must release button focus');
  await ev(() => { const b = window.bf; b.notes('kick', 5); b.notes('hat', 4); b.notes('clap', 1); b.give(700); });
  await wait(600);
  await shot(`t3-coach-lit-or-mod-${lang}`);
  console.log('coach:', await page.textContent('#coach-title'));
  await ev(() => window.bf.heat());
  await wait(500);
  console.log('coach:', await page.textContent('#coach-title'));
  await shot(`t4-coach-pour-${lang}`);
  await page.keyboard.press('Enter');
  await waitSection('build');
  await wait(700);
  await shot(`t5-coach-charge-${lang}`);
  console.log('coach:', await page.textContent('#coach-title'));
  await strikeTargets(1);
  await wait(400);
  // freeze check: while the pointer moves over the bench, a newly available mod must not appear
  await page.mouse.move(1100, 400);
  await page.mouse.move(1105, 410);
  const cardsBefore = await ev(() => document.querySelectorAll('#mods .mod').length);
  await ev(() => { window.bf.notes('clap', 3); window.bf.give(1e4); });
  await wait(400);
  await page.mouse.move(1110, 420);
  const cardsDuring = await ev(() => document.querySelectorAll('#mods .mod').length);
  await page.mouse.move(300, 300);
  await wait(400);
  const cardsAfter = await ev(() => document.querySelectorAll('#mods .mod').length);
  console.log(`mod cards while hovering bench: ${cardsBefore} -> ${cardsDuring}, after leaving: ${cardsAfter}`);
  assert.equal(cardsDuring, cardsBefore, 'moving over the bench must freeze mod layout');
  assert.ok(cardsAfter > cardsDuring, 'leaving the bench must reveal newly unlocked mods');
  await page.keyboard.press('Escape');
  await wait(300);
  await shot(`t6-settings-${lang}`);
  await page.keyboard.press('Escape');
}

if (scenario === 'mobile') {
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => localStorage.clear());
  await page.reload();
  await wait(600);
  await page.click('#start-btn');
  await wait(800);
  await ev(() => {
    const b = window.bf;
    b.notes('kick', 5); b.notes('hat', 6); b.notes('clap', 2); b.notes('bass', 1);
    b.give(3000);
  });
  await wait(2500);
  await shot('24-mobile');
}

if (scenario === 'perf') {
  await ev(() => localStorage.clear());
  await page.reload();
  await wait(600);
  await page.click('#start-btn');
  await wait(500);
  await ev(() => { const b = window.bf; b.game.meta.records = [0, 1]; b.track(2); });
  await wait(500);
  await ev(() => { const b = window.bf; b.fill(); b.mods('openhat', 'sidechain', 'echo', 'cathedral', 'supersaw', 'subdrop', 'octave', 'tape', 'cascade', 'keychange'); b.heat(); });
  await page.keyboard.press('Enter');
  await waitSection('drop', 20000);
  const perf = await ev(() => new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    const f = (t) => {
      times.push(t - last);
      last = t;
      if (times.length < 240) requestAnimationFrame(f);
      else {
        times.sort((a, b) => a - b);
        resolve({ median: times[120].toFixed(1), p95: times[228].toFixed(1), max: times[239].toFixed(1) });
      }
    };
    requestAnimationFrame(f);
  }));
  console.log('frame ms during full drop', perf);
  console.log('levels full drop', await levels(2000));
}

console.log('\nconsole errors/warnings:', errors.length ? errors : 'none');
await browser.close();
assert.deepEqual(errors, [], 'browser playtest must finish without console errors or warnings');
