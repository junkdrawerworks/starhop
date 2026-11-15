// Uses Starhop in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Add a word to run only the checks whose names contain it:  node test/e2e.mjs offline
// The sky depends on the place and the date, so the checks pin both: a saved location and Playwright's clock.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// The server answers the way GitHub Pages does: a browser may keep each file for ten minutes, and asks again by its
// ETag. `net` is the connection: 'up', 'down' (the server drops every connection) or 'stalled' (a dark site with one
// bar of signal, a captive wifi: it takes each request and holds on to it). With `release` set it serves the next
// release, in which every file has changed (see the first check). With `hooked` set, the page it serves carries a hook
// into the sky model for the model check (MODEL_HOOK, below); the page in the repo never has it.
let net = 'up', release = false, hooked = false;
const held = [];
const server = createServer((req, res) => {
  if (net === 'down') { req.socket.destroy(); return; }
  if (net === 'stalled') { held.push([req, res]); return; }
  serve(req, res);
}).listen(0);
const letGo = () => { net = 'up'; for (const [req, res] of held.splice(0)) serve(req, res); };
async function fileFor(path) {
  if (path.endsWith('/')) path += 'index.html';
  let body = await readFile(join(root, path));
  if (hooked && path === '/index.html') {
    const page = String(body), end = '\n})();\n</script>';
    assert.equal(page.split(end).length, 2, 'the end of the page’s script, where the model check’s hook goes');
    body = Buffer.from(page.replace(end, '\n' + MODEL_HOOK + end));
  }
  if (release) {
    if (path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    else if (path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    else body = Buffer.concat([body, Buffer.from('\n')]);
  }
  return { body, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
}
async function serve(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  try { file = await fileFor(path); } catch { res.writeHead(404); res.end(); return; }
  const head = { etag: file.etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
  if (req.headers['if-none-match'] === file.etag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(file.body);
}
const base = `http://localhost:${server.address().port}/`;

const AUSTIN = { name: 'Austin, TX', lat: 30.27, lon: -97.74, tz: 'America/Chicago' };
const browser = await pw.chromium.launch();

// Opens Starhop at phone size (or desktop, or `size`, [width, height]) with a saved location, or a raw save, and the clock set to `time`.
// Anything the page asks of another site is refused and listed in `outside`.
// `init` runs in the page before Starhop does. `route` is [url pattern, handler] for the page's requests, and with
// `wait` false it returns as soon as the page has loaded, without waiting for the sky to be drawn. `geo` is where the
// device says it is, { latitude, longitude }, with leave to ask. `locale` is the browser's language. `hash` goes on the
// address it opens, as a shared plan's link has it.
async function open({ loc = AUSTIN, save, time, tz, phone = true, size, sw = false, reducedMotion = 'no-preference', init, route, wait = true, geo, locale = 'en-US', hash = '' } = {}) {
  const ctx = await browser.newContext({
    viewport: size ? { width: size[0], height: size[1] } : phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale,
    timezoneId: tz || (loc && loc.tz) || 'America/Chicago', serviceWorkers: sw ? 'allow' : 'block', reducedMotion,
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}),
  });
  const problems = [], outside = [];
  await ctx.route(url => !url.href.startsWith(base), route => { outside.push(route.request().url()); route.abort(); });
  const value = save !== undefined ? save : loc ? JSON.stringify({ loc }) : null;
  if (value !== null) {
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, ['starhop.v1', value]);
  }
  if (init) await ctx.addInitScript(init);
  if (route) await ctx.route(...route);
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  // A refused request to another site shows up as a console error too; `outside` already has those.
  page.on('console', m => { if (m.type() === 'error' && (m.location().url || base).startsWith(base)) problems.push(m.text()); });
  if (time) await page.clock.install({ time: new Date(time) });
  await page.goto(base + hash);
  if (wait) await ready(page);
  return { ctx, page, problems, outside };
}
const ready = page => page.waitForFunction(() => document.querySelector('#keys').children.length > 0 || /couldn|wrong/.test(document.querySelector('#tonightSec').textContent), null, { timeout: 90000 });
const text = (page, sel) => page.$eval(sel, el => el.innerText.replace(/\s+/g, ' ').trim());
// The text as it shows, without the words only screen readers get.
const shown = (page, sel) => page.$eval(sel, el => { const sr = [...el.querySelectorAll('.sr')]; sr.forEach(s => { s.hidden = true; }); const t = el.innerText; sr.forEach(s => { s.hidden = false; }); return t.replace(/\s+/g, ' ').trim(); });
const sheetOpen = page => page.$eval('#sheet', el => !el.hidden);
const fontsLoaded = page => page.evaluate(async () => { await document.fonts.ready; return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')))].sort(); });
const FONTS = ['Atkinson Hyperlegible', 'DM Mono', 'IM Fell English'];
// Waits until an element's text matches, since the map redraws on the next frame.
const until = (page, sel, re) => page.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s).innerText.replace(/\s+/g, ' ').trim()), [sel, re.source], { timeout: 15000 }).catch(() => {});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('opens on tonight, lists targets, opens a card and fits a phone', async () => {
  const { ctx, page, problems, outside } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    assert.match(await text(page, '#nightTitle'), /^Tonight · Tue, Oct 13$/);
    assert.deepEqual(await fontsLoaded(page), FONTS, 'its own fonts load');
    assert.match(await text(page, '#keys'), /Sunset \d+:\d\d pm/);
    assert.equal(await page.$eval('#tonightSec h2', h => h.textContent), 'Tonight Austin, TX');
    assert.ok(await page.$$eval('#targetSec .row', r => r.length) >= 10, 'the target list fills in');
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page), 'a tap on a target opens its card');
    assert.ok((await text(page, '#sheet .hd h2')).length > 2, 'the card has a name');
    assert.match(await text(page, '#sheet'), /In your telescope/i);
    await page.click('#sheet [data-close]');
    assert.equal(await sheetOpen(page), false, 'Done closes the card');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');
    assert.deepEqual(problems, [], 'no errors');
    assert.deepEqual(outside, [], 'nothing loads from another site');
  } finally { await ctx.close(); }
});

// The server goes down as well as the browser: in some Chromium builds the browser's offline switch alone doesn't stop
// the service worker's own requests, and an offline check passed with no copy at all.
check('the installed copy opens with the server down, opens quickly on a stalled connection, and takes a release whole', async () => {
  const { ctx, page, problems, outside } = await open({ time: '2026-10-13T21:00:00-05:00', sw: true });
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    net = 'down';
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    assert.match(await text(page, '#keys'), /Sunset/, 'it works offline once it has loaded');
    assert.deepEqual(await fontsLoaded(page), FONTS, 'with its fonts');
    await openCard(page, 'M13');
    assert.match(await text(page, '#sheet'), /In your telescope/i, 'a card opens offline');
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    assert.ok(await page.$('#scAp'), 'the telescope sheet opens offline');
    await page.keyboard.press('Escape');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 })
      .catch(() => assert.fail('a town search finds Tucson offline'));
    await page.keyboard.press('Escape');
    // Coming up, night vision, the Moon's card and the Show menu
    await page.$eval('#eventSec', e => e.scrollIntoView());
    await until(page, '#eventSec', /Moon/);
    assert.match(await text(page, '#eventSec'), /(New|Full) Moon|quarter/, 'Coming up lists the Moon’s phases offline');
    await page.click('#redBtn');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('red')), 'night vision turns on offline');
    await page.click('#redBtn');
    await openCard(page, 'Moon');
    assert.match(await text(page, '#sheet'), /lit/, 'the Moon’s card opens offline');
    await page.click('#sheet [data-close]');
    await page.click('#layBtn');
    assert.ok(await page.isVisible('#layers'), 'the Show menu opens offline');
    await page.click('#layBtn');
    await ctx.setOffline(false);

    // On a connection that's up but not answering, it opens from the copy after the worker's few seconds' wait for
    // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
    net = 'stalled';
    const t0 = Date.now();
    await page.reload({ timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('#keys')?.children.length > 0, null, { timeout: 10000 - (Date.now() - t0) }).catch(() => {});
    const took = Date.now() - t0;
    assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
    assert.match(await text(page, '#keys'), /Sunset/, 'it opens on a stalled connection');
    letGo();

    // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
    // the old ones for ten minutes. (Every file changes, and so FILES in sw.js, as in a real release.)
    release = true;
    const shell = await shellList();
    const want = {};
    for (const f of shell) want[f] = (await fileFor('/' + (f === './' ? '' : f))).etag;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const stale = () => page.evaluate(async want => {
      const out = [];
      for (const f in want) { const r = await caches.match(f); if (!r || r.headers.get('etag') !== want[f]) out.push(f); }
      return out;
    }, want);
    for (const end = Date.now() + 15000; (await stale()).length && Date.now() < end;) await page.waitForTimeout(200);
    assert.deepEqual(await stale(), [], "the new release's offline copy kept these files from the old one");
    release = false;
    assert.deepEqual(problems, [], 'no errors offline');
    assert.deepEqual(outside, []);
  } finally { letGo(); release = false; await ctx.close(); }
});

// The files sw.js keeps for offline, as its SHELL lists them.
const shellList = async () => [...(await readFile(join(root, 'sw.js'), 'utf8')).match(/const SHELL = \[([\s\S]*?)\];/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);

check('the offline copy lists files that exist, fonts included', async () => {
  const list = (await shellList()).filter(f => f !== './');
  for (const f of list) await readFile(join(root, f)).catch(() => assert.fail(`sw.js keeps ${f}, which doesn't exist`));
  const fonts = (await readFile(join(root, 'index.html'), 'utf8')).match(/fonts\/[\w-]+\.woff2/g) || [];
  assert.ok(fonts.length, 'the page uses fonts from fonts/');
  for (const f of fonts) assert.ok(list.includes(f), `sw.js doesn't keep ${f} for offline use`);
});

// An installed copy is downloaded whole again only when sw.js changes, so sw.js changes whenever a file it keeps does:
// FILES in sw.js is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read
// as its index.html; the first 8 hex of the sha1 of those).
check('sw.js changes whenever a file it keeps for offline does', async () => {
  const all = createHash('sha1');
  for (const f of await shellList()) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
});

check('Chrome can install it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', sw: true, phone: false });
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    const cdp = await ctx.newCDPSession(page);
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, [], 'what stops Chrome installing it');
    const m = await cdp.send('Page.getAppManifest');
    assert.deepEqual(m.errors, [], 'what Chrome makes of the manifest');
    assert.equal(JSON.parse(m.data).name, 'Starhop');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The size of a PNG, from its header
const pngSize = buf => (assert.equal(buf.toString('latin1', 1, 4), 'PNG'), [buf.readUInt32BE(16), buf.readUInt32BE(20)]);
check('The link preview and icons are in place', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8'), home = 'https://starhop.junkdrawer.works/';
  assert.equal((await readFile(join(root, 'CNAME'), 'utf8')).trim() + '/', home.replace('https://', ''), 'CNAME is the address the preview gives');
  const meta = p => (new RegExp(`<meta property="${p}" content="([^"]*)"`).exec(html) || [])[1];
  assert.equal(meta('og:url'), home);
  assert.equal(meta('og:image'), home + 'og.png', 'the preview image is a full address, which link previews need');
  assert.deepEqual(pngSize(await readFile(join(root, 'og.png'))), [1200, 630], 'og.png is 1200 × 630');
  const man = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const ic of man.icons) {
    const buf = await readFile(join(root, ic.src)).catch(() => assert.fail(`the manifest's ${ic.src} doesn't exist`));
    if (ic.sizes === 'any') assert.match(ic.type, /svg/, ic.src);
    else assert.equal(pngSize(buf).join('x'), ic.sizes, `${ic.src} is ${ic.sizes}`);
  }
  assert.ok(man.icons.some(i => i.purpose === 'maskable'), 'a maskable icon for Android');
  const apple = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(html);
  assert.ok(apple, 'an icon for the iPhone home screen');
  assert.deepEqual(pngSize(await readFile(join(root, apple[1]))), [180, 180], apple[1]);
});

