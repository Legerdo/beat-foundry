// Captures the README screenshots from a running build opened with ?dev.
// Usage: node scripts/screenshots.mjs [url]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/?dev';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86 });
  console.log(`saved ${out}/${name}.jpg`);
};
const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 16 });
const section = (name) => waitFor((n) => window.bf.game.audible.section === n, name);

/** Strikes every charge marker of the current build, so drops land fully charged. */
const charge = () =>
  ev(() => new Promise((resolve) => {
    const g = window.bf.game;
    const loop = () => {
      const s = g.audible.section;
      if (s === 'drop' || s === 'finale') return resolve();
      const t = g.targets.find((x) => !x.judged && x.time > g.heardTime + 0.005);
      if (!t) return setTimeout(loop, 20);
      setTimeout(() => {
        g.strike(performance.now());
        setTimeout(loop, 20);
      }, Math.max(0, (t.time - g.heardTime) * 1000));
    };
    loop();
  }));

// Capture the first-session coach, then mark hints as seen for the later scenes.
await page.goto(url);
await ev(() => localStorage.clear());
await page.reload();
await wait(900);
await shot('01-title');

await page.click('#start-btn');
await wait(1800);
await page.waitForSelector('#coach.show');
await shot('10-tutorial');
await ev(() => {
  const b = window.bf;
  for (const h of ['strike', 'forge', 'charge', 'flare', 'pour', 'lit', 'cast', 'mod']) b.game.hints.add(h);
  b.notes('kick', 4);
  b.give(34);
});
await wait(2400);
await shot('02-first-beats');

await ev(() => {
  const b = window.bf;
  b.notes('kick', 5); b.notes('hat', 8); b.notes('clap', 4); b.notes('bass', 4); b.notes('chord', 2);
  b.mods('openhat', 'sidechain');
  b.give(6e4);
  b.game.run.heat = 64;
});
await wait(3200);
await shot('03-groove');

await ev(() => window.bf.heat());
await wait(400);
await page.keyboard.press('Enter');
await section('build');
const charged = charge();
await waitFor(() => {
  const g = window.bf.game;
  const pos = ((g.heardStep % 16) + 16) % 16;
  return g.audible.section === 'build' && g.audible.sectionBar === 1 && pos > 5 && pos < 6;
});
await shot('04-build');
await charged;
await wait(220);
await shot('05-drop');

await section('groove');
await ev(() => {
  const b = window.bf;
  b.fill();
  b.mods('echo', 'cathedral', 'supersaw', 'subdrop', 'octave', 'tape');
  b.game.engine.setTape(true);
  b.heat();
});
await wait(2000);
await page.keyboard.press('Enter');
await section('build');
await charge();
await wait(1800);
await shot('06-full-drop');

await section('groove');
await ev(() => {
  const b = window.bf;
  b.game.meta.records = [0, 1];
  b.track(2);
});
await wait(800);
await ev(() => {
  const b = window.bf;
  b.fill();
  b.mods('openhat', 'sidechain', 'echo', 'cathedral', 'supersaw', 'octave', 'cascade');
  b.give(3e12);
});
await wait(1500);
await page.click('#cast-btn', { delay: 20 });
  await page.waitForTimeout(450);
  await page.click('#cast-btn');
await section('castbuild');
await charge();
await waitFor(() => window.bf.game.audible.section === 'finale' && window.bf.game.audible.sectionBar >= 9, null, 60000);
await wait(700);
await shot('07-finale');

await section('outro');
await wait(1800);
await shot('08-record');

await page.waitForSelector('#modal:not([hidden])', { timeout: 30000 });
await wait(700);
await shot('09-credits');

await browser.close();
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
