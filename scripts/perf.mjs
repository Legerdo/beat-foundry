// Measures main-thread frame work in the heaviest scene (OPUS fully forged, in a drop)
// with 4x CPU throttling. Usage: node scripts/perf.mjs [url] [throttle]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const url = process.argv[2] ?? 'http://localhost:5173/?dev';
const throttle = Number(process.argv[3] ?? 4);
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(url);
await ev(() => localStorage.clear());
await page.reload();
await wait(600);
await page.click('#start-btn');
await wait(500);
await ev(() => { const b = window.bf; b.game.meta.records = [0, 1]; b.track(2); });
await wait(500);
await ev(() => {
  const b = window.bf;
  b.fill();
  b.mods('openhat', 'sidechain', 'echo', 'cathedral', 'supersaw', 'subdrop', 'octave', 'tape', 'cascade', 'keychange');
});
await wait(2500);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await wait(4500);
console.log(`groove  (cpu x${throttle})`, await ev(() => window.bf.perf()));
await ev(() => window.bf.heat());
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.bf.game.audible.section === 'drop', null, { timeout: 30000 });
await wait(4500);
const drop = await ev(() => window.bf.perf());
console.log(`drop    (cpu x${throttle})`, drop);
// Whole-pipeline frame intervals (includes raster/compositing), during a second drop.
await page.waitForFunction(() => window.bf.game.audible.section === 'groove', null, { timeout: 30000 });
await ev(() => window.bf.heat());
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.bf.game.audible.section === 'drop', null, { timeout: 30000 });
const frames = await ev(() => new Promise((resolve) => {
  const d = [];
  let last = performance.now();
  const f = (t) => {
    d.push(t - last);
    last = t;
    if (d.length < 300) requestAnimationFrame(f);
    else {
      d.sort((a, b) => a - b);
      const long = d.filter((x) => x > 25).length;
      resolve({ median: +d[150].toFixed(1), p95: +d[285].toFixed(1), max: +d[299].toFixed(1), over25ms: long });
    }
  };
  requestAnimationFrame(f);
}));
console.log(`frame interval during drop (cpu x${throttle})`, frames);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
if (errors.length) console.log('errors', errors);
await browser.close();
assert.deepEqual(errors, [], 'performance check must finish without page errors');
assert.ok(drop.p95 < 8, `drop main-thread p95 must stay below 8 ms (observed ${drop.p95} ms)`);