// A file the page asks for that isn't in SHELL is missing offline, and nothing else would notice.
check('Everything the page loads is kept for offline', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', wait: false });
  const got = new Set();
  page.on('response', r => { const u = new URL(r.url()); if (u.origin + '/' === base && r.status() < 400) got.add(u.pathname.slice(1) || './'); });
  try {
    await page.reload();
    await ready(page);
    await openCard(page, 'M13');
    await page.click('#sheet [data-close]');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.click('#scopeBtn');
    await page.keyboard.press('Escape');
    const shell = await shellList();
    assert.ok(got.size >= 10, 'files loaded: ' + [...got].join(' '));
    for (const f of got) assert.ok(shell.includes(f), `the page loads ${f}, which sw.js doesn't keep for offline`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Wednesday Oct 14 2026: sunrise is 7:32 am, so the night that is ending runs until 8:22 am.
check('a morning moves on to the coming night, and stays on it past noon', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-14T08:15:00-05:00' });
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Tue, Oct 13', 'the night is still going on at 8:15');
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), true);
    await page.clock.fastForward('10:00'); // the 30-second clock passes 8:22
    await until(page, '#when', /pm Wed, Oct 14$/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/, 'the map moves to tonight once it is dark');
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T08:30:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'Tonight');
    assert.match(await text(page, '#when'), /pm Wed, Oct 14$/);
    await page.click('#nowBtn');
    await until(page, '#when', /Now/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'Now keeps tonight');
    assert.equal(await text(page, '#when'), '8:30 am Now · Wed, Oct 14');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-14T11:59:00-05:00' }));
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14');
    await page.clock.fastForward('02:30');
    await page.waitForTimeout(300);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Wed, Oct 14', 'still tonight after noon');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Nov 14 2026: sunset 5:35 pm, fully dark by 7:00 pm. Before the night starts the map shows nightfall, and
// once it starts the page goes live; a page left open (or a phone app brought back) keeps up with the clock.
check('a page opened in the afternoon follows the clock once night falls, and moves on the next day', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-14T15:00:00-06:00' });
  try {
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sat, Nov 14');
    assert.match(await text(page, '#when'), /^7:\d\d pm Sat, Nov 14$/, 'by day the map shows nightfall');
    await page.clock.fastForward('07:00:00'); // 10 pm, and the 30-second clock ticks
    await until(page, '#when', /Now/);
    assert.equal(await text(page, '#when'), '10:00 pm Now · Sat, Nov 14', 'live once the night is on');
    await page.clock.fastForward('16:00:00'); // 2 pm the next day
    await until(page, '#nightTitle', /Nov 15/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sun, Nov 15');
    await until(page, '#when', /pm Sun, Nov 15$/); // the map's time is drawn on the next frame
    assert.match(await text(page, '#when'), /^7:\d\d pm Sun, Nov 15$/, 'and nightfall of the new night');
    // a phone app brought back from the background catches up straight away, without waiting for the clock's tick
    await page.clock.setSystemTime(new Date('2026-11-15T21:00:00-06:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await until(page, '#when', /Now/);
    assert.equal(await text(page, '#when'), '9:00 pm Now · Sun, Nov 15', 'live when brought back');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // A time the person picks stays picked.
  ({ ctx, page, problems } = await open({ time: '2026-11-14T15:00:00-06:00' }));
  try {
    const tl = await page.locator('#tlc').boundingBox();
    await page.mouse.click(tl.x + tl.width * 0.8, tl.y + tl.height / 2);
    await until(page, '#when', /am Sun, Nov 15$/);
    const picked = await text(page, '#when');
    assert.match(picked, /am Sun, Nov 15$/);
    await page.clock.fastForward('07:00:00');
    await page.waitForTimeout(300);
    assert.equal(await text(page, '#when'), picked, 'a time picked on the timeline stays');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // Stepping to the next night, then the clock reaching it: it becomes tonight.
  ({ ctx, page, problems } = await open({ time: '2026-11-14T22:00:00-06:00' }));
  try {
    await page.click('#nextN');
    assert.equal(await text(page, '#nightTitle'), 'Night of Sun, Nov 15');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'Tomorrow night');
    await page.click('#prevN');
    await page.click('#prevN');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'That night', 'a night gone by');
    await page.click('#nextN');
    await page.click('#nextN');
    await page.clock.fastForward('16:00:00');
    await until(page, '#nightTitle', /Tonight/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sun, Nov 15');
    assert.equal(await page.$eval('#tonightSec h2', h => h.firstChild.textContent.trim()), 'Tonight');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The times under the timeline, by name: { Sunset: '7:01 pm', Dark: '8:21 pm', ... }
const keys = page => page.$$eval('#keys span', s => Object.fromEntries(s.map(x => [x.firstChild.textContent.trim(), x.querySelector('b').textContent])));
const TROMSO = { name: 'Tromsø, NO', lat: 69.65, lon: 18.96, tz: 'Europe/Oslo' };

check('fully dark and the verdict use the same twilight and moonset times as the keys', async () => {
  for (const [loc, time] of [[AUSTIN, '2026-10-13T21:00:00-05:00'], [TROMSO, '2026-10-13T21:00:00+02:00'], [TROMSO, '2026-12-15T21:00:00+01:00']]) {
    const { ctx, page } = await open({ loc, time });
    try {
      const k = await keys(page), where = loc.name + ' ' + time;
      assert.equal(await text(page, '#tonightSec .fact.wide b'), k.Dark + ' – ' + k.Dawn, 'fully dark, ' + where);
      const lede = await text(page, '#tonightSec .lede');
      if (k.Moonset && /Moon down/.test(lede)) assert.match(lede, new RegExp('from ' + k.Moonset + ' to ' + k.Dawn), 'moonless hours, ' + where);
    } finally { await ctx.close(); }
  }
});

// North of about 54.6°N the Sun doesn't get 12° down in midsummer, and the facts said "Twilight until —" and "First
// light —"; under the midnight sun and in polar night "Sunset —". Astronomy Engine 2.1.19: at Edinburgh on Jun 21 2026
// the Sun sets at 21:02Z and rises at 03:26Z, and gets no lower than -10.6°; at Tromsø it neither sets on Jun 21 nor
// rises on Dec 15, when it is 18° down from 15:54Z to 05:24Z.
check('a white night and the midnight sun say so instead of showing a dash', async () => {
  for (const [loc, time, sunset, sunrise, lede] of [
    [EDINBURGH, '2026-06-21T22:30:00+01:00', 'Sunset 10:02 pm Twilight lasts all night', 'Sunrise 4:26 am Never fully dark', /^The sky never gets fully dark/],
    [TROMSO, '2026-06-21T23:30:00+02:00', 'Sunset None The Sun stays up all night', 'Sunrise None The Sun stays up all night', /^The Sun doesn’t set tonight/],
    [TROMSO, '2026-12-15T21:00:00+01:00', 'Sunset None Twilight until 4:54 pm', 'Sunrise None First light 6:24 am', /^Polar night: the Sun stays below the horizon all day\. /],
  ]) {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      const where = loc.name + ' ' + time, facts = await page.$$eval('#tonightSec .fact', fs => fs.map(f => [...f.children].map(c => c.textContent).join(' ')));
      assert.equal(facts[0], sunset, where);
      assert.equal(facts[1], sunrise, where);
      assert.match(await text(page, '#tonightSec .lede'), lede, where);
      assert.doesNotMatch(await text(page, '#tonightSec .facts') + await text(page, '#tonightSec .moonrow'), /—/, 'no bare dash, ' + where);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Sunset and sunrise were searched on from noon, so near polar night, when the Sun sets before noon, a night took the
// next day's sunset and lost its own sunrise. Astronomy Engine 2.1.19: at Kirkenes the Sun sets at 10:42:51Z on Nov 24
// 2027 (11:42 am), rises at 09:00:25Z on Nov 25 (10:00 am) and sets again at 10:32Z (11:32 am); at Utqiaġvik it sets at
// 00:15:42Z on Jan 29 2027 (3:15 pm on the 28th) and rises at 20:57:30Z (11:57 am on the 29th).
check('a night at the edge of polar night keeps its own sunset and sunrise', async () => {
  for (const [loc, time, want] of [
    [{ name: 'Kirkenes, NO', lat: 69.73, lon: 30.05, tz: 'Europe/Oslo' }, '2027-11-24T20:00:00+01:00', { Sunset: '11:42 am', Sunrise: '10:00 am' }],
    [{ name: 'Utqiaġvik, AK', lat: 71.29, lon: -156.79, tz: 'America/Anchorage' }, '2027-01-28T20:00:00-09:00', { Sunset: '3:15 pm', Sunrise: '11:57 am' }],
  ]) {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      const k = await keys(page);
      assert.equal(k.Sunset, want.Sunset, loc.name);
      assert.equal(k.Sunrise, want.Sunrise, loc.name);
      assert.doesNotMatch(await text(page, '#tonightSec .lede'), /Polar night/, loc.name);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
  // In polar night the timeline takes in the dark from the evening's end of twilight: at Tromsø on Dec 15 2026 the Sun
  // is 18° down from 15:54Z (4:54 pm), where the fixed hours began at 5:10 pm.
  const { ctx, page } = await open({ loc: TROMSO, time: '2026-12-15T21:00:00+01:00' });
  try {
    const at = await page.$eval('#tlc', el => el.getAttribute('aria-valuemax'));
    await page.focus('#tlc');
    await page.keyboard.press('Home');
    await until(page, '#when', /^4:24 pm/);
    assert.match(await text(page, '#when'), /^4:24 pm/, 'the timeline starts half an hour before the dark');
    assert.ok(+at > 14 * 60, 'and runs past the morning twilight');
  } finally { await ctx.close(); }
});

// At Tromsø the Sun doesn't set from late May to late July, and doesn't rise from late November to mid January.
check('under the midnight sun the banner and the verdict say the Sun doesn’t set', async () => {
  let { ctx, page, problems } = await open({ loc: TROMSO, time: '2026-06-21T23:30:00+02:00' });
  try {
    await until(page, '#banner', /Sun/);
    assert.equal(await page.$eval('#banner', b => b.hidden), false);
    assert.equal(await text(page, '#banner'), 'The Sun doesn’t set tonight', 'no hint to drag along a night that isn’t there');
    assert.match(await text(page, '#tonightSec .lede'), /^The Sun doesn’t set tonight/);
    assert.equal(await text(page, '#tonightSec .fact.wide em'), 'The Sun doesn’t set tonight');
    assert.doesNotMatch(await text(page, '#tonightSec'), /18°/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ loc: TROMSO, time: '2026-12-15T21:00:00+01:00' }));
  try {
    assert.doesNotMatch(await text(page, '#tonightSec'), /doesn’t set/, 'polar night has no sunset either');
    assert.equal(await page.$eval('#banner', b => b.hidden), true);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Every row of the target list: { k, id, kind (its glyph: gx, nb, pn, cl, ds), when, rate }.
const targetRows = async page => {
  if (await page.$('#moreT') && /Show all/.test(await text(page, '#moreT'))) await page.click('#moreT');
  return page.$$eval('#targetSec .row', r => r.map(x => ({ k: x.dataset.k, id: x.dataset.id, kind: x.querySelector('.g i')?.className, when: x.querySelector('.dt').textContent, rate: x.querySelector('.rate').textContent })));
};
// Minutes after noon on the night's first day, for a time like '4:26 am'.
const afterNoon = s => { const [, h, m, ap] = s.match(/(\d+):(\d\d) (am|pm)/); return (+h % 12) * 60 + +m + (ap === 'am' ? 720 : 0); };
const EDINBURGH = { name: 'Edinburgh, GB', lat: 55.95, lon: -3.19, tz: 'Europe/London' };

// Edinburgh, Jun 21 2026: sunset 10:02 pm, sunrise 4:26 am, and the Sun gets no lower than 10.6° below the horizon
// (Astronomy Engine), so there's no time with it 12° down to sample. Deep-sky objects are sampled with it 6° down.
check('a June night in Edinburgh gives no best time before sunset or after sunrise', async () => {
  const { ctx, page, problems } = await open({ loc: EDINBURGH, time: '2026-06-21T23:30:00+01:00' });
  try {
    const k = await keys(page), rows = await targetRows(page);
    assert.ok(rows.filter(r => r.k === 'dso' || r.k === 'double').length >= 10, 'bright clusters and double stars are still listed');
    for (const r of rows) {
      const t = afterNoon(r.when);
      assert.ok(t > afterNoon(k.Sunset) && t < afterNoon(k.Sunrise), `${r.id}: "${r.when}" is outside ${k.Sunset} to ${k.Sunrise}`);
    }
    // In twilight a galaxy is no easy sight, and the faint ones drop off the list.
    for (const r of rows.filter(r => r.kind === 'gx')) assert.notEqual(r.rate, 'Easy', r.id + ' is rated Easy in twilight');
    assert.ok(!rows.some(r => r.id === 'M51'), 'the Whirlpool galaxy is not listed in twilight');
    assert.match(await text(page, '#tonightSec .lede'), /never gets fully dark/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('under the midnight sun the list holds only the Moon and planets', async () => {
  let { ctx, page, problems } = await open({ loc: TROMSO, time: '2026-06-21T23:30:00+02:00' });
  try {
    const rows = await targetRows(page);
    assert.deepEqual(rows.filter(r => r.k !== 'moon' && r.k !== 'planet').map(r => r.id), [], 'nothing but the Moon and planets');
    for (const id of ['Moon', 'Venus', 'Jupiter']) assert.ok(rows.some(r => r.id === id), id + ' is listed, as the map shows it');
    const line = 'The sky stays too bright tonight for anything but the Moon and the brightest planets.';
    assert.equal(await text(page, '#targetSec .lede'), line);
    await page.click('#targetSec .chip[data-f="cluster"]');
    assert.equal(await text(page, '#targetSec .lede'), line, 'and the clusters say why there are none');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // Fairbanks, Jun 21 2026: the Sun sets, but gets only 1.7° down (Astronomy Engine), and the verdict agrees with the list.
  ({ ctx, page, problems } = await open({ loc: { name: 'Fairbanks, AK', lat: 64.84, lon: -147.72, tz: 'America/Anchorage' }, time: '2026-06-21T23:30:00-08:00' }));
  try {
    assert.match(await text(page, '#keys'), /Sunset/);
    assert.deepEqual((await targetRows(page)).filter(r => r.k !== 'moon' && r.k !== 'planet').map(r => r.id), []);
    assert.equal(await text(page, '#tonightSec .lede'), 'The sky stays bright all night — the Sun never gets 6° below the horizon. Stick to the Moon and the brightest planets.');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A card said "Highest at first light" for a planet highest at the end of civil twilight, an hour after the Tonight
// panel's "First light", which is astronomical dawn; and its last sample fell short of that, so Mercury's card gave
// 11° where its row gave 13°. Astronomy Engine 2.1.19, Austin, Nov 16 2026: astronomical dawn 11:34Z (5:34 am), civil
// dawn 12:32Z (6:32 am); Jupiter 67.1° then 73.2° (it transits at 6:42 am, 73.3°); Mercury 12.4° at civil dawn and
// 12.8° at 6:34 am.
check("a card gives the time a planet is highest, not 'first light', and the list's height", async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await openCard(page, 'Jupiter');
    const jup = await cardRiseSet(page);
    assert.doesNotMatch(jup, /first light/i, jup);
    assert.match(jup, /Highest as it gets light, 6:32 am \(73°\)$/, jup);
    await page.click('#sheet [data-close]');
    const row = await page.$eval('#targetSec .row[data-id="Mercury"] .dt', d => d.textContent);
    await openCard(page, 'Mercury');
    const mer = await cardRiseSet(page), a = +mer.match(/Highest.*\((\d+)°\)/)[1], b = +row.match(/(\d+)° up/)[1];
    assert.ok(Math.abs(a - b) <= 1, `the card's ${a}° and the row's ${b}°: ${mer} / ${row}`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Hay River, Sep 19 1999: Uranus is highest at 10:52 pm, 12° up, with the Sun 20.3° down (Astronomy Engine); full
// dark starts at 10:26 pm.
check('a planet low in full darkness is low, not low in twilight', async () => {
  const { ctx, page, problems } = await open({ loc: { name: 'Hay River, CA', lat: 60.85, lon: -115.7, tz: 'America/Yellowknife' }, time: '1999-09-19T22:00:00-06:00' });
  try {
    const uranus = (await targetRows(page)).find(r => r.id === 'Uranus');
    assert.match(uranus.when, /^Up now · Best 10:52 pm · 12° up/);
    assert.equal(uranus.rate, 'Low');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const cardRiseSet = page => page.$eval('#sheet .card p:not(.big)', p => p.textContent);

// The only ways to a card were the list and the map, and a city sky's list leaves out the Triangulum Galaxy. Austin,
// Nov 15 2026, 9 pm (Astronomy Engine 2.1.19): Mizar rises at 12:24 am; the Jewel Box, at −60°, never rises there.
const finds = async (page, q) => { await page.fill('#findQ', q); return page.$$eval('#findRes button, #findRes p', b => b.map(x => x.innerText.replace(/\s+/g, ' ').trim())); };
check('Find takes a name, a catalogue number or a Greek letter, says where it is and opens its card', async () => {
  const { ctx, page, problems, outside } = await open({ save: JSON.stringify({ loc: AUSTIN, sky: 'city' }), time: '2026-11-15T21:00:00-06:00' });
  try {
    assert.ok(!(await targetRows(page)).some(r => r.id === 'M33'), 'a city sky’s list leaves out M33');
    assert.match((await finds(page, 'm 33'))[0], /^Triangulum Galaxy M33 Up \d+° (N|NE|E|SE|S|SW|W|NW)$/);
    await page.click('#findRes button');
    assert.ok(await sheetOpen(page), 'a match opens its card');
    assert.equal(await page.$eval('#sheet .hd h2 > span', s => s.textContent), 'Triangulum Galaxy · M33');
    await page.click('#sheet [data-close]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.fi), '0', 'closing it hands the focus back to the match');
    assert.match((await finds(page, 'alpha lyrae'))[0], /^Vega α Lyr Up/);
    assert.match((await finds(page, 'ε Lyr'))[0], /^Epsilon Lyrae ε1 Lyr/);
    assert.match((await finds(page, 'TRIANGULUM'))[0], /^Triangulum Galaxy/, 'whatever the case');
    assert.match((await finds(page, 'tolim'))[0], /^Toliman/);
    const sat = await finds(page, 'saturn');
    assert.match(sat[0], /^Saturn Planet Up \d+° S/);
    assert.match(sat[1], /^Saturn Nebula NGC 7009/);
    assert.match((await finds(page, 'mizar'))[0], /^Mizar and Alcor ζ UMa Rises 12:24 am$/);
    assert.match((await finds(page, 'm12'))[0], /^M12 NGC 6218 Set 7:36 pm$/, 'it rises at 7:39 am, after sunrise, so when it set counts, as on its card');
    assert.match((await finds(page, 'jewel'))[0], /^Jewel Box NGC 4755 Not up tonight$/);
    assert.match((await finds(page, 'M3'))[0], /^M3 NGC 5272/, 'the number itself before M30 to M39');
    assert.match((await finds(page, 'ngc884'))[0], /^Double Cluster NGC 869 and NGC 884/);
    assert.deepEqual(await finds(page, 'xyzzy'), ['Nothing by that name. Try a Messier number like M13, or a star like Vega.']);
    await finds(page, 'blue snowball');
    await page.press('#findQ', 'Enter');
    assert.equal(await page.$eval('#sheet .hd h2 > span', s => s.textContent), 'Blue Snowball', 'Enter opens the first match');
    await page.click('#sheet [data-close]');
    await page.focus('#findQ');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#findQ', i => i.value), '', 'Escape empties the box');
    assert.equal(await page.$eval('#findRes', r => r.hidden), true, 'and puts the matches away');
    assert.deepEqual(problems, []);
    assert.deepEqual(outside, []);
  } finally { await ctx.close(); }
});

// A plan for the night: Add to plan on a card, Your plan lists the picks by their best time on the night shown and
// marks what's badly placed, and Share plan makes a link that opens the same plan for another place. Austin, Nov 15
// 2026: Vega is highest as the sky darkens (6:29 pm, 12° twilight), Saturn at 9:24 pm, M31 at 9:29 pm, and the Jewel
// Box, at −60°, never rises there.
const planRows = page => page.$$eval('#targetSec .row', r => r.map(x => [x.dataset.id, x.querySelector('.dt').textContent, x.querySelector('.rate').textContent]));
const savedPlan = page => page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).plan);
check('A plan lists its picks by best time, marks what is badly placed, and opens from its link elsewhere', async () => {
  const init = () => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.copied = t; return Promise.resolve(); } } }); };
  let { ctx, page, problems, outside } = await open({ time: '2026-11-15T21:00:00-06:00', init });
  let link;
  try {
    await page.click('#targetSec .chip[data-f="plan"]');
    assert.match(await text(page, '#tBody .lede'), /^Nothing in your plan yet\. Add to plan on a card puts it here/);
    const add = async () => { await page.click('#planB'); assert.equal(await text(page, '#planB'), '✓ In your plan'); await page.click('#sheet [data-close]'); };
    for (const q of ['andromeda', 'jewel box', 'vega', 'saturn']) { await page.fill('#findQ', q); await page.click('#findRes button'); await add(); }
    assert.deepEqual(await savedPlan(page), ['M31', 'NGC 4755', 'Vega', 'Saturn']);
    const rows = await planRows(page);
    assert.deepEqual(rows.map(r => r[0]), ['4', 'Saturn', 'M31', 'NGC 4755'], 'in order of best time, with what isn’t up last');
    assert.match(rows[0][1], /Best 6:29 pm/);
    assert.match(rows[1][1], /Best 9:24 pm/);
    assert.deepEqual(rows[3].slice(1), ['Not up after dark on this night', 'Not up']);
    assert.equal(await page.$eval('#targetSec h2 small', s => s.textContent), '4 targets');
    // a second tap on the card takes it out
    await page.click('#targetSec .row[data-id="Saturn"]');
    await page.click('#planB');
    assert.equal(await text(page, '#planB'), 'Add to plan');
    await page.click('#planB');
    await page.click('#sheet [data-close]');
    assert.deepEqual(await savedPlan(page), ['M31', 'NGC 4755', 'Vega', 'Saturn']);
    await page.click('#planShare');
    await page.waitForFunction(() => window.copied);
    link = await page.evaluate(() => window.copied);
    assert.equal(link, base + '#plan=M31,NGC4755,Vega,Saturn');
    assert.match(await text(page, '#toast'), /^Copied a link to your plan$/);
    // Clear plan, and Put it back
    await page.click('#planClear');
    assert.deepEqual(await savedPlan(page), []);
    await page.click('#planBack');
    assert.deepEqual(await savedPlan(page), ['M31', 'NGC 4755', 'Vega', 'Saturn']);
    assert.deepEqual(problems, []);
    assert.deepEqual(outside, []);
  } finally { await ctx.close(); }
  // The link from Sydney, where the Jewel Box is well up before dawn, by someone whose plan holds M42 already:
  // theirs stays, the link's picks are added, and the address loses the plan so a reload doesn't add them again.
  ({ ctx, page, problems } = await open({ loc: SYDNEY, save: JSON.stringify({ loc: SYDNEY, plan: ['M42'] }), time: '2026-11-15T22:00:00+11:00' }));
  try {
    await page.goto(link); await ready(page);
    assert.match(await text(page, '#toast'), /^Added 4 targets from a shared plan to yours$/);
    assert.deepEqual(await savedPlan(page), ['M42', 'M31', 'NGC 4755', 'Vega', 'Saturn']);
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.equal(await page.$eval('#targetSec .chip[data-f="plan"]', c => c.getAttribute('aria-pressed')), 'true', 'Your plan is open');
    const jewel = (await planRows(page)).find(r => r[0] === 'NGC 4755');
    assert.doesNotMatch(jewel[1], /Not up|Too low/, 'well placed from Sydney: ' + jewel[1]);
    await page.reload(); await ready(page);
    assert.equal((await savedPlan(page)).length, 5);
    // a link typed by hand, with spaces, any case and Greek spelt out, and a name Starhop doesn't know
    await page.goto(base + '#plan=ngc%20869,SATURN,nuOph,crux'); await ready(page);
    assert.deepEqual((await savedPlan(page)).slice(5), ['NGC 869', 'ν Oph']);
    assert.match(await text(page, '#toast'), /^Added 2 targets from a shared plan to yours$/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // someone new, whose place is guessed from the time zone, hears about the plan first and the guess after it
  ({ ctx, page, problems } = await open({ loc: null, time: '2026-11-15T21:00:00-06:00', hash: '#plan=M31' }));
  try {
    assert.equal(await text(page, '#toast'), 'Opened a shared plan of 1 target');
    await page.waitForTimeout(1500);
    assert.equal(await text(page, '#toast'), 'Opened a shared plan of 1 target', 'not covered by the guess straight away');
    await page.waitForFunction(() => /^Guessed /.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // a damaged plan in the save opens with what makes sense in it
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, plan: [1, 'M31', 'M31', '', null] }), time: '2026-11-15T21:00:00-06:00' }));
  try {
    await page.click('#targetSec .chip[data-f="plan"]');
    assert.deepEqual((await planRows(page)).map(r => r[0]), ['M31']);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // under the midnight sun a deep-sky object has no dark to be seen in
  ({ ctx, page, problems } = await open({ loc: TROMSO, save: JSON.stringify({ loc: TROMSO, plan: ['M31', 'Vega', 'Jupiter'] }), time: '2026-06-21T23:30:00+02:00' }));
  try {
    await page.click('#targetSec .chip[data-f="plan"]');
    const rows = await planRows(page);
    assert.deepEqual(rows.find(r => r[0] === 'M31').slice(1), ['The sky stays too bright on this night', 'Too bright']);
    assert.ok(rows.some(r => r[0] === 'Jupiter'));
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // Albireo the star (whose card the map opens) and Albireo the double are one pick, and a plan holds 100 at most
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, plan: Array.from({ length: 98 }, (_, i) => 'M' + (i + 1)) }), time: '2026-11-15T21:00:00-06:00', hash: '#plan=Albireo,albireo,betaCyg,M99,M100,M101' }));
  try {
    const plan = await savedPlan(page);
    assert.deepEqual(plan.slice(97), ['M98', 'albireo', 'M99']);
    assert.equal(plan.length, 100);
    const rows = await planRows(page);
    assert.equal(rows.length, 100);
    assert.equal(rows.filter(r => r[0] === 'albireo').length, 1);
    assert.equal(await text(page, '#toast'), 'Added 2 targets from a shared plan to yours');
    await page.goto(base + '#plan=M102'); await ready(page);
    assert.equal(await text(page, '#toast'), 'Your plan holds 100 targets at most');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Saved places, each with its own sky: a trip doesn't overwrite home, and the ratings follow the place. Fort Davis
// (McDonald Observatory, 30.67° N, 104.02° W) as a dark site.
const savedPlaces = page => page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).places.map(p => p.name + ':' + p.sky));
const ratingsSky = page => page.$eval('#targetSec .note:not(.tally)', n => n.textContent.match(/under (\S+) skies/)[1]);
check('Saved places each keep their own sky, and a trip doesn’t overwrite home', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await page.click('#locBtn');
    assert.match(await text(page, '#sheet .places'), /^YOUR PLACES Keep the places you observe from/);
    await page.click('#pAdd');
    assert.equal(await page.$eval('#pName', i => i.value), 'Austin, TX', 'the name starts as the place’s');
    assert.equal(await page.$eval('#pSky .on', b => b.dataset.s), 'suburb', 'and the sky as the one showing');
    await page.fill('#pName', 'Home');
    await page.click('#pOk');
    assert.equal(await sheetOpen(page), false);
    assert.equal(await text(page, '#locName'), 'Home');
    assert.deepEqual(await savedPlaces(page), ['Home:suburb']);
    // a dark site, by its coordinates
    await page.click('#locBtn');
    await page.fill('#lLat', '30.67'); await page.fill('#lLon', '-104.02');
    await page.click('#lUse');
    await page.click('#locBtn');
    assert.equal(await page.$eval('#sheet [data-p="0"]', b => b.getAttribute('aria-pressed')), 'false', 'Home isn’t where it is now');
    await page.click('#pAdd');
    await page.fill('#pName', 'Club field');
    await page.click('#pSky [data-s="dark"]');
    await page.click('#pOk');
    assert.deepEqual(await savedPlaces(page), ['Home:suburb', 'Club field:dark']);
    assert.equal(await ratingsSky(page), 'dark-site', 'the ratings follow the place');
    const m33 = async () => (await targetRows(page)).find(r => r.id === 'M33').rate, darkM33 = await m33();
    // back home, its own sky comes back
    await page.click('#locBtn');
    await page.click('#sheet [data-p="0"]');
    assert.equal(await text(page, '#locName'), 'Home');
    assert.equal(await ratingsSky(page), 'suburban');
    assert.match(await text(page, '#toast'), /^Showing the sky over Home, under suburban skies$/);
    assert.notEqual(await m33(), darkM33, 'the Triangulum Galaxy is rated for each place’s sky: ' + darkM33);
    // a sky chosen at home is kept with home
    await page.click('#scopeBtn');
    assert.match(await text(page, '#sheet'), /Kept with Home, one of your places/);
    await page.click('#skyOpts [data-s="city"]');
    await page.click('#scSave');
    assert.deepEqual(await savedPlaces(page), ['Home:city', 'Club field:dark']);
    // a trip somewhere else doesn't touch either, and keeps the sky that was showing
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    await page.click('#lres button');
    assert.match(await text(page, '#locName'), /^Tucson/);
    assert.deepEqual(await savedPlaces(page), ['Home:city', 'Club field:dark']);
    assert.equal(await ratingsSky(page), 'city');
    // Use these coordinates a few hundred metres from the club field finds it, and its sky
    await page.click('#locBtn');
    await page.fill('#lLat', '30.672'); await page.fill('#lLon', '-104.018');
    await page.click('#lUse');
    assert.equal(await text(page, '#locName'), 'Club field');
    assert.equal(await ratingsSky(page), 'dark-site');
    // removing one
    await page.click('#locBtn');
    assert.match(await text(page, '#sheet .places'), /Its sky goes with it/);
    await page.click('#sheet [data-pdel="0"]');
    assert.deepEqual(await savedPlaces(page), ['Club field:dark']);
    assert.equal(await sheetOpen(page), true, 'the sheet stays open');
    await page.click('#sheet [data-close]');
    await page.reload(); await ready(page);
    assert.equal(await text(page, '#locName'), 'Club field');
    assert.deepEqual(await savedPlaces(page), ['Club field:dark']);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // a damaged list of places opens with the ones that make sense
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, places: [{ name: 'X', lat: 'a', lon: 2, tz: 'UTC' }, { name: 'Ok', lat: 10, lon: 10, tz: 'UTC', sky: 'zzz' }, 'junk'] }), time: '2026-11-15T21:00:00-06:00' }));
  try {
    await page.click('#locBtn');
    assert.deepEqual(await page.$$eval('#sheet [data-p]', b => b.map(x => x.innerText.replace(/\s+/g, ' '))), ['Ok Suburbs · Bortle 7']);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// At 7:30 pm in New York on Nov 15 2026 the list put Venus, Jupiter and Mercury, which rise before dawn, above Saturn,
// up now. Astronomy Engine 2.1.19 has Jupiter rising at 11:17 pm there, and Saturn setting at 1:44 am.
const NEW_YORK = { name: 'New York, NY', lat: 40.71, lon: -74.01, tz: 'America/New_York' };
check('in the evening what is up before midnight comes first, and what has set is dimmed', async () => {
  // up now or rising before midnight, rising after it, set for the night
  const group = when => /^Set /.test(when) ? 2 : /^Rises \d+:\d\d am/.test(when) ? 1 : 0;
  let { ctx, page, problems } = await open({ loc: NEW_YORK, time: '2026-11-15T19:30:00-05:00' });
  try {
    const rows = await targetRows(page), at = id => rows.findIndex(r => r.id === id);
    assert.ok(at('Saturn') < at('Venus') && at('Saturn') < at('Mercury'), rows.slice(0, 8).map(r => r.id).join());
    assert.match(rows[at('Jupiter')].when, /^Rises 11:17 pm · Best 6:07 am/);
    assert.match(rows[at('Venus')].when, /^Rises 4:09 am · Best 6:17 am/);
    rows.slice(1).forEach((r, i) => assert.ok(group(rows[i].when) <= group(r.when), `${rows[i].id} (${rows[i].when}) before ${r.id} (${r.when})`));
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // At 11:30 pm the Moon has set (9:50 pm), and M13 (9:39 pm): their rows go last, dimmed.
  ({ ctx, page, problems } = await open({ loc: NEW_YORK, time: '2026-11-15T23:30:00-05:00' }));
  try {
    const rows = await targetRows(page), dim = await page.$$eval('#targetSec .row.gone', r => r.map(x => x.dataset.id));
    assert.match(rows.find(r => r.id === 'M13').when, /^Set 9:39 pm/);
    assert.ok(dim.includes('Moon') && dim.includes('M13'), dim.join());
    assert.deepEqual(rows.filter(r => group(r.when) === 2).map(r => r.id), dim, 'every set row is dimmed, and only those');
    assert.deepEqual(rows.slice(-dim.length).map(r => r.id), dim, 'and they come last');
    // the name steps down to the second line's colour
    const [nm, dt] = await page.$eval('#targetSec .row.gone', r => [getComputedStyle(r.querySelector('.nm')).color, getComputedStyle(r.querySelector('.dt')).color]);
    assert.equal(nm, dt);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // After midnight the order is the list's own: Venus, best at dawn, above Saturn, which sets at 1:44 am.
  ({ ctx, page, problems } = await open({ loc: NEW_YORK, time: '2026-11-16T01:00:00-05:00' }));
  try {
    const rows = await targetRows(page), at = id => rows.findIndex(r => r.id === id);
    assert.ok(at('Venus') < at('Saturn'), rows.slice(0, 8).map(r => r.id).join());
    assert.ok(await page.$('#targetSec .row.gone[data-id="Moon"]'), 'the Moon, set, is still dimmed');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Hay River, Sep 19 1999: Mesarthim is 0.4° below the horizon at the start of the night and never gets lower than
// 0.5° down, the level that allows for refraction, so it never sets; at 9 pm it's 12° up.
check('a card calls something up all night when it is', async () => {
  const { ctx, page, problems } = await open({ loc: { name: 'Hay River, CA', lat: 60.85, lon: -115.7, tz: 'America/Yellowknife' }, time: '1999-09-19T21:00:00-06:00' });
  try {
    await openCard(page, 'mesarthim');
    assert.match(await text(page, '#sheet .card .big'), /^12° up/);
    assert.match(await cardRiseSet(page), /^Up all night · Highest/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Nov 14 2026: Mercury sets at 4:45 pm and the Sun at 5:34 pm (Astronomy Engine), so it's gone 49 minutes
// before sunset; it rises again at 5:31 am, before the 6:56 am sunrise.
check('a planet that sets before sunset isn’t called up at dusk', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-14T21:00:00-06:00' });
  try {
    await openCard(page, 'Mercury');
    const rs = await cardRiseSet(page);
    assert.match(rs, /^Sets before sunset \(4:45 pm\) · Rises 5:31 am/);
    assert.doesNotMatch(rs, /Up at dusk/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026: the Sun sets at 7:01 pm and is 6° down by 7:28.
check('stars come out steadily through dusk', async () => {
  const dusk = Date.parse('2026-10-13T19:00:00-05:00');
  const { ctx, page } = await open({ time: dusk });
  try {
    const counts = [];
    for (let m = 5; m <= 40; m += 5) {
      await page.clock.pauseAt(new Date(dusk + m * 60e3));
      await page.click('#nowBtn');
      await page.clock.runFor(100); // the map redraws on the next frame
      counts.push(await page.evaluate(() => document.getElementById('sky').__hits().filter(h => h.obj.k === 'star').length));
    }
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], 'stars drawn every 5 minutes from 7:05 pm: ' + counts.join(', '));
  } finally { await ctx.close(); }
});

// Six minutes after sunset in Austin on Nov 15 the map facing west marked 31 clusters, nebulae and galaxies (M8, M17,
// M20, M22, M51, M101 …) under the banner saying only the brightest stars show yet, and the dawn sky facing east
// marked M3, M64, M101 and M104.
check('Clusters and galaxies follow the sky: none in early twilight, the showpieces once it darkens', async () => {
  const dso = page => page.evaluate(() => document.getElementById('sky').__hits().filter(h => h.obj.k === 'dso').map(h => h.obj.id));
  const at = async (page, time, d) => {
    await page.clock.pauseAt(new Date(time));
    await page.click('#nowBtn');
    await page.click(`#dirSeg button[data-d="${d}"]`);
    await page.clock.runFor(200);
    return dso(page);
  };
  const { ctx, page, problems } = await open({ time: '2026-11-15T17:39:00-06:00' });
  try {
    assert.deepEqual(await at(page, '2026-11-15T17:40:00-06:00', '270'), [], 'deep-sky marks at 5:40 pm, 6 minutes after sunset');
    // what you pick still shows
    await openCard(page, 'M13');
    await page.clock.runFor(200);
    assert.deepEqual(await dso(page), ['M13'], 'only the object whose card is open shows at 5:40 pm');
    await page.click('#sheet [data-close]');
    const e = await at(page, '2026-11-15T18:15:00-06:00', '90');
    for (const id of ['M31', 'M45']) assert.ok(e.includes(id), `${id} shows at 6:15 pm with the Sun 9° down (${e.join(' ')})`);
    assert.ok((await at(page, '2026-11-15T21:00:00-06:00', '90')).length >= 10, 'a dark night shows them all');
    assert.ok((await at(page, '2026-11-16T05:50:00-06:00', '270')).includes('M42'), 'M42 shows at 5:50 am with the Sun 12° down');
    assert.deepEqual(await at(page, '2026-11-16T06:30:00-06:00', '90'), ['M13'], 'deep-sky marks at 6:30 am, half an hour before sunrise, besides M13, still picked');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const DOB8 = { name: '8″ Dobsonian', ap: 203, fl: 1200, eps: [{ f: 25, a: 52 }, { f: 6, a: 52 }], set: true };
const openCard = async (page, id) => {
  if (!await page.$(`#targetSec .row[data-id="${id}"]`) && await page.$('#moreT')) await page.click('#moreT');
  await page.click(`#targetSec .row[data-id="${id}"]`);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};

// At 6 am on Oct 14 2026 PyEphem, with its own moon theory, puts Io 0.70′ east of Jupiter and Europa 0.50′.
check("Jupiter's moons are drawn where they're seen, allowing for light time", async () => {
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-10-14T06:00:00-05:00' });
  try {
    await openCard(page, 'Jupiter');
    await page.waitForFunction(() => document.getElementById('eyepiece').__moons, null, { timeout: 10000 });
    const m = await page.$eval('#eyepiece', c => c.__moons), ref = { io: 0.70, europa: 0.50, ganymede: -2.11, callisto: 0.79 };
    for (const k in ref) assert.ok(Math.abs(m[k].east - ref[k]) < 0.05, `${k} is drawn ${m[k].east.toFixed(2)}′ east of Jupiter; it's ${ref[k]}′`);
    // Io, Europa and Callisto are within 0.3′ of each other, so their letters have to make room.
    const tags = Object.keys(ref).map(k => [k, m[k].tag]);
    for (const [k, t] of tags) assert.ok(t, `${k} has its letter`);
    tags.forEach(([a, ta], i) => tags.slice(i + 1).forEach(([b, tb]) => assert.ok(!overlaps(ta, tb), `the letters of ${a} and ${b} overlap`)));
  } finally { await ctx.close(); }
});

// Every label on a chart is inside it, apart from the others, and off the boxes kept clear.
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const checkLabels = (labels, w, h, keep, where) => {
  assert.ok(labels.length > 3, where + ': labels are drawn');
  for (const l of labels) assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= w && l.y + l.h <= h, `${where}: "${l.t}" runs off the edge`);
  labels.forEach((a, i) => labels.slice(i + 1).forEach(b => assert.ok(!overlaps(a, b), `${where}: "${a.t}" and "${b.t}" overlap`)));
  for (const l of labels) for (const k of keep) assert.ok(!overlaps(l, k), `${where}: "${l.t}" is under ${k.what}`);
};
// The map's labels and compass letters, and the time, banner and buttons over it, which they keep 2px clear of.
const mapLabels = page => page.evaluate(() => {
  const c = document.getElementById('sky'), r = c.getBoundingClientRect();
  const keep = ['when', 'nowBtn', 'banner', 'layBtn', 'dirSeg', 'ptBtn', 'zOut', 'zIn'].map(id => [id, document.getElementById(id).getBoundingClientRect()]).filter(([, b]) => b.width).map(([id, b]) => ({ what: '#' + id, x: b.left - r.left - 2, y: b.top - r.top - 2, w: b.width + 4, h: b.height + 4 }));
  return { labels: c.__labels(), w: r.width, h: r.height, keep };
});
const finderLabels = page => page.$eval('#finder', c => { const r = c.getBoundingClientRect(); return { labels: c.__labels, w: r.width, h: r.height, keep: [Object.assign({ what: 'the stamp' }, c.__stamp)] }; });

check('chart labels stay inside, keep apart, keep off the map’s buttons and the finder’s stamp, and go over the ground', async () => {
  // On a phone at 7:10 pm on Oct 13, facing west puts M11 under the time, M17 under Now and the Cat's Eye under Show,
  // and facing north puts M13 under the time. At 8:50 Capella sits under the time in the whole-sky view.
  let { ctx, page, problems } = await open({ time: '2026-10-13T19:10:00-05:00' });
  try {
    for (const [d, at] of [['270', '7:10'], ['0', '7:10'], ['up', '8:50']]) {
      if (at === '8:50') { await page.clock.pauseAt(new Date('2026-10-13T20:50:00-05:00')); await page.click('#nowBtn'); await page.clock.runFor(100); }
      await page.click(`#dirSeg button[data-d="${d}"]`);
      await page.waitForTimeout(150);
      const { labels, w, h, keep } = await mapLabels(page);
      checkLabels(labels, w, h, keep, `phone map at ${at} facing ${d}`);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // From Chicago at 9:15 pm on Oct 16 the NE on the horizon falls against the Now button.
  ({ ctx, page, problems } = await open({ loc: { name: 'Chicago, IL', lat: 41.85, lon: -87.65, tz: 'America/Chicago' }, time: '2026-10-16T21:15:00-05:00' }));
  try {
    await page.waitForFunction(() => document.getElementById('sky').__labels().length > 3);
    const { labels, w, h, keep } = await mapLabels(page);
    assert.ok(['N', 'E', 'S', 'W'].some(d => labels.some(l => l.t === d)), 'the compass letters are counted with the labels');
    checkLabels(labels, w, h, keep, 'phone map from Chicago');
    // Italic constellation names lean past their width, so ARIES and ANDROMEDA used to run together into one word.
    for (const c of labels.filter(l => /\u200a/.test(l.t))) for (const l of labels) if (l !== c && c.y < l.y + l.h && l.y < c.y + c.h) {
      const gap = Math.max(l.x - (c.x + c.w), c.x - (l.x + l.w));
      assert.ok(gap >= 6, `"${c.t}" and "${l.t}" are only ${gap.toFixed(1)}px apart`);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false }));
  try {
    await page.waitForFunction(() => document.getElementById('sky').__labels().length > 3);
    const { labels, w, h, keep } = await mapLabels(page);
    checkLabels(labels, w, h, keep, 'desktop map');
    // Arcturus is just above the western horizon, and its label used to vanish under the ground
    const lit = await page.evaluate(() => {
      const c = document.getElementById('sky'), l = c.__labels().find(x => x.t === 'Arcturus'), k = c.width / c.getBoundingClientRect().width;
      if (!l) return -1;
      const d = c.getContext('2d').getImageData(Math.round(l.x * k), Math.round(l.y * k), Math.round(l.w * k), Math.round(l.h * k)).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 420) n++;
      return n;
    });
    assert.ok(lit > 10, 'Arcturus’s label shows over the ground (' + lit + ' bright pixels)');
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    const f = await finderLabels(page);
    checkLabels(f.labels, f.w, f.h, f.keep, 'M13’s finder chart');
    const rut = f.labels.find(l => l.t === 'Tianji');
    assert.ok(rut, 'Tianji, where the star-hop ends, keeps its label beside the target’s ring');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // From Sydney, Omega Centauri's chart has Rigil Kentaurus near its right edge and two stars by the stamp.
  ({ ctx, page, problems } = await open({ loc: { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' }, time: '2026-04-15T22:00:00+10:00' }));
  try {
    await openCard(page, 'NGC 5139');
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    const f = await finderLabels(page);
    checkLabels(f.labels, f.w, f.h, f.keep, 'Omega Centauri’s finder chart');
    const rk = f.labels.find(l => l.t === 'Rigil Kentaurus');
    assert.ok(rk && rk.x + rk.w <= rk.ax, 'Rigil Kentaurus is labelled on the left of its star, near the right edge');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// How much of a small patch of the map, centred at a fraction of its width and height, is the ground's colour.
// Night vision's ground is (18, 2, 1) and its sky (11, 1, 1) to (22, 0, 0) by the Milky Way, so it's matched more closely.
const GROUND = [10, 15, 11], GROUND_RED = [18, 2, 1];
const groundAt = (page, fx, fy, rgb = GROUND) => page.$eval('#sky', (c, [fx, fy, rgb]) => {
  const tol = rgb[1] < 5 ? 1 : 3;
  const x = Math.round(c.width * fx), y = Math.round(c.height * fy), d = c.getContext('2d').getImageData(x - 4, y - 4, 9, 9).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol) n++;
  return n / (d.length / 4);
}, [fx, fy, rgb]);

// Facing a direction on a phone, the corner of the map is less than 73° from its centre, and the points the horizon was
// drawn through were 73° away, so they were all dropped and neither the ground nor the horizon line was drawn.
check('the ground shows when a phone faces south', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await page.click('#dirSeg button[data-d="180"]');
    await page.waitForTimeout(150);
    assert.ok(await groundAt(page, 0.5, 0.97) > 0.8, 'the foot of the map facing south is the ground');
    assert.ok(await groundAt(page, 0.5, 0.2) < 0.2, 'and the top of it is sky');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // Zoomed in to about 44° near the horizon on a desktop
  ({ ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false }));
  try {
    await page.click('#dirSeg button[data-d="180"]');
    for (let i = 0; i < 3; i++) await page.click('#zIn');
    await page.focus('#sky');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    assert.ok(await groundAt(page, 0.5, 0.97) > 0.8, 'the foot of a zoomed-in map is the ground');
    assert.ok(await groundAt(page, 0.5, 0.2) < 0.2, 'and the top of it is sky');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Point lets the view go 40° below the horizon. With the back of the phone 10° below it, the nadir was past the edge
// of the view and dropped, which read as "the ground is outside the horizon" and painted the whole sky as ground.
check('pointing a little below the horizon keeps the ground below and the stars above', async () => {
  for (const red of [false, true]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red }), time: '2026-11-15T21:00:00-06:00' });
    try {
      await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
      await page.click('#ptBtn');
      await page.waitForFunction(() => document.documentElement.classList.contains('pointing'));
      // alpha 90, beta 80: the back of the phone faces west, 10° below the horizon
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 80, gamma: 0, absolute: true })));
      await page.waitForTimeout(150);
      const rgb = red ? GROUND_RED : GROUND, mode = red ? ' in night vision' : '';
      assert.ok(await groundAt(page, 0.5, 0.25, rgb) < 0.2, 'above the horizon is sky' + mode);
      assert.ok(await groundAt(page, 0.5, 0.8, rgb) > 0.8, 'below the horizon is the ground' + mode);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Night vision lets no light but red through: a pixel counts as not red when its green or blue is more than about a
// third of its red, allowing a little for near-black. The screenshot is read back in the page, so nothing else is needed.
const notRed = async (page, what) => {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ([png, what]) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0, worst = null, at = null;
    for (let i = 0; i < d.length; i += 4) {
      const over = Math.max(d[i + 1], d[i + 2]) - (0.35 * d[i] + 8);
      if (over > 0) { n++; if (!worst || over > worst.over) { worst = { over, rgb: [d[i], d[i + 1], d[i + 2]] }; at = [(i / 4) % img.width, Math.floor(i / 4 / img.width)]; } }
    }
    return n ? `${what}: ${n} pixels aren't red, the worst (${worst.rgb}) at ${at}` : '';
  }, [png, what]);
};

check('night vision has no light but red', async () => {
  let { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red: true }), time: '2026-11-15T21:00:00-06:00' });
  const leaks = [];
  const look = async what => { const l = await notRed(page, what); if (l) leaks.push(l); };
  try {
    assert.equal(await page.$eval('meta[name=theme-color]', m => m.content), '#070000', 'the browser bar goes red too');
    await look('the page');
    const row = page.locator('#targetSec .row').first();
    await row.scrollIntoViewIfNeeded();
    await look('the list');
    // the frame right after a tap, when Chromium flashes its tap highlight over the row and the card opening on it
    await row.tap();
    await look('the frame after tapping a row');
    await page.waitForTimeout(400);
    await look('a card');
    await page.click('#sheet [data-close]');
    await openCard(page, 'M15');
    await page.click('#seenB');
    await page.fill('#sheet .lgNote', 'A long note that runs on to a second line and a third, so the box grows with it');
    await page.click('#sheet [data-r="seeing"][data-v="3"]');
    await page.locator('#sheet .logc').scrollIntoViewIfNeeded();
    await look('a card’s log entry, with its note box focused');
    await page.click('#openLog');
    await page.click('#sheet .lge summary');
    await page.waitForTimeout(300);
    await look('the log');
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    await page.waitForTimeout(300);
    await look('the telescope sheet');
    await page.click('#sheet [data-close]');
    await page.click('#locBtn');
    await page.waitForFunction(() => /place/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    await look('the location sheet, with its placeholder');
    await page.fill('#lLat', '30.27');
    await page.fill('#lLon', '-97.74');
    await page.click('#lUse');
    await page.waitForTimeout(400);
    await look('a message');
    await page.reload();
    await ready(page);
    assert.equal(await page.$eval('meta[name=theme-color]', m => m.content), '#070000', 'the browser bar stays red after a reload');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('red')), 'night vision stays on after a reload');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // In twilight, with the banner over the map
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red: true }), time: '2026-11-15T17:45:00-06:00' }));
  try {
    assert.ok(await page.isVisible('#banner'), 'the twilight banner shows');
    await look('the twilight banner');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  assert.deepEqual(leaks, []);
});

// The red look came only once the star catalog had loaded, so every reload (after the phone drops the page, or on a
// weak signal at a field) showed the cream-and-blue look first.
check('Night vision is red before the star catalog arrives', async () => {
  let release; const held = new Promise(r => { release = r; });
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red: true }), time: '2026-11-15T21:00:00-06:00', wait: false,
    route: ['**/data/stars.json', async r => { await Promise.race([held, new Promise(ok => setTimeout(ok, 2000))]); await r.continue().catch(() => {}); }] });
  try {
    assert.equal(await page.$eval('#keys', k => k.children.length), 0, 'the catalog is still on its way');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('red')), 'the page is red already');
    assert.equal(await page.$eval('.brand', b => getComputedStyle(b).color), 'rgb(226, 74, 60)', 'the name is red');
    assert.equal(await page.$eval('meta[name=theme-color]', m => m.content), '#070000', 'and so is the browser bar');
    const leak = await notRed(page, 'the page while the catalog loads');
    release();
    await ready(page);
    assert.equal(leak, '');
    assert.deepEqual(problems, []);
  } finally { release(); await ctx.close(); }
});

// A stand-in for the Screen Wake Lock API, which headless Chromium refuses, and for the page being hidden, when the
// browser lets go of every lock (W3C Screen Wake Lock API, "Handling document loss of visibility").
const fakeWakeLock = () => {
  const w = window.__wake = { asked: 0, held: new Set() };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => {
    w.asked++;
    const s = new EventTarget();
    s.released = false;
    s.release = () => { if (!s.released) { s.released = true; w.held.delete(s); s.dispatchEvent(new Event('release')); } return Promise.resolve(); };
    w.held.add(s);
    return Promise.resolve(s);
  } } });
  let shown = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => shown });
  w.hide = () => { shown = 'hidden'; [...w.held].forEach(s => s.release()); document.dispatchEvent(new Event('visibilitychange')); };
  w.show = () => { shown = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };
};
const point = async page => {
  await page.click('#ptBtn');
  await page.waitForFunction(() => document.documentElement.classList.contains('pointing'));
  await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 80, gamma: 0, absolute: true })));
};
const wake = page => page.evaluate(() => ({ asked: window.__wake.asked, held: window.__wake.held.size }));

check('the screen stays on while pointing, after switching apps too, and lets go when pointing stops', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    for (let i = 1; i <= 5; i++) {
      await point(page);
      await page.waitForFunction(() => window.__wake.held.size === 1);
      await page.evaluate(() => window.__wake.hide());
      assert.equal((await wake(page)).held, 0);
      await page.evaluate(() => window.__wake.show());
      await page.waitForFunction(() => window.__wake.held.size === 1, null, { timeout: 3000 }).catch(() => {});
      assert.equal((await wake(page)).held, 1, 'the screen is kept on again when the page comes back, round ' + i);
      await page.evaluate(() => window.__wake.show()); // brought back twice: still one lock
      await page.waitForTimeout(50);
      assert.equal((await wake(page)).held, 1, 'one lock, not two, round ' + i);
      await page.click('#ptBtn');
      await page.waitForTimeout(50);
      assert.deepEqual(await wake(page), { asked: 2 * i, held: 0 }, 'stopping lets go of the lock, round ' + i);
    }
    await page.evaluate(() => { window.__wake.hide(); window.__wake.show(); });
    await page.waitForTimeout(50);
    assert.equal((await wake(page)).held, 0, 'nothing keeps the screen on once pointing has stopped');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// After Show in the sky view, Point gave no hint which way to turn to find the object: finding its part of the sky is
// what Point is for. Austin at 9 pm on Nov 15: M31 is 77° up in the northeast.
const face = (page, az, alt) => page.evaluate(([az, alt]) => { for (let i = 0; i < 30; i++) window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: (360 - az) % 360, beta: 90 + alt, gamma: 0, absolute: true })); }, [az, alt]);
const guide = page => page.$eval('#sky', c => c.__point());
// true when a box covers the crosshair, which reaches 14px out from the middle
const overCross = (b, w, h) => b.x < w / 2 + 14 && b.x + b.w > w / 2 - 14 && b.y < h / 2 + 14 && b.y + b.h > h / 2 - 14;
check('Point says which way to turn to the object picked, and There once it is in the middle', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    await point(page);
    await face(page, 200, 30);
    await page.waitForTimeout(100);
    assert.deepEqual(await guide(page), { there: false, text: '' }, 'with nothing picked, only the crosshair');
    await page.click('#ptBtn');
    await openCard(page, 'M31');
    await page.click('#ctr');
    await page.waitForTimeout(300);
    for (let i = 1; i <= 20; i++) {
      await point(page);
      await face(page, 200, 30);
      await page.waitForTimeout(80);
      const off = await guide(page), w = await page.evaluate(() => innerWidth), h = await page.evaluate(() => innerHeight);
      assert.match(off.text, /^M31 · up \d+° · left \d+°$/, 'facing south, it says to turn up and left, round ' + i);
      assert.ok(off.arrow && (off.arrow.x <= 27 || off.arrow.x >= w - 27 || off.arrow.y <= 200 || off.arrow.y >= h - 71), 'with an arrow at the edge, round ' + i);
      assert.ok(off.arrow.x < w / 2, 'on the left, round ' + i);
      await face(page, 30, 75);
      await page.waitForTimeout(80);
      const at = await guide(page);
      assert.equal(at.text, 'There: M31', 'facing it, it says There, round ' + i);
      assert.ok(at.ring && Math.hypot(at.ring.x - w / 2, at.ring.y - h / 2) < 60, 'with a ring round it near the middle, round ' + i);
      if (i === 1) { await until(page, '#say', /There: M31/); assert.equal(await text(page, '#say'), 'There: M31', 'and a screen reader hears it'); }
      for (const [g, what] of [[off, 'the arrow'], [at, 'There']]) assert.ok(!overCross(g.plate, w, h), `the words beside ${what} keep off the crosshair, round ${i}`);
      await page.click('#ptBtn');
      assert.equal(await guide(page), null, 'Stop puts it away, round ' + i);
    }
    // a target straight to the left or right put its words, beside the arrow at the edge, over the crosshair
    await openCard(page, 'Moon');
    await page.click('#ctr');
    await point(page);
    await page.evaluate(() => { document.getElementById('ptHint').hidden = true; });
    await face(page, 20, 10);
    await page.waitForTimeout(100);
    const side = await guide(page), w = await page.evaluate(() => innerWidth), h = await page.evaluate(() => innerHeight);
    assert.match(side.text, /^Moon · up \d+° · left \d+°$/);
    assert.ok(!overCross(side.plate, w, h), 'the words beside a left arrow keep off the crosshair ' + JSON.stringify(side.plate));
    await page.click('#ptBtn');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // and stays red in night vision
  const r = await open({ save: JSON.stringify({ loc: AUSTIN, red: true }), time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    await r.ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    await openCard(r.page, 'M31');
    await r.page.click('#ctr');
    await point(r.page);
    await r.page.evaluate(() => { document.getElementById('ptHint').hidden = true; });
    for (const [az, alt] of [[200, 30], [30, 75]]) {
      await face(r.page, az, alt);
      await r.page.waitForTimeout(100);
      assert.ok((await guide(r.page)).text, 'it says something facing ' + az);
      assert.equal(await notRed(r.page, 'Point facing ' + az), '');
    }
    assert.deepEqual(r.problems, []);
  } finally { await r.ctx.close(); }
});

// Point fills the screen like a card, and Back is the natural way out of it, but Back left Starhop (on Android, it
// closed the installed app).
check('Back ends Point and stays in Starhop', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  const pointing = () => page.evaluate(() => document.documentElement.classList.contains('pointing'));
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(60); };
  const settled = () => page.waitForFunction(() => !history.state, null, { timeout: 5000 }).catch(() => {});
  const tapSomething = async () => {
    const at = await page.$eval('#sky', c => { const r = c.getBoundingClientRect(), h = c.__hits().find(h => h.obj.k !== 'star' && h.x > 40 && h.y > 90 && h.x < r.width - 40 && h.y < r.height - 120); return h && [r.left + h.x, r.top + h.y]; });
    assert.ok(at, 'something to tap on the map');
    await page.mouse.click(at[0], at[1]);
    await page.waitForFunction(() => !document.getElementById('sheet').hidden, null, { timeout: 5000 });
  };
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    const start = page.url(), steps = await page.evaluate(() => history.length);
    for (let i = 1; i <= 50; i++) {
      await point(page);
      await back();
      await page.waitForFunction(() => !document.documentElement.classList.contains('pointing'), null, { timeout: 5000 }).catch(() => {});
      assert.equal(await pointing(), false, 'Back ends Point, round ' + i);
      assert.equal(page.url(), start, 'and stays in Starhop, round ' + i);
      assert.equal(await page.evaluate(() => history.length), steps + 1, 'history doesn’t grow, round ' + i);
    }
    assert.match(await text(page, '#keys'), /Sunset/);
    assert.equal((await wake(page)).held, 0, 'nothing keeps the screen on');
    // a card opened from the map while pointing takes one Back, and Point the next
    for (let i = 1; i <= 5; i++) {
      await point(page);
      await tapSomething();
      await back();
      assert.equal(await sheetOpen(page), false, 'the first Back closes the card, round ' + i);
      assert.equal(await pointing(), true, 'and leaves Point on, round ' + i);
      await back();
      assert.equal(await pointing(), false, 'the second Back ends Point, round ' + i);
      await settled();
      assert.equal(page.url(), start);
      assert.equal(await page.evaluate(() => history.length), steps + 2, 'history doesn’t grow, round ' + i); // two steps forward remain
    }
    // ended any other way, Point leaves no step behind
    for (const how of ['Stop', 'Escape', 'the card, then Escape twice', 'Stop under the card']) {
      await point(page);
      if (how === 'Stop') await page.click('#ptBtn');
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else {
        await tapSomething();
        if (how === 'Stop under the card') { await page.$eval('#ptBtn', b => b.click()); await page.click('#sheet [data-close]'); }
        else {
          await page.keyboard.press('Escape');
          assert.equal(await sheetOpen(page), false, 'Escape closes the card first');
          assert.equal(await pointing(), true, 'and leaves Point on');
          await page.keyboard.press('Escape');
        }
      }
      await settled();
      assert.equal(await pointing(), false, how + ' ends Point');
      assert.equal(await sheetOpen(page), false);
      assert.equal(await page.evaluate(() => history.state), null, how + ' takes Point’s step off again');
      assert.equal(await page.evaluate(() => history.length), steps + (/card/.test(how) ? 2 : 1), how + ' leaves history as it was');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A drag while pointing corrects the compass and is kept for good, though the error depends on where the phone is
// held: nothing said a correction was in force, and only dragging back by eye undid it.
check('A remembered compass correction can be reset', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, ptOff: [-25.3, 4.1] }), time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  // where the W on the horizon sits across the map, from the middle (0) to the edges (±0.5); the phone faces west
  const west = () => page.$eval('#sky', c => { const w = c.__labels().find(l => l.t === 'W'); return w ? (w.x + w.w / 2) / c.getBoundingClientRect().width - 0.5 : null; });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).ptOff);
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    await point(page);
    await page.waitForTimeout(100);
    assert.ok(await page.isVisible('#ptFix'), 'the correction shows while pointing');
    assert.equal(await text(page, '#ptFix'), 'Compass corrected 25° · Reset');
    assert.ok(await west() > 0.1, 'the map is turned by the correction');
    await page.click('#ptFix button');
    await page.waitForTimeout(100);
    assert.equal(await saved(), undefined, 'Reset forgets the correction');
    assert.ok(Math.abs(await west()) < 0.02, 'and the map faces where the phone does');
    assert.equal(await page.isVisible('#ptFix'), false, 'with nothing to show');
    // a drag puts one back, and it is remembered
    const box = await page.locator('#sky').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.down();
    for (let x = 200; x >= 120; x -= 10) await page.mouse.move(box.x + x, box.y + 300);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.ok(Array.isArray(await saved()), 'a drag is remembered');
    assert.match(await text(page, '#ptFix'), /^Compass corrected \d+° · Reset$/);
    await page.click('#ptBtn');
    assert.equal(await page.isVisible('#ptFix'), false, 'Stop hides it');
    assert.match(await page.$eval('#ptHint', h => h.textContent), /remember/, 'the hint says a drag is remembered');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Austin, Nov 15 2026: sunrise is 7:02 am, so the night that is ending runs until 7:52 am.
// Stop sat at the left until a compass correction showed beside it, then jumped to the right, or on a narrow phone
// stayed left while the correction took its row.
// Turned sideways, a phone's map filled the screen and the list was a whole screen's scroll below it. Now the map and
// the night sit on the left and the panel scrolls on the right, as on a desktop; sheets still come up from the bottom.
check('A phone turned sideways puts the map and the night beside the list, and an upright one keeps them above it', async () => {
  for (const size of [[844, 390], [667, 375], [390, 844]]) {
    const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', size, init: fakeWakeLock });
    const sideways = size[0] > size[1];
    try {
      const box = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; });
      const sky = await box('#skybox'), tl = await box('.tl'), panel = await box('#panel');
      if (sideways) {
        assert.ok(panel.l >= sky.r - 1 && panel.l >= tl.r - 1, `${size}: the panel is right of the map and the night`);
        assert.ok(tl.t >= sky.b - 1 && tl.b <= size[1] + 1, `${size}: the night is under the map, all on screen`);
        assert.ok(sky.h >= 180, `${size}: the map is ${sky.h}px tall`);
        assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), `${size}: the page itself doesn't scroll`);
        const before = await page.$eval('#panel', p => { p.scrollTop = 600; return p.scrollTop; });
        assert.ok(before > 300, `${size}: the panel scrolls on its own`);
        assert.equal((await box('#skybox')).t, sky.t, `${size}: and the map stays put`);
        // a card comes up from the bottom, and closing it leaves the list where it was
        const row = page.locator('#targetSec .row').first();
        await row.scrollIntoViewIfNeeded();
        const at = await page.$eval('#panel', p => p.scrollTop);
        await row.click();
        await page.waitForFunction(() => !document.getElementById('sheet').hidden);
        const sh = await box('#sheet .sheet');
        assert.ok(Math.abs(sh.b - size[1]) <= 1 && sh.t > 0, `${size}: the card comes up from the bottom`);
        await page.click('#sheet [data-close]');
        await page.waitForTimeout(100);
        assert.equal(await page.$eval('#panel', p => p.scrollTop), at, `${size}: the list is where it was`);
        await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
        await point(page);
        const full = await box('#skybox');
        assert.ok(full.t <= 0 && full.b >= size[1] && full.r >= size[0], `${size}: Point fills the screen`);
        await page.click('#ptBtn');
        assert.deepEqual(await box('#skybox'), sky, `${size}: and gives it back after`);
      } else {
        assert.ok(panel.t >= tl.b - 1 && tl.t >= sky.b - 1, `${size}: upright, the map, the night and the panel stack`);
        assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight * 2), `${size}: and the page scrolls`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${size}: nothing scrolls sideways`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('Stop stays under the right thumb when a compass correction shows', async () => {
  for (const size of [[320, 568], [360, 740], [375, 667], [390, 844], [667, 375], [844, 390]]) {
    const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', size, init: fakeWakeLock });
    try {
      await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
      await point(page);
      const stop = () => page.$eval('#ptBtn', b => { const r = b.getBoundingClientRect(); return [Math.round(r.right), Math.round(r.bottom)]; });
      const before = await stop();
      assert.ok(await page.$eval('.ov-b .zoom', z => z.getBoundingClientRect().right) >= size[0] - 14, `${size}: Stop, − and + are at the right`);
      const c = await page.$eval('#sky', c => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await page.mouse.move(c[0], c[1]); await page.mouse.down(); await page.mouse.move(c[0] + 80, c[1] + 20, { steps: 8 }); await page.mouse.up();
      await page.waitForFunction(() => !document.getElementById('ptFix').hidden, null, { timeout: 5000 }).catch(() => {});
      assert.ok(await page.$eval('#ptFix', f => !f.hidden), `${size}: the correction shows`);
      assert.deepEqual(await stop(), before, `${size}: Stop stays where it was`);
      assert.ok(await page.evaluate(() => { const a = document.getElementById('ptFix').getBoundingClientRect(), b = document.querySelector('.ov-b .zoom').getBoundingClientRect(); return a.right <= b.left || a.bottom <= b.top; }), `${size}: the correction keeps clear of Stop`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// An iPhone on its side draws the page under the camera housing on one side and the home bar below (viewport-fit=cover),
// and nothing kept clear of them.
check('Nothing sits under the notch on a phone turned sideways', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', size: [844, 390], init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } });
    await page.evaluate(() => dispatchEvent(new Event('resize'))); // as turning a phone does
    await page.waitForTimeout(300);
    const outside = sels => page.evaluate(sels => sels.flatMap(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed').map(e => [sel, e.getBoundingClientRect()]).filter(([, r]) => r.width && (r.left < 47 || r.right > innerWidth - 47)).map(([sel, r]) => `${sel} at ${Math.round(r.left)}–${Math.round(r.right)}`)), sels);
    assert.deepEqual(await outside(['.brand', '#locBtn', '#scopeBtn', '#when', '#nowBtn', '#layBtn', '#dirSeg', '#zIn', '#prevN', '#nextN', '#nightTitle', '#keys span', '#tonightSec h2', '.fact', '.filters .chip', '#targetSec .row', '.more', '.ev', '.credits']), [], 'all of it keeps clear of the sides');
    const m = await mapLabels(page);
    checkLabels(m.labels, m.w, m.h, m.keep, 'the map with the notch');
    await page.click('#layBtn');
    assert.deepEqual(await outside(['#layers']), [], 'the layers menu too');
    await page.click('#lyDone');
    await point(page);
    const c = await page.$eval('#sky', c => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(c[0], c[1]); await page.mouse.down(); await page.mouse.move(c[0] + 80, c[1] + 20, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById('ptFix').hidden, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await outside(['#when', '#nowBtn', '#layBtn', '#ptFix', '#ptBtn', '#zOut', '#zIn', '#ptHint']), [], 'and in Point');
    assert.ok(await page.$eval('.ov-b', b => innerHeight - b.getBoundingClientRect().bottom >= 21), 'Point keeps above the home bar');
    await page.click('#ptBtn');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The header stuck below a top inset, over the map, with a strip of page showing through above it.
check('The header keeps under the status bar and covers it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, left: 0, right: 0, bottom: 34 } });
    await page.waitForTimeout(300);
    const top = () => page.evaluate(() => { const t = document.querySelector('.top').getBoundingClientRect(), b = document.querySelector('.brand').getBoundingClientRect(); return { top: Math.round(t.top), brand: Math.round(b.top), bottom: Math.round(t.bottom), sky: Math.round(document.getElementById('sky').getBoundingClientRect().top) }; });
    const a = await top();
    assert.ok(a.brand >= 47, `the header’s contents start below the status bar (${a.brand})`);
    assert.equal(a.top, 0, 'and its background reaches the top');
    assert.ok(a.sky >= a.bottom, 'the map starts below the header');
    await page.evaluate(() => scrollTo(0, 600));
    const b = await top();
    assert.equal(b.top, 0, 'scrolled, the header still reaches the top');
    assert.ok(b.brand >= 47, 'with its contents below the status bar');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Most buttons were 30 px or so, under the 44 px Apple asks for, and the direction buttons sit edge to edge.
check('Buttons take a tap a little outside their edges, and the map still drags beside them', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    // which button, if any, a tap at each side of each, 6 px out, lands on; and what is 12 px out
    const reach = sels => page.evaluate(sels => sels.flatMap(sel => [...document.querySelectorAll(sel)].map(b => {
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, seg = !!b.closest('.seg');
      const at = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest('button'); };
      const sides = [[cx, r.top - 6], [cx, r.bottom + 6]].concat(seg ? [] : [[r.left - 6, cy], [r.right + 6, cy]]);
      const miss = sides.filter(([x, y]) => { const o = at(x, y); return o !== b && !(o && o !== b && o.matches('button')); }).map(p => p.map(Math.round));
      return { sel, name: b.textContent.trim() || b.getAttribute('aria-label'), h: Math.round(r.height), miss };
    })), sels);
    for (const b of await reach(['#nowBtn', '#layBtn', '#dirSeg button', '#zOut', '#zIn', '#ptBtn', '#prevN', '#nextN', '#locBtn', '#redBtn', '#scopeBtn']))
      assert.deepEqual(b.miss, [], `${b.name}: a tap just outside it lands on it`);
    const nav = await page.$eval('#prevN', b => b.getBoundingClientRect().height);
    assert.ok(nav >= 36, `the night arrows are 36 px (${nav})`);
    // a drag that starts on the map beside a button moves the map
    for (const [id, side] of [['zIn', 'above'], ['nowBtn', 'right of'], ['dirSeg', 'above'], ['layBtn', 'below']]) {
      const p = await page.$eval('#' + id, (b, side) => { const r = b.getBoundingClientRect(); return side === 'right of' ? [r.right + 12, r.top + r.height / 2] : [r.left + r.width / 2, side === 'above' ? r.top - 12 : r.bottom + 12]; }, side);
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).id, p), 'sky', `12 px ${side} ${id} is the map`);
      const before = await page.$eval('#sky', c => JSON.stringify(c.__labels().map(l => [l.t, Math.round(l.x)])));
      await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.move(p[0] - 60, p[1] + 10, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(150);
      assert.notEqual(await page.$eval('#sky', c => JSON.stringify(c.__labels().map(l => [l.t, Math.round(l.x)]))), before, `a drag beside ${id} moves the map`);
    }
    await page.evaluate(() => scrollTo(0, document.getElementById('targetSec').offsetTop - 60));
    for (const b of await reach(['#targetSec .filters .chip'])) assert.deepEqual(b.miss.filter(([, y]) => y < 844 && y > 0), [], `the ${b.name} filter takes a tap just outside it`);
    await openCard(page, 'M45');
    const done = await page.$eval('#cardDone', b => b.getBoundingClientRect().height);
    assert.ok(done >= 36, `a card’s Done is 36 px (${done})`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Page zoom at 200% leaves a 390 px phone 195 px wide: the header ran off the side, the card's charts were wider than the
// card, and a long place name with no spaces widened the page and every sheet with it.
check('The page fits a phone zoomed to 200%', async () => {
  const LONG = { ...AUSTIN, name: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch' };
  for (const [size, loc] of [[[195, 422], AUSTIN], [[280, 600], AUSTIN], [[320, 568], AUSTIN], [[195, 422], LONG], [[390, 844], LONG]]) {
    const { ctx, page, problems } = await open({ loc, size, time: '2026-11-15T21:00:00-06:00' });
    const where = `${size[0]} px${loc === LONG ? ' with a long place name' : ''}`;
    const wide = () => page.evaluate(() => [document.documentElement.scrollWidth - innerWidth].concat([...document.querySelectorAll('#sheet .sheet, #sheet .bd, #sheet .hd, .top')].map(e => e.scrollWidth - e.clientWidth)).filter(d => d > 0));
    try {
      assert.deepEqual(await wide(), [], `${where}: the page fits`);
      assert.ok(await page.$eval('#scopeBtn', b => b.getBoundingClientRect().right <= innerWidth), `${where}: the telescope button is on screen`);
      assert.ok(await page.$eval('#locName', n => n.getBoundingClientRect().width >= 20), `${where}: the place shows`);
      // a row's name and lines have room to be read, not a letter at a time, and nothing is cut off
      const rows = await page.$$eval('#targetSec .row', rs => rs.slice(0, 14).map(r => { const t = r.children[1], d = r.querySelector('.dt'); return { id: r.dataset.id, w: t.getBoundingClientRect().width, cut: d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1 }; }));
      assert.deepEqual(rows.filter(r => r.w < 90 || r.cut).map(r => r.id), [], `${where}: each row has room for its name and lines`);
      await page.evaluate(() => [...document.querySelectorAll('#targetSec .row')].find(r => r.dataset.id === 'M45').click());
      await page.waitForTimeout(300);
      assert.deepEqual(await wide(), [], `${where}: with a card open`);
      assert.ok(await page.$$eval('#sheet .chart canvas', c => c.every(x => x.getBoundingClientRect().right <= innerWidth)), `${where}: its charts fit`);
      await page.evaluate(() => document.querySelector('#sheet [data-close]').click());
      await page.evaluate(() => document.getElementById('scopeBtn').click());
      await page.waitForTimeout(200);
      assert.deepEqual(await wide(), [], `${where}: with the telescope sheet open`);
      assert.ok(await page.$eval('#scSave', b => b.getBoundingClientRect().right <= innerWidth), `${where}: Save is on screen`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// The map measures its buttons again only when something that moves them changes, so each of those is tried here.
check('Labels keep off the map’s buttons as the time, the banner and Point change them', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    const tl = await page.locator('#tlc').boundingBox();
    const fresh = async where => { await page.waitForTimeout(120); const m = await mapLabels(page); checkLabels(m.labels, m.w, m.h, m.keep, where); };
    await page.click('#dirSeg button[data-d="270"]');
    for (const f of [0.02, 0.3, 0.55, 0.97, 0.12]) { await page.mouse.click(tl.x + tl.width * f, tl.y + tl.height / 2); await fresh(`at ${await text(page, '#when')}${await page.$eval('#banner', b => b.hidden ? '' : ', with the banner')}`); }
    await page.click('#nowBtn'); await fresh('back to now');
    await page.setViewportSize({ width: 360, height: 740 }); await fresh('on a narrower screen');
    await point(page); await fresh('in Point');
    const c = await page.$eval('#sky', c => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(c[0], c[1]); await page.mouse.down(); await page.mouse.move(c[0] + 80, c[1] + 20, { steps: 8 }); await page.mouse.up();
    await fresh('with a compass correction');
    await page.click('#ptBtn'); await fresh('after Point');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// At dusk the Twilight message sat in the middle of the map, over the sky low in the west where the evening's planets
// and the first stars are, and hid their names. It is now one line in the top-left corner, under the time.
check('At dusk and by day the message is one line in the corner, and the middle of the map stays clear', async () => {
  for (const [time, words] of [['2026-11-15T17:45:00-06:00', 'Twilight · only the brightest show yet'], ['2026-11-15T14:00:00-06:00', 'The Sun is up · drag the night below for tonight’s sky']]) {
    for (const size of [[390, 844], [1280, 800]]) {
      const { ctx, page, problems } = await open({ time, size, phone: size[0] < 1000 });
      try {
        if (/14:00/.test(time)) await page.click('#nowBtn');
        await page.click('#dirSeg button[data-d="270"]');
        await page.waitForTimeout(150);
        assert.equal(await text(page, '#banner'), words);
        const at = await page.evaluate(() => { const s = document.getElementById('sky').getBoundingClientRect(), b = document.getElementById('banner').getBoundingClientRect(), w = document.getElementById('when').getBoundingClientRect(); return { left: b.left - s.left, top: b.top - s.top, bottom: b.bottom - s.top, right: b.right - s.left, h: b.height, sw: s.width, sh: s.height, under: b.top >= w.bottom }; });
        assert.ok(at.under && at.left < 30 && at.bottom < at.sh * 0.42, `${size}: under the time at the top left (${JSON.stringify(at)})`);
        assert.ok(at.h < 32, `${size}: one line (${at.h}px)`);
        assert.ok(at.right < at.sw - 40, `${size}: it leaves the top right to Show`);
        const mid = await page.$eval('#sky', c => { const r = c.getBoundingClientRect(); return c.__labels().filter(l => l.y + l.h > r.height * 0.42 && l.y < r.height * 0.8).length; });
        assert.ok(mid > 0, `${size}: names show in the middle of the map`);
        assert.deepEqual(problems, []);
      } finally { await ctx.close(); }
    }
  }
});

// By day the map showed the Moon and Venus but no Sun, and the glow on the horizon at dusk had no source.
check('The Sun shows on the map by day as a disc with nothing to tap, and never on a chart', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T14:00:00-06:00' });
  try {
    await page.click('#nowBtn');
    await page.waitForTimeout(150);
    const sun = await page.$eval('#sky', c => c.__sun());
    assert.ok(sun, 'the Sun is drawn');
    const lab = await page.$eval('#sky', c => c.__labels().find(l => l.t === 'Sun'));
    assert.ok(lab, 'and labelled');
    assert.ok(!lab.obj, 'its label opens nothing');
    assert.equal(await page.$eval('#sky', c => c.__hits().filter(h => /sun/i.test(h.obj.id || '')).length), 0, 'nothing to tap');
    const box = await page.locator('#sky').boundingBox();
    await page.mouse.click(box.x + sun.x, box.y + sun.y);
    await page.mouse.click(box.x + lab.x + lab.w / 2, box.y + lab.y + lab.h / 2);
    await page.waitForTimeout(200);
    if (await sheetOpen(page)) assert.doesNotMatch(await text(page, '#sheet .hd h2'), /Sun/, 'a tap on it opens no card for the Sun');
    if (await sheetOpen(page)) await page.click('#sheet [data-close]');
    await openCard(page, 'Venus');
    await page.waitForTimeout(200);
    assert.ok(!(await page.$eval('#finder', c => c.__labels.map(l => l.t))).includes('Sun'), 'Venus’s finder chart has no Sun');
    await page.click('#sheet [data-close]');
    // at night it's gone
    const tl = await page.locator('#tlc').boundingBox(); await page.locator('#tlc').click({ position: { x: tl.width * 0.5, y: tl.height / 2 } }); await page.waitForTimeout(150);
    assert.match(await text(page, '#when'), /^1[12]:\d\d [ap]m/);
    assert.equal(await page.$eval('#sky', c => c.__sun()), null, 'no Sun at midnight');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('pointing stays on the live sky when the night rolls over', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T07:30:00-06:00', init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    await point(page);
    await until(page, '#when', /Now/);
    await page.clock.fastForward('01:00:00');
    await until(page, '#nightTitle', /Nov 15/);
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sun, Nov 15');
    await until(page, '#when', /^8:30 am/); // the map's time is drawn on the next frame
    assert.equal(await text(page, '#when'), '8:30 am Now · Sun, Nov 15', 'the map still shows the sky the phone points at');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// On a desktop the page itself could scroll 650px past the screen: the words only screen readers get, in the side
// panel, hung below it. A wheel over the header slid the whole app up over an empty space.
check('On a desktop the page holds still and only the side panel scrolls', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  try {
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'the page fits the screen');
    await page.mouse.move(640, 25);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => scrollY), 0, 'a wheel over the header leaves it where it is');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('on a desktop an open card covers only the side panel', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#targetSec .row');
    assert.ok(await sheetOpen(page));
    const box = await page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return { s: [s.left, s.top, s.width], p: [p.left, p.top, p.width] }; });
    assert.deepEqual(box.s, box.p, 'the card sits exactly over the panel');
    for (const id of ['zIn', 'nextN', 'layBtn', 'nowBtn', 'redBtn', 'scopeBtn', 'locBtn']) {
      const onTop = await page.$eval('#' + id, el => { const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el.contains(hit); });
      assert.ok(onTop, `#${id} is under the card`);
    }
    await page.click('#scopeBtn');
    assert.match(await text(page, '#sheet .hd h2'), /^Your telescope/, 'the Telescope button still works with a card open');
  } finally { await ctx.close(); }
});

// In night vision a card open beside the map on a desktop laid a dark veil over the map, which is meant to stay in use
// beside it: the red look's backdrop outranked the desktop's clear one.
check('On a desktop an open card leaves the map undimmed, in night vision too', async () => {
  for (const red of [false, true]) {
    const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, red }), time: '2026-11-15T21:00:00-06:00', phone: false });
    try {
      await page.click('#targetSec .row');
      assert.ok(await sheetOpen(page));
      assert.equal(await page.$eval('.sheetbg', b => getComputedStyle(b).backgroundColor), 'rgba(0, 0, 0, 0)', (red ? 'night vision: ' : '') + 'nothing over the map');
    } finally { await ctx.close(); }
  }
});

// On Android the installed app has only Back to close a card, and Back used to leave Starhop instead.
check('Back closes an open card or sheet, and closing one another way leaves no extra step behind', async () => {
  let { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForFunction(() => document.getElementById('sheet').hidden, null, { timeout: 5000 }).catch(() => {}); };
  const settled = () => page.waitForFunction(() => !history.state, null, { timeout: 5000 }).catch(() => {});
  try {
    const start = page.url(), steps = await page.evaluate(() => history.length);
    await page.click('#targetSec .row');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the card');
    assert.equal(page.url(), start, 'and stays in Starhop');
    assert.match(await text(page, '#keys'), /Sunset/);
    for (const how of ['Done', 'the backdrop', 'Escape', 'Back']) {
      await page.click('#targetSec .row');
      if (how === 'Done') await page.click('#sheet [data-close]');
      else if (how === 'the backdrop') await page.mouse.click(195, 20); // above the card
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else await back();
      await settled();
      assert.equal(await sheetOpen(page), false, how + ' closes the card');
      assert.equal(await page.evaluate(() => history.length), steps + 1, 'closing with ' + how + ' takes the card’s step off again');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false }));
  try {
    const steps = await page.evaluate(() => history.length);
    await openCard(page, 'M13');
    await page.click('#scopeBtn');
    await page.click('#sheet .hd [data-close]'); // the telescope sheet took the card's place, on the same step
    await settled();
    assert.equal(await sheetOpen(page), false);
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'one step for the card and the sheet that replaced it');
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await back();
    assert.equal(await sheetOpen(page), false, 'Back closes the sheet that replaced a card');
    await page.click('#scopeBtn');
    await page.click('#scSave');
    await settled();
    assert.equal(await page.evaluate(() => history.length), steps + 1, 'Save takes the step off too');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// On a desktop a click beside the sheet doesn't close it, so it needs a way out that doesn't save.
check('the telescope sheet closes with Cancel, which drops the changes', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#scopeBtn');
    await page.fill('#scAp', '254');
    await page.click('#nightTitle');
    assert.ok(await sheetOpen(page), 'a click beside the sheet leaves it open');
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await sheetOpen(page), false, 'Cancel closes the sheet');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).scope), undefined, 'nothing is saved');
    assert.match(await text(page, '#targetSec .note'), /^Ratings assume an example 130 mm reflector under suburban skies/, 'the example telescope is still the one rated for');
    assert.equal(await text(page, '#scopeName'), 'Telescope');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The example telescope's name was put in the Name field of a fresh sheet, so a telescope typed in by hand was saved
// as "130 mm reflector" and the list said it rated for one.
check('a telescope typed in by hand is called by its own size', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#scopeBtn');
    assert.equal(await page.inputValue('#scName'), '', 'a fresh sheet has no name in it');
    assert.equal(await page.getAttribute('#scName', 'placeholder'), 'e.g. 70 mm refractor');
    await page.fill('#scAp', '8');
    await page.click('#scSave');
    assert.match(await text(page, '#toast'), /^Aperture is in millimetres — 8 inches is 203 mm$/, 'an aperture in inches is explained');
    for (const v of ['8"', '8 in']) {
      await page.fill('#scAp', v);
      await page.click('#scSave');
      assert.match(await text(page, '#toast'), /^Aperture is in millimetres/, `so is one typed with its unit, ${v}`);
    }
    await page.fill('#scAp', '70');
    await page.fill('#scFl', '700');
    await page.click('#scSave');
    assert.equal(await text(page, '#scopeName'), '70 mm, f/10');
    assert.equal(await text(page, '#toast'), 'Ratings now for your 70 mm, f/10 under suburban skies', 'Save says what the ratings are now for');
    assert.match(await text(page, '#targetSec .note'), /^Ratings assume your 70 mm, f\/10 under suburban skies\.$/);
    // a quick pick's name goes when its numbers are changed, and a pick's name with other numbers isn't kept
    await page.click('#scopeBtn');
    await page.selectOption('#scPre', { label: '114 mm reflector (114 mm, f/7.9)' });
    assert.equal(await page.inputValue('#scName'), '114 mm reflector');
    await page.fill('#scFl', '1000');
    assert.equal(await page.inputValue('#scName'), '', 'changing the numbers clears the pick’s name');
    await page.fill('#scName', '8″ Dobsonian');
    await page.click('#scSave');
    assert.equal(await text(page, '#scopeName'), '114 mm, f/8.8');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('an open card follows the time shown, and other sheets stay as they are', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const cardAt = () => page.$eval('#sheet .card h3', h => h.textContent);
  const riseSet = () => page.$eval('#sheet .card p:not(.big)', p => p.textContent);
  try {
    const tl = await page.locator('#tlc').boundingBox(), at = f => page.mouse.click(tl.x + tl.width * f, tl.y + tl.height / 2);
    await openCard(page, 'M13');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await at(0.3);
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Where you observe', 'a click on the timeline leaves the location sheet open');
    assert.equal(await page.inputValue('#lq'), 'Tucs');
    await page.keyboard.press('Escape');

    await openCard(page, 'M13');
    await at(0.55);
    assert.notEqual(await cardAt(page), 'At 9:00 pm');
    await page.click('#nowBtn');
    assert.equal(await cardAt(page), 'At 9:00 pm', 'the card follows Now');
    await page.focus('#tlc');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 10:00 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await cardAt(page), 'At 10:00 pm', 'the card follows the timeline keys');
    const before = await riseSet();
    await page.click('#prevN');
    assert.notEqual(await riseSet(), before, 'the card follows the night shown');
  } finally { await ctx.close(); }
});

// At the scope the card is what people read, picking the phone up between looks; it said "At 7:30 pm" all evening.
check('An open card moves on with the clock', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T19:30:00-06:00' });
  try {
    await openCard(page, 'M45');
    assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), 'At 7:30 pm');
    await page.$eval('#sheet .bd', b => { b.scrollTop = 240; });
    const steps = await page.evaluate(() => history.length), first = await text(page, '#sheet .big');
    for (let i = 1; i <= 5; i++) {
      await page.clock.runFor('10:00');
      const at = `At ${7 + Math.floor((30 + 10 * i) / 60)}:${String((30 + 10 * i) % 60).padStart(2, '0')} pm`;
      await page.waitForFunction(at => document.querySelector('#sheet .card h3').textContent === at, at, { timeout: 5000 }).catch(() => {});
      assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), at, 'the card keeps up, step ' + i);
      assert.equal(await page.evaluate(() => history.length), steps, 'no new history entry, step ' + i);
      assert.equal(await page.$eval('#sheet .bd', b => b.scrollTop), 240, 'the card keeps its place, step ' + i);
      assert.ok(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), 'the focus stays in the card, step ' + i);
    }
    assert.notEqual(await text(page, '#sheet .big'), first, 'the height and direction move on too');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The log named a deep-sky object as the card's title does, so the Rosette Cluster went into the CSV without NGC 2244,
// and M40, a double star, without its Messier number.
check('The log names deep-sky objects with their catalogue numbers, and M40 with its own', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, seen: { M40: '2026-06-20', 'NGC 2244': '2026-01-10' } }), time: '2026-11-15T21:00:00-06:00' });
  try {
    await openCard(page, 'NGC 869');
    await page.click('#seenB');
    await page.click('#openLog');
    assert.deepEqual(await page.$$eval('#sheet .lge summary b', b => b.map(x => x.textContent)), ['Double Cluster · NGC 869 and NGC 884', 'Winnecke 4 · M40', 'Rosette Cluster · NGC 2244']);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).log.find(e => e.id === 'NGC 869').name), 'Double Cluster · NGC 869 and NGC 884', 'a new entry keeps the number');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Taking an entry out of a long log drew the log again from the top, away from the entries around it.
check('Taking an entry out of a long log keeps its place in the list', async () => {
  const seen = {}; ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'].forEach((id, i) => { seen[id] = '2026-10-' + String(10 + i); });
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, seen }), time: '2026-11-15T21:00:00-06:00' });
  try {
    await page.click('#logBtn');
    const rows = page.locator('#sheet .lge');
    await rows.nth(9).locator('summary').click();
    await rows.nth(9).locator('[data-del]').scrollIntoViewIfNeeded();
    const was = await page.$eval('#sheet .bd', b => b.scrollTop);
    assert.ok(was > 300, 'scrolled well down the log');
    await rows.nth(9).locator('[data-del]').click();
    assert.equal(await text(page, '#sheet .hd h2'), 'Your log 11 entries, newest first');
    // as far down as it was, or as the list, shorter now, goes
    const [top, max] = await page.$eval('#sheet .bd', b => [b.scrollTop, b.scrollHeight - b.clientHeight]);
    assert.ok(top > 0 && top === Math.min(was, max), `the list stays where it was (${top} of ${max}, from ${was})`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The card moves on with the clock by drawing itself again, which would take a note box out from under someone typing.
check('An open card waits while a note is typed, and moves on after', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T19:30:00-06:00' });
  try {
    await openCard(page, 'M45');
    await page.click('#seenB');
    await page.click('#sheet .lgNote');
    await page.keyboard.type('Blue haze');
    await page.$eval('#sheet .lgNote', t => { window.box = t; });
    await page.clock.runFor('03:00');
    await page.keyboard.type(' around Merope');
    assert.ok(await page.evaluate(() => document.activeElement === window.box && window.box.isConnected), 'the same box keeps the focus');
    assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), 'At 7:30 pm', 'the card waits');
    await page.$eval('#sheet .lgNote', t => t.blur());
    await page.clock.runFor('00:05');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 7:33 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), 'At 7:33 pm', 'and moves on once the note is left');
    assert.equal(await page.$eval('#sheet .lgNote', t => t.value), 'Blue haze around Merope', 'with the note kept');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Real touches, through Chromium's own input, so the browser scrolls (or doesn't) as a phone's would. `touch` puts a
// finger down, moves it and lifts it; `swipe` drags it from one point to another in steps.
const touchOf = async (ctx, page) => {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(300);
  };
  return { cdp, touch, swipe };
};

// The once-a-minute redraw replaced the card under the finger, and a scroll in progress stopped dead.
check('A card following the clock doesn’t stop a scroll in progress', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T19:30:10-06:00' });
  try {
    const { touch } = await touchOf(ctx, page);
    await openCard(page, 'M45');
    await page.waitForTimeout(300);
    const top = () => page.$eval('#sheet .bd', b => b.scrollTop);
    await page.$eval('#sheet .bd', b => { b.__was = true; });
    await touch('touchStart', 195, 700);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', 195, 700 - i * 25); await page.waitForTimeout(16); }
    const mid = await top();
    assert.ok(mid > 50, 'the card scrolls under the finger');
    await page.clock.runFor(61000); // the minute rolls over while the finger is down
    assert.ok(await page.$eval('#sheet .bd', b => b.__was), 'the card isn’t redrawn under the finger');
    for (let i = 7; i <= 14; i++) { await touch('touchMove', 195, 700 - i * 25); await page.waitForTimeout(16); }
    assert.ok(await top() > mid + 100, `the scroll carries on (${mid} → ${await top()})`);
    const at = await top();
    await touch('touchEnd');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 7:31 pm', null, { timeout: 8000 }).catch(() => {});
    assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), 'At 7:31 pm', 'it catches up once the finger lifts and the card is still');
    assert.ok(await top() >= at, `and keeps its place (${at} → ${await top()})`);
    assert.ok(await page.$eval('#finder', c => c.width > 0), 'with its finder chart drawn');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A swipe that ran past the end of a card scrolled the page behind it, and closing the card left you at the credits.
check('Swiping past the end of a card leaves the list where it was', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init: fakeWakeLock });
  try {
    await ctx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']);
    const { swipe } = await touchOf(ctx, page);
    const y = () => page.evaluate(() => Math.round(scrollY));
    const locked = () => page.evaluate(() => document.documentElement.classList.contains('sheeted'));
    await page.evaluate(() => scrollTo(0, document.getElementById('targetSec').offsetTop - 60));
    const y0 = await y();
    assert.ok(y0 > 300, 'the page is scrolled to the list');
    await openCard(page, 'Saturn');
    for (let i = 0; i < 5; i++) await swipe(195, 760, 195, 160); // up, past the card's end
    const bd = await page.$eval('#sheet .bd', b => [Math.round(b.scrollTop), b.scrollHeight - b.clientHeight]);
    assert.ok(bd[0] >= bd[1] - 2, 'the card scrolls to its end');
    assert.equal(await y(), y0, 'the page behind stays put');
    await swipe(195, 150, 195, 600); // on the backdrop and the card's heading
    assert.equal(await y(), y0, 'a swipe on the heading or the backdrop leaves the page alone too');
    await page.click('#sheet [data-close]');
    assert.equal(await y(), y0, 'Done leaves the list where it was');
    await openCard(page, 'Moon');
    for (let i = 0; i < 3; i++) await swipe(195, 400, 195, 800); // down, past the card's top
    assert.equal(await y(), y0, 'a swipe down at the top of a card leaves the page alone');
    await page.click('#sheet [data-close]');
    // every way out of a sheet unlocks the page again, and it scrolls as before
    const ways = { Done: () => page.click('#sheet [data-close]'), 'the backdrop': () => page.mouse.click(195, 20), Escape: () => page.keyboard.press('Escape'),
      Back: () => page.evaluate(() => history.back()), 'a new place': async () => { await page.click('#sheet [data-close]'); await page.click('#locBtn'); await page.fill('#lq', 'Tucs'); await page.click('#lres button'); } };
    for (let round = 1; round <= 10; round++) for (const [how, close] of Object.entries(ways)) {
      if (how !== 'a new place' || round === 1) {
        await openCard(page, 'Moon');
        assert.ok(await locked(), 'an open card holds the page still');
        await close();
        await page.waitForFunction(() => document.getElementById('sheet').hidden && !document.documentElement.classList.contains('sheeted'), null, { timeout: 5000 }).catch(() => {});
        assert.equal(await locked(), false, `closing with ${how} lets the page scroll again, round ${round}`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), 'visible', `the page’s own overflow is back, round ${round}`);
      }
    }
    await page.evaluate(() => scrollTo(0, 800));
    const y1 = await y();
    await swipe(195, 600, 195, 300);
    assert.ok(await y() > y1 + 100, 'a swipe scrolls the page after all that');
    await page.evaluate(() => scrollTo(0, 0));
    await point(page);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('pointing')), 'Point still starts');
    await page.click('#ptBtn');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('pointing')), false, 'and stops');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The timeline took every touch as a drag along it, so a swipe up from it to reach the list moved the time and turned
// Now off instead.
const tlBox = page => page.$eval('#tlc', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
check('Scrolling the page from the timeline leaves the time alone', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const { swipe } = await touchOf(ctx, page);
    const tl = await tlBox(page), when = await text(page, '#when');
    assert.match(when, /Now/);
    for (const f of [0.8, 0.2, 0.5]) {
      await page.evaluate(() => scrollTo(0, 0));
      await swipe(tl.x + tl.w * f, tl.y + tl.h / 2, tl.x + tl.w * f + 3, tl.y + tl.h / 2 - 300);
      assert.ok(await page.evaluate(() => scrollY) > 100, 'a swipe up from the timeline scrolls the page');
      assert.equal(await text(page, '#when'), when, 'and leaves the time as it was');
      assert.ok(await page.$eval('#nowBtn', b => b.classList.contains('on')), 'with Now still on');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('Dragging along the timeline still sets the time', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const { swipe, touch } = await touchOf(ctx, page);
    const tl = await tlBox(page), mid = tl.y + tl.h / 2;
    const time = async () => (await text(page, '#when')).match(/^\d+:\d\d [ap]m/)[0];
    await swipe(tl.x + tl.w * 0.3, mid, tl.x + tl.w * 0.7, mid);
    assert.equal(await page.evaluate(() => scrollY), 0, 'a drag along it doesn’t scroll the page');
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), false, 'a drag along it leaves Now');
    const dragged = await time();
    // a short drag, just past a finger's wobble
    await swipe(tl.x + tl.w * 0.7, mid, tl.x + tl.w * 0.7 - 14, mid, 4);
    assert.notEqual(await time(), dragged, 'a short drag moves it too');
    // a tap sets it where it lands
    await touch('touchStart', tl.x + tl.w * 0.1, mid); await touch('touchEnd');
    await page.waitForTimeout(200);
    const tapped = await time();
    assert.notEqual(tapped, dragged, 'a tap sets the time');
    // a mouse drags as before, from the press
    await page.mouse.move(tl.x + tl.w * 0.9, mid); await page.mouse.down();
    await page.waitForTimeout(100);
    assert.notEqual(await time(), tapped, 'a mouse sets the time as it presses');
    await page.mouse.move(tl.x + tl.w * 0.5, mid, { steps: 4 }); await page.mouse.up();
    await page.click('#nowBtn');
    await page.waitForFunction(() => document.getElementById('nowBtn').classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
    assert.ok(await page.$eval('#nowBtn', b => b.classList.contains('on')), 'Now comes back');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// On a phone the whole-sky view's N fell just off the top and S under the direction buttons, so neither showed.
check('The Up view on a phone shows N and S', async () => {
  for (const loc of [AUSTIN, SYDNEY]) {
    for (const phone of [true, false]) {
      const { ctx, page, problems } = await open({ loc, phone, time: loc === AUSTIN ? '2026-11-15T21:00:00-06:00' : '2026-11-15T22:00:00+11:00' });
      try {
        await page.click('#dirSeg button[data-d="up"]');
        await page.waitForTimeout(300);
        const m = await mapLabels(page), letters = m.labels.filter(l => /^[NESW]{1,2}$/.test(l.t)).map(l => l.t);
        const where = `${loc.name} on a ${phone ? 'phone' : 'desktop'}`;
        for (const t of ['N', 'E', 'S', 'W']) assert.ok(letters.includes(t), `${where}: ${t} shows (${letters.join(', ')})`);
        if (!phone) assert.equal(letters.length, 8, `${where}: all eight show`);
        checkLabels(m.labels, m.w, m.h, m.keep, where);
        assert.deepEqual(problems, []);
      } finally { await ctx.close(); }
    }
  }
});

// The rows' second line ended in an ellipsis on a phone, cutting off the height and direction to look, and a seen mark
// on the name line cut off names.
check('target rows show their whole line on a phone', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T20:30:00-06:00' });
  try {
    await page.click('#moreT');
    const ids = await page.$$eval('#targetSec .row', r => r.map(x => x.dataset.id));
    assert.ok(ids.length > 60, 'the whole list shows');
    const lines = sel => page.$$eval(sel, d => d.map(e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))));
    assert.ok(Math.max(...await lines('#targetSec .row .dt')) <= 2, 'a row’s second line takes two lines at most');
    // where the line wraps, each time stays with its word: never "Best" at the end of one line and "6:34 am" on the next
    const parted = await page.$$eval('#targetSec .row .dt', ds => ds.filter(d => [...d.querySelectorAll('.nw')].some(n => /\d:\d\d [ap]m$/.test(n.textContent) && !/^(Rises|Set|Best) /.test(n.textContent))).map(d => d.textContent));
    assert.deepEqual(parted, [], 'a time keeps its word with it');
    // every row seen, last year, for the longest line there can be
    await page.evaluate(ids => { const s = JSON.parse(localStorage.getItem('starhop.v1')); s.seen = Object.fromEntries(ids.map(i => [i, '2025-11-10'])); localStorage.setItem('starhop.v1', JSON.stringify(s)); }, ids);
    await page.reload(); await ready(page);
    await page.click('#moreT');
    const cut = await page.$$eval('#targetSec .row', rows => rows.flatMap(r => [...r.querySelectorAll('.dt, .nm span')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => r.dataset.id + ': ' + e.textContent)));
    assert.deepEqual(cut, [], 'no row is cut off');
    const row = await page.$eval('#targetSec .row[data-id="Jupiter"]', r => ({ nm: r.querySelector('.nm').textContent, dt: r.querySelector('.dt').textContent, sr: r.querySelector('.sr').textContent }));
    assert.equal(row.nm, 'Jupiter✓', 'a bare tick beside the name');
    assert.match(row.dt, /^Rises 12:08 am · Best 6:\d\d am · \d+° up · [NESW]{1,2} · Seen Mon, Nov 10, 2025$/, 'and when it was seen at the end of the line');
    assert.equal(row.sr, 'south, seen Mon, Nov 10, 2025, rated', 'which a screen reader hears after the direction');
    assert.ok(Math.max(...await lines('#targetSec .row .dt')) <= 3, 'a line with the night it was seen takes three lines at most');
    assert.equal(await page.$$eval('#targetSec .row', r => r.filter(x => x.querySelectorAll('button, a').length).length), 0, 'each row is one button');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// At 1 am the list led with the Moon and Albireo, both set hours before, and only opening each card said so.
// Austin, Nov 15 2026: the Moon sets at 10:53 pm and Jupiter rises at 12:08 am.
check('A row says tonight whether it is up now, rises later or has set', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T22:50:00-06:00' });
  const line = id => page.$eval(`#targetSec .row[data-id="${id}"] .dt`, d => d.textContent);
  const order = () => page.$$eval('#targetSec .row', rs => rs.map(r => r.dataset.id).join());
  try {
    await targetRows(page); // the whole list: Jupiter, rising after midnight, comes after what's up before it
    const before = await order();
    assert.match(await line('Moon'), /^Up now · Best 5:54 pm/);
    assert.match(await line('Jupiter'), /^Rises 12:08 am · Best /);
    await page.clock.runFor('05:00');
    await page.waitForFunction(() => /^Set/.test(document.querySelector('#targetSec .row[data-id="Moon"] .dt').textContent), null, { timeout: 5000 }).catch(() => {});
    assert.match(await line('Moon'), /^Set 10:53 pm · Best 5:54 pm/, 'the list keeps up with the clock');
    assert.equal(await order(), before, 'and keeps its order');
    await page.click('#nextN');
    assert.match(await line('Moon'), /^Best /, 'another night says nothing about now');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// By day, Now from another night landed on tonight at nightfall with Now unlit, and only a second tap went to now.
check('by day, Now from another night shows the sky now', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T15:00:00-06:00' });
  try {
    assert.match(await text(page, '#when'), /^7:10 pm Sun, Nov 15$/, 'by day it opens on tonight once it is dark');
    await page.click('#nextN');
    await page.click('#nowBtn');
    await until(page, '#when', /^3:00 pm Now/);
    assert.match(await text(page, '#when'), /^3:00 pm Now · Sun, Nov 15$/);
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), true, 'Now is lit');
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sun, Nov 15');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The night of the New Moon, Dec 8 2026, Austin said "Up at dusk, sets 5:07 pm, rises 7:59 am", and its keys led with
// Moonset 5:07 pm before Sunset 5:30 pm. Astronomy Engine 2.1.19: moonset 23:06:47Z, sunset 23:30:35Z, sunrise
// 13:15:56Z, moonrise 13:59:51Z, so the Moon is down from sunset to sunrise.
check('on a New Moon night the Moon is below the horizon all night, and the keys keep to sunset and sunrise', async () => {
  const { ctx, page, problems } = await open({ time: '2026-12-08T21:00:00-06:00' });
  try {
    assert.match(await text(page, '#tonightSec .moonrow'), /New Moon · 0% lit Below the horizon all night$/);
    const keys = await text(page, '#keys');
    assert.match(keys, /^Sunset 5:30 pm .* Sunrise 7:15 am$/, keys);
    assert.doesNotMatch(keys, /Moon/, 'no moonset before sunset or moonrise after sunrise');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// At 11:30 pm M13 had had its best at dusk and set, yet its row led with the next morning's rise: "Rises 5:46 am · Best
// 6:29 pm". A rise comes first only when the best is still to come.
check('a target past its best says when it set, not when it rises again', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T23:30:00-06:00' });
  try {
    await page.click('#moreT');
    assert.match(await page.$eval('#targetSec .row[data-id="M13"] .dt', d => d.textContent), /^Set \d+:\d\d pm · Best 6:\d\d pm/);
    // minutes from noon, so the morning's hours come after the evening's
    const m = s => { const [, h, mi, ap] = s.match(/(\d+):(\d\d) ([ap]m)/); return (+h % 12) * 60 + +mi + (ap === 'am' ? 720 : 0); };
    const now = m('11:30 pm'), lines = await page.$$eval('#targetSec .row .dt', ds => ds.map(d => d.textContent));
    assert.ok(lines.length > 30);
    for (const l of lines) {
      const r = l.match(/^Rises (\S+ [ap]m) · Best (\S+ [ap]m)/);
      if (r) assert.ok(m(r[2]) >= now && m(r[1]) <= m(r[2]), l);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check("typed coordinates take a decimal comma and a real minus sign, and refuse what they can't read", async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const use = async (lat, lon) => { if (!await sheetOpen(page)) await page.click('#locBtn'); await page.fill('#lLat', lat); await page.fill('#lLon', lon); await page.click('#lUse'); };
    const saved = async () => { const l = await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).loc); return [l.lat, l.lon]; };
    await use('45,76', '4,84');
    assert.deepEqual(await saved(), [45.76, 4.84], 'decimal commas');
    await use('30.27', '−97.74');
    assert.deepEqual(await saved(), [30.27, -97.74], 'a real minus sign');
    assert.equal(await text(page, '#toast'), 'Showing the sky near Austin', 'the message says near the town, not "over Near Austin"');
    await use('30.27', '97.74 W');
    assert.ok(await sheetOpen(page), '"97.74 W" is refused, not read as 97.74° east');
    assert.deepEqual(await saved(), [30.27, -97.74]);
  } finally { await ctx.close(); }
});

// The time zone came from the device, so a laptop on New York time in Tucson showed a November sunset at 7:23 pm. The
// nearest town's zone is used now, and the device's only when a town that near shares it (as by a border). Sunset in
// Tucson on Nov 15 2026 is 5:2x pm MST; in Austin 5:34 pm CST (Astronomy Engine 2.1.19: 00:24Z and 23:34Z).
check("Use my location takes the place's time zone, not the phone's", async () => {
  for (const [tz, geo, want, sunset] of [
    ['America/New_York', { latitude: 32.22, longitude: -110.97 }, 'America/Phoenix', /^Sunset 5:2\d pm/],
    ['Europe/London', { latitude: 30.27, longitude: -97.74 }, 'America/Chicago', /^Sunset 5:34 pm/],
  ]) {
    const { ctx, page, problems } = await open({ tz, geo, time: '2026-11-15T12:00:00Z' });
    try {
      await page.click('#locBtn');
      await page.click('#lGeo');
      await page.waitForFunction(() => document.getElementById('sheet').hidden, null, { timeout: 15000 });
      const loc = await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).loc);
      assert.equal(loc.tz, want, `a device on ${tz}`);
      assert.match(loc.name, /^Near /);
      await until(page, '#keys', sunset);
      assert.match(await text(page, '#keys'), sunset);
      assert.match(await text(page, '#keys'), /Sunrise \d:\d\d am/);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Town search dropped accents but left ø, æ, ð and the curly apostrophe as they were, so Tromsø, København, Egilsstaðir
// and St. John’s couldn't be found from a plain keyboard.
check('a town search finds Tromsø typed as Tromso, and St. John’s typed with a plain apostrophe', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#locBtn');
    for (const [typed, found] of [['Tromso', 'Tromsø'], ["St. John's", 'St. John’s'], ['Kobenhavn', 'København'], ['Egilsstadir', 'Egilsstaðir'], ['Svolvaer', 'Svolvær']]) {
      await page.fill('#lq', typed);
      await page.waitForFunction(f => [...document.querySelectorAll('#lres button')].some(b => b.textContent.startsWith(f)), found, { timeout: 10000 })
        .catch(() => assert.fail(`"${typed}" doesn't find ${found}`));
    }
    await page.click('#lres button');
    assert.equal(await text(page, '#locName'), 'Svolvær, NO');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The list spells them Ft. Worth, St. Louis and St. Paul, and only those spellings found them.
check('Searching Fort Worth, St Louis or Saint Paul finds the town', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await page.click('#locBtn');
    for (const [typed, found] of [['Fort Worth', 'Ft. Worth'], ['ft worth', 'Ft. Worth'], ['St Louis', 'St. Louis'], ['Saint Louis', 'St. Louis'], ['Saint Paul', 'St. Paul'],
      ['Mount Hagen', 'Mt. Hagen'], ['St. Paul', 'St. Paul'], ['Winston Salem', 'Winston-Salem'], ['Tucs', 'Tucson'],
      // half typed, before the space that makes it an abbreviation: "Fort" still finds the Fort and Ft. towns
      ['Fort', 'Fort Collins'], ['Fort', 'Ft. Worth'], ['Saint', 'St. Louis'], ['Mount', 'Mount Isa'], ['Mount', 'Mt. Hagen']]) {
      await page.fill('#lq', typed);
      await page.waitForFunction(f => [...document.querySelectorAll('#lres button')].some(b => b.textContent.startsWith(f)), found, { timeout: 5000 })
        .catch(() => assert.fail(`"${typed}" doesn't find ${found}`));
    }
    await page.fill('#lq', 'Fort Worth');
    await page.waitForFunction(() => document.querySelector('#lres button')?.textContent.startsWith('Ft. Worth'));
    await page.click('#lres button');
    assert.equal(await text(page, '#locName'), 'Ft. Worth, TX');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('the location sheet can close before its list of places arrives', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    let release; const held = new Promise(r => { release = r; });
    await page.route('**/data/cities.json', async route => { await held; await route.continue(); });
    await page.click('#locBtn');
    await page.keyboard.press('Escape');
    const arrived = page.waitForResponse(r => r.url().endsWith('data/cities.json'));
    release();
    await arrived;
    await page.waitForTimeout(300);
    assert.equal(await sheetOpen(page), false);
    assert.deepEqual(problems, [], 'no errors once the places arrive');
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucs');
    await page.waitForFunction(() => /Tucson/.test(document.getElementById('lres').textContent), null, { timeout: 10000 });
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Chromium reports some zones by older names (Asia/Calcutta, America/Indianapolis, Europe/Kiev).
check('a first visit guesses the place from the time zone, older zone names too', async () => {
  for (const [zone, place] of [['Asia/Kolkata', 'Mumbai, IN'], ['America/Indiana/Indianapolis', 'Indianapolis, IN'], ['Europe/Kyiv', 'Kyiv, UA'], ['America/Phoenix', 'Phoenix, AZ']]) {
    const { ctx, page, problems } = await open({ loc: null, tz: zone, time: '2026-10-13T12:00:00Z' });
    try {
      assert.equal(await text(page, '#locName'), place, zone);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('A first visit says what Starhop is for, until Got it or a telescope is set', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    assert.equal(await page.$eval('#hello', el => el.hidden), false, 'the line shows on a first visit');
    assert.equal(await text(page, '#hello p'), 'What’s up tonight, what’s worth a look in your telescope, and how to star-hop to it.');
    const top = await page.$eval('#sky', c => c.getBoundingClientRect().top);
    await page.click('#helloOk');
    assert.equal(await page.$eval('#hello', el => el.hidden), true, 'Got it takes it away');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sky', 'and the focus goes on to the map');
    assert.ok(await page.$eval('#sky', c => c.getBoundingClientRect().top) < top, 'the map moves up into its place');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('starhop.v1'))).hello, true, 'it is remembered');
    await page.reload(); await ready(page);
    assert.equal(await page.$eval('#hello', el => el.hidden), true, 'and stays away after a reload');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  const b = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await b.page.click('#helloScope');
    assert.ok(await b.page.$('#scAp'), 'Set your telescope opens the telescope sheet');
    assert.equal(await b.page.$eval('#hello', el => el.hidden), true, 'and the line goes');
    await b.page.keyboard.press('Escape');
    await b.page.waitForFunction(() => document.activeElement.id === 'scopeBtn', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await b.page.evaluate(() => document.activeElement.id), 'scopeBtn', 'closing the sheet hands the focus to the telescope button');
    assert.deepEqual(b.problems, []);
  } finally { await b.ctx.close(); }
  const c = await open({ save: JSON.stringify({ loc: AUSTIN, scope: { name: '8″ Dobsonian', ap: 203, fl: 1200, eps: [{ f: 25, a: 52 }], set: true } }), time: '2026-11-15T21:00:00-06:00' });
  try {
    assert.equal(await c.page.$eval('#hello', el => el.hidden), true, 'with a telescope already set it doesn’t show');
  } finally { await c.ctx.close(); }
});

check('On a phone the telescope button says Telescope until one is set', async () => {
  for (const [size, loc] of [[[390, 844], { ...AUSTIN, name: 'Chicago, IL' }], [[360, 740], AUSTIN]]) {
    const { ctx, page, problems } = await open({ size, loc, time: '2026-11-15T21:00:00-06:00' });
    try {
      const word = () => page.$eval('#scopeName', el => el.offsetWidth > 0 && el.scrollWidth <= el.clientWidth ? el.textContent : '');
      assert.equal(await word(), 'Telescope', 'the word shows whole at ' + size[0] + ' px');
      if (size[0] >= 390) assert.equal(await page.$eval('#locName', el => el.scrollWidth <= el.clientWidth ? el.textContent : ''), loc.name, 'beside the place’s whole name');
      await page.click('#scopeBtn');
      await page.selectOption('#scPre', 's6');
      await page.click('#scSave');
      assert.equal(await word(), '', 'a telescope set, the button is its icon again');
      assert.equal(await page.$eval('#scopeBtn', b => b.getAttribute('aria-label')), 'Telescope: 8″ Dobsonian');
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

check('a damaged or partial save still opens, keeps what makes sense, and is left as it was', async () => {
  const saves = [
    '{"loc":{"name":"Home"}}', '{"loc":{"name":"Home","lat":30.27,"lon":-97.74,"tz":"Mars/Olympus"}}',
    '{"loc":{"name":"Home","lat":"30.27","lon":"-97.74","tz":"America/Chicago"}}',
    '{"scope":null}', '{"seen":null}', '{"layers":"all"}', '{"sky":"moon"}', '{"ptOff":"x"}', '[1,2]', 'not json',
    '{"log":"x"}', '{"log":[null,7,{"id":{}},{"id":"M31"},{"id":"M15","night":"2026-10-12","seeing":9,"tz":"Mars/Base","t":"soon","lat":"x","note":5}]}',
  ];
  for (const save of saves) {
    const { ctx, page, problems } = await open({ save, time: '2026-10-13T21:00:00-05:00' });
    try {
      assert.match(await text(page, '#keys'), /Sunset/, 'opens with ' + save);
      if (save.includes('"30.27"')) assert.equal(await text(page, '#locName'), 'Home', 'numbers written as text still count');
      await page.click('#targetSec .row');
      assert.ok(await sheetOpen(page), 'a card opens with ' + save);
      await page.click('#sheet [data-close]');
      if (await page.$('#logBtn')) {
        await page.click('#logBtn');
        assert.equal(await text(page, '#sheet .lge'), 'M15 Mon, Oct 12', 'the log keeps what makes sense of an entry with ' + save);
        await page.click('#sheet [data-close]');
      }
      await page.click('#scopeBtn');
      assert.ok(await sheetOpen(page), 'the telescope sheet opens with ' + save);
      assert.deepEqual(problems, [], save);
      assert.equal(await page.evaluate(() => localStorage.getItem('starhop.v1')), save, 'the save is left as it was');
    } finally { await ctx.close(); }
  }
  const noEyepieces = JSON.stringify({ loc: AUSTIN, scope: { name: 'Old', ap: 130, fl: 650, set: true } });
  const { ctx, page, problems } = await open({ save: noEyepieces, time: '2026-10-13T21:00:00-05:00' });
  try {
    await page.click('#targetSec .row');
    assert.match(await text(page, '#sheet'), /Add your eyepieces/, 'a telescope saved without eyepieces asks for them');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Where the lit pixels sit around the middle of the eyepiece view: mean offset in CSS pixels, + is west (right).
const litSide = page => page.$eval('#eyepiece', c => {
  const g = c.getContext('2d'), k = c.width / c.getBoundingClientRect().width, R = Math.round(14 * k), d = g.getImageData(c.width / 2 - R, c.height / 2 - R, 2 * R, 2 * R).data;
  let sx = 0, n = 0;
  for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) { const i = (y * 2 * R + x) * 4; if (d[i] + d[i + 1] + d[i + 2] > 300) { sx += x - R; n++; } }
  return n ? sx / n / k : 0;
});

// Oct 1 2026, 7:20 pm: Venus is a 14% crescent in the evening sky, so its lit side faces the Sun in the west.
check('Venus in the eyepiece is lit on the side facing the Sun', async () => {
  const scope = { name: '130 mm reflector', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }, { f: 4, a: 52 }], set: true, view: 'sky' };
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope }), time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    await page.waitForFunction(() => /163×/.test(document.getElementById('epCap').textContent));
    assert.ok(await litSide(page) > 1, 'the crescent is lit on its west side, toward the Sun, at the right as the eye sees Venus in the southwest');
    await page.click('#sheet [data-close]');
    await page.evaluate(s => localStorage.setItem('starhop.v1', s), JSON.stringify({ loc: AUSTIN, scope: { ...scope, view: 'inv' } }));
    await page.reload(); await ready(page);
    await openCard(page, 'Venus');
    await page.waitForFunction(() => /163×/.test(document.getElementById('epCap').textContent));
    assert.ok(await litSide(page) < -1, 'and at the left when the telescope turns the view upside down');
  } finally { await ctx.close(); }
});

// Oct 1 2026 in Austin, by PyEphem: the Sun sets at 7:16 pm with Venus 10.4° up; by the end of civil twilight at
// 7:40 Venus is down to 5.9°, and it sets at 8:13.
check('an evening planet that only sinks is highest at sunset, not at the end of twilight', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-01T19:20:00-05:00' });
  try {
    await openCard(page, 'Venus');
    assert.match(await text(page, '#sheet .card .big'), /^10° up in the southwest/);
    assert.match(await page.$eval('#sheet .card p:not(.big)', p => p.textContent), /^Up at dusk · Sets 8:1\d pm · Highest at sunset \(10°\)$/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Oct 16 2026 in Austin, by PyEphem: the Sun sets at 6:58 pm with M13 58.9° up, civil twilight ends at 7:22 with M13
// at 54.0°, and at 11:55 pm M13 is 2.8° up, so its finder chart shows it at a better time.
check('a finder chart for something low shows it at nightfall, not in the sunset glow', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-16T23:55:00-05:00' });
  try {
    await openCard(page, 'M13');
    assert.match(await page.$eval('#sheet .card p:not(.big)', p => p.textContent), /Highest at sunset \(59°\)$/, 'the card counts its height from sunset');
    await page.waitForFunction(() => document.getElementById('finder').__stamp);
    assert.equal(await page.$eval('#finder', c => c.__stamp.t), 'Naked-eye view · 7:22 pm', 'the chart waits for the end of civil twilight');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The finder chart's caption, and the star names in its star-hop ("from η Her to Tianji", "1.3° from Antares, toward Fang",
// "from Mirach through μ And", "about 6.7° from β Com").
const hopCap = page => page.$eval('#finder', c => c.parentElement.querySelector('.cap').textContent);
const hopStars = cap => {
  const m = /From (.+?) through (.+?) and /.exec(cap) || /[\d.]+° from (.+?), toward (.+?)(?: \(a little off the line\))?\./.exec(cap) ||
    /(?:a third of the way|halfway) from (.+?) to (.+?)(?: \(a little off the line\))?, [\d.]+° from /.exec(cap) || /About [\d.]+° from (.+?) —/.exec(cap);
  return m ? m.slice(1).filter(Boolean) : [];
};
const CHICAGO = { name: 'Chicago, IL', lat: 41.85, lon: -87.65, tz: 'America/Chicago' };

// Of the 411 stars a star-hop can start or end at, 148 have only a Bayer or Flamsteed label, and the chart labelled only
// stars with a proper name, so M13's "from η Her" started at an unlabelled star.
check('the stars a star-hop names are labelled on its chart', async () => {
  for (const [loc, time, id, want] of [[CHICAGO, '2026-10-16T21:15:00-05:00', 'M13', ['η Her', 'Tianji']], [AUSTIN, '2026-10-13T21:00:00-05:00', 'M27', ['γ Sge', 'η Cyg']]]) {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      await openCard(page, id);
      await page.waitForFunction(() => document.getElementById('finder').__labels);
      const cap = await hopCap(page), names = hopStars(cap), labels = (await finderLabels(page)).labels.map(l => l.t);
      if (id === 'M13') assert.match(cap, /^Star-hop: About a third of the way from η Her to Tianji, 2\.5° from η Her\./);
      for (const n of want) assert.ok(names.includes(n), `${id}'s star-hop names ${n}: ${cap}`);
      for (const n of names) assert.ok(labels.includes(n), `${id}'s chart labels ${n}, which its star-hop names (it has ${labels.join(', ')})`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Hatysa is 0.9° from M43, inside the target's ring, so every place for its name ran into the ring or M43's label, and
// the chart named it in its star-hop without labelling it. Spica, 1.6° from Venus, had the same trouble.
check('the star a hop starts from is labelled even right beside the target', async () => {
  for (const [loc, time, id, name] of [[{ name: 'Senmonorom', lat: 12.45, lon: 107.2, tz: 'Asia/Phnom_Penh' }, '2009-01-22T19:15:00+07:00', 'M43', 'Hatysa'], [AUSTIN, '2026-11-16T06:24:00-06:00', 'Venus', 'Spica']]) {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      await openCard(page, id);
      await page.waitForFunction(() => document.getElementById('finder').__labels);
      const f = await finderLabels(page), labels = f.labels.map(l => l.t);
      if (id === 'M43') assert.match(await hopCap(page), /Star-hop: 0\.\d° from Hatysa, toward /);
      assert.ok(labels.includes(name), `${id}'s chart labels ${name} (it has ${labels.join(', ')})`);
      // beside its own star, not across the target from it
      const l = f.labels.find(x => x.t === name), gap = Math.hypot(Math.max(l.x - l.ax, 0, l.ax - l.x - l.w), Math.max(l.y - l.ay, 0, l.ay - l.y - l.h));
      assert.ok(gap < 18, `${name}'s label is ${gap.toFixed(1)} px from its star`);
      assert.ok(labels.includes(id), `${id}'s chart still labels ${id}`);
      checkLabels(f.labels, f.w, f.h, f.keep, `${id}’s finder chart`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// The Pleiades' hop started "Just beside Electra", a Pleiad 0.48° from the cluster's centre, and Vega's hopped to the
// fifth brightest star in the sky from Sheliak, at magnitude 3.5.
check('a cluster’s star-hop doesn’t start inside the cluster, and Vega needs no hop', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await openCard(page, 'M45');
    const cap = await hopCap(page);
    assert.match(cap, /^Visible without a telescope from your sky: .*Star-hop: /);
    assert.doesNotMatch(cap, /Alcyone|Atlas|Electra|Maia|Merope|Taygeta|Pleione|Celaeno|Asterope/, 'the Pleiades’ star-hop names a Pleiad');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' }));
  try {
    await tapMap(page, 'star', await starIndex('Vega'));
    const cap = await hopCap(page);
    assert.doesNotMatch(cap, /Star-hop/, 'Vega’s card has a star-hop');
    assert.match(cap, /^One of the brightest stars in the sky/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Every double got a hop, even one whose own star you see at a glance: Polaris "About 12° from Errai", Rigel "About a
// third of the way from Cursa to Arneb", Mizar from Alkaid to Dubhe. From the suburbs (faintest star 5.0) a star
// brighter than 4.0 is the target itself; 61 Cygni, at 5.2, still needs finding.
check('Polaris and Rigel need no star-hop, 61 Cygni still gets one', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:30:00-06:00' });
  try {
    await page.click('#targetSec .filters [data-f="double"]');
    for (const [id, star] of [['polaris', 'Polaris'], ['rigel', 'Rigel']]) {
      await openCard(page, id);
      const cap = await hopCap(page);
      assert.doesNotMatch(cap, /Star-hop/, id + ': ' + cap);
      assert.match(cap, new RegExp('^' + star + ' is the naked-eye star itself \\(mag \\d\\.\\d\\), at the centre of the chart\\. '));
      await page.waitForFunction(() => document.getElementById('finder').__ring);
      assert.ok(await page.$eval('#finder', c => !!c.__ring), id + ' keeps its ring');
      await page.click('#sheet [data-close]');
    }
    await openCard(page, '61cyg');
    assert.match(await hopCap(page), /^Star-hop: /, '61 Cygni');
    await page.click('#sheet [data-close]');
    // a deep-sky object you can see without a telescope says so, and keeps its hop
    await page.click('#targetSec .filters [data-f="all"]');
    await openCard(page, 'M45');
    assert.match(await hopCap(page), /^Visible without a telescope from your sky: a misty patch or a knot of faint stars at the centre of the chart\. Star-hop: /);
    await page.click('#sheet [data-close]');
    await openCard(page, 'M57');
    assert.match(await hopCap(page), /^Star-hop: /, 'the Ring Nebula');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// From Kamensk-Uralsky at 10 pm on Feb 1 2002, M3 is 10° up in the northeast and Arcturus is 2° below the horizon.
check('a star-hop starts from stars that are up', async () => {
  const { ctx, page, problems } = await open({ loc: { name: 'Kamensk-Uralsky, RU', lat: 56.42, lon: 61.94, tz: 'Asia/Yekaterinburg' }, time: '2002-02-01T22:00:00+05:00' });
  try {
    await openCard(page, 'M3');
    const cap = await hopCap(page);
    assert.match(cap, /^Star-hop: /);
    assert.doesNotMatch(cap, /Arcturus/, 'M3’s star-hop starts from Arcturus, below the horizon');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A hop could run 20° and more between two bright stars ("about halfway from Arcturus to Cor Caroli" for M3), far
// beyond a finder's 5° field, and started only from stars of magnitude 3.8 or brighter, so the classic routes through
// fainter stars, such as μ And for M31, were out of reach. Now a hop starts no more than 8° from its target, at a star
// you can see from your sky, and can go through a second star and on.
const designation = async name => { const n = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).n; return (Object.values(n).find(v => v[0] === name || v[1] === name) || [])[1]; };
check('Star-hops take the classic routes: the Ring between β and γ Lyrae, Andromeda through μ And, M13 between η and ζ Her', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T19:00:00-06:00' });
  try {
    for (const [id, want, re] of [['M57', ['β Lyr', 'γ Lyr'], /^Star-hop: 0\.8° from Sheliak, toward Sulafat\./], ['M31', ['β And', 'μ And'], /^Visible without a telescope from your sky: a misty patch at the centre of the chart\. Star-hop: From Mirach through μ And and about as far again, 3\.9° past μ And\./], ['M13', ['η Her', 'ζ Her'], /^Star-hop: About a third of the way from η Her to Tianji, 2\.5° from η Her\./]]) {
      await openCard(page, id);
      await page.waitForFunction(() => document.getElementById('finder').__labels);
      const cap = await hopCap(page), stars = [];
      for (const n of hopStars(cap)) stars.push(await designation(n));
      assert.deepEqual(stars, want, `${id}: ${cap}`);
      assert.match(cap, re);
      await page.click('#sheet [data-close]');
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The stars a hop can start from are named or lettered, brighter than magnitude 4.5 and than the faintest you see, and
// outside the object itself (the Coma Star Cluster's own stars are no start for its hop).
check('No star-hop’s first leg is longer than 8°, unless no star you can see is that close', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')), dso = JSON.parse(await readFile(join(root, 'data/dso.json'), 'utf8'));
  const R = Math.PI / 180, sep = (a, b, c, d) => Math.acos(Math.min(1, Math.sin(b * R) * Math.sin(d * R) + Math.cos(b * R) * Math.cos(d * R) * Math.cos((a - c) * R))) / R;
  const closest = (o, lim) => Math.min(...Object.keys(n).filter(i => s[i * 4 + 2] < lim && i * 4 + 4 < s.length).map(i => sep(o.ra, o.dec, s[i * 4], s[i * 4 + 1])).filter(d => d > Math.max(0.3, Math.max(...(o.dim || [0])) / 120)));
  const all = dso.dso.concat(dso.doubles);
  for (const [sky, lim] of [['suburb', 4.5], ['city', 3.6]]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, sky }), time: '2026-11-15T21:00:00-06:00' });
    try {
      if (await page.$('#moreT')) await page.click('#moreT');
      const ids = await page.$$eval('#targetSec .row[data-k="dso"], #targetSec .row[data-k="double"]', rs => rs.map(r => r.dataset.id));
      assert.ok(ids.length > 40, `${sky}: ${ids.length} targets`);
      let pairs = 0;
      for (const id of ids) {
        await openCard(page, id);
        const hop = await page.waitForFunction(() => { const c = document.getElementById('finder'); return c.__labels && { h: c.__hop }; }).then(h => h.jsonValue());
        const cap = await hopCap(page), o = all.find(x => x.id === id);
        if (hop.h) {
          if (hop.h.kind !== 'near') pairs++;
          if (hop.h.leg > 8) assert.ok(hop.h.kind === 'near' && closest(o, lim) > 8, `${sky}: ${id}'s first leg is ${hop.h.leg.toFixed(1)}°: ${cap}`);
          for (const nm of hopStars(cap)) { const i = Object.keys(n).find(k => n[k][0] === nm || n[k][1] === nm); assert.ok(s[i * 4 + 2] < lim, `${sky}: ${id}'s hop uses ${nm}, magnitude ${s[i * 4 + 2]}`); }
        }
        await page.click('#sheet [data-close]');
      }
      assert.ok(pairs > ids.length / 3, `${sky}: ${pairs} of ${ids.length} hops run between two stars`);
      // a city sky draws the chart's fainter stars hollow, and says why
      if (sky === 'city') {
        await openCard(page, 'M13');
        await page.waitForFunction(() => document.getElementById('finder').__labels);
        assert.ok(await page.$eval('#finder', c => c.__hollow) > 20, 'hollow stars on M13’s chart');
        assert.match(await hopCap(page), /Hollow dots are stars too faint to see by eye from your sky; a finder shows them\.$/);
      }
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
  // a dark sky shows every star the chart draws, so none is hollow
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, sky: 'dark' }), time: '2026-11-15T21:00:00-06:00' });
  try {
    await openCard(page, 'M31');
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    assert.equal(await page.$eval('#finder', c => c.__hollow), 0);
    assert.doesNotMatch(await hopCap(page), /Hollow/);
  } finally { await ctx.close(); }
});

// Each 5-minute sample of the Moon band was filled on its own, overlapping the next by 0.6 px, so the overlaps doubled up
// into stripes every few pixels.
check('the Moon’s band on the timeline is one even bar', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const row = await page.$eval('#tlc', c => { const k = c.width / c.getBoundingClientRect().width, d = c.getContext('2d').getImageData(0, Math.round(43 * k), c.width, 1).data, v = []; for (let i = 0; i < d.length; i += 4) v.push(d[i] + d[i + 1] + d[i + 2]); return v; });
    const lit = row.map((v, i) => [v, i]).filter(([v]) => v > 60), a = lit[0][1], b = lit[lit.length - 1][1];
    assert.ok(b - a > 100, 'the Moon is up for a while at the start of the night');
    const mid = row.slice(a + 4, b - 4);
    assert.ok(Math.max(...mid) - Math.min(...mid) <= 3, `the band runs from ${Math.min(...mid)} to ${Math.max(...mid)}`);
  } finally { await ctx.close(); }
});

// The finder chart's stamp had nothing behind it, so lines and markers ran through it. From New York at 8:30 pm on Nov 15
// a line of Andromeda crosses M31's stamp.
// The caption calls the dashed circle a 5° finderscope field, but it was drawn with a 5° radius, 10° across.
check('The finder circle is as wide as the field it names', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__ring, null, { timeout: 5000 });
    const m = await page.$eval('#finder', c => {
      const at = c.__at(250.4217, 36.4613), off = c.__at(250.4217, 36.4613 + 2.5), r = c.__ring; // M13, and 2.5° north of it
      return { centre: Math.hypot(at[0] - r.x, at[1] - r.y), half: Math.hypot(off[0] - at[0], off[1] - at[1]), r: r.r };
    });
    assert.ok(m.centre < 0.5, 'the circle is centred on M13');
    assert.ok(Math.abs(m.r - m.half) < 0.01 * m.half, `the circle's radius is ${m.r.toFixed(1)} px; 2.5° is ${m.half.toFixed(1)} px`);
    assert.match(await text(page, '#sheet .chart .cap'), /finderscope field \(5°\)/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The finder chart drew a 5° finderscope circle whatever finder the telescope has. A Telrad's reticle is three rings,
// 4°, 2° and ½° across (Agena Astro's listing for its replacement reticle); a red-dot finder has no field at all.
check('The finder chart draws the finder chosen in the telescope sheet', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const ring = () => page.$eval('#finder', c => {
    const at = c.__at(250.4217, 36.4613), off = c.__at(250.4217, 36.4613 + 1); // M13, and 1° north of it
    return c.__ring && { r: c.__ring.r, deg: c.__ring.r / Math.hypot(off[0] - at[0], off[1] - at[1]) * 2 };
  });
  try {
    await page.click('#scopeBtn');
    assert.equal(await page.$eval('#fdOpts [aria-pressed="true"]', b => b.dataset.f), 'fs', 'a finderscope to start with');
    await page.click('#fdOpts [data-f="telrad"]');
    assert.equal(await page.$eval('#fdOpts [aria-pressed="true"]', b => b.innerText.replace(/\s+/g, ' ')), 'Telrad Rings of ½°, 2° and 4°');
    await page.click('#scSave');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('starhop.v1'))).scope.finder, 'telrad', 'it is kept');
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__ring, null, { timeout: 5000 });
    const t = await ring();
    assert.ok(Math.abs(t.deg - 4) < 0.05, 'the Telrad’s outer ring is 4° across: ' + t.deg);
    assert.match(await text(page, '#finderCap'), /The circles are your Telrad’s rings, 4°, 2° and ½° across\./);
    assert.match(await text(page, '#finderCap'), /too faint to see by eye from your sky; your lowest-power eyepiece shows them\.$/, 'a Telrad doesn’t magnify, so it doesn’t show them');
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    await page.click('#fdOpts [data-f="dot"]');
    await page.click('#scSave');
    await openCard(page, 'M13');
    await page.waitForFunction(() => /red-dot/.test(document.getElementById('finderCap').textContent));
    await page.waitForFunction(() => document.getElementById('finder').__labels);
    assert.equal(await ring(), null, 'no circle for a red-dot finder');
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    await page.click('#fdOpts [data-f="f30"]');
    await page.click('#scSave');
    await openCard(page, 'M13');
    await page.waitForFunction(() => /6×30/.test(document.getElementById('finderCap').textContent) && document.getElementById('finder').__ring);
    assert.ok(Math.abs((await ring()).deg - 7) < 0.05, 'a 6×30 finder’s circle is 7° across');
    assert.match(await text(page, '#finderCap'), /a finder shows them\.$/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A save from before the finder was a choice, or with one Starhop doesn't know, has a finderscope.
check('A saved telescope without a finder opens with a finderscope', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: { name: 'Mine', ap: 150, fl: 750, eps: [{ f: 25, a: 52 }], set: true, finder: 'laser' } }), time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__ring);
    assert.match(await text(page, '#finderCap'), /typical finderscope field \(5°\)/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('the finder chart’s stamp sits on a plate', async () => {
  const { ctx, page } = await open({ loc: { name: 'New York, NY', lat: 40.71, lon: -74.01, tz: 'America/New_York' }, time: '2026-11-15T20:30:00-05:00' });
  try {
    await openCard(page, 'M31');
    await page.waitForFunction(() => document.getElementById('finder').__stamp);
    const top = await page.$eval('#finder', c => {
      const k = c.width / c.getBoundingClientRect().width, s = c.__stamp, d = c.getContext('2d').getImageData(Math.round((s.x + 8) * k), Math.round((s.y + 1) * k), Math.round((s.w - 14) * k), Math.round(3 * k)).data;
      let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); return m;
    });
    // Under the plate even a white star comes out below 200 (r + g + b); without it the strip reaches 477.
    assert.ok(top < 200, `the strip above the stamp's words is dimmed (brightest ${top})`);
  } finally { await ctx.close(); }
});

// Seen from south of the equator the Moon is upside down to a northern observer, so a waxing Moon is lit on its left,
// as the sky map (which lights it from the Sun's direction) already drew it. The Tonight icon lit it on the right.
check('the Moon icon is lit on the left from Sydney when waxing', async () => {
  const { ctx, page } = await open({ loc: { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' }, time: '2026-11-19T21:30:00+11:00' });
  try {
    assert.match(await text(page, '#tonightSec .moonrow b'), /^Waxing gibbous/);
    const [left, right] = await page.$eval('#moonIc', c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = [0, 0];
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 500) n[(i / 4) % c.width < c.width / 2 ? 0 : 1]++;
      return n;
    });
    assert.ok(left > right, `lit pixels: ${left} on the left, ${right} on the right`);
  } finally { await ctx.close(); }
});

// Earth crossed Saturn's ring plane in March 2025 and has seen the rings' south face since, so the near arm crosses the
// northern half of the globe. Astronomy Engine 2.1.19's ring_tilt is +6.28° on Nov 15 2026, the opposite sign to the
// ring-plane latitude B worked out from the IAU pole (RA 40.589°, Dec 83.537°; Archinal et al. 2018), −6.27°. In Oct
// 2017 B was +27°, the north face.
check('Saturn’s rings show their south face in 2026', async () => {
  for (const [time, face] of [['2026-11-15T21:00:00-06:00', 'south'], ['2017-10-16T20:00:00-05:00', 'north']]) {
    const { ctx, page, problems } = await open({ time });
    try {
      await openCard(page, 'Saturn');
      await page.waitForFunction(() => document.getElementById('eyepiece').__ring, null, { timeout: 10000 }).catch(() => {});
      assert.equal(await page.$eval('#eyepiece', c => c.__ring), face, `the face of Saturn's rings shown on ${time.slice(0, 10)}`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

const advice = page => page.$$eval('#sheet .card', cs => cs.find(c => c.querySelector('h3').textContent === 'In your telescope').querySelector('p').textContent);

check('a card says an object is wider than the field only when it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const say = async id => { await openCard(page, id); const a = await advice(page); await page.click('#sheet [data-close]'); return a; };
    assert.equal(await say('M45'), 'At 1.8° across, it fills most of your lowest-power field (2.0°). Use the 25 mm, or try binoculars.');
    assert.match(await say('M31'), /^At 3\.0° across, it’s wider than your lowest-power field \(2\.0°\)\./);
    assert.match(await say('M57'), /^It spans 1\.4′\. Find it with the 25 mm \(2\.0° field\), then try the 10 mm \(65×\) for a closer look\.$/);
  } finally { await ctx.close(); }
});

// Izar's stars are 2.9″ apart and 2.2 magnitudes different, which takes 108× (240 ÷ 2.9, and 30% more for the faint companion). The example telescope's eyepieces reach 65×; the 8″ Dobsonian's reach 200×.
check('a double star is rated, advised and sketched by the same power, the one your eyepieces reach', async () => {
  for (const [save, label] of [[{ loc: AUSTIN }, 'Needs 108×'], [{ loc: AUSTIN, scope: DOB8 }, 'Easy split']]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify(save), time: '2026-06-15T22:00:00-05:00' });
    try {
      const split = label === 'Easy split', who = save.scope ? 'the 8″ Dobsonian' : 'the example telescope';
      await page.click('#targetSec .filters [data-f="double"]');
      assert.equal(await page.$eval('#targetSec .row[data-id="izar"] .rate', el => el.textContent), label, 'the list, ' + who);
      await openCard(page, 'izar');
      assert.match(await advice(page), split ? /about 108× splits them, so start with the 6 mm \(200×\)\.$/ : /takes about 108×; your highest power is 65×\./, 'the card, ' + who);
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      (split ? assert.doesNotMatch : assert.match)(await text(page, '#epCap'), /not split at this power/, 'the eyepiece sketch, ' + who);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// The sketch showed only the suggested eyepiece, so changing eyepiece at the scope, the card couldn't show what the new
// one would show.
check('Tapping an eyepiece row shows its view', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T19:30:00-06:00' });
  const cap = () => page.$eval('#epCap', c => c.textContent);
  const row = mm => page.locator('#sheet .eps tbody tr', { hasText: mm + ' mm' });
  try {
    await openCard(page, 'M45');
    await page.waitForFunction(() => document.getElementById('epCap').textContent);
    assert.match(await cap(), /^26× with the 25 mm/);
    assert.ok((await row(10).boundingBox()).height >= 44, 'a row is big enough to tap');
    await row(10).click();
    assert.match(await cap(), /^65× with the 10 mm/, 'a tap shows that eyepiece');
    assert.equal(await row(10).getAttribute('aria-pressed'), 'true');
    assert.equal(await row(25).getAttribute('aria-pressed'), 'false');
    assert.match(await row(25).innerText(), /Suggested/, 'the suggestion stays where it was');
    await page.clock.runFor('02:00'); // the card is redrawn for the new minute
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 7:32 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.$eval('#sheet .card h3', h => h.textContent), 'At 7:32 pm');
    await page.waitForTimeout(100);
    assert.match(await cap(), /^65× with the 10 mm/, 'the choice outlasts the redraw');
    await row(25).focus();
    await page.keyboard.press('Enter');
    assert.match(await cap(), /^26× with the 25 mm/, 'Enter picks a row too');
    await row(10).click();
    await page.click('#sheet [data-close]');
    await openCard(page, 'M45');
    await page.waitForFunction(() => document.getElementById('epCap').textContent);
    assert.match(await cap(), /^26× with the 25 mm/, 'a card opened again starts from the suggestion');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // a double star splits or not with the eyepiece picked
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-06-15T22:00:00-05:00' }));
  try {
    await page.click('#targetSec .filters [data-f="double"]');
    await openCard(page, 'izar');
    await page.waitForFunction(() => document.getElementById('epCap').textContent);
    assert.doesNotMatch(await cap(), /not split/);
    await row(25).click();
    assert.match(await cap(), /^48× with the 25 mm.*not split at this power/);
    await row(6).click();
    assert.doesNotMatch(await cap(), /not split/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The split power was 240 ÷ separation whatever the magnitudes, so Rigel's companion, 6.5 magnitudes fainter and
// "almost lost in Rigel’s glare", took 27× and the card said to start with the 25 mm; and Castor's card said about 48×
// beside a note saying it needs about 100×.
check('Rigel’s card no longer suggests the 25 mm', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T23:00:00-06:00' });
  try {
    await page.click('#targetSec .filters [data-f="double"]');
    const rows = await targetRows(page), rate = id => rows.find(r => r.id === id)?.rate;
    assert.equal(rate('rigel'), 'Splits at 61×', 'Rigel on the list');
    assert.equal(rate('albireo'), 'Easy split', 'Albireo on the list');
    await openCard(page, 'rigel');
    assert.equal(await advice(page), 'The two stars are 9.4″ apart; about 61× splits them, so start with the 10 mm (65×).');
    await page.click('#sheet [data-close]');
    await openCard(page, 'castor');
    assert.match(await advice(page), /about 43× splits them/);
    assert.doesNotMatch(await text(page, '#sheet'), /100×/, 'Castor’s card gives one power');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The card covered only the wide pair, 209″ apart. Each of its stars is a close pair, 2.1″ and 2.4″ apart (WDS), which
// takes about 114× and 100×.
check('Epsilon Lyrae says whether your telescope splits each star again', async () => {
  const scopes = [[null, /Each star splits again, 2\.1″ and 2\.4″ apart, at about 114× and 100×; your highest power is 65×, so they need a shorter eyepiece or a 2× Barlow\.$/],
    [DOB8, /Each star splits again, 2\.1″ and 2\.4″ apart, at about 114× and 100×: the 6 mm \(200×\) splits both\.$/],
    [{ name: '', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }, { f: 6, a: 52 }], set: true }, /: the 6 mm \(108×\) splits the 2\.4″ pair but not the 2\.1″ one\.$/]];
  for (const [scope, want] of scopes) {
    const { ctx, page, problems } = await open({ save: JSON.stringify(scope ? { loc: AUSTIN, scope } : { loc: AUSTIN }), time: '2026-10-13T21:00:00-05:00' });
    try {
      await page.click('#targetSec .filters [data-f="double"]');
      await openCard(page, 'epslyr');
      assert.match(await advice(page), want);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// Separate lit blobs within r px of the eyepiece view's centre.
const blobsNearCentre = (page, r) => page.$eval('#eyepiece', (c, r) => {
  const k = c.width / c.getBoundingClientRect().width, R = Math.round(r * k), x0 = Math.round(c.width / 2) - R, y0 = Math.round(c.height / 2) - R, n = 2 * R;
  const d = c.getContext('2d').getImageData(x0, y0, n, n).data, lit = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) lit[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] > 420 ? 1 : 0;
  let blobs = 0;
  for (let i = 0; i < n * n; i++) if (lit[i]) { blobs++; const st = [i]; lit[i] = 0; while (st.length) { const j = st.pop(), x = j % n, y = (j - x) / n; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy, q = yy * n + xx; if (xx >= 0 && yy >= 0 && xx < n && yy < n && lit[q]) { lit[q] = 0; st.push(q); } } } }
  return blobs;
}, r);

// The sketch draws a double's two stars wider apart than they look, 6 px either side of the centre at 26×, and the
// catalogue's own stars for the pair were drawn too, at their true 34″ (under 2 px), so Albireo showed a third dot
// between the two, touching the gold one.
check('Albireo’s eyepiece sketch shows two stars', async () => {
  const scope = { name: '130 mm reflector', ap: 130, fl: 650, eps: [{ f: 25, a: 52 }], set: true };
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope }), time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'albireo');
    await page.waitForFunction(() => /25 mm/.test(document.getElementById('epCap').textContent));
    assert.equal(await blobsNearCentre(page, 20), 2, 'stars drawn at the centre of Albireo’s eyepiece view');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Many beginner kits come with a 2× Barlow, but the sheet had no place for it, so Izar (2.9″, needing about 108×) was
// out of reach of a 130 mm reflector's 25 mm and 10 mm (26× and 65×), which reach 130× with it. A Barlow's power past
// the telescope's highest useful one (twice the aperture in mm) is listed but not suggested.
check('A Barlow in the telescope sheet adds its powers to the eyepieces', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const table = () => page.$$eval('#sheet .eps tbody tr', t => t.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  try {
    await openCard(page, 'izar');
    assert.match(await text(page, '#sheet'), /your highest power is 65×\. A shorter eyepiece or a 2× Barlow will do it\./);
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    assert.equal(await page.$eval('#bwOpts [aria-pressed="true"]', b => b.textContent), 'None');
    await page.click('#bwOpts [data-b="2"]');
    assert.deepEqual(await page.$$eval('#scStats tbody tr', t => t.map(r => [...r.cells].map(c => c.textContent.replace(/ arcminutes?/, '')).join(' '))),
      ['25 mm 26× 2.0°', '25 mm + 2× 52× 1.0°', '10 mm 65× 48′', '10 mm + 2× 130× 24′'], 'the sheet lists each eyepiece with and without it');
    await page.click('#scSave');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('starhop.v1'))).scope.barlow, 2, 'it is kept');
    await openCard(page, 'izar');
    assert.match(await text(page, '#sheet'), /about 108× splits them, so start with the 10 mm with the 2× Barlow \(130×\)\./);
    assert.deepEqual(await table(), ['25 mm 26× 2.0°', '25 mm + 2× 52× 1.0°', '10 mm 65× 48′', '10 mm + 2× 130× 24′ Suggested']);
    await page.waitForFunction(() => /130× with the 10 mm with the 2× Barlow/.test(document.getElementById('epCap').textContent));
    await page.click('#sheet [data-close]');
    // a 70 mm refractor's highest useful power is 140×: the 10 mm with a 3× Barlow, 210×, is listed but not used
    await page.click('#scopeBtn');
    await page.selectOption('#scPre', { label: '70 mm refractor (70 mm, f/10.0)' });
    await page.click('#bwOpts [data-b="3"]');
    await page.click('#scSave');
    await openCard(page, 'izar');
    const rows = await table();
    assert.equal(rows.length, 4, rows.join(' | '));
    assert.match(rows[3], /^10 mm \+ 3× 210× \S+ Beyond 140×$/, 'the 210× row is listed, past the limit');
    assert.match(await text(page, '#sheet'), /your highest power is 84×\. A shorter eyepiece will do it\./, 'and isn’t counted');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The sketch drew every companion due west of its primary (position angle 270°), the same size whatever the two
// magnitudes. The WDS's latest measures put Albireo B at 54° (northeast, between the sketch's N and E marks) and
// Mesarthim's matched pair (4.5 and 4.6) at 359°, due north.
// The eyepiece sketch was drawn north up and east left, while the finder chart beside it has the zenith up, and most
// telescopes turn or mirror the view besides, so the two pictures never matched each other or the eyepiece. A reflector
// shows the view upside down (turned 180°); a star diagonal shows it the right way up but mirrored left to right.
check('The eyepiece sketch is turned the way the finder chart and the telescope show it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  // north and east as unit steps across the finder chart, at M13
  const finderDirs = () => page.$eval('#finder', c => {
    const at = c.__at(250.4217, 36.4613), n = c.__at(250.4217, 36.4613 + 0.1), e = c.__at(250.4217 + 0.1 / Math.cos(36.4613 * Math.PI / 180), 36.4613);
    const u = p => { const d = [p[0] - at[0], p[1] - at[1]], l = Math.hypot(d[0], d[1]); return [d[0] / l, d[1] / l]; };
    return { n: u(n), e: u(e) };
  });
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02;
  const card = async () => {
    await openCard(page, 'M13');
    await page.waitForFunction(() => document.getElementById('finder').__ring && document.getElementById('eyepiece').__frame);
    return { f: await finderDirs(), p: await page.$eval('#eyepiece', c => c.__frame), cap: await text(page, '#epCap'), marks: await page.$eval('#eyepiece', c => c.__marks) };
  };
  const pick = async (label) => { await page.click('#scopeBtn'); await page.selectOption('#scPre', { label }); };
  try {
    let { f, p, cap, marks } = await card();
    assert.ok(near(p.n, [-f.n[0], -f.n[1]]) && near(p.e, [-f.e[0], -f.e[1]]), `the example 130 mm reflector turns it upside down: ${JSON.stringify({ f, p })}`);
    assert.match(cap, /\. Drawn as a 130 mm reflector shows it: upside down from the naked-eye view\.$/);
    const w = await page.$eval('#eyepiece', c => c.getBoundingClientRect().width);
    assert.ok(Math.abs(marks.N[0] - (w / 2 + p.n[0] * (w / 2 - 15))) < 1, 'the N mark sits where north is');
    await page.click('#sheet [data-close]');
    await pick('80 mm refractor (80 mm, f/5.0)');
    assert.equal(await page.$eval('#vwOpts [aria-pressed="true"]', b => b.dataset.v), 'mir', 'a refractor’s quick pick sets a mirrored view');
    await page.click('#scSave');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('starhop.v1'))).scope.view, 'mir', 'it is kept');
    ({ f, p, cap } = await card());
    assert.ok(near(p.n, [-f.n[0], f.n[1]]) && near(p.e, [-f.e[0], f.e[1]]), `a star diagonal mirrors it left to right: ${JSON.stringify({ f, p })}`);
    assert.match(cap, /Drawn as your 80 mm refractor shows it: mirrored left to right from the naked-eye view\.$/);
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn');
    await page.click('#vwOpts [data-v="sky"]');
    await page.click('#scSave');
    ({ f, p, cap } = await card());
    assert.ok(near(p.n, f.n) && near(p.e, f.e), 'as the sky, it matches the finder chart');
    assert.match(cap, /the same way round as the naked-eye view\.$/);
    await page.click('#sheet [data-close]');
    await pick('8″ Dobsonian (203 mm, f/5.9)');
    assert.equal(await page.$eval('#vwOpts [aria-pressed="true"]', b => b.dataset.v), 'inv', 'a Dobsonian’s quick pick turns it upside down');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A save from before the view was a choice is guessed from the telescope's name, and anything else is shown as the sky.
check('A saved telescope without a view guesses it from its name', async () => {
  for (const [name, want] of [['6″ Dobsonian', /upside down/], ['127 mm Maksutov', /mirrored/], ['Grandad’s', /same way round/]]) {
    const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: { name, ap: 150, fl: 1200, eps: [{ f: 25, a: 52 }], set: true, view: 'sideways' } }), time: '2026-10-13T21:00:00-05:00' });
    try {
      await openCard(page, 'M13');
      await page.waitForFunction(() => document.getElementById('epCap').textContent);
      assert.match(await text(page, '#epCap'), want, name);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
});

// The eyepiece sketch drew the target alone, M31 without M32 and M110 beside it, and every glow as bright as its
// magnitude, so a Hard M33 from the suburbs was an obvious 70′ patch; galaxies were tilted at a made-up angle.
check('The eyepiece sketch shows what shares the field, faded as hard as each one is', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  const nbrs = () => page.waitForFunction(() => document.getElementById('eyepiece').__nbrs).then(h => h.jsonValue());
  try {
    await openCard(page, 'M31');
    assert.match(await text(page, '#sheet'), /M32 and M110 share the 25 mm field\./);
    const n = await nbrs(), w = await page.$eval('#eyepiece', c => c.getBoundingClientRect().width);
    assert.deepEqual(n.map(q => q.id), ['M32', 'M110'], 'drawn in the sketch, nearest first');
    assert.ok(n.every(q => Math.hypot(q.x - w / 2, q.y - w / 2) < w / 2 - 6), 'inside the field');
    await page.click('#sheet [data-close]');
    await openCard(page, 'M81');
    assert.match(await text(page, '#sheet'), /M82 shares the 25 mm field\./);
    await page.click('#epr0');
    await page.waitForFunction(() => /25 mm/.test(document.getElementById('epCap').textContent));
    assert.deepEqual((await nbrs()).map(q => q.id), ['M82'], 'M82 is beside M81 in the 25 mm');
    await page.click('#sheet [data-close]');
    await openCard(page, 'M33');
    assert.match(await text(page, '#sheet'), /DIFFICULTY Hard/i);
    const sub = await page.waitForFunction(() => document.getElementById('eyepiece').__glow).then(h => h.jsonValue());
    await page.click('#sheet [data-close]');
    await page.click('#scopeBtn'); await page.click('#skyOpts [data-s="dark"]'); await page.click('#scSave');
    await openCard(page, 'M33');
    const dark = await page.waitForFunction(() => document.getElementById('eyepiece').__glow).then(h => h.jsonValue());
    assert.ok(sub < dark * 0.6, `a Hard M33 is drawn fainter than from a dark site: ${sub} against ${dark}`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A neighbour in the field was drawn as a glow or a cloud of made-up stars whatever it was, so in 10×50s Kemble's
// Cascade, 1.4° from NGC 1502, came out as a round cluster 2.8° across, and M73, four faint stars by M72, as a cluster.
check('Kemble’s Cascade beside NGC 1502 is drawn by its own stars, and M73’s few faint ones are left out', async () => {
  const BINO = { kind: 'bino', name: '10×50 binoculars', ap: 50, mag: 10, fov: 6.5, set: true };
  const nbrs = page => page.waitForFunction(() => document.getElementById('eyepiece').__nbrs).then(h => h.jsonValue());
  let { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: BINO }), time: '2026-11-15T23:30:00-06:00' });
  try {
    await openCard(page, 'NGC 1502');
    assert.match(await text(page, '#sheet'), /Kemble 1 shares your binoculars’ field\./);
    const n = await nbrs(page);
    assert.deepEqual(n.map(q => [q.id, q.stars]), [['Kemble 1', 9]], 'drawn as its chain of stars');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: BINO }), time: '2026-08-15T22:00:00-05:00' }));
  try {
    await openCard(page, 'M72');
    assert.match(await text(page, '#sheet'), /\. NGC 7009 shares your binoculars’ field\./);
    assert.deepEqual((await nbrs(page)).map(q => q.id), ['NGC 7009']);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Cards said "try binoculars" for big objects, but binoculars couldn't be chosen, and many beginners start with 10×50s.
// Binoculars split a double by the same rule at their one power, about 240 ÷ the separation: Albireo (34.3″) at 7×,
// ν Draconis (62″) easily, Mizar (14.4″, with a companion 1.7 magnitudes fainter) not at 10×.
check('Binoculars can be chosen, with one power and field, and the sketch shows their whole field', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await page.click('#scopeBtn');
    assert.equal(await page.isVisible('#bnMag'), false, 'a telescope’s sheet has no power box');
    await page.click('#inOpts [data-n="bino"]');
    assert.equal(await page.inputValue('#scAp'), '50', 'binoculars start from their own aperture, not the telescope’s 130 mm');
    assert.equal(await page.isVisible('#epl'), false, 'binoculars have no eyepieces');
    assert.equal(await page.isVisible('#bwOpts'), false, 'no Barlow');
    assert.equal(await page.isVisible('#fdOpts'), false, 'and no finder');
    await page.selectOption('#scPre', { label: '10×50 binoculars (6.5° field)' });
    assert.deepEqual([await page.inputValue('#scAp'), await page.inputValue('#bnMag'), await page.inputValue('#bnFov')], ['50', '10', '6.5']);
    assert.match(await text(page, '#scStats'), /Splits pairs to 24″ Power 10× Field 6\.5°/i);
    await page.click('#scSave');
    assert.equal(await text(page, '#toast'), 'Ratings now for your 10×50 binoculars under suburban skies');
    assert.equal(await page.$eval('#scopeBtn', b => b.getAttribute('aria-label')), 'Binoculars: 10×50 binoculars');
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('starhop.v1'))).scope, { kind: 'bino', name: '10×50 binoculars', ap: 50, mag: 10, fov: 6.5, set: true });
    await openCard(page, 'M13');
    assert.match(await text(page, '#sheet'), /IN YOUR BINOCULARS It spans 17′; your binoculars show it at 10× in a 6\.5° field\. 10× · 6\.5° field/i);
    assert.equal(await page.$('#sheet .eps'), null, 'one line, not a table');
    await page.waitForFunction(() => document.getElementById('finder').__ring && document.getElementById('epCap').textContent);
    assert.equal(await text(page, '#epCap'), '10× · field 6.5° · a sketch, not a photo — expect it fainter. Drawn as your 10×50 binoculars show it: the same way round as the naked-eye view.');
    assert.match(await text(page, '#finderCap'), /The dashed circle is your binoculars’ field \(6\.5°\)\./);
    const deg = await page.$eval('#finder', c => { const at = c.__at(250.4217, 36.4613), off = c.__at(250.4217, 36.4613 + 1); return c.__ring.r / Math.hypot(off[0] - at[0], off[1] - at[1]) * 2; });
    assert.ok(Math.abs(deg - 6.5) < 0.05, 'the finder chart’s circle is the binoculars’ field: ' + deg);
    await page.click('#sheet [data-close]');
    for (const [id, re] of [['albireo', /34\.3″ apart, a split in your binoculars \(10×\)\./], ['nudra', /an easy split in your binoculars/], ['mizar', /14\.4″ pair takes about 20×; your binoculars give 10×, so it needs a telescope\./]]) {
      await openCard(page, id);
      assert.match(await text(page, '#sheet'), re, id);
      await page.click('#sheet [data-close]');
    }
    // and back to a telescope: its fields come back as they were
    await page.click('#scopeBtn');
    await page.click('#inOpts [data-n="scope"]');
    assert.equal(await page.inputValue('#scFl'), '650');
    assert.equal(await page.isVisible('#epl'), true);
    assert.deepEqual([await page.inputValue('#scName'), await page.inputValue('#scAp')], ['', '130'], 'the binoculars’ name and aperture stay with them');
    await page.click('#inOpts [data-n="bino"]');
    assert.deepEqual([await page.inputValue('#scName'), await page.inputValue('#scAp')], ['10×50 binoculars', '50'], 'and come back with them');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A damaged binocular save opens with the example telescope.
check('A saved pair of binoculars that can’t be read opens with the example telescope', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: { kind: 'bino', name: 'Odd', ap: 50, mag: 'ten', fov: 6.5, set: true } }), time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'M13');
    assert.match(await text(page, '#sheet'), /IN YOUR TELESCOPE/i);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A step across the eyepiece sketch as a position angle, from north through east, by where its N and E point.
const paOf = (page, a, b) => page.$eval('#eyepiece', (c, [a, b]) => { const f = c.__frame, d = [b[0] - a[0], b[1] - a[1]]; return Math.atan2(d[0] * f.e[0] + d[1] * f.e[1], d[0] * f.n[0] + d[1] * f.n[1]) * 180 / Math.PI; }, [a, b]);
check('Albireo’s companion is drawn to the northeast', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  const pair = () => page.waitForFunction(() => document.getElementById('eyepiece').__pair?.b && document.getElementById('eyepiece').__pair).then(h => h.jsonValue());
  try {
    await openCard(page, 'albireo');
    let { a, b } = await pair();
    const { w, h } = await page.$eval('#eyepiece', c => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert.deepEqual([Math.round(a[0]), Math.round(a[1])], [Math.round(w / 2), Math.round(h / 2)], 'Albireo A is at the centre');
    const pa = await paOf(page, a, b);
    assert.ok(Math.abs(pa - 54) < 1, 'at position angle 54°: ' + pa);
    assert.ok(b[2] < a[2], 'B, 1.5 magnitudes fainter, is drawn smaller');
    await page.click('#sheet [data-close]');
    await openCard(page, 'mesarthim');
    ({ a, b } = await pair());
    assert.ok(Math.abs((await paOf(page, a, b) + 360) % 360 - 359) < 1, 'Mesarthim’s pair lies north–south');
    assert.ok(b[2] / a[2] > 0.95, 'and is drawn matched');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// h and χ Persei were two rows, "Double Cluster (h Persei)" and its twin scored to the foot of the list, with their
// halves only 0.2° apart on the map (dsos.bright.json has NGC 884 at RA 35.13° for 35.60°). It's one sight, so one row.
check('The Double Cluster is one row with both its numbers, and its sketch shows its two clusters side by side', async () => {
  const { dso } = JSON.parse(await readFile(join(root, 'data/dso.json'), 'utf8'));
  assert.deepEqual(dso.filter(d => /NGC 8(69|84)/.test(d.cat)).map(d => d.id), ['NGC 869'], 'one entry in the data');
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const rows = await targetRows(page);
    assert.deepEqual(rows.filter(r => /NGC 8(69|84)/.test(r.id)).map(r => r.id), ['NGC 869'], 'one row');
    assert.equal(await page.$eval('#targetSec .row[data-id="NGC 869"] .nm', n => n.textContent), 'Double Cluster NGC 869 and NGC 884');
    await openCard(page, 'NGC 869');
    assert.equal(await text(page, '#sheet .hd h2 small'), 'Open cluster in Perseus · NGC 869 and NGC 884');
    const groups = await page.waitForFunction(() => document.getElementById('eyepiece').__groups).then(h => h.jsonValue());
    const w = await page.$eval('#eyepiece', c => c.getBoundingClientRect().width);
    assert.equal(groups.length, 2, 'two clusters drawn');
    const [h, chi] = groups, f = await page.$eval('#eyepiece', c => c.__frame), d = [chi[0] - h[0], chi[1] - h[1]];
    const east = d[0] * f.e[0] + d[1] * f.e[1], north = d[0] * f.n[0] + d[1] * f.n[1];
    assert.ok(east > 0, 'χ Persei is drawn to the east');
    assert.ok(Math.abs(north) < 0.1 * east, 'side by side, east and west');
    const hh = await page.$eval('#eyepiece', c => c.getBoundingClientRect().height);
    assert.ok(Math.hypot((h[0] + chi[0]) / 2 - w / 2, (h[1] + chi[1]) / 2 - hh / 2) < 2, 'either side of the centre');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Taps an object on the sky map: a planet by name, or a star by its index in data/stars.json.
const tapMap = async (page, k, id) => {
  // The map draws a moment after the page is ready, so wait for the object to be on it.
  const hit = await page.waitForFunction(([k, id]) => document.getElementById('sky').__hits().find(h => h.obj.k === k && (h.obj.id === id || h.obj.i === id)), [k, id], { timeout: 10000 })
    .then(h => h.jsonValue(), () => null);
  assert.ok(hit, `${k} ${id} is on the map`);
  const box = await page.locator('#sky').boundingBox();
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
};
// Taps the middle of a label on the sky map and returns the title of the card it opens.
const tapLabel = async (page, t) => {
  const l = await page.waitForFunction(t => document.getElementById('sky').__labels().find(l => l.t === t), t, { timeout: 10000 }).then(h => h.jsonValue(), () => null);
  assert.ok(l, `"${t}" is labelled on the map`);
  const box = await page.locator('#sky').boundingBox();
  await page.mouse.click(box.x + l.x + l.w / 2, box.y + l.y + l.h / 2);
  await page.waitForFunction(() => !document.getElementById('sheet').hidden);
  const title = await page.$eval('#sheet .hd h2', h => h.firstChild.textContent);
  await page.click('#sheet [data-close]');
  return title;
};

// Labels weren't tap targets, and a tap was scored only by distance, so the middle of "Saturn" opened γ Psc and "Vega"
// ν Her. A tap 10 px below Capella opened Almaaz, and an unnamed star's card was titled just "Star".
check('tapping a name on the map opens that object', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' }), { n, s: cat } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8'));
  try {
    for (const t of ['Saturn', 'Vega', 'Capella', 'Altair', 'Deneb', 'Moon']) assert.equal(await tapLabel(page, t), t === 'Moon' ? 'The Moon' : t, `tapping the label "${t}"`);
    // A tap between a bright star and a faint one 9 to 16 px away, a little nearer the faint one but not on it, picks the bright one.
    const box = await page.locator('#sky').boundingBox(), hits = await page.$eval('#sky', c => c.__hits());
    const stars = hits.filter(h => h.obj.k === 'star').map(h => Object.assign(h, { mag: cat[h.obj.i * 4 + 2] })), pairs = [];
    for (const a of stars.filter(h => h.mag < 1.5)) for (const b of stars.filter(h => h.mag > 3.5)) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 9 && d < 16) pairs.push([a, b, d]); }
    assert.ok(pairs.length >= 3, 'bright stars with faint neighbours on the map');
    for (const [a, b, d] of pairs.slice(0, 5)) {
      const f = Math.min(0.6, (d - 4.5) / d), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      if (stars.some(h => h !== a && Math.hypot(h.x - x, h.y - y) < Math.max(4.5, h.r - 5))) continue; // right on another star
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForFunction(() => !document.getElementById('sheet').hidden);
      assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), n[a.obj.i][0], `a tap ${(d * f).toFixed(1)} px from ${n[a.obj.i][0]} toward a fainter star`);
      await page.click('#sheet [data-close]');
    }
    // deep-sky objects beside bright stars still open with a tap on their marks
    for (const id of ['M57', 'M45']) {
      await tapMap(page, 'dso', id);
      assert.match(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), new RegExp(id + '$'), 'a tap on ' + id);
      await page.click('#sheet [data-close]');
    }
    // a star with no name or label in the data
    const bare = hits.find(h => h.obj.k === 'star' && !(n[h.obj.i] && (n[h.obj.i][0] || n[h.obj.i][1])));
    assert.ok(bare, 'a star with no name is on the map');
    await page.mouse.click(box.x + bare.x, box.y + bare.y);
    await page.waitForFunction(() => !document.getElementById('sheet').hidden);
    assert.match(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), /^A magnitude \d\.\d star$/, 'an unnamed star’s card');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('Scrolling the map zooms it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  try {
    const box = await page.locator('#sky').boundingBox(), cx = box.width / 2, cy = box.height / 2;
    // the two stars nearest the middle, and how far apart they're drawn
    const stars = () => page.$eval('#sky', c => c.__hits().filter(h => h.obj.k === 'star').map(h => ({ i: h.obj.i, x: h.x, y: h.y })));
    const before = (await stars()).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, 2);
    const apart = list => { const [a, b] = before.map(s => list.find(h => h.i === s.i)); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null; };
    const d0 = apart(before);
    await page.mouse.move(box.x + cx, box.y + cy);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction(n => document.getElementById('sky').__hits().filter(h => h.obj.k === 'star').length !== n, (await stars()).length, { timeout: 5000 }).catch(() => {});
    const d1 = apart(await stars());
    assert.ok(d1 > d0 * 1.5, `scrolling up zooms in: two stars ${d0.toFixed(0)} px apart are ${d1 && d1.toFixed(0)} px apart`);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    assert.ok(Math.abs(apart(await stars()) - d0) < 2, 'and scrolling back down zooms out again');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('The Show panel turns the map’s layers off and on', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  const names = () => page.$eval('#sky', c => c.__labels().filter(l => l.obj && (l.obj.k === 'star' || l.obj.k === 'dso') || /\u200a/.test(l.t)).length);
  const dsos = () => page.$eval('#sky', c => c.__hits().filter(h => h.obj.k === 'dso').length);
  try {
    assert.ok(await names() > 5 && await dsos() > 3, 'names and deep-sky objects to begin with');
    await page.click('#layBtn');
    await page.uncheck('#ly_names');
    await page.waitForFunction(() => !document.getElementById('sky').__labels().some(l => l.obj && l.obj.k === 'star'));
    assert.equal(await names(), 0, 'Names off: no star, deep-sky or constellation names');
    await page.uncheck('#ly_dso');
    await page.waitForFunction(() => !document.getElementById('sky').__hits().some(h => h.obj.k === 'dso'));
    await page.check('#ly_names');
    await page.check('#ly_dso');
    await page.waitForFunction(() => document.getElementById('sky').__hits().some(h => h.obj.k === 'dso'));
    assert.ok(await names() > 5, 'and back on');
    await page.check('#ly_grid');
    await page.uncheck('#ly_names');
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => document.getElementById('sky').__labels().length > 0);
    assert.equal(await names(), 0, 'what the map shows is remembered');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).layers), { lines: true, names: false, dso: true, mw: true, grid: true });
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const starIndex = async name => { const n = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).n; return +Object.keys(n).find(i => n[i][0] === name); };
const starAt = async (ra, dec) => { const s = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')).s; for (let i = 0; i < s.length / 4; i++) if (s[i * 4] === ra && s[i * 4 + 1] === dec) return i; };

check('a star card says a star stays a point, not how wide it is', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await tapMap(page, 'star', await starIndex('Vega'));
    assert.match(await text(page, '#sheet .hd h2'), /^Vega/);
    assert.equal(await advice(page), 'A star stays a point at any power. The 25 mm (2.0° field) shows it with the stars around it.');
  } finally { await ctx.close(); }
});

// d3-celestial calls ξ Sco only "Grafias", a name it also gives ζ2 Sco, so dropping that name left its card saying just "Star".
check('ξ Sco’s card names it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-06-15T23:00:00-05:00' });
  try {
    await tapMap(page, 'star', await starAt(241.09, -11.37));
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'ξ Sco');
    assert.equal(await text(page, '#sheet .hd h2 small'), 'Star · ξ Sco · in Scorpius');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Mira swings between magnitude 2.0 and 10.1 over 332 days (General Catalogue of Variable Stars). d3-celestial's average
// magnitude, 6.47, left it out of the star list, so Cetus's line bent at an empty point with nothing to tap.
check('Mira ends Cetus’s line as a star you can tap, and its card says it fades', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')), i = await starAt(34.84, -2.98);
  assert.deepEqual(n[i], ['Mira', 'ο Cet', 'Cet']);
  assert.equal(s[i * 4 + 2], 3.5, 'drawn near its usual peak');
  assert.equal(i, s.length / 4 - 1, 'at the end of the list, where it moves no other star');
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await tapMap(page, 'star', i);
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Mira');
    assert.equal(await text(page, '#sheet .hd h2 small'), 'Variable star · ο Cet · in Cetus');
    assert.match(await text(page, '#sheet .kv'), /mag 3\.5 to 9/);
    assert.match(await text(page, '#sheet .bd'), /fades to about magnitude 9 and back over 11 months, so on many nights it isn’t there to see/);
    await page.click('#cardDone');
    // a star that is often too faint to see isn't one to hop from, though M77 is only 6.5° from it
    await openCard(page, 'M77');
    assert.doesNotMatch(await hopCap(page), /Mira/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The card's italic headline set '24 °' with IM Fell's degree sign well apart from its number, ξ Sco's Greek letter fell
// out of the italic, words such as 'Easy' and 'Not tonight' were in DM Mono, Saturn was '1301 million km', and on a
// German phone the Moon was '399.799 km'.
check('Cards keep the degree sign with its number, words in the body face and distances the same in any language', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', locale: 'de-DE' });
  try {
    const face = (sel) => page.$eval(sel, el => { const s = getComputedStyle(el); return s.fontFamily + ' ' + s.fontStyle; });
    assert.match(await face('#tonightSec .fact.wide b'), /DM Mono/, 'fully dark is a time');
    await openCard(page, 'Saturn');
    assert.match(await text(page, '#sheet .big .num'), /^\d+°$/, 'the altitude and its degree sign go together');
    assert.match(await face('#sheet .big .num'), /Atkinson.* normal$/);
    assert.match(await text(page, '#sheet .kv'), /Distance 1,\d{3} million km/i);
    await page.click('#sheet [data-close]');
    await openCard(page, 'Moon');
    assert.match(await text(page, '#sheet .kv'), /Distance \d{3},\d{3} km/i);
    await page.click('#sheet [data-close]');
    await openCard(page, 'M31');
    const diff = await page.$$eval('#sheet .kv div', ds => ds.map(d => [d.firstChild.textContent, d.lastChild.className, getComputedStyle(d.lastChild).fontFamily]));
    for (const [k, cls, f] of diff) assert.ok(k === 'Difficulty' ? cls === 'w' && /Atkinson/.test(f) : /DM Mono/.test(f), `${k} is in ${f}`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  const sco = await open({ time: '2026-06-15T23:00:00-05:00' });
  try {
    await tapMap(sco.page, 'star', await starAt(241.09, -11.37));
    assert.equal(await sco.page.$eval('#sheet .hd h2 .gk', e => e.textContent + ' ' + getComputedStyle(e).fontStyle), 'ξ normal', 'ξ Sco’s letter is upright');
    assert.equal(await sco.page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'ξ Sco');
    assert.deepEqual(sco.problems, []);
  } finally { await sco.ctx.close(); }
});

// Astronomy Engine: full at 14:54 UT on 24 Nov 2026; at 9 pm in Austin that evening the Moon is 99.5% lit, but it was
// called "Waning gibbous", and its card said to look along the terminator, which there isn't.
check('the Full Moon date says Full Moon', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-24T21:00:00-06:00' });
  try {
    assert.match(await text(page, '#tonightSec .moonrow b'), /^Full Moon · \d+% lit$/);
    await openCard(page, 'Moon');
    assert.match(await text(page, '#sheet .hd h2 small'), /^Full Moon · /);
    const tip = await advice(page);
    assert.match(tip, /Tycho/, 'the card says what to look at near full');
    assert.doesNotMatch(tip, /terminator/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// 7 pm on 17 Nov 2026 in Austin, the Moon 56% lit: the Sun's colongitude (how far the morning terminator has moved
// west of the Moon's middle) is 12.6°, so it is rising over Plato (9.4° W) and the Straight Wall (7.8° W). Before
// dawn on the 28th, the Moon waning, it is setting over Posidonius (29.9° E) and Fracastorius (33.2° E).
check('The Moon card names the sights on the terminator at the time shown', async () => {
  const sights = page => page.$$eval('#sheet .sights li b', bs => bs.map(b => b.textContent));
  const { ctx, page, problems } = await open({ time: '2026-11-17T19:00:00-06:00', phone: false });
  try {
    await openCard(page, 'Moon');
    assert.match(await text(page, '#sheet'), /ON THE TERMINATOR The Sun is rising over these, north to south, and their shadows are long:/);
    assert.deepEqual(await sights(page), ['Plato', 'Pico', 'The Straight Wall', 'Tycho', 'Clavius']);
    assert.match(await text(page, '#sheet .sights'), /^Plato, a dark, flat-floored crater/);
    // two hours on, at 9 pm, the terminator has moved a degree west: Pitatus has come into the low Sun, and the Sun is
    // higher over the Straight Wall
    await page.focus('#tlc');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 9:00 pm', null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await sights(page), ['Plato', 'Pico', 'Pitatus', 'Tycho', 'Clavius'], 'the card follows the time');
    await page.click('#nextN'); await page.click('#nextN'); await page.click('#nextN');
    await page.waitForFunction(() => /Nov 20/.test(document.querySelector('#nightTitle').textContent), null, { timeout: 5000 }).catch(() => {});
    assert.ok(!(await sights(page)).includes('Plato'), 'three nights on, the terminator has moved past Plato');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  const b = await open({ time: '2026-11-28T05:00:00-06:00' });
  try {
    await openCard(b.page, 'Moon');
    assert.match(await text(b.page, '#sheet'), /The Sun is setting over these/);
    const s = await sights(b.page);
    assert.ok(s.includes('Posidonius') && s.includes('Fracastorius'), s.join(', '));
    assert.deepEqual(b.problems, []);
  } finally { await b.ctx.close(); }
});

// Meeus, Astronomical Algorithms (2nd ed., 1998), Example 53.b: at 0h TD on 12 April 1992 the Sun is overhead on the
// Moon at selenographic longitude 67.89° and latitude 1.46°, a colongitude of 22.11°.
check('The Moon’s frame puts the Sun where Meeus does', async () => {
  hooked = true;
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const s = await page.evaluate(() => window.__sunOnMoon('1992-04-12T00:00:00Z'));
    assert.ok(Math.abs(s.lon - 67.89) < 0.05 && Math.abs(s.lat - 1.46) < 0.05 && Math.abs(s.colongitude - 22.11) < 0.05, JSON.stringify(s));
    assert.deepEqual(problems, []);
  } finally { hooked = false; await ctx.close(); }
});

check('the Moon card says the whole Moon fits only when it does', async () => {
  const c11 = { name: 'C11', ap: 280, fl: 2800, eps: [{ f: 25, a: 52 }, { f: 12, a: 52 }], set: true };
  let { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: c11 }), time: '2026-10-18T20:00:00-05:00' });
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The Moon \(30\.0′ across\) is wider than your lowest-power field \(28′\), so even the 25 mm shows part of it at a time\. At 233× with the 12 mm,/);
  } finally { await ctx.close(); }
  ({ ctx, page } = await open({ time: '2026-10-18T20:00:00-05:00' }));
  try {
    await openCard(page, 'Moon');
    assert.match(await advice(page), /^The whole Moon fits in the 25 mm eyepiece \(2\.0° field\)\./);
  } finally { await ctx.close(); }
});

check('a star marked as seen stays marked after a reload', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'albireo');
    await page.click('#seenB');
    assert.equal(await text(page, '#seenB'), '✓ Seen Tue, Oct 13', 'the card says when');
    await page.click('#sheet [data-close]');
    const seen = () => page.$eval('#targetSec .row[data-id="albireo"]', r => !!r.querySelector('.seen'));
    assert.ok(await seen(), 'the list marks it');
    await page.reload();
    await ready(page);
    if (!await page.$('#targetSec .row[data-id="albireo"]')) await page.click('#moreT');
    assert.ok(await seen(), 'the list still marks it after a reload');
    await openCard(page, 'albireo');
    assert.equal(await text(page, '#seenB'), '✓ Seen Tue, Oct 13', 'and so does the card');
    await page.click('#seenB');
    assert.equal(await text(page, '#seenB'), 'Mark as seen', 'a second tap takes the mark off');
    assert.equal(await text(page, '#toast'), 'No longer marked as seen', 'and says so');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A seen mark only put a small tick on a row: there was no way to list what's still to see, or to see how far along
// you are (a Messier marathon is all 110).
check('Not seen yet hides what you’ve marked, and a line counts what you’ve seen', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T20:30:00-06:00' });
  try {
    assert.equal(await page.$('#targetSec .tally'), null, 'no count before anything is marked');
    assert.deepEqual(await page.$$eval('#targetSec .filters button', b => b.map(x => x.textContent)), ['All', 'Moon & planets', 'Clusters', 'Nebulae', 'Galaxies', 'Double stars', 'Not seen yet', 'Your plan']);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, seen: { M31: '2026-11-14', M45: '2026-11-14', albireo: '2026-10-13' } }), time: '2026-11-15T20:30:00-06:00' }));
  try {
    const ids = () => page.$$eval('#targetSec .row', r => r.map(x => x.dataset.id));
    assert.equal(await text(page, '#targetSec .tally'), 'You’ve marked 3 objects as seen, 2 of the 110 Messier objects. Open your log');
    const count = () => page.$eval('#targetSec h2 small', e => e.textContent), all = parseInt(await count());
    await page.click('#targetSec [data-f="unseen"]');
    assert.equal(await page.$eval('#targetSec [data-f="unseen"]', b => b.getAttribute('aria-pressed')), 'true');
    if (await page.$('#moreT')) await page.click('#moreT');
    const left = await ids();
    for (const id of ['M31', 'M45', 'albireo', 'Moon']) assert.ok(!left.includes(id), id + ' is left out');
    assert.ok(left.includes('Jupiter') && left.includes('M15'), 'what you haven’t seen stays');
    assert.equal(await count(), (all - 4) + ' targets', 'and the count above the list says how many (the Moon is up)');
    // marking one from its card takes it off the list and adds it to the count
    await openCard(page, 'M15');
    await page.click('#seenB');
    await page.click('#sheet [data-close]');
    assert.ok(!(await ids()).includes('M15'), 'a mark takes it off');
    assert.equal(await text(page, '#targetSec .tally'), 'You’ve marked 4 objects as seen, 3 of the 110 Messier objects. Open your log');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Mark as seen kept only the night. An observing log keeps what the Astronomical League's Messier Program asks for
// (Rule 1, astroleague.org/?p=8432): date and time, latitude and longitude, seeing and transparency, aperture, power
// and a description.
check('Mark as seen keeps an observing log, with a note and ratings, that copies as text and downloads as CSV', async () => {
  const init = () => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.copied = t; return Promise.resolve(); } } }); };
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', init });
  try {
    await openCard(page, 'M15');
    assert.equal(await page.$('#sheet .logc'), null, 'nothing in the log for it yet');
    await page.click('#seenB');
    assert.match(await text(page, '#sheet .logc p'), /^Seen at 9:0\d pm · Austin, TX · 130 mm reflector at 65× \(10 mm\)$/, 'the card says when, where and with what');
    await page.fill('#sheet .lgNote', 'Tight core, "grainy" edges at 26×');
    await page.click('#sheet [data-r="seeing"][data-v="3"]');
    await page.click('#sheet [data-r="transp"][data-v="4"]');
    await page.click('#sheet [data-r="transp"][data-v="5"]');
    assert.deepEqual(await page.$$eval('#sheet [data-r].on', b => b.map(x => x.dataset.r + x.dataset.v)), ['seeing3', 'transp5'], 'one rating each, the last tapped');
    const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).log[0]);
    assert.match(entry.t, /^2026-11-16T03:0\d:/);
    delete entry.t;
    assert.deepEqual(entry, { id: 'M15', night: '2026-11-15', name: 'M15', scope: '130 mm reflector', ap: 130, place: 'Austin, TX', lat: 30.27, lon: -97.74, tz: 'America/Chicago', power: 65, ep: '10 mm', note: 'Tight core, "grainy" edges at 26×', seeing: 3, transp: 5 });
    await page.reload(); await ready(page);
    await openCard(page, 'M15');
    assert.equal(await page.$eval('#sheet .lgNote', t => t.value), 'Tight core, "grainy" edges at 26×', 'the note is kept');
    assert.deepEqual(await page.$$eval('#sheet [data-r].on', b => b.map(x => x.dataset.r + x.dataset.v)), ['seeing3', 'transp5'], 'and the ratings');
    await page.click('#openLog');
    assert.equal(await text(page, '#sheet .hd h2'), 'Your log 1 entry, newest first', 'the card opens the log');
    await page.click('#sheet [data-close]');
    // a second entry, on Albireo, and the log from the line under the list, newest first
    await openCard(page, 'albireo');
    await page.click('#seenB');
    await page.click('#sheet [data-close]');
    await page.click('#logBtn');
    assert.equal(await text(page, '#sheet .hd h2'), 'Your log 2 entries, newest first');
    assert.deepEqual(await page.$$eval('#sheet .lge summary b', b => b.map(x => x.textContent)), ['Albireo', 'M15']);
    await page.click('#logCopy');
    const txt = await page.evaluate(() => window.copied);
    assert.match(txt, /^Starhop observing log\n\nAlbireo\nSun, Nov 15, 2026, 9:0\d pm \(UTC−6\) · Austin, TX \(30\.27° N, 97\.74° W\)\n130 mm reflector, 130 mm aperture, 26× with the 25 mm\n\nM15\n.*\n130 mm reflector, 130 mm aperture, 65× with the 10 mm\n/);
    assert.match(txt, /\nSeeing 3 of 5 · Transparency 5 of 5\nTight core, "grainy" edges at 26×\n$/);
    assert.equal(await text(page, '#toast'), 'Copied your log');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#logCsv')]);
    assert.equal(dl.suggestedFilename(), 'starhop-log-2026-11-15.csv');
    const csv = await readFile(await dl.path(), 'utf8');
    const lines = csv.split('\r\n');
    assert.equal(lines[0], '\ufeffObject,Night of,Date,Time,UTC offset,Place,Latitude,Longitude,Seeing (1-5),Transparency (1-5),Instrument,Aperture (mm),Power,Eyepiece,Description');
    assert.match(lines[2], /^M15,2026-11-15,2026-11-15,21:0\d,UTC-06:00,"Austin, TX",30\.27,-97\.74,3,5,130 mm reflector,130,65,10 mm,"Tight core, ""grainy"" edges at 26×"$/);
    assert.equal(lines.length, 4, 'a row for each entry');
    // an entry taken out of the log is gone from the list's count too
    await page.click('#sheet .lge summary');
    await page.click('#sheet [data-del]');
    assert.equal(await text(page, '#sheet .hd h2'), 'Your log 1 entry, newest first');
    assert.equal(await text(page, '#targetSec .tally'), 'You’ve marked 1 object as seen, 1 of the 110 Messier objects. Open your log');
    await page.click('#sheet .lge summary');
    await page.click('#sheet [data-del]');
    assert.equal(await text(page, '#sheet .hd h2'), 'Your log Nothing in it yet');
    assert.equal(await page.$('#targetSec .tally'), null);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Everyone has seen the Moon, so its card offered a mark that only left a tick on the top row of every night's list.
check('The Moon has no seen mark, and the planets keep theirs', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, seen: { Moon: '2026-10-17' } }), time: '2026-10-18T20:00:00-05:00' });
  try {
    assert.equal(await page.$eval('#targetSec .row[data-id="Moon"]', r => !!r.querySelector('.tick, .seen')), false, 'a mark saved for it doesn’t show in the list');
    await openCard(page, 'Moon');
    assert.equal(await page.$('#seenB'), null, 'its card has no Mark as seen');
    assert.equal(await text(page, '#sheet .btnrow'), 'Show in the sky view Add to plan', 'no Mark as seen, though it can go in a plan');
    await page.click('#sheet [data-close]');
    await openCard(page, 'Saturn');
    assert.equal(await text(page, '#seenB'), 'Mark as seen', 'a planet’s card still has it');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Observers date a night by its evening, but a mark at 1 am was saved as the next day's date, and without a year.
check('A star seen at 1 am is dated by the night, with its year', async () => {
  const seen = page => page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).log.map(e => e.id + ' ' + e.night));
  const tag = (page, id) => page.$eval(`#targetSec .row[data-id="${id}"] .seen`, t => t.textContent);
  let { ctx, page, problems } = await open({ time: '2026-11-16T01:00:00-06:00' });
  try {
    await openCard(page, 'M45');
    await page.click('#seenB');
    assert.deepEqual(await seen(page), ['M45 2026-11-15'], 'saved under the night it began');
    assert.equal(await text(page, '#seenB'), '✓ Seen Sun, Nov 15');
    await page.click('#sheet [data-close]');
    assert.equal(await tag(page, 'M45'), 'Seen Sun, Nov 15', 'the list says so too');
    // a mark made while looking back at an earlier night goes under that night, as a second entry
    await page.click('#prevN');
    await openCard(page, 'M45');
    assert.equal(await text(page, '#seenB'), 'Mark as seen again', 'seen on another night, it can be marked again');
    await page.click('#seenB');
    assert.deepEqual(await seen(page), ['M45 2026-11-15', 'M45 2026-11-14']);
    assert.equal(await text(page, '#seenB'), '✓ Seen Sat, Nov 14');
    assert.match(await text(page, '#sheet .logc'), /Also seen Sun, Nov 15\./, 'and the card lists the other night');
    await page.click('#sheet [data-close]');
    // and one made while planning a night still to come goes under tonight, since it can't have been seen yet
    await page.click('#nextN'); await page.click('#nextN');
    await openCard(page, 'M45');
    assert.equal(await text(page, '#seenB'), '✓ Seen Sun, Nov 15');
    await page.click('#seenB');
    assert.deepEqual(await seen(page), ['M45 2026-11-14'], 'a second tap takes out only that night’s entry');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // marks saved before there was a log come in as entries with only their night
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, seen: { M31: '2026-11-15', M45: 'Aug 2', M57: 7 } }), time: '2027-11-14T20:30:00-06:00' }));
  try {
    await openCard(page, 'M31');
    assert.equal(await text(page, '#seenB'), 'Mark as seen again');
    assert.equal(await text(page, '#sheet .logc p'), 'Seen Sun, Nov 15, 2026.', 'another year’s mark gives its year');
    await page.click('#sheet [data-close]');
    assert.equal(await tag(page, 'M31'), 'Seen Sun, Nov 15, 2026');
    await openCard(page, 'M45');
    assert.equal(await text(page, '#sheet .logc p'), 'Seen Aug 2.', 'a mark saved some other way shows as it is');
    await page.click('#sheet [data-close]');
    await openCard(page, 'M57');
    assert.equal(await text(page, '#seenB'), 'Mark as seen', 'a mark that isn’t a date or text is dropped');
    assert.equal(await page.$('#sheet .logc'), null);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('a sheet takes the keyboard focus, has a name, and gives the focus back', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  const focusIn = sel => page.evaluate(s => document.querySelector(s).contains(document.activeElement), sel);
  try {
    const row = page.locator('#targetSec .row').first(), id = await row.getAttribute('data-id');
    await row.focus();
    await page.keyboard.press('Enter');
    assert.ok(await sheetOpen(page));
    assert.ok(await focusIn('#sheet'), 'the focus moves into the card');
    const title = await page.$eval('#sheet .hd h2', h => h.firstChild.textContent);
    assert.equal(await page.getByRole('dialog', { name: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).count(), 1, 'the card is named by its title');
    await page.keyboard.press('Tab');
    assert.ok(await focusIn('#sheet'), 'Tab stays in the card');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id, 'closing gives the focus back to the row');
    assert.equal(await page.getByRole('button', { name: 'Location: Austin, TX' }).count(), 1, 'the location button is named with the place it shows');
  } finally { await ctx.close(); }
});

// The WAI-ARIA Authoring Practices' slider pattern: Home and End go to the ends, Page Up and Page Down take bigger steps.
check('The timeline is a slider the keyboard can move from end to end', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  const state = () => page.$eval('#tlc', c => ({ now: +c.getAttribute('aria-valuenow'), max: +c.getAttribute('aria-valuemax'), min: +c.getAttribute('aria-valuemin'), text: c.getAttribute('aria-valuetext'), when: document.getElementById('when').firstChild.textContent }));
  const press = async k => { await page.keyboard.press(k); await page.waitForTimeout(80); return state(); };
  try {
    const tl = page.getByRole('slider', { name: /^The night from sunset to sunrise\. Drag, or use the arrow keys,/ });
    assert.equal(await tl.count(), 1, 'the timeline is a named slider');
    await tl.focus();
    const s0 = await state();
    assert.equal(s0.min, 0);
    assert.ok(s0.max > 600 && s0.max < 1000, 'its range is the night in minutes: ' + s0.max);
    assert.match(s0.text, /^9:00 pm, (fully dark|twilight), Moon (up|down)$/, 'its value is said in words: ' + s0.text);
    const home = await press('Home');
    assert.equal(home.now, 0, 'Home goes to the start of the night');
    assert.match(home.text, /^\d+:\d\d pm, the Sun up, Moon (up|down)$/, 'which is before sunset: ' + home.text);
    assert.equal(home.text.split(',')[0], home.when, 'the slider and the map show the same time');
    const end = await press('End');
    assert.equal(end.now, end.max, 'End goes to the end of the night');
    assert.match(end.text, /^\d+:\d\d am, the Sun up/, 'after sunrise: ' + end.text);
    assert.equal(end.text.split(',')[0], end.when);
    assert.equal((await press('PageDown')).now, end.max - 60, 'Page Down goes an hour earlier');
    assert.equal((await press('Shift+ArrowLeft')).now, end.max - 65, 'Shift and an arrow go five minutes');
    assert.equal((await press('ArrowLeft')).now, end.max - 80, 'an arrow goes a quarter hour');
    await press('Home');
    const up = await press('PageUp');
    assert.equal(up.now, 60, 'Page Up goes an hour later');
    assert.notEqual(up.text, home.text, 'and the words change with it');
    for (let i = 0; i < 6; i++) await press('PageUp');
    assert.match((await state()).text, /fully dark/, 'seven hours after the start it is fully dark');
  } finally { await ctx.close(); }
});

// The list, the direction buttons and the town results clip what lies outside them, so a focus ring drawn outside the
// element showed as a stray line; the map's box hid its ring altogether.
check('A focused row’s ring lies inside the list', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  // where the ring's outer edge falls, and the box that clips it
  const ring = sel => page.evaluate(s => {
    const el = document.activeElement, cs = getComputedStyle(el), o = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth), r = el.getBoundingClientRect();
    const box = el.closest(s), b = box.getBoundingClientRect(), bw = parseFloat(getComputedStyle(box).borderTopWidth);
    return { visible: el.matches(':focus-visible') && cs.outlineStyle !== 'none', inside: r.left - o >= b.left + bw - 0.5 && r.right + o <= b.right - bw + 0.5 && r.top - o >= b.top + bw - 0.5 && r.bottom + o <= b.bottom - bw + 0.5, colour: cs.outlineColor, bg: cs.backgroundColor };
  }, sel);
  try {
    for (const which of ['first', 'last']) {
      await page.locator('#targetSec .row')[which]().focus();
      const r = await ring('.list');
      assert.ok(r.visible, 'the ' + which + ' row shows a focus ring');
      assert.ok(r.inside, 'the ' + which + ' row’s ring lies inside the list');
    }
    await page.locator('#sky').focus();
    const sky = await ring('.skybox');
    assert.ok(sky.visible && sky.inside, 'the sky map’s ring lies inside its box');
    await page.locator('#eventSec .ev').first().waitFor();
    await page.locator('#eventSec .ev').first().focus();
    assert.ok((await ring('.list')).inside, 'a Coming up row’s ring lies inside its list');
    for (const d of ['up', '0', '270']) {
      await page.locator(`#dirSeg button[data-d="${d}"]`).focus();
      const r = await ring('.seg');
      assert.ok(r.visible && r.inside, 'the ' + d + ' direction button’s ring lies inside the bar');
    }
    await page.locator('#dirSeg button[data-d="0"]').focus();
    await page.keyboard.press('Enter');
    const on = await ring('.seg');
    assert.ok(on.visible && await page.$eval('#dirSeg button[data-d="0"]', b => b.classList.contains('on')), 'North is chosen and keeps its ring');
    assert.notEqual(on.colour, on.bg, 'the chosen direction’s ring shows against its fill');
    await page.click('#locBtn');
    await page.waitForFunction(() => document.activeElement.id === 'lq'); // the sheet puts the focus in the search
    await page.keyboard.type('San');
    await page.locator('#lres button').first().waitFor();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('#lres button')), 'Tab goes from the search to its first result');
    const res = await ring('.res');
    assert.ok(res.visible && res.inside, 'a town result’s ring lies inside the results');
  } finally { await ctx.close(); }
});

// Redrawing the list used to drop the focus to the page itself, so a screen reader started again from the top.
check('A filter chip keeps the focus after it filters the list', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  const active = () => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, f: a.dataset.f || '', text: a.textContent }; });
  try {
    await page.locator('#targetSec [data-f="cluster"]').focus();
    await page.keyboard.press('Enter');
    assert.match(await page.$eval('#targetSec h2', h => h.textContent), /^What to look at \d+ targets?$/);
    assert.equal(await page.$eval('#targetSec [data-f="cluster"]', b => b.classList.contains('on')), true, 'Clusters is chosen');
    assert.equal((await active()).f, 'cluster', 'the focus stays on Clusters');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    assert.equal((await active()).f, 'all', 'and on All');
    await page.locator('#moreT').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual([(await active()).id, (await active()).text], ['moreT', 'Show fewer'], 'Show all keeps the focus, and says Show fewer');
    await page.keyboard.press('Enter');
    assert.match((await active()).text, /^Show all \d+$/, 'and Show fewer');
    // the Show menu hands the focus back to its button when it closes
    await page.locator('#layBtn').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal((await active()).id, 'ly_lines', 'Tab goes into the Show menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#layers', l => l.hidden), true, 'Escape closes it');
    assert.equal((await active()).id, 'layBtn', 'and the focus goes back to Show');
    await page.keyboard.press('Enter');
    await page.locator('#lyDone').focus();
    await page.keyboard.press('Enter');
    assert.equal((await active()).id, 'layBtn', 'Done hands it back too');
  } finally { await ctx.close(); }
});

// What changes out of sight of the focus is said through one polite live region, which screen readers read out.
check('Stepping a night is announced', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  const said = re => page.waitForFunction(src => new RegExp(src).test(document.getElementById('say').textContent), re.source, { timeout: 5000 }).then(() => true, () => false);
  const label = id => page.$eval('#' + id, b => b.getAttribute('aria-label'));
  try {
    assert.equal(await page.$eval('#say', el => el.getAttribute('aria-live')), 'polite');
    assert.ok(await page.$eval('#say', el => el.getBoundingClientRect().width <= 1), 'and is out of sight');
    assert.equal(await label('nextN'), 'Next night, Mon, Nov 16', 'the arrows say which night they go to');
    assert.equal(await label('prevN'), 'Previous night, Sat, Nov 14');
    await page.locator('#nextN').focus();
    await page.keyboard.press('Enter');
    assert.ok(await said(/^Night of Mon, Nov 16\. (A dark|Darkest|The )/), 'the new night and its verdict are said: ' + await page.$eval('#say', el => el.textContent));
    assert.ok(!/[<>]/.test(await page.$eval('#say', el => el.textContent)), 'as plain words');
    assert.equal(await label('nextN'), 'Next night, Tue, Nov 17');
    assert.equal(await label('prevN'), 'Previous night, Sun, Nov 15');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    assert.ok(await said(/^Tonight, Sun, Nov 15\. /), 'and stepping back says tonight');
    await page.locator('#targetSec [data-f="galaxy"]').focus();
    await page.keyboard.press('Enter');
    const n = (await page.$eval('#targetSec h2 small', s => s.textContent)).replace(/ targets?/, '');
    assert.ok(await said(new RegExp('^Galaxies: ' + n + ' targets?$')), 'a filter says how many it shows');
    await page.click('#locBtn');
    await page.waitForFunction(() => document.activeElement.id === 'lq');
    await page.keyboard.type('Aus');
    assert.ok(await said(/^\d+ places?$/), 'a town search says how many places it found');
    await page.keyboard.type('qqq');
    assert.ok(await said(/^No match$/), 'or that none match');
  } finally { await ctx.close(); }
});

// The chosen direction, filter and sky were shown by colour alone, and a direction was read as a letter.
// To a screen reader the map was a canvas labelled "tap an object for details", with nothing said about what it shows.
check('The map describes itself to a screen reader after it moves, and Enter opens what is nearest the middle', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  try {
    assert.equal(await page.$eval('#sky', c => c.getAttribute('aria-describedby')), 'skyDesc');
    assert.doesNotMatch(await page.$eval('#sky', c => c.getAttribute('aria-label')), /tap/i, 'the label doesn’t tell keyboard users to tap');
    const desc = () => page.$eval('#skyDesc', d => d.textContent);
    await page.waitForFunction(() => document.getElementById('skyDesc').textContent, null, { timeout: 5000 });
    assert.match(await desc(), /^The whole sky overhead at 9:00 pm\. In view: the Moon, Saturn, /);
    await page.click('#dirSeg button[data-d="180"]');
    await page.focus('#sky');
    await page.waitForFunction(() => /^Facing south/.test(document.getElementById('skyDesc').textContent), null, { timeout: 5000 });
    const south = await desc();
    assert.match(south, /^Facing south, 1\d\d° wide, at 9:00 pm\. In view: [^.]*Fomalhaut[^.]*[.…] Nearest the middle, which Enter opens: ([^.]+)\. What to look at, below the map, lists everything worth a look tonight\.$/);
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(was => document.getElementById('skyDesc').textContent !== was, south, { timeout: 5000 });
    assert.match(await desc(), /^Facing southwest/, 'it says the new way after the arrow keys move it');
    const mid = (await desc()).match(/Enter opens: ([^.]+)\./)[1];
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('sheet').hidden, null, { timeout: 5000 });
    assert.equal((await text(page, '#sheet .hd h2')).split(' ')[0], mid.split(' ')[0], 'Enter opens ' + mid);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // mid-sentence, the Moon keeps a small "the"
  const d = await open({ time: '2026-11-15T14:00:00-06:00' });
  try {
    await d.page.click('#nowBtn');
    await d.page.click('#dirSeg button[data-d="180"]');
    await d.page.waitForFunction(() => /Enter opens/.test(document.getElementById('skyDesc').textContent), null, { timeout: 5000 });
    assert.match(await d.page.$eval('#skyDesc', e => e.textContent), /In view: the Moon, the Sun, .* Nearest the middle, which Enter opens: the Moon\./);
  } finally { await d.ctx.close(); }
});

check('The direction buttons say which is chosen', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  const pressed = name => page.getByRole('button', { name, exact: true, pressed: true }).count();
  try {
    for (const name of ['Up: the whole sky overhead', 'North', 'East', 'South', 'West']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1, name + ' is a button by that name');
    await page.getByRole('button', { name: 'West', exact: true }).click();
    assert.equal(await pressed('West'), 1, 'West says it is chosen');
    assert.equal(await page.locator('#dirSeg [aria-pressed="true"]').count(), 1, 'and no other direction does');
    await page.getByRole('button', { name: 'Up: the whole sky overhead' }).click();
    assert.equal(await pressed('Up: the whole sky overhead'), 1);
    assert.equal(await page.$eval('#dirSeg [data-d="270"]', b => b.getAttribute('aria-pressed')), 'false');
    assert.equal(await pressed('All'), 1, 'the filter in use says so');
    await page.getByRole('button', { name: 'Clusters', exact: true }).click();
    assert.deepEqual([await pressed('Clusters'), await pressed('All')], [1, 0]);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    // a row reads its direction as a word, and its rating after a pause
    const moon = await page.locator('#targetSec .row[data-id="Moon"]').ariaSnapshot();
    assert.match(moon, /button "The Moon\s*Up now · Best \d+:\d\d pm · \d+° up ·\s*south, rated naked eye"/i, moon);
    assert.equal(await page.$eval('#targetSec .row[data-id="Moon"] .dt', d => d.textContent.slice(-4)), 'up · S'.slice(-4), 'the row still shows the letter');
    const high = await page.locator('#targetSec .row[data-id="M45"]').ariaSnapshot();
    assert.match(high, /button "Pleiades M45\s*Up now · Best \d+:\d\d [ap]m · overhead, rated easy"/i, high);
    await page.click('#scopeBtn');
    assert.equal(await page.locator('#skyOpts [aria-pressed="true"]').count(), 1, 'the sky in use says so');
    await page.locator('#skyOpts button').last().click();
    assert.equal(await page.$eval('#skyOpts button:last-child', b => b.getAttribute('aria-pressed')), 'true', 'and moves with a tap');
    assert.equal(await page.locator('#skyOpts [aria-pressed="true"]').count(), 1);
  } finally { await ctx.close(); }
});

// On a phone a card covers the page, so the page behind it is inert while it is open; on a desktop it sits beside a
// map that still works, so it isn't modal there. Inert left on by mistake would leave the page unusable, so every way
// of closing a card is tried over and over.
check('Tab stays inside an open card on a phone', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  const state = () => page.evaluate(() => ({ inert: document.getElementById('app').inert, open: !document.getElementById('sheet').hidden, modal: document.querySelector('#sheet .sheet')?.getAttribute('aria-modal') ?? null, at: document.activeElement.dataset.id || document.activeElement.id || document.activeElement.tagName }));
  const closed = () => page.waitForFunction(() => document.getElementById('sheet').hidden && document.activeElement !== document.body, null, { timeout: 5000 }).catch(() => {});
  try {
    const row = page.locator('#targetSec .row[data-id="M45"]');
    await row.focus();
    await page.keyboard.press('Enter');
    let s = await state();
    assert.deepEqual([s.open, s.inert, s.modal], [true, true, 'true'], 'the card is modal on a phone and the page behind it inert');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !document.getElementById('app').contains(document.activeElement)), 'Tab ' + (i + 1) + ' stays out of the page behind the card');
    }
    await page.click('#sheet [data-close]');
    await closed();
    s = await state();
    assert.deepEqual([s.open, s.inert, s.at], [false, false, 'M45'], 'Done clears it and hands the focus back');
    const ways = ['Done', 'Escape', 'Back', 'the backdrop', 'Show in the sky view'];
    for (let i = 0; i < 50; i++) {
      const how = ways[i % ways.length];
      await row.scrollIntoViewIfNeeded();
      await row.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('sheet').hidden);
      assert.equal((await state()).inert, true, 'cycle ' + i + ': inert while open');
      if (how === 'Done') await page.click('#sheet [data-close]');
      else if (how === 'Escape') await page.keyboard.press('Escape');
      else if (how === 'Back') await page.evaluate(() => history.back());
      else if (how === 'the backdrop') await page.mouse.click(195, 20);
      else await page.click('#ctr');
      await closed();
      s = await state();
      assert.deepEqual([s.open, s.inert], [false, false], 'cycle ' + i + ': closing with ' + how + ' clears inert');
      if (how !== 'Show in the sky view') assert.equal(s.at, 'M45', 'cycle ' + i + ': closing with ' + how + ' hands the focus back to the row');
    }
    await page.click('#locBtn');
    assert.equal((await state()).inert, true, 'the location sheet is modal too');
    await page.fill('#lq', 'Tucson');
    await page.locator('#lres button').first().click();
    await closed();
    assert.equal((await state()).inert, false, 'choosing a place clears it');
    await page.click('#scopeBtn');
    await page.click('#scSave');
    await closed();
    assert.equal((await state()).inert, false, 'so does saving the telescope');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  ({ ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false }));
  try {
    await openCard(page, 'M45');
    let s = await state();
    assert.deepEqual([s.inert, s.modal], [false, null], 'on a desktop the card is a side panel, not modal');
    await page.click('#scopeBtn'); // a sheet that takes the card's place
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForFunction(() => document.getElementById('app').inert, null, { timeout: 5000 }).catch(() => {});
    s = await state();
    assert.deepEqual([s.open, s.inert, s.modal], [true, true, 'true'], 'narrowed to a phone’s layout, it becomes modal');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => !document.getElementById('app').inert, null, { timeout: 5000 }).catch(() => {});
    s = await state();
    assert.deepEqual([s.inert, s.modal], [false, null], 'and widened again, a side panel');
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForFunction(() => document.getElementById('app').inert, null, { timeout: 5000 }).catch(() => {});
    await page.getByRole('button', { name: 'Cancel' }).click();
    await closed();
    assert.equal((await state()).inert, false, 'closing it at either width clears inert');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Each eyepiece row showed the same "mm" and "Apparent field" and a "Remove" for every eyepiece.
check('The telescope sheet’s fields say which eyepiece they belong to', async () => {
  const { ctx, page } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-11-15T21:00:00-06:00', phone: false });
  const box = name => page.getByRole('textbox', { name, exact: true });
  try {
    await page.click('#scopeBtn');
    assert.equal(await page.getByRole('combobox', { name: 'Quick pick' }).count(), 1, 'the quick pick has a name');
    assert.equal(await box('Eyepiece 1 focal length (mm)').inputValue(), '25');
    assert.equal(await box('Eyepiece 1 apparent field (°)').inputValue(), '52');
    assert.equal(await box('Eyepiece 2 focal length (mm)').inputValue(), '6');
    assert.equal(await page.getByRole('button', { name: 'Remove the 6 mm eyepiece' }).count(), 1, 'Remove says which eyepiece');
    await box('Eyepiece 2 focal length (mm)').fill('9');
    assert.equal(await page.getByRole('button', { name: 'Remove the 9 mm eyepiece' }).count(), 1, 'and keeps up with a new focal length');
    await page.click('#epAdd');
    assert.equal(await box('Eyepiece 3 focal length (mm)').count(), 1, 'a new eyepiece is numbered');
    await page.getByRole('button', { name: 'Remove the 25 mm eyepiece' }).click();
    assert.equal(await box('Eyepiece 1 focal length (mm)').inputValue(), '9', 'removing one numbers the rest again');
    // a Save that can't be made marks the field to fix and puts the focus on it
    await page.fill('#scFl', '');
    await page.click('#scSave');
    assert.ok(await sheetOpen(page), 'the sheet stays open');
    assert.equal(await page.$eval('#scFl', i => i.getAttribute('aria-invalid')), 'true', 'the focal length is marked');
    assert.equal(await page.$eval('#scAp', i => i.getAttribute('aria-invalid')), null, 'the aperture isn’t');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'scFl', 'and has the focus');
    assert.equal(await text(page, '#toast'), 'Check the aperture and focal length', 'the message still shows');
    await page.keyboard.type('1200');
    assert.equal(await page.$eval('#scFl', i => i.getAttribute('aria-invalid')), null, 'typing a value clears the mark');
    await page.click('#scSave');
    assert.equal(await sheetOpen(page), false, 'and Save works');
  } finally { await ctx.close(); }
});

// The sheet read each box with parseFloat and kept the old value when that failed: "H6mm", as printed on the eyepiece,
// saved the default 5 mm, "12,5" from a phone's decimal-comma keypad saved 12, "101,6" made a 101 mm aperture, and a
// box left empty saved whatever was there before.
check('an eyepiece typed as printed or with a decimal comma is saved as meant', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope: DOB8 }), time: '2026-11-15T21:00:00-06:00' });
  const box = name => page.getByRole('textbox', { name, exact: true });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('starhop.v1')).scope);
  try {
    await page.click('#scopeBtn');
    await page.click('#epAdd');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Eyepiece 3 focal length (mm)', 'a new eyepiece’s focal length takes the focus');
    assert.deepEqual(await page.$$eval('#epl .epr', rs => rs.map(r => [...r.querySelectorAll('.fld>span')].map(s => s.offsetParent ? s.textContent : '').join('|'))), ['mm|Apparent field °', '|', '|'], 'only the first row shows its labels');
    await page.keyboard.type('H6mm');
    await box('Eyepiece 3 apparent field (°)').fill('66°');
    await box('Eyepiece 2 focal length (mm)').fill('12,5');
    await page.fill('#scAp', '101,6');
    assert.deepEqual(await page.$$eval('#scStats .eps tbody tr', rs => rs.map(r => [...r.cells].map(c => [...c.childNodes].filter(n => !n.classList || !n.classList.contains('sr')).map(n => n.textContent).join('')).join(' '))), ['25 mm 48× 1.1°', '12.5 mm 96× 33′', '6 mm 200× 20′'], 'what it can do, eyepiece by eyepiece, with fields as the cards give them');
    await page.click('#scSave');
    assert.equal(await sheetOpen(page), false, 'Save works');
    const sc = await saved();
    assert.equal(sc.ap, 101.6, 'the aperture');
    assert.deepEqual(sc.eps, [{ f: 25, a: 52 }, { f: 12.5, a: 52 }, { f: 6, a: 66 }], 'the eyepieces');
    // a box left empty, or one that can't be read, stops Save and says which
    await page.click('#scopeBtn');
    await box('Eyepiece 1 focal length (mm)').fill('');
    await box('Eyepiece 3 apparent field (°)').fill('wide');
    await page.click('#scSave');
    assert.ok(await sheetOpen(page), 'the sheet stays open');
    assert.equal(await text(page, '#toast'), 'Check the first eyepiece: its focal length in mm, like 6 or 12.5');
    assert.equal(await box('Eyepiece 1 focal length (mm)').getAttribute('aria-invalid'), 'true');
    assert.equal(await box('Eyepiece 3 apparent field (°)').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Eyepiece 1 focal length (mm)', 'the first to fix has the focus');
    assert.equal(await page.getByRole('button', { name: 'Remove eyepiece 1' }).count(), 1, 'Remove still says which');
    await page.keyboard.type('K25');
    assert.equal(await box('Eyepiece 1 focal length (mm)').getAttribute('aria-invalid'), null, 'typing clears the mark');
    await page.click('#scSave');
    assert.equal(await text(page, '#toast'), 'Check the third eyepiece: its apparent field in degrees, like 52 or 68');
    await page.getByRole('button', { name: 'Remove the 6 mm eyepiece' }).click();
    await page.click('#scSave');
    assert.equal(await sheetOpen(page), false, 'Save works once each box can be read');
    assert.deepEqual((await saved()).eps, [{ f: 25, a: 52 }, { f: 12.5, a: 52 }]);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// How a card and the page sound read aloud: no primes, one main heading, charts described by their captions.
check('Each card ends with what the numbers mean, folded away until asked for', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    for (const id of ['M13', 'albireo', 'Saturn', 'Moon']) {
      await openCard(page, id);
      assert.equal(await page.$eval('#sheet .bd > :last-child', el => el.id), 'gloss', id + ': it is the last thing on the card');
      assert.equal(await page.$eval('#gloss', el => el.open), false, id + ': it starts closed');
      assert.equal(await text(page, '#gloss summary'), 'WHAT THE NUMBERS MEAN');
      await page.keyboard.press('Escape');
    }
    await openCard(page, 'M13');
    await page.click('#gloss summary');
    const said = await shown(page, '#gloss');
    assert.match(await page.locator('#gloss').ariaSnapshot(), /60 arcseconds make 1 arcminute ?, and 60 arcminutes make 1°\. The full Moon is about 31 arcminutes across/, 'read aloud, the primes are words: ' + await page.locator('#gloss').ariaSnapshot());
    for (const re of [/smaller the number, the brighter\. About 6 is the faintest you see by eye/, /60″ make 1′, and 60′ make 1°\. The full Moon is about 31′ across/, /A fist held at arm’s length covers about 10°/, /δ And is Delta Andromedae, a star in Andromeda/, /Split means seeing a double star as two stars/]) assert.match(said, re);
    await page.focus('#tlc');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#sheet .card h3').textContent === 'At 10:00 pm', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await text(page, '#sheet .card h3'), 'AT 10:00 PM', 'the card moves on with the time');
    assert.equal(await page.$eval('#gloss', el => el.open), true, 'and keeps it open');
    await page.keyboard.press('Escape');
    await openCard(page, 'M13');
    assert.equal(await page.$eval('#gloss', el => el.open), false, 'opened again, the card starts with it closed');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('A card says arcminutes and arcseconds, and the page has one main heading', async () => {
  const { ctx, page } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  try {
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1, 'one main heading');
    assert.equal(await page.getByRole('heading', { level: 1, name: 'Starhop' }).count(), 1, 'named Starhop');
    assert.doesNotMatch(await page.locator('.tlhd').ariaSnapshot(), /\bimg\b/, 'the night arrows’ drawings are hidden: ' + await page.locator('.tlhd').ariaSnapshot());
    await openCard(page, 'M57');
    const kv = await page.locator('#sheet .kv').ariaSnapshot();
    assert.match(kv, /1\.4 arcminutes × 1 arcminute/, kv);
    assert.doesNotMatch(kv, /′/);
    assert.match(await shown(page, '#sheet .kv'), /SIZE 1\.4′ × 1′/i, 'it still shows the primes');
    for (const [id, re] of [['finder', /finderscope field/], ['eyepiece', /× with the \d+ mm/]]) {
      const desc = await page.$eval('#' + id, c => document.getElementById(c.getAttribute('aria-describedby'))?.textContent || '');
      assert.match(desc, re, 'the ' + id + ' chart is described by its caption');
    }
    await page.keyboard.press('Escape');
    await openCard(page, 'albireo');
    assert.match(await page.locator('#sheet .kv').ariaSnapshot(), /Separation\W+[\d.]+ arcseconds/);
  } finally { await ctx.close(); }
});

// Austin, Oct 13 2026, by the USNO convention (PyEphem): Saturn rises 6:37 pm and sets 6:48 am, Jupiter rises 2:58 am, Mars 1:58 am.
// Sunset is 7:01 pm and sunrise 7:32 am, and the card gives the times between them, so Saturn is up at dusk.
check('planet rise and set times match the standard ones', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    const times = async id => { await openCard(page, id); const t = await page.$eval('#sheet .card p:not(.big)', p => p.textContent); await page.keyboard.press('Escape'); return t; };
    assert.match(await times('Saturn'), /^Up at dusk · Sets 6:48 am/);
    assert.match(await times('Jupiter'), /Rises 2:58 am/);
    assert.match(await times('Mars'), /Rises 1:58 am/);
  } finally { await ctx.close(); }
});

// d3-celestial gives M73 no size, and the card made one up; SEDS gives its four stars as 2.8′ across. Sizes under 10′
// show to a tenth, since the Ring Nebula's 1.4′ × 1.0′ showed as 1′ × 1′.
check('M73, a few faint stars, takes its size from SEDS and gets no cluster sketch', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', phone: false });
  try {
    await openCard(page, 'M73');
    const size = (await shown(page, '#sheet .kv')).match(/SIZE (\S+)/i)[1];
    assert.equal(size, '2.8′', 'M73 size');
    assert.equal(await advice(page), 'It spans 2.8′. Find it with the 25 mm (2.0° field), then try the 10 mm (65×) for a closer look.');
    await page.waitForFunction(() => document.getElementById('epCap').textContent);
    assert.doesNotMatch(await text(page, '#epCap'), /sketch/, 'M73 has no cluster sketch');
  } finally { await ctx.close(); }
});

// M40 is two 10th-magnitude stars, Winnecke 4, 53″ apart. With no size in the data, its surface brightness came out
// brilliant: Easy, and 24th on the list on Nov 15, above M13 at 29th. It is now a double star, rated by its split.
check('M13 ranks above M40 on an Austin November night', async () => {
  let { ctx, page, problems } = await open({ time: '2026-11-15T20:30:00-06:00' });
  try {
    const rows = await targetRows(page), at = id => rows.findIndex(r => r.id === id);
    assert.ok(at('M13') >= 0 && at('M40') >= 0, 'both are listed');
    assert.ok(at('M13') < at('M40'), `M13 is row ${at('M13') + 1}, M40 row ${at('M40') + 1}`);
    assert.equal(rows[at('M40')].kind, 'ds', 'M40 is listed as a double star');
    assert.ok(at('M40') >= 14, 'M40 is among the first 14 targets, the ones shown before Show all');
    await openCard(page, 'M40');
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Winnecke 4 · M40');
    assert.match(await shown(page, '#sheet .kv'), /9\.7 \+ 10\.2 SEPARATION 53\.2″/i);
    assert.match(await advice(page), /^The two stars are 53\.2″ apart/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // its stars, magnitudes 9.7 and 10.2, are beyond a 70 mm's reach from a city (faintest star 8.0)
  ({ ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, sky: 'city', scope: { name: '', ap: 70, fl: 700, eps: [{ f: 25, a: 52 }, { f: 10, a: 52 }], set: true } }), time: '2026-04-15T22:00:00-05:00' }));
  try {
    assert.equal((await targetRows(page)).find(r => r.id === 'M40')?.rate, 'Too faint');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // its stars are too faint for the star catalog, so it keeps a mark of its own on the map, which opens its card
  ({ ctx, page, problems } = await open({ time: '2026-04-15T22:00:00-05:00', phone: false }));
  try {
    await openCard(page, 'M40');
    await page.click('#ctr');
    await tapMap(page, 'dso', 'M40');
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Winnecke 4 · M40');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// d3-celestial gave the Omega Nebula the size of its whole faint glow (46′ × 37′; SEDS gives 11′) and the Lagoon and
// the Trifid photographic magnitudes (5.8 and 8.5; SEDS gives 4.6 and 6.3), so on a moonless July night in Austin the
// list called the Omega Hard, the Trifid Very hard and the Lagoon Fair.
check('The Omega and Lagoon nebulae rate Easy in a 130 mm from the suburbs', async () => {
  const { ctx, page, problems } = await open({ time: '2026-07-15T22:30:00-05:00' });
  try {
    const rows = await targetRows(page), rate = id => rows.find(r => r.id === id)?.rate;
    assert.equal(rate('M17'), 'Easy', 'the Omega Nebula');
    assert.equal(rate('M8'), 'Easy', 'the Lagoon Nebula');
    assert.notEqual(rate('M20'), 'Very hard', 'the Trifid Nebula');
    await openCard(page, 'M17');
    assert.match(await shown(page, '#sheet .kv'), /mag 7\.0 SIZE 11′ DIFFICULTY Easy/i);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A rating jumped 3 points as soon as an object came within 1.5 magnitudes of the faintest star the telescope shows: M1
// went from Hard in a 70 mm from the suburbs to Easy in a 130 mm, and from Very hard to Easy in a 130 mm between a city
// sky and the suburbs. Each sky choice brightens the sky by more than a level's width (City to Suburbs is 1.6
// magnitudes per square arcsecond, Suburbs to Countryside 1.4), so only the telescope's steps are held to one level.
// Off the list counts as harder than Very hard. Austin, Nov 9 2026, a moonless night.
check('A rating never gets easier in a brighter sky or a smaller telescope, and moves one level at most per telescope size', async () => {
  const ids = ['M1', 'M27', 'M33', 'M57', 'M74', 'M76', 'M97'], skies = ['city', 'suburb', 'rural', 'dark'], aps = [70, 130, 254];
  const level = { Easy: 0, Fair: 1, Hard: 2, 'Very hard': 3 }, grid = {};
  for (const ap of aps) for (const sky of skies) {
    const scope = { name: '', ap, fl: ap * 5, eps: [{ f: 25, a: 52 }, { f: 10, a: 52 }], set: true };
    const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, scope, sky }), time: '2026-11-09T21:00:00-06:00' });
    try {
      const rows = await targetRows(page);
      for (const id of ids) { const r = rows.find(x => x.id === id); grid[`${id} ${ap} ${sky}`] = r ? level[r.rate] : 4; }
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
  const at = (id, a, s) => grid[`${id} ${aps[a]} ${skies[s]}`], name = l => ['Easy', 'Fair', 'Hard', 'Very hard', 'off the list'][l];
  for (const id of ids) for (let a = 0; a < 3; a++) for (let s = 0; s < 4; s++) {
    if (s < 3) assert.ok(at(id, a, s) >= at(id, a, s + 1), `${id} in a ${aps[a]} mm is ${name(at(id, a, s))} from the ${skies[s]} but ${name(at(id, a, s + 1))} from the ${skies[s + 1]}`);
    if (a < 2) {
      const d = at(id, a, s) - at(id, a + 1, s), where = `${id} from the ${skies[s]} is ${name(at(id, a, s))} in a ${aps[a]} mm and ${name(at(id, a + 1, s))} in a ${aps[a + 1]} mm`;
      assert.ok(d >= 0, where);
      if (at(id, a, s) < 4) assert.ok(d <= 1, where);
    }
  }
});

// The Owl's catalogue magnitude was photographic (11.2 for 9.9), and on a moonlit night the 3-point jump dropped it from
// a 130 mm's list in the suburbs. Austin, Apr 28 2026, with a 94% Moon up.
check('The Owl Nebula stays on a suburban 130 mm list in spring', async () => {
  const { ctx, page, problems } = await open({ time: '2026-04-28T22:00:00-05:00' });
  try {
    const owl = (await targetRows(page)).find(r => r.id === 'M97');
    assert.ok(owl, 'the Owl Nebula is listed');
    assert.notEqual(owl.rate, 'Easy', 'and isn’t called easy with the Moon up');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The names came straight from d3-celestial: M31's card was "Andromeda · M31", which reads as the constellation, M24 a
// "Milky Way patch", M77 "Cetus A" (a radio source), M94 a second "Cat’s Eye", and NGC 6543 had a straight apostrophe.
check('Deep-sky names read as names, with curly apostrophes', async () => {
  const { dso } = JSON.parse(await readFile(join(root, 'data/dso.json'), 'utf8')), name = id => dso.find(d => d.id === id).name;
  assert.deepEqual(['M31', 'M33', 'M24', 'M44', 'M64', 'M51', 'M77', 'M94'].map(name),
    ['Andromeda Galaxy', 'Triangulum Galaxy', 'Sagittarius Star Cloud', 'Beehive Cluster', 'Black Eye Galaxy', 'Whirlpool Galaxy', '', '']);
  assert.deepEqual(dso.filter(d => /'/.test(d.name)).map(d => d.name), [], 'straight apostrophes');
  assert.equal(dso.find(d => d.id === 'NGC 2264').type, 'Open cluster', 'the Christmas Tree Cluster');
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await openCard(page, 'M31');
    assert.equal(await page.$eval('#sheet .hd h2', h => h.firstChild.textContent), 'Andromeda Galaxy · M31');
    assert.match(await text(page, '#sheet'), /the farthest thing most people can see without a telescope/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// A star brighter than 4.6 can be tapped, and its card goes by its name or label, or "A magnitude 4.5 star" with neither. The build
// gives Bayer letters down to 4.5 and Flamsteed numbers down to 4.0, which leaves 126 tappable stars with no label (16 of
// them have neither in d3-celestial), so one more is a star that lost its only label, as ξ Sco did with "Grafias".
check('star labels in the data are all real designations, and no tappable star loses its label', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8'));
  assert.deepEqual(Object.entries(n).filter(([, v]) => v.some(x => /undefined/.test(x))), [], 'labels with "undefined" in them');
  const bare = [];
  for (let i = 0; i < s.length / 4; i++) if (s[i * 4 + 2] < 4.6 && !(n[i] && (n[i][0] || n[i][1]))) bare.push(i);
  assert.equal(bare.length, 126, 'tappable stars with no label');
  assert.deepEqual(n[await starAt(241.09, -11.37)], ['', 'ξ Sco', 'Sco'], 'ξ Sco (HIP 78727)');
});

// d3-celestial gave some traditional names to several stars: Markab to α Peg and κ1 Pup, Tarazed to γ and η Aql,
// Alnair to α Gru and ζ Cen, which put "Alnair" in Omega Centauri's star-hop. Each star d3-celestial names now goes by
// the IAU's name for it (η Aql is Pagru, ζ Cen Leepwal, ζ Her Tianji, γ Cas Tiansi), or by its letter where the IAU
// never adopted the name (ν Oph was "Sinistra", γ2 Vel "Regor").
check('each star name is on one star only, the one the IAU gives it to, and the stars keep their order', async () => {
  const { s, n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')), on = {};
  for (const [i, v] of Object.entries(n)) if (v[0]) (on[v[0]] = on[v[0]] || []).push(v[1] || '#' + i);
  assert.deepEqual(Object.entries(on).filter(([, stars]) => stars.length > 1), [], 'names on more than one star');
  const named = des => Object.values(n).find(v => v[1] === des)[0];
  for (const [des, name] of [['α Peg', 'Markab'], ['κ1 Pup', ''], ['γ Aql', 'Tarazed'], ['η Aql', 'Pagru'], ['α Gru', 'Alnair'], ['ζ Cen', 'Leepwal'], ['ζ Her', 'Tianji'], ['γ Cas', 'Tiansi'], ['ν Oph', ''], ['γ2 Vel', ''], ['ε1 Lyr', '']]) assert.equal(named(des), name, des);
  // Stars marked as seen are kept by their place in this list, so a rebuild that reorders it needs to move those marks.
  // Mira, added at the end, moved none of them.
  assert.equal(createHash('sha256').update(JSON.stringify(s.slice(0, 5044 * 4))).digest('hex').slice(0, 16), 'a010c8abcddc38b6', 'the star list changed order or content');
});

// d3-celestial spells some names its own way, and gave ε1 Lyr the nickname of the whole Epsilon Lyrae system. Where the
// IAU's Working Group on Star Names gives the same star the same name spelled differently, its spelling is used.
check('Star names follow the IAU’s spelling, and ε1 Lyr goes by its letter', async () => {
  const { n } = JSON.parse(await readFile(join(root, 'data/stars.json'), 'utf8')), named = des => Object.values(n).find(v => v[1] === des)[0];
  for (const [des, name] of [['α Cas', 'Schedar'], ['μ Cep', 'Garnet Star'], ['λ Vir', 'Khambalia'], ['σ CMa', 'Nganurganity'], ['ε1 Lyr', '']]) assert.equal(named(des), name, des);
});

// "The Milky Way casts shadows" is how Bortle's scale (Sky & Telescope, February 2001) describes its darkest class, 1,
// but the dark site's faintest stars, magnitude 6.6, put it in class 3 by that scale's own limiting magnitudes.
check('The dark-site sky choice promises no more than its numbers', async () => {
  const { ctx, page, problems } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    await page.click('#scopeBtn');
    const dark = await page.$eval('#skyOpts [data-s="dark"]', b => b.innerText.replace(/\s+/g, ' ').trim());
    assert.equal(dark, 'Dark site Bortle 3 The Milky Way is full of detail');
    // each sky's Bortle class by its faintest naked-eye star, on Bortle's scale: 9 at 4.0 or brighter, 7 for 4.6–5.0,
    // 5 for 5.6–6.0, 3 for 6.6–7.0
    assert.deepEqual(await page.$$eval('#skyOpts .bt', b => b.map(x => x.textContent)), ['Bortle 9', 'Bortle 7', 'Bortle 5', 'Bortle 3']);
    assert.match(await page.$eval('#skyOpts', o => o.previousElementSibling.textContent), /faintest star you see by eye.*February 2001/);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('Show in the sky view jumps straight up when motion is reduced', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00', reducedMotion: 'reduce' });
  try {
    await page.click('#moreT');
    await page.locator('#targetSec .row').last().click();
    assert.ok(await page.evaluate(() => scrollY) > 1000, 'the card was opened from far down the list');
    await page.click('#ctr');
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => scrollY), 0, 'no animated scroll');
  } finally { await ctx.close(); }
});

// Coming up is worked out once the sky is drawn. Each row: its date and month as shown, the time under them if any,
// the title and the text.
const events = async page => {
  await page.waitForFunction(() => document.querySelectorAll('#eventSec .ev').length > 0, null, { timeout: 30000 });
  return page.$$eval('#eventSec .ev', rows => rows.map(r => ({
    d: +r.querySelector('.d b').textContent, mon: r.querySelector('.d span').textContent, at: r.querySelector('.d small')?.textContent || '',
    title: r.querySelector('.evt').textContent, text: r.querySelector('.evp').textContent,
  })));
};
const SYDNEY = { name: 'Sydney, AU', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' };

// Astronomy Engine's SearchSunLongitude, asked to look a year ahead, finds next year's crossing when it starts within a
// few days of this year's, so a shower dropped out of the list in the days before its peak. The IMO's 2026 Meteor
// Shower Calendar (Table 5 and section 6) has the Leonids peaking at 23h45m UT on 17 Nov: 5:45 pm in Austin.
check('lists the Leonids two days before they peak', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const leo = (await events(page)).find(e => e.title === 'Leonids meteor shower peaks');
    assert.ok(leo, 'the Leonids are listed');
    assert.equal(`${leo.d} ${leo.mon}`, '17 Nov', 'on the night they peak');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The Ursids' radiant is at Dec +76° and the Perseids' at +58° (IMO 2026 Calendar, Table 5): from Sydney, at −33.9°,
// they never rise, though Austin sees both.
check('from Sydney Coming up leaves out showers whose radiant never rises', async () => {
  for (const [time, shower] of [['2026-12-18T21:00:00', 'Ursids'], ['2027-08-10T21:00:00', 'Perseids']]) {
    for (const loc of [AUSTIN, SYDNEY]) {
      const { ctx, page, problems } = await open({ loc, time: time + (loc === AUSTIN ? (shower === 'Ursids' ? '-06:00' : '-05:00') : (shower === 'Ursids' ? '+11:00' : '+10:00')) });
      try {
        const listed = (await events(page)).some(e => e.title.startsWith(shower));
        assert.equal(listed, loc === AUSTIN, `${loc.name} ${listed ? 'lists' : 'leaves out'} the ${shower}`);
        assert.deepEqual(problems, []);
      } finally { await ctx.close(); }
    }
  }
});

// From Austin the Moon is closest to Mars at 11:30 am on 30 Nov 2026, with the Sun 37° up (Astronomy Engine), so it's
// offered for when it can be seen: with a time when the Sun is at least 6° down (5:55 pm to 6:45 am there in late
// November and early December), or not at all.
check('a Moon–planet pairing is offered only when you can see it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const pairs = (await events(page)).filter(e => e.title.startsWith('Moon near'));
    assert.ok(pairs.length, 'some pairings are listed');
    for (const e of pairs) {
      assert.match(e.at, /^\d+:\d\d (am|pm)$/, `${e.title} on ${e.d} ${e.mon} says when`);
      const m = afterNoon(e.at);
      assert.ok(m >= 5 * 60 + 55 && m <= 18 * 60 + 45, `${e.title} on ${e.d} ${e.mon} is at ${e.at}, in daylight`);
    }
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Astronomy Engine has Mars and Jupiter 1.2° apart at 02:00 UTC on 16 Nov 2026, 88° from the Sun (from Austin they're
// up before dawn), and Venus and Mars 0.3° apart at 00:40 UTC on 25 Nov 2027, 27° from the Sun (in Austin's evening
// twilight on the 24th). In August 2027 Mercury and Venus (11th), Mercury and Jupiter (19th) and Venus and Jupiter (26th)
// pass within 0.7° of each other, but no more than 9° from the Sun, lost in its glare.
check('Coming up lists bright planets passing each other, when you can see them from here', async () => {
  const cases = [
    ['2026-11-15T21:00:00-06:00', 'Mars near Jupiter', /^1\.2° apart, \d+° up in the southeast before dawn/, 16, 'Nov'],
    ['2027-11-20T21:00:00-06:00', 'Venus near Mars', /^0\.3° apart, 13° up in the southwest after dusk/, 24, 'Nov'],
  ];
  for (const [time, title, re, d, mon] of cases) {
    const { ctx, page, problems } = await open({ time });
    try {
      const e = (await events(page)).find(x => x.title === title);
      assert.ok(e, title + ' is listed');
      assert.match(e.text, re);
      assert.equal(`${e.d} ${e.mon}`, `${d} ${mon}`);
      const m = afterNoon(e.at);
      assert.ok(m >= 5 * 60 + 55 && m <= 18 * 60 + 45, `${title} at ${e.at} is in the dark`);
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  }
  const { ctx, page, problems } = await open({ time: '2027-08-05T21:00:00-05:00' });
  try {
    const ev = await events(page);
    assert.ok(ev.some(e => e.mon === 'Sep' || e.mon === 'Oct'), 'the list runs past the end of August');
    assert.deepEqual(ev.filter(e => /^(Mercury|Venus|Mars|Jupiter|Saturn) near/.test(e.title)), [], 'pairs in the Sun’s glare are left out');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

check('coming up lists the next moon phases and a meteor shower, in order', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    const ev = await events(page), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // The IMO 2026 Calendar's Table 4 gives 17 Nov, 24 Nov, 1 Dec and 9 Dec in UT; the new Moon is at 00:52 UT on the
    // 9th (Astronomy Engine), 6:52 pm on the 8th in Austin.
    assert.deepEqual(ev.filter(e => / Moon$/.test(e.title)).map(e => `${e.title} ${e.d} ${e.mon}`),
      ['First quarter Moon 17 Nov', 'Full Moon 24 Nov', 'Last quarter Moon 1 Dec', 'New Moon 8 Dec']);
    assert.ok(ev.some(e => /meteor shower peaks$/.test(e.title)), 'a meteor shower is listed');
    let last = -1;
    for (const e of ev) {
      const k = (MON.indexOf(e.mon) + (e.mon === 'Jan' || e.mon === 'Feb' ? 12 : 0)) * 31 + e.d;
      assert.ok(k >= last, `${e.title} on ${e.d} ${e.mon} is out of order`);
      last = k;
    }
    // It depends only on the place and the day, so it isn't worked out again for another night.
    await page.$eval('#eventSec .list', l => { l.kept = true; });
    await page.click('#nextN');
    await page.click('#prevN');
    await page.waitForTimeout(300);
    assert.ok(await page.$eval('#eventSec .list', l => l.kept), 'stepping to another night and back keeps the list');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Planning a trip: step to a night, then pick the dark site. The view jumped back to tonight.
check('Changing place keeps the night being planned', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', phone: false });
  try {
    for (let i = 0; i < 6; i++) await page.click('#nextN');
    assert.equal(await text(page, '#nightTitle'), 'Night of Sat, Nov 21');
    await until(page, '#when', /^9:00 pm/);
    await page.click('#locBtn');
    await page.fill('#lq', 'Tucson');
    await page.waitForFunction(() => document.querySelector('#lres button')?.textContent.startsWith('Tucson'));
    await page.click('#lres button');
    assert.equal(await text(page, '#locName'), 'Tucson, AZ');
    assert.equal(await text(page, '#nightTitle'), 'Night of Sat, Nov 21', 'the night planned stays');
    await until(page, '#when', /^9:00 pm/);
    assert.equal(await text(page, '#when'), '9:00 pm Sat, Nov 21', 'at the same time of night, there');
    assert.equal(await page.$eval('#tonightSec h2', h => h.textContent), 'Sat night Tucson, AZ');
    // from tonight, a new place shows its tonight, live
    await page.click('#nowBtn');
    await page.click('#locBtn');
    await page.fill('#lq', 'Austin');
    await page.waitForFunction(() => document.querySelector('#lres button')?.textContent.startsWith('Austin'));
    await page.click('#lres button');
    assert.equal(await text(page, '#nightTitle'), 'Tonight · Sun, Nov 15');
    assert.equal(await page.$eval('#nowBtn', b => b.classList.contains('on')), true);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// New Moon on Dec 8, the night to plan a dark-site trip, couldn't be opened from Coming up. It falls at 6:52 pm in Austin.
check('A Coming up row opens its night', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00' });
  try {
    await events(page);
    const row = title => page.locator('#eventSec .ev', { hasText: title }).first();
    await row('New Moon').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => scrollY) > 500);
    await row('New Moon').click();
    assert.equal(await text(page, '#nightTitle'), 'Night of Tue, Dec 8', 'it steps to that night');
    await until(page, '#when', /^6:52 pm/);
    assert.equal(await text(page, '#when'), '6:52 pm Tue, Dec 8', 'at the time it happens');
    await page.waitForFunction(() => scrollY === 0, null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => scrollY), 0, 'and goes up to the sky');
    // a shower is listed for its night, with no time of its own, so the time of night shown stays
    await row('Leonids').click();
    assert.equal(await text(page, '#nightTitle'), 'Night of Tue, Nov 17');
    await until(page, '#when', /^6:52 pm/);
    assert.match(await text(page, '#when'), /^6:52 pm Tue, Nov 17$/);
    assert.equal(await page.getByRole('button', { name: /^8 Dec 6:52 pm New Moon/ }).count(), 1, 'a row is a button named by what it says');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// Madrid's eclipse of Aug 12 2026 read "100% of the Sun is covered" under "Partial solar eclipse". Astronomy Engine
// 2.1.19, SearchLocalSolarEclipse: Madrid (40.42, -3.70) partial, obscuration 0.99969 at 18:32:14Z (8:32 pm), the Sun
// 7.34° up at azimuth 283° (west), and -1.61° at the partial end, 19:24Z, so it sets eclipsed. Cádiz (36.53, -6.29),
// Aug 2 2027: total from 08:45:18Z (10:45 am) to 08:48:11Z, 173 s, the Sun 37.4° up at azimuth 95° (east).
// SearchLunarEclipse: penumbral on Feb 20 2027 at 23:12:44Z (semi-duration 121 min; the Moon is 55° up from Madrid)
// and Jul 18 2027 at 16:03Z (12.7 min, too slight to see).
check('Coming up gives eclipses as seen from here', async () => {
  const eclipse = async (loc, time, kind) => {
    const { ctx, page, problems } = await open({ loc, time });
    try {
      const ev = (await events(page)).filter(e => e.title.includes(kind));
      assert.deepEqual(problems, []);
      return ev;
    } finally { await ctx.close(); }
  };
  const MADRID = { name: 'Madrid, ES', lat: 40.42, lon: -3.70, tz: 'Europe/Madrid' };
  let [e] = await eclipse(MADRID, '2026-08-01T22:00:00+02:00', 'solar eclipse');
  assert.equal(e.title, 'Partial solar eclipse');
  assert.match(e.text, /^Seen from Madrid, ES, 99\.96% of the Sun is covered at 8:32 pm, when it is 7° up in the west, and it sets before the eclipse ends\. Never look/, e.text);
  assert.doesNotMatch(e.text, /100%/);
  [e] = await eclipse({ name: 'Cádiz, ES', lat: 36.53, lon: -6.29, tz: 'Europe/Madrid' }, '2027-07-25T12:00:00+02:00', 'solar eclipse');
  assert.equal(e.title, 'Total solar eclipse');
  assert.match(e.text, /^Seen from Cádiz, ES, the eclipse is total for 2 min 53 s from 10:45 am, with the Sun 37° up in the east\. Never look/, e.text);
  [e] = await eclipse(MADRID, '2027-02-10T21:00:00+01:00', 'lunar eclipse');
  assert.equal(e.title, 'Penumbral lunar eclipse');
  assert.match(e.text, /55° up .*a faint shading on one side of the Moon, easy to miss\.$/, e.text);
  const lunar = await eclipse(AUSTIN, '2027-07-10T21:00:00-05:00', 'lunar eclipse');
  assert.ok(!lunar.some(e => e.d === 18 && e.mon === 'Jul'), 'a penumbral eclipse too slight to see is left out');
});

// A part of Coming up that broke was dropped without a word, so a check for problems couldn't see it. It is logged now,
// and the other parts still show.
check('a part of Coming up that breaks is logged, and the rest still shows', async () => {
  const route = ['**/js/astronomy.browser.min.js', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()) + '\nAstronomy.SearchLunarEclipse = function () { throw new Error("no lunar eclipses"); };' }); }];
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', route });
  try {
    const ev = await events(page);
    assert.ok(ev.some(e => /Moon$/.test(e.title)), 'the Moon phases still show');
    assert.ok(problems.some(p => /Coming up:.*no lunar eclipses/.test(p)), 'the broken part is logged: ' + problems.join(' | '));
  } finally { await ctx.close(); }
});

// The muted labels (--ink3) are 10.5 to 12 px, so they need 4.5:1 on every surface they sit on.
check('small muted labels have 4.5:1 contrast on the page and its panels', async () => {
  const { ctx, page } = await open({ time: '2026-10-13T21:00:00-05:00' });
  try {
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement), lum = name => {
        const h = css.getPropertyValue(name).trim().slice(1), c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      return Object.fromEntries(['--bg', '--panel', '--panel2', '--raise'].map(b => [b, +((lum('--ink3') + 0.05) / (lum(b) + 0.05)).toFixed(2)]));
    });
    for (const b in ratios) assert.ok(ratios[b] >= 4.5, `--ink3 on ${b} is ${ratios[b]}:1`);
  } finally { await ctx.close(); }
});

// In night vision the secondary text was 3.5:1 and the small capital labels 2.2:1, and the map's compass letters, the
// timeline's hours and the finder chart's stamp 2.0 to 2.7:1, under the 4.5:1 WCAG 2.2 asks of small text (1.4.3).
// Pure red on black reaches only about 5.25:1, so night vision has two levels of text, both about 5:1.
const lumOf = rgb => { const c = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const inkOn = (css, bg) => { const m = css.match(/[\d.]+/g).map(Number), a = m[3] == null ? 1 : m[3]; return contrast(m.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a)), bg); };
check('In night vision the secondary text and the words on the map, charts and timeline have 4.5:1 contrast', async () => {
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, red: true, layers: { lines: true, names: true, dso: true, mw: true, grid: true } }), time: '2026-11-15T21:00:00-06:00' });
  try {
    const css = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(['--ink', '--ink2', '--ink3', '--bg', '--panel', '--panel2', '--raise'].map(k => [k, s.getPropertyValue(k).trim()])); });
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (const fg of ['--ink', '--ink2', '--ink3']) for (const bg of ['--bg', '--panel', '--panel2', '--raise']) {
      const r = contrast(hex(css[fg]), hex(css[bg]));
      assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    await openCard(page, 'M31');
    await page.waitForTimeout(300);
    const inks = await page.$eval('#sky', c => c.__inks());
    assert.ok(inks.length >= 1, 'words were drawn');
    const night = [11, 1, 1]; // the map's sky on a dark night, in red
    for (const c of inks) assert.ok(inkOn(c, night) >= 4.5, `words drawn in ${c} are ${inkOn(c, night).toFixed(2)}:1`);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  // the normal look keeps its colours, and the altitude grid's labels are a little brighter
  const n = await open({ save: JSON.stringify({ loc: AUSTIN, layers: { lines: true, names: true, dso: true, mw: true, grid: true } }), time: '2026-11-15T21:00:00-06:00' });
  try {
    const inks = await n.page.$eval('#sky', c => c.__inks());
    assert.ok(inks.includes('rgba(124,139,181,0.9)'), 'the grid’s labels are drawn at 0.9');
    assert.ok(inkOn('rgba(124,139,181,0.9)', [6, 10, 20]) >= 4.5, 'and are 4.5:1 on the night sky');
    assert.equal(await n.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink2').trim()), '#A7AFC6', 'the secondary text is as it was');
  } finally { await n.ctx.close(); }
});

// A data file that wouldn't load showed "Starhop couldn’t load its star catalog (Failed to fetch). Reload to try again."
// with the map's and the timeline's buttons still there, doing nothing. Opened from a file, reloading never helps.
check('When the star catalog won’t load, it says what to do and puts away the buttons that need it', async () => {
  const { ctx, page, problems } = await open({ time: '2026-11-15T21:00:00-06:00', route: ['**/data/stars.json', r => r.fulfill({ status: 404, body: '' })] });
  try {
    assert.equal(await text(page, '#tonightSec'), 'Starhop couldn’t load its star catalog. Check the connection and reload.');
    for (const id of ['nowBtn', 'layBtn', 'dirSeg', 'zIn', 'prevN', 'nextN', 'locBtn', 'scopeBtn']) assert.equal(await page.isVisible('#' + id), false, `#${id} is put away`);
    assert.ok(await page.isVisible('#redBtn'), 'night vision still works');
    // what went wrong is in the console, not on the page
    assert.ok(problems.some(p => /^Starhop: Error: stars/.test(p)), 'the console says what went wrong: ' + problems.join(' | '));
    assert.deepEqual(problems.filter(p => !/^Starhop: |404/.test(p)), [], 'and nothing else');
  } finally { await ctx.close(); }
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx2.newPage();
    await page.goto('file://' + join(root, 'index.html'));
    await page.waitForFunction(() => document.getElementById('tonightSec').textContent.length > 0, null, { timeout: 30000 });
    assert.equal(await text(page, '#tonightSec'), 'Starhop needs to be opened from a web address, not a file. In its folder run python3 -m http.server and open localhost:8000.');
  } finally { await ctx2.close(); }
});

// The sky model's functions are inside the page's script, out of reach, so the model check has the server add this
// to the end of it. For a place, a telescope and a sky it shows the night the clock is on, then opens the first three
// targets, a double star, the last deep-sky object and any extra ({ k, id }), and returns what the page then says.
const MODEL_HOOK = `
  // where the Sun is overhead on the Moon at a time, by the Moon's frame the terminator card uses
  window.__sunOnMoon = function (iso) {
    var t = new Date(iso), f = moonFrame(t), mo = A.GeoVector(A.Body.Moon, t, true), su = A.GeoVector(A.Body.Sun, t, true), v = unit([su.x - mo.x, su.y - mo.y, su.z - mo.z]);
    var lon = Math.atan2(dot(v, f.y), dot(v, f.x)) * R2D;
    return { lon: lon, lat: Math.asin(dot(v, f.z)) * R2D, colongitude: norm360(90 - lon) };
  };
  window.__model = function (c) {
    var out = { err: null, cards: [] };
    try {
      if (!$('sheet').hidden) closeSheet(true);
      S.scope = c.scope; S.sky = c.sky; S.seen = {};
      setLoc(c.loc); $('locName').textContent = c.loc.name;
      T.live = true; setNight(currentNight(new Date()), true); draw();
      out.texts = { keys: $('keys').innerText, title: $('nightTitle').innerText, tonight: $('tonightSec').innerText, targets: $('targetSec').innerText, when: $('when').innerText };
      out.tonight = sameNight(NIGHT.n, currentNight(new Date()));
      out.rows = TARGETS.map(function (t) {
        var o = t.o || objById(t.k, t.id), lvl = t.k === 'moon' ? -0.3 : t.k === 'planet' ? 0 : -0.5;
        return { id: t.id, when: rowWhen(t), alt: altOf(o.b ? { k: 'body', b: o.b } : { v: o.v }, T.t) - lvl };
      });
      var picks = TARGETS.slice(0, 3).concat(TARGETS.filter(function (t) { return t.k === 'double'; }).slice(0, 1), TARGETS.filter(function (t) { return t.k === 'dso'; }).slice(-1), c.extra || []);
      picks.forEach(function (t) {
        var o = objById(t.k === 'double' ? 'dso' : t.k, t.id);
        openObject(o); openObject(o); // the second time draws its charts straight away
        out.cards.push({ id: t.id, text: $('sheet').innerText, cap: $('finderCap').textContent, epCap: $('epCap').innerText, labels: $('finder').__labels.map(function (l) { return l.t; }),
          rows: [].map.call(document.querySelectorAll('#sheet .eps tbody tr'), function (tr) { return [].map.call(tr.children, function (td) { return td.textContent; }); }) });
      });
      if (!$('sheet').hidden) closeSheet(true);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  };
`;
const field = deg => deg >= 1 ? deg.toFixed(1) + '°' : Math.round(deg * 60) + '′'; // as the page gives an eyepiece's field

// One wrong edit to the ratings, the eyepiece rows or the star-hops would otherwise pass every check here.
check('the sky model holds up for places and nights around the world', async () => {
  const EPS12 = [40, 32, 26, 20, 17, 14, 12, 10, 8, 6, 5, 3.5].map((f, i) => ({ f, a: [52, 68, 82][i % 3] }));
  const cases = [
    [AUSTIN, '2026-11-15T21:00:00-06:00', DOB8, 'suburb'],
    [AUSTIN, '2026-11-15T23:30:00-06:00', DOB8, 'city'],
    [{ name: 'Edinburgh', lat: 55.95, lon: -3.19, tz: 'Europe/London' }, '2026-06-21T23:00:00+01:00', DOB8, 'rural'],
    [{ name: 'Tromsø', lat: 69.65, lon: 18.96, tz: 'Europe/Oslo' }, '2026-06-21T23:00:00+02:00', DOB8, 'dark'],
    [{ name: 'Kirkenes', lat: 69.73, lon: 30.05, tz: 'Europe/Oslo' }, '2027-11-24T20:00:00+01:00', DOB8, 'dark'],
    [{ name: 'Senmonorom', lat: 12.45, lon: 107.2, tz: 'Asia/Phnom_Penh' }, '2009-01-22T19:15:00+07:00', DOB8, 'rural', [{ k: 'dso', id: 'M43' }]],
    [{ name: 'Sydney', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' }, '2026-04-15T22:00:00+10:00', { name: '50 mm', ap: 50, fl: 300, eps: [], set: true }, 'suburb'],
    [AUSTIN, '2026-07-15T22:30:00-05:00', { name: '500 mm', ap: 500, fl: 4000, eps: EPS12, set: true }, 'dark'],
    [{ name: 'Utqiaġvik', lat: 71.29, lon: -156.79, tz: 'America/Anchorage' }, '2027-01-22T12:00:00-09:00', DOB8, 'dark'],
    [{ name: 'Cape Town', lat: -33.93, lon: 18.42, tz: 'Africa/Johannesburg' }, '2026-09-07T03:00:00+02:00', { name: '70 mm', ap: 70, fl: 700, eps: [{ f: 25, a: 52 }, { f: 10, a: 52 }], set: true }, 'city'],
  ];
  hooked = true;
  const { ctx, page, problems } = await open({ time: cases[0][1] });
  try {
    await page.waitForFunction(() => window.__model);
    const BAD = /NaN|undefined|Invalid Date|Infinity|\[object/;
    for (const [loc, time, scope, sky, extra] of cases) {
      const at = `${loc.name} ${time}`;
      await page.clock.setSystemTime(new Date(time));
      const r = await page.evaluate(c => window.__model(c), { loc, scope, sky, extra });
      assert.equal(r.err, null, at);
      for (const [k, t] of Object.entries(r.texts)) assert.doesNotMatch(t, BAD, `${at}: ${k}`);
      assert.ok(r.rows.length, `${at}: the list has something`);
      // a row's state at the time shown: Rises or Set when it's down, and on tonight's list, Up now when it's up
      for (const row of r.rows) {
        const st = /^(Rises|Set|Up now)/.exec(row.when);
        if (st && st[1] !== 'Up now') assert.ok(row.alt < 0.2, `${at}: ${row.id} "${row.when}" but it's ${row.alt.toFixed(1)}° up`);
        if (r.tonight && (!st || st[1] === 'Up now')) assert.ok(row.alt > -0.2, `${at}: ${row.id} "${row.when}" but it's ${row.alt.toFixed(1)}° down`);
      }
      const eps = scope.eps.slice().sort((a, b) => b.f - a.f);
      for (const c of r.cards) {
        assert.doesNotMatch(c.text + ' ' + c.epCap, BAD, `${at}: ${c.id}'s card`);
        assert.deepEqual(c.rows.map(x => x.slice(0, 3)), eps.map(e => [e.f + ' mm', Math.round(scope.fl / e.f) + '×', field(e.a / (scope.fl / e.f))]), `${at}: ${c.id}'s eyepieces`);
        for (const n of hopStars(c.cap)) assert.ok(c.labels.includes(n), `${at}: ${c.id}'s chart labels ${n}, which its star-hop names`);
      }
    }
    assert.deepEqual(problems, []);
  } finally { hooked = false; await ctx.close(); }
});

check('without JavaScript it says what it needs, and GitHub Pages serves it as it is', async () => {
  await readFile(join(root, '.nojekyll')).catch(() => assert.fail('.nojekyll is missing'));
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    const note = page.locator('noscript p'); // Playwright's text search skips <noscript>, so look at it directly
    assert.ok(await note.isVisible(), 'the no-JavaScript note shows');
    assert.equal(await note.textContent(), 'Starhop needs JavaScript to draw the sky.');
  } finally { await ctx.close(); }
});

// A southern observer's list was the northern one with a few southern showpieces: no Jewel Box, no Alpha Centauri. Sydney,
// May 15 2027. Alpha Centauri (Dec −60.8°) never clears Austin's horizon, so it's not on a list there.
check('A southern autumn night lists the Jewel Box, Alpha Centauri and the great southern globulars', async () => {
  const { dso, doubles } = JSON.parse(await readFile(join(root, 'data/dso.json'), 'utf8'));
  const south = ['NGC 4755', 'NGC 6752', 'NGC 6397', 'NGC 362', 'NGC 2070', 'NGC 3766', 'NGC 3918', 'NGC 2808', 'NGC 3293', 'NGC 2477', 'NGC 3201', 'NGC 4945', 'NGC 300', 'NGC 1365', 'NGC 6744'];
  for (const id of south) {
    const d = dso.find(x => x.id === id);
    assert.ok(d && d.mag > 0 && d.dim[0] > 0 && d.dim[1] > 0, `${id} is in the data with a magnitude and a size`);
  }
  assert.deepEqual(['alphacen', 'gammavel', 'acamar', 'betatuc', 'peri'].filter(id => !doubles.some(d => d.id === id)), [], 'the southern doubles are in the data');
  const { ctx, page, problems } = await open({ loc: SYDNEY, time: '2027-05-15T21:00:00+10:00' });
  try {
    const ids = (await targetRows(page)).map(r => r.id);
    assert.deepEqual(['NGC 4755', 'alphacen', 'NGC 6752', 'NGC 6397', 'NGC 3918', 'NGC 2808', 'gammavel'].filter(id => !ids.includes(id)), [], 'listed in Sydney');
    await openCard(page, 'NGC 4755');
    assert.match(await text(page, '#sheet .hd h2'), /^Jewel Box Open cluster in Crux/);
    assert.match(await text(page, '#sheet'), /beside Mimosa/);
    await page.click('#sheet [data-close]');
    await openCard(page, 'alphacen');
    assert.match(await text(page, '#sheet'), /Separation 8\.1″/i);
    assert.match(await text(page, '#sheet'), /Rigil Kentaurus is the naked-eye star itself \(mag 0\.0\)/, 'not “mag -0.0”');
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
  const a = await open({ time: '2027-05-15T21:00:00-05:00' });
  try {
    assert.equal((await targetRows(a.page)).some(r => r.id === 'alphacen'), false, 'not listed in Austin');
    assert.deepEqual(a.problems, []);
  } finally { await a.ctx.close(); }
});

// NGC 2000.0's 40′ and magnitude 8.2 for the Tarantula Nebula spread its whole faint glow, and rated the bright knot a
// small telescope shows plainly Very hard from Sydney's suburbs, 87th of 107. Sydney, Nov 15 2026.
check('The Tarantula Nebula is rated for the bright knot you see', async () => {
  const { ctx, page, problems } = await open({ loc: SYDNEY, time: '2026-11-15T22:00:00+11:00' });
  try {
    const t = (await targetRows(page)).find(r => r.id === 'NGC 2070');
    assert.ok(t, 'listed');
    assert.match(t.rate, /^(Easy|Fair)$/, 'rated ' + t.rate);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

// The northern list had no Needle Galaxy (the build asked for it and dropped it: d3-celestial has it only with a 0.8′
// size and magnitude 15.9), no Kemble's Cascade and no Stock 2. Austin, Feb 15 2027, from a dark site.
check('A dark winter night in Austin lists the Needle Galaxy, Kemble’s Cascade and the new northern doubles', async () => {
  const { dso, doubles } = JSON.parse(await readFile(join(root, 'data/dso.json'), 'utf8'));
  const north = ['NGC 4565', 'Kemble 1', 'Stock 2', 'NGC 891', 'NGC 7331', 'NGC 6210', 'NGC 7789', 'NGC 1502', 'NGC 4631', 'NGC 2169', 'NGC 2903', 'IC 4665'];
  for (const id of north) {
    const d = dso.find(x => x.id === id);
    assert.ok(d && d.mag > 0 && d.dim[0] > 0 && d.dim[1] > 0, `${id} is in the data with a magnitude and a size`);
  }
  const needle = dso.find(d => d.id === 'NGC 4565');
  assert.deepEqual([needle.mag, needle.dim[0]], [9.6, 16.2], 'the Needle at NGC 2000.0’s magnitude and size');
  const kemble = dso.find(d => d.id === 'Kemble 1');
  assert.ok(kemble.dim[0] > 150 && kemble.dim[0] < 190, 'Kemble’s Cascade is nearly 3° long: ' + kemble.dim[0]);
  const pairs = ['gammadel', 'achird', 'betamon', 'deltacep', 'iotacnc', 'nudra', 'rasalgethi', 'porrima', 'alya', 'xiboo'];
  assert.deepEqual(pairs.filter(id => !doubles.some(d => d.id === id)), [], 'the northern doubles are in the data');
  const { ctx, page, problems } = await open({ save: JSON.stringify({ loc: AUSTIN, sky: 'dark' }), time: '2027-02-15T21:00:00-06:00' });
  try {
    const ids = (await targetRows(page)).map(r => r.id);
    assert.deepEqual(['NGC 4565', 'Kemble 1', 'Stock 2', 'NGC 7789', 'iotacnc', 'betamon', 'porrima', 'rasalgethi'].filter(id => !ids.includes(id)), [], 'listed');
    await openCard(page, 'Kemble 1');
    assert.equal(await text(page, '#sheet .hd h2'), 'Kemble’s Cascade Asterism in Camelopardalis', 'the IAU’s spelling, as the map has it, not Astronomy Engine’s Camelopardis');
    assert.match(await text(page, '#sheet'), /nearly 3° long, running down to the little cluster NGC 1502/);
    // its 4.3 adds up nine stars, but the eye sees only the 5th-magnitude one in its middle, even from a dark site
    assert.doesNotMatch(await text(page, '#sheet'), /Visible without a telescope/);
    assert.ok(await page.waitForFunction(() => document.getElementById('eyepiece').__chain).then(h => h.jsonValue()) >= 5, 'its stars are drawn in the eyepiece sketch');
    assert.doesNotMatch(await text(page, '#epCap'), /aren’t drawn/);
    await page.click('#sheet [data-close]');
    await openCard(page, 'porrima');
    assert.match(await text(page, '#sheet'), /Separation 3\.2″/i);
    assert.deepEqual(problems, []);
  } finally { await ctx.close(); }
});

const only = process.argv[2];
let failed = 0, ran = 0;
for (const [name, fn] of checks) {
  if (only && !name.includes(only)) continue;
  ran++;
  try { await fn(); console.log('ok    ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').join('\n      ')); }
}
await browser.close();
server.close();
if (!ran) { console.log('no check matches ' + JSON.stringify(only)); process.exit(1); }
if (failed) { console.log(`${failed} of ${ran} failed`); process.exit(1); }
console.log(`all good (${ran} check${ran === 1 ? "" : "s"})`);
